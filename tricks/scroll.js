// Banners and pop-ups lock the page's scrolling, and hiding them leaves it locked. Scrolling comes back
// if the page is taller than the window, it is locked, and nothing large is still covering it.
(() => {
  if (self !== top) return;
  const style = document.createElement('style');
  style.textContent = 'html, body { overflow: auto !important; } body { position: static !important; }';
  style.disabled = true;
  let timer;

  const locked = el => {
    const s = getComputedStyle(el);
    return s.overflowY === 'hidden' || s.overflowY === 'clip' || s.position === 'fixed';
  };
  const covered = () => document.elementsFromPoint(innerWidth / 2, innerHeight / 2).some(el => {
    if (el === document.body || el === document.documentElement) return false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).position !== 'fixed') continue;
      const r = a.getBoundingClientRect();
      if (r.width * r.height > innerWidth * innerHeight * 0.2) return true;
    }
    return false;
  });

  const check = () => {
    timer = null;
    const body = document.body;
    if (!body) return;
    if (!style.isConnected) document.documentElement.append(style);
    style.disabled = true; // judge the page as the site left it
    const tall = Math.max(document.documentElement.scrollHeight, body.scrollHeight) > innerHeight + 200;
    style.disabled = !(tall && (locked(document.documentElement) || locked(body)) && !covered());
  };
  const later = () => { timer ??= setTimeout(check, 300); };

  const watch = () => {
    new MutationObserver(later).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'], childList: true });
    later();
  };
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
  addEventListener('load', later);
})();
