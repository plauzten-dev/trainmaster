'use strict';
/* Training-Detail: Bloecke, Drag & Drop, Dauer, Notizen, Anwesenheit, Duplizieren, PDF, Live-Modus */
(function () {
  const ID = Number($('#training').dataset.id);
  const BLOCKS = CONFIG.training_blocks || ['Aufwärmen', 'Hauptteil', 'Abschluss'];
  const LIM = CONFIG.limits || {};
  let t = null, canEdit = false;

  async function load() {
    try {
      t = await api('/api/trainings/' + ID);
      canEdit = !!t.owned_by_me;
      renderHero(); renderExercises(); setupNotes();
      $('#tabTeam').classList.toggle('hidden', !isTeamTrainer());
      if (USER_ROLE === 'player' && !canEdit) renderRsvp();
      if (new URLSearchParams(location.search).get('start') === '1') {
        history.replaceState(null, '', location.pathname);
        if (t.exercises.length) startLive();
      }
      if (!$('#paneTeam').classList.contains('hidden')) renderTeam();
    } catch (err) {
      if (err.status === 404) { location.href = '/calendar'; return; }
      renderError($('#trHero'), err.message, load);
      $('#paneExercises').innerHTML = '';
    }
  }

  /* Teams gibt es nur fuer Trainer bei eigenen Trainings (nicht fuer Privatpersonen und Spieler) */
  function isTeamTrainer() { return USER_ROLE === 'trainer' && canEdit; }

  /* ---------------- Kopf + Kennzahlen */
  function sorted() {
    return t.exercises.slice().sort((a, b) => (BLOCKS.indexOf(a.block) - BLOCKS.indexOf(b.block)) || (a.order_index - b.order_index));
  }
  function renderHero() {
    document.title = t.title + ' · ' + APP_NAME;
    $('#trHero').innerHTML = '<div class="hero-art" style="--c:' + sportColor(t.sport) + '">' + sportMotif(t.sport, 'motif big-bg') +
      '<div class="hero-top"><a class="icon-btn btn-glass" href="/my-trainings" aria-label="Zurück">' + icon('chev-left') + '</a><span class="flex1"></span>' +
      '<button class="icon-btn btn-glass" type="button" id="moreBtn" aria-label="Mehr">' + icon('more') + '</button></div>' +
      '<div class="hero-info"><div class="hero-sport">' + sportIcon(t.sport, 'sm') + escHtml(t.sport) + (canEdit ? '' : ' · <span class="badge hero-badge">Vom Trainer' + (t.owner_name ? ' ' + escHtml(t.owner_name) : '') + '</span>') + '</div>' +
      '<h1 class="large-title hero-title">' + escHtml(t.title) + '</h1>' +
      '<div class="hero-date">' + icon('calendar', 'sm') + escHtml(fmtWeekdayDate(t.date)) + ' ' + parseISO(t.date).getFullYear() + (t.time ? ' · ' + icon('clock', 'sm') + escHtml(t.time) + ' Uhr' : '') + '</div>' +
      '<div class="hero-meta" id="heroMeta"></div></div></div>' +
      '<div class="hero-actions"><button class="btn btn-primary" type="button" id="startBtn">' + icon('play', 'sm fill') + 'Training starten</button></div>';
    $('#startBtn').addEventListener('click', startLive);
    $('#moreBtn').addEventListener('click', (e) => openMore(e.currentTarget));
    renderKpis();
  }
  /* Kennzahlen als ruhige Zeile im Kopf statt eigener Kacheln */
  function renderKpis() {
    const mins = t.exercises.reduce((s, e) => s + (e.duration || 0), 0);
    $('#heroMeta').innerHTML = '<span>' + plural(t.exercises.length, 'Übung', 'Übungen') + '</span>' + (mins ? '<span>' + mins + ' Min.</span>' : '') +
      (isTeamTrainer() && t.team_name ? '<span class="hero-team">' + icon('users', 'sm') + escHtml(t.team_name) + '</span>' : '');
    $('#startBtn').disabled = !t.exercises.length;
  }
  function openMore(anchor) {
    const pop = openPopover(anchor, (canEdit ? '<button class="menu-item" type="button" data-m="edit">' + icon('edit') + 'Bearbeiten</button>' +
      '<button class="menu-item" type="button" data-m="dup">' + icon('copy') + 'Duplizieren</button>' : '') +
      '<a class="menu-item" href="/training/' + ID + '/pdf">' + icon('printer') + 'PDF / Drucken</a>' +
      (canEdit ? '<div class="menu-sep"></div><button class="menu-item" type="button" data-m="del" style="color:var(--danger)">' + icon('trash') + 'Löschen</button>' : ''));
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      closePopover();
      if (b.dataset.m === 'edit') openEdit();
      if (b.dataset.m === 'dup') duplicate();
      if (b.dataset.m === 'del') remove();
    });
  }
  function openEdit() {
    const body = openModal('Training bearbeiten', '<form id="edForm" novalidate><div class="field"><label for="edTitle">Titel</label><input class="input" id="edTitle" maxlength="120" value="' + escHtml(t.title) + '"></div>' +
      '<div class="form-row"><div class="field"><label for="edDate">Datum</label><input class="input" type="date" id="edDate" value="' + escHtml(t.date) + '"></div>' +
      '<div class="field"><label for="edTime">Uhrzeit</label><input class="input" type="time" id="edTime" value="' + escHtml(t.time || '') + '"></div></div>' +
      '<p class="form-error" id="edErr"></p><div class="modal-foot"><button class="btn" type="button" data-cancel>Abbrechen</button><button class="btn btn-primary" type="submit">Speichern</button></div></form>', 'sm');
    $('[data-cancel]', body).addEventListener('click', () => closeModal());
    $('#edForm', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const title = $('#edTitle', body).value.trim(), date = $('#edDate', body).value, time = $('#edTime', body).value || null;
      if (!title || !date) { $('#edErr', body).textContent = 'Titel und Datum sind erforderlich.'; return; }
      withBusy(e.target.querySelector('[type=submit]'), async () => {
        try {
          await api('/api/trainings/' + ID, { method: 'PUT', body: { title: title, date: date, time: time } });
          t.title = title; t.date = date; t.time = time; closeModal(); renderHero(); showToast('Gespeichert', 'success'); loadNextUp();
        } catch (err) { $('#edErr', body).textContent = err.message; }
      });
    });
  }
  async function duplicate() {
    const ok = await confirmDialog({ title: 'Training duplizieren?', message: 'Es entsteht eine Kopie am selben Datum mit allen Übungen, Blöcken und Dauern. Notizen werden nicht übernommen.', confirmText: 'Duplizieren' });
    if (!ok) return;
    try { const r = await api('/api/trainings/' + ID + '/duplicate', { method: 'POST', body: { date: t.date } }); location.href = '/training/' + r.id; }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function remove() {
    const ok = await confirmDialog({ title: 'Training löschen?', message: '„' + t.title + '“ wird mit Übungszuordnung und Anwesenheit endgültig gelöscht.', confirmText: 'Löschen', danger: true });
    if (!ok) return;
    try { await api('/api/trainings/' + ID, { method: 'DELETE' }); location.href = '/calendar'; }
    catch (err) { showToast(err.message, 'error'); }
  }

  /* ---------------- Tabs */
  $('#trTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#trTabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tr-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
    if (b.dataset.tab === 'team' && t) renderTeam();
  });

  /* ---------------- Uebungen nach Block */
  function renderExercises() {
    const pane = $('#paneExercises');
    if (!t.exercises.length) {
      pane.innerHTML = emptyState('cones', 'Noch keine Übungen', canEdit ? 'Füge Übungen aus der Datenbank hinzu und ordne sie Blöcken zu.' : 'Der Trainer hat noch keine Übungen eingeplant.',
        canEdit ? '<button class="btn btn-primary" type="button" data-add>' + icon('plus', 'sm') + 'Übung hinzufügen</button>' : '');
      return;
    }
    const list = sorted();
    let n = 0, html = '';
    BLOCKS.forEach((block) => {
      const items = list.filter((e) => e.block === block);
      if (!items.length) return;
      n++;
      const mins = items.reduce((s, e) => s + (e.duration || 0), 0);
      html += '<section class="block card flush" data-block="' + escHtml(block) + '"><header class="block-head"><span class="block-num">' + n + '</span><h3>' + escHtml(block) + '</h3>' +
        '<span class="muted">' + plural(items.length, 'Übung', 'Übungen') + (mins ? ' · ' + mins + ' Min.' : '') + '</span></header><div class="block-list">' + items.map(rowHtml).join('') + '</div></section>';
    });
    if (canEdit) html += '<button class="add-row" type="button" data-add>' + icon('plus', 'sm') + 'Übung hinzufügen</button>';
    pane.innerHTML = html;
  }
  function rowHtml(ex) {
    return '<div class="tx-row" data-eid="' + ex.id + '">' +
      (canEdit ? '<span class="grip" aria-label="Ziehen zum Sortieren" title="Ziehen zum Sortieren">' + icon('grip') + '</span>' : '') +
      '<div class="tx-thumb" data-open="' + ex.id + '" role="button" tabindex="0">' + exMediaHtml(ex) + '</div>' +
      '<div class="tx-main"><div class="tx-title" data-open="' + ex.id + '" role="button" tabindex="0">' + escHtml(ex.title) + '</div>' +
      '<div class="tx-sub"><span class="sport-dot" style="--c:' + sportColor(ex.sport) + '"></span>' + escHtml(ex.core_competency) + ' · ' + escHtml(ex.difficulty) + '</div></div>' +
      (canEdit ? '<button class="dur-pill' + (ex.duration == null ? ' empty' : '') + '" type="button" data-edit aria-label="Block und Dauer ändern">' + icon('clock', 'sm') + (ex.duration == null ? '– Min.' : ex.duration + ' Min.') + '</button>'
        : (ex.duration != null ? '<span class="dur-pill static">' + icon('clock', 'sm') + ex.duration + ' Min.</span>' : '')) + '</div>';
  }
  const pane = $('#paneExercises');
  pane.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) { openPicker(); return; }
    const op = e.target.closest('[data-open]');
    if (op) { openExercise(Number(op.dataset.open)); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) editExercise(Number(ed.closest('.tx-row').dataset.eid));
  });
  pane.addEventListener('keydown', (e) => { const op = e.target.closest('[data-open]'); if (op && e.key === 'Enter') openExercise(Number(op.dataset.open)); });
  /* Block, Dauer und Entfernen in einem kleinen Blatt statt Steuerelementen in jeder Zeile */
  function editExercise(eid) {
    const ex = t.exercises.find((x) => x.id === eid); if (!ex) return;
    const max = LIM.exercise_duration_in_training_max || 240;
    const body = openModal(ex.title, '<form id="exForm" novalidate><div class="form-row"><div class="field"><label for="exBlock">Block</label><select class="select" id="exBlock">' +
      BLOCKS.map((b) => '<option' + (b === ex.block ? ' selected' : '') + '>' + escHtml(b) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="exDur">Dauer (Min.)</label><input class="input" id="exDur" type="number" inputmode="numeric" min="0" max="' + max + '" value="' + (ex.duration == null ? '' : ex.duration) + '" placeholder="optional"></div></div>' +
      '<p class="form-error" id="exErr"></p><div class="modal-foot"><button class="btn btn-danger" type="button" data-rm>' + icon('trash', 'sm') + 'Entfernen</button><span class="flex1"></span>' +
      '<button class="btn btn-primary" type="submit">Speichern</button></div></form>', 'sm', { autofocus: false });
    $('[data-rm]', body).addEventListener('click', (e) => removeExercise(eid, e.currentTarget));
    $('#exForm', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = $('#exDur', body).value, dur = raw === '' ? null : Number(raw), block = $('#exBlock', body).value;
      if (dur != null && (isNaN(dur) || dur < 0 || dur > max)) { $('#exErr', body).textContent = 'Dauer muss zwischen 0 und ' + max + ' Minuten liegen.'; return; }
      withBusy(e.target.querySelector('[type=submit]'), async () => {
        try {
          const r = await api('/api/trainings/' + ID + '/exercises/' + eid + '/meta', { method: 'PUT', body: { block: block, duration: dur } });
          ex.block = r.block; ex.duration = r.duration; closeModal(); renderExercises(); renderKpis();
        } catch (err) { $('#exErr', body).textContent = err.message; }
      });
    });
  }
  async function removeExercise(eid, btn) {
    const ex = t.exercises.find((x) => x.id === eid);
    const ok = await confirmDialog({ title: 'Übung entfernen?', message: '„' + (ex ? ex.title : '') + '“ wird aus diesem Training entfernt (nicht aus der Datenbank).', confirmText: 'Entfernen', danger: true });
    if (!ok) return;
    withBusy(btn, async () => {
      try { await api('/api/trainings/' + ID + '/exercises/' + eid, { method: 'DELETE' }); t.exercises = t.exercises.filter((x) => x.id !== eid); if (modalStack.length) closeModal(); renderExercises(); renderKpis(); }
      catch (err) { showToast(err.message, 'error'); }
    });
  }
  function openExercise(eid) {
    const ex = t.exercises.find((x) => x.id === eid); if (!ex) return;
    openModal(ex.title, '<div class="ex-detail"><div class="ex-detail-media">' + exMediaHtml(ex, true) + '</div>' +
      '<div class="meta" style="margin-bottom:10px"><span class="badge accent">' + escHtml(ex.block) + '</span>' + (ex.duration != null ? '<span class="badge">' + ex.duration + ' Min.</span>' : '') + '</div>' +
      exMetaHtml(ex) + '<h3 class="sub-h">Beschreibung</h3><p class="pre">' + escHtml(ex.description) + '</p></div>', 'lg');
  }

  /* ---------------- Drag & Drop (Maus + Touch, nur am Griff) */
  let drag = null;
  pane.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('.grip');
    if (!grip || !canEdit) return;
    e.preventDefault();
    const row = grip.closest('.tx-row'), r = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('tx-ghost');
    Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
    document.body.appendChild(ghost);
    row.classList.add('tx-placeholder');
    drag = { row: row, ghost: ghost, offY: e.clientY - r.top, id: e.pointerId, fromBlock: row.closest('.block').dataset.block, y: e.clientY };
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* synthetisches Event */ }
    document.body.classList.add('dragging-active');
    autoScroll();
  });
  pane.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.y = e.clientY;
    drag.ghost.style.top = (e.clientY - drag.offY) + 'px';
    const rows = $$('.tx-row:not(.tx-placeholder)', pane);
    let target = null, before = true;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (e.clientY >= b.top && e.clientY <= b.bottom) { target = r; before = e.clientY < b.top + b.height / 2; break; }
    }
    if (target) {
      const list = target.parentElement;
      if (before) list.insertBefore(drag.row, target); else list.insertBefore(drag.row, target.nextSibling);
    }
  });
  const endDrag = async (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    d.ghost.remove(); d.row.classList.remove('tx-placeholder');
    document.body.classList.remove('dragging-active');
    const eid = Number(d.row.dataset.eid);
    const newBlock = d.row.closest('.block').dataset.block;
    const order = $$('.tx-row', pane).map((r) => Number(r.dataset.eid));
    const prev = order.join(','), before = sorted().map((x) => x.id).join(',');
    if (prev === before && newBlock === d.fromBlock) return;
    try {
      if (newBlock !== d.fromBlock) await api('/api/trainings/' + ID + '/exercises/' + eid + '/meta', { method: 'PUT', body: { block: newBlock } });
      await api('/api/trainings/' + ID + '/exercises/reorder', { method: 'PUT', body: { order: order } });
      const ex = t.exercises.find((x) => x.id === eid); ex.block = newBlock;
      order.forEach((id, i) => { const x = t.exercises.find((y) => y.id === id); if (x) x.order_index = i; });
      if (newBlock !== d.fromBlock) showToast('Verschoben nach „' + newBlock + '“', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    renderExercises(); renderKpis();
  };
  pane.addEventListener('pointerup', endDrag);
  pane.addEventListener('pointercancel', endDrag);
  function autoScroll() {
    if (!drag) return;
    const sc = $('#scroller'), r = sc.getBoundingClientRect(), edge = 70;
    if (drag.y < r.top + edge) sc.scrollTop -= 10;
    else if (drag.y > r.bottom - edge - 110) sc.scrollTop += 10;
    requestAnimationFrame(autoScroll);
  }

  /* ---------------- Uebung hinzufuegen (Auswahl) */
  async function openPicker() {
    const body = openModal('Übung hinzufügen', '<div class="form-row"><div class="field"><label for="pkBlock">Block</label><select class="select" id="pkBlock">' + BLOCKS.map((b) => '<option' + (b === CONFIG.training_block_default ? ' selected' : '') + '>' + escHtml(b) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="pkDur">Dauer (Min.)</label><input class="input" id="pkDur" type="number" inputmode="numeric" min="0" max="' + (LIM.exercise_duration_in_training_max || 240) + '" placeholder="optional"></div></div>' +
      '<label class="search" style="margin-bottom:10px"><svg class="i"><use href="#i-search"/></svg><input class="input" type="search" id="pkSearch" placeholder="Suchen" autocomplete="off"></label>' +
      '<div class="chips" id="pkSports"></div><div id="pkList" class="pick-list"><div class="loading"><span class="spinner"></span></div></div>', 'lg', { autofocus: false });
    let sport = t.exercises.length ? t.sport : '', search = '', no = 0;
    const tabs = [''].concat(CONFIG.sports || []);
    const renderSports = () => { $('#pkSports', body).innerHTML = tabs.map((s) => '<button class="chip' + (s === sport ? ' active' : '') + '" type="button" data-s="' + escHtml(s) + '">' + (s ? '<span class="dot" style="--c:' + sportColor(s) + '"></span>' + escHtml(s) : 'Alle') + '</button>').join(''); };
    const loadList = async () => {
      const my = ++no, el = $('#pkList', body);
      el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      const q = new URLSearchParams(); if (sport) q.set('sport', sport); if (search) q.set('search', search);
      try {
        const list = await api('/api/exercises?' + q.toString());
        if (my !== no) return;
        if (!list.length) { el.innerHTML = emptyState('search', 'Keine Übungen gefunden', '', '', true); return; }
        const inTr = new Set(t.exercises.map((x) => x.id));
        el.innerHTML = '<div class="list">' + list.map((ex) => '<div class="list-item"><span class="pk-thumb">' + exMediaHtml(ex) + '</span><span class="li-main"><span class="li-title">' + escHtml(ex.title) + '</span><span class="li-sub">' + escHtml(ex.sport) + ' · ' + escHtml(ex.core_competency) + '</span></span>' +
          (inTr.has(ex.id) ? '<span class="icon-btn sm plain" style="color:var(--success)" aria-label="Bereits im Training">' + icon('check', 'sm') + '</span>' : '<button class="icon-btn sm accent" type="button" data-pk="' + ex.id + '" aria-label="Hinzufügen">' + icon('plus', 'sm') + '</button>') + '</div>').join('') + '</div>';
      } catch (err) { if (my === no) renderError(el, err.message, loadList); }
    };
    $('#pkSports', body).addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; sport = b.dataset.s; renderSports(); loadList(); });
    $('#pkSearch', body).addEventListener('input', debounce((e) => { search = e.target.value.trim(); loadList(); }, LIM.exercise_search_debounce_ms || 350));
    $('#pkList', body).addEventListener('click', (e) => {
      const b = e.target.closest('[data-pk]'); if (!b) return;
      withBusy(b, async () => {
        const dur = $('#pkDur', body).value;
        try {
          await api('/api/trainings/' + ID + '/exercises', { method: 'POST', body: { exercise_id: Number(b.dataset.pk), block: $('#pkBlock', body).value, duration: dur === '' ? null : Number(dur) } });
          const fresh = await api('/api/trainings/' + ID);
          t.exercises = fresh.exercises; t.sport = fresh.sport;
          renderExercises(); renderKpis();
          b.outerHTML = '<span class="icon-btn sm plain" style="color:var(--success)">' + icon('check', 'sm') + '</span>';
          showToast('Übung hinzugefügt', 'success');
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
    renderSports(); loadList();
  }

  /* ---------------- Notizen (Auto-Save) */
  let notesBound = false;
  function setupNotes() {
    const area = $('#notesArea'), status = $('#notesStatus');
    area.value = t.notes || '';
    area.readOnly = !canEdit;
    if (!canEdit) { status.textContent = 'Nur lesen'; area.placeholder = 'Keine Notizen'; return; }
    if (notesBound) return;
    notesBound = true;
    let saved = area.value;
    const save = debounce(async () => {
      const val = area.value;
      if (val === saved) { status.textContent = 'Gespeichert'; return; }
      try { await api('/api/trainings/' + ID, { method: 'PUT', body: { notes: val } }); saved = val; t.notes = val; status.textContent = 'Gespeichert'; }
      catch (err) { status.textContent = 'Nicht gespeichert'; showToast(err.message, 'error'); }
    }, LIM.notes_autosave_debounce_ms || 1200);
    area.addEventListener('input', () => { status.textContent = 'Änderungen …'; save(); });
  }

  /* ---------------- Spieler: Zusage (kompakt ueber den Tabs) */
  async function renderRsvp() {
    const el = $('#trRsvp');
    let r;
    try { r = await api('/api/trainings/' + ID + '/my-attendance'); } catch (err) { el.innerHTML = ''; return; }
    const draw = (present) => {
      el.innerHTML = '<div class="card rsvp"><div class="rsvp-text"><b>Bist du dabei?</b><span class="muted">' +
        (present === 1 ? 'Du hast zugesagt.' : present === 0 ? 'Du hast abgesagt.' : 'Noch keine Rückmeldung.') + '</span></div>' +
        '<div class="rsvp-btns"><button class="btn btn-sm ' + (present === 1 ? 'btn-primary' : 'btn-tinted') + '" type="button" data-p="1">' + icon('check', 'sm') + 'Ja</button>' +
        '<button class="btn btn-sm ' + (present === 0 ? 'btn-danger solid' : 'btn-danger') + '" type="button" data-p="0">' + icon('x', 'sm') + 'Nein</button></div></div>';
      $$('[data-p]', el).forEach((b) => b.addEventListener('click', () => withBusy(b, async () => {
        const val = b.dataset.p === '1' ? (present === 1 ? null : true) : (present === 0 ? null : false);
        try { const res = await api('/api/trainings/' + ID + '/my-attendance', { method: 'PUT', body: { present: val } }); draw(res.present); showToast('Rückmeldung gespeichert', 'success'); }
        catch (err) { showToast(err.message, 'error'); }
      })));
    };
    draw(r.present);
  }

  /* ---------------- Team + Anwesenheit (nur Trainer) */
  async function renderTeam() {
    const el = $('#paneTeam');
    if (!isTeamTrainer()) { el.innerHTML = ''; return; }
    if (!t.team_id) {
      el.innerHTML = '<div class="card">' + emptyState('users', 'Kein Team zugeordnet', 'Füge ein Team hinzu, um für dieses Training die Anwesenheit zu erfassen.',
        '<button class="btn btn-primary" type="button" data-pick-team>' + icon('plus', 'sm') + 'Team hinzufügen</button>', true) + '</div>';
      $('[data-pick-team]', el).addEventListener('click', pickTeam);
      return;
    }
    el.innerHTML = '<div class="card att-card"><div class="team-head"><span class="team-ic">' + icon('users') + '</span>' +
      '<span class="li-main"><span class="li-title">' + escHtml(t.team_name) + '</span><span class="li-sub" id="attCount">&nbsp;</span></span>' +
      '<button class="btn btn-tinted btn-sm" type="button" data-pick-team>Ändern</button></div><div id="attBody"><div class="loading"><span class="spinner"></span></div></div></div>';
    $('[data-pick-team]', el).addEventListener('click', pickTeam);
    const box = $('#attBody', el);
    let players;
    try { players = await api('/api/trainings/' + ID + '/attendance?team_id=' + t.team_id); }
    catch (err) { renderError(box, err.message, renderTeam); return; }
    if (!players.length) { $('#attCount', el).textContent = 'Keine Spieler'; box.innerHTML = emptyState('user', 'Keine Spieler im Team', '', '<a class="btn btn-tinted btn-sm" href="/players">Spieler hinzufügen</a>', true); return; }
    const states = { null: ['circle', 'Offen', ''], 1: ['check-circle', 'Anwesend', 'on'], 0: ['x-circle', 'Fehlt', 'off'] };
    const draw = () => {
      const present = players.filter((p) => p.present === 1).length;
      $('#attCount', el).textContent = present + ' von ' + players.length + ' anwesend';
      box.innerHTML = '<div class="att-bar"><div class="att-progress"><i style="width:' + (present / players.length * 100) + '%"></i></div>' +
        (present < players.length ? '<button class="btn btn-ghost btn-sm" type="button" id="attAll">' + icon('check', 'sm') + 'Alle anwesend</button>' : '') + '</div>' +
        '<div class="att-list">' + players.map((p) => {
          const s = states[p.present == null ? 'null' : p.present];
          return '<div class="att-row"><span class="att-av">' + avatarHtml(p.avatar_path, p.name, 'sm') + (p.status !== 'fit' ? '<i class="status-dot ' + p.status + '" title="' + escHtml((CONFIG.player_status_labels || {})[p.status]) + '"></i>' : '') + '</span>' +
            '<span class="li-main"><span class="li-title">' + escHtml(p.name) + '</span><span class="li-sub">' + escHtml(p.position) + (p.number ? ' · #' + p.number : '') + (p.status !== 'fit' ? ' · ' + escHtml((CONFIG.player_status_labels || {})[p.status]) : '') + '</span></span>' +
            '<button class="tri ' + s[2] + '" type="button" data-pid="' + p.id + '" aria-label="' + escHtml(p.name) + ': ' + s[1] + '">' + icon(s[0]) + '<span>' + s[1] + '</span></button></div>';
        }).join('') + '</div>';
    };
    draw();
    box.onclick = async (e) => {
      const all = e.target.closest('#attAll');
      if (all) {
        withBusy(all, async () => {
          try { await api('/api/trainings/' + ID + '/attendance/all', { method: 'PUT', body: { team_id: t.team_id, present: true } }); players.forEach((p) => { p.present = 1; }); draw(); showToast('Alle als anwesend markiert', 'success'); }
          catch (err) { showToast(err.message, 'error'); }
        });
        return;
      }
      const b = e.target.closest('[data-pid]'); if (!b) return;
      const p = players.find((x) => x.id === Number(b.dataset.pid));
      const old = p.present;
      const next = old == null ? true : old === 1 ? false : null;
      p.present = next === true ? 1 : next === false ? 0 : null; draw();
      try { await api('/api/trainings/' + ID + '/attendance', { method: 'PUT', body: { player_id: p.id, present: next } }); }
      catch (err) { p.present = old; draw(); showToast(err.message, 'error'); }
    };
  }
  async function pickTeam() {
    const body = openModal('Team wählen', '<div id="tmList"><div class="loading"><span class="spinner"></span></div></div>', 'sm');
    let teams;
    try { teams = await api('/api/teams'); } catch (err) { renderError($('#tmList', body), err.message, () => { closeModal(); pickTeam(); }); return; }
    if (!teams.length) {
      $('#tmList', body).innerHTML = emptyState('users', 'Noch kein Team', 'Lege zuerst ein Team an.', '<a class="btn btn-primary btn-sm" href="/players">Team erstellen</a>', true);
      return;
    }
    $('#tmList', body).innerHTML = '<div class="list pick-teams">' + teams.map((x) => '<button class="list-item" type="button" data-team="' + x.id + '">' +
      '<span class="li-ic" style="--c:' + sportColor(x.sport) + '">' + sportIcon(x.sport, 'sm') + '</span><span class="li-main"><span class="li-title">' + escHtml(x.name) + '</span>' +
      '<span class="li-sub">' + plural(x.player_count || 0, 'Spieler', 'Spieler') + '</span></span>' + (x.id === t.team_id ? icon('check', 'sm accent-ic') : '') + '</button>').join('') + '</div>' +
      (t.team_id ? '<div class="modal-foot"><button class="btn btn-danger" type="button" data-team="">' + icon('x', 'sm') + 'Team entfernen</button></div>' : '');
    $('#tmList', body).addEventListener('click', (e) => {
      const b = e.target.closest('[data-team]'); if (!b) return;
      const id = b.dataset.team === '' ? null : Number(b.dataset.team);
      if (id === t.team_id) { closeModal(); return; }
      withBusy(b, async () => {
        try {
          await api('/api/trainings/' + ID, { method: 'PUT', body: { team_id: id } });
          const team = teams.find((x) => x.id === id);
          t.team_id = id; t.team_name = team ? team.name : null;
          closeModal(); renderKpis(); renderTeam();
          showToast(id ? 'Team hinzugefügt' : 'Team entfernt', 'success');
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  }

  /* ---------------- Live-Modus */
  let live = null;
  function startLive() {
    if (!t.exercises.length) return;
    const steps = sorted();
    const ov = document.createElement('div');
    ov.className = 'live';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Live-Modus');
    document.body.appendChild(ov);
    lockScroll(true);
    live = { steps: steps, idx: 0, ov: ov, elapsed: 0, startedAt: null, running: false, timer: null, wake: null };
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then((w) => { if (live) live.wake = w; }).catch(() => {});
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-l]'); if (!b) return;
      const a = b.dataset.l;
      if (a === 'close' || a === 'done') stopLive();
      if (a === 'prev') goStep(live.idx - 1);
      if (a === 'next') { if (live.idx === live.steps.length - 1) finishLive(); else goStep(live.idx + 1); }
      if (a === 'toggle') toggleTimer();
    });
    live.keyHandler = (e) => {
      if (e.key === 'Escape') stopLive();
      if (e.key === 'ArrowRight') ov.querySelector('[data-l=next]') && ov.querySelector('[data-l=next]').click();
      if (e.key === 'ArrowLeft') goStep(live.idx - 1);
      if (e.key === ' ') { e.preventDefault(); toggleTimer(); }
    };
    document.addEventListener('keydown', live.keyHandler);
    goStep(0);
  }
  function curElapsed() { return live.elapsed + (live.running ? (Date.now() - live.startedAt) / 1000 : 0); }
  function goStep(i) {
    if (!live || i < 0 || i >= live.steps.length) return;
    live.idx = i; live.elapsed = 0; live.startedAt = Date.now(); live.running = true; live.expired = false;
    const ex = live.steps[i], n = live.steps.length;
    live.ov.innerHTML = '<div class="live-inner"><header class="live-top"><button class="icon-btn btn-glass" type="button" data-l="close" aria-label="Schließen">' + icon('x') + '</button>' +
      '<div class="live-progress"><div class="row between"><b>' + (i + 1) + ' / ' + n + '</b><span class="badge accent">' + escHtml(ex.block) + '</span></div><div class="bar"><i style="width:' + ((i + 1) / n * 100) + '%"></i></div></div></header>' +
      '<div class="live-scroll"><div class="live-media">' + exMediaHtml(ex, true) + '</div><h2 class="live-title">' + escHtml(ex.title) + '</h2>' +
      '<div class="meta"><span class="meta-chip">' + escHtml(ex.sport) + '</span><span class="meta-chip">' + escHtml(ex.core_competency) + '</span><span class="meta-chip">' + escHtml(ex.difficulty) + '</span><span class="meta-chip">' + icon('users') + ex.field_players + (ex.goalkeepers ? ' + ' + ex.goalkeepers + ' TW' : '') + '</span><span class="meta-chip">' + escHtml(ex.field_size) + '</span></div>' +
      '<p class="pre live-desc">' + escHtml(ex.description) + '</p></div>' +
      '<footer class="live-foot glass"><div class="live-timer" id="liveTimer"><span class="lt-label">' + (ex.duration ? 'Countdown · ' + ex.duration + ' Min.' : 'Stoppuhr') + '</span><b id="ltVal">00:00</b></div>' +
      '<div class="live-ctrl"><button class="icon-btn" type="button" data-l="prev" aria-label="Zurück"' + (i === 0 ? ' disabled' : '') + '>' + icon('back') + '</button>' +
      '<button class="icon-btn live-play" type="button" data-l="toggle" aria-label="Pause">' + icon('pause', 'fill') + '</button>' +
      '<button class="icon-btn" type="button" data-l="next" aria-label="' + (i === n - 1 ? 'Abschließen' : 'Weiter') + '">' + icon(i === n - 1 ? 'check' : 'forward') + '</button></div></footer></div>';
    clearInterval(live.timer);
    live.timer = setInterval(tick, 250); tick();
  }
  function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)); return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60); }
  function tick() {
    if (!live) return;
    const ex = live.steps[live.idx], el = live.ov.querySelector('#ltVal'), box = live.ov.querySelector('#liveTimer');
    if (!el) return;
    const e = curElapsed();
    if (ex.duration) {
      const rest = ex.duration * 60 - e;
      if (rest <= 0 && !live.expired) {
        live.expired = true; live.running = false; live.elapsed = ex.duration * 60;
        box.classList.add('expired'); box.querySelector('.lt-label').textContent = 'Zeit abgelaufen';
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        updatePlayBtn();
      }
      el.textContent = fmtClock(Math.max(0, rest));
      const pct = Math.min(1, e / (ex.duration * 60));
      box.style.setProperty('--p', pct);
    } else el.textContent = fmtClock(e);
  }
  function toggleTimer() {
    if (!live || live.expired) return;
    if (live.running) { live.elapsed = curElapsed(); live.running = false; }
    else { live.startedAt = Date.now(); live.running = true; }
    updatePlayBtn();
  }
  function updatePlayBtn() {
    const b = live.ov.querySelector('[data-l=toggle]'); if (!b) return;
    b.innerHTML = icon(live.running ? 'pause' : 'play', 'fill');
    b.setAttribute('aria-label', live.running ? 'Pause' : 'Weiter');
    b.disabled = !!live.expired;
  }
  function finishLive() {
    clearInterval(live.timer);
    const n = live.steps.length;
    live.ov.innerHTML = '<div class="live-inner live-done"><div class="done-ring">' + icon('check', 'lg') + '</div><h2>Training abgeschlossen</h2><p class="muted">' + plural(n, 'Übung', 'Übungen') + ' absolviert</p>' +
      '<button class="btn btn-primary" type="button" data-l="done">Fertig</button></div>';
  }
  function stopLive() {
    if (!live) return;
    clearInterval(live.timer);
    document.removeEventListener('keydown', live.keyHandler);
    if (live.wake) live.wake.release().catch(() => {});
    live.ov.remove(); live = null;
    if (!modalStack.length) lockScroll(false);
  }

  load();
})();
