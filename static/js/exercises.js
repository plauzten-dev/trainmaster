'use strict';
/* Uebungsdatenbank: Liste, Filter, Favoriten, Detail, Formular, Teilen, Import */
(function () {
  if (!claimPage('exGrid')) return;
  const LIM = CONFIG.limits || {};
  const state = { sport: '', favorites: false, search: '', field_players: '', goalkeepers: '', core_competency: '', difficulty: '', field_size: '' };
  let items = [], reqNo = 0;

  /* ---------------- Sport-Tabs (zuletzt gewaehlte Sportart merken) */
  const saved = new URLSearchParams(location.search).get('fav') === '1' ? 'favorites' : storageGet('localStorage', 'exercises_sport');
  if (saved === 'favorites') state.favorites = true;
  else if (saved && (CONFIG.sports || []).includes(saved)) state.sport = saved;

  function renderTabs() {
    const tabs = [{ key: '', label: 'Alle' }, { key: 'favorites', label: 'Favoriten', ic: 'heart' }]
      .concat((CONFIG.sports || []).map((s) => ({ key: s, label: s, color: sportColor(s) })));
    const cur = state.favorites ? 'favorites' : state.sport;
    $('#sportTabs').innerHTML = tabs.map((t) => '<button class="chip' + (t.key === cur ? ' active' : '') + '" type="button" role="tab" data-key="' + escHtml(t.key) + '">' +
      (t.ic ? icon(t.ic, 'sm') : t.color ? '<span class="dot" style="--c:' + t.color + '"></span>' : '') + escHtml(t.label) + '</button>').join('');
  }
  $('#sportTabs').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const key = b.dataset.key;
    state.favorites = key === 'favorites';
    state.sport = state.favorites ? '' : key;
    state.core_competency = '';
    storageSet('localStorage', 'exercises_sport', key);
    renderTabs(); loadFilterOptions(); load();
  });

  /* ---------------- Filter */
  $('#fPlayers').innerHTML = '<option value="">Alle</option>' + Array.from({ length: LIM.exercise_filter_field_players_max || 20 }, (_, i) => '<option value="' + (i + 1) + '">' + (i + 1) + '</option>').join('');
  function renderDiff() {
    $('#fDiff').innerHTML = [''].concat(CONFIG.difficulties || []).map((d) => '<button type="button" class="' + (state.difficulty === d ? 'active' : '') + '" data-v="' + escHtml(d) + '">' + escHtml(d || 'Alle') + '</button>').join('');
  }
  $('#fDiff').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.difficulty = b.dataset.v; renderDiff(); load(); });
  async function loadFilterOptions() {
    const comps = state.sport ? (CONFIG.core_competencies || {})[state.sport] || [] : null;
    let opts = null;
    try { opts = await api('/api/filter-options' + (state.sport ? '?sport=' + encodeURIComponent(state.sport) : '')); } catch (e) { opts = null; }
    const compList = comps || (opts ? opts.competencies : []);
    $('#fComp').innerHTML = '<option value="">Alle</option>' + compList.map((c) => '<option' + (c === state.core_competency ? ' selected' : '') + '>' + escHtml(c) + '</option>').join('');
    const sizes = CONFIG.field_sizes || [];
    $('#fSize').innerHTML = '<option value="">Alle</option>' + sizes.map((c) => '<option' + (c === state.field_size ? ' selected' : '') + '>' + escHtml(c) + '</option>').join('');
  }
  [['#fPlayers', 'field_players'], ['#fGoal', 'goalkeepers'], ['#fComp', 'core_competency'], ['#fSize', 'field_size']].forEach((p) => {
    $(p[0]).addEventListener('change', (e) => { state[p[1]] = e.target.value; load(); });
  });
  $('#filterReset').addEventListener('click', () => {
    ['field_players', 'goalkeepers', 'core_competency', 'difficulty', 'field_size'].forEach((k) => { state[k] = ''; });
    ['#fPlayers', '#fGoal', '#fComp', '#fSize'].forEach((s) => { $(s).value = ''; });
    renderDiff(); load();
  });
  $('#filterToggle').addEventListener('click', () => {
    const open = $('#filterPanel').classList.toggle('open');
    $('#filterToggle').setAttribute('aria-expanded', String(open));
  });
  function activeFilterCount() { return ['field_players', 'goalkeepers', 'core_competency', 'difficulty', 'field_size'].filter((k) => state[k] !== '').length; }
  function renderFilterBadge() {
    const n = activeFilterCount();
    $('#filterBadge').textContent = n; $('#filterBadge').classList.toggle('hidden', !n);
    $('#filterActiveText').textContent = n ? n + (n === 1 ? ' aktiver Filter' : ' aktive Filter') : 'Keine Filter aktiv';
  }
  $('#exSearch').addEventListener('input', debounce((e) => { state.search = e.target.value.trim(); load(); }, LIM.exercise_search_debounce_ms || 350));

  /* ---------------- Liste */
  async function load() {
    renderFilterBadge();
    const grid = $('#exGrid');
    const my = ++reqNo;
    grid.innerHTML = skeletonCards(6, 'sk-ex');
    const qs = new URLSearchParams();
    ['sport', 'field_players', 'goalkeepers', 'core_competency', 'difficulty', 'field_size', 'search'].forEach((k) => { if (state[k] !== '') qs.set(k, state[k]); });
    if (state.favorites) qs.set('favorites', '1');
    try {
      const data = await api('/api/exercises?' + qs.toString());
      if (my !== reqNo) return;
      items = data; render();
    } catch (err) { if (my === reqNo) renderError(grid, err.message, load); }
  }
  function cardHtml(ex) {
    return '<div class="ex-card card flush clickable" data-id="' + ex.id + '" tabindex="0" role="button" aria-label="' + escHtml(ex.title) + '">' +
      '<div class="ex-media">' + exMediaHtml(ex) +
      '<div class="fav-btn' + (ex.is_favorite ? ' on' : '') + '" role="button" tabindex="0" data-fav="' + ex.id + '" aria-label="Favorit">' + icon('heart', 'sm') + '</div>' +
      (ex.is_owner ? '<span class="badge own-badge">Eigene</span>' : '') + '</div>' +
      '<div class="ex-body"><div class="ex-sport"><span class="sport-dot" style="--c:' + sportColor(ex.sport) + '"></span>' + escHtml(ex.sport) + '</div>' +
      '<h3 class="ex-title">' + escHtml(ex.title) + '</h3>' +
      '<div class="meta"><span class="meta-chip">' + escHtml(ex.core_competency) + '</span><span class="meta-chip">' + escHtml(ex.difficulty) + '</span>' +
      '<span class="meta-chip">' + icon('users') + ex.field_players + (ex.goalkeepers ? ' + ' + ex.goalkeepers + ' TW' : '') + '</span></div></div></div>';
  }
  function render() {
    $('#exCount').textContent = plural(items.length, 'Übung', 'Übungen');
    const grid = $('#exGrid');
    if (!items.length) {
      const filtered = state.search || activeFilterCount() || state.favorites || state.sport;
      grid.innerHTML = state.favorites && !state.search && !activeFilterCount()
        ? emptyState('heart', 'Noch keine Favoriten', 'Tippe auf das Herz einer Übung, um sie hier zu sammeln.')
        : emptyState('search', filtered ? 'Keine Treffer' : 'Keine Übungen', filtered ? 'Passe Suche oder Filter an.' : 'Lege deine erste eigene Übung an.',
          filtered ? '<button class="btn btn-tinted btn-sm" type="button" id="emptyReset">Filter zurücksetzen</button>' : '');
      const r = $('#emptyReset'); if (r) r.addEventListener('click', () => { $('#exSearch').value = ''; state.search = ''; $('#filterReset').click(); });
      return;
    }
    grid.innerHTML = items.map(cardHtml).join('');
  }
  $('#exGrid').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { e.stopPropagation(); toggleFav(Number(fav.dataset.fav), fav); return; }
    const card = e.target.closest('.ex-card'); if (card) openDetail(Number(card.dataset.id));
  });
  $('#exGrid').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const fav = e.target.closest('[data-fav]');
    if (fav) { e.preventDefault(); toggleFav(Number(fav.dataset.fav), fav); return; }
    const card = e.target.closest('.ex-card'); if (card) { e.preventDefault(); openDetail(Number(card.dataset.id)); }
  });

  async function toggleFav(id, el) {
    if (el.dataset.busy) return;
    el.dataset.busy = '1';
    try {
      const r = await api('/api/exercises/' + id + '/favorite', { method: 'POST' });
      const ex = items.find((x) => x.id === id); if (ex) ex.is_favorite = r.is_favorite;
      $$('[data-fav="' + id + '"]').forEach((b) => b.classList.toggle('on', r.is_favorite));
      if (state.favorites && !r.is_favorite) { items = items.filter((x) => x.id !== id); render(); }
    } catch (err) { showToast(err.message, 'error'); }
    finally { delete el.dataset.busy; }
  }

  /* ---------------- Detail */
  async function openDetail(id) {
    let ex = items.find((x) => x.id === id);
    if (!ex) { try { ex = await api('/api/exercises/' + id); } catch (err) { showToast(err.message, 'error'); return; } }
    const body = openModal(ex.title, '<div class="ex-detail">' +
      '<div class="ex-detail-media">' + exMediaHtml(ex, true) + '</div>' + exMetaHtml(ex) +
      '<h3 class="sub-h">Beschreibung</h3><p class="pre">' + escHtml(ex.description) + '</p>' +
      '<div class="modal-foot detail-actions">' +
      '<div class="fav-btn inline' + (ex.is_favorite ? ' on' : '') + '" role="button" tabindex="0" data-fav="' + ex.id + '" aria-label="Favorit">' + icon('heart', 'sm') + '</div>' +
      (ex.is_owner ? '<button class="icon-btn" type="button" data-act="share" aria-label="Teilen">' + icon('share', 'sm') + '</button>' +
        '<button class="icon-btn" type="button" data-act="edit" aria-label="Bearbeiten">' + icon('edit', 'sm') + '</button>' +
        '<button class="icon-btn danger" type="button" data-act="delete" aria-label="Löschen">' + icon('trash', 'sm') + '</button>' : '') +
      '<span class="flex1"></span><button class="btn btn-primary" type="button" data-act="add">' + icon('plus', 'sm') + 'Zu Training hinzufügen</button></div></div>', 'lg');
    body.addEventListener('click', (e) => {
      const fav = e.target.closest('[data-fav]');
      if (fav) { toggleFav(ex.id, fav); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'add') openAddToTraining(ex);
      if (b.dataset.act === 'share') openShare(ex);
      if (b.dataset.act === 'edit') { closeModal(); openForm(ex); }
      if (b.dataset.act === 'delete') deleteExercise(ex);
    });
  }

  async function openAddToTraining(ex) {
    const body = openModal('Zu Training hinzufügen', '<p class="muted">„' + escHtml(ex.title) + '“</p>' +
      '<div class="form-row" style="margin-top:12px"><div class="field"><label for="attBlock">Block</label><select class="select" id="attBlock">' +
      (CONFIG.training_blocks || []).map((b) => '<option' + (b === CONFIG.training_block_default ? ' selected' : '') + '>' + escHtml(b) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="attDur">Dauer (Min., optional)</label><input class="input" id="attDur" type="number" inputmode="numeric" min="0" max="' + (LIM.exercise_duration_in_training_max || 240) + '"></div></div>' +
      '<div class="pick-list" id="attList"><div class="loading"><span class="spinner"></span></div></div>' +
      '<button class="btn btn-tinted btn-block" type="button" id="attNew" style="margin-top:12px">' + icon('plus', 'sm') + 'Neues Training mit dieser Übung</button>');
    const add = async (trainingId, btn) => withBusy(btn, async () => {
      const dur = $('#attDur', body).value;
      try {
        await api('/api/trainings/' + trainingId + '/exercises', { method: 'POST', body: { exercise_id: ex.id, block: $('#attBlock', body).value, duration: dur === '' ? null : Number(dur) } });
        closeModal(); showToast('Übung hinzugefügt', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
    $('#attNew', body).addEventListener('click', () => openNewTrainingDialog({
      onCreated: async (id) => {
        try { await api('/api/trainings/' + id + '/exercises', { method: 'POST', body: { exercise_id: ex.id, block: $('#attBlock', body).value, duration: $('#attDur', body).value === '' ? null : Number($('#attDur', body).value) } }); }
        catch (err) { showToast(err.message, 'error'); }
        location.href = '/training/' + id;
      },
    }));
    try {
      const all = await api('/api/trainings');
      const today = todayISO();
      const list = all.filter((t) => t.owned_by_me && t.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
      const el = $('#attList', body);
      if (!list.length) { el.innerHTML = emptyState('calendar', 'Keine anstehenden Trainings', 'Lege direkt ein neues Training an.', '', true); return; }
      el.innerHTML = '<div class="list">' + list.map((t) => '<button class="list-item" type="button" data-tid="' + t.id + '"><span class="li-ic" style="--c:' + sportColor(t.sport) + '">' + sportIcon(t.sport) + '</span>' +
        '<span class="li-main"><span class="li-title">' + escHtml(t.title) + '</span><span class="li-sub">' + escHtml(relDayLabel(t.date)) + (t.time ? ', ' + escHtml(t.time) : '') + ' · ' + plural(t.exercise_count, 'Übung', 'Übungen') + '</span></span>' + icon('plus', 'chev') + '</button>').join('') + '</div>';
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-tid]'); if (b) add(Number(b.dataset.tid), b); });
    } catch (err) { renderError($('#attList', body), err.message); }
  }

  async function openShare(ex) {
    const body = openModal('Übung teilen', '<div class="loading"><span class="spinner"></span></div>', 'sm');
    try {
      const r = await api('/api/exercises/' + ex.id + '/share', { method: 'POST' });
      ex.share_token = r.token;
      body.innerHTML = '<p class="muted">Jeder mit diesem Link kann die Übung ansehen und in die eigene Sammlung kopieren.</p>' +
        '<div class="field" style="margin-top:12px"><input class="input mono" readonly value="' + escHtml(r.share_url) + '" id="shareUrl"></div>' +
        '<div class="modal-foot"><button class="btn btn-danger" type="button" id="shRevoke">' + icon('unlink', 'sm') + 'Link widerrufen</button>' +
        '<button class="btn" type="button" id="shCopy">' + icon('copy', 'sm') + 'Link kopieren</button>' +
        '<button class="btn btn-primary" type="button" id="shShare">' + icon('share', 'sm') + 'Teilen</button></div>';
      $('#shareUrl', body).addEventListener('focus', (e) => e.target.select());
      $('#shCopy', body).addEventListener('click', async () => showToast(await copyText(r.share_url) ? 'Link kopiert' : 'Kopieren nicht möglich', 'success'));
      $('#shShare', body).addEventListener('click', () => shareOrCopy(r.share_url, ex.title));
      $('#shRevoke', body).addEventListener('click', async (e) => {
        const ok = await confirmDialog({ title: 'Link widerrufen?', message: 'Der bisherige Link funktioniert danach nicht mehr. Bereits importierte Kopien bleiben erhalten.', confirmText: 'Widerrufen', danger: true });
        if (!ok) return;
        withBusy(e.target, async () => {
          try { await api('/api/exercises/' + ex.id + '/share', { method: 'DELETE' }); ex.share_token = null; closeModal(); showToast('Link widerrufen', 'success'); }
          catch (err) { showToast(err.message, 'error'); }
        });
      });
    } catch (err) { renderError(body, err.message); }
  }

  async function deleteExercise(ex) {
    const ok = await confirmDialog({ title: 'Übung löschen?', message: 'Die Übung wird endgültig gelöscht und aus allen Trainings entfernt, in denen sie vorkommt.', confirmText: 'Löschen', danger: true });
    if (!ok) return;
    try {
      await api('/api/exercises/' + ex.id, { method: 'DELETE' });
      closeModal(); showToast('Übung gelöscht', 'success'); load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  /* ---------------- Formular (Neu / Bearbeiten) */
  function openForm(ex) {
    const editing = !!ex;
    ex = ex || { sport: state.sport || 'Fußball', field_players: 0, goalkeepers: 0, difficulty: '', field_size: '', core_competency: '' };
    const sports = CONFIG.sports || [];
    const body = openModal(editing ? 'Übung bearbeiten' : 'Neue Übung', '<form id="exForm" novalidate>' +
      '<div class="field"><label for="efTitle">Titel</label><input class="input" id="efTitle" maxlength="120" value="' + escHtml(ex.title || '') + '"></div>' +
      '<div class="field"><span class="label">Sportart</span><div class="pick-grid sport-pick" id="efSport">' + sports.map((s) => '<button type="button" class="pick' + (s === ex.sport ? ' active' : '') + '" data-v="' + escHtml(s) + '" style="--c:' + sportColor(s) + '"><span class="pick-ic">' + sportIcon(s) + '</span>' + escHtml(s) + '</button>').join('') + '</div></div>' +
      '<div class="form-row"><div class="field"><label for="efComp">Kernkompetenz</label><select class="select" id="efComp"></select></div>' +
      '<div class="field"><label for="efSize">Spielfeldgröße</label><select class="select" id="efSize"><option value="">Bitte wählen</option>' + (CONFIG.field_sizes || []).map((f) => '<option' + (f === ex.field_size ? ' selected' : '') + '>' + escHtml(f) + '</option>').join('') + '</select></div></div>' +
      '<div class="field"><span class="label">Schwierigkeit</span><div class="segmented" id="efDiff">' + (CONFIG.difficulties || []).map((d) => '<button type="button" data-v="' + escHtml(d) + '" class="' + (d === ex.difficulty ? 'active' : '') + '">' + escHtml(d) + '</button>').join('') + '</div></div>' +
      '<div class="form-row"><div class="field"><label for="efPlayers">Feldspieler (0–' + (LIM.exercise_field_players_max || 25) + ')</label><input class="input" id="efPlayers" type="number" inputmode="numeric" min="0" max="' + (LIM.exercise_field_players_max || 25) + '" value="' + escHtml(ex.field_players) + '"></div>' +
      '<div class="field"><label for="efGoal">Torhüter (0–' + (LIM.exercise_goalkeepers_max || 4) + ')</label><input class="input" id="efGoal" type="number" inputmode="numeric" min="0" max="' + (LIM.exercise_goalkeepers_max || 4) + '" value="' + escHtml(ex.goalkeepers) + '"></div></div>' +
      '<div class="field"><label for="efDesc">Erklärung</label><textarea class="textarea" id="efDesc" rows="6" maxlength="5000">' + escHtml(ex.description || '') + '</textarea></div>' +
      '<div class="field"><span class="label">Bild (optional, max. 16 MB)</span><div class="img-upload"><div class="img-preview" id="efPreview"></div>' +
      '<div class="stack" style="gap:8px"><label class="btn btn-tinted btn-sm" for="efImage">' + icon('image', 'sm') + 'Bild wählen</label>' +
      '<input class="sr-only" type="file" id="efImage" accept="image/*,.heic,.heif"><button class="btn btn-sm" type="button" id="efImgRemove">Bild entfernen</button></div></div></div>' +
      '<p class="form-error" id="efErr"></p><div class="modal-foot"><button class="btn" type="button" data-cancel>Abbrechen</button><button class="btn btn-primary" type="submit">' + icon('check', 'sm') + (editing ? 'Speichern' : 'Anlegen') + '</button></div></form>', 'lg');
    let sport = ex.sport, difficulty = ex.difficulty, removeImage = false, file = null;
    const fillComp = (keep) => {
      const list = (CONFIG.core_competencies || {})[sport] || [];
      $('#efComp', body).innerHTML = '<option value="">Bitte wählen</option>' + list.map((c) => '<option' + (keep && c === ex.core_competency ? ' selected' : '') + '>' + escHtml(c) + '</option>').join('');
    };
    fillComp(true);
    const preview = (src) => {
      $('#efPreview', body).innerHTML = src ? '<img src="' + escHtml(src) + '" alt="Vorschau">' : sportArt(sport, 'fill');
      $('#efImgRemove', body).classList.toggle('hidden', !src);
    };
    preview(ex.image_path ? imgUrl(ex.image_path) : '');
    $('#efSport', body).addEventListener('click', (e) => {
      const b = e.target.closest('.pick'); if (!b) return;
      sport = b.dataset.v; $$('#efSport .pick', body).forEach((x) => x.classList.toggle('active', x === b));
      fillComp(false);
      if (!file && (removeImage || !ex.image_path)) preview('');
    });
    $('#efDiff', body).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; difficulty = b.dataset.v; $$('#efDiff button', body).forEach((x) => x.classList.toggle('active', x === b)); });
    $('#efImage', body).addEventListener('change', (e) => {
      file = e.target.files[0] || null;
      if (!file) return;
      if (file.size > (LIM.upload_max_bytes || 16777216)) { showToast('Bild zu groß (max. 16 MB)', 'error'); file = null; e.target.value = ''; return; }
      removeImage = false;
      const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
      if (isHeic) { $('#efPreview', body).innerHTML = '<div class="heic-note">' + icon('image') + '<span>' + escHtml(file.name) + '</span></div>'; $('#efImgRemove', body).classList.remove('hidden'); }
      else preview(URL.createObjectURL(file));
    });
    $('#efImgRemove', body).addEventListener('click', () => { file = null; removeImage = true; $('#efImage', body).value = ''; preview(''); });
    $('[data-cancel]', body).addEventListener('click', () => closeModal());
    $('#exForm', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const errEl = $('#efErr', body); errEl.textContent = '';
      const v = (id) => $(id, body).value.trim();
      if (!v('#efTitle')) { errEl.textContent = 'Bitte gib einen Titel ein.'; return; }
      if (!v('#efComp')) { errEl.textContent = 'Bitte wähle eine Kernkompetenz.'; return; }
      if (!v('#efSize')) { errEl.textContent = 'Bitte wähle eine Spielfeldgröße.'; return; }
      if (!difficulty) { errEl.textContent = 'Bitte wähle eine Schwierigkeit.'; return; }
      if (!v('#efDesc')) { errEl.textContent = 'Bitte gib eine Erklärung ein.'; return; }
      const fd = new FormData();
      fd.append('title', v('#efTitle')); fd.append('sport', sport); fd.append('core_competency', v('#efComp'));
      fd.append('field_size', v('#efSize')); fd.append('difficulty', difficulty); fd.append('description', v('#efDesc'));
      fd.append('field_players', v('#efPlayers') || '0'); fd.append('goalkeepers', v('#efGoal') || '0');
      if (file) fd.append('image', file);
      if (removeImage) fd.append('remove_image', '1');
      withBusy(e.target.querySelector('[type=submit]'), async () => {
        try {
          const saved = await api(editing ? '/api/exercises/' + ex.id : '/api/exercises', { method: editing ? 'PUT' : 'POST', form: fd });
          closeModal(); showToast(editing ? 'Übung gespeichert' : 'Übung angelegt', 'success');
          await load(); openDetail(saved.id);
        } catch (err) { errEl.textContent = err.message; }
      });
    });
  }

  /* ---------------- Import via Link */
  function openImport() {
    const body = openModal('Übung über Link importieren', '<form id="impForm" novalidate><div class="field"><label for="impUrl">Geteilter Link oder Code</label>' +
      '<input class="input mono" id="impUrl" placeholder="https://…/exercise/share/…" autocomplete="off" spellcheck="false"></div>' +
      '<p class="form-error" id="impErr"></p><div class="modal-foot"><button class="btn" type="button" data-cancel>Abbrechen</button><button class="btn btn-primary" type="submit">' + icon('download', 'sm') + 'Importieren</button></div></form>', 'sm');
    $('[data-cancel]', body).addEventListener('click', () => closeModal());
    $('#impForm', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const m = $('#impUrl', body).value.trim().match(/([a-f0-9]{32})/i);
      if (!m) { $('#impErr', body).textContent = 'Kein gültiger Link gefunden.'; return; }
      withBusy(e.target.querySelector('[type=submit]'), async () => {
        try {
          const r = await api('/api/exercises/import/' + m[1].toLowerCase(), { method: 'POST' });
          closeModal(); showToast(r.message, 'success'); await load(); openDetail(r.id);
        } catch (err) { $('#impErr', body).textContent = err.message; }
      });
    });
  }

  $('#newExBtn').addEventListener('click', () => openForm(null));
  $('#importBtn').addEventListener('click', openImport);
  window.QUICK_HANDLERS.exercise = () => openForm(null);

  renderTabs(); renderDiff(); loadFilterOptions();
  load().then(() => {
    const qs = new URLSearchParams(location.search);
    if (qs.get('new') === '1') openForm(null);
    if (qs.get('id')) openDetail(Number(qs.get('id')));
    if (qs.get('new') || qs.get('id') || qs.get('fav')) history.replaceState(null, '', location.pathname);
  });
})();
