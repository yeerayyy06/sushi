// Búsqueda de sitios. Todo sin API keys y llamado desde el navegador:
//   - Photon (komoot): buscador sobre OpenStreetMap que permite "mientras escribes". A veces bloquea redes
//     concretas; si falla, se deja de usar un rato y se pasa a Nominatim.
//   - Nominatim (OSM): buscador de reserva (solo al pulsar Intro, como pide su política: máx. 1 petición/s),
//     direcciones de un punto y "sushi por aquí" (restaurantes de una zona con su tipo de cocina).
//   - Overpass API: complemento opcional para "sushi por aquí"; suele estar saturado, así que no se espera por él.
import { distanceMeters, normalize } from './util.js';

const PHOTON = 'https://photon.komoot.io';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
// Solo el servidor principal y con poco tiempo: suele estar saturado y no queremos hacer esperar.
const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter'];

const FOOD_TAGS = ['amenity:restaurant', 'amenity:fast_food', 'amenity:cafe', 'amenity:food_court', 'amenity:bar'];
const FOOD_VALUES = new Set(['restaurant', 'fast_food', 'cafe', 'food_court', 'bar', 'pub', 'ice_cream', 'biergarten']);
const AREA_TYPES = new Set(['country', 'state', 'county', 'city', 'district', 'locality', 'town', 'village', 'suburb', 'municipality', 'hamlet']);
const DISCOVER_TERMS = ['sushi', 'japon', 'japo', 'wok'];
const PHOTON_DOWN_KEY = 'sushimap:photon-down-until';
const PHOTON_RETRY_MS = 30 * 60 * 1000;
const NOMINATIM_GAP_MS = 1100;

/** Palabras que no ayudan a encontrar un sitio concreto ("koyo sushi" -> "koyo"). */
const GENERIC_WORDS = new Set(
  ['sushi', 'restaurante', 'restaurantes', 'restaurant', 'restaurants', 'rest', 'japones', 'japonesa', 'japanese', 'bar',
    'asiatico', 'asiatica', 'buffet', 'take', 'away', 'el', 'la', 'los', 'las', 'de', 'del', 'the'],
);

/** Qué cuenta como "sitio de sushi" en OpenStreetMap: tipo de cocina o nombre. */
const SUSHI_CUISINE_RE = /sushi|japanese|asian|ramen|poke/i;
const SUSHI_NAME_RE = /sushi|jap[oó]n|japo|nikkei|ramen|izakaya|maki|nigiri|temaki|udon|wok|asi[aá]ti/i;

export function isSushiLike(r) {
  return SUSHI_CUISINE_RE.test(r.cuisine || '') || SUSHI_NAME_RE.test(r.name || '');
}

/** Etiqueta corta en español para el tipo de cocina. */
export function cuisineLabel(cuisine) {
  const c = String(cuisine || '').toLowerCase();
  if (c.includes('sushi')) return 'sushi';
  if (c.includes('japanese')) return 'japonés';
  if (c.includes('ramen')) return 'ramen';
  if (c.includes('poke')) return 'poke';
  if (c.includes('asian')) return 'asiático';
  return '';
}

// ---------------------------------------------------------------------------
// Infraestructura: fetch JSON, caché, salud de Photon y turno de Nominatim
// ---------------------------------------------------------------------------
/** fetch + JSON con tiempo máximo para TODO (cabeceras y cuerpo) y cancelable desde fuera. */
async function fetchJson(url, { signal, timeoutMs = 10000, ...init } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(new DOMException('Aborted', 'AbortError'));
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const cache = new Map();
function remember(key, value) {
  if (cache.size > 150) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

const isNetworkFailure = (err) =>
  err?.name === 'TimeoutError' || err?.name === 'TypeError' || err?.status === 429 || (err?.status >= 500 && err?.status < 600);

let photonDownUntil = (() => {
  try {
    return Number(localStorage.getItem(PHOTON_DOWN_KEY)) || 0;
  } catch {
    return 0;
  }
})();

/** 'photon' (búsqueda mientras escribes) o 'nominatim' (solo al pulsar Intro). */
export function getSearchProvider() {
  return Date.now() < photonDownUntil ? 'nominatim' : 'photon';
}
function markPhotonDown(err) {
  if (!isNetworkFailure(err)) return;
  // Un corte del propio móvil (sin red, app en segundo plano) no es culpa de Photon.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  photonDownUntil = Date.now() + PHOTON_RETRY_MS;
  // Solo se recuerda entre recargas si Photon dice explícitamente que está saturado (429/5xx).
  if (err?.status) {
    try {
      localStorage.setItem(PHOTON_DOWN_KEY, String(photonDownUntil));
    } catch {
      /* sin almacenamiento */
    }
  }
  console.warn('Photon no responde; usando Nominatim durante un rato.', err?.message || err);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

// Nominatim pide como máximo una petición por segundo: todas pasan por esta cola.
let nominatimQueue = Promise.resolve();
let lastNominatimAt = 0;
function nominatim(path, params, { signal, timeoutMs = 9000 } = {}) {
  const run = async () => {
    const gap = lastNominatimAt + NOMINATIM_GAP_MS - Date.now();
    if (gap > 0) await wait(gap, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    lastNominatimAt = Date.now();
    const query = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'es', ...params });
    return fetchJson(`${NOMINATIM}/${path}?${query}`, { signal, timeoutMs });
  };
  const result = nominatimQueue.then(run, run);
  nominatimQueue = result.catch(() => {});
  return result;
}

// ---------------------------------------------------------------------------
// Conversión a un formato común:
//   { id, osm, name, address, lat, lng, kind: 'food'|'shop'|'area'|'street'|'address'|'place', cuisine, extent }
// ---------------------------------------------------------------------------
function classify(osmKey, osmValue, type) {
  if (osmKey === 'amenity' && FOOD_VALUES.has(osmValue)) return 'food';
  if (osmKey === 'shop') return 'shop';
  if (AREA_TYPES.has(type) || AREA_TYPES.has(osmValue) || ['place', 'boundary'].includes(osmKey)) return 'area';
  if (type === 'street' || type === 'road' || osmKey === 'highway') return 'street';
  if (type === 'house' || osmKey === 'building') return 'address';
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
    cuisine: p.cuisine || p.extra?.cuisine || '',
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
    cuisine: r.extratags?.cuisine || '',
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

/** Caja de ~km alrededor de un punto, en el formato viewbox de Nominatim (lon1,lat1,lon2,lat2). */
function boxAround(center, km) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  return { south: center.lat - dLat, north: center.lat + dLat, west: center.lng - dLng, east: center.lng + dLng };
}
const viewbox = (b) => [b.west, b.north, b.east, b.south].map((n) => n.toFixed(5)).join(',');

function stripGeneric(query) {
  return query
    .split(/\s+/)
    .filter((w) => w && !GENERIC_WORDS.has(normalize(w)))
    .join(' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Búsqueda por texto
// ---------------------------------------------------------------------------
async function photonSearch(query, { near, zoom, limit, signal }) {
  const base = new URLSearchParams({ q: query, limit: String(limit), lang: 'default' });
  if (near) {
    base.set('lat', near.lat.toFixed(5));
    base.set('lon', near.lng.toFixed(5));
    base.set('zoom', String(Math.min(16, Math.max(10, Math.round(Number.isFinite(zoom) ? zoom : 13)))));
    base.set('location_bias_scale', '0.2');
  }
  const food = new URLSearchParams(base);
  FOOD_TAGS.forEach((t) => food.append('osm_tag', t));
  const requests = [fetchJson(`${PHOTON}/api/?${food}`, { signal }), fetchJson(`${PHOTON}/api/?${base}`, { signal })];
  const stripped = stripGeneric(query);
  if (stripped.length >= 3 && stripped !== query) {
    const foodStripped = new URLSearchParams(food);
    foodStripped.set('q', stripped);
    requests.push(fetchJson(`${PHOTON}/api/?${foodStripped}`, { signal }));
  }
  const settled = await Promise.allSettled(requests);
  if (settled.every((r) => r.status === 'rejected')) throw settled[0].reason;
  const out = [];
  for (const res of settled) {
    if (res.status !== 'fulfilled') continue;
    for (const f of res.value?.features || []) out.push(photonFeatureToResult(f));
  }
  return out;
}

async function nominatimSearch(query, { near, signal }) {
  const params = { addressdetails: '1', extratags: '1', dedupe: '1' };
  const out = [];
  if (near) {
    // 1) cerca (unos 45 km): lo que de verdad os interesa
    const box = viewbox(boxAround(near, 45));
    const local = await nominatim('search', { ...params, q: query, limit: '10', viewbox: box, bounded: '1' }, { signal });
    out.push(...local);
    // 2) sin las palabras genéricas, por si el sitio se llama solo "Koyo" y no "Koyo Sushi"
    const stripped = stripGeneric(query);
    if (local.length < 3 && stripped.length >= 3 && stripped !== query) {
      out.push(...(await nominatim('search', { ...params, q: stripped, limit: '10', viewbox: box, bounded: '1' }, { signal })));
    }
  }
  // 3) en cualquier sitio, para ciudades lejanas o si de cerca no hay nada
  if (out.length < 4) out.push(...(await nominatim('search', { ...params, q: query, limit: '8' }, { signal })));
  return out.map(nominatimToResult);
}

/**
 * Busca sitios por texto. Devuelve primero locales de comida (los más cercanos primero) y después
 * calles/ciudades (para mover el mapa). Usa Photon; si no responde, Nominatim (ver getSearchProvider()).
 * @param {string} q
 * @param {{near?: {lat:number,lng:number}, zoom?: number, limit?: number, signal?: AbortSignal}} opts
 */
export async function searchPlaces(q, { near, zoom, limit = 8, signal } = {}) {
  const query = String(q ?? '').trim();
  if (query.length < 2) return [];
  const provider = getSearchProvider();
  const key = `${provider}|${query.toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : ''}`;

  let raw = cache.get(key);
  if (!raw) {
    if (provider === 'photon') {
      try {
        raw = await photonSearch(query, { near, zoom, limit, signal });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        markPhotonDown(err);
        throw err;
      }
    } else {
      raw = await nominatimSearch(query, { near, signal });
    }
    remember(key, raw);
  }

  const seen = new Set();
  const food = [];
  const other = [];
  for (const r of raw) {
    if (!validCoords(r) || seen.has(r.id)) continue;
    seen.add(r.id);
    const item = near ? { ...r, distance: distanceMeters(near, r) } : { ...r };
    (item.kind === 'food' || item.kind === 'shop' ? food : other).push(item);
  }
  if (near) food.sort((a, b) => a.distance - b.distance);
  return [...food.slice(0, limit), ...other.slice(0, 4)];
}

// ---------------------------------------------------------------------------
// "Sushi por aquí": restaurantes de una zona, separando los de sushi/japoneses/asiáticos del resto
// ---------------------------------------------------------------------------
/** Zona de búsqueda: lo que se ve, pero nunca menos de ~1,5 km ni más de ~6 km alrededor del centro. */
export function discoveryBox(center, bounds) {
  const halfLatKm = ((bounds.north - bounds.south) / 2) * 111;
  const halfLngKm = ((bounds.east - bounds.west) / 2) * 111 * Math.cos((center.lat * Math.PI) / 180);
  const km = Math.min(6, Math.max(1.5, Math.max(halfLatKm, halfLngKm)));
  return boxAround(center, km);
}

async function overpassSushi(box, { signal }) {
  const bbox = [box.south, box.west, box.north, box.east].map((n) => n.toFixed(5)).join(',');
  const query = `[out:json][timeout:12];
(
  nwr["amenity"~"^(restaurant|fast_food)$"]["cuisine"~"sushi|japanese|asian|ramen|poke",i](${bbox});
  nwr["amenity"~"^(restaurant|fast_food)$"]["name"~"sushi|japon|japo|wok|ramen|izakaya|nikkei",i](${bbox});
);
out center tags 80;`;
  const body = new URLSearchParams({ data: query });
  let lastErr = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const json = await fetchJson(endpoint, { method: 'POST', body, signal, timeoutMs: 7000 });
      return (json.elements || []).map(overpassElementToResult).filter(validCoords);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('Overpass no responde');
}

async function photonSushi(box, { signal }) {
  const bbox = [box.west, box.south, box.east, box.north].map((n) => n.toFixed(5)).join(',');
  const settled = await Promise.allSettled(
    DISCOVER_TERMS.map((term) => {
      const params = new URLSearchParams({ q: term, limit: '30', bbox, lang: 'default' });
      FOOD_TAGS.forEach((t) => params.append('osm_tag', t));
      return fetchJson(`${PHOTON}/api/?${params}`, { signal });
    }),
  );
  if (settled.every((r) => r.status === 'rejected')) {
    markPhotonDown(settled[0].reason);
    throw settled[0].reason;
  }
  return settled
    .flatMap((r) => (r.status === 'fulfilled' ? r.value?.features || [] : []))
    .map(photonFeatureToResult)
    .filter(validCoords);
}

/**
 * Restaurantes de una zona: { sushi: [...], others: [...] }.
 * Va llamando a onProgress con lo que lleva encontrado (Nominatim responde por partes).
 * @param {{lat:number,lng:number}} center
 * @param {{north:number,south:number,east:number,west:number}} bounds  lo que se ve en el mapa
 */
export async function discoverSushi(center, bounds, { signal, onProgress } = {}) {
  const box = discoveryBox(center, bounds);
  const key = `discover|${[box.south, box.west, box.north, box.east].map((n) => n.toFixed(3)).join(',')}`;
  if (cache.has(key)) return cache.get(key);

  const found = new Map(); // id -> resultado
  const add = (list) => {
    for (const r of list) {
      if (!validCoords(r) || found.has(r.id)) continue;
      const name = normalize(r.name);
      const twin = [...found.values()].find((o) => normalize(o.name) === name && distanceMeters(o, r) < 60);
      if (twin) {
        if (!twin.cuisine && r.cuisine) twin.cuisine = r.cuisine;
        continue;
      }
      found.set(r.id, { ...r });
    }
  };
  const snapshot = () => {
    const all = [...found.values()];
    return { sushi: all.filter(isSushiLike), others: all.filter((r) => !isSushiLike(r)), box };
  };

  let nominatimCalls = 0;
  let nominatimFailures = 0;
  const report = () => onProgress?.(snapshot());
  // Overpass y Photon son extras: si fallan, no pasa nada.
  const optional = (promise) =>
    promise.then(
      (list) => {
        add(list);
        report();
      },
      (err) => {
        if (err?.name === 'AbortError') throw err;
      },
    );

  const LIMIT = 40;
  const structured = async (amenity, area, { split = true } = {}) => {
    nominatimCalls += 1;
    let list;
    try {
      list = await nominatim(
        'search',
        { amenity, limit: String(LIMIT), extratags: '1', addressdetails: '1', bounded: '1', viewbox: viewbox(area) },
        { signal },
      );
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      nominatimFailures += 1;
      return;
    }
    add(list.map(nominatimToResult).filter((r) => r.kind === 'food'));
    report();
    // Nominatim corta en 40: si se llega al tope, se repite por cuartos para no perder sitios.
    if (split && list.length >= LIMIT) {
      const midLat = (area.north + area.south) / 2;
      const midLng = (area.east + area.west) / 2;
      const quarters = [
        { north: area.north, south: midLat, west: area.west, east: midLng },
        { north: area.north, south: midLat, west: midLng, east: area.east },
        { north: midLat, south: area.south, west: area.west, east: midLng },
        { north: midLat, south: area.south, west: midLng, east: area.east },
      ];
      for (const q of quarters) await structured(amenity, q, { split: false });
    }
  };

  const tasks = [
    (async () => {
      await structured('sushi', box);
      await structured('restaurant', box);
      await structured('fast_food', box);
    })(),
    optional(overpassSushi(box, { signal })),
  ];
  if (getSearchProvider() === 'photon') tasks.push(optional(photonSushi(box, { signal })));
  await Promise.all(tasks);

  const result = snapshot();
  if (nominatimFailures === nominatimCalls && !found.size) {
    throw new Error('Las sugerencias no responden ahora mismo. Inténtalo luego.');
  }
  // Solo se guarda en caché una búsqueda completa: si algo falló, la próxima vez se reintenta.
  return nominatimFailures ? result : remember(key, result);
}

// ---------------------------------------------------------------------------
// Dirección de un punto y "¿dónde estamos?"
// ---------------------------------------------------------------------------
/** Dirección (y nombre, si es un local) de un punto. Nunca lanza salvo si se cancela. */
export async function reverseGeocode(lat, lng, { signal } = {}) {
  try {
    const json = await nominatim('reverse', { lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: '18', addressdetails: '1', extratags: '1' }, { signal, timeoutMs: 8000 });
    if (json?.error) throw new Error(json.error);
    const r = nominatimToResult(json);
    return { name: r.kind === 'food' || r.kind === 'shop' ? r.name : '', address: r.address || '', osm: r.kind === 'food' ? r.osm : '' };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  if (getSearchProvider() === 'photon') {
    try {
      const params = new URLSearchParams({ lat: lat.toFixed(6), lon: lng.toFixed(6), lang: 'default' });
      const json = await fetchJson(`${PHOTON}/reverse?${params}`, { signal, timeoutMs: 8000 });
      const first = json.features?.[0];
      if (first) {
        const r = photonFeatureToResult(first);
        return { name: r.kind === 'food' || r.kind === 'shop' ? r.name : '', address: r.address || '', osm: '' };
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      markPhotonDown(err);
    }
  }
  return { name: '', address: '', osm: '' };
}

/**
 * El restaurante en el que (probablemente) estáis: el más cercano a menos de `radius` metros.
 * Devuelve { name, address, osm, lat, lng } del local, o solo la dirección si no hay ninguno cerca.
 */
export async function findPlaceAt(lat, lng, { radius = 80, signal } = {}) {
  const here = { lat, lng };
  const box = viewbox(boxAround(here, 0.15));
  let nearest = null;
  try {
    for (const amenity of ['restaurant', 'fast_food']) {
      const list = await nominatim('search', { amenity, limit: '20', addressdetails: '1', extratags: '1', bounded: '1', viewbox: box }, { signal });
      for (const r of list.map(nominatimToResult)) {
        const d = distanceMeters(here, r);
        if (d <= radius && (!nearest || d < nearest.distance)) nearest = { ...r, distance: d };
      }
      if (nearest && nearest.distance < 30) break;
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  if (nearest) return { name: nearest.name, address: nearest.address, osm: nearest.osm, lat: nearest.lat, lng: nearest.lng, found: true };
  const r = await reverseGeocode(lat, lng, { signal });
  return { ...r, lat, lng, found: Boolean(r.name) };
}
