'use strict';
/* =====================================================================
   Globale Helfer + Navigation (Dock im Apple-Music-Stil)
   ===================================================================== */

const CONFIG = (function () {
  const el = document.getElementById('app-config');
  try { return el ? JSON.parse(el.textContent) : {}; } catch (e) { return {}; }
})();
const USER_ROLE = document.body.dataset.role || '';
const APP_NAME = CONFIG.app_name || '';
const MONTHS = CONFIG.months_de || [];
const WEEKDAYS_SHORT = CONFIG.weekday_short_de || ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const SPORT_KEYS = { 'Fußball': 'fussball', 'Tennis': 'tennis', 'Floorball': 'floorball', 'Basketball': 'basketball', 'Volleyball': 'volleyball', 'Gym': 'gym', 'Allgemein': 'allgemein' };
const EVENT_ICONS = { spiel: 'whistle', turnier: 'trophy', sonstiges: 'calendar' };

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function storageGet(store, key) { try { return window[store].getItem(key); } catch (e) { return null; } }
function storageSet(store, key, val) { try { window[store].setItem(key, val); } catch (e) { /* ignorieren */ } }
function storageDel(store, key) { try { window[store].removeItem(key); } catch (e) { /* ignorieren */ } }

/* ---------------------------------------------------------------- Ausgabe */
function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function icon(name, cls) { return '<svg class="i ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
function sportKey(sport) { return SPORT_KEYS[sport] || 'allgemein'; }
function sportColor(sport) { return 'var(--s-' + sportKey(sport) + ')'; }
function sportMotif(sport, cls) { return '<svg class="' + (cls || 'motif') + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#s-' + sportKey(sport) + '"/></svg>'; }
function sportIcon(sport, cls) { return '<svg class="i ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#s-' + sportKey(sport) + '"/></svg>'; }
function sportArt(sport, cls, big) {
  return '<div class="sport-art ' + (cls || '') + '" style="--c:' + sportColor(sport) + '">' +
    (big ? sportMotif(sport, 'motif big-bg') : '') + sportMotif(sport) + '</div>';
}
function imgUrl(path) { if (!path) return ''; return String(path).startsWith('http') ? path : '/uploads/' + encodeURIComponent(path); }
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function avatarHtml(path, name, cls) {
  return path ? '<span class="avatar ' + (cls || '') + '"><img src="' + escHtml(imgUrl(path)) + '" alt="" loading="lazy"></span>'
    : '<span class="avatar ' + (cls || '') + '">' + escHtml(initials(name)) + '</span>';
}
function exMediaHtml(ex, big) {
  return ex.image_path ? '<img class="ex-img" src="' + escHtml(imgUrl(ex.image_path)) + '" alt="" loading="lazy">' : sportArt(ex.sport, 'ex-img', big);
}
function exMetaHtml(ex) {
  const rows = [['users', 'Feldspieler', ex.field_players], ['goal', 'Torhüter', ex.goalkeepers], ['target', 'Kernkompetenz', ex.core_competency],
    ['field', 'Spielfeld', ex.field_size], ['gauge', 'Schwierigkeit', ex.difficulty]];
  return '<div class="meta-grid"><div class="meta-cell"><span class="sport-ic sm" style="--c:' + sportColor(ex.sport) + '">' + sportIcon(ex.sport) + '</span><span><small>Sportart</small><b>' + escHtml(ex.sport) + '</b></span></div>' +
    rows.map((r) => '<div class="meta-cell">' + icon(r[0]) + '<span><small>' + r[1] + '</small><b>' + escHtml(r[2]) + '</b></span></div>').join('') + '</div>';
}
/* Seitenskripte binden sich nur an ihre eigene, frisch geladene Seite und nur einmal
   (wichtig beim schnellen Tab-Wechsel ohne Neuladen) */
function claimPage(id) {
  const el = document.getElementById(id);
  if (!el || el.dataset.bound) return null;
  el.dataset.bound = '1';
  return el;
}
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function emptyState(ic, title, text, actionHtml, compact) {
  return '<div class="empty' + (compact ? ' compact' : '') + '"><div class="empty-ic">' + icon(ic) + '</div><h3>' + escHtml(title) + '</h3>' +
    (text ? '<p>' + escHtml(text) + '</p>' : '') + (actionHtml || '') + '</div>';
}
function renderError(container, message, retry) {
  if (!container) return;
  container.innerHTML = '<div class="error-state"><div class="empty-ic" style="background:var(--danger-soft);color:var(--danger)">' + icon('alert') +
    '</div><p>' + escHtml(message || 'Laden fehlgeschlagen') + '</p>' + (retry ? '<button class="btn btn-tinted btn-sm" type="button" data-retry>' + icon('refresh', 'sm') + 'Erneut versuchen</button>' : '') + '</div>';
  if (retry) container.querySelector('[data-retry]').addEventListener('click', retry);
}
function skeletonCards(n, cls) { let h = ''; for (let i = 0; i < (n || 3); i++) h += '<div class="skeleton ' + (cls || 'sk-card') + '"></div>'; return h; }

/* ---------------------------------------------------------------- Datum */
function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseISO(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function todayISO() { return toISO(new Date()); }
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function weekdayIdx(d) { return (d.getDay() + 6) % 7; }
function mondayOf(d) { const m = new Date(d); m.setDate(m.getDate() - weekdayIdx(m)); return m; }
function fmtDateLong(iso) { const d = parseISO(iso); return d.getDate() + '. ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtDateShort(iso) { const d = parseISO(iso); return d.getDate() + '. ' + MONTHS[d.getMonth()]; }
function fmtWeekdayDate(iso) { const d = parseISO(iso); return WEEKDAYS_LONG[weekdayIdx(d)] + ', ' + d.getDate() + '. ' + MONTHS[d.getMonth()]; }
function relDayLabel(iso) {
  const diff = Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
  const labels = CONFIG.relative_day_labels || ['Heute', 'Morgen', 'Übermorgen'];
  if (diff >= 0 && diff < labels.length) return labels[diff];
  const d = parseISO(iso);
  return WEEKDAYS_SHORT[weekdayIdx(d)] + ', ' + d.getDate() + '. ' + MONTHS[d.getMonth()];
}
function ageFrom(birthday) {
  if (!birthday) return null;
  const b = parseISO(birthday), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
function isBirthdayToday(birthday) {
  if (!birthday) return false;
  const b = parseISO(birthday), t = new Date();
  return b.getDate() === t.getDate() && b.getMonth() === t.getMonth();
}
function debounce(fn, ms) { let t; return function () { const args = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); }; }

/* ---------------------------------------------------------------- API */
/* Laufende Anfragen der aktuellen Seite; beim Tab-Wechsel abgebrochen (siehe softNavigate) */
let PAGE_ABORT = new AbortController();
class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data; } }
async function api(url, opts) {
  opts = opts || {};
  const headers = { 'X-Requested-With': 'fetch', 'Accept': 'application/json' };
  let payload;
  if (opts.form) payload = opts.form;
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(opts.body); }
  const sig = opts.keep ? null : PAGE_ABORT.signal;
  let res;
  try {
    res = await fetch(url, { method: opts.method || 'GET', headers: headers, body: payload, credentials: 'same-origin', signal: sig || undefined });
  } catch (e) {
    if (e && e.name === 'AbortError') return new Promise(() => {});  // Seite verlassen: Antwort verwerfen
    throw new ApiError('Keine Verbindung. Bitte prüfe deine Internetverbindung.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (sig && sig.aborted) return new Promise(() => {});
  if (!res.ok) {
    if (res.status === 401 && !opts.noRedirect) { location.href = '/login'; }
    const msg = (data && data.error) || (res.status === 413 ? 'Bild zu groß (max. 16 MB)' : 'Unerwarteter Fehler (' + res.status + ')');
    throw new ApiError(msg, res.status, data);
  }
  return data;
}
/* Doppelklick-Schutz: Button waehrend des Requests deaktivieren */
async function withBusy(btn, fn) {
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  try { return await fn(); }
  finally { if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
}

/* ---------------------------------------------------------------- Toast */
function showToast(message, type) {
  type = type || 'info';
  const host = document.getElementById('toastHost') || (function () { const h = document.createElement('div'); h.id = 'toastHost'; h.className = 'toast-host'; document.body.appendChild(h); return h; })();
  const el = document.createElement('div');
  el.className = 'toast glass ' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = '<span class="t-ic">' + icon(type === 'success' ? 'check' : type === 'error' ? 'x' : 'info') + '</span><span>' + escHtml(message) + '</span>';
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 3000);
}

/* ---------------------------------------------------------------- Modal / Bottom-Sheet */
const modalStack = [];
function lockScroll(lock) {
  const sc = document.getElementById('scroller');
  if (sc) sc.style.overflowY = lock ? 'hidden' : '';
  document.body.style.overflow = lock ? 'hidden' : '';
}
function openModal(title, html, size, opts) {
  opts = opts || {};
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal glass ' + (size || '') + '" role="dialog" aria-modal="true" aria-label="' + escHtml(title) + '">' +
    '<div class="sheet-handle"></div><div class="modal-head"><h2>' + escHtml(title) + '</h2>' +
    '<button class="icon-btn sm" type="button" data-close aria-label="Schließen">' + icon('x', 'sm') + '</button></div>' +
    '<div class="modal-body">' + html + '</div></div>';
  overlay.addEventListener('mousedown', (e) => { overlay._downOnOverlay = e.target === overlay; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay && overlay._downOnOverlay) closeModal(); });
  overlay.querySelector('[data-close]').addEventListener('click', () => closeModal());
  document.body.appendChild(overlay);
  modalStack.push({ overlay: overlay, onClose: opts.onClose });
  lockScroll(true);
  enableSheetDrag(overlay);
  const first = overlay.querySelector('.modal-body input:not([type=hidden]):not([type=checkbox]):not([type=file]), .modal-body textarea');
  if (first && opts.autofocus !== false && window.matchMedia('(min-width: 641px)').matches) setTimeout(() => first.focus(), 60);
  return overlay.querySelector('.modal-body');
}
function closeModal() {
  const top = modalStack.pop();
  if (!top) return;
  top.overlay.classList.add('out');
  setTimeout(() => top.overlay.remove(), 240);
  if (!modalStack.length) lockScroll(false);
  if (top.onClose) top.onClose();
}
function enableSheetDrag(overlay) {
  const modal = overlay.querySelector('.modal');
  const grips = [overlay.querySelector('.sheet-handle'), overlay.querySelector('.modal-head')];
  let startY = null, dy = 0;
  grips.forEach((g) => {
    g.addEventListener('pointerdown', (e) => {
      if (!window.matchMedia('(max-width: 640px)').matches || e.target.closest('button')) return;
      startY = e.clientY; dy = 0; modal.style.transition = 'none'; g.setPointerCapture(e.pointerId);
    });
    g.addEventListener('pointermove', (e) => {
      if (startY == null) return;
      dy = Math.max(0, e.clientY - startY); modal.style.transform = 'translateY(' + dy + 'px)';
    });
    const end = () => {
      if (startY == null) return;
      startY = null; modal.style.transition = 'transform .3s var(--ease-out)';
      if (dy > 110) { modal.style.transform = 'translateY(100%)'; setTimeout(closeModal, 200); }
      else modal.style.transform = '';
    };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalStack.length) closeModal(); });

function confirmDialog(o) {
  return new Promise((resolve) => {
    let done = false;
    const body = openModal(o.title || 'Bist du sicher?', '<p class="muted">' + escHtml(o.message || '') + '</p>' + (o.extraHtml || '') +
      '<div class="modal-foot"><button class="btn" type="button" data-no>Abbrechen</button>' +
      '<button class="btn ' + (o.danger ? 'btn-danger solid' : 'btn-primary') + '" type="button" data-yes>' + escHtml(o.confirmText || 'Bestätigen') + '</button></div>',
      'sm', { onClose: () => { if (!done) { done = true; resolve(false); } } });
    body.querySelector('[data-no]').addEventListener('click', () => closeModal());
    body.querySelector('[data-yes]').addEventListener('click', () => { done = true; resolve(o.returnBody ? body : true); closeModal(); });
  });
}

/* Popover am body (position: fixed), unabhaengig von Stacking-Contexts */
function openPopover(anchor, html, opts) {
  opts = opts || {};
  closePopover();
  const back = document.createElement('div'); back.className = 'popover-backdrop';
  const pop = document.createElement('div'); pop.className = 'popover glass'; pop.innerHTML = html;
  document.body.appendChild(back); document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let left = opts.alignLeft ? r.left : r.right - pw;
  left = Math.max(10, Math.min(left, vw - pw - 10));
  let top = r.bottom + 8, originY = 'top';
  if (top + ph > vh - 10) { top = r.top - ph - 8; originY = 'bottom'; }
  pop.style.left = left + 'px'; pop.style.top = Math.max(10, top) + 'px';
  pop.style.setProperty('--origin', originY + ' ' + (opts.alignLeft ? 'left' : 'right'));
  back.addEventListener('click', closePopover);
  openPopover.current = { pop: pop, back: back };
  return pop;
}
function closePopover() {
  const c = openPopover.current;
  if (!c) return;
  openPopover.current = null;
  c.back.remove(); c.pop.classList.add('out'); setTimeout(() => c.pop.remove(), 200);
}

/* ---------------------------------------------------------------- Teilen / Kopieren */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove(); return ok;
  }
}
async function shareOrCopy(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title: title, url: url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  showToast(await copyText(url) ? 'Link kopiert' : 'Kopieren nicht möglich', 'success');
}

/* ---------------------------------------------------------------- Passwort-Felder */
function bindPwToggles(root) {
  $$('[data-pw-toggle]', root).forEach((btn) => btn.addEventListener('click', () => {
    const inp = document.getElementById(btn.dataset.pwToggle);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = icon(show ? 'eye-off' : 'eye', 'sm');
    btn.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
  }));
}
function pwStrength(pw) {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
function updateStrength(pw, bar) {
  const s = pw ? pwStrength(pw) : 0;
  const colors = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--success)', 'var(--success)'];
  bar.style.width = (pw ? Math.max(12, s * 25) : 0) + '%';
  bar.style.background = colors[s];
  const labels = ['Sehr schwach', 'Schwach', 'Mittel', 'Stark', 'Sehr stark'];
  bar.parentElement.title = pw ? labels[s] : '';
  return labels[s];
}

/* ---------------------------------------------------------------- Neues Training (global) */
function openNewTrainingDialog(o) {
  o = o || {};
  const body = openModal('Neues Training',
    '<form id="ntForm" novalidate><div class="field"><label for="ntTitle">Titel</label><input class="input" id="ntTitle" maxlength="120" required placeholder="z. B. Passspiel & Abschluss"></div>' +
    '<div class="form-row"><div class="field"><label for="ntDate">Datum</label><input class="input" type="date" id="ntDate" required value="' + escHtml(o.date || todayISO()) + '"></div>' +
    '<div class="field"><label for="ntTime">Uhrzeit (optional)</label><input class="input" type="time" id="ntTime"></div></div>' +
    '<p class="form-error" id="ntErr"></p><div class="modal-foot"><button class="btn" type="button" data-cancel>Abbrechen</button>' +
    '<button class="btn btn-primary" type="submit">' + icon('check', 'sm') + 'Anlegen</button></div></form>');
  body.querySelector('[data-cancel]').addEventListener('click', () => closeModal());
  const form = body.querySelector('#ntForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#ntTitle', form).value.trim(), date = $('#ntDate', form).value, time = $('#ntTime', form).value;
    const errEl = $('#ntErr', form);
    if (!title) { errEl.textContent = 'Bitte gib einen Titel ein.'; return; }
    if (!date) { errEl.textContent = 'Bitte wähle ein Datum.'; return; }
    withBusy(form.querySelector('[type=submit]'), async () => {
      try {
        const res = await api('/api/trainings', { method: 'POST', body: { title: title, date: date, time: time || null } });
        if (o.onCreated) { closeModal(); o.onCreated(res.id); }
        else location.href = '/training/' + res.id;
      } catch (err) { errEl.textContent = err.message; }
    });
  });
}

/* ---------------------------------------------------------------- Schnell-Erstellen */
window.QUICK_HANDLERS = window.QUICK_HANDLERS || {};
function openQuickCreate(anchor) {
  const items = [
    { key: 'training', ic: 'clipboard', label: 'Neues Training', href: '/my-trainings?new=1' },
    USER_ROLE === 'trainer' ? { key: 'event', ic: 'cal-plus', label: 'Neuer Termin', href: '/calendar?new=event' } : null,
    { key: 'exercise', ic: 'cones', label: 'Neue Übung', href: '/exercises?new=1' },
  ].filter(Boolean);
  const pop = openPopover(anchor, items.map((it) => '<button class="menu-item" type="button" data-key="' + it.key + '" data-href="' + it.href + '">' + icon(it.ic) + escHtml(it.label) + '</button>').join(''), { alignLeft: anchor.closest('.sidebar') != null });
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('.menu-item'); if (!b) return;
    closePopover();
    const h = window.QUICK_HANDLERS[b.dataset.key];
    if (h) h(); else if (b.dataset.key === 'training') openNewTrainingDialog(); else location.href = b.dataset.href;
  });
}

/* ---------------------------------------------------------------- Dock: Linse, Ziehen, Minimieren */
function initDock() {
  const dock = document.getElementById('dock');
  const bar = document.getElementById('tabbar');
  const lens = document.getElementById('tabLens');
  const scroller = document.getElementById('scroller');
  if (!dock || !bar || !lens) return;
  const tabs = $$('.tab', bar);
  let active = tabs.find((t) => t.classList.contains('active')) || null;

  function placeLens(tab, instant) {
    if (!tab || dock.classList.contains('mini')) { lens.style.opacity = tab ? '' : '0'; return; }
    const br = bar.getBoundingClientRect(), tr = tab.getBoundingClientRect();
    if (instant) lens.style.transition = 'none';
    lens.style.width = tr.width + 'px';
    lens.style.transform = 'translateX(' + (tr.left - br.left) + 'px)';
    lens.style.opacity = '1';
    if (instant) { lens.offsetWidth; lens.style.transition = ''; }
  }
  const tabAt = (x) => tabs.find((t) => { const r = t.getBoundingClientRect(); return x >= r.left && x <= r.right; });
  requestAnimationFrame(() => placeLens(active, true));
  window.addEventListener('resize', () => placeLens(active, true));

  let drag = null, suppressClick = false;
  bar.addEventListener('pointerdown', (e) => {
    if (dock.classList.contains('mini')) return;
    drag = { x: e.clientX, id: e.pointerId, moved: false };
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 7) return;
    if (!drag.moved) { drag.moved = true; bar.classList.add('dragging'); try { bar.setPointerCapture(e.pointerId); } catch (err) { /* ok */ } }
    const br = bar.getBoundingClientRect(), w = lens.offsetWidth;
    const x = Math.max(4, Math.min(e.clientX - br.left - w / 2, br.width - w - 4));
    lens.style.transform = 'translateX(' + x + 'px)';
    const over = tabAt(e.clientX);
    tabs.forEach((t) => t.classList.toggle('hover', t === over));
  });
  const endDrag = (e) => {
    if (!drag) return;
    const wasDrag = drag.moved; drag = null;
    bar.classList.remove('dragging');
    tabs.forEach((t) => t.classList.remove('hover'));
    if (!wasDrag) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 50);
    const target = tabAt(e.clientX) || active;
    go(target);
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  function go(tab) {
    if (!tab) return;
    placeLens(tab);
    if (tab === active) return;
    setActive(tab);
    softNavigate(tab.getAttribute('href'));
  }
  function setActive(tab) {
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    active = tab;
    placeLens(tab);
  }
  window.DOCK = {
    setActiveHref(href) { setActive(tabs.find((t) => t.getAttribute('href') === href) || null); },
    expand() { setMini(false); },
  };
  bar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    e.preventDefault();
    if (suppressClick) return;
    if (dock.classList.contains('mini')) { setMini(false); return; }
    go(tab);
  });

  function setMini(on) {
    if (dock.classList.contains('mini') === on) return;
    dock.classList.toggle('mini', on);
    if (!on) setTimeout(() => placeLens(active, false), 60);
  }
  bar.addEventListener('transitionend', (e) => { if (e.propertyName === 'right' && !dock.classList.contains('mini')) placeLens(active); });

  if (scroller) {
    let lastY = scroller.scrollTop, ticking = false;
    scroller.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = scroller.scrollTop, dy = y - lastY;
        const atBottom = y + scroller.clientHeight >= scroller.scrollHeight - 4;
        if (y < 40) setMini(false);
        else if (dy > 6 && y > 80) setMini(true);
        else if (dy < -10 && !atBottom) setMini(false);
        lastY = y; ticking = false;
      });
    }, { passive: true });
  }
}

/* Large Title -> kompakte Titelleiste */
function initTopbar() {
  const topbar = document.getElementById('topbar'), scroller = document.getElementById('scroller');
  if (!topbar || !scroller) return;
  let shown = null;
  const update = () => {
    const h1 = document.querySelector('.page .large-title');
    const show = !!h1 && h1.getBoundingClientRect().bottom < scroller.getBoundingClientRect().top + 44;
    if (show === shown) return;
    shown = show;
    if (!h1) { topbar.classList.remove('show'); return; }
    $('#topbarTitle').textContent = h1.textContent.trim();
    topbar.classList.toggle('show', show);
  };
  scroller.addEventListener('scroll', update, { passive: true });
  window.addEventListener('pagechange', () => { shown = null; update(); });
  update();
}

/* "Als Naechstes" (Accessory ueber der Tab-Leiste, wie der Mini-Player) */
async function loadNextUp() {
  const links = $$('[data-next-up-link]');
  if (!links.length) return;
  let item = null;
  try { item = (await api('/api/next-up', { keep: true })).item; } catch (e) { item = null; }
  let title = 'Nichts geplant', sub = 'Tippe, um ein Training zu planen', href = '/my-trainings?new=1', art = 'background:var(--accent-grad)', ic = icon('plus');
  if (item) {
    title = item.title;
    sub = relDayLabel(item.date) + (item.time ? ', ' + item.time : '') + ' · ' + (item.kind === 'training' ? 'Training' : (CONFIG.event_type_labels || {})[item.type] || 'Termin');
    if (item.kind === 'training') { href = '/training/' + item.id; art = 'background:' + sportColor(item.sport); ic = sportIcon(item.sport); }
    else { href = '/calendar?date=' + item.date; art = 'background:var(--ev-' + item.type + ')'; ic = icon(EVENT_ICONS[item.type] || 'calendar'); }
  }
  links.forEach((a) => {
    a.setAttribute('href', href);
    $('[data-next-up-title]', a).textContent = title;
    $('[data-next-up-sub]', a).textContent = sub;
    const artEl = $('[data-next-up-art]', a); artEl.setAttribute('style', art); artEl.innerHTML = ic;
  });
}

/* Splash nur im Standalone-Modus, einmal pro Sitzung */
function initSplash() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (!standalone || storageGet('sessionStorage', 'splashShown')) return;
  storageSet('sessionStorage', 'splashShown', '1');
  const s = document.createElement('div');
  s.className = 'splash';
  s.innerHTML = '<img src="/static/icons/icon-192.png" alt=""><div class="splash-name">' + escHtml(APP_NAME) + '</div><div class="splash-ver">Version ' + escHtml(CONFIG.app_version || '') + '</div>';
  document.body.appendChild(s);
  setTimeout(() => { s.classList.add('out'); setTimeout(() => s.remove(), 520); }, 1700);
}

/* Wischen links/rechts wechselt auf dem Handy zwischen den Haupt-Tabs
   (nur auf den Tab-Seiten selbst, nicht in Karussells, Formularen, Dialogen oder beim Sortieren). */
function initSwipeNav() {
  const scroller = document.getElementById('scroller');
  const tabs = $$('#tabbar .tab');
  if (!scroller || !tabs.length) return;
  const page = () => $('.page', scroller);
  const hrefAt = (i) => (tabs[i] ? tabs[i].getAttribute('href') : null);
  const curIdx = () => tabs.findIndex((t) => t.getAttribute('href') === location.pathname);
  const mobile = () => window.matchMedia('(max-width: 900px)').matches;
  const BLOCK = 'input, textarea, select, button.chip, .grip, .chips, .hscroll, .cal-main, .segmented, [data-no-swipe]';
  const blocked = (el) => {
    for (let n = el; n && n !== scroller; n = n.parentElement) {
      if (n.matches && n.matches(BLOCK)) return true;
      if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  };
  const reset = () => {
    const p = page(); if (!p) return;
    p.style.transition = 'transform .4s var(--ease-spring), opacity .25s';
    p.style.transform = ''; p.style.opacity = '';
  };
  let st = null;
  scroller.addEventListener('touchstart', (e) => {
    st = null;
    if (!mobile() || e.touches.length !== 1 || modalStack.length || ROUTER.busy || document.querySelector('.live, .tx-ghost')) return;
    const idx = curIdx(), t = e.touches[0];
    if (idx < 0 || t.clientX < 20 || t.clientX > window.innerWidth - 20 || blocked(e.target)) return;
    st = { x: t.clientX, y: t.clientY, t: Date.now(), dir: null, dx: 0, idx: idx };
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (!st) return;
    const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (!st.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      st.dir = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'h' : 'v';
      if (st.dir === 'h') prefetchPage(hrefAt(st.idx + (dx < 0 ? 1 : -1)));
    }
    if (st.dir !== 'h') return;
    st.dx = dx;
    const target = st.idx + (dx < 0 ? 1 : -1);
    const off = (target >= 0 && target < tabs.length) ? dx * 0.35 : dx * 0.1;  // Gummiband am Rand
    const p = page();
    p.style.transition = 'none';
    p.style.transform = 'translateX(' + off + 'px)';
    p.style.opacity = String(1 - Math.min(0.35, Math.abs(off) / 400));
  }, { passive: true });
  const end = () => {
    if (!st) return;
    const s = st; st = null;
    if (s.dir !== 'h') return;
    const target = s.idx + (s.dx < 0 ? 1 : -1);
    const flick = Math.abs(s.dx) > 45 && Date.now() - s.t < 280;
    if ((Math.abs(s.dx) > 90 || flick) && target >= 0 && target < tabs.length) {
      if (window.DOCK) { window.DOCK.expand(); window.DOCK.setActiveHref(hrefAt(target)); }
      softNavigate(hrefAt(target), { dir: s.dx < 0 ? 1 : -1 });
    } else reset();
  };
  scroller.addEventListener('touchend', end, { passive: true });
  scroller.addEventListener('touchcancel', () => { st = null; reset(); }, { passive: true });
}

/* ---------------------------------------------------------------- Schneller Tab-Wechsel
   Statt die ganze Seite neu zu laden, wird nur der Seiteninhalt (.page) ausgetauscht und das
   Seitenskript neu ausgefuehrt. Tab-Leiste, Hintergrund und Styles bleiben stehen. Nachbar-Tabs
   werden im Leerlauf vorgeladen. Bei jedem Problem: normaler Seitenaufruf als Rueckfall. */
const ROUTER = { cache: new Map(), busy: false };
function prefetchPage(href) {
  if (!href || ROUTER.cache.has(href)) return;
  const entry = { t: Date.now(), p: null };
  entry.p = fetch(href, { credentials: 'same-origin' }).then((r) => {
    if (!r.ok || new URL(r.url).pathname !== href) throw new Error('redirect');
    return r.text();
  });
  entry.p.catch(() => ROUTER.cache.delete(href));
  ROUTER.cache.set(href, entry);
}
function prefetchNeighbors() {
  const hrefs = $$('#tabbar .tab').map((t) => t.getAttribute('href'));
  const i = hrefs.indexOf(location.pathname);
  if (i >= 0) [hrefs[i - 1], hrefs[i + 1]].forEach(prefetchPage);
}
async function softNavigate(href, opts) {
  opts = opts || {};
  if (ROUTER.busy) return;
  const scroller = document.getElementById('scroller');
  const pageEl = scroller && $('.page', scroller);
  if (!pageEl || !window.DOMParser) { location.href = href; return; }
  ROUTER.busy = true;
  try {
    const cached = ROUTER.cache.get(href);
    if (!cached || Date.now() - cached.t > 30000) { ROUTER.cache.delete(href); prefetchPage(href); }
    const html = await ROUTER.cache.get(href).p;
    ROUTER.cache.delete(href);  // beim naechsten Mal frische Daten holen
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const newPage = doc.querySelector('#scroller .page');
    const script = Array.from(doc.querySelectorAll('body > script[src]')).map((x) => x.getAttribute('src'))
      .find((src) => src.indexOf('/core.js') < 0);
    if (!newPage) throw new Error('keine Seite');
    while (modalStack.length) closeModal();
    closePopover();
    PAGE_ABORT.abort();
    PAGE_ABORT = new AbortController();
    window.QUICK_HANDLERS = {};
    if (!opts.pop) history.pushState({ soft: true }, '', href);
    document.title = doc.title;
    document.body.dataset.page = doc.body.dataset.page || '';
    pageEl.innerHTML = newPage.innerHTML;
    scroller.scrollTop = 0;
    $$('.side-link').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === href));
    if (window.DOCK) window.DOCK.setActiveHref(href);
    $$('script[data-page-script]').forEach((x) => x.remove());
    if (script) {
      const el = document.createElement('script');
      el.src = script;
      el.dataset.pageScript = '1';
      document.body.appendChild(el);
    }
    // aus der Wischrichtung einblenden
    pageEl.style.transition = 'none';
    pageEl.style.transform = opts.dir ? 'translateX(' + (opts.dir * 40) + 'px)' : 'translateY(6px)';
    pageEl.style.opacity = '0';
    void pageEl.offsetWidth;
    pageEl.style.transition = 'transform .28s var(--ease-out), opacity .2s';
    pageEl.style.transform = '';
    pageEl.style.opacity = '';
    window.dispatchEvent(new Event('pagechange'));
    setTimeout(prefetchNeighbors, 400);
  } catch (e) {
    location.href = href;
  } finally {
    ROUTER.busy = false;
  }
}
window.addEventListener('popstate', () => {
  const hrefs = $$('#tabbar .tab').map((t) => t.getAttribute('href'));
  if (hrefs.indexOf(location.pathname) >= 0 && !location.search) softNavigate(location.pathname, { pop: true });
  else location.reload();
});

function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
  }
}

document.addEventListener('click', (e) => {
  const qc = e.target.closest('[data-quick-create]');
  if (qc) { e.preventDefault(); openQuickCreate(qc); }
});

initSplash();
initDock();
initSwipeNav();
initTopbar();
loadNextUp();
registerSW();
$$('body > script[src]').filter((x) => x.getAttribute('src').indexOf('/core.js') < 0).forEach((x) => { x.dataset.pageScript = '1'; });
if ($$('#tabbar .tab').some((t) => t.getAttribute('href') === location.pathname)) history.replaceState({ soft: true }, '', location.href);
window.addEventListener('load', () => setTimeout(prefetchNeighbors, 800));
