'use strict';
(function () {
  const imp = $('#importBtn');
  if (imp) imp.addEventListener('click', () => withBusy(imp, async () => {
    try {
      const r = await api('/api/exercises/import/' + encodeURIComponent(imp.dataset.token), { method: 'POST' });
      showToast(r.message, 'success');
      setTimeout(() => { location.href = '/exercises?id=' + r.id; }, 700);
    } catch (err) { showToast(err.message, 'error'); }
  }));
  const copy = $('#copyBtn');
  if (copy) copy.addEventListener('click', async () => showToast(await copyText(location.href) ? 'Link kopiert' : 'Kopieren nicht möglich', 'success'));
})();
