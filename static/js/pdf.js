'use strict';
document.getElementById('printBtn').addEventListener('click', () => window.print());
document.getElementById('backBtn').addEventListener('click', (e) => {
  if (history.length > 1 && document.referrer && new URL(document.referrer).origin === location.origin) { e.preventDefault(); history.back(); }
});
