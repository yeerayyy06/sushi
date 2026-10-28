// Interfaz: pinta el DOM y avisa a la app de lo que hace la persona. No sabe nada de Firebase ni del mapa.
import { escapeHtml, formatShort, relativeDate, plural, formatDistance, todayISO, debounce } from './util.js';

const $ = (id) => document.getElementById(id);
const THEME_COLORS = { light: '#f6f3ed', dark: '#141311' };
const NOTE_PLACEHOLDERS = ['¿Qué pedimos?', '¿Qué tal estuvo?', '¿Repetiríamos?', '¿Quién invitó?'];
const SUSHI_RE = /sushi|japon|nigiri|ramen|izakaya/i;

/**
 * @param {object} handlers  callbacks que la app registra (ver app.js)
 */
export function createUI(handlers = {}) {
  const ids = [
    'splash', 'splash-text', 'login', 'login-form', 'login-title', 'login-subtitle', 'login-username', 'login-error', 'login-demo', 'login-bye',
    'login-dedication', 'login-submit', 'password', 'toggle-password', 'app', 'wordmark', 'menu-button', 'menu-monogram', 'menu-bars',
    'search-form', 'search-input', 'search-clear', 'search-results', 'menu', 'theme-seg', 'menu-footer', 'import-file',
    'fabs', 'nearby-button', 'nearby-label', 'locate-button', 'crosshair', 'crosshair-text', 'crosshair-confirm', 'crosshair-cancel',
    'panel', 'panel-grip', 'panel-handle', 'view-list', 'view-detail', 'view-new',
    'stats-line', 'stats-since', 'offline', 'tab-visited', 'tab-pending', 'count-visited', 'count-pending', 'rows', 'empty', 'empty-title', 'empty-text', 'empty-action',
    'detail-peek', 'detail-peek-close', 'detail-peek-name', 'detail-peek-count', 'detail-peek-plus', 'detail-back', 'detail-fav', 'detail-name', 'detail-address',
    'detail-counter', 'detail-count', 'detail-last', 'detail-stars', 'detail-plus-date', 'detail-visits', 'detail-visits-empty', 'detail-notes', 'detail-notes-hint',
    'detail-directions', 'detail-edit', 'detail-move', 'detail-delete', 'detail-plus',
    'new-peek-close', 'new-cancel', 'new-name', 'new-address', 'new-address-spinner', 'new-hint', 'new-dupe', 'new-dupe-open', 'new-visited', 'new-pending',
    'toasts', 'demo-chip',
    'confirm-dialog', 'confirm-title', 'confirm-text', 'confirm-ok', 'confirm-cancel',
    'visit-dialog', 'visit-form', 'visit-title', 'visit-date', 'visit-note', 'visit-error', 'visit-cancel', 'visit-remove',
    'edit-dialog', 'edit-form', 'edit-name', 'edit-address', 'edit-error', 'edit-cancel',
  ];
  const els = {};
  for (const id of ids) {
    const el = $(id);
    if (!el) throw new Error(`Falta el elemento #${id} en index.html`);
    els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = el;
  }
  els.views = { list: els.viewList, detail: els.viewDetail, new: els.viewNew };

  const desktopQuery = window.matchMedia('(min-width: 900px)');
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const isDesktop = () => desktopQuery.matches;
  let currentView = 'list';
  let currentPlaceId = null;
  let searchResults = [];
  let activeResult = -1;
  let notePlaceholderIndex = 0;

  // ---------------------------------------------------------------------------
  // Pantallas
  // ---------------------------------------------------------------------------
  function showSplash(show) {
    els.splash.hidden = !show;
  }
  function setSplashText(text, { static: isStatic = false } = {}) {
    els.splashText.textContent = text;
    els.splashText.style.animation = 'none';
    els.splashText.style.opacity = '1';
    if (isStatic) els.splash.querySelector('.dot')?.classList.remove('dot--pulse');
  }
  function showLogin({ title, subtitle, demo, dedication, username, bye }) {
    els.loginTitle.textContent = title;
    els.loginSubtitle.textContent = subtitle;
    els.loginDemo.hidden = !demo;
    els.loginDedication.textContent = dedication || '';
    els.loginDedication.hidden = !dedication;
    if (username) els.loginUsername.value = username;
    els.loginBye.textContent = bye || '';
    els.loginBye.hidden = !bye;
    els.app.hidden = true;
    els.login.hidden = false;
    showSplash(false);
    setLoginError(null);
    setLoginBusy(false);
    els.password.value = '';
    setTimeout(() => els.password.focus({ preventScroll: true }), 50);
  }
  function showApp() {
    els.login.hidden = true;
    els.app.hidden = false;
    showSplash(false);
  }
  function setLoginBusy(busy) {
    els.loginSubmit.classList.toggle('is-busy', busy);
    els.loginSubmit.disabled = busy;
    els.loginSubmit.textContent = busy ? 'Entrando…' : 'Entrar';
  }
  function setLoginError(message) {
    els.loginError.hidden = !message;
    els.loginError.textContent = message || '';
    if (message) {
      if (!reducedMotion.matches) {
        els.loginForm.classList.remove('is-shaking');
        void els.loginForm.offsetWidth;
        els.loginForm.classList.add('is-shaking');
      }
      els.password.select();
    }
  }

  els.loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handlers.onLogin?.(els.password.value);
  });
  els.togglePassword.addEventListener('click', () => {
    const show = els.password.type === 'password';
    els.password.type = show ? 'text' : 'password';
    els.togglePassword.textContent = show ? 'Ocultar' : 'Mostrar';
    els.togglePassword.setAttribute('aria-pressed', String(show));
    els.password.focus();
  });

  // ---------------------------------------------------------------------------
  // Tema (auto | light | dark)
  // ---------------------------------------------------------------------------
  function resolveTheme(pref) {
    return pref === 'dark' || (pref !== 'light' && darkQuery.matches) ? 'dark' : 'light';
  }
  function applyTheme(pref) {
    const theme = resolveTheme(pref);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePref = pref;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
    els.themeSeg.querySelectorAll('.seg__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === pref)));
    return theme;
  }
  function setThemePref(pref) {
    const theme = applyTheme(pref);
    try {
      localStorage.setItem('sushimap:theme', pref);
    } catch {
      /* sin almacenamiento */
    }
    handlers.onThemeApplied?.(theme);
    return theme;
  }
  function getThemePref() {
    return document.documentElement.dataset.themePref || 'auto';
  }
  function getTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }
  darkQuery.addEventListener?.('change', () => {
    if (getThemePref() === 'auto') handlers.onThemeApplied?.(applyTheme('auto'));
  });
  els.themeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg__btn');
    if (btn) setThemePref(btn.dataset.theme);
  });

  function setBranding({ title, initials }) {
    els.wordmark.textContent = title;
    const mono = String(initials || '').trim();
    els.menuMonogram.textContent = mono;
    els.menuMonogram.hidden = !mono;
    els.menuBars.hidden = Boolean(mono);
  }

  // ---------------------------------------------------------------------------
  // Buscador y resultados
  // ---------------------------------------------------------------------------
  els.searchInput.addEventListener('input', () => {
    const q = els.searchInput.value;
    els.searchClear.hidden = !q;
    handlers.onSearchInput?.(q);
  });
  els.searchInput.addEventListener('focus', () => {
    setMenuOpen(false);
    if (!isDesktop()) setSheet('peek');
    if (els.searchInput.value.trim().length >= 2 && searchResults.length) els.searchResults.hidden = false;
  });
  els.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (activeResult >= 0 && searchResults[activeResult]) {
      pickResult(searchResults[activeResult]);
      return;
    }
    handlers.onSearchSubmit?.(els.searchInput.value);
  });
  els.searchClear.addEventListener('click', () => {
    setSearchValue('');
    hideResults();
    handlers.onSearchClear?.();
    els.searchInput.focus();
  });
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      hideResults();
      els.searchInput.blur();
      return;
    }
    if (els.searchResults.hidden || !searchResults.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + searchResults.length) % searchResults.length;
      els.searchResults.querySelectorAll('.results__item').forEach((el, i) => el.classList.toggle('is-active', i === activeResult));
      els.searchResults.querySelector('.results__item.is-active')?.scrollIntoView({ block: 'nearest' });
    }
  });
  els.searchResults.addEventListener('click', (e) => {
    const action = e.target.closest('.results__action');
    if (action) {
      hideResults();
      handlers.onSearchAction?.();
      return;
    }
    const btn = e.target.closest('.results__item');
    if (!btn) return;
    const item = searchResults[Number(btn.dataset.index)];
    if (item) pickResult(item);
  });
  function pickResult(item) {
    hideResults();
    handlers.onResultPick?.(item);
  }

  function setSearchValue(value) {
    els.searchInput.value = value;
    els.searchClear.hidden = !value;
  }
  function focusSearch() {
    els.searchInput.focus();
  }
  function hideResults() {
    els.searchResults.hidden = true;
    activeResult = -1;
  }

  function resultRow(item, index) {
    let icon;
    let meta;
    let chip = '';
    let arrow = '';
    if (item.kind === 'mine') {
      const p = item.place;
      icon = p.status === 'pending' ? '<span class="results__icon"><span class="pin pin--pending" style="width:14px;height:14px;box-shadow:none"></span></span>' : `<span class="results__icon" style="background:var(--ink);color:var(--paper-2)">${p.visits.length > 99 ? '99+' : p.visits.length}</span>`;
      meta = p.status === 'pending' ? 'Pendiente' : `×${p.visits.length}${p.visits[0] ? ` · ${formatShort(p.visits[0].date)}` : ''}`;
    } else if (item.kind === 'food' || item.kind === 'shop') {
      icon = '<span class="results__icon">R</span>';
      meta = [item.address, item.distance != null && item.distance < 50000 ? formatDistance(item.distance) : ''].filter(Boolean).join(' · ');
      if (SUSHI_RE.test(`${item.name} ${item.cuisine || ''}`)) chip = '<span class="results__chip">sushi</span>';
    } else {
      icon = '<span class="results__icon">→</span>';
      meta = item.address || '';
      arrow = '<span class="results__arrow" aria-hidden="true">→</span>';
    }
    return `<button type="button" class="results__item" role="option" data-index="${index}">${icon}<span class="results__text"><span class="results__name"><span>${escapeHtml(item.name)}</span>${chip}</span><span class="results__meta">${escapeHtml(meta)}</span></span>${arrow}</button>`;
  }

  /**
   * @param {{state: 'loading'|'results'|'error'|'enter', groups?: Array<{label: string, items: object[]}>, message?: string}} view
   */
  function renderResults(view) {
    const parts = [];
    searchResults = [];
    activeResult = -1;
    let index = 0;
    for (const group of view.groups || []) {
      if (!group.items.length) continue;
      parts.push(`<div class="results__group">${escapeHtml(group.label)}</div>`);
      for (const item of group.items) {
        searchResults.push(item);
        parts.push(resultRow(item, index));
        index += 1;
      }
    }
    if (view.state === 'loading') parts.push('<p class="results__note">Buscando…</p>');
    else if (view.state === 'error') parts.push(`<p class="results__note">${escapeHtml(view.message || 'El buscador no responde. Prueba en un momento.')}</p>`);
    else if (view.state === 'enter') parts.push('<p class="results__note">El buscador rápido no responde. Escribe y pulsa Intro.</p>');
    else if (!index) parts.push('<p class="results__note">Nada con ese nombre por aquí.</p>');
    parts.push('<button type="button" class="results__action">¿No aparece? Márcalo a mano en el mapa</button>');
    els.searchResults.innerHTML = parts.join('');
    els.searchResults.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Menú
  // ---------------------------------------------------------------------------
  function setMenuOpen(open) {
    els.menu.hidden = !open;
    els.menuButton.setAttribute('aria-expanded', String(open));
  }
  els.menuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = els.menu.hidden;
    setMenuOpen(open);
    if (open) hideResults();
  });
  els.menu.addEventListener('click', (e) => {
    const item = e.target.closest('.menu__item');
    if (!item) return;
    const action = item.dataset.action;
    setMenuOpen(false);
    if (action === 'import') {
      els.importFile.value = '';
      els.importFile.click();
      return;
    }
    handlers.onMenuAction?.(action);
  });
  els.importFile.addEventListener('change', () => {
    const file = els.importFile.files?.[0];
    if (file) handlers.onImportFile?.(file);
  });
  document.addEventListener('click', (e) => {
    if (!els.menu.hidden && !els.menu.contains(e.target) && !els.menuButton.contains(e.target)) setMenuOpen(false);
    if (!els.searchResults.hidden && !els.searchResults.contains(e.target) && !els.searchForm.contains(e.target)) hideResults();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return; // el diálogo ya gestiona su propio Escape
      if (!els.menu.hidden) setMenuOpen(false);
      else if (!els.searchResults.hidden) hideResults();
      else handlers.onEscape?.();
      return;
    }
    if (e.key === '/' && !els.app.hidden && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      els.searchInput.focus();
    }
  });
  function setMenuFooter(text) {
    els.menuFooter.textContent = text;
  }

  // ---------------------------------------------------------------------------
  // Botones flotantes, cruz central, estado de red
  // ---------------------------------------------------------------------------
  let nearbyCount = 0;
  els.nearbyButton.addEventListener('click', () => (nearbyCount ? handlers.onClearSuggestions?.() : handlers.onNearby?.()));
  els.locateButton.addEventListener('click', () => handlers.onLocate?.());
  els.crosshairConfirm.addEventListener('click', () => handlers.onCrosshairConfirm?.());
  els.crosshairCancel.addEventListener('click', () => handlers.onCrosshairCancel?.());

  function setNearbyState({ busy = false, count = 0 } = {}) {
    nearbyCount = busy ? 0 : count;
    els.nearbyButton.classList.toggle('is-busy', busy);
    els.nearbyButton.disabled = busy;
    els.nearbyLabel.textContent = busy ? 'Buscando…' : count ? `${count} cerca · Limpiar` : 'Sushi por aquí';
  }
  function setLocateBusy(busy) {
    els.locateButton.classList.toggle('is-pulsing', busy);
  }
  function setCrosshair({ on, text = 'Mueve el mapa hasta el sitio', confirmLabel = 'Marcar aquí' }) {
    els.crosshair.hidden = !on;
    els.crosshair.setAttribute('aria-hidden', String(!on));
    els.crosshairText.textContent = text;
    els.crosshairConfirm.textContent = confirmLabel;
    els.app.classList.toggle('is-crosshair', on);
  }
  function setOnline(online) {
    els.offline.hidden = online;
  }
  function setDemoChip(show) {
    els.demoChip.hidden = !show;
  }

  // ---------------------------------------------------------------------------
  // Panel: vistas y hoja inferior
  // ---------------------------------------------------------------------------
  function showView(name) {
    currentView = name;
    for (const [key, el] of Object.entries(els.views)) el.hidden = key !== name;
    els.panel.dataset.view = name;
    els.panel.scrollTop = 0; // por si algún scrollIntoView del navegador movió el panel
    els.views[name].querySelector('.view__scroll')?.scrollTo({ top: 0 });
  }
  function getView() {
    return currentView;
  }

  const SHEET_STATES = ['peek', 'half', 'full'];
  function setSheet(state) {
    if (!SHEET_STATES.includes(state) || els.panel.dataset.state === state) return;
    els.panel.dataset.state = state;
    handlers.onSheetChange?.(state);
  }
  function getSheet() {
    return els.panel.dataset.state;
  }
  function visibleFor(state) {
    const h = window.visualViewport?.height || window.innerHeight;
    if (state === 'peek') return 84 + safeBottom();
    if (state === 'half') return h * 0.52;
    return h - safeTop() - 76;
  }
  function safeBottom() {
    return parseFloat(getComputedStyle(els.panel).paddingBottom) || 0;
  }
  function safeTop() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-top');
    return parseFloat(v) || 0;
  }

  // visualViewport: el teclado reduce la altura útil
  const vv = window.visualViewport;
  if (vv) {
    const syncVvh = () => document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    vv.addEventListener('resize', syncVvh);
    syncVvh();
  }

  // Arrastre de la hoja (solo móvil): desde el asa.
  let drag = null;
  els.panelGrip.addEventListener('pointerdown', (e) => {
    if (isDesktop()) return;
    drag = { startY: e.clientY, startVisible: visibleFor(getSheet()), moved: false, lastY: e.clientY, lastT: performance.now(), vel: 0 };
    els.panelGrip.setPointerCapture(e.pointerId);
    els.panel.classList.add('is-dragging');
  });
  els.panelGrip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dy) > 4) drag.moved = true;
    const now = performance.now();
    drag.vel = (e.clientY - drag.lastY) / Math.max(1, now - drag.lastT);
    drag.lastY = e.clientY;
    drag.lastT = now;
    const visible = Math.min(visibleFor('full'), Math.max(visibleFor('peek'), drag.startVisible - dy));
    els.app.style.setProperty('--sheet-visible', `${visible}px`);
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    els.panel.classList.remove('is-dragging');
    els.app.style.removeProperty('--sheet-visible');
    if (!d.moved) {
      cycleSheet();
      return;
    }
    const visible = Math.min(visibleFor('full'), Math.max(visibleFor('peek'), d.startVisible - (e.clientY - d.startY)));
    let best = 'peek';
    if (Math.abs(d.vel) > 0.5) {
      const i = SHEET_STATES.indexOf(getSheet());
      best = SHEET_STATES[Math.min(2, Math.max(0, i + (d.vel < 0 ? 1 : -1)))];
    } else {
      let bestDist = Infinity;
      for (const s of SHEET_STATES) {
        const dist = Math.abs(visibleFor(s) - visible);
        if (dist < bestDist) {
          bestDist = dist;
          best = s;
        }
      }
    }
    setSheet(best);
  };
  els.panelGrip.addEventListener('pointerup', endDrag);
  els.panelGrip.addEventListener('pointercancel', endDrag);
  function cycleSheet() {
    const i = SHEET_STATES.indexOf(getSheet());
    setSheet(SHEET_STATES[(i + 1) % SHEET_STATES.length]);
  }
  els.panelHandle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      cycleSheet();
    }
  });
  // Un campo dentro de la hoja recibe el foco: abrirla del todo para que el teclado no lo tape.
  els.panel.addEventListener('focusin', (e) => {
    if (isDesktop() || !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    setSheet('full');
    const scroller = e.target.closest('.view__scroll');
    if (!scroller) return;
    // Solo desplazamos el contenedor de scroll (scrollIntoView movería también el panel, que recorta con overflow:hidden).
    setTimeout(() => {
      const top = e.target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 96;
      scroller.scrollTo({ top: Math.max(0, top), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }, 320);
  });

  // ---------------------------------------------------------------------------
  // Lista
  // ---------------------------------------------------------------------------
  els.tabVisited.addEventListener('click', () => handlers.onTabChange?.('visited'));
  els.tabPending.addEventListener('click', () => handlers.onTabChange?.('pending'));
  els.rows.addEventListener('click', (e) => {
    const plus = e.target.closest('.row__plus');
    if (plus) {
      e.stopPropagation();
      handlers.onRowPlus?.(plus.dataset.id);
      return;
    }
    const main = e.target.closest('.row__main');
    if (main) handlers.onRowClick?.(main.dataset.id);
  });
  els.emptyAction.addEventListener('click', () => handlers.onEmptyAction?.());

  function renderStats({ places, visits, sinceYear }) {
    if (!places) {
      els.statsLine.textContent = 'Aún nada. Nuestro primer sushi está esperando.';
      els.statsLine.classList.add('is-empty');
    } else {
      els.statsLine.innerHTML = `<b>${visits}</b> ${visits === 1 ? 'visita' : 'visitas'} · <b>${places}</b> ${places === 1 ? 'sitio' : 'sitios'}`;
      els.statsLine.classList.remove('is-empty');
    }
    els.statsSince.textContent = sinceYear ? `desde ${sinceYear}` : '';
    els.statsSince.hidden = !sinceYear;
    const title = handlers.appTitle || 'Nuestro mapa de sushi';
    document.title = visits ? `${plural(visits, 'visita', 'visitas')} · ${title}` : title;
  }

  function renderList({ visited, pending, tab, selectedId, favId }) {
    els.tabVisited.classList.toggle('is-active', tab === 'visited');
    els.tabPending.classList.toggle('is-active', tab === 'pending');
    els.tabVisited.setAttribute('aria-selected', String(tab === 'visited'));
    els.tabPending.setAttribute('aria-selected', String(tab === 'pending'));
    els.countVisited.textContent = String(visited.length);
    els.countPending.textContent = String(pending.length);

    const list = tab === 'visited' ? visited : pending;
    els.rows.innerHTML = list
      .map((p) => {
        const fav = p.id === favId;
        const count = p.visits.length;
        const last = p.visits[0];
        const right =
          p.status === 'pending'
            ? ''
            : `<span class="row__right"><span class="row__count">×${count}</span>${last ? `<span class="row__date">${escapeHtml(formatShort(last.date))}</span>` : ''}</span>`;
        const action =
          p.status === 'pending'
            ? `<button type="button" class="pill row__plus" data-id="${escapeHtml(p.id)}" aria-label="${escapeHtml(`Apuntar la primera visita a ${p.name}`)}">Hemos ido</button>`
            : `<button type="button" class="pill row__plus" data-id="${escapeHtml(p.id)}" aria-label="${escapeHtml(`Sumar una visita a ${p.name}`)}">+1</button>`;
        return `<li class="row ${p.id === selectedId ? 'is-selected' : ''}" data-id="${escapeHtml(p.id)}"><button type="button" class="row__main" data-id="${escapeHtml(p.id)}"><span class="row__text">${fav ? '<span class="eyebrow eyebrow--fav">el de siempre</span>' : ''}<span class="row__name">${escapeHtml(p.name)}</span><span class="row__meta">${escapeHtml(p.address || 'Sin dirección')}</span></span>${right}</button>${action}</li>`;
      })
      .join('');

    const empty = !list.length;
    els.empty.hidden = !empty;
    if (empty) {
      if (tab === 'visited') {
        els.emptyTitle.textContent = 'Aún no hay ningún sushi aquí.';
        els.emptyText.textContent = 'Busca arriba el primero o mantén pulsado el mapa para marcarlo.';
        els.emptyAction.hidden = false;
      } else {
        els.emptyTitle.textContent = 'Nada pendiente.';
        els.emptyText.textContent = 'Prueba «Sushi por aquí» para encontrar el siguiente.';
        els.emptyAction.hidden = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Ficha
  // ---------------------------------------------------------------------------
  els.detailBack.addEventListener('click', () => handlers.onDetailBack?.());
  els.detailPeekClose.addEventListener('click', () => handlers.onDetailBack?.());
  els.detailEdit.addEventListener('click', () => handlers.onDetailEdit?.());
  els.detailMove.addEventListener('click', () => handlers.onDetailMove?.());
  els.detailPlus.addEventListener('click', () => handlers.onPlus?.());
  els.detailPeekPlus.addEventListener('click', () => handlers.onPlus?.());
  els.detailPlusDate.addEventListener('click', () => handlers.onPlusWithDate?.());
  els.detailDelete.addEventListener('click', () => handlers.onDelete?.());
  els.detailStars.addEventListener('click', (e) => {
    const star = e.target.closest('.star');
    if (!star) return;
    star.classList.add('is-pop');
    star.addEventListener('animationend', () => star.classList.remove('is-pop'), { once: true });
    handlers.onRating?.(Number(star.dataset.value));
  });
  els.detailVisits.addEventListener('click', (e) => {
    const btn = e.target.closest('.visit');
    if (btn) handlers.onVisitTap?.(btn.dataset.visitId);
  });
  const notesChanged = debounce(() => handlers.onNotesChange?.(els.detailNotes.value), 800);
  els.detailNotes.addEventListener('input', () => {
    autoGrow(els.detailNotes);
    notesChanged();
  });
  els.detailNotes.addEventListener('blur', () => handlers.onNotesChange?.(els.detailNotes.value));
  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(84, textarea.scrollHeight)}px`;
  }

  function renderDetail(place, { isFav = false, highlightVisitId = null } = {}) {
    const isNew = currentPlaceId !== place.id;
    currentPlaceId = place.id;
    const count = place.visits.length;
    const pending = place.status === 'pending';
    const last = place.visits[0];

    els.detailFav.hidden = !isFav;
    els.detailName.textContent = place.name;
    els.detailAddress.textContent = place.address || 'Sin dirección';
    els.detailCounter.classList.toggle('is-pending', pending);
    els.detailCount.textContent = pending ? '' : `×${count}`;
    els.detailCount.hidden = pending;
    els.detailLast.textContent = pending
      ? 'Todavía no hemos ido'
      : last
        ? count === 1 ? `el ${formatShort(last.date)}` : `última el ${formatShort(last.date)}`
        : 'Sin visitas apuntadas';
    els.detailPlus.textContent = pending ? 'Hemos ido hoy' : '+1 visita · hoy';
    els.detailPeekName.textContent = place.name;
    els.detailPeekCount.textContent = pending ? '' : `×${count}`;
    els.detailPeekPlus.textContent = pending ? 'Hemos ido' : '+1';
    els.detailDirections.href = directionsUrl(place);

    els.detailStars.innerHTML = [1, 2, 3, 4, 5]
      .map((n) => `<button type="button" class="star ${place.rating >= n ? 'is-on' : ''}" data-value="${n}" role="radio" aria-checked="${place.rating === n}" aria-label="${place.rating ? `Puntuación: ${n} de 5` : 'Sin puntuar'}">🍣</button>`)
      .join('');

    els.detailVisits.innerHTML = place.visits
      .map((v) => {
        const rel = relativeDate(v.date);
        const tag = rel === 'hoy' || rel === 'ayer' ? `<span class="visit__tag">${rel}</span>` : '';
        return `<li><button type="button" class="visit ${v.id === highlightVisitId ? 'is-new' : ''}" data-visit-id="${escapeHtml(v.id)}"><span class="visit__text"><span class="visit__date">${escapeHtml(formatShort(v.date))}${tag}</span>${v.note ? `<span class="visit__note">${escapeHtml(v.note)}</span>` : ''}</span><span class="visit__chev" aria-hidden="true">›</span></button></li>`;
      })
      .join('');
    els.detailVisitsEmpty.hidden = count > 0;

    if (isNew || document.activeElement !== els.detailNotes) {
      els.detailNotes.value = place.notes || '';
      els.detailNotesHint.classList.remove('is-on');
      requestAnimationFrame(() => autoGrow(els.detailNotes));
    }
  }
  function setNotesSaved() {
    els.detailNotesHint.textContent = 'Guardado';
    els.detailNotesHint.classList.add('is-on');
    setTimeout(() => els.detailNotesHint.classList.remove('is-on'), 1200);
  }
  function popCounter() {
    for (const el of [els.detailCount, els.detailPeekCount]) {
      el.classList.remove('is-pop');
      void el.offsetWidth;
      el.classList.add('is-pop');
      el.addEventListener('animationend', () => el.classList.remove('is-pop'), { once: true });
    }
  }
  function guardDoubleTap() {
    for (const el of [els.detailPlus, els.detailPeekPlus]) {
      el.disabled = true;
      setTimeout(() => (el.disabled = false), 600);
    }
  }
  function directionsUrl(place) {
    const ua = navigator.userAgent;
    const isApple = /iPhone|iPad|iPod|Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|CriOS|Android/.test(ua);
    const q = `${place.lat.toFixed(6)},${place.lng.toFixed(6)}`;
    return isApple ? `https://maps.apple.com/?daddr=${q}&q=${encodeURIComponent(place.name)}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  }

  // ---------------------------------------------------------------------------
  // Nuevo sitio
  // ---------------------------------------------------------------------------
  els.newCancel.addEventListener('click', () => handlers.onNewCancel?.());
  els.newPeekClose.addEventListener('click', () => handlers.onNewCancel?.());
  els.newVisited.addEventListener('click', () => handlers.onNewSave?.('visited', getCandidateForm()));
  els.newPending.addEventListener('click', () => handlers.onNewSave?.('pending', getCandidateForm()));
  els.newDupeOpen.addEventListener('click', () => handlers.onNewDupeOpen?.());
  els.newName.addEventListener('input', () => {
    syncCandidateButtons();
    if (els.newName.value.trim()) els.newHint.textContent = '';
  });
  els.newName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (els.newName.value.trim()) handlers.onNewSave?.('visited', getCandidateForm());
      else els.newHint.textContent = 'Ponle un nombre para guardarlo.';
    }
  });
  function syncCandidateButtons() {
    const empty = !els.newName.value.trim();
    els.newVisited.disabled = empty;
    els.newPending.disabled = empty;
  }
  function renderCandidate({ name, address, loadingAddress = false, dupe = false, focusName = false }) {
    els.newName.value = name || '';
    els.newAddress.value = address || '';
    els.newAddress.placeholder = loadingAddress ? 'Buscando dirección…' : 'Sin dirección';
    els.newAddressSpinner.hidden = !loadingAddress;
    els.newHint.textContent = '';
    els.newDupe.hidden = !dupe;
    syncCandidateButtons();
    if (focusName) setTimeout(() => els.newName.focus({ preventScroll: true }), 80);
  }
  function updateCandidate({ name, address, loadingAddress, placeholder }) {
    if (name != null && !els.newName.value) {
      els.newName.value = name;
      syncCandidateButtons();
    }
    if (address != null && !els.newAddress.value) els.newAddress.value = address;
    if (loadingAddress != null) {
      els.newAddressSpinner.hidden = !loadingAddress;
      els.newAddress.placeholder = loadingAddress ? 'Buscando dirección…' : placeholder || 'Sin dirección';
    }
  }
  function setCandidateHint(text) {
    els.newHint.textContent = text || '';
  }
  function getCandidateForm() {
    return { name: els.newName.value.trim(), address: els.newAddress.value.trim() };
  }

  // ---------------------------------------------------------------------------
  // Avisos: uno cada vez
  // ---------------------------------------------------------------------------
  let toastTimer = null;
  function toast(message, { action, onAction, duration } = {}) {
    els.toasts.innerHTML = '';
    clearTimeout(toastTimer);
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = message;
    el.appendChild(text);
    const remove = () => {
      clearTimeout(toastTimer);
      el.remove();
    };
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast__action';
      btn.textContent = action;
      btn.addEventListener('click', () => {
        remove();
        onAction?.();
      });
      el.appendChild(btn);
    }
    els.toasts.appendChild(el);
    toastTimer = setTimeout(remove, duration ?? (action ? 6000 : 3500));
    return remove;
  }

  // ---------------------------------------------------------------------------
  // Diálogos
  // ---------------------------------------------------------------------------
  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else dialog.setAttribute('open', '');
  }
  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function confirm({ title, text, ok = 'Aceptar', cancel = 'Cancelar', danger = false }) {
    return new Promise((resolve) => {
      els.confirmTitle.textContent = title;
      els.confirmText.textContent = text || '';
      els.confirmText.hidden = !text;
      els.confirmOk.textContent = ok;
      els.confirmOk.classList.toggle('is-danger', danger);
      els.confirmCancel.hidden = cancel == null;
      if (cancel) els.confirmCancel.textContent = cancel;
      const done = (value) => {
        els.confirmOk.removeEventListener('click', onOk);
        els.confirmCancel.removeEventListener('click', onCancel);
        els.confirmDialog.removeEventListener('close', onClose);
        closeDialog(els.confirmDialog);
        resolve(value);
      };
      const onOk = () => done(true);
      const onCancel = () => done(false);
      const onClose = () => done(false);
      els.confirmOk.addEventListener('click', onOk);
      els.confirmCancel.addEventListener('click', onCancel);
      els.confirmDialog.addEventListener('close', onClose);
      openDialog(els.confirmDialog);
      els.confirmOk.focus();
    });
  }

  /** Resuelve con {date, note}, con {remove: true} o con null si se cancela. */
  function visitDialog({ title = 'Visita', date = todayISO(), note = '', canRemove = false } = {}) {
    return new Promise((resolve) => {
      els.visitTitle.textContent = title;
      els.visitDate.value = date;
      els.visitDate.max = todayISO();
      els.visitNote.value = note;
      els.visitNote.placeholder = NOTE_PLACEHOLDERS[notePlaceholderIndex++ % NOTE_PLACEHOLDERS.length];
      els.visitError.hidden = true;
      els.visitRemove.hidden = !canRemove;
      const done = (value) => {
        els.visitForm.removeEventListener('submit', onSubmit);
        els.visitCancel.removeEventListener('click', onCancel);
        els.visitRemove.removeEventListener('click', onRemove);
        els.visitDialog.removeEventListener('close', onClose);
        closeDialog(els.visitDialog);
        resolve(value);
      };
      const onSubmit = (e) => {
        e.preventDefault();
        const value = { date: els.visitDate.value, note: els.visitNote.value.trim() };
        if (!value.date) {
          els.visitError.textContent = 'La fecha no es válida.';
          els.visitError.hidden = false;
          return;
        }
        done(value);
      };
      const onCancel = () => done(null);
      const onRemove = () => done({ remove: true });
      const onClose = () => done(null);
      els.visitForm.addEventListener('submit', onSubmit);
      els.visitCancel.addEventListener('click', onCancel);
      els.visitRemove.addEventListener('click', onRemove);
      els.visitDialog.addEventListener('close', onClose);
      openDialog(els.visitDialog);
    });
  }

  function editDialog({ name = '', address = '' } = {}) {
    return new Promise((resolve) => {
      els.editName.value = name;
      els.editAddress.value = address;
      els.editError.hidden = true;
      const done = (value) => {
        els.editForm.removeEventListener('submit', onSubmit);
        els.editCancel.removeEventListener('click', onCancel);
        els.editDialog.removeEventListener('close', onClose);
        closeDialog(els.editDialog);
        resolve(value);
      };
      const onSubmit = (e) => {
        e.preventDefault();
        const value = { name: els.editName.value.trim(), address: els.editAddress.value.trim() };
        if (!value.name) {
          els.editError.textContent = 'Ponle un nombre para guardarlo.';
          els.editError.hidden = false;
          return;
        }
        done(value);
      };
      const onCancel = () => done(null);
      const onClose = () => done(null);
      els.editForm.addEventListener('submit', onSubmit);
      els.editCancel.addEventListener('click', onCancel);
      els.editDialog.addEventListener('close', onClose);
      openDialog(els.editDialog);
      setTimeout(() => els.editName.focus(), 50);
    });
  }

  /** Posición vertical (px) del borde visible de la hoja, para centrar cosas en la franja del mapa. */
  function sheetTop() {
    return isDesktop() ? window.innerHeight : els.panel.getBoundingClientRect().top;
  }

  return {
    els,
    isDesktop,
    showSplash,
    setSplashText,
    showLogin,
    showApp,
    setLoginBusy,
    setLoginError,
    setThemePref,
    getThemePref,
    getTheme,
    setBranding,
    setSearchValue,
    focusSearch,
    hideResults,
    renderResults,
    setMenuOpen,
    setMenuFooter,
    setNearbyState,
    setLocateBusy,
    setCrosshair,
    setOnline,
    setDemoChip,
    showView,
    getView,
    setSheet,
    getSheet,
    sheetTop,
    renderStats,
    renderList,
    renderDetail,
    setNotesSaved,
    popCounter,
    guardDoubleTap,
    renderCandidate,
    updateCandidate,
    setCandidateHint,
    getCandidateForm,
    toast,
    confirm,
    visitDialog,
    editDialog,
  };
}
