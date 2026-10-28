// Arranque y lógica de la aplicación: une sesión, datos, mapa, búsqueda e interfaz.
import { CONFIG } from './config.js';
import { createAuth } from './auth.js';
import { createStore, STATUS } from './store.js';
import { createMap } from './map.js';
import { createUI } from './ui.js';
import { searchPlaces, discoverSushi, reverseGeocode, getSearchProvider } from './search.js';
import { todayISO, normalize, distanceMeters, plural, isAbortError, isValidLatLng, randomId, debounce } from './util.js';

const VIEW_KEY = 'sushimap:view';
const TAB_KEY = 'sushimap:tab';
const WELCOME_KEY = 'sushimap:welcomed';
const DUPLICATE_METERS = 30;
const MILESTONES = {
  10: '10 visitas. Esto empieza a ser una costumbre.',
  25: '25 visitas. Ya somos de la casa.',
  50: '50 visitas. Habría que ponernos una placa.',
  100: '100 visitas. Oficialmente, un club de dos.',
};

const state = {
  places: [],
  visited: [],
  pending: [],
  tab: readLocal(TAB_KEY) === 'pending' ? 'pending' : 'visited',
  selectedId: null,
  favId: null,
  totalVisits: null, // null hasta el primer snapshot
  candidate: null,
  suggestions: [],
  crosshair: null, // { mode: 'new' } | { mode: 'move', id }
  pendingOpenId: null,
  highlightVisitId: null,
  returnSheet: 'peek', // estado de la hoja antes de abrir una ficha o un candidato
  ignorePop: 0, // popstate provocados por nosotros mismos (history.back) que no hay que tratar
  searchAbort: null,
  nearbyAbort: null,
  reverseAbort: null,
  started: false,
  bye: null,
  online: navigator.onLine,
  firstFit: false,
};

let auth = null;
let store = null;
let map = null;
let unsubscribe = null;

const ui = createUI({
  appTitle: CONFIG.title,
  onLogin: login,
  onThemeApplied: (theme) => map?.setTheme(theme),
  onSearchInput: onSearchInput,
  onSearchSubmit: (q) => runSearch(q),
  onSearchClear: () => {
    debouncedSearch.cancel();
    abort('searchAbort');
  },
  onSearchAction: () => enterCrosshair({ mode: 'new' }),
  onResultPick: onResultPick,
  onMenuAction: onMenuAction,
  onImportFile: importFile,
  onNearby: findNearby,
  onClearSuggestions: clearSuggestions,
  onLocate: locate,
  onCrosshairConfirm: confirmCrosshair,
  onCrosshairCancel: () => exitCrosshair({ cancelled: true }),
  onEscape: () => {
    if (state.crosshair) exitCrosshair({ cancelled: true });
    else if (state.candidate) cancelCandidate();
    else if (state.selectedId) closeDetail();
  },
  onTabChange: (tab) => {
    state.tab = tab;
    writeLocal(TAB_KEY, tab);
    renderList();
  },
  onRowClick: (id) => openPlace(id),
  onRowPlus: (id) => {
    const place = placeById(id);
    if (place) addVisitTo(place);
  },
  onEmptyAction: () => enterCrosshair({ mode: 'new' }),
  onDetailBack: () => closeDetail(),
  onDetailEdit: editPlace,
  onDetailMove: movePlace,
  onPlus: () => {
    const place = placeById(state.selectedId);
    if (place) addVisitTo(place);
  },
  onPlusWithDate: addVisitWithDate,
  onRating: setRating,
  onVisitTap: editVisit,
  onNotesChange: saveNotes,
  onDelete: deletePlace,
  onNewCancel: () => cancelCandidate(),
  onNewSave: saveCandidate,
  onNewDupeOpen: () => {
    const dupe = state.candidate && findDuplicate(state.candidate, { strict: false });
    if (dupe) {
      cancelCandidate({ silent: true, keepHistory: true });
      openPlace(dupe.id, { keepReturn: true });
    }
  },
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
async function boot() {
  ui.setThemePref(ui.getThemePref());
  ui.setBranding({ title: CONFIG.title, initials: CONFIG.initials });
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  ui.setOnline(navigator.onLine);
  history.replaceState({ overlay: false }, '');
  window.addEventListener('popstate', onPopState);

  try {
    auth = await createAuth();
  } catch (err) {
    console.error(err);
    ui.setSplashText(
      err?.code === 'no-config' ? err.message : 'No se ha podido cargar Firebase. Revisa la conexión y recarga la página.',
      { static: true },
    );
    return;
  }
  auth.onChange((user) => {
    if (user) enterApp().catch(fatal);
    else showLogin();
  });
}

function fatal(err) {
  console.error(err);
  ui.toast(err?.message || 'Algo ha fallado.', { duration: 8000 });
}

function showLogin() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  state.places = [];
  state.selectedId = null;
  state.candidate = null;
  state.crosshair = null;
  state.totalVisits = null;
  if (map) {
    map.setPlaces([]);
    map.setDraft(null);
    clearSuggestions();
  }
  ui.setCrosshair({ on: false });
  ui.showLogin({
    title: CONFIG.title,
    subtitle: CONFIG.subtitle,
    demo: auth.mode === 'demo',
    dedication: CONFIG.dedication,
    username: CONFIG.sharedEmail || 'sushi',
    bye: state.bye,
  });
  state.bye = null;
}

async function login(password) {
  if (!password) {
    ui.setLoginError('Escribe la contraseña.');
    return;
  }
  ui.setLoginBusy(true);
  try {
    await auth.signIn(password);
    // auth.onChange se encarga de entrar
  } catch (err) {
    ui.setLoginError(err.message || 'No se ha podido entrar.');
  } finally {
    ui.setLoginBusy(false);
  }
}

async function enterApp() {
  ui.showApp();
  if (!store) store = await createStore();
  if (!map) {
    const saved = loadSavedView();
    map = createMap(document.getElementById('map'), {
      center: saved ? [saved.lat, saved.lng] : CONFIG.defaultCenter,
      zoom: saved ? saved.zoom : CONFIG.defaultZoom,
      theme: ui.getTheme(),
      cartoKey: CONFIG.cartoKey,
      onPlaceClick: (id) => openPlace(id),
      onSuggestionClick: (s) => startCandidate({ ...s, source: 'suggestion' }),
      onLongPress: (latlng) => {
        if (!state.crosshair) startCandidate({ ...latlng, name: '', address: '', needsReverse: true });
      },
      onMapClick: onMapClick,
      onMoveEnd: onMoveEnd,
      onTilesFailing: () => ui.toast('El mapa no carga. La lista sigue funcionando.'),
    });
    state.firstFit = !saved;
  } else {
    map.invalidate();
  }
  const demo = auth.mode === 'demo';
  ui.setMenuFooter(`${CONFIG.dedication || CONFIG.title}${demo ? ' · Modo demo' : ''}`);
  ui.setDemoChip(demo);
  ui.showView('list');
  ui.setSheet('peek');
  if (!unsubscribe) {
    unsubscribe = store.subscribe(onPlaces, (err) => reportError(err, { duration: 15000 }));
  }
  state.started = true;
  if (demo) window.__sushi = { state, map, ui, store }; // solo en modo demo: facilita las pruebas
  showWelcomeOnce();
}

function showWelcomeOnce() {
  const text = String(CONFIG.welcome || '').trim();
  if (!text || readLocal(WELCOME_KEY)) return;
  writeLocal(WELCOME_KEY, '1');
  ui.confirm({ title: 'Para ti', text, ok: 'Vamos', cancel: null });
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------
function onPlaces(places) {
  state.places = places;
  const lastVisit = (p) => p.visits[0]?.date || '';
  state.visited = places
    .filter((p) => p.status === STATUS.VISITED)
    .sort((a, b) => (lastVisit(a) < lastVisit(b) ? 1 : lastVisit(a) > lastVisit(b) ? -1 : a.name.localeCompare(b.name, 'es')));
  state.pending = places.filter((p) => p.status === STATUS.PENDING).sort((a, b) => b.createdAt - a.createdAt);

  const total = places.reduce((n, p) => n + p.visits.length, 0);
  let top = null;
  for (const p of state.visited) {
    if (p.visits.length >= 3 && (!top || p.visits.length > top.visits.length || (p.visits.length === top.visits.length && p.createdAt < top.createdAt))) top = p;
  }
  state.favId = top ? top.id : null;
  let sinceYear = null;
  for (const p of places) {
    for (const v of p.visits) {
      const y = Number(v.date.slice(0, 4));
      if (!sinceYear || y < sinceYear) sinceYear = y;
    }
  }

  map.setPlaces(places);
  ui.renderStats({ places: places.length, visits: total, sinceYear });
  renderList();

  if (state.selectedId) {
    const place = places.find((p) => p.id === state.selectedId);
    if (place) {
      ui.renderDetail(place, { isFav: place.id === state.favId, highlightVisitId: state.highlightVisitId });
    } else {
      closeDetail({ silent: true });
      ui.toast('Ese sitio ya no existe.');
    }
  }
  if (state.pendingOpenId && places.some((p) => p.id === state.pendingOpenId)) {
    const id = state.pendingOpenId;
    state.pendingOpenId = null;
    openPlace(id, { fly: false, keepReturn: true });
  }
  if (state.firstFit && places.length) {
    state.firstFit = false;
    map.fitPlaces(places);
  }
  if (state.totalVisits == null) showMemoryOnce(places);
  state.totalVisits = total;
}

function showMemoryOnce(places) {
  const today = todayISO();
  const key = `sushimap:memory:${today}`;
  if (readLocal(key)) return;
  const year = Number(today.slice(0, 4));
  const monthDay = today.slice(5);
  let best = null;
  for (const p of places) {
    for (const v of p.visits) {
      const y = Number(v.date.slice(0, 4));
      if (v.date.slice(5) === monthDay && y < year && (!best || y > best.year)) best = { year: y, name: p.name };
    }
  }
  if (!best) return;
  writeLocal(key, '1');
  const k = year - best.year;
  setTimeout(() => ui.toast(`Tal día como hoy, hace ${k} ${k === 1 ? 'año' : 'años'}, estuvimos en ${best.name}.`, { duration: 7000 }), 1200);
}

function renderList() {
  ui.renderList({ visited: state.visited, pending: state.pending, tab: state.tab, selectedId: state.selectedId, favId: state.favId });
}

function placeById(id) {
  return state.places.find((p) => p.id === id) || null;
}

function reportError(err, { duration } = {}) {
  console.error(err);
  const message = err?.message || 'No se ha podido guardar.';
  const session = /caducado|sesión/i.test(message);
  ui.toast(message, {
    duration: duration ?? 7000,
    action: session ? 'Entrar' : undefined,
    onAction: session ? () => auth.signOut().catch(console.error) : undefined,
  });
}

function setOnline(online) {
  if (online === state.online) return;
  state.online = online;
  ui.setOnline(online);
  if (state.started) ui.toast(online ? 'De vuelta en línea.' : 'Sin conexión. Se guardará cuando vuelva la red.');
}

// ---------------------------------------------------------------------------
// Ficha de un sitio
// ---------------------------------------------------------------------------
function focusOffset() {
  return ui.isDesktop() ? 0 : Math.round(window.innerHeight * 0.26);
}

function openPlace(id, { fly = true, keepReturn = false } = {}) {
  const place = placeById(id);
  if (!place) return;
  if (state.candidate) cancelCandidate({ silent: true, keepHistory: true });
  else if (!state.selectedId && !keepReturn) state.returnSheet = ui.getSheet();
  state.selectedId = id;
  map.select(id);
  ui.renderDetail(place, { isFav: id === state.favId, highlightVisitId: state.highlightVisitId });
  ui.showView('detail');
  ui.setSheet('half');
  ui.hideResults();
  renderList();
  if (fly) map.focus(place, { offsetY: focusOffset() });
  pushOverlay();
}

function closeDetail({ silent = false, fromHistory = false, keepHistory = false } = {}) {
  if (!fromHistory && !keepHistory) popOverlay();
  state.selectedId = null;
  state.highlightVisitId = null;
  map.select(null);
  ui.showView('list');
  if (!silent) ui.setSheet(state.returnSheet === 'full' ? 'full' : state.returnSheet === 'half' ? 'half' : 'peek');
  renderList();
}

function addVisitTo(place, { date = todayISO(), note = '' } = {}) {
  const visit = { id: randomId(), date, note };
  const wasPending = place.status === STATUS.PENDING;
  const n = place.visits.length + 1; // antes de escribir: el almacén local actualiza al instante
  const total = (state.totalVisits ?? 0) + 1;
  store.addVisit(place.id, visit).catch(reportError);
  state.highlightVisitId = visit.id;
  ui.guardDoubleTap();
  if (state.selectedId === place.id) ui.popCounter();
  setTimeout(() => map.pop(place.id), 60);
  navigator.vibrate?.(8);

  const text = MILESTONES[total] || (wasPending ? '¡Por fin! Primera visita apuntada.' : `Visita apuntada · ×${n}`);
  ui.toast(text, {
    action: 'Deshacer',
    onAction: () => {
      store.removeVisit(place.id, visit).catch(reportError);
      if (wasPending) store.update(place.id, { status: STATUS.PENDING }).catch(reportError);
    },
  });
}

async function addVisitWithDate() {
  const place = placeById(state.selectedId);
  if (!place) return;
  const value = await ui.visitDialog({ title: 'Nueva visita' });
  if (!value || value.remove) return;
  addVisitTo(place, value);
}

async function editVisit(visitId) {
  const place = placeById(state.selectedId);
  const visit = place?.visits.find((v) => v.id === visitId);
  if (!visit) return;
  const value = await ui.visitDialog({ title: 'Visita', date: visit.date, note: visit.note, canRemove: true });
  if (!value) return;
  if (value.remove) {
    removeVisitFrom(place, visit);
    return;
  }
  const visits = place.visits.map((v) => (v.id === visitId ? { ...v, ...value } : v));
  store.setVisits(place.id, visits).catch(reportError);
}

function removeVisitFrom(place, visit) {
  if (place.visits.length <= 1) {
    store.update(place.id, { visits: [], status: STATUS.PENDING }).catch(reportError);
    ui.toast('Sin visitas: vuelve a pendientes.', {
      action: 'Deshacer',
      onAction: () => store.addVisit(place.id, visit).catch(reportError),
    });
    return;
  }
  store.removeVisit(place.id, visit).catch(reportError);
  ui.toast('Visita quitada.', { action: 'Deshacer', onAction: () => store.addVisit(place.id, visit).catch(reportError) });
}

function setRating(n) {
  const place = placeById(state.selectedId);
  if (!place) return;
  store.update(place.id, { rating: place.rating === n ? 0 : n }).catch(reportError);
}

function saveNotes(text) {
  const place = placeById(state.selectedId);
  if (!place) return;
  const notes = text.trim();
  if (notes === (place.notes || '')) return;
  store.update(place.id, { notes }).catch(reportError);
  ui.setNotesSaved();
}

async function editPlace() {
  const place = placeById(state.selectedId);
  if (!place) return;
  const value = await ui.editDialog({ name: place.name, address: place.address });
  if (!value) return;
  store.update(place.id, value).catch(reportError);
  ui.toast('Guardado.');
}

function movePlace() {
  const place = placeById(state.selectedId);
  if (!place) return;
  enterCrosshair({ mode: 'move', id: place.id });
}

async function deletePlace() {
  const place = placeById(state.selectedId);
  if (!place) return;
  const pending = place.status === STATUS.PENDING;
  const ok = await ui.confirm({
    title: pending ? `¿Quitar ${place.name} de pendientes?` : `¿Eliminar ${place.name}?`,
    text: pending ? '' : `Se borran sus ${plural(place.visits.length, 'visita', 'visitas')} y las notas.`,
    ok: pending ? 'Sí, quitar' : 'Sí, eliminar',
    danger: true,
  });
  if (!ok) return;
  const { id, createdAt, updatedAt, ...copy } = place;
  copy.visits = place.visits.map((v) => ({ ...v }));
  closeDetail({ silent: true });
  ui.setSheet(ui.isDesktop() ? 'peek' : state.returnSheet === 'peek' ? 'peek' : 'half');
  store.remove(place.id).catch(reportError);
  ui.toast('Eliminado', {
    action: 'Deshacer',
    onAction: () => {
      try {
        store.add(copy).done.catch(reportError);
        ui.toast('Recuperado.');
      } catch (err) {
        reportError(err);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Nuevo sitio (candidato)
// ---------------------------------------------------------------------------
/** strict: mismo osm o (muy cerca Y mismo nombre). No estricto: mismo osm o muy cerca. */
function findDuplicate(c, { strict = true } = {}) {
  const name = normalize(c.name || '');
  return (
    state.places.find((p) => {
      if (c.osm && p.osm && p.osm === c.osm) return true;
      if (distanceMeters(p, c) >= DUPLICATE_METERS) return false;
      return strict ? Boolean(name) && normalize(p.name) === name : true;
    }) || null
  );
}

function startCandidate(c) {
  if (!isValidLatLng(c.lat, c.lng)) return;
  const existing = findDuplicate(c, { strict: true });
  if (existing) {
    openPlace(existing.id);
    ui.toast('Ya lo teníamos apuntado.');
    return;
  }
  abort('reverseAbort');
  if (state.selectedId) {
    closeDetail({ silent: true, keepHistory: true });
  } else if (!state.candidate) {
    state.returnSheet = ui.getSheet();
  }
  state.candidate = { lat: c.lat, lng: c.lng, name: c.name || '', address: c.address || '', osm: c.osm || '', source: c.source || 'map' };
  map.setDraft(state.candidate);
  ui.renderCandidate({
    name: state.candidate.name,
    address: state.candidate.address,
    loadingAddress: Boolean(c.needsReverse) && state.online,
    dupe: Boolean(findDuplicate(state.candidate, { strict: false })),
    focusName: !state.candidate.name,
  });
  ui.showView('new');
  ui.setSheet('half');
  ui.hideResults();
  map.focus(state.candidate, { offsetY: focusOffset(), zoom: Math.max(map.getView().zoom, 16) });
  pushOverlay();

  if (c.needsReverse) {
    if (!state.online) {
      ui.updateCandidate({ loadingAddress: false, placeholder: 'Sin dirección (sin conexión)' });
      return;
    }
    const controller = new AbortController();
    state.reverseAbort = controller;
    reverseGeocode(c.lat, c.lng, { signal: controller.signal })
      .then((r) => {
        if (state.reverseAbort !== controller || !state.candidate) return;
        ui.updateCandidate({ name: r.name, address: r.address, loadingAddress: false });
        state.candidate.address = state.candidate.address || r.address;
      })
      .catch((err) => {
        if (!isAbortError(err)) ui.updateCandidate({ loadingAddress: false });
      });
  }
}

function cancelCandidate({ silent = false, fromHistory = false, keepHistory = false } = {}) {
  if (!state.candidate) return;
  if (!fromHistory && !keepHistory) popOverlay();
  abort('reverseAbort');
  state.candidate = null;
  map.setDraft(null);
  ui.showView('list');
  if (!silent) ui.setSheet(state.returnSheet === 'full' ? 'full' : state.returnSheet === 'half' ? 'half' : 'peek');
}

function saveCandidate(status, form) {
  const c = state.candidate;
  if (!c) return;
  if (!form.name) {
    ui.setCandidateHint('Ponle un nombre para guardarlo.');
    ui.els.newName.focus();
    return;
  }
  const visited = status === STATUS.VISITED;
  const visit = { id: randomId(), date: todayISO(), note: '' };
  let result;
  try {
    result = store.add({ name: form.name, address: form.address, lat: c.lat, lng: c.lng, status, visits: visited ? [visit] : [], osm: c.osm });
  } catch (err) {
    reportError(err);
    return;
  }
  result.done.catch(reportError);
  abort('reverseAbort');
  const isFirst = state.places.filter((p) => p.id !== result.id).length === 0;
  state.candidate = null;
  map.setDraft(null);
  if (c.osm) removeSuggestion(c.osm);
  navigator.vibrate?.(8);
  setTimeout(() => map.pop(result.id), 80);

  if (visited) {
    state.highlightVisitId = visit.id;
    ui.toast(isFirst ? '¡El primero! Que vengan muchos más.' : 'Añadido con su primera visita.');
    // El almacén local avisa de forma síncrona (el sitio ya está en state.places); Firestore, en el siguiente snapshot.
    if (placeById(result.id)) openPlace(result.id, { fly: false, keepReturn: true });
    else state.pendingOpenId = result.id;
  } else {
    popOverlay();
    state.tab = 'pending';
    writeLocal(TAB_KEY, 'pending');
    ui.showView('list');
    ui.setSheet(ui.isDesktop() ? 'peek' : 'half');
    renderList();
    ui.toast('Guardado en pendientes.');
  }
}

// ---------------------------------------------------------------------------
// Cruz central: marcar un sitio nuevo o mover un pin
// ---------------------------------------------------------------------------
function enterCrosshair({ mode, id }) {
  ui.hideResults();
  ui.setMenuOpen(false);
  if (state.candidate) cancelCandidate({ silent: true });
  if (state.selectedId) closeDetail({ silent: true, keepHistory: mode === 'move' });
  state.crosshair = { mode, id };
  ui.setSheet('peek');
  ui.setCrosshair({
    on: true,
    text: mode === 'move' ? 'Mueve el mapa hasta donde está de verdad' : 'Mueve el mapa hasta el sitio',
    confirmLabel: mode === 'move' ? 'Dejar el pin aquí' : 'Marcar aquí',
  });
  if (mode === 'move') {
    const place = placeById(id);
    if (place) setTimeout(() => map.focus(place, { offsetY: stripOffset(), zoom: map.getView().zoom }), 280);
  }
}

/** Desplazamiento vertical para que un punto quede en el centro de la franja visible sobre la hoja. */
function stripOffset() {
  return ui.isDesktop() ? 0 : Math.round((window.innerHeight - ui.sheetTop()) / 2);
}

function crosshairLatLng() {
  if (ui.isDesktop()) return map.getView().center;
  const w = document.getElementById('map').clientWidth;
  return map.pointToLatLng(w / 2, ui.sheetTop() / 2);
}

function confirmCrosshair() {
  const mode = state.crosshair;
  if (!mode) return;
  const latlng = crosshairLatLng();
  exitCrosshair({ cancelled: false });
  if (mode.mode === 'move') {
    const place = placeById(mode.id);
    if (!place) return;
    store.update(place.id, { lat: latlng.lat, lng: latlng.lng }).catch(reportError);
    openPlace(place.id, { fly: false, keepReturn: true });
    ui.toast('Pin movido.');
    return;
  }
  startCandidate({ ...latlng, name: '', address: '', needsReverse: true });
}

function exitCrosshair({ cancelled }) {
  const mode = state.crosshair;
  state.crosshair = null;
  ui.setCrosshair({ on: false });
  if (cancelled && mode?.mode === 'move' && placeById(mode.id)) openPlace(mode.id, { fly: false, keepReturn: true });
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------
const debouncedSearch = debounce((q) => runSearch(q), 300);

function onSearchInput(q) {
  const query = q.trim();
  abort('searchAbort');
  debouncedSearch.cancel();
  if (query.length < 2) {
    ui.hideResults();
    return;
  }
  const mine = localMatches(query);
  if (query.length < 3) {
    if (mine.length) ui.renderResults({ state: 'results', groups: [{ label: 'Nuestros sitios', items: mine }] });
    else ui.hideResults();
    return;
  }
  if (!state.online) {
    ui.renderResults({ state: 'error', groups: [{ label: 'Nuestros sitios', items: mine }], message: 'La búsqueda necesita internet. Puedes marcar el mapa a mano.' });
    return;
  }
  if (getSearchProvider() === 'nominatim') {
    ui.renderResults({ state: 'enter', groups: [{ label: 'Nuestros sitios', items: mine }] });
    return;
  }
  ui.renderResults({ state: 'loading', groups: [{ label: 'Nuestros sitios', items: mine }] });
  debouncedSearch(query);
}

function localMatches(query) {
  const q = normalize(query);
  return state.places
    .filter((p) => normalize(p.name).includes(q) || normalize(p.address).includes(q))
    .slice(0, 3)
    .map((p) => ({ kind: 'mine', name: p.name, address: p.address, lat: p.lat, lng: p.lng, place: p, id: `mine:${p.id}` }));
}

async function runSearch(q) {
  const query = q.trim();
  if (query.length < 2) return;
  if (!state.online) {
    ui.toast('La búsqueda necesita internet. Puedes marcar el mapa a mano.');
    return;
  }
  abort('searchAbort');
  const controller = new AbortController();
  state.searchAbort = controller;
  const { center, zoom } = map.getView();
  const mine = localMatches(query);
  ui.renderResults({ state: 'loading', groups: [{ label: 'Nuestros sitios', items: mine }] });
  try {
    const results = await searchPlaces(query, { near: center, zoom, limit: 7, signal: controller.signal });
    if (state.searchAbort !== controller) return;
    const food = results.filter((r) => r.kind === 'food' || r.kind === 'shop');
    const other = results.filter((r) => r.kind !== 'food' && r.kind !== 'shop');
    ui.renderResults({
      state: 'results',
      groups: [
        { label: 'Nuestros sitios', items: mine },
        { label: 'Restaurantes', items: food },
        { label: 'Lugares', items: other },
      ],
    });
  } catch (err) {
    if (isAbortError(err) || state.searchAbort !== controller) return;
    console.warn(err);
    ui.renderResults({
      state: getSearchProvider() === 'nominatim' ? 'enter' : 'error',
      groups: [{ label: 'Nuestros sitios', items: mine }],
      message: 'El buscador no responde. Prueba en un momento.',
    });
  }
}

function onResultPick(item) {
  if (item.kind === 'mine') {
    openPlace(item.place.id);
    return;
  }
  ui.els.searchInput.blur();
  if (item.kind === 'area') {
    if (item.extent) map.fitExtent(item.extent);
    else map.flyTo(item, 13);
    return;
  }
  const named = item.kind === 'food' || item.kind === 'shop' || item.kind === 'place';
  startCandidate({ ...item, name: named ? item.name : '', source: 'search' });
}

// ---------------------------------------------------------------------------
// Sushi por aquí (sugerencias)
// ---------------------------------------------------------------------------
async function findNearby() {
  if (!state.online) {
    ui.toast('Para buscar por aquí hace falta internet.');
    return;
  }
  const view = map.getView();
  if (view.zoom < 13) {
    ui.toast('Acércate más para buscar por aquí.');
    return;
  }
  abort('nearbyAbort');
  const controller = new AbortController();
  state.nearbyAbort = controller;
  ui.setNearbyState({ busy: true });
  const show = (list) => {
    if (state.nearbyAbort !== controller) return 0;
    const fresh = list.filter((s) => !findDuplicate(s, { strict: false }));
    state.suggestions = fresh;
    map.setSuggestions(fresh);
    ui.setNearbyState({ busy: false, count: fresh.length });
    return fresh.length;
  };
  let shown = 0;
  try {
    const list = await discoverSushi(view.bounds, {
      signal: controller.signal,
      onPartial: (partial) => {
        shown = show(partial);
      },
    });
    if (state.nearbyAbort !== controller) return;
    const n = show(list);
    if (!n) ui.toast('No hemos encontrado sushi en esta zona. Mueve el mapa o acércate más.');
    else if (n > shown) ui.toast(`${plural(n, 'sitio', 'sitios')} cerca. Toca un punto para añadirlo.`);
  } catch (err) {
    if (isAbortError(err)) return;
    ui.setNearbyState({ busy: false, count: state.suggestions.length });
    ui.toast('Las sugerencias no responden ahora mismo. Inténtalo luego.');
  } finally {
    if (state.nearbyAbort === controller) {
      state.nearbyAbort = null;
      ui.setNearbyState({ busy: false, count: state.suggestions.length });
    }
  }
}

function clearSuggestions() {
  abort('nearbyAbort');
  state.suggestions = [];
  map.clearSuggestions();
  ui.setNearbyState({ busy: false, count: 0 });
}

function removeSuggestion(osm) {
  state.suggestions = state.suggestions.filter((s) => s.osm !== osm);
  map.setSuggestions(state.suggestions);
  ui.setNearbyState({ busy: false, count: state.suggestions.length });
}

// ---------------------------------------------------------------------------
// Mapa, menú y varios
// ---------------------------------------------------------------------------
function onMapClick() {
  ui.hideResults();
  ui.setMenuOpen(false);
  if (state.crosshair) return;
  if (state.candidate) cancelCandidate();
  else if (state.selectedId) closeDetail();
  else if (!ui.isDesktop() && ui.getSheet() !== 'peek') ui.setSheet('peek');
}

function onMoveEnd(view) {
  saveView(view);
  if (state.suggestions.length && view.zoom < 11) clearSuggestions();
}

async function locate() {
  ui.setLocateBusy(true);
  try {
    await map.locate();
  } catch (err) {
    ui.toast(err.message);
  } finally {
    ui.setLocateBusy(false);
  }
}

function onMenuAction(action) {
  switch (action) {
    case 'center-pin':
      enterCrosshair({ mode: 'new' });
      break;
    case 'fit':
      if (state.places.length) map.fitPlaces(state.places);
      else ui.toast('Todavía no hay sitios en el mapa.');
      break;
    case 'export':
      exportJson();
      break;
    case 'logout':
      state.bye = 'Hasta el próximo sushi.';
      auth.signOut().catch((err) => {
        state.bye = null;
        reportError(err);
      });
      break;
    default:
      break;
  }
}

function exportJson() {
  const data = {
    app: 'sushimap',
    version: 1,
    exportedAt: new Date().toISOString(),
    places: state.places.map(({ id, name, address, notes, lat, lng, status, rating, visits, osm, createdAt, updatedAt }) => ({
      id, name, address, notes, lat, lng, status, rating, visits, osm, createdAt, updatedAt,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sushi-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  ui.toast('Copia descargada.');
}

async function importFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    ui.toast('Ese archivo no parece una copia del mapa.');
    return;
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.places) ? parsed.places : null;
  if (!list) {
    ui.toast('Ese archivo no parece una copia del mapa.');
    return;
  }
  const ok = await ui.confirm({
    title: `¿Importar ${plural(list.length, 'sitio', 'sitios')}?`,
    text: 'Los que ya estén en el mapa se saltarán.',
    ok: 'Importar',
  });
  if (!ok) return;
  let added = 0;
  let skipped = 0;
  let failed = 0;
  for (const raw of list) {
    const candidate = { lat: Number(raw?.lat), lng: Number(raw?.lng), osm: raw?.osm || '', name: raw?.name || '' };
    if (!isValidLatLng(candidate.lat, candidate.lng)) {
      failed += 1;
      continue;
    }
    if (findDuplicate(candidate, { strict: false })) {
      skipped += 1;
      continue;
    }
    try {
      const { done } = store.add({
        name: raw.name,
        address: raw.address || '',
        notes: raw.notes || '',
        lat: candidate.lat,
        lng: candidate.lng,
        status: raw.status === STATUS.VISITED ? STATUS.VISITED : STATUS.PENDING,
        rating: raw.rating || 0,
        visits: Array.isArray(raw.visits) ? raw.visits : [],
        osm: candidate.osm,
      });
      done.catch(reportError);
      added += 1;
    } catch (err) {
      console.warn('Sitio no importado:', raw, err);
      failed += 1;
    }
  }
  ui.toast(`Importados ${plural(added, 'sitio', 'sitios')}` + (skipped ? ` · ${skipped} ya estaban` : '') + (failed ? ` · ${failed} con errores` : '') + '.', { duration: 7000 });
}

const saveView = debounce((view) => {
  writeLocal(VIEW_KEY, JSON.stringify({ lat: view.center.lat, lng: view.center.lng, zoom: view.zoom }));
}, 500);

function loadSavedView() {
  try {
    const v = JSON.parse(readLocal(VIEW_KEY) || 'null');
    return v && isValidLatLng(v.lat, v.lng) && Number.isFinite(v.zoom) ? v : null;
  } catch {
    return null;
  }
}

function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento */
  }
}

function abort(key) {
  state[key]?.abort();
  state[key] = null;
}

// Historial: mientras hay una ficha o un candidato abiertos existe UNA entrada extra, para que el botón
// "atrás" del móvil cierre esa vista en vez de salir de la web.
function pushOverlay() {
  if (!history.state?.overlay) history.pushState({ overlay: true }, '');
}
function popOverlay() {
  if (history.state?.overlay) {
    state.ignorePop += 1;
    history.back();
  }
}
function onPopState() {
  if (state.ignorePop > 0) {
    state.ignorePop -= 1;
    return;
  }
  if (!state.started) return;
  if (state.crosshair) exitCrosshair({ cancelled: true });
  else if (state.candidate) cancelCandidate({ fromHistory: true });
  else if (state.selectedId) closeDetail({ fromHistory: true });
}

boot();
