'use strict';
document.getElementById('retryBtn').addEventListener('click', () => {
  if (location.pathname === '/offline') location.href = '/dashboard'; else location.reload();
});
window.addEventListener('online', () => { location.reload(); });
