// "Hide an element": point at something, click it, and it stays hidden on this site.
(() => {
  if (self.noThanksPicker) return;
  self.noThanksPicker = true;

  const host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    #mark { position: fixed; background: rgba(229, 72, 77, .25); outline: 2px solid #e5484d; pointer-events: none; display: none; }
    #tip { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); padding: 9px 14px; border-radius: 10px; background: #17171c; color: #fff; font: 13px system-ui, sans-serif; display: flex; gap: 12px; align-items: center; box-shadow: 0 8px 24px rgba(0, 0, 0, .35); }
    button { all: unset; color: #ff8a8e; font-weight: 600; cursor: pointer; }
  </style><div id="mark"></div><div id="tip"><span>Click what you want to hide. Press Esc to cancel.</span></div>`;
  const mark = root.getElementById('mark'), tip = root.getElementById('tip');
  document.documentElement.append(host);

  let target = null;
  const under = e => {
    host.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    host.style.pointerEvents = '';
    return el && el !== document.documentElement && el !== document.body ? el : null;
  };
  const stable = name => /^[a-zA-Z_-][\w-]*$/.test(name) && !/\d{3}|^(css|sc|jsx|_)-?[a-z0-9]{4,}$/i.test(name);
  const unique = sel => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const selectorFor = el => {
    const parts = [];
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      if (a.id && stable(a.id)) { parts.unshift(`#${CSS.escape(a.id)}`); if (unique(parts.join(' > '))) break; continue; }
      const classes = [...a.classList].filter(stable).slice(0, 3).map(c => `.${CSS.escape(c)}`).join('');
      let part = a.localName + classes;
      const same = a.parentElement ? [...a.parentElement.children].filter(c => c.localName === a.localName) : [];
      if (same.length > 1 && !classes) part += `:nth-of-type(${same.indexOf(a) + 1})`;
      parts.unshift(part);
      if (unique(parts.join(' > '))) break;
    }
    return parts.join(' > ');
  };
  const finish = () => {
    removeEventListener('keydown', onKey, true);
    host.remove();
    self.noThanksPicker = false;
  };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); } };
  addEventListener('keydown', onKey, true);

  host.addEventListener('pointermove', e => {
    target = under(e);
    if (!target) { mark.style.display = 'none'; return; }
    const r = target.getBoundingClientRect();
    mark.style.cssText = `display: block; left: ${r.left}px; top: ${r.top}px; width: ${r.width}px; height: ${r.height}px;`;
  });
  host.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const el = under(e) ?? target;
    if (!el) return;
    const selector = selectorFor(el), site = location.hostname, css = `${selector} { display: none !important; }`;
    chrome.runtime.sendMessage({ what: 'insertCSS', css });
    chrome.runtime.sendMessage({ type: 'hide-element', host: site, selector });
    // the choice is saved already, and the message stays a few seconds in case it hid the wrong thing
    host.style.cssText = 'all: initial; position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;';
    mark.style.display = 'none';
    tip.innerHTML = '<span>Hidden on this site.</span><button>Undo</button>';
    tip.querySelector('button').onclick = () => {
      chrome.runtime.sendMessage({ what: 'removeCSS', css });
      chrome.runtime.sendMessage({ type: 'hide-element', host: site, selector, undo: true });
      finish();
    };
    setTimeout(finish, 6000);
  });
})();
