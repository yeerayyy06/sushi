// Contador de piezas: para ir contando lo que coméis en el restaurante (sobre todo en un buffet libre).
// No se guarda en el historial. Solo lo recuerda este móvil hasta el día siguiente, por si se bloquea
// la pantalla a mitad de comida.
import { todayISO, formatDate } from './util.js';

const KEY = 'sushimap:counter';
const NAME_MAX = 14;
const MESSAGES = {
  10: '¡10 piezas! Esto ya es una comida en serio.',
  20: '¡20! Ritmo de buffet libre.',
  30: '30 piezas. Leyendas del sushi.',
  40: '40… el camarero empieza a mirar.',
  50: '¡50! Récord a batir.',
  75: '75. Sin palabras.',
  100: '100 piezas. Esto hay que celebrarlo. 🏆',
};
const HINT = 'Toca el sushi cada vez que os comáis una pieza.';

const fresh = (keep = {}) => ({
  day: todayISO(),
  counts: [0, 0],
  names: Array.isArray(keep.names) && keep.names.length === 2 ? keep.names : ['Yo', 'Tú'],
  together: Boolean(keep.together),
});

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw) return fresh();
    if (raw.day !== todayISO()) return fresh(raw); // otro día: se empieza de cero (pero se recuerdan los nombres)
    const state = fresh(raw);
    state.counts = (Array.isArray(raw.counts) ? raw.counts : [0, 0]).slice(0, 2).map((n) => Math.max(0, Math.floor(Number(n) || 0)));
    while (state.counts.length < 2) state.counts.push(0);
    return state;
  } catch {
    return fresh();
  }
}

/**
 * @param {{ celebrate?: (origin: Element, opts: object) => void, onChange?: (total: number) => void }} opts
 */
export function createCounter({ celebrate, onChange } = {}) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('counter-dialog');
  const placeEl = $('counter-place');
  const totalEl = $('counter-total');
  const totalLabel = $('counter-total-label');
  const peopleEl = $('counter-people');
  const modeBtn = $('counter-mode');
  const hintEl = $('counter-hint');
  const resetBtn = $('counter-reset');
  const persons = [...peopleEl.querySelectorAll('.person')];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let state = load();
  let resetTimer = null;

  const total = () => (state.together ? state.counts[0] : state.counts[0] + state.counts[1]);

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* navegación privada: el contador funciona igual, solo que no sobrevive a una recarga */
    }
    onChange?.(total());
  }

  function bump(el) {
    if (reduceMotion.matches) return;
    el.classList.remove('is-bump');
    void el.offsetWidth;
    el.classList.add('is-bump');
  }

  function render({ changed = null } = {}) {
    const t = total();
    totalEl.textContent = String(t);
    totalLabel.textContent = t === 1 ? 'pieza' : 'piezas';
    peopleEl.classList.toggle('is-together', state.together);
    modeBtn.textContent = state.together ? 'Por separado' : 'Juntos';
    modeBtn.setAttribute('aria-label', state.together ? 'Contar cada uno por separado' : 'Contar juntos');
    persons.forEach((person, i) => {
      person.hidden = state.together && i === 1;
      person.querySelector('.person__name').textContent = state.together ? 'Los dos' : state.names[i];
      person.querySelector('.person__name').disabled = state.together;
      person.querySelector('.person__count').textContent = String(state.counts[i]);
      person.querySelector('.person__minus').disabled = state.counts[i] === 0;
    });
    if (changed != null) {
      bump(persons[changed].querySelector('.person__count'));
      bump(totalEl);
    }
  }

  function setHint(text) {
    hintEl.textContent = text;
  }

  function add(i, button) {
    state.counts[i] += 1;
    save();
    render({ changed: i });
    navigator.vibrate?.(10);
    const t = total();
    if (MESSAGES[t]) {
      setHint(MESSAGES[t]);
      celebrate?.(button, { count: 34, power: 1.3 });
    } else {
      if (hintEl.textContent !== HINT && t % 10 > 2) setHint(HINT);
      celebrate?.(button, { count: 5, power: 0.55, emojis: ['🍣', '✨', '🍥'] });
    }
  }

  function remove(i) {
    if (!state.counts[i]) return;
    state.counts[i] -= 1;
    save();
    render({ changed: i });
  }

  function rename(i) {
    if (state.together) return;
    const name = window.prompt('¿Cómo se llama?', state.names[i]);
    if (name == null) return;
    const clean = name.trim().slice(0, NAME_MAX);
    if (!clean) return;
    state.names[i] = clean;
    save();
    render();
  }

  function toggleMode() {
    if (state.together) {
      state.together = false; // las piezas contadas juntas se quedan en la primera persona
    } else {
      state.together = true;
      state.counts = [state.counts[0] + state.counts[1], 0];
    }
    save();
    render();
  }

  function armReset() {
    if (!total()) return;
    if (resetBtn.classList.contains('is-armed')) {
      clearTimeout(resetTimer);
      resetBtn.classList.remove('is-armed');
      resetBtn.textContent = 'Empezar de cero';
      state = fresh(state);
      save();
      render();
      setHint(HINT);
      return;
    }
    resetBtn.classList.add('is-armed');
    resetBtn.textContent = '¿Seguro? Toca otra vez';
    resetTimer = setTimeout(() => {
      resetBtn.classList.remove('is-armed');
      resetBtn.textContent = 'Empezar de cero';
    }, 3500);
  }

  peopleEl.addEventListener('click', (e) => {
    const tap = e.target.closest('.person__tap');
    if (tap) return add(Number(tap.dataset.i), tap);
    const minus = e.target.closest('.person__minus');
    if (minus) return remove(Number(minus.dataset.i));
    const name = e.target.closest('.person__name');
    if (name) rename(Number(name.dataset.i));
  });
  modeBtn.addEventListener('click', toggleMode);
  resetBtn.addEventListener('click', armReset);
  $('counter-close').addEventListener('click', () => close());

  /** Abre el contador. Si es otro día, empieza de cero. */
  function open({ placeName = '' } = {}) {
    if (state.day !== todayISO()) {
      state = fresh(state);
      save();
    }
    placeEl.textContent = placeName ? `En ${placeName} · hoy` : formatDate(todayISO());
    setHint(HINT);
    render();
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
  function close() {
    if (dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  // Al volver a la app otro día, el globo del botón se pone a cero.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.day !== todayISO()) {
      state = fresh(state);
      save();
      render();
    }
  });

  return { open, close, total, dialog };
}
