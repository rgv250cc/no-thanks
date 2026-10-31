const url = decodeURIComponent(location.hash.slice(1));
document.getElementById('url').textContent = url;
document.getElementById('back').onclick = () => (history.length > 1 ? history.back() : window.close());
document.getElementById('go').onclick = async () => {
  // "continue" lasts until the browser closes, like the warning pages browsers show
  await chrome.runtime.sendMessage({ type: 'blocked-continue', host: new URL(url).hostname });
  location.replace(url);
};
