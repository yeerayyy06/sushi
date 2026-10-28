// Capa de datos. Misma interfaz para Firestore (modo real) y localStorage (modo demo).
//
//   const store = await createStore();
//   store.subscribe(places => ...);          // se llama con la lista completa en cada cambio
//   const id = store.add(place).id;          // devuelve el id al instante; .done es la promesa de escritura
//   store.update(id, patch) / store.addVisit(id, visit) / store.removeVisit(id, visit)
//   store.setVisits(id, visits) / store.remove(id)
//
// Las escrituras devuelven promesas pero no hace falta esperarlas para pintar la UI:
// la suscripción recibe el cambio de inmediato (también sin conexión; se sincroniza después).

import { getFirebase, hasFirebaseConfig } from './firebase.js';
import { isValidISODate, isValidLatLng, randomId } from './util.js';

export const STATUS = Object.freeze({ VISITED: 'visited', PENDING: 'pending' });
export const LIMITS = Object.freeze({ name: 120, address: 300, notes: 2000, visitNote: 300, visits: 500 });
const COLLECTION = 'places';

// ---------------------------------------------------------------------------
// Validación (espejo de firestore.rules). Lanza Error con mensaje en español.
// ---------------------------------------------------------------------------
function cleanText(value, max, label, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`Falta ${label}.`);
  if (text.length > max) throw new Error(`${label} es demasiado largo (máx. ${max} caracteres).`);
  return text;
}

export function sanitizeVisit(input = {}) {
  const date = String(input.date ?? '').trim();
  if (!isValidISODate(date)) throw new Error('La fecha no es válida.');
  const note = cleanText(input.note, LIMITS.visitNote, 'La nota');
  const id = typeof input.id === 'string' && input.id ? input.id.slice(0, 40) : randomId();
  return { id, date, note };
}

/** Devuelve un objeto limpio listo para guardar. Con partial=true solo valida los campos presentes. */
export function sanitizePlace(input = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(input, k);

  if (has('name')) out.name = cleanText(input.name, LIMITS.name, 'el nombre', { required: true });
  if (has('address')) out.address = cleanText(input.address, LIMITS.address, 'La dirección');
  if (has('notes')) out.notes = cleanText(input.notes, LIMITS.notes, 'Las notas');
  if (has('lat') || has('lng')) {
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    if (!isValidLatLng(lat, lng)) throw new Error('Las coordenadas no son válidas.');
    out.lat = lat;
    out.lng = lng;
  }
  if (has('status')) {
    if (!Object.values(STATUS).includes(input.status)) throw new Error('Estado no válido.');
    out.status = input.status;
  }
  if (has('rating')) {
    const r = input.rating == null || input.rating === '' ? 0 : Number(input.rating);
    if (!Number.isInteger(r) || r < 0 || r > 5) throw new Error('La puntuación debe ser de 0 a 5.');
    out.rating = r;
  }
  if (has('visits')) {
    if (!Array.isArray(input.visits)) throw new Error('Las visitas no son válidas.');
    if (input.visits.length > LIMITS.visits) throw new Error('Demasiadas visitas.');
    out.visits = input.visits.map(sanitizeVisit);
  }
  if (has('osm')) {
    out.osm = input.osm ? cleanText(input.osm, 60, 'La referencia OSM') : '';
  }

  if (!partial) {
    out.address ??= '';
    out.notes ??= '';
    out.status ??= STATUS.PENDING;
    out.rating ??= 0;
    out.visits ??= [];
    out.osm ??= '';
    if (out.visits.length && out.status !== STATUS.VISITED) out.status = STATUS.VISITED;
  }
  return out;
}

/** Normaliza un documento que viene de la base de datos (tolerante a datos raros). */
function fromDb(id, d = {}) {
  const visits = (Array.isArray(d.visits) ? d.visits : [])
    .filter((v) => v && isValidISODate(v.date))
    .map((v) => ({ id: String(v.id || randomId()), date: v.date, note: String(v.note ?? '') }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const toMs = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : Number(t) || 0);
  return {
    id,
    name: String(d.name ?? 'Sin nombre'),
    address: String(d.address ?? ''),
    notes: String(d.notes ?? ''),
    lat: Number(d.lat),
    lng: Number(d.lng),
    status: d.status === STATUS.VISITED || visits.length ? STATUS.VISITED : STATUS.PENDING,
    rating: Number.isInteger(d.rating) ? Math.min(5, Math.max(0, d.rating)) : 0,
    visits,
    osm: String(d.osm ?? ''),
    createdAt: toMs(d.createdAt),
    updatedAt: toMs(d.updatedAt),
  };
}

const byNewest = (a, b) => b.createdAt - a.createdAt;

// ---------------------------------------------------------------------------
export async function createStore() {
  return hasFirebaseConfig() ? createFirestoreStore() : createLocalStore();
}

// ---------------------------------------------------------------------------
async function createFirestoreStore() {
  const { app, firestoreMod: F } = await getFirebase();
  let db;
  try {
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn('Firestore sin caché persistente:', err);
    db = F.getFirestore(app);
  }
  const col = F.collection(db, COLLECTION);
  const stamp = () => F.serverTimestamp();
  const toPlace = (snap) => fromDb(snap.id, snap.data({ serverTimestamps: 'estimate' }));

  return {
    mode: 'firebase',
    subscribe(onData, onError) {
      return F.onSnapshot(
        col,
        (qs) => onData(qs.docs.map(toPlace).filter((p) => isValidLatLng(p.lat, p.lng)).sort(byNewest)),
        (err) => onError?.(new Error(describeDbError(err)), err),
      );
    },
    add(input) {
      const data = sanitizePlace(input);
      const ref = F.doc(col);
      const done = F.setDoc(ref, { ...data, createdAt: stamp(), updatedAt: stamp() }).catch(rethrow);
      return { id: ref.id, done };
    },
    async update(id, patch) {
      const data = sanitizePlace(patch, { partial: true });
      return F.updateDoc(F.doc(col, id), { ...data, updatedAt: stamp() }).catch(rethrow);
    },
    async addVisit(id, visit) {
      const v = sanitizeVisit(visit);
      return F.updateDoc(F.doc(col, id), {
        visits: F.arrayUnion(v),
        status: STATUS.VISITED,
        updatedAt: stamp(),
      }).catch(rethrow);
    },
    async removeVisit(id, visit) {
      const v = { id: visit.id, date: visit.date, note: visit.note ?? '' };
      return F.updateDoc(F.doc(col, id), { visits: F.arrayRemove(v), updatedAt: stamp() }).catch(rethrow);
    },
    async setVisits(id, visits) {
      const clean = sanitizePlace({ visits }, { partial: true }).visits;
      return F.updateDoc(F.doc(col, id), { visits: clean, updatedAt: stamp() }).catch(rethrow);
    },
    async remove(id) {
      return F.deleteDoc(F.doc(col, id)).catch(rethrow);
    },
  };

  function rethrow(err) {
    throw new Error(describeDbError(err));
  }
}

function describeDbError(err) {
  const code = err?.code || '';
  switch (code) {
    case 'permission-denied':
      return 'Sin permiso para guardar. Revisa que has iniciado sesión y las reglas de Firestore.';
    case 'unavailable':
      return 'No hay conexión con la base de datos. Se reintentará cuando vuelva internet.';
    case 'unauthenticated':
      return 'Tu sesión ha caducado. Vuelve a entrar.';
    case 'resource-exhausted':
      return 'Se ha superado el límite gratuito de Firestore por hoy. Mañana volverá a funcionar.';
    case 'not-found':
      return 'Ese sitio ya no existe.';
    default:
      return `Error de la base de datos (${code || err?.message || 'desconocido'}).`;
  }
}

// ---------------------------------------------------------------------------
function createLocalStore() {
  const KEY = 'sushimap:places';
  const listeners = new Set();
  let places = load();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return (Array.isArray(raw) ? raw : [])
        .map((p) => fromDb(String(p.id || randomId()), p))
        .filter((p) => isValidLatLng(p.lat, p.lng));
    } catch {
      return [];
    }
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(places));
    } catch (err) {
      throw new Error('No se ha podido guardar en este navegador (¿navegación privada o sin espacio?).');
    }
    emit();
  }
  function emit() {
    // Copias nuevas en cada aviso: la app nunca comparte objetos con el almacén.
    const snapshot = places.map((p) => fromDb(p.id, p)).sort(byNewest);
    listeners.forEach((cb) => cb(snapshot));
  }
  function find(id) {
    const p = places.find((x) => x.id === id);
    if (!p) throw new Error('Ese sitio ya no existe.');
    return p;
  }
  const settled = (fn) => {
    try {
      fn();
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  };

  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      places = load();
      emit();
    }
  });

  return {
    mode: 'demo',
    subscribe(onData) {
      listeners.add(onData);
      queueMicrotask(() => onData(places.map((p) => fromDb(p.id, p)).sort(byNewest)));
      return () => listeners.delete(onData);
    },
    add(input) {
      const data = sanitizePlace(input);
      const now = Date.now();
      const id = randomId();
      const done = settled(() => {
        places.push(fromDb(id, { ...data, createdAt: now, updatedAt: now }));
        persist();
      });
      return { id, done };
    },
    update(id, patch) {
      return settled(() => {
        const data = sanitizePlace(patch, { partial: true });
        const p = find(id);
        Object.assign(p, fromDb(id, { ...p, ...data, updatedAt: Date.now() }));
        persist();
      });
    },
    addVisit(id, visit) {
      return settled(() => {
        const p = find(id);
        const v = sanitizeVisit(visit);
        Object.assign(p, fromDb(id, { ...p, visits: [...p.visits, v], status: STATUS.VISITED, updatedAt: Date.now() }));
        persist();
      });
    },
    removeVisit(id, visit) {
      return settled(() => {
        const p = find(id);
        const visits = p.visits.filter((v) => v.id !== visit.id);
        Object.assign(p, fromDb(id, { ...p, visits, status: visits.length ? p.status : STATUS.VISITED, updatedAt: Date.now() }));
        persist();
      });
    },
    setVisits(id, visits) {
      return settled(() => {
        const p = find(id);
        const clean = sanitizePlace({ visits }, { partial: true }).visits;
        Object.assign(p, fromDb(id, { ...p, visits: clean, updatedAt: Date.now() }));
        persist();
      });
    },
    remove(id) {
      return settled(() => {
        places = places.filter((p) => p.id !== id);
        persist();
      });
    },
  };
}
