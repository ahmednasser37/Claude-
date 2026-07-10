// modal.js — the one detail-card primitive, built first, wired everywhere.
// Contract: openModal(title, subtitle, bodyHtml, footerHtml).
// Backdrop click and Escape close it. Focus trap is mandatory: Tab/Shift+Tab
// cycle inside the card; focus returns to the triggering element on close.

let modalPrevFocus = null;

export function closeModal() {
  const back = document.querySelector('.modal-backdrop');
  if (!back) return;
  back.remove();
  document.removeEventListener('keydown', modalKeydown, true);
  if (modalPrevFocus && document.contains(modalPrevFocus)) modalPrevFocus.focus();
  modalPrevFocus = null;
}

function modalFocusables(card) {
  return [...card.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
}

function modalKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
  if (e.key !== 'Tab') return;
  const card = document.querySelector('.modal-card');
  if (!card) return;
  const f = modalFocusables(card);
  if (f.length === 0) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!card.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
}

export function openModal(title, subtitle, bodyHtml, footerHtml) {
  closeModal();
  modalPrevFocus = document.activeElement;
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${title.replace(/"/g, '&quot;')}">
      <div class="modal-head">
        <div><h3></h3><div class="sub"></div></div>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"></div>
      ${footerHtml ? '<div class="modal-foot"></div>' : ''}
    </div>`;
  back.querySelector('h3').textContent = title;
  back.querySelector('.sub').textContent = subtitle || '';
  back.querySelector('.modal-body').innerHTML = bodyHtml;
  if (footerHtml) back.querySelector('.modal-foot').innerHTML = footerHtml;
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
  back.querySelector('.modal-close').addEventListener('click', closeModal);
  document.body.appendChild(back);
  document.addEventListener('keydown', modalKeydown, true);
  const f = modalFocusables(back.querySelector('.modal-card'));
  (f[0] || back.querySelector('.modal-close')).focus();
  return back.querySelector('.modal-card');
}
