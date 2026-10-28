'use strict';
/* Mein Team: Teams, Kader, Spieler, Status, Einladecodes, Anwesenheits-Uebersicht */
(function () {
  if (!claimPage('teamRoot')) return;
  const root = $('#teamRoot');
  const STATUS = CONFIG.player_status || ['fit', 'krank', 'verletzt'];
  const STATUS_LABEL = CONFIG.player_status_labels || {};
  const STATUS_ICON = { fit: 'heart-pulse', krank: 'thermo', verletzt: 'bandage' };
  const TH = CONFIG.attendance_percent_thresholds || { good_min: 75, ok_min: 50 };
  let teams = [], teamId = null, players = [], summary = null, search = '', posFilter = '';

  function teamById(id) { return teams.find((t) => t.id === id); }
  function positionsFor(sport) { return (CONFIG.player_positions || {})[sport] || [CONFIG.player_position_default || 'Universal']; }

  async function loadTeams() {
    try { teams = await api('/api/teams'); }
    catch (err) { renderError(root, err.message, loadTeams); return; }
    const fromHash = Number((location.hash.match(/team=(\d+)/) || [])[1]);
    teamId = teamById(fromHash) ? fromHash : (teamById(teamId) ? teamId : (teams[0] ? teams[0].id : null));
    renderShell();
    if (teamId) loadTeam();
  }

  function renderShell() {
    if (!teams.length) {
      root.innerHTML = '<div class="card">' + emptyState('users', 'Noch kein Team', 'Lege dein erstes Team an und füge Spieler hinzu. Jeder Spieler bekommt einen Einladecode für die App.',
        '<button class="btn btn-primary" type="button" data-new-team>' + icon('plus', 'sm') + 'Erstes Team erstellen</button>') + '</div>';
      return;
    }
    const team = teamById(teamId);
    root.innerHTML = '<div class="team-switch"><div class="chips team-tabs">' + teams.map((t) => '<button class="chip' + (t.id === teamId ? ' active' : '') + '" type="button" data-team="' + t.id + '"><span class="dot" style="--c:' + sportColor(t.sport) + '"></span>' + escHtml(t.name) + ' <span class="faint">' + t.player_count + '</span></button>').join('') +
      '<button class="chip" type="button" data-new-team aria-label="Neues Team">' + icon('plus', 'sm') + 'Team</button></div>' +
      '<div class="team-select row"><select class="select" id="teamSel" aria-label="Team wählen">' + teams.map((t) => '<option value="' + t.id + '"' + (t.id === teamId ? ' selected' : '') + '>' + escHtml(t.name) + ' (' + t.player_count + ')</option>').join('') + '</select>' +
      '<button class="icon-btn accent" type="button" data-new-team aria-label="Neues Team">' + icon('plus') + '</button></div></div>' +
      '<section class="team-head card flush"><div class="team-banner" style="--c:' + sportColor(team.sport) + '">' + sportMotif(team.sport, 'motif big-bg') +
      '<div class="team-id"><span class="sport-ic lg-ic" style="--c:rgba(255,255,255,.22)">' + sportIcon(team.sport) + '</span><div><h2>' + escHtml(team.name) + '</h2><span>' + escHtml(team.sport) + '</span></div></div>' +
      '<div class="team-actions"><button class="btn btn-glass btn-sm" type="button" data-att-overview>' + icon('chart', 'sm') + '<span class="btn-label">Anwesenheit</span></button>' +
      '<button class="btn btn-glass btn-sm" type="button" data-edit-team>' + icon('edit', 'sm') + '<span class="btn-label">Team bearbeiten</span></button>' +
      '<button class="btn btn-primary btn-sm" type="button" data-new-player>' + icon('plus', 'sm') + '<span class="btn-label">Spieler</span></button></div></div>' +
      '<div class="kpis team-kpis"><div class="stat"><b id="kPlayers">–</b><span>Spieler</span></div><div class="stat"><b id="kAtt">–</b><span>Anwesenheit</span></div><div class="stat"><b id="kTr">–</b><span>Trainings erfasst</span></div></div>' +
      '<div class="health" id="health"></div></section>' +
      '<div class="toolbar"><label class="search"><svg class="i"><use href="#i-search"/></svg><input class="input" type="search" id="plSearch" placeholder="Name oder Position" autocomplete="off" value="' + escHtml(search) + '" aria-label="Spieler suchen"></label></div>' +
      '<div class="pos-filter" id="posFilter"></div><div class="roster" id="roster">' + skeletonCards(3, 'sk-player') + '</div>';
    $('#plSearch').addEventListener('input', debounce((e) => { search = e.target.value.trim().toLowerCase(); renderRoster(); }, 150));
    $('#teamSel').addEventListener('change', (e) => selectTeam(Number(e.target.value)));
  }
  function selectTeam(id) {
    teamId = id; posFilter = ''; search = '';
    history.replaceState(null, '', '#team=' + id);
    renderShell(); loadTeam();
  }

  async function loadTeam() {
    const my = teamId;
    try {
      const [pl, sum] = await Promise.all([api('/api/players?team_id=' + teamId), api('/api/teams/' + teamId + '/attendance-summary')]);
      if (my !== teamId) return;
      players = pl; summary = sum; renderStats(); renderRoster();
    } catch (err) { renderError($('#roster'), err.message, loadTeam); }
  }
  function renderStats() {
    const marked = summary.players.reduce((s, p) => s + p.marked_count, 0);
    const present = summary.players.reduce((s, p) => s + p.present_count, 0);
    $('#kPlayers').textContent = players.length;
    $('#kAtt').textContent = marked ? Math.round(present / marked * 100) + ' %' : '–';
    $('#kTr').textContent = summary.total_tracked;
    $('#health').innerHTML = STATUS.map((s) => '<span class="health-chip ' + s + '">' + icon(STATUS_ICON[s], 'sm') + players.filter((p) => p.status === s).length + ' ' + escHtml(STATUS_LABEL[s]) + '</span>').join('');
  }
  function renderRoster() {
    const team = teamById(teamId);
    const positions = Array.from(new Set(players.map((p) => p.position))).sort();
    const pf = $('#posFilter');
    pf.innerHTML = positions.length > 1 ? '<button class="chip pos-current' + (posFilter ? ' active' : '') + '" type="button" data-pos-toggle>' + icon('filter', 'sm') + escHtml(posFilter || 'Alle Positionen') + icon('chev-down', 'sm') + '</button>' +
      '<div class="chips pos-chips">' + [''].concat(positions).map((p) => '<button class="chip' + (p === posFilter ? ' active' : '') + '" type="button" data-pos="' + escHtml(p) + '">' + escHtml(p || 'Alle') + '</button>').join('') + '</div>' : '';
    const list = players.filter((p) => (!posFilter || p.position === posFilter) && (!search || p.name.toLowerCase().includes(search) || p.position.toLowerCase().includes(search)));
    const el = $('#roster');
    if (!players.length) {
      el.innerHTML = '<div class="card">' + emptyState('user', 'Noch keine Spieler', 'Füge Spieler zu „' + team.name + '“ hinzu.', '<button class="btn btn-primary btn-sm" type="button" data-new-player>' + icon('plus', 'sm') + 'Spieler hinzufügen</button>', true) + '</div>';
      return;
    }
    if (!list.length) { el.innerHTML = '<div class="card">' + emptyState('search', 'Keine Treffer', 'Kein Spieler passt zur Suche.', '', true) + '</div>'; return; }
    el.innerHTML = list.map(playerCard).join('');
  }
  function playerCard(p) {
    const age = ageFrom(p.birthday), bday = isBirthdayToday(p.birthday);
    const others = p.team_ids.filter((id) => id !== teamId).map(teamById).filter(Boolean);
    const team = teamById(teamId);
    return '<article class="player card flush' + (bday ? ' birthday' : '') + '" data-pid="' + p.id + '">' +
      (bday ? '<div class="bday-banner">' + icon('cake', 'sm') + 'Heute Geburtstag!</div>' : '') +
      '<div class="player-top" style="--c:' + sportColor(team.sport) + '">' + avatarHtml(p.avatar_path, p.name, 'player-av') + (p.number ? '<span class="jersey">' + p.number + '</span>' : '') + '</div>' +
      '<div class="player-body"><h3>' + escHtml(p.name) + '</h3><div class="muted">' + escHtml(p.position) + '</div>' +
      '<div class="meta" style="margin-top:6px">' + (age != null ? '<span class="meta-chip">' + age + ' J.</span>' : '') +
      others.slice(0, 2).map((t) => '<span class="meta-chip"><span class="sport-dot" style="--c:' + sportColor(t.sport) + '"></span>' + escHtml(t.name) + '</span>').join('') +
      (others.length > 2 ? '<span class="meta-chip">+' + (others.length - 2) + '</span>' : '') + '</div>' +
      (p.notes ? '<p class="player-notes">' + escHtml(p.notes) + '</p>' : '') +
      '<div class="status-switch" role="group" aria-label="Status">' + STATUS.map((s) => '<button type="button" class="' + s + (p.status === s ? ' active' : '') + '" data-status="' + s + '">' + escHtml(STATUS_LABEL[s]) + '</button>').join('') + '</div>' +
      '<div class="invite-row">' + (p.is_linked ? '<span class="badge success">' + icon('link', 'sm') + 'Verknüpft</span>' :
        '<span class="faint">' + icon('key', 'sm') + '</span><code class="mono">' + escHtml(p.invite_code) + '</code><button class="btn btn-ghost btn-sm" type="button" data-copy-code="' + escHtml(p.invite_code) + '">' + icon('copy', 'sm') + 'Kopieren</button>') + '</div>' +
      '<div class="player-actions"><button class="btn btn-sm" type="button" data-edit-player>' + icon('edit', 'sm') + 'Bearbeiten</button>' +
      '<button class="btn btn-sm btn-danger" type="button" data-remove-player>' + icon('minus', 'sm') + 'Aus Team entfernen</button></div></div></article>';
  }

  /* ---------------- Ereignisse */
  root.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-team]'); if (tb) { selectTeam(Number(tb.dataset.team)); return; }
    if (e.target.closest('[data-new-team]')) { openTeamForm(null); return; }
    if (e.target.closest('[data-edit-team]')) { openTeamForm(teamById(teamId)); return; }
    if (e.target.closest('[data-new-player]')) { openPlayerForm(null); return; }
    if (e.target.closest('[data-att-overview]')) { openOverview(); return; }
    if (e.target.closest('[data-pos-toggle]')) { $('#posFilter').classList.toggle('open'); return; }
    const pos = e.target.closest('[data-pos]'); if (pos) { posFilter = pos.dataset.pos; $('#posFilter').classList.remove('open'); renderRoster(); return; }
    const cc = e.target.closest('[data-copy-code]'); if (cc) { showToast(await copyText(cc.dataset.copyCode) ? 'Einladecode kopiert' : 'Kopieren nicht möglich', 'success'); return; }
    const card = e.target.closest('.player'); if (!card) return;
    const p = players.find((x) => x.id === Number(card.dataset.pid));
    const st = e.target.closest('[data-status]'); if (st) { setStatus(p, st.dataset.status); return; }
    if (e.target.closest('[data-edit-player]')) openPlayerForm(p);
    if (e.target.closest('[data-remove-player]')) removeFromTeam(p);
  });

  async function setStatus(p, status) {
    if (p.status === status) return;
    const old = p.status;
    p.status = status; renderRoster(); renderStats();
    try { await api('/api/players/' + p.id + '/status', { method: 'PUT', body: { status: status } }); }
    catch (err) { p.status = old; renderRoster(); renderStats(); showToast(err.message, 'error'); }
  }
  async function removeFromTeam(p) {
    const last = p.team_ids.length <= 1;
    const team = teamById(teamId);
    if (last) {
      const body = openModal('Spieler entfernen', '<p class="muted">„' + escHtml(p.name) + '“ ist nur in diesem Team. Möchtest du den Spieler nur aus „' + escHtml(team.name) + '“ entfernen (er bleibt ohne Team erhalten) oder vollständig löschen?</p>' +
        '<div class="modal-foot"><button class="btn" type="button" data-c>Abbrechen</button><button class="btn btn-tinted" type="button" data-only>Nur entfernen</button><button class="btn btn-danger solid" type="button" data-full>Vollständig löschen</button></div>', 'sm');
      $('[data-c]', body).addEventListener('click', () => closeModal());
      $('[data-only]', body).addEventListener('click', (e) => withBusy(e.currentTarget, async () => { await doRemove(p); closeModal(); }));
      $('[data-full]', body).addEventListener('click', (e) => withBusy(e.currentTarget, async () => { if (await doDelete(p)) closeModal(); }));
      return;
    }
    const ok = await confirmDialog({ title: 'Aus Team entfernen?', message: '„' + p.name + '“ wird aus „' + team.name + '“ entfernt, bleibt aber in den anderen Teams.', confirmText: 'Entfernen', danger: true });
    if (ok) doRemove(p);
  }
  async function doRemove(p) {
    try { await api('/api/players/' + p.id + '/teams/' + teamId, { method: 'DELETE' }); showToast('Aus Team entfernt', 'success'); refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  }
  async function doDelete(p) {
    try { await api('/api/players/' + p.id, { method: 'DELETE' }); showToast('Spieler gelöscht', 'success'); refresh(); return true; }
    catch (err) { showToast(err.message, 'error'); return false; }
  }
  async function refresh() {
    try { teams = await api('/api/teams'); } catch (e) { /* weiter mit altem Stand */ }
    if (!teamById(teamId)) teamId = teams[0] ? teams[0].id : null;
    renderShell(); if (teamId) loadTeam();
  }

  /* ---------------- Team-Formular */
  function openTeamForm(team) {
    const editing = !!team;
    let sport = team ? team.sport : 'Fußball';
    const body = openModal(editing ? 'Team bearbeiten' : 'Neues Team', '<form id="tmForm" novalidate><div class="field"><label for="tmName">Teamname</label><input class="input" id="tmName" maxlength="80" value="' + escHtml(team ? team.name : '') + '" placeholder="z. B. U15 Juniorinnen"></div>' +
      '<div class="field"><span class="label">Sportart</span><div class="pick-grid" id="tmSport">' + (CONFIG.sports || []).map((s) => '<button type="button" class="pick' + (s === sport ? ' active' : '') + '" data-v="' + escHtml(s) + '" style="--c:' + sportColor(s) + '"><span class="pick-ic">' + sportIcon(s) + '</span>' + escHtml(s) + '</button>').join('') + '</div></div>' +
      '<p class="form-error" id="tmErr"></p><div class="modal-foot">' + (editing ? '<button class="btn btn-danger" type="button" id="tmDelete">' + icon('trash', 'sm') + 'Löschen</button><span class="flex1"></span>' : '') +
      '<button class="btn" type="button" data-cancel>Abbrechen</button><button class="btn btn-primary" type="submit">Speichern</button></div></form>');
    $('#tmSport', body).addEventListener('click', (e) => { const b = e.target.closest('.pick'); if (!b) return; sport = b.dataset.v; $$('#tmSport .pick', body).forEach((x) => x.classList.toggle('active', x === b)); });
    $('[data-cancel]', body).addEventListener('click', () => closeModal());
    if (editing) $('#tmDelete', body).addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Team löschen?', message: '„' + team.name + '“ wird gelöscht. Die Spieler bleiben erhalten, nur die Zugehörigkeit zu diesem Team entfällt.', confirmText: 'Team löschen', danger: true });
      if (!ok) return;
      try { await api('/api/teams/' + team.id, { method: 'DELETE' }); closeModal(); showToast('Team gelöscht', 'success'); teamId = null; history.replaceState(null, '', location.pathname); refresh(); }
      catch (err) { showToast(err.message, 'error'); }
    });
    $('#tmForm', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#tmName', body).value.trim();
      if (!name) { $('#tmErr', body).textContent = 'Bitte gib einen Teamnamen ein.'; return; }
      withBusy(e.target.querySelector('[type=submit]'), async () => {
        try {
          const r = await api(editing ? '/api/teams/' + team.id : '/api/teams', { method: editing ? 'PUT' : 'POST', body: { name: name, sport: sport } });
          closeModal(); showToast(editing ? 'Team gespeichert' : 'Team angelegt', 'success');
          if (!editing) teamId = r.id;
          refresh();
        } catch (err) { $('#tmErr', body).textContent = err.message; }
      });
    });
  }

  /* ---------------- Spieler-Formular */
  function openPlayerForm(p) {
    const editing = !!p;
    const team = teamById(teamId);
    const positions = positionsFor(team.sport);
    p = p || { name: '', position: positions[0], number: null, birthday: '', status: 'fit', notes: '', team_ids: [teamId], invite_code: '', is_linked: false };
    let status = p.status;
    const posList = positions.includes(p.position) ? positions : [p.position].concat(positions);
    const body = openModal(editing ? 'Spieler bearbeiten' : 'Neuer Spieler', '<form id="plForm" novalidate>' +
      (editing ? '<div class="set-avatar-row"><span id="plAv">' + avatarHtml(p.avatar_path, p.name, 'lg') + '</span><div class="row wrap"><label class="btn btn-tinted btn-sm" for="plImg">' + icon('camera', 'sm') + 'Bild wählen</label><input class="sr-only" type="file" id="plImg" accept="image/*,.heic,.heif">' +
        '<button class="btn btn-sm' + (p.avatar_path ? '' : ' hidden') + '" type="button" id="plImgDel">Entfernen</button></div></div>' : '') +
      '<div class="field"><label for="plName">Name</label><input class="input" id="plName" maxlength="80" value="' + escHtml(p.name) + '"></div>' +
      '<div class="form-row"><div class="field"><label for="plPos">Position</label><select class="select" id="plPos">' + posList.map((x) => '<option' + (x === p.position ? ' selected' : '') + '>' + escHtml(x) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="plNum">Trikotnummer</label><input class="input" id="plNum" type="number" inputmode="numeric" min="1" max="99" value="' + (p.number || '') + '"></div></div>' +
      '<div class="field"><label for="plBday">Geburtstag (optional)</label><input class="input" id="plBday" type="date" value="' + escHtml(p.birthday || '') + '"></div>' +
      '<div class="field"><span class="label">Status</span><div class="status-switch" id="plStatus">' + STATUS.map((s) => '<button type="button" class="' + s + (s === status ? ' active' : '') + '" data-s="' + s + '">' + escHtml(STATUS_LABEL[s]) + '</button>').join('') + '</div>' +
      '<span class="form-hint">Krank/Verletzt sind Gesundheitsangaben – bitte nur mit Einverständnis des Spielers bzw. der Erziehungsberechtigten erfassen.</span></div>' +
      (teams.length > 1 ? '<div class="field"><span class="label">Teams</span><div class="team-checks">' + teams.map((t) => '<label class="check"><input type="checkbox" value="' + t.id + '"' + (p.team_ids.includes(t.id) ? ' checked' : '') + '><span><span class="sport-dot" style="--c:' + sportColor(t.sport) + ';display:inline-block;margin-right:6px"></span>' + escHtml(t.name) + '</span></label>').join('') + '</div></div>' : '') +
      '<div class="field"><label for="plNotes">Notizen</label><textarea class="textarea" id="plNotes" rows="3" maxlength="2000">' + escHtml(p.notes || '') + '</textarea></div>' +
      (editing ? '<div class="field"><span class="label">Einladecode</span><div class="invite-box">' + (p.is_linked ? '<span class="badge success">' + icon('link', 'sm') + 'Mit Spieler-Konto verknüpft</span>' : '<code class="mono big-code">' + escHtml(p.invite_code) + '</code><button class="btn btn-ghost btn-sm" type="button" id="plCopy">' + icon('copy', 'sm') + 'Kopieren</button>') +
        '<button class="btn btn-sm" type="button" id="plRegen">' + icon('refresh', 'sm') + (p.is_linked ? 'Verknüpfung lösen & neuer Code' : 'Neuen Code erzeugen') + '</button></div></div>' : '') +
      '<p class="form-error" id="plErr"></p><div class="modal-foot">' + (editing ? '<button class="btn btn-danger" type="button" id="plDelete">' + icon('trash', 'sm') + 'Spieler löschen</button><span class="flex1"></span>' : '') +
      '<button class="btn" type="button" data-cancel>Abbrechen</button><button class="btn btn-primary" type="submit">Speichern</button></div></form>');
    $('#plStatus', body).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; status = b.dataset.s; $$('#plStatus button', body).forEach((x) => x.classList.toggle('active', x === b)); });
    $('[data-cancel]', body).addEventListener('click', () => closeModal());
    if (editing) {
      const cp = $('#plCopy', body); if (cp) cp.addEventListener('click', async () => showToast(await copyText(p.invite_code) ? 'Einladecode kopiert' : 'Kopieren nicht möglich', 'success'));
      $('#plRegen', body).addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Neuen Code erzeugen?', message: p.is_linked ? 'Die Verknüpfung mit dem Spieler-Konto wird gelöst. Der Spieler sieht deine Trainings und Termine danach nicht mehr, bis er einen neuen Code einlöst.' : 'Der bisherige Code wird ungültig.', confirmText: 'Neuen Code erzeugen', danger: p.is_linked });
        if (!ok) return;
        try { const r = await api('/api/players/' + p.id + '/regenerate-invite', { method: 'POST' }); closeModal(); showToast('Neuer Code: ' + r.invite_code, 'success'); loadTeam(); }
        catch (err) { showToast(err.message, 'error'); }
      });
      $('#plDelete', body).addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Spieler löschen?', message: '„' + p.name + '“ wird aus allen Teams entfernt und mit Anwesenheitsdaten und Bild endgültig gelöscht.', confirmText: 'Löschen', danger: true });
        if (ok && await doDelete(p)) closeModal();
      });
      $('#plImg', body).addEventListener('change', (e) => {
        const f = e.target.files[0]; if (!f) return;
        const fd = new FormData(); fd.append('image', f);
        api('/api/players/' + p.id + '/avatar', { method: 'POST', form: fd })
          .then((r) => { p.avatar_path = r.avatar_path; $('#plAv', body).innerHTML = avatarHtml(r.avatar_path, p.name, 'lg'); $('#plImgDel', body).classList.remove('hidden'); renderRoster(); showToast('Bild gespeichert', 'success'); })
          .catch((err) => showToast(err.message, 'error')).finally(() => { e.target.value = ''; });
      });
      const delBtn = $('#plImgDel', body);
      delBtn.addEventListener('click', () => withBusy(delBtn, async () => {
        try { await api('/api/players/' + p.id + '/avatar', { method: 'DELETE' }); p.avatar_path = null; $('#plAv', body).innerHTML = avatarHtml(null, p.name, 'lg'); delBtn.classList.add('hidden'); renderRoster(); }
        catch (err) { showToast(err.message, 'error'); }
      }));
    }
    $('#plForm', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const errEl = $('#plErr', body); errEl.textContent = '';
      const name = $('#plName', body).value.trim(), num = $('#plNum', body).value;
      if (!name) { errEl.textContent = 'Bitte gib einen Namen ein.'; return; }
      if (num && (Number(num) < 1 || Number(num) > 99)) { errEl.textContent = 'Trikotnummer muss zwischen 1 und 99 liegen.'; return; }
      const checks = $$('.team-checks input', body);
      const teamIds = checks.length ? checks.filter((c) => c.checked).map((c) => Number(c.value)) : [teamId];
      const payload = { name: name, position: $('#plPos', body).value, number: num ? Number(num) : null, birthday: $('#plBday', body).value || null, status: status, notes: $('#plNotes', body).value, team_ids: teamIds };
      withBusy(e.target.querySelector('[type=submit]'), async () => {
        try {
          await api(editing ? '/api/players/' + p.id : '/api/players', { method: editing ? 'PUT' : 'POST', body: payload });
          closeModal(); showToast(editing ? 'Spieler gespeichert' : 'Spieler angelegt', 'success'); refresh();
        } catch (err) { errEl.textContent = err.message; }
      });
    });
  }

  /* ---------------- Anwesenheits-Uebersicht */
  async function openOverview() {
    const team = teamById(teamId);
    const body = openModal('Anwesenheit · ' + team.name, '<div class="loading"><span class="spinner"></span></div>');
    try {
      const s = await api('/api/teams/' + teamId + '/attendance-summary');
      if (!s.players.length) { body.innerHTML = emptyState('users', 'Keine Spieler', '', '', true); return; }
      body.innerHTML = '<p class="muted">' + plural(s.total_tracked, 'Training', 'Trainings') + ' mit Anwesenheitstracking</p><div class="ov-list">' + s.players.map((p) => {
        const pct = p.marked_count ? Math.round(p.present_count / p.marked_count * 100) : null;
        const cls = pct == null ? 'none' : pct >= TH.good_min ? 'good' : pct >= TH.ok_min ? 'ok' : 'bad';
        return '<div class="ov-row"><div class="row between"><span class="li-title">' + escHtml(p.name) + ' <span class="faint">' + escHtml(p.position) + '</span></span><b class="ov-pct ' + cls + '">' + (pct == null ? '–' : pct + ' %') + '</b></div>' +
          '<div class="ov-bar"><i class="' + cls + '" style="width:' + (pct || 0) + '%"></i></div><span class="li-sub">' + p.present_count + '× anwesend · ' + p.absent_count + '× gefehlt</span></div>';
      }).join('') + '</div>';
    } catch (err) { renderError(body, err.message, openOverview); }
  }

  loadTeams();
})();
