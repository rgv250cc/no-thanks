importScripts('rules.js', 'js/consent-lib.js', 'blocking.js');

// A manual mute/unmute (tab speaker icon, popup, shortcut) is remembered per tab
// as the host it happened on, and wins over auto-mute until the tab leaves that host.
const manualKey = id => 'manual:' + id;

async function setManual(tab, muted) {
  await chrome.storage.session.set({ [manualKey(tab.id)]: hostOf(tab.url) });
  if (muted !== undefined) await chrome.tabs.update(tab.id, { muted });
}

async function apply(tab, s) {
  if (!/^(https?|file):/.test(tab.url || '') || tab.id < 0) return; // leave browser-internal pages alone
  s ??= await getSettings();
  const k = manualKey(tab.id);
  if ((await chrome.storage.session.get(k))[k] === hostOf(tab.url)) return;
  const info = tab.mutedInfo || {};
  let want = muteWanted(s, tab.url, tab.active);
  if (want === null) {
    // undo our own mutes when a rule/mode no longer asks for them
    if (info.muted && info.reason === 'extension' && info.extensionId === chrome.runtime.id) want = false;
    else return;
  }
  if (info.muted !== want) await chrome.tabs.update(tab.id, { muted: want }).catch(() => {});
}

async function applyAll() {
  const s = await getSettings();
  await Promise.all((await chrome.tabs.query({})).map(tab => apply(tab, s)));
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'autoplay?') {
    // judge iframes by the page they're embedded in, not their own URL
    const url = sender.frameId === 0 ? msg.url : sender.tab?.url || sender.url;
    getSettings().then(s => reply({ allow: autoplayAllowed(s, url), allowMuted: s.allowMutedAutoplay }));
    return true;
  }
  if (msg.type === 'manual') {
    chrome.tabs.get(msg.tabId).then(tab => setManual(tab, msg.muted)).then(() => reply(true));
    return true;
  }
  if (msg.type === 'mute-others') {
    chrome.tabs.get(msg.tabId).then(muteOthers).then(() => reply(true));
    return true;
  }
});

chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.mutedInfo?.reason === 'user') setManual(tab);
  else if (change.url) {
    apply(tab);
    if (tab.active) refreshMenu();
    // single-page sites change URL with no reload, and a page rule may apply to the new one
    chrome.tabs.sendMessage(id, { type: 'refresh' }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  refreshMenu();
  const s = await getSettings();
  if (s.muteMode !== 'background') return;
  await Promise.all((await chrome.tabs.query({ windowId })).map(tab => apply(tab, s)));
});

chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove(manualKey(id)));
chrome.storage.onChanged.addListener(async (_, area) => {
  if (area !== 'sync') return;
  refreshMenu();
  // open pages re-ask for their autoplay rule, so changes apply without a reload
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] })) {
    chrome.tabs.sendMessage(tab.id, { type: 'refresh' }).catch(() => {});
  }
  applyAll();
});
chrome.runtime.onStartup.addListener(applyAll);
chrome.windows.onFocusChanged.addListener(refreshMenu);

// --- right-click quick menu (page + toolbar icon); checkmarks show what's in effect now ---
const MENU = ['autoplay', 'mute', 'ads', 'tricks'].flatMap(field => [[field, 'site'], [field, 'page']]);
const MENU_WORDS = { autoplay: 'autoplay', mute: 'sound', ads: 'ads', tricks: 'page tricks' };
const MENU_CONTEXTS = ['page', 'frame', 'video', 'audio', 'link', 'image', 'selection', 'action'];

chrome.runtime.onInstalled.addListener(async () => {
  // v1 stored allowMutedAutoplay:on / muteMode:off; force the v2 defaults once, keep the rules
  if (!(await chrome.storage.sync.get('settingsVersion')).settingsVersion) {
    await chrome.storage.sync.set({ blockAutoplay: true, allowMutedAutoplay: false, muteMode: 'all', settingsVersion: 2 });
  }
  chrome.contextMenus.removeAll(() => {
    for (const [field, scope] of MENU) {
      chrome.contextMenus.create({
        id: field + ':' + scope, type: 'checkbox', title: field,
        contexts: MENU_CONTEXTS,
      });
    }
    chrome.contextMenus.create({ id: 'hide', title: 'Hide an element on this page', contexts: MENU_CONTEXTS });
    refreshMenu();
  });
  applyAll();
});

async function refreshMenu() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const s = await getSettings();
  const web = /^https?:/.test(tab?.url || '');
  for (const [field, scope] of MENU) {
    const props = { enabled: web && s.enabled };
    if (web) {
      const sc = scopeOf(tab.url, scope);
      props.checked = allowedAt(s, sc.url, field);
      props.title = `Allow ${MENU_WORDS[field]} on ${scope === 'site' ? sc.key : 'this page'}`;
    }
    chrome.contextMenus.update(field + ':' + scope, props, () => chrome.runtime.lastError);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!/^https?:/.test(tab?.url || '')) return;
  if (info.menuItemId === 'hide') {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['picker.js'] }).catch(() => {});
    return;
  }
  const [field, scope] = info.menuItemId.split(':');
  // a checkmark that changes nothing on screen looks broken, and these only apply on the next load
  setAllowed(scope, tab.url, field, info.checked, tab.id).then(() => {
    if (field === 'ads' || field === 'tricks') syncBlocking().then(() => chrome.tabs.reload(tab.id));
  });
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (cmd === 'toggle-mute') await setManual(tab, !tab.mutedInfo?.muted);
  if (cmd === 'mute-others') await muteOthers(tab);
});

async function muteOthers(current) {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id !== current.id && !tab.mutedInfo?.muted) await setManual(tab, true);
  }
}
