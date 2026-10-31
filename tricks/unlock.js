// Optional, off by default, because web apps use these for their own menus and dragging:
// the browser's right-click menu and text selection work everywhere.
(() => {
  const stop = e => { if (e.isTrusted) e.stopImmediatePropagation(); };
  addEventListener('contextmenu', stop, true);
  addEventListener('selectstart', stop, true);
  const style = document.createElement('style');
  style.textContent = 'body, body *:not(button, [role=button], input, textarea, select) { user-select: text !important; -webkit-user-select: text !important; }';
  const add = () => document.documentElement.append(style);
  if (document.documentElement) add(); else document.addEventListener('readystatechange', add, { once: true });
})();
