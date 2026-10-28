'use strict';
/* Einstellungen: Mobile = Listenmenue mit Detailansichten, Desktop = Karten */
(function () {
  const root = $('#settings');
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  const hasMobileFeatures = window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!hasMobileFeatures) $$('.mobile-feature', root).forEach((el) => el.remove());
  let me = null;

  function open(sec) {
    root.classList.add('detail-open');
    $$('.set-section', root).forEach((s) => s.classList.toggle('current', s.dataset.sec === sec));
    if (isMobile()) $('#scroller').scrollTop = 0;
    else { const el = $('.set-section[data-sec="' + sec + '"]', root); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  function back() { root.classList.remove('detail-open'); $$('.set-section', root).forEach((s) => s.classList.remove('current')); }
  $$('[data-open]', root).forEach((b) => b.addEventListener('click', () => { open(b.dataset.open); history.replaceState(null, '', '#' + b.dataset.open); }));
  $$('[data-back]', root).forEach((b) => b.addEventListener('click', () => { back(); history.replaceState(null, '', location.pathname); }));
  if (location.hash && $('.set-section[data-sec="' + location.hash.slice(1) + '"]', root)) open(location.hash.slice(1));

  function renderAvatar() {
    const path = me && me.avatar_path, name = me ? me.username : '';
    $('#profAvatar').innerHTML = avatarHtml(path, name, 'lg');
    $('#menuAvatar').innerHTML = avatarHtml(path, name, 'lg');
    $('#menuName').textContent = name;
    $$('.head-avatar .avatar, .side-user .avatar').forEach((el) => { el.outerHTML = avatarHtml(path, name, 'sm'); });
    $('#avatarRemove').classList.toggle('hidden', !path);
  }

  async function load() {
    try {
      me = await api('/api/auth/me');
      $('#pfUser').value = me.username; $('#pfMail').value = me.email;
      renderAvatar();
      const created = me.created_at ? fmtDateLong(String(me.created_at).slice(0, 10)) : '–';
      $('#accountInfo').innerHTML = [['Mitglied seit', created], ['Benutzername', me.username], ['E-Mail', me.email], ['Rolle', (CONFIG.role_labels || {})[me.role] || me.role]]
        .map((kv) => '<div><dt>' + escHtml(kv[0]) + '</dt><dd>' + escHtml(kv[1]) + '</dd></div>').join('');
    } catch (err) { renderError($('#accountInfo'), err.message, load); }
  }
  load();

  /* Profil */
  $('#profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const errEl = $('#pfErr'); errEl.textContent = '';
    withBusy(e.target.querySelector('[type=submit]'), async () => {
      try {
        const r = await api('/api/auth/change-profile', { method: 'PUT', body: { username: $('#pfUser').value.trim(), email: $('#pfMail').value.trim() } });
        me.username = r.username; me.email = r.email; renderAvatar(); load();
        $$('.side-user-name').forEach((el) => { el.textContent = r.username; });
        showToast('Profil gespeichert', 'success');
      } catch (err) { errEl.textContent = err.message; }
    });
  });
  $('#avatarInput').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('image', file);
    const label = $('label[for=avatarInput]');
    label.classList.add('busy');
    api('/api/auth/avatar', { method: 'POST', form: fd })
      .then((r) => { me.avatar_path = r.avatar_path; renderAvatar(); showToast('Profilbild aktualisiert', 'success'); })
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => { label.classList.remove('busy'); e.target.value = ''; });
  });
  $('#avatarRemove').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try { await api('/api/auth/avatar', { method: 'DELETE' }); me.avatar_path = null; renderAvatar(); showToast('Profilbild entfernt', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
  }));

  /* Passwort */
  bindPwToggles(root);
  const PW_MIN = (CONFIG.limits || {}).password_min_length || 6;
  function checkMatch() {
    const a = $('#pwNew').value, b = $('#pwRep').value, el = $('#pwMatch');
    if (!b) { el.textContent = ''; return; }
    const ok = a === b;
    el.textContent = ok ? 'Passwörter stimmen überein' : 'Passwörter stimmen nicht überein';
    el.style.color = ok ? 'var(--success)' : 'var(--danger)';
  }
  $('#pwNew').addEventListener('input', () => {
    const v = $('#pwNew').value;
    const label = updateStrength(v, $('#pwStrength'));
    $('#pwStrengthLabel').textContent = v ? (v.length < PW_MIN ? 'Zu kurz (mind. ' + PW_MIN + ' Zeichen)' : 'Stärke: ' + label) : 'Mindestens ' + PW_MIN + ' Zeichen';
    checkMatch();
  });
  $('#pwRep').addEventListener('input', checkMatch);
  $('#pwForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const errEl = $('#pwErr'); errEl.textContent = '';
    const cur = $('#pwCur').value, nw = $('#pwNew').value, rep = $('#pwRep').value;
    if (!cur) { errEl.textContent = 'Bitte aktuelles Passwort eingeben.'; return; }
    if (nw.length < PW_MIN) { errEl.textContent = 'Neues Passwort muss mindestens ' + PW_MIN + ' Zeichen lang sein.'; return; }
    if (nw !== rep) { errEl.textContent = 'Passwörter stimmen nicht überein.'; return; }
    withBusy(e.target.querySelector('[type=submit]'), async () => {
      try {
        await api('/api/auth/change-password', { method: 'PUT', body: { current_password: cur, new_password: nw } });
        e.target.reset(); updateStrength('', $('#pwStrength')); $('#pwMatch').textContent = '';
        showToast('Passwort geändert', 'success');
      } catch (err) { errEl.textContent = err.message; }
    });
  });

  /* Darstellung (nur lokal) */
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') { document.documentElement.setAttribute('data-theme', t); storageSet('localStorage', 'theme', t); }
    else { document.documentElement.removeAttribute('data-theme'); storageDel('localStorage', 'theme'); t = 'system'; }
    $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
  }
  applyTheme(storageGet('localStorage', 'theme') || 'system');
  $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.theme)));
  function applyAccent(a) {
    if (a === 'ocean') { document.documentElement.setAttribute('data-accent', 'ocean'); storageSet('localStorage', 'accent', 'ocean'); }
    else { document.documentElement.removeAttribute('data-accent'); storageDel('localStorage', 'accent'); a = 'rose'; }
    $$('#accentPick .accent-pick').forEach((b) => b.classList.toggle('active', b.dataset.accent === a));
  }
  applyAccent(storageGet('localStorage', 'accent') || 'rose');
  $$('#accentPick .accent-pick').forEach((b) => b.addEventListener('click', () => applyAccent(b.dataset.accent)));

  /* Benachrichtigungen */
  function notifState() {
    if (!('Notification' in window)) return ['Nicht verfügbar', ''];
    if (Notification.permission === 'granted') return ['Aktiviert', 'success'];
    if (Notification.permission === 'denied') return ['Blockiert', 'danger'];
    return ['Aus', ''];
  }
  function renderNotif() {
    const el = $('#notifStatus'); if (!el) return;
    const s = notifState();
    el.textContent = s[0]; el.className = 'badge ' + s[1];
    $('#notifEnable').classList.toggle('hidden', !('Notification' in window) || Notification.permission !== 'default');
    $('#notifTest').classList.toggle('hidden', !('Notification' in window) || Notification.permission !== 'granted');
  }
  if ($('#notifStatus')) {
    renderNotif();
    $('#notifEnable').addEventListener('click', async () => { try { await Notification.requestPermission(); } catch (e) { /* ignorieren */ } renderNotif(); });
    $('#notifTest').addEventListener('click', async () => {
      const title = APP_NAME, opts = { body: 'Test-Benachrichtigung – alles funktioniert.', icon: '/static/icons/icon-192.png', badge: '/static/icons/icon-192.png' };
      try {
        if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.ready; await reg.showNotification(title, opts); }
        else new Notification(title, opts);
      } catch (e) {
        try { new Notification(title, opts); } catch (e2) { showToast('Benachrichtigung konnte nicht angezeigt werden', 'error'); }
      }
    });
  }

  /* Hilfe: Plattform */
  const ua = navigator.userAgent;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const platform = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Web';
  $('#platformInfo').textContent = platform + (standalone ? ' · installierte App' : ' · Browser');

  /* Konto loeschen */
  $('#deleteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#delErr'); errEl.textContent = '';
    const pw = $('#delPass').value;
    if (!pw) { errEl.textContent = 'Bitte Passwort eingeben.'; return; }
    const ok = await confirmDialog({ title: 'Konto wirklich löschen?', message: 'Alle deine Daten und Bilder werden endgültig entfernt.', confirmText: 'Endgültig löschen', danger: true });
    if (!ok) return;
    withBusy(e.target.querySelector('[type=submit]'), async () => {
      try {
        await api('/api/auth/account', { method: 'DELETE', body: { password: pw } });
        storageDel('sessionStorage', 'splashShown');
        location.href = '/login';
      } catch (err) { errEl.textContent = err.message; }
    });
  });

  /* Abmelden */
  $('[data-logout]', root).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (err) { /* trotzdem weiter */ }
    location.href = '/login';
  }));
})();
