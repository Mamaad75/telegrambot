/* پنجره پیش‌نمایش و چاپ */
(function () {
  'use strict';
  let current = { size: 'a4', title: 'سند' };

  window.api.on('print:data', (data) => {
    current = { size: data.size || 'a4', title: data.title || 'سند' };
    document.getElementById('docTitle').textContent = data.title || 'پیش‌نمایش';
    document.title = data.title || 'پیش‌نمایش چاپ';
    document.getElementById('paper').innerHTML = data.html || '';
    if (data.autoPrint) setTimeout(() => window.api.printAction('print', current), 300);
  });

  document.getElementById('btnPrint').addEventListener('click', () => window.api.printAction('print', current));
  document.getElementById('btnPdf').addEventListener('click', () => window.api.printAction('pdf', { ...current, name: current.title }));
  document.getElementById('btnClose').addEventListener('click', () => window.api.printAction('close', current));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.api.printAction('close', current);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      window.api.printAction('print', current);
    }
  });
}());
