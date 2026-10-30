'use strict';
/* Druckansicht. Am iPhone/iPad (v. a. als installierte App) oeffnet window.print() keinen Druckdialog –
   dort wird die echte PDF-Datei vorab geladen und ueber das Teilen-Menue (Drucken, In Dateien sichern) angeboten. */
(function () {
  const btn = document.getElementById('printBtn');
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let file = null;

  if (isIOS) {
    document.getElementById('printLabel').textContent = 'Drucken / Teilen';
    // Vorab laden: navigator.share muss direkt im Tipp aufgerufen werden, ein await davor verliert die Nutzergeste
    fetch(btn.dataset.file, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => { file = new File([blob], btn.dataset.name.replace(/[\/:*?"<>|]/g, '-'), { type: 'application/pdf' }); })
      .catch(() => { file = null; });
  }

  btn.addEventListener('click', () => {
    if (!isIOS) { window.print(); return; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: file.name }).catch(() => {});
      return;
    }
    // Rueckfall: PDF direkt oeffnen (Safari zeigt dort Teilen -> Drucken)
    location.href = btn.dataset.file;
  });

  document.getElementById('backBtn').addEventListener('click', (e) => {
    if (history.length > 1 && document.referrer && new URL(document.referrer).origin === location.origin) { e.preventDefault(); history.back(); }
  });
})();
