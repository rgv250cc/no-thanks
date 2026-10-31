// "Leave site?" dialogs only appear if you changed something on the page, because that is when they
// protect your work. This listener runs before any the page adds, and stops them on pages you only read.
(() => {
  let changed = false;
  const mark = e => { if (e.isTrusted) changed = true; };
  addEventListener('input', mark, true);
  addEventListener('change', mark, true);
  // drawing and design tools change their canvas with no input events
  addEventListener('pointermove', e => { if (e.buttons) mark(e); }, { capture: true, passive: true });
  addEventListener('beforeunload', e => { if (!changed) e.stopImmediatePropagation(); }, true);
})();
