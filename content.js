// Isolated world: asks the background for this page's autoplay rule and hands it to content-main.js.
function sync() {
  chrome.runtime.sendMessage({ type: 'autoplay?', url: location.href }, cfg => {
    if (chrome.runtime.lastError || !cfg) cfg = { allow: true, allowMuted: true }; // fail open, never leave media stuck
    document.dispatchEvent(new CustomEvent('no-thanks', { detail: JSON.stringify(cfg) }));
  });
}
sync();
chrome.runtime.onMessage.addListener(msg => { if (msg.type === 'refresh') sync(); });
