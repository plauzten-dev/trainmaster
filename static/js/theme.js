(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    if (localStorage.getItem('accent') === 'ocean') document.documentElement.setAttribute('data-accent', 'ocean');
  } catch (e) { /* Speicher nicht verfuegbar */ }
})();
