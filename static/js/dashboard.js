'use strict';
/* Dashboard im Bibliotheks-Stil: Heute-Karte, Diese Woche, Bibliothek-Liste, wischbare Reihen, Glocke */
(function () {
  if (!claimPage('dash')) return;
  const LIM = CONFIG.limits || {};
  const username = document.body.dataset.username || '';
  let data = null, stats = null;

  function greeting() {
    const h = new Date().getHours();
    const hit = (CONFIG.greeting_by_hour || []).find((g) => (g.from < g.to ? h >= g.from && h < g.to : h >= g.from || h < g.to));
    return (hit ? hit.text : 'Hallo') + ', ' + username;
  }
  $('#dashGreeting').textContent = greeting() + ' · ' + fmtWeekdayDate(todayISO());

  async function load() {
    try { data = await api('/api/dashboard'); }
    catch (err) { renderError($('#todayHero'), err.message, load); return; }
    renderToday(); renderWeek(); renderLibrary(); renderUpcoming(); renderSuggested(); renderBell();
  }

  /* ---------------- Heute */
  function renderToday() {
    const units = data.today_units, el = $('#todayHero');
    const next = units.find((u) => u.kind === 'training') || units[0];
    if (!next) {
      el.innerHTML = '<div class="th-row"><div class="th-art th-free">' + icon('sun', 'lg') + '</div><div class="th-main"><span class="th-label">Heute</span>' +
        '<b class="th-title">Heute frei</b><span class="th-sub">Nichts geplant – genieß den Tag.</span></div></div>' +
        '<div class="th-actions"><button class="btn btn-primary btn-sm" type="button" id="thNew">' + icon('plus', 'sm') + 'Training planen</button></div>';
      $('#thNew').addEventListener('click', () => openNewTrainingDialog());
      return;
    }
    const isTr = next.kind === 'training';
    const href = isTr ? '/training/' + next.id : '/calendar?date=' + todayISO();
    const art = isTr ? '<div class="th-art">' + sportArt(next.sport, 'fill') + '</div>'
      : '<div class="th-art th-ev" style="--c:var(--ev-' + next.type + ')">' + icon(EVENT_ICONS[next.type] || 'calendar', 'lg') + '</div>';
    const sub = isTr ? (next.from_trainer ? 'Vom Trainer · ' : '') + next.sport
      : ((CONFIG.event_type_labels || {})[next.type] || 'Termin') + (next.location ? ' · ' + next.location : '');
    const more = units.length - 1;
    el.innerHTML = '<a class="th-row" href="' + href + '">' + art + '<div class="th-main"><span class="th-label">Als Nächstes · ' + escHtml(next.time ? next.time + ' Uhr' : 'Heute') + '</span>' +
      '<b class="th-title">' + escHtml(next.title) + '</b><span class="th-sub">' + escHtml(sub) + '</span></div>' + icon('chev-right', 'chev') + '</a>' +
      '<div class="th-actions">' + (isTr ? '<a class="btn btn-primary btn-sm" href="/training/' + next.id + '?start=1">' + icon('play', 'sm fill') + 'Starten</a>' : '') +
      (more > 0 ? '<a class="btn btn-sm" href="/calendar?date=' + todayISO() + '">+' + more + ' weitere heute</a>' : '') + '</div>';
  }

  /* ---------------- Diese Woche (Wochenziel + Tage) */
  function goalText(done, goal) {
    if (done === 0) return 'Auf geht’s!';
    if (done < goal) return 'Stark unterwegs! Noch ' + (goal - done) + ' bis zum Wochenziel';
    if (done === goal) return 'Wochenziel erreicht!';
    return 'Wochenziel erreicht! Sogar ' + (done - goal) + ' extra';
  }
  function renderWeek() {
    const w = data.week, pct = Math.min(100, w.done / w.goal * 100);
    $('#weekCard').innerHTML = '<button class="wk-goal" type="button" id="goalBtn" aria-label="Wochenziel ändern">' +
      '<span class="row between"><b>Diese Woche</b><span class="wk-count"><b>' + w.done + '</b> von ' + w.goal + ' Trainings</span></span>' +
      '<span class="wk-bar"><i style="width:' + pct + '%"></i></span><span class="wk-text">' + escHtml(goalText(w.done, w.goal)) + ' · <span class="faint">Ziel ändern</span></span></button>' +
      '<div class="ws-days">' + w.days.map((d) => '<a class="ws-day' + (d.is_today ? ' today' : '') + '" href="/calendar?date=' + d.date + '">' +
        '<span class="ws-wd">' + WEEKDAYS_SHORT[d.weekday] + '</span><span class="ws-num">' + d.day_num + '</span><span class="ws-dots">' +
        (d.has_training ? '<i style="--c:var(--accent)"></i>' : '') + (d.has_event ? '<i style="--c:var(--ev-sonstiges)"></i>' : '') + '</span></a>').join('') + '</div>';
    $('#goalBtn').addEventListener('click', openGoalDialog);
  }
  function openGoalDialog() {
    let goal = data.week.goal;
    const min = LIM.weekly_goal_min || 1, max = LIM.weekly_goal_max || 14;
    const body = openModal('Wochenziel', '<p class="muted">Wie viele Trainings möchtest du pro Woche schaffen?</p><div class="stepper"><button class="icon-btn" type="button" data-d="-1" aria-label="Weniger">' + icon('minus') + '</button>' +
      '<b id="goalVal">' + goal + '</b><button class="icon-btn" type="button" data-d="1" aria-label="Mehr">' + icon('plus') + '</button></div>' +
      '<div class="modal-foot"><button class="btn" type="button" data-cancel>Abbrechen</button><button class="btn btn-primary" type="button" id="goalSave">Speichern</button></div>', 'sm');
    $$('[data-d]', body).forEach((b) => b.addEventListener('click', () => { goal = Math.max(min, Math.min(max, goal + Number(b.dataset.d))); $('#goalVal', body).textContent = goal; }));
    $('[data-cancel]', body).addEventListener('click', () => closeModal());
    const save = $('#goalSave', body);
    save.addEventListener('click', () => withBusy(save, async () => {
      try { const r = await api('/api/auth/weekly-goal', { method: 'PUT', body: { weekly_goal: goal } }); data.week.goal = r.weekly_goal; closeModal(); renderWeek(); showToast('Wochenziel gespeichert', 'success'); }
      catch (err) { showToast(err.message, 'error'); }
    }));
  }

  /* ---------------- Bibliothek (wie die Mediathek in Apple Music) */
  function renderLibrary() {
    const s = data.stats, lib = data.library || {};
    const upcoming = data.upcoming.reduce((n, d) => n + d.trainings.length + d.events.length, 0);
    const rows = [
      { href: '/my-trainings', ic: 'clipboard', c: '#2f6bff', title: 'Trainings', sub: s.trainings_this_month + ' diesen Monat', val: s.total_trainings },
      { href: '/calendar', ic: 'calendar', c: '#5e5ce6', title: 'Kalender', sub: 'nächste 4 Tage', val: upcoming },
      { href: '/exercises', ic: 'cones', c: '#26b55a', title: 'Übungen', sub: 'in ' + (CONFIG.sports || []).length + ' Sportarten', val: s.total_exercises },
      { href: '/exercises?fav=1', ic: 'heart', c: '#ff2d92', title: 'Favoriten', sub: 'gemerkte Übungen', val: lib.favorites },
    ];
    if (USER_ROLE === 'trainer') {
      rows.push({ href: '/players', ic: 'users', c: '#af52de', title: 'Mein Team', sub: plural(lib.teams || 0, 'Team', 'Teams') + (lib.unwell ? ' · ' + lib.unwell + ' angeschlagen' : ''), val: lib.players });
    }
    rows.push({ action: 'stats', ic: 'chart', c: '#00a9c9', title: 'Statistik', sub: 'Verlauf & meistgenutzte Übungen', val: '' });
    $('#library').innerHTML = rows.map((r) => {
      const inner = '<span class="li-ic" style="--c:' + r.c + '">' + icon(r.ic) + '</span><span class="li-main"><span class="li-title">' + escHtml(r.title) + '</span><span class="li-sub">' + escHtml(r.sub) + '</span></span>' +
        (r.val !== '' && r.val != null ? '<span class="lib-val">' + escHtml(r.val) + '</span>' : '') + icon('chev-right', 'chev');
      return r.href ? '<a class="list-item" href="' + r.href + '">' + inner + '</a>' : '<button class="list-item" type="button" data-action="' + r.action + '">' + inner + '</button>';
    }).join('');
  }
  $('#library').addEventListener('click', (e) => { if (e.target.closest('[data-action="stats"]')) openStats(); });

  async function openStats() {
    const body = openModal('Statistik', '<div class="loading"><span class="spinner"></span></div>', 'lg');
    if (!stats) {
      try { stats = await api('/api/statistik'); } catch (err) { renderError(body, err.message, () => { closeModal(); openStats(); }); return; }
    }
    const s = stats;
    const max = Math.max(1, ...s.monthly.map((m) => m.count));
    const W = 320, H = 150, bw = 32, gap = (W - bw * s.monthly.length) / (s.monthly.length + 1);
    const monthly = '<svg viewBox="0 0 ' + W + ' ' + (H + 26) + '" class="bar-chart" role="img" aria-label="Trainings pro Monat">' +
      '<defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--grad-a)"/><stop offset="1" style="stop-color:var(--grad-b)"/></linearGradient></defs>' +
      s.monthly.map((m, i) => {
        const h = Math.max(m.count ? 6 : 2, (m.count / max) * (H - 22)), x = gap + i * (bw + gap), y = H - h;
        return '<g><rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="8" class="' + (i === s.monthly.length - 1 ? 'bar cur' : 'bar') + '"><title>' + escHtml(m.month) + ': ' + m.count + '</title></rect>' +
          '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" class="bar-val">' + m.count + '</text><text x="' + (x + bw / 2) + '" y="' + (H + 18) + '" class="bar-lbl">' + escHtml(m.month.slice(0, 3)) + '</text></g>';
      }).join('') + '</svg>';
    const tmax = Math.max(1, ...s.top_exercises.map((x) => x.usage_count));
    const top = s.top_exercises.length ? '<div class="hbars">' + s.top_exercises.map((x) => '<a class="hbar" href="/exercises?id=' + x.id + '"><span class="hbar-top"><span>' + escHtml(x.title) + '</span><b>' + x.usage_count + '×</b></span>' +
      '<span class="hbar-track"><i style="width:' + (x.usage_count / tmax * 100) + '%;--c:' + sportColor(x.sport) + '"></i></span></a>').join('') + '</div>'
      : emptyState('star', 'Noch keine Daten', 'Sobald du Übungen in Trainings nutzt, erscheinen sie hier.', '', true);
    body.innerHTML = '<div class="card-title">' + icon('chart') + 'Trainings pro Monat</div>' + monthly +
      '<div class="card-title" style="margin-top:18px">' + icon('star') + 'Meistgenutzte Übungen</div>' + top;
  }

  /* ---------------- Naechste Tage + Vorschlaege (wischbare Reihen) */
  function upLabel(iso) {
    const diff = Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
    const labels = CONFIG.relative_day_labels || [];
    return diff < labels.length ? labels[diff] : WEEKDAYS_SHORT[weekdayIdx(parseISO(iso))];
  }
  function renderUpcoming() {
    $('#upcoming').innerHTML = data.upcoming.map((day) => {
      const entries = day.trainings.map((t) => ({ k: 't', t: t })).concat(day.events.map((e) => ({ k: 'e', t: e })))
        .sort((a, b) => (a.t.time || '99:99').localeCompare(b.t.time || '99:99'));
      const shown = entries.slice(0, 2), more = entries.length - shown.length;
      return '<div class="up-day card"><div class="up-head"><b>' + escHtml(upLabel(day.date)) + '</b><span class="faint">' + escHtml(fmtDateShort(day.date)) + '</span></div>' +
        (entries.length ? shown.map((x) => {
          const href = x.k === 't' ? '/training/' + x.t.id : '/calendar?date=' + day.date;
          const color = x.k === 't' ? sportColor(x.t.sport) : 'var(--ev-' + x.t.type + ')';
          return '<a class="up-item" href="' + href + '" style="--c:' + color + '"><span class="li-title">' + escHtml(x.t.title) + '</span><span class="li-sub">' + escHtml(x.t.time || 'ganztägig') +
            (x.k === 'e' ? ' · ' + escHtml((CONFIG.event_type_labels || {})[x.t.type] || '') : x.t.from_trainer ? ' · Vom Trainer' : '') + '</span></a>';
        }).join('') + (more > 0 ? '<a class="up-more" href="/calendar?date=' + day.date + '">+' + more + ' mehr</a>' : '')
          : '<a class="up-empty" href="/calendar?date=' + day.date + '">frei</a>') + '</div>';
    }).join('');
  }
  function renderSuggested() {
    $('#suggested').innerHTML = data.suggested.length ? data.suggested.map((ex) => '<a class="cover" href="/exercises?id=' + ex.id + '">' + sportArt(ex.sport, 'cover-art', true) +
      '<span class="cover-title">' + escHtml(ex.title) + '</span><span class="li-sub">' + escHtml(ex.core_competency) + ' · ' + escHtml(ex.difficulty) + '</span></a>').join('')
      : '<div class="card">' + emptyState('cones', 'Keine Vorschläge', '', '', true) + '</div>';
  }

  /* ---------------- Glocke "Demnaechst" */
  function renderBell() {
    const items = [];
    data.upcoming.forEach((d) => {
      d.trainings.forEach((t) => items.push({ date: d.date, time: t.time, title: t.title, href: '/training/' + t.id, color: sportColor(t.sport), label: 'Training' }));
      d.events.forEach((e) => items.push({ date: d.date, time: e.time, title: e.title, href: '/calendar?date=' + d.date, color: 'var(--ev-' + e.type + ')', label: (CONFIG.event_type_labels || {})[e.type] || 'Termin' }));
    });
    items.sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));
    const now = new Date(), hm = pad(now.getHours()) + ':' + pad(now.getMinutes()), today = todayISO();
    const list = items.filter((i) => i.date > today || !i.time || i.time >= hm).slice(0, 6);
    $('#bellDot').classList.toggle('hidden', !list.length);
    $('#bellBtn').onclick = () => {
      const pop = openPopover($('#bellBtn'), '<div class="pop-title">Demnächst</div>' + (list.length ? list.map((i) => '<a class="menu-item bell-item" href="' + i.href + '"><span class="sport-dot" style="--c:' + i.color + '"></span><span class="li-main"><span class="li-title">' + escHtml(i.title) + '</span><span class="li-sub">' + escHtml(relDayLabel(i.date)) + (i.time ? ', ' + escHtml(i.time) : '') + ' · ' + escHtml(i.label) + '</span></span></a>').join('')
        : '<p class="muted" style="padding:10px 14px">In den nächsten Tagen steht nichts an.</p>'));
      pop.classList.add('bell-pop');
    };
  }

  load();
})();
