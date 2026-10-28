// Mapa (Leaflet): mapa base, marcadores de sitios, casa, sugerencias y pin provisional.
/* global L */
import { escapeHtml } from './util.js';

const ATTR_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const OPENFREEMAP = 'https://tiles.openfreemap.org/styles';
const ATTR_OFM =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · datos &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const STYLE_TIMEOUT_MS = 12000;

/**
 * Estilos del mapa. Los vectoriales vienen de OpenFreeMap (gratis, sin clave) y se dibujan con MapLibre;
 * "clásico" son las teselas estándar de OpenStreetMap y es también el plan B si lo vectorial no carga.
 */
export const MAP_STYLES = {
  color: { label: 'Color', vector: `${OPENFREEMAP}/liberty` },
  suave: { label: 'Suave', vector: `${OPENFREEMAP}/positron` },
  noche: { label: 'Noche', vector: `${OPENFREEMAP}/dark` },
  clasico: { label: 'Clásico', vector: null },
};

const MAPLIBRE_FILES = {
  css: './lib/maplibre/maplibre-gl.css',
  js: ['./lib/maplibre/maplibre-gl.js', './lib/maplibre/leaflet-maplibre-gl.js'],
};
let maplibrePromise = null;

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`No se ha podido cargar ${src}`));
    document.head.appendChild(s);
  });
}

/** Carga MapLibre (≈1 MB) solo cuando hace falta. */
function ensureMapLibre() {
  if (!maplibrePromise) {
    maplibrePromise = (async () => {
      if (!webglAvailable()) throw new Error('Este navegador no tiene WebGL');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPLIBRE_FILES.css;
      document.head.appendChild(link);
      for (const src of MAPLIBRE_FILES.js) await loadScript(src);
      if (!window.maplibregl || !L.maplibreGL) throw new Error('MapLibre no se ha inicializado');
    })().catch((err) => {
      maplibrePromise = null;
      throw err;
    });
  }
  return maplibrePromise;
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   center: [number, number], zoom: number, style: string,
 *   onPlaceClick?: (id: string) => void,
 *   onSuggestionClick?: (suggestion: object) => void,
 *   onHomeClick?: () => void,
 *   onLongPress?: (latlng: {lat:number,lng:number}) => void,
 *   onMapClick?: () => void,
 *   onMoveEnd?: (view: object) => void,
 *   onStyleFallback?: () => void,
 *   onTilesFailing?: () => void,
 * }} opts
 */
export function createMap(container, opts) {
  const map = L.map(container, {
    center: opts.center,
    zoom: opts.zoom,
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 20,
  });
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  let rasterLayer = null;
  let glLayer = null;
  let styleKey = null;
  let styleToken = 0;
  const placeLayer = L.layerGroup().addTo(map);
  const suggestionLayer = L.layerGroup().addTo(map);
  const markers = new Map(); // id -> { marker, signature }
  const suggestionMarkers = new Map(); // id -> { marker, signature }
  let homeMarker = null;
  let draftMarker = null;
  let userMarker = null;
  let selectedId = null;
  let placesById = new Map();

  map.on('contextmenu', (e) => {
    L.DomEvent.stop(e.originalEvent || e);
    opts.onLongPress?.({ lat: e.latlng.lat, lng: e.latlng.lng });
  });
  map.on('click', () => opts.onMapClick?.());
  map.on('moveend zoomend', () => opts.onMoveEnd?.(getView()));
  map.on('zoomend', () => {
    container.classList.toggle('z-low', map.getZoom() < 12);
    container.classList.toggle('z-high', map.getZoom() >= 15);
  });

  // --- mapa base ----------------------------------------------------------------
  function addRaster() {
    if (rasterLayer) return;
    rasterLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 20, attribution: ATTR_OSM }).addTo(map);
    let errors = 0;
    rasterLayer.on('tileerror', () => {
      errors += 1;
      if (errors === 12) opts.onTilesFailing?.();
    });
  }
  function removeRaster() {
    if (rasterLayer) map.removeLayer(rasterLayer);
    rasterLayer = null;
  }
  function removeGl() {
    const layer = glLayer;
    glLayer = null;
    if (!layer) return;
    try {
      map.removeLayer(layer);
    } catch (err) {
      // Si MapLibre falló al crearse, la capa puede haber quedado a medias: quitamos sus eventos a mano.
      console.warn('Limpiando capa vectorial a medias:', err?.message || err);
      try {
        map.off(layer.getEvents(), layer);
      } catch {
        /* nada más que hacer */
      }
    }
  }

  /** Espera a que el estilo vectorial esté cargado (o falla tras STYLE_TIMEOUT_MS). */
  function waitForStyle(glMap) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        glMap.off('style.load', onLoad);
        reject(new Error('El mapa vectorial tarda demasiado'));
      }, STYLE_TIMEOUT_MS);
      function onLoad() {
        clearTimeout(timer);
        // un instante para que se pinten las primeras teselas antes de quitar el mapa de debajo
        const done = () => resolve();
        glMap.once('idle', done);
        setTimeout(done, 2500);
      }
      glMap.once('style.load', onLoad);
    });
  }

  /**
   * Cambia el estilo. El mapa clásico se queda debajo hasta que el nuevo estilo está listo,
   * así nunca se queda en blanco; si el vectorial no carga, se vuelve al clásico.
   */
  async function setStyle(key) {
    const def = MAP_STYLES[key] || MAP_STYLES.color;
    styleKey = MAP_STYLES[key] ? key : 'color';
    const token = ++styleToken;
    container.dataset.mapStyle = styleKey;
    addRaster();
    if (!def.vector) {
      removeGl();
      return styleKey;
    }
    try {
      await ensureMapLibre();
      if (token !== styleToken) return styleKey;
      let ready;
      if (glLayer) {
        const glMap = glLayer.getMaplibreMap();
        ready = waitForStyle(glMap);
        glMap.setStyle(def.vector);
      } else {
        const layer = L.maplibreGL({ style: def.vector, pane: 'tilePane', attributionControl: { customAttribution: ATTR_OFM } });
        glLayer = layer;
        layer.addTo(map); // puede lanzar si el navegador no deja crear el contexto WebGL
        ready = waitForStyle(layer.getMaplibreMap());
      }
      await ready;
      if (token === styleToken) removeRaster();
    } catch (err) {
      if (token !== styleToken) return styleKey;
      console.warn('Mapa vectorial no disponible, uso el clásico:', err?.message || err);
      removeGl();
      addRaster();
      styleKey = 'clasico';
      container.dataset.mapStyle = styleKey;
      opts.onStyleFallback?.();
    }
    return styleKey;
  }

  // --- iconos: el número ES el marcador -------------------------------------------
  const TEARDROP =
    '<svg viewBox="0 0 26 34" width="26" height="34" aria-hidden="true"><path d="M13 1C6.4 1 1 6.3 1 12.9c0 8.6 10.2 18.3 11.3 19.4a1 1 0 0 0 1.4 0C14.8 31.2 25 21.5 25 12.9 25 6.3 19.6 1 13 1z" fill="var(--accent)" stroke="var(--paper-2)" stroke-width="1.5"/><circle cx="13" cy="13" r="4" fill="var(--paper-2)"/></svg>';
  const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  function placeIcon(place, selected) {
    const count = place.visits.length;
    const visited = place.status === 'visited';
    const classes = ['pin', visited ? 'pin--visited' : 'pin--pending', count >= 5 ? 'pin--fav' : '', selected ? 'is-selected' : '']
      .filter(Boolean)
      .join(' ');
    const label = visited ? `Visitado: ${place.name}, ${count} visitas` : `Pendiente: ${place.name}`;
    const inner = visited ? `<span class="pin__count">${count > 99 ? '99+' : count || '·'}</span>` : '';
    const html = `<div class="${classes}" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(place.name)}">${inner}</div>`;
    return L.divIcon({ className: 'pin-wrap', html, iconSize: [36, 36], iconAnchor: [18, 18], tooltipAnchor: [0, -16] });
  }
  function suggestionIcon(s) {
    const tier = s.tier === 'other' ? 'pin--other' : 'pin--suggestion';
    const html = `<div class="pin ${tier}" role="img" aria-label="${escapeHtml(`Sugerencia: ${s.name}`)}" title="${escapeHtml(s.name)}"></div>`;
    return s.tier === 'other'
      ? L.divIcon({ className: 'pin-wrap', html, iconSize: [24, 24], iconAnchor: [12, 12], tooltipAnchor: [0, -8] })
      : L.divIcon({ className: 'pin-wrap', html, iconSize: [32, 32], iconAnchor: [16, 16], tooltipAnchor: [0, -12] });
  }
  function homeIcon() {
    return L.divIcon({ className: 'pin-wrap', html: '<div class="pin pin--home" role="img" aria-label="Nuestra casa"><span>🏠</span></div>', iconSize: [40, 40], iconAnchor: [20, 20], tooltipAnchor: [0, -18] });
  }
  function draftIcon() {
    return L.divIcon({ className: 'pin-wrap', html: `<div class="pin pin--draft" aria-hidden="true">${TEARDROP}</div>`, iconSize: [26, 34], iconAnchor: [13, 34] });
  }
  function userIcon() {
    return L.divIcon({ className: 'pin-wrap', html: '<div class="user-dot" role="img" aria-label="Estás aquí"><span></span></div>', iconSize: [28, 28], iconAnchor: [14, 14] });
  }

  // --- sitios ------------------------------------------------------------------------
  function signatureOf(place, selected) {
    return [place.status, place.visits.length, place.name, place.lat, place.lng, selected ? 1 : 0].join('|');
  }

  function setPlaces(places) {
    placesById = new Map(places.map((p) => [p.id, p]));
    for (const [id, entry] of markers) {
      if (!placesById.has(id)) {
        placeLayer.removeLayer(entry.marker);
        markers.delete(id);
      }
    }
    for (const place of places) {
      const selected = place.id === selectedId;
      const signature = signatureOf(place, selected);
      const entry = markers.get(place.id);
      if (entry && entry.signature === signature) continue;
      if (entry) {
        entry.marker.setLatLng([place.lat, place.lng]);
        if (!coarsePointer) entry.marker.setTooltipContent(escapeHtml(place.name));
        entry.marker.setIcon(placeIcon(place, selected));
        entry.marker.setZIndexOffset(selected ? 1000 : place.status === 'visited' ? 100 : 0);
        entry.signature = signature;
        continue;
      }
      const marker = L.marker([place.lat, place.lng], {
        icon: placeIcon(place, selected),
        riseOnHover: true,
        keyboard: true,
        alt: place.name,
        zIndexOffset: selected ? 1000 : place.status === 'visited' ? 100 : 0,
      });
      marker.on('click', (e) => {
        L.DomEvent.stop(e);
        opts.onPlaceClick?.(place.id);
      });
      if (!coarsePointer) marker.bindTooltip(escapeHtml(place.name), { direction: 'top', className: 'pin-tip', offset: [0, -4] });
      marker.addTo(placeLayer);
      markers.set(place.id, { marker, signature });
    }
  }

  function select(id) {
    if (selectedId === id) return;
    const prev = selectedId;
    selectedId = id;
    for (const pid of [prev, id]) {
      const place = pid && placesById.get(pid);
      const entry = pid && markers.get(pid);
      if (place && entry) {
        const selected = pid === selectedId;
        entry.marker.setIcon(placeIcon(place, selected));
        entry.marker.setZIndexOffset(selected ? 1000 : place.status === 'visited' ? 100 : 0);
        entry.signature = signatureOf(place, selected);
      }
    }
  }

  // --- casa ------------------------------------------------------------------------------
  function setHome(home) {
    if (!home) {
      if (homeMarker) map.removeLayer(homeMarker);
      homeMarker = null;
      return;
    }
    if (homeMarker) {
      homeMarker.setLatLng([home.lat, home.lng]);
      return;
    }
    homeMarker = L.marker([home.lat, home.lng], { icon: homeIcon(), zIndexOffset: 400, alt: 'Nuestra casa', keyboard: true });
    homeMarker.on('click', (e) => {
      L.DomEvent.stop(e);
      opts.onHomeClick?.();
    });
    homeMarker.bindTooltip('Nuestra casa', { direction: 'top', className: 'pin-tip', offset: [0, -4] });
    homeMarker.addTo(map);
  }

  // --- sugerencias -------------------------------------------------------------------------
  function setSuggestions(list) {
    const ids = new Set(list.map((s) => s.id));
    for (const [id, entry] of suggestionMarkers) {
      if (!ids.has(id)) {
        suggestionLayer.removeLayer(entry.marker);
        suggestionMarkers.delete(id);
      }
    }
    const labelled = list.filter((s) => s.tier !== 'other').length <= 30;
    for (const s of list) {
      const signature = `${s.tier}|${s.name}`;
      const existing = suggestionMarkers.get(s.id);
      if (existing && existing.signature === signature) continue;
      if (existing) suggestionLayer.removeLayer(existing.marker);
      const marker = L.marker([s.lat, s.lng], { icon: suggestionIcon(s), alt: s.name, zIndexOffset: s.tier === 'other' ? -200 : -100 });
      marker.on('click', (e) => {
        L.DomEvent.stop(e);
        opts.onSuggestionClick?.(s);
      });
      if (s.tier !== 'other' && labelled) {
        marker.bindTooltip(escapeHtml(s.name), { permanent: true, direction: 'right', className: 'sugg-label', offset: [10, 0] });
      } else if (!coarsePointer) {
        marker.bindTooltip(escapeHtml(s.name), { direction: 'top', className: 'pin-tip', offset: [0, -4] });
      }
      marker.addTo(suggestionLayer);
      suggestionMarkers.set(s.id, { marker, signature });
    }
  }
  function clearSuggestions() {
    setSuggestions([]);
  }

  // --- pin provisional y ubicación ------------------------------------------------------------
  function setDraft(latlng) {
    if (draftMarker) {
      map.removeLayer(draftMarker);
      draftMarker = null;
    }
    if (latlng) {
      draftMarker = L.marker([latlng.lat, latlng.lng], { icon: draftIcon(), zIndexOffset: 2000, interactive: false }).addTo(map);
    }
  }

  function showUser(latlng) {
    if (!userMarker) userMarker = L.marker(latlng, { icon: userIcon(), interactive: false, zIndexOffset: 500 }).addTo(map);
    else userMarker.setLatLng(latlng);
  }

  /** Posición GPS. Con fly=true, además centra el mapa ahí. */
  function locate({ fly = true } = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Este navegador no permite usar la ubicación.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          showUser(latlng);
          if (fly) flyTo(latlng, Math.max(map.getZoom(), 16));
          resolve(latlng);
        },
        (err) => {
          const msg =
            err.code === err.PERMISSION_DENIED
              ? 'No tenemos permiso para usar tu ubicación. Actívalo en los ajustes del navegador.'
              : 'No se ha podido obtener tu ubicación.';
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
      );
    });
  }

  // --- vista ----------------------------------------------------------------------------
  function flyTo(latlng, zoom) {
    map.flyTo([latlng.lat, latlng.lng], zoom ?? Math.max(map.getZoom(), 15), { duration: 0.6 });
  }
  function panTo(latlng) {
    map.panTo([latlng.lat, latlng.lng], { animate: true });
  }
  /** Centra un punto dejando sitio para el panel inferior (offsetY en px, positivo = el punto sube). */
  function focus(latlng, { offsetY = 0, zoom } = {}) {
    const z = zoom ?? Math.max(map.getZoom(), 15);
    const point = map.project([latlng.lat, latlng.lng], z).add([0, offsetY]);
    map.flyTo(map.unproject(point, z), z, { duration: 0.5 });
  }
  function fitPoints(points, { padding = 56, maxZoom = 16, paddingBottom = 0 } = {}) {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], Math.min(maxZoom, 16));
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { paddingTopLeft: [padding, padding + 40], paddingBottomRight: [padding, padding + paddingBottom], maxZoom });
  }
  function fitExtent(extent) {
    // [minLon, maxLat, maxLon, minLat]
    if (!extent || extent.length !== 4) return;
    map.fitBounds(L.latLngBounds([extent[3], extent[0]], [extent[1], extent[2]]), { maxZoom: 15 });
  }
  function getView() {
    const c = map.getCenter();
    const b = map.getBounds();
    return {
      center: { lat: c.lat, lng: c.lng },
      zoom: map.getZoom(),
      bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
    };
  }
  /** Coordenadas del punto del contenedor (px) — p. ej. el centro de la franja visible sobre la hoja. */
  function pointToLatLng(x, y) {
    const ll = map.containerPointToLatLng([x, y]);
    return { lat: ll.lat, lng: ll.lng };
  }
  function invalidate() {
    map.invalidateSize({ animate: false });
  }
  /** Animación corta (pop) en el marcador de un sitio, p. ej. tras sumar una visita. */
  function pop(id) {
    const el = markers.get(id)?.marker.getElement()?.querySelector('.pin');
    if (!el) return;
    el.classList.remove('is-pop');
    void el.offsetWidth;
    el.classList.add('is-pop');
    el.addEventListener('animationend', () => el.classList.remove('is-pop'), { once: true });
  }

  // Leaflet 1.9 solo reacciona a window.resize; el panel inferior y el teclado cambian el tamaño sin ese evento.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(container);
  }

  return {
    leaflet: map,
    setStyle,
    getStyle: () => styleKey,
    setPlaces,
    select,
    setHome,
    setSuggestions,
    clearSuggestions,
    setDraft,
    showUser,
    flyTo,
    panTo,
    focus,
    fitPoints,
    fitExtent,
    getView,
    pointToLatLng,
    locate,
    invalidate,
    pop,
  };
}
