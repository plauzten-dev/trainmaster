'use strict';
/* Kalender: Monats-/Wochenansicht, Tagesdetail, Termine */
(function () {
  if (!claimPage('calLayout')) return;
  const canEvents = USER_ROLE === 'trainer' || USER_ROLE === 'player';
  const isTrainer = USER_ROLE === 'trainer';
  const qs = new URLSearchParams(location.search);
  const cache = {};          // 'YYYY-MM' -> {trainings, events}
  let teams = null;
  let view = storageGet('localStorage', 'calView') === 'week' ? 'week' : 'month';
  let cursor = new Date();   // Referenzdatum der Ansicht
  let selected = todayISO();
  if (qs.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(qs.get('date'))) { selected = qs.get('date'); cursor = parseISO(selected); }

  const monthKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);

  async function loadMonth(key, force) {
    if (cache[key] && !force) return cache[key];
    const [trainings, events] = await Promise.all([
      api('/api/trainings?month=' + key),
      canEvents ? api('/api/events?month=' + key) : Promise.resolve([]),
    ]);
    cache[key] = { trainings: trainings, events: events };
    return cache[key];
  }
  function itemsFor(iso) {
    const c = cache[iso.slice(0, 7)] || { trainings: [], events: [] };
    const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99');
    return { trainings: c.trainings.filter((t) => t.date === iso).sort(byTime), events: c.events.filter((e) => e.date === iso).sort(byTime) };
  }
  function range() {
    if (view === 'week') { const m = mondayOf(cursor); return { start: toISO(m), days: 7 }; }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = mondayOf(first);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const days = Math.ceil((weekdayIdx(first) + last.getDate()) / 7) * 7;
    return { start: toISO(start), days: days };
  }
  function title() {
    if (view === 'month') return MONTHS[cursor.getMonth()] + ' ' + cursor.getFullYear();
    const a = mondayOf(cursor), b = new Date(a); b.setDate(a.getDate() + 6);
    if (a.getFullYear() !== b.getFullYear()) return a.getDate() + '. ' + MONTHS[a.getMonth()] + ' ' + a.getFullYear() + ' – ' + b.getDate() + '. ' + MONTHS[b.getMonth()] + ' ' + b.getFullYear();
    if (a.getMonth() !== b.getMonth()) return a.getDate() + '. ' + MONTHS[a.getMonth()] + ' – ' + b.getDate() + '. ' + MONTHS[b.getMonth()] + ' ' + b.getFullYear();
    return a.getDate() + '. – ' + b.getDate() + '. ' + MONTHS[a.getMonth()] + ' ' + a.getFullYear();
  }

  async function render() {
    $('#calTitle').textContent = title();
    $$('#calView button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('#calLayout').classList.toggle('week-mode', view === 'week');
    const r = range();
    const keys = new Set();
    for (let i = 0; i < r.days; i += 6) keys.add(addDays(r.start, i).slice(0, 7));
    keys.add(addDays(r.start, r.days - 1).slice(0, 7));
    const main = $('#calMain');
    if ([...keys].some((k) => !cache[k])) main.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try { await Promise.all([...keys].map((k) => loadMonth(k))); }
    catch (err) { renderError(main, err.message, render); return; }
    if (view === 'month') renderMonth(r); else renderWeek(r);
    if (view === 'month') renderDay();
  }

  function chipHtml(kind, it) {
    const color = kind === 'training' ? sportColor(it.sport) : 'var(--ev-' + it.type + ')';
    return '<span class="cal-chip" style="--c:' + color + '">' + (it.time ? '<b>' + escHtml(it.time) + '</b> ' : '') + escHtml(it.title) + '</span>';
  }
  function renderMonth(r) {
    const today = todayISO(), month = cursor.getMonth();
    let html = '<div class="cal-grid"><div class="cal-wd">' + WEEKDAYS_SHORT.map((w) => '<span>' + w + '</span>').join('') + '</div><div class="cal-cells">';
    for (let i = 0; i < r.days; i++) {
      const iso = addDays(r.start, i), d = parseISO(iso), its = itemsFor(iso);
      const all = its.trainings.map((t) => ['training', t]).concat(its.events.map((e) => ['event', e]));
      const cls = ['cal-cell', d.getMonth() !== month ? 'out' : '', iso === today ? 'today' : '', iso === selected ? 'sel' : ''].join(' ');
      html += '<button type="button" class="' + cls + '" data-date="' + iso + '" aria-label="' + escHtml(fmtWeekdayDate(iso)) + (all.length ? ', ' + all.length + ' Einträge' : '') + '">' +
        '<span class="cal-num">' + d.getDate() + '</span><span class="cal-chips">' + all.slice(0, 3).map((x) => chipHtml(x[0], x[1])).join('') +
        (all.length > 3 ? '<span class="cal-more">+' + (all.length - 3) + '</span>' : '') + '</span>' +
        '<span class="cal-dots">' + all.slice(0, 4).map((x) => '<i style="--c:' + (x[0] === 'training' ? sportColor(x[1].sport) : 'var(--ev-' + x[1].type + ')') + '"></i>').join('') + '</span></button>';
    }
    $('#calMain').innerHTML = html + '</div></div>';
  }
  function trainingRow(t) {
    return '<a class="day-item" href="/training/' + t.id + '"><span class="sport-ic" style="--c:' + sportColor(t.sport) + '">' + sportIcon(t.sport) + '</span>' +
      '<span class="li-main"><span class="li-title">' + escHtml(t.title) + '</span><span class="li-sub">' + (t.time ? escHtml(t.time) + ' · ' : '') + plural(t.exercise_count, 'Übung', 'Übungen') +
      (t.owned_by_me ? '' : ' · <span class="badge accent">Vom Trainer</span>') + '</span></span>' + icon('chev-right', 'chev') + '</a>';
  }
  function eventRow(e) {
    const label = (CONFIG.event_type_labels || {})[e.type] || e.type;
    const editable = isTrainer && e.owned_by_me;
    return '<div class="day-item' + (editable ? ' clickable' : '') + '" ' + (editable ? 'data-edit-event="' + e.id + '" role="button" tabindex="0"' : '') + '>' +
      '<span class="sport-ic" style="--c:var(--ev-' + e.type + ')">' + icon(EVENT_ICONS[e.type] || 'calendar') + '</span>' +
      '<span class="li-main"><span class="li-title">' + escHtml(e.title) + '</span><span class="li-sub"><span class="badge" style="background:color-mix(in srgb,var(--ev-' + e.type + ') 16%,transparent);color:var(--ev-' + e.type + ')">' + escHtml(label) + '</span>' +
      (e.time ? ' ' + escHtml(e.time) : '') + (e.location ? ' · ' + escHtml(e.location) : '') + (e.team_name ? ' · ' + escHtml(e.team_name) : '') + '</span></span>' +
      (editable ? '<div class="icon-btn sm plain danger" role="button" tabindex="0" data-del-event="' + e.id + '" aria-label="Termin löschen">' + icon('trash', 'sm') + '</div>' : '') + '</div>';
  }
  function renderDay() {
    const its = itemsFor(selected), el = $('#calDay');
    const empty = !its.trainings.length && !its.events.length;
    el.innerHTML = '<div class="day-head"><div><div class="day-rel">' + escHtml(relDayLabel(selected)) + '</div><h3>' + escHtml(fmtWeekdayDate(selected)) + '</h3></div></div>' +
      (empty ? emptyState('calendar', 'Nichts geplant', 'Für diesen Tag gibt es noch keine Einträge.', '', true) : '') +
      (its.trainings.length ? '<div class="day-group"><div class="label">Trainings</div>' + its.trainings.map(trainingRow).join('') + '</div>' : '') +
      (its.events.length ? '<div class="day-group"><div class="label">Termine</div>' + its.events.map(eventRow).join('') + '</div>' : '') +
      '<div class="day-actions"><button class="btn btn-primary btn-sm" type="button" data-add-training="' + selected + '">' + icon('plus', 'sm') + 'Training hinzufügen</button>' +
      (isTrainer ? '<button class="btn btn-tinted btn-sm" type="button" data-add-event="' + selected + '">' + icon('cal-plus', 'sm') + 'Termin hinzufügen</button>' : '') + '</div>';
  }
  function renderWeek(r) {
    const today = todayISO();
    let html = '<div class="week-grid">';
    for (let i = 0; i < 7; i++) {
      const iso = addDays(r.start, i), d = parseISO(iso), its = itemsFor(iso);
      html += '<section class="week-day' + (iso === today ? ' today' : '') + '"><header><span class="wd">' + WEEKDAYS_SHORT[i] + '</span><span class="wn">' + d.getDate() + '</span>' +
        '<button class="icon-btn sm plain accent" type="button" data-add-training="' + iso + '" aria-label="Training am ' + escHtml(fmtDateShort(iso)) + ' hinzufügen">' + icon('plus', 'sm') + '</button></header><div class="week-items">' +
        its.trainings.map(trainingRow).join('') + its.events.map(eventRow).join('') +
        (!its.trainings.length && !its.events.length ? '<span class="faint week-empty">frei</span>' : '') + '</div></section>';
    }
    $('#calMain').innerHTML = html + '</div>';
  }

  /* ---------------- Interaktion */
  const layout = $('#calLayout');
  layout.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell');
    if (cell) {
      selected = cell.dataset.date;
      if (parseISO(selected).getMonth() !== cursor.getMonth()) { cursor = parseISO(selected); render(); }
      else { $$('.cal-cell').forEach((c) => c.classList.toggle('sel', c === cell)); renderDay(); }
      if (window.matchMedia('(max-width: 900px)').matches) $('#calDay').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const at = e.target.closest('[data-add-training]');
    if (at) { openNewTrainingDialog({ date: at.dataset.addTraining }); return; }
    const ae = e.target.closest('[data-add-event]');
    if (ae) { openEventDialog(null, ae.dataset.addEvent); return; }
    const del = e.target.closest('[data-del-event]');
    if (del) { e.stopPropagation(); deleteEvent(Number(del.dataset.delEvent)); return; }
    const ed = e.target.closest('[data-edit-event]');
    if (ed) openEventDialog(findEvent(Number(ed.dataset.editEvent)));
  });
  layout.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const ed = e.target.closest('[data-edit-event]'); if (ed) openEventDialog(findEvent(Number(ed.dataset.editEvent)));
  });
  function findEvent(id) { for (const k in cache) { const ev = cache[k].events.find((x) => x.id === id); if (ev) return ev; } return null; }

  function shift(dir) {
    if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
    else { cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 7 * dir); }
    render();
  }
  $('#calPrev').addEventListener('click', () => shift(-1));
  $('#calNext').addEventListener('click', () => shift(1));
  $('#calToday').addEventListener('click', () => { cursor = new Date(); selected = todayISO(); render(); });
  $$('#calView button').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; storageSet('localStorage', 'calView', view); if (view === 'week') cursor = parseISO(selected); render(); }));
  let touchX = null;
  $('#calMain').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#calMain').addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 70) shift(dx < 0 ? 1 : -1);
  }, { passive: true });

  $('#newTrainingBtn').addEventListener('click', () => openNewTrainingDialog({ date: selected }));
  if ($('#newEventBtn')) $('#newEventBtn').addEventListener('click', () => openEventDialog(null, selected));
  window.QUICK_HANDLERS.training = () => openNewTrainingDialog({ date: selected });
  if (isTrainer) window.QUICK_HANDLERS.event = () => openEventDialog(null, selected);

  /* ---------------- Termin-Dialog (nur Trainer) */
  async function openEventDialog(ev, date) {
    if (!isTrainer) return;
    const editing = !!ev;
    ev = ev || { title: '', type: CONFIG.event_type_default || 'spiel', date: date || selected, time: '', location: '', notes: '', team_id: null };
    if (teams === null) { try { teams = await api('/api/teams'); } catch (e) { teams = []; } }
    const types = CONFIG.event_types || [];
    const body = openModal(editing ? 'Termin bearbeiten' : 'Neuer Termin', '<form id="evForm" novalidate>' +
      '<div class="field"><label for="evTitle">Titel</label><input class="input" id="evTitle" maxlength="120" value="' + escHtml(ev.title) + '" placeholder="z. B. Heimspiel gegen …"></div>' +
      '<div class="field"><span class="label">Typ</span><div class="segmented ev-types" id="evType">' + types.map((t) => '<button type="button" data-v="' + t + '" style="--c:var(--ev-' + t + ')" class="' + (t === ev.type ? 'active' : '') + '"><span class="sport-dot"></span>' + escHtml((CONFIG.event_type_labels || {})[t] || t) + '</button>').join('') + '</div></div>' +
      '<div class="form-row"><div class="field"><label for="evDate">Datum</label><input class="input" type="date" id="evDate" value="' + escHtml(ev.date) + '"></div>' +
      '<div class="field"><label for="evTime">Uhrzeit</label><input class="input" type="time" id="evTime" value="' + escHtml(ev.time || '') + '"></div></div>' +
      '<div class="field"><label for="evLoc">Ort</label><input class="input" id="evLoc" maxlength="200" value="' + escHtml(ev.location || '') + '"></div>' +
      '<div class="field"><label for="evTeam">Team (optional)</label><select class="select" id="evTeam"><option value="">Kein Team – nur für dich sichtbar</option>' +
      teams.map((t) => '<option value="' + t.id + '"' + (t.id === ev.team_id ? ' selected' : '') + '>' + escHtml(t.name) + '</option>').join('') + '</select>' +
      '<span class="form-hint">Mit Team sehen die verknüpften Spieler dieses Teams den Termin.</span></div>' +
      '<div class="field"><label for="evNotes">Notizen</label><textarea class="textarea" id="evNotes" rows="3" maxlength="5000">' + escHtml(ev.notes || '') + '</textarea></div>' +
      '<p class="form-error" id="evErr"></p><div class="modal-foot">' + (editing ? '<button class="btn btn-danger" type="button" id="evDelete">' + icon('trash', 'sm') + 'Löschen</button><span class="flex1"></span>' : '') +
      '<button class="btn" type="button" data-cancel>Abbrechen</button><button class="btn btn-primary" type="submit">' + icon('check', 'sm') + 'Speichern</button></div></form>');
    let type = ev.type;
    $('#evType', body).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; type = b.dataset.v; $$('#evType button', body).forEach((x) => x.classList.toggle('active', x === b)); });
    $('[data-cancel]', body).addEventListener('click', () => closeModal());
    if (editing) $('#evDelete', body).addEventListener('click', async () => { if (await deleteEvent(ev.id)) closeModal(); });
    $('#evForm', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const errEl = $('#evErr', body); errEl.textContent = '';
      const payload = { title: $('#evTitle', body).value.trim(), type: type, date: $('#evDate', body).value, time: $('#evTime', body).value || null,
        location: $('#evLoc', body).value.trim(), notes: $('#evNotes', body).value, team_id: $('#evTeam', body).value ? Number($('#evTeam', body).value) : null };
      if (!payload.title) { errEl.textContent = 'Bitte gib einen Titel ein.'; return; }
      if (!payload.date) { errEl.textContent = 'Bitte wähle ein Datum.'; return; }
      withBusy(e.target.querySelector('[type=submit]'), async () => {
        try {
          await api(editing ? '/api/events/' + ev.id : '/api/events', { method: editing ? 'PUT' : 'POST', body: payload });
          closeModal(); showToast(editing ? 'Termin gespeichert' : 'Termin angelegt', 'success');
          if (editing) delete cache[ev.date.slice(0, 7)];
          delete cache[payload.date.slice(0, 7)];
          selected = payload.date; cursor = parseISO(payload.date); render(); loadNextUp();
        } catch (err) { errEl.textContent = err.message; }
      });
    });
  }
  async function deleteEvent(id) {
    const ev = findEvent(id);
    const ok = await confirmDialog({ title: 'Termin löschen?', message: ev ? '„' + ev.title + '“ wird endgültig gelöscht.' : '', confirmText: 'Löschen', danger: true });
    if (!ok) return false;
    try {
      await api('/api/events/' + id, { method: 'DELETE' });
      showToast('Termin gelöscht', 'success');
      if (ev) delete cache[ev.date.slice(0, 7)];
      render(); loadNextUp();
      return true;
    } catch (err) { showToast(err.message, 'error'); return false; }
  }

  render().then(() => {
    if (qs.get('new') === '1') openNewTrainingDialog({ date: selected });
    if (qs.get('new') === 'event') { if (isTrainer) openEventDialog(null, selected); else showToast('Nur Trainer können Termine anlegen', 'error'); }
    if (qs.get('new') || qs.get('date')) history.replaceState(null, '', location.pathname);
  });
})();
