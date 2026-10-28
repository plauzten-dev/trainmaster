'use strict';
/* Login + Registrierung (Wizard auf Mobile, komplettes Formular auf Desktop) */
(function () {
  const loginForm = $('#loginForm'), regForm = $('#regForm');
  const isMobile = () => window.matchMedia('(max-width: 640px)').matches;
  const PW_MIN = (CONFIG.limits || {}).password_min_length || 6;

  function setMode(mode) {
    $$('.auth-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    loginForm.classList.toggle('hidden', mode !== 'login');
    regForm.classList.toggle('hidden', mode !== 'register');
    if (mode === 'register') renderWizard();
  }
  $$('.auth-seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  bindPwToggles(document);

  /* ---------------- Query-Parameter */
  const qs = new URLSearchParams(location.search);
  if (qs.get('verified') === '1') showToast('E-Mail bestätigt – du kannst dich jetzt anmelden.', 'success');
  if (qs.get('verify_error') === 'invalid') showToast('Bestätigungslink ungültig.', 'error');
  if (qs.get('verify_error') === 'expired') showToast('Bestätigungslink abgelaufen. Fordere einen neuen an.', 'error');
  if (qs.get('mode') === 'register') setMode('register');

  /* ---------------- Login */
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = $('#liUser').value.trim(), pass = $('#liPass').value, errEl = $('#liErr');
    errEl.textContent = '';
    if (!user || !pass) { errEl.textContent = 'Bitte Benutzername/E-Mail und Passwort eingeben.'; return; }
    withBusy(loginForm.querySelector('[type=submit]'), async () => {
      try {
        await api('/api/auth/login', { method: 'POST', body: { username: user, password: pass }, noRedirect: true });
        location.href = '/dashboard';
      } catch (err) {
        errEl.textContent = err.message;
        $('#resendBox').classList.toggle('hidden', !(err.data && err.data.verification_required));
      }
    });
  });
  $('#resendBtn').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      const r = await api('/api/auth/resend-verification', { method: 'POST', body: { username: $('#liUser').value.trim() }, noRedirect: true });
      showToast(r.message, 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }));

  /* ---------------- Registrierung */
  let role = 'trainer', stepIdx = 0;
  const steps = () => ['role', role === 'player' ? 'invite' : null, 'username', 'email', 'password', 'privacy'].filter(Boolean);

  $$('.role-pick').forEach((b) => b.addEventListener('click', () => {
    role = b.dataset.role;
    $$('.role-pick').forEach((x) => x.classList.toggle('active', x === b));
    renderWizard();
  }));

  function renderWizard() {
    const list = steps();
    if (stepIdx >= list.length) stepIdx = list.length - 1;
    const mobile = isMobile();
    $$('.wiz-step', regForm).forEach((s) => {
      const inList = list.includes(s.dataset.step);
      s.classList.toggle('hidden', !inList || (mobile && s.dataset.step !== list[stepIdx]));
    });
    $('#wizProgress').innerHTML = mobile ? list.map((_, i) => '<span class="' + (i <= stepIdx ? 'on' : '') + '"></span>').join('') : '';
    $('#wizBack').classList.toggle('hidden', !mobile || stepIdx === 0);
    $('#wizNext').classList.toggle('hidden', !mobile || stepIdx === list.length - 1);
    $('#regSubmit').classList.toggle('hidden', mobile && stepIdx !== list.length - 1);
    $('#reErr').textContent = '';
  }
  window.addEventListener('resize', debounce(() => { if (!regForm.classList.contains('hidden')) renderWizard(); }, 150));

  function validate(step) {
    const v = (id) => $(id).value.trim();
    switch (step) {
      case 'invite': return /^[0-9A-Fa-f]{8}$/.test(v('#reInvite')) ? '' : 'Bitte gib den 8-stelligen Einladecode ein.';
      case 'username': {
        const u = v('#reUser');
        if (u.length < 3 || u.length > 40) return 'Benutzername muss 3–40 Zeichen lang sein.';
        return u.includes('@') ? 'Benutzername darf kein @ enthalten.' : '';
      }
      case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('#reMail')) ? '' : 'Bitte gib eine gültige E-Mail-Adresse ein.';
      case 'password': return $('#rePass').value.length >= PW_MIN ? '' : 'Passwort muss mindestens ' + PW_MIN + ' Zeichen lang sein.';
      case 'privacy': return $('#rePrivacy').checked ? '' : 'Bitte akzeptiere die Datenschutzerklärung.';
      default: return '';
    }
  }
  $('#wizNext').addEventListener('click', () => {
    const msg = validate(steps()[stepIdx]);
    if (msg) { $('#reErr').textContent = msg; return; }
    stepIdx++; renderWizard();
    const inp = $('.wiz-step:not(.hidden) input', regForm); if (inp && inp.type !== 'checkbox') inp.focus();
  });
  $('#wizBack').addEventListener('click', () => { stepIdx = Math.max(0, stepIdx - 1); renderWizard(); });
  $$('.wiz-step input', regForm).forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && isMobile() && stepIdx < steps().length - 1) { e.preventDefault(); $('#wizNext').click(); }
  }));
  $('#rePass').addEventListener('input', () => updateStrength($('#rePass').value, $('#reStrength')));

  regForm.addEventListener('submit', (e) => {
    e.preventDefault();
    for (const s of steps()) {
      const msg = validate(s);
      if (msg) {
        if (isMobile()) { stepIdx = steps().indexOf(s); renderWizard(); }
        $('#reErr').textContent = msg; return;
      }
    }
    const body = {
      username: $('#reUser').value.trim(), email: $('#reMail').value.trim(), password: $('#rePass').value,
      role: role, invite_code: role === 'player' ? $('#reInvite').value.trim().toUpperCase() : null, accept_privacy: $('#rePrivacy').checked,
    };
    withBusy($('#regSubmit'), async () => {
      try {
        const r = await api('/api/auth/register', { method: 'POST', body: body, noRedirect: true });
        if (r.verification_required) {
          showToast(r.message, 'success');
          setMode('login'); $('#liUser').value = body.username;
          $('#liErr').textContent = r.message;
        } else location.href = '/dashboard';
      } catch (err) { $('#reErr').textContent = err.message; }
    });
  });
})();
