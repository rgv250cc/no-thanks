// Copy and paste do what you asked. The site's handlers still run, because editors and code boxes rely
// on them. Only afterwards, if the site blocked the action or added text to it, is the result corrected.
// Shift + right-click always opens the browser's own menu.
(() => {
  const editable = el => !!el?.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]');
  const setData = DataTransfer.prototype.setData;
  let written = null;
  DataTransfer.prototype.setData = function (type, value) {
    if (/^text(\/plain)?$/i.test(type)) written = String(value);
    return setData.apply(this, arguments);
  };

  addEventListener('copy', e => {
    if (!e.isTrusted || editable(e.target) || editable(document.activeElement)) return;
    const selected = getSelection()?.toString();
    if (!selected?.trim()) return;
    written = null;
    setTimeout(() => {
      if (!e.defaultPrevented) return;
      const site = written;
      const blocked = site === null;
      const tampered = site !== null && site.includes(selected.trim()) && site.length > selected.trim().length + 10;
      if (blocked || tampered) navigator.clipboard?.writeText(selected).catch(() => {});
    });
  }, true);

  addEventListener('paste', e => {
    const field = e.target;
    if (!e.isTrusted || !/^(input|textarea)$/.test(field.localName) || field.readOnly || field.disabled) return;
    if (e.clipboardData.files.length) return;
    const text = e.clipboardData.getData('text/plain');
    const before = field.value;
    setTimeout(() => {
      // a site that handled the paste itself has changed the field, or moved on to another
      if (!e.defaultPrevented || !text || field.value !== before || document.activeElement !== field) return;
      document.execCommand('insertText', false, text);
    });
  }, true);

  addEventListener('contextmenu', e => { if (e.isTrusted && e.shiftKey) e.stopImmediatePropagation(); }, true);
})();
