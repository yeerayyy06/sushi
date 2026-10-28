// Mapa (Leaflet): capas de teselas, marcadores de sitios, sugerencias y pin provisional.
/* global L */
import { escapeHtml } from './util.js';

const ATTR_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const ATTR_CARTO = `${ATTR_OSM}, &copy; <a href="https://carto.com/attribution/" target="_blank" rel="noopener">CARTO</a>`;

/**
 * Mapa base. Sin clave: teselas estándar de OpenStreetMap (política de uso: exactamente esta URL,
 * sin subdominios, sin caché offline; el modo oscuro se consigue con un filtro CSS).
 * Con clave de CARTO (gratis para uso personal): Voyager (claro) y Dark Matter (oscuro) en retina.
 */
function basemapFor(theme, cartoKey) {
  if (cartoKey) {
    const style = theme === 'dark' ? 'dark_all' : 'rastertiles/voyager';
    return {
      url: `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`,
      options: { subdomains: 'abcd', maxNativeZoom: 18, maxZoom: 20, attribution: ATTR_CARTO },
      cssFilter: false,
    };
  }
  return {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: ATTR_OSM },
    cssFilter: theme === 'dark',
  };
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   center: [number, number], zoom: number, theme: 'light'|'dark', cartoKey?: string,
 *   onPlaceClick?: (id: string) => void,
 *   onSuggestionClick?: (suggestion: object) => void,
 *   onLongPress?: (latlng: {lat:number,lng:number}) => void,
 *   onMapClick?: () => void,
 *   onMoveEnd?: (view: object) => void,
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
  });
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  let tileLayer = null;
  const placeLayer = L.layerGroup().addTo(map);
  const suggestionLayer = L.layerGroup().addTo(map);
  const markers = new Map(); // id -> { marker, signature }
  const suggestionMarkers = new Map();
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
  map.on('zoomend', () => container.classList.toggle('z-low', map.getZoom() < 12));

  // --- iconos: el número ES el marcador --------------------------------------
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
    const html = `<div class="pin pin--suggestion" role="img" aria-label="${escapeHtml(`Sugerencia: ${s.name}`)}" title="${escapeHtml(s.name)}"></div>`;
    return L.divIcon({ className: 'pin-wrap', html, iconSize: [24, 24], iconAnchor: [12, 12], tooltipAnchor: [0, -10] });
  }
  function draftIcon() {
    return L.divIcon({ className: 'pin-wrap', html: `<div class="pin pin--draft" aria-hidden="true">${TEARDROP}</div>`, iconSize: [26, 34], iconAnchor: [13, 34] });
  }
  function userIcon() {
    return L.divIcon({ className: 'pin-wrap', html: '<div class="user-dot" role="img" aria-label="Tu ubicación"><span></span></div>', iconSize: [28, 28], iconAnchor: [14, 14] });
  }

  // --- API -------------------------------------------------------------------
  function setTheme(theme) {
    const def = basemapFor(theme, opts.cartoKey);
    const old = tileLayer;
    tileLayer = L.tileLayer(def.url, { ...def.options }).addTo(map);
    tileLayer.on('tileerror', onTileError);
    if (old) {
      // la capa nueva se añade antes de quitar la vieja: sin parpadeo al cambiar de tema
      tileLayer.once('load', () => map.removeLayer(old));
      setTimeout(() => map.hasLayer(old) && map.removeLayer(old), 2500);
    }
    container.classList.toggle('map--dark-filter', def.cssFilter);
  }
  let tileErrors = 0;
  function onTileError() {
    tileErrors += 1;
    if (tileErrors === 12) opts.onTilesFailing?.();
  }

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

  function setSuggestions(list) {
    const ids = new Set(list.map((s) => s.id));
    for (const [id, marker] of suggestionMarkers) {
      if (!ids.has(id)) {
        suggestionLayer.removeLayer(marker);
        suggestionMarkers.delete(id);
      }
    }
    for (const s of list) {
      if (suggestionMarkers.has(s.id)) continue;
      const marker = L.marker([s.lat, s.lng], { icon: suggestionIcon(s), alt: s.name, zIndexOffset: -100 });
      marker.on('click', (e) => {
        L.DomEvent.stop(e);
        opts.onSuggestionClick?.(s);
      });
      marker.addTo(suggestionLayer);
      suggestionMarkers.set(s.id, marker);
    }
  }
  function clearSuggestions() {
    setSuggestions([]);
  }

  function setDraft(latlng) {
    if (draftMarker) {
      map.removeLayer(draftMarker);
      draftMarker = null;
    }
    if (latlng) {
      draftMarker = L.marker([latlng.lat, latlng.lng], { icon: draftIcon(), zIndexOffset: 2000, interactive: false }).addTo(map);
    }
  }

  function flyTo(latlng, zoom) {
    const target = [latlng.lat, latlng.lng];
    const z = zoom ?? Math.max(map.getZoom(), 15);
    map.flyTo(target, z, { duration: 0.6 });
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
  function fitPlaces(places, { padding = 48 } = {}) {
    if (!places.length) return;
    if (places.length === 1) {
      map.setView([places[0].lat, places[0].lng], 15);
      return;
    }
    const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [padding, padding], maxZoom: 16 });
  }
  function fitExtent(extent) {
    // Photon: [minLon, maxLat, maxLon, minLat]
    if (!extent || extent.length !== 4) return;
    map.fitBounds(L.latLngBounds([extent[3], extent[0]], [extent[1], extent[2]]), { maxZoom: 15 });
  }

  /** Coordenadas del punto del contenedor (px) — p. ej. el centro de la franja visible sobre la hoja. */
  function pointToLatLng(x, y) {
    const ll = map.containerPointToLatLng([x, y]);
    return { lat: ll.lat, lng: ll.lng };
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

  function locate({ fly = true } = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Este navegador no permite usar la ubicación.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (!userMarker) userMarker = L.marker(latlng, { icon: userIcon(), interactive: false, zIndexOffset: 500 }).addTo(map);
          else userMarker.setLatLng(latlng);
          if (fly) flyTo(latlng, Math.max(map.getZoom(), 15));
          resolve(latlng);
        },
        (err) => {
          const msg =
            err.code === err.PERMISSION_DENIED
              ? 'No tenemos permiso para usar tu ubicación.'
              : 'No se ha podido obtener tu ubicación.';
          reject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    });
  }

  function invalidate() {
    map.invalidateSize({ animate: false });
  }
  /** Animación corta (pop) en el marcador de un sitio, p. ej. tras sumar una visita. */
  function pop(id) {
    const el = markers.get(id)?.marker.getElement()?.querySelector('.pin');
    if (!el) return;
    el.classList.remove('is-pop');
    void el.offsetWidth; // reinicia la animación
    el.classList.add('is-pop');
    el.addEventListener('animationend', () => el.classList.remove('is-pop'), { once: true });
  }

  setTheme(opts.theme);

  // Leaflet 1.9 solo reacciona a window.resize; el panel inferior y el teclado cambian el tamaño sin ese evento.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(container);
  }

  return {
    leaflet: map,
    setTheme,
    setPlaces,
    select,
    setSuggestions,
    clearSuggestions,
    setDraft,
    flyTo,
    panTo,
    focus,
    fitPlaces,
    fitExtent,
    getView,
    pointToLatLng,
    locate,
    invalidate,
    pop,
  };
}
