// Pequeñas utilidades compartidas. Sin dependencias.

/** Escapa texto para insertarlo en HTML (nunca metas texto de usuario/OSM sin pasar por aquí). */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Devuelve una función que espera `ms` sin nuevas llamadas antes de ejecutar `fn`. */
export function debounce(fn, ms) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/** Fecha local de hoy como 'YYYY-MM-DD' (sin sorpresas de zona horaria). */
export function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida una fecha 'YYYY-MM-DD' real (no 2024-02-31). */
export function isValidISODate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

const longDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

/** '2025-03-08' -> '8 de marzo de 2025' */
export function formatDate(iso, { short = false } = {}) {
  if (!isValidISODate(iso)) return iso ?? '';
  const [y, m, d] = iso.split('-').map(Number);
  return (short ? shortDate : longDate).format(new Date(y, m - 1, d));
}

const weekdayDate = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const weekdayDateYear = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** '2025-03-08' -> 'sáb 8 mar' (con año si no es el actual: 'sáb 8 mar 2024'). */
export function formatShort(iso) {
  if (!isValidISODate(iso)) return iso ?? '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const fmt = y === new Date().getFullYear() ? weekdayDate : weekdayDateYear;
  return fmt.format(date).replace(/,/g, '').replace(/\./g, '');
}

/** Texto relativo sencillo: 'hoy', 'ayer', 'hace 3 días', 'hace 2 meses'... */
export function relativeDate(iso) {
  if (!isValidISODate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((start - then) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
  const years = Math.round(days / 365);
  return years === 1 ? 'hace 1 año' : `hace ${years} años`;
}

/** Distancia en metros entre dos coordenadas (haversine). */
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/** Comprueba que lat/lng son números dentro de rango. */
export function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Recorta un texto a `max` caracteres (con puntos suspensivos). */
export function truncate(text, max = 80) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Normaliza texto para comparar/buscar: minúsculas y sin acentos. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Plural rápido: plural(1, 'visita', 'visitas') -> '1 visita'. */
export function plural(n, singular, pluralWord) {
  return `${n} ${n === 1 ? singular : pluralWord}`;
}

/** Identificador aleatorio corto para el modo demo. */
export function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

/** fetch con tiempo máximo. Lanza si hay timeout o fallo de red. */
export async function fetchWithTimeout(url, { timeoutMs = 10000, signal, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function isAbortError(err) {
  return err?.name === 'AbortError';
}
