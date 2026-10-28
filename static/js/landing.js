'use strict';
/* Landingpage: Einblenden beim Scrollen, Navigation, Hero-Bewegung, Timer-Demo,
   Installations-Anleitung mit Geraeteerkennung */
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Einblenden beim Scrollen */
  const items = $$('.reveal');
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  } else items.forEach((el) => el.classList.add('in'));

  /* ---------------- Navigation + Hero-Parallaxe */
  const nav = $('#lNav'), phone = $('#heroPhone .phone');  // Parallaxe am inneren Element, damit das Einblenden nicht ueberschrieben wird
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      nav.classList.toggle('scrolled', y > 8);
      if (phone && !reduced && y < 900) phone.style.transform = 'translateY(' + (y * -0.12) + 'px) rotate(' + Math.min(4, y / 150) + 'deg)';
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------- Timer-Demo (Live-Modus) */
  const timerEl = $('#demoTimer'), ring = $('.lt-fg');
  if (timerEl && ring) {
    const total = 600, C = 2 * Math.PI * 86;
    let left = 598;
    ring.style.strokeDasharray = C;
    const draw = () => {
      timerEl.textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60);
      ring.style.strokeDashoffset = C * (1 - left / total);
    };
    draw();
    if (!reduced) setInterval(() => { left = left > 1 ? left - 1 : total; draw(); }, 1000);
  }

  /* ---------------- Installations-Anleitung */
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const detectedOs = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';

  function showOs(os) {
    $$('#osTabs button').forEach((b) => b.classList.toggle('active', b.dataset.os === os));
    $$('[data-steps]').forEach((el) => {
      const on = el.dataset.steps === os;
      el.hidden = !on;
      if (on) $$('.reveal', el).forEach((r) => r.classList.add('in'));
    });
  }
  $$('#osTabs button').forEach((b) => b.addEventListener('click', () => showOs(b.dataset.os)));
  showOs(detectedOs);

  const det = $('#detected');
  if (standalone) {
    det.textContent = 'Du nutzt ' + APP_NAME + ' bereits als installierte App.';
    det.hidden = false;
  } else {
    const names = { ios: isIOS && /iPad/.test(ua) ? 'ein iPad' : 'ein iPhone', android: 'ein Android-Gerät', desktop: 'einen Computer' };
    let text = 'Wir haben ' + names[detectedOs] + ' erkannt – hier ist die passende Anleitung.';
    if (isIOS && /CriOS|FxiOS|EdgiOS/.test(ua)) text += ' Tipp: Am zuverlässigsten klappt die Installation in Safari.';
    det.textContent = text;
    det.hidden = false;
  }

  /* Android/Chrome/Edge: Installation mit einem Klick, wenn der Browser es anbietet */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('#installNow').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try {
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') showToast(APP_NAME + ' wird installiert', 'success');
    } catch (err) { /* abgebrochen */ }
    deferred = null;
    $('#installNow').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installNow').hidden = true; });
})();
