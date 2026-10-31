// Hides the elements you picked on this site.
chrome.storage.local.get('hidden').then(({ hidden = {} }) => {
  const list = hidden[location.hostname];
  if (!list?.length) return;
  chrome.runtime.sendMessage({ what: 'insertCSS', css: `${list.join(',\n')} { display: none !important; }` }).catch(() => {});
});
