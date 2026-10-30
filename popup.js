const $ = id => document.getElementById(id);
let tab, scope = 'site';

async function render() {
  $('toggle').textContent = tab.mutedInfo?.muted ? 'Unmute tab' : 'Mute tab';
  const s = await getSettings();
  document.body.classList.toggle('off', !s.enabled);
  $('tagline').textContent = s.enabled ? 'Media plays when you say so.' : 'Paused everywhere.';
  if ($('site').hidden) return;
  const sc = scopeOf(tab.url, scope);
  $('key').textContent = sc.key;
  $('key').title = sc.key;
  $('avatar').textContent = sc.key[0].toUpperCase();
  const words = { autoplay: ['Allowed', 'Blocked'], mute: ['Allowed', 'Muted'] };
  for (const field of ['autoplay', 'mute']) {
    const on = allowedAt(s, sc.url, field);
    $('q' + field).checked = on;
    $('s' + field).textContent = words[field][on ? 0 : 1];
    $('row' + field).classList.toggle('allowed', on);
  }
  const own = s.rules[sc.key];
  $('status').textContent = own ? `Custom rule for this ${scope}` : (scope === 'page' ? 'Following the site setting' : 'Following your defaults');
  $('reset').hidden = !own;
}

(async () => {
  // currentWindow can come back empty (e.g. popup opened while devtools/another window had focus)
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  await bindSettings();
  if (!tab) { $('site').hidden = true; document.querySelector('.row').hidden = true; document.body.classList.toggle('off', !(await getSettings()).enabled); return; }
  if (!/^https?:/.test(tab.url || '')) $('site').hidden = true;

  for (const b of document.querySelectorAll('[data-scope]')) {
    b.onclick = () => {
      scope = b.dataset.scope;
      document.querySelectorAll('[data-scope]').forEach(x => x.classList.toggle('on', x === b));
      render();
    };
  }
  for (const field of ['autoplay', 'mute']) {
    $('q' + field).onchange = e => setAllowed(scope, tab.url, field, e.target.checked, tab.id);
  }
  $('reset').onclick = async e => {
    e.preventDefault();
    const { rules } = await getSettings();
    delete rules[scopeOf(tab.url, scope).key];
    await chrome.storage.session.remove('manual:' + tab.id);
    chrome.storage.sync.set({ rules });
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
