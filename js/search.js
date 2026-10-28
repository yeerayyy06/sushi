// Búsqueda de sitios. Todo sin API keys y llamado desde el navegador:
//   - Photon (komoot): geocodificador/buscador de POIs sobre datos de OpenStreetMap. Permite "mientras escribes".
//   - Nominatim: dirección aproximada de un pin puesto a mano (geocodificación inversa) y buscador de reserva
//     cuando Photon no responde (su política exige ≤ 1 petición/s y nada de autocompletado: solo al pulsar Intro).
//   - Overpass API: complemento para "¿qué sushis hay en la zona?" (busca por la etiqueta cuisine=sushi).
import { fetchWithTimeout, distanceMeters } from './util.js';

const PHOTON = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
// Servidores públicos de Overpass (sin SLA; se prueban por orden). maps.mail.ru funciona pero es lento.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const FOOD_TAGS = ['amenity:restaurant', 'amenity:fast_food', 'amenity:cafe', 'amenity:food_court', 'amenity:bar'];
const FOOD_VALUES = new Set(['restaurant', 'fast_food', 'cafe', 'food_court', 'bar', 'pub', 'ice_cream', 'biergarten']);
const AREA_TYPES = new Set(['country', 'state', 'county', 'city', 'district', 'locality', 'town', 'village', 'suburb']);
const AREA_LAYERS = ['city', 'district', 'locality', 'county', 'state', 'country'];
const DISCOVER_TERMS = ['sushi', 'japon', 'japanese', 'izakaya'];
const PHOTON_RETRY_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Infraestructura: fetch JSON, caché pequeña y salud de Photon
// ---------------------------------------------------------------------------
async function fetchJson(url, { signal, timeoutMs = 10000, ...init } = {}) {
  const res = await fetchWithTimeout(url, { signal, timeoutMs, ...init });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const cache = new Map();
function cached(key, producer) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return producer().then((value) => {
    if (cache.size > 150) cache.delete(cache.keys().next().value);
    cache.set(key, value);
    return value;
  });
}

let photonDownUntil = 0;
const isNetworkFailure = (err) =>
  err?.name === 'TimeoutError' || err?.name === 'TypeError' || err?.status === 429 || (err?.status >= 500 && err?.status < 600);

/** 'photon' (búsqueda mientras escribes) o 'nominatim' (solo al pulsar Intro). */
export function getSearchProvider() {
  return Date.now() < photonDownUntil ? 'nominatim' : 'photon';
}

function markPhotonDown(err) {
  if (!isNetworkFailure(err)) return;
  photonDownUntil = Date.now() + PHOTON_RETRY_MS;
  console.warn('Photon no responde; usando Nominatim durante unos minutos.', err?.message || err);
}

// ---------------------------------------------------------------------------
// Conversión de resultados a un formato común
//   { id, osm, name, address, lat, lng, kind: 'food'|'shop'|'area'|'street'|'address'|'place', cuisine, extent }
// ---------------------------------------------------------------------------
function classify(osmKey, osmValue, type) {
  if (osmKey === 'amenity' && FOOD_VALUES.has(osmValue)) return 'food';
  if (osmKey === 'shop') return 'shop';
  if (AREA_TYPES.has(type) || AREA_TYPES.has(osmValue) || ['place', 'boundary'].includes(osmKey)) return 'area';
  if (type === 'street' || osmKey === 'highway') return 'street';
  if (type === 'house') return 'address';
  return 'place';
}

function photonFeatureToResult(feature) {
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry?.coordinates || [];
  const streetLine = [p.street, p.housenumber].filter(Boolean).join(' ');
  const cityLine = [p.postcode, p.city || p.town || p.village || p.district].filter(Boolean).join(' ');
  const country = p.countrycode && p.countrycode !== 'ES' ? p.country : '';
  const address = [streetLine, cityLine, country].filter(Boolean).join(', ');
  const name = p.name || streetLine || cityLine || 'Sin nombre';
  const osm = p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : '';
  return {
    id: osm || `${lat},${lng}`,
    osm,
    name,
    address: address === name ? cityLine : address,
    lat,
    lng,
    kind: classify(p.osm_key, p.osm_value, p.type),
    cuisine: p.cuisine || '',
    extent: Array.isArray(p.extent) && p.extent.length === 4 ? p.extent : null, // [minLon, maxLat, maxLon, minLat]
  };
}

function nominatimToResult(r) {
  const a = r.address || {};
  const streetLine = [a.road || a.pedestrian || a.footway || a.square, a.house_number].filter(Boolean).join(' ');
  const cityLine = [a.postcode, a.city || a.town || a.village || a.municipality].filter(Boolean).join(' ');
  const country = a.country_code && a.country_code !== 'es' ? a.country : '';
  const address = [streetLine, cityLine, country].filter(Boolean).join(', ');
  const name = r.name || streetLine || String(r.display_name || '').split(',')[0] || 'Sin nombre';
  const typeLetter = { node: 'N', way: 'W', relation: 'R' }[r.osm_type] || '';
  const osm = typeLetter && r.osm_id ? `${typeLetter}${r.osm_id}` : '';
  const bb = Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null; // [minLat, maxLat, minLon, maxLon]
  return {
    id: osm || `${r.lat},${r.lon}`,
    osm,
    name,
    address: address === name ? cityLine : address,
    lat: Number(r.lat),
    lng: Number(r.lon),
    kind: classify(r.category, r.type, r.addresstype),
    cuisine: '',
    extent: bb && bb.length === 4 ? [bb[2], bb[1], bb[3], bb[0]] : null,
  };
}

function overpassElementToResult(el) {
  const tags = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const streetLine = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const cityLine = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ');
  const typeLetter = { node: 'N', way: 'W', relation: 'R' }[el.type] || 'N';
  return {
    id: `${typeLetter}${el.id}`,
    osm: `${typeLetter}${el.id}`,
    name: tags.name || tags['name:es'] || tags.brand || 'Restaurante japonés',
    address: [streetLine, cityLine].filter(Boolean).join(', '),
    lat,
    lng,
    kind: 'food',
    cuisine: tags.cuisine || '',
    extent: null,
  };
}

const validCoords = (r) => Number.isFinite(r.lat) && Number.isFinite(r.lng);

// ---------------------------------------------------------------------------
// Búsqueda por texto
// ---------------------------------------------------------------------------
async function photonSearch(query, { near, zoom, limit, signal }) {
  const base = new URLSearchParams({ q: query, limit: String(limit), lang: 'default' });
  if (near) {
    base.set('lat', near.lat.toFixed(5));
    base.set('lon', near.lng.toFixed(5));
    if (Number.isFinite(zoom)) base.set('zoom', String(Math.min(18, Math.max(2, Math.round(zoom)))));
    base.set('location_bias_scale', '0.3');
  }
  const food = new URLSearchParams(base);
  FOOD_TAGS.forEach((t) => food.append('osm_tag', t));
  const areas = new URLSearchParams(base);
  areas.set('limit', '3');
  AREA_LAYERS.forEach((l) => areas.append('layer', l));

  const settled = await Promise.allSettled([
    fetchJson(`${PHOTON}/api/?${food}`, { signal }),
    fetchJson(`${PHOTON}/api/?${base}`, { signal }),
    fetchJson(`${PHOTON}/api/?${areas}`, { signal }),
  ]);
  if (settled.every((r) => r.status === 'rejected')) throw settled[0].reason;
  const out = [];
  for (const res of settled) {
    if (res.status !== 'fulfilled') continue;
    for (const f of res.value?.features || []) out.push(photonFeatureToResult(f));
  }
  return out;
}

async function nominatimSearch(query, { near, limit, signal }) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(limit + 4),
    addressdetails: '1',
    dedupe: '1',
    'accept-language': 'es',
  });
  if (near) {
    // Sesgo (no límite) hacia la zona del mapa.
    const d = 0.35;
    params.set('viewbox', `${(near.lng - d).toFixed(4)},${(near.lat + d).toFixed(4)},${(near.lng + d).toFixed(4)},${(near.lat - d).toFixed(4)}`);
    params.set('bounded', '0');
  }
  const json = await fetchJson(`${NOMINATIM}/search?${params}`, { signal, timeoutMs: 8000 });
  return (Array.isArray(json) ? json : []).map(nominatimToResult);
}

/**
 * Busca sitios por texto. Devuelve primero locales de comida y después calles/ciudades (para mover el mapa).
 * Usa Photon; si no responde, pasa a Nominatim unos minutos (ver getSearchProvider()).
 * @param {string} q
 * @param {{near?: {lat:number,lng:number}, zoom?: number, limit?: number, signal?: AbortSignal}} opts
 * @returns {Promise<object[]>}
 */
export async function searchPlaces(q, { near, zoom, limit = 7, signal } = {}) {
  const query = String(q ?? '').trim();
  if (query.length < 2) return [];
  const provider = getSearchProvider();
  const key = `${provider}|${query.toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}|${zoom ?? ''}`;

  const raw = await cached(key, async () => {
    if (provider === 'photon') {
      try {
        return await photonSearch(query, { near, zoom, limit, signal });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        markPhotonDown(err);
        throw err;
      }
    }
    return nominatimSearch(query, { near, limit, signal });
  });

  const seen = new Set();
  const foodOut = [];
  const otherOut = [];
  for (const r of raw) {
    if (!validCoords(r) || seen.has(r.id)) continue;
    seen.add(r.id);
    const item = near ? { ...r, distance: distanceMeters(near, r) } : { ...r };
    (item.kind === 'food' || item.kind === 'shop' ? foodOut : otherOut).push(item);
  }
  return [...foodOut.slice(0, limit), ...otherOut.slice(0, 4)];
}

// ---------------------------------------------------------------------------
// "Sushis por aquí": todo lo japonés dentro de los límites visibles
// ---------------------------------------------------------------------------
function overpassQuery(bounds, max) {
  const bbox = `${bounds.south.toFixed(5)},${bounds.west.toFixed(5)},${bounds.north.toFixed(5)},${bounds.east.toFixed(5)}`;
  return `[out:json][timeout:20];
(
  nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["cuisine"~"sushi|japanese",i](${bbox});
  nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"~"sushi|japon|izakaya",i](${bbox});
);
out center tags ${max};`;
}

async function overpassSushi(bounds, { max, signal }) {
  const body = new URLSearchParams({ data: overpassQuery(bounds, max) });
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const json = await fetchJson(endpoint, { method: 'POST', body, signal, timeoutMs: endpoint.includes('mail.ru') ? 25000 : 12000 });
      return (json.elements || []).map(overpassElementToResult).filter(validCoords);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass no responde');
}

async function photonSushi(bounds, { max, signal }) {
  const bbox = [bounds.west, bounds.south, bounds.east, bounds.north].map((n) => n.toFixed(5)).join(',');
  const settled = await Promise.allSettled(
    DISCOVER_TERMS.map((term) => {
      const params = new URLSearchParams({ q: term, limit: String(max), bbox, lang: 'default' });
      FOOD_TAGS.forEach((t) => params.append('osm_tag', t));
      return fetchJson(`${PHOTON}/api/?${params}`, { signal });
    }),
  );
  if (settled.every((r) => r.status === 'rejected')) throw settled[0].reason;
  const out = [];
  for (const res of settled) {
    if (res.status !== 'fulfilled') continue;
    for (const f of res.value?.features || []) out.push(photonFeatureToResult(f));
  }
  return out.filter(validCoords);
}

async function nominatimSushi(bounds, { max, signal }) {
  const params = new URLSearchParams({
    q: 'sushi',
    format: 'jsonv2',
    limit: String(Math.min(max, 50)),
    addressdetails: '1',
    dedupe: '1',
    bounded: '1',
    viewbox: `${bounds.west.toFixed(5)},${bounds.north.toFixed(5)},${bounds.east.toFixed(5)},${bounds.south.toFixed(5)}`,
    'accept-language': 'es',
  });
  const json = await fetchJson(`${NOMINATIM}/search?${params}`, { signal, timeoutMs: 8000 });
  return (Array.isArray(json) ? json : []).map(nominatimToResult).filter(validCoords);
}

function mergeDiscovered(lists) {
  const out = [];
  const ids = new Set();
  for (const list of lists) {
    for (const r of list) {
      if (ids.has(r.id)) continue;
      const name = r.name.toLowerCase();
      if (out.some((o) => o.name.toLowerCase() === name && distanceMeters(o, r) < 60)) continue; // mismo sitio
      ids.add(r.id);
      out.push(r);
    }
  }
  return out;
}

/**
 * Restaurantes de sushi/japoneses dentro de unos límites.
 * Photon responde primero (vía `onPartial`); Overpass se añade si contesta a tiempo. Si Photon está caído, Nominatim.
 * @param {{north:number,south:number,east:number,west:number}} bounds
 * @param {{max?: number, signal?: AbortSignal, onPartial?: (list: object[]) => void}} opts
 */
export async function discoverSushi(bounds, { max = 60, signal, onPartial } = {}) {
  const key = `discover|${[bounds.south, bounds.west, bounds.north, bounds.east].map((n) => n.toFixed(3)).join(',')}`;
  if (cache.has(key)) return cache.get(key);

  const overpassPromise = overpassSushi(bounds, { max, signal }).catch((err) => {
    if (err?.name === 'AbortError') throw err;
    console.warn('Overpass no disponible:', err?.message || err);
    return [];
  });

  let primary = [];
  let primaryFailed = false;
  try {
    if (getSearchProvider() === 'photon') {
      try {
        primary = await photonSushi(bounds, { max: 30, signal });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        markPhotonDown(err);
        primary = await nominatimSushi(bounds, { max, signal });
      }
    } else {
      primary = await nominatimSushi(bounds, { max, signal });
    }
    onPartial?.(mergeDiscovered([primary]));
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    primaryFailed = true;
    console.warn('Búsqueda por zona no disponible:', err?.message || err);
  }

  const extra = await overpassPromise;
  if (primaryFailed && !extra.length) throw new Error('El buscador no responde ahora mismo. Prueba en un rato.');
  const merged = mergeDiscovered([primary, extra]);
  cache.set(key, merged);
  return merged;
}

// ---------------------------------------------------------------------------
// Dirección de un punto (nunca lanza: si todo falla, devuelve campos vacíos)
// ---------------------------------------------------------------------------
export async function reverseGeocode(lat, lng, { signal } = {}) {
  try {
    return await nominatimReverse(lat, lng, { signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  if (getSearchProvider() === 'photon') {
    try {
      return await photonReverse(lat, lng, { signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      markPhotonDown(err);
    }
  }
  return { name: '', address: '' };
}

async function nominatimReverse(lat, lng, { signal }) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'es',
  });
  const json = await fetchJson(`${NOMINATIM}/reverse?${params}`, { signal, timeoutMs: 8000 });
  if (json.error) throw new Error(json.error);
  const r = nominatimToResult(json);
  return { name: r.kind === 'food' || r.kind === 'shop' ? r.name : '', address: r.address || '' };
}

async function photonReverse(lat, lng, { signal }) {
  const params = new URLSearchParams({ lat: lat.toFixed(6), lon: lng.toFixed(6), lang: 'default' });
  const json = await fetchJson(`${PHOTON}/reverse?${params}`, { signal, timeoutMs: 8000 });
  const first = json.features?.[0];
  if (!first) return { name: '', address: '' };
  const r = photonFeatureToResult(first);
  return { name: r.kind === 'food' || r.kind === 'shop' ? r.name : '', address: r.address || '' };
}
