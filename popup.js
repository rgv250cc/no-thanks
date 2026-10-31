const $ = id => document.getElementById(id);
let tab, once, scope = 'site';
const FIELDS = ['autoplay', 'mute', 'ads', 'tricks'];

async function render() {
  $('toggle').textContent = tab.mutedInfo?.muted ? 'Unmute tab' : 'Mute tab';
  const s = await getSettings();
  document.body.classList.toggle('off', !s.enabled);
  $('tagline').textContent = s.enabled ? 'Ads, autoplay and noise: no thanks.' : 'Paused everywhere.';
  if ($('site').hidden) return;
  const sc = scopeOf(tab.url, scope);
  $('key').textContent = sc.key;
  $('key').title = sc.key;
  $('avatar').textContent = sc.key[0].toUpperCase();
  const words = { autoplay: ['Allowed', 'Blocked'], mute: ['Allowed', 'Muted'], ads: ['Allowed', 'Blocked'], tricks: ['Allowed', 'Blocked'] };
  for (const field of FIELDS) {
    const on = allowedAt(s, sc.url, field);
    $('q' + field).checked = on;
    $('s' + field).textContent = words[field][on ? 0 : 1];
    $('row' + field).classList.toggle('allowed', on);
  }
  const own = s.rules[sc.key];
  $('status').textContent = own ? `Custom rule for this ${scope}` : (scope === 'page' ? 'Following the site setting' : 'Following your defaults');
  $('reset').hidden = !own;
  once = (await chrome.storage.session.get('once:' + tab.id))['once:' + tab.id];
  $('once').textContent = once ? 'Stop allowing' : 'Allow once';
}

(async () => {
  // currentWindow can come back empty (e.g. popup opened while devtools/another window had focus)
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  await bindSettings();
  if (!tab) { $('site').hidden = true; document.querySelector('.row').hidden = true; document.body.classList.toggle('off', !(await getSettings()).enabled); return; }
  if (!/^https?:/.test(tab.url || '')) { $('site').hidden = true; $('once').hidden = $('hide').hidden = true; }

  for (const b of document.querySelectorAll('[data-scope]')) {
    b.onclick = () => {
      scope = b.dataset.scope;
      document.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('on', x === b));
      render();
    };
  }
  // ads and page tricks are decided when a page loads, and ads already on screen stay until then
  const askReload = () => { $('reloadRow').hidden = false; };
  for (const field of FIELDS) {
    $('q' + field).onchange = e => {
      setAllowed(scope, tab.url, field, e.target.checked, tab.id);
      if (field === 'ads' || field === 'tricks') askReload();
    };
  }
  $('reload').onclick = () => { chrome.tabs.reload(tab.id); window.close(); };
  $('once').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'allow-once', tabId: tab.id, host: scopeOf(tab.url, 'site').key, on: !once });
    window.close();
  };
  $('hide').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'hide-pick', tabId: tab.id });
    window.close();
  };
  $('reset').onclick = async e => {
    e.preventDefault();
    const { rules } = await getSettings();
    delete rules[scopeOf(tab.url, scope).key];
    await chrome.storage.session.remove('manual:' + tab.id);
    saveRules(rules);
    askReload();
  };
  $('toggle').onclick = () => chrome.runtime.sendMessage({ type: 'manual', tabId: tab.id, muted: !tab.mutedInfo?.muted });
  $('others').onclick = () => chrome.runtime.sendMessage({ type: 'mute-others', tabId: tab.id });

  // background applies mute changes async; refresh when anything moves
  chrome.storage.onChanged.addListener(render);
  chrome.tabs.onUpdated.addListener(async (id, change) => {
    if (id === tab.id && change.mutedInfo) { tab = await chrome.tabs.get(id); render(); }
  });
  render();
})();
