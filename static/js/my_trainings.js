'use strict';
/* Meine Trainings: nach Monat gruppiert, Suche, Wiederholen */
(function () {
  if (!claimPage('trList')) return;
  let all = [];
  const list = $('#trList');

  async function load() {
    list.innerHTML = skeletonCards(4);
    try { all = await api('/api/trainings'); render(); }
    catch (err) { renderError(list, err.message, load); }
  }
  function render() {
    const month = todayISO().slice(0, 7);
    $('#stTotal').textContent = all.length;
    $('#stMonth').textContent = all.filter((t) => t.date.slice(0, 7) === month).length;
    $('#stEx').textContent = all.reduce((s, t) => s + t.exercise_count, 0);
    const q = $('#trSearch').value.trim().toLowerCase();
    const items = q ? all.filter((t) => t.title.toLowerCase().includes(q)) : all;
    if (!all.length) {
      list.innerHTML = emptyState('clipboard', 'Noch keine Trainings', 'Plane dein erstes Training – Übungen fügst du danach hinzu.',
        '<button class="btn btn-primary" type="button" data-new>' + icon('plus', 'sm') + 'Neues Training</button>');
      return;
    }
    if (!items.length) { list.innerHTML = emptyState('search', 'Keine Treffer', 'Kein Training passt zu „' + q + '“.'); return; }
    const groups = new Map();
    items.forEach((t) => { const k = t.date.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
    let html = '';
    groups.forEach((arr, k) => {
      const [y, m] = k.split('-').map(Number);
      html += '<section class="tr-group"><h2 class="section-title">' + MONTHS[m - 1] + ' ' + y + ' <span class="badge">' + arr.length + '</span></h2><div class="tr-list">' + arr.map(cardHtml).join('') + '</div></section>';
    });
    list.innerHTML = html;
  }
  function cardHtml(t) {
    const d = parseISO(t.date), past = t.date < todayISO();
    return '<a class="tr-card card clickable' + (past ? ' past' : '') + '" href="/training/' + t.id + '">' +
      '<span class="date-tile" style="--c:' + sportColor(t.sport) + '"><small>' + MONTHS[d.getMonth()].slice(0, 3) + '</small><b>' + d.getDate() + '</b><small>' + WEEKDAYS_SHORT[weekdayIdx(d)] + '</small></span>' +
      '<span class="li-main"><span class="tr-title">' + escHtml(t.title) + '</span><span class="li-sub">' + (t.time ? escHtml(t.time) + ' · ' : '') + plural(t.exercise_count, 'Übung', 'Übungen') +
      (t.total_minutes ? ' · ' + t.total_minutes + ' Min.' : '') + '</span>' + (t.owned_by_me ? '' : '<span class="badge accent">Vom Trainer</span>') + '</span>' +
      (t.owned_by_me ? '<div class="btn btn-sm btn-tinted" role="button" tabindex="0" data-repeat="' + t.id + '">' + icon('repeat', 'sm') + '<span class="btn-label">Wiederholen</span></div>' : icon('chev-right', 'chev')) + '</a>';
  }
  list.addEventListener('click', (e) => {
    const rep = e.target.closest('[data-repeat]');
    if (rep) { e.preventDefault(); e.stopPropagation(); openRepeat(all.find((t) => t.id === Number(rep.dataset.repeat))); return; }
    if (e.target.closest('[data-new]')) openNewTrainingDialog();
  });
  list.addEventListener('keydown', (e) => {
    const rep = e.target.closest('[data-repeat]');
    if (rep && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openRepeat(all.find((t) => t.id === Number(rep.dataset.repeat))); }
  });
  $('#trSearch').addEventListener('input', debounce(render, 150));
  $('#newTrBtn').addEventListener('click', () => openNewTrainingDialog());
  window.QUICK_HANDLERS.training = () => openNewTrainingDialog();

  /* naechster gleicher Wochentag ab morgen (Vorschlag fuers Wiederholen) */
  function nextSameWeekday(iso) {
    const target = parseISO(iso).getDay();
    let d = addDays(todayISO(), 1);
    while (parseISO(d).getDay() !== target) d = addDays(d, 1);
    return d;
  }
  function openRepeat(t) {
    if (!t) return;
    const body = openModal('Training wiederholen', '<form id="repForm" novalidate><p class="muted">Kopiert alle Übungen inkl. Reihenfolge, Block, Dauer und Uhrzeit. Notizen bleiben leer.</p>' +
      '<div class="field" style="margin-top:12px"><label for="repTitle">Titel (optional)</label><input class="input" id="repTitle" maxlength="120" placeholder="' + escHtml(t.title) + '"></div>' +
      '<div class="field"><label for="repDate">Datum</label><input class="input" type="date" id="repDate" value="' + escHtml(nextSameWeekday(t.date)) + '"></div>' +
      '<p class="form-error" id="repErr"></p><div class="modal-foot"><button class="btn" type="button" data-cancel>Abbrechen</button><button class="btn btn-primary" type="submit">' + icon('repeat', 'sm') + 'Wiederholen</button></div></form>', 'sm');
    $('[data-cancel]', body).addEventListener('click', () => closeModal());
    $('#repForm', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const date = $('#repDate', body).value;
      if (!date) { $('#repErr', body).textContent = 'Bitte wähle ein Datum.'; return; }
      withBusy(e.target.querySelector('[type=submit]'), async () => {
        try {
          const r = await api('/api/trainings/' + t.id + '/duplicate', { method: 'POST', body: { date: date, title: $('#repTitle', body).value.trim() || null } });
          location.href = '/training/' + r.id;
        } catch (err) { $('#repErr', body).textContent = err.message; }
      });
    });
  }

  load().then(() => {
    if (new URLSearchParams(location.search).get('new') === '1') { history.replaceState(null, '', location.pathname); openNewTrainingDialog(); }
  });
})();
