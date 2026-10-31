// Turns settings and exceptions into browser rules and registered page scripts. The filter lists and
// their page scripts come from uBlock Origin Lite (GPLv3), see scripts/update-lists.mjs. Once applied,
// everything here is declarative: it keeps working while the service worker sleeps.
const dnr = chrome.declarativeNetRequest;
const ALLOW_PRIORITY = 1000000; // above every list rule
const STRICT_PRIORITY = 29;     // the priority uBlock Lite gives its strict-block rules
const SIGNAL_PRIORITY = ALLOW_PRIORITY + 1; // header rules only apply above any allow rule
const ANNOYANCES = {
  listCookies: 'annoyances-cookies', listOverlays: 'annoyances-overlays', listSocial: 'annoyances-social', listWidgets: 'annoyances-widgets',
  listNotifications: 'annoyances-notifications', listAI: 'annoyances-ai', listOthers: 'annoyances-others',
};

const fetchJSON = async path => (await fetch(chrome.runtime.getURL(path))).json();
const wide = (patterns, rest) => ({ matches: patterns.matches, ...(patterns.excludeMatches.length ? { excludeMatches: patterns.excludeMatches } : {}), ...rest });
// Chrome only allows match_origin_as_fallback on patterns with no path; about:blank frames on page exceptions go without.
const fallback = level => ({ matchOriginAsFallback: level.matches.every(m => m === '<all_urls>' || m.endsWith('/*')) });
const hostPatterns = hosts => hosts.map(h => (h === '*' || h === 'all-urls' ? '<all_urls>' : `*://*.${h}/*`));

// --- which lists are on ---
function wantedLists(s, details) {
  if (!s.enabled) return [];
  const langs = [...navigator.languages, chrome.i18n.getUILanguage()].map(l => l.split('-')[0]);
  const adsOn = s.blockAds || rootAllowsAds(s);
  const annoyances = new Set(Object.keys(ANNOYANCES).filter(k => s[k]).map(k => ANNOYANCES[k]));
  return details.filter(d => {
    if (d.group === 'malware') return s.blockMalware;
    if (d.group === 'annoyances') return annoyances.has(d.id);
    if (d.group === 'default') return adsOn;
    return adsOn && typeof d.lang === 'string' && d.lang.split(/\s+/).some(l => langs.includes(l));
  });
}

// --- regex rules are validated first, because one bad regex fails a whole update ---
const validRegex = new Map();
async function keepValid(rules) {
  const ok = await Promise.all(rules.map(async r => {
    const regex = r.condition.regexFilter;
    if (!regex) return true;
    const key = `${regex}|${!!r.condition.isUrlFilterCaseSensitive}`;
    if (!validRegex.has(key)) {
      const res = await dnr.isRegexSupported({ regex, isCaseSensitive: !!r.condition.isUrlFilterCaseSensitive });
      validRegex.set(key, res.isSupported);
    }
    return validRegex.get(key);
  }));
  return rules.filter((_, i) => ok[i]);
}

async function listRules(lists, folder, count) {
  const sets = await Promise.all(lists.filter(count).map(d => fetchJSON(`/rulesets/${folder}/${d.id}.json`).catch(() => [])));
  return keepValid(sets.flat());
}

// Chromium before 145 rejects topDomains: skip rules that need it, and drop the exclusion from the others.
function forThisBrowser(rules) {
  if (dnr.RuleConditionKeys?.TOP_DOMAINS) return rules;
  return rules.filter(r => !r.condition.topDomains).map(r => {
    delete r.condition.excludedTopDomains;
    return r;
  });
}

// --- page scripts of the lists ---
async function listScripts(lists, levels) {
  const out = [];
  const [scriptletDetails, genericDetails] = await Promise.all([fetchJSON('/rulesets/scriptlet-details.json'), fetchJSON('/rulesets/generic-details.json')]);
  const scriptlets = new Map(scriptletDetails), generics = new Map(genericDetails);
  const unhide = [], hide = [];
  for (const d of lists) {
    unhide.push(...(generics.get(d.id)?.unhide ?? []));
    hide.push(...(generics.get(d.id)?.hide ?? []));
  }
  const specific = lists.filter(d => d.css?.specific);
  const generic = lists.filter(d => d.css?.generic);
  const popups = lists.filter(d => d.popups);
  levels.forEach((level, i) => {
    if (specific.length) {
      out.push(wide(level, {
        id: `css-specific-${i}`, allFrames: true, runAt: 'document_start',
        js: ['/js/scripting/css-api.js', '/js/scripting/isolated-api.js', ...specific.map(d => `/rulesets/scripting/specific/${d.id}.js`), '/js/scripting/css-specific.js'],
      }));
    }
    if (generic.length) {
      const js = ['/js/scripting/css-api.js', '/js/scripting/isolated-api.js', ...generic.map(d => `/rulesets/scripting/generic/${d.id}.js`), '/js/scripting/css-generic.js'];
      out.push({ id: `css-generic-${i}`, matches: level.matches, excludeMatches: [...level.excludeMatches, ...hostPatterns(unhide)], allFrames: true, runAt: 'document_idle', js });
    }
    for (const world of ['ISOLATED', 'MAIN']) {
      const js = lists.filter(d => scriptlets.get(d.id)?.[world]).map(d => `/rulesets/scripting/scriptlet/${world.toLowerCase()}/${d.id}.js`);
      if (!js.length) continue;
      const w = world.toLowerCase();
      out.push(wide(level, {
        id: `scriptlets-${w}-${i}`, world, allFrames: true, ...fallback(level), runAt: 'document_start',
        js: [`/rulesets/scripting/scriptlet/${w}/scriptlet-begin.js`, ...js, `/rulesets/scripting/scriptlet/${w}/scriptlet-end.js`],
      }));
    }
    if (popups.length) {
      out.push(wide(level, { id: `prevent-popup-${i}`, runAt: 'document_start', js: [...popups.map(d => `/rulesets/scripting/popup/${d.id}.js`), '/js/scripting/prevent-popup-target.js', '/js/scripting/prevent-popup.js'] }));
    }
  });
  return out;
}

// --- page tricks: each is its own small file in the page's world, so a page gets exactly what is on ---
function trickScripts(s, levels) {
  const files = [s.quietPrompts && 'tricks/prompts.js', s.noLeaveDialogs && 'tricks/leave.js', s.fixClipboard && 'tricks/clipboard.js', s.unlockScroll && 'tricks/scroll.js', s.unlockMenu && 'tricks/unlock.js'].filter(Boolean);
  const out = [];
  levels.forEach((level, i) => {
    if (files.length) out.push(wide(level, { id: `tricks-${i}`, js: files, world: 'MAIN', allFrames: true, runAt: 'document_start' }));
    if (s.rejectCookies) out.push(wide(level, { id: `consent-${i}`, js: ['js/consent-content.js'], allFrames: true, ...fallback(level), runAt: 'document_start' }));
  });
  if (s.privacySignal) out.push({ id: 'privacy-signal', js: ['tricks/signal.js'], matches: ['<all_urls>'], world: 'MAIN', allFrames: true, runAt: 'document_start' });
  return out;
}

// --- allow once: a tab keeps a site allowed until it closes or leaves that site ---
const onceKey = tabId => `once:${tabId}`;
async function onceTabs() {
  const all = await chrome.storage.session.get(null);
  return Object.keys(all).filter(k => k.startsWith('once:')).map(k => ({ tabId: +k.slice(5), host: all[k] }));
}

async function setOnce(tabId, host, on) {
  if (on) await chrome.storage.session.set({ [onceKey(tabId)]: host });
  else await chrome.storage.session.remove(onceKey(tabId));
  await syncBlocking();
}

// --- apply everything; a queue, because settings can change again while an update runs ---
let queue = Promise.resolve();
function syncBlocking() {
  queue = queue.then(applyBlocking).catch(e => console.error('No Thanks: could not apply blocking rules:', e));
  return queue;
}

async function applyBlocking() {
  const s = await getSettings();
  const details = await fetchJSON('/rulesets/ruleset-details.json');
  const lists = wantedLists(s, details);
  const wanted = new Set(lists.map(d => d.id));

  const enabled = await dnr.getEnabledRulesets();
  await dnr.updateEnabledRulesets({
    disableRulesetIds: enabled.filter(id => !wanted.has(id)),
    enableRulesetIds: [...wanted].filter(id => !enabled.includes(id)),
  });

  // browser rules that last across restarts: exceptions, the lists' regex rules, the privacy signal
  const allowRules = s.enabled && lists.length
    ? await keepValid(adAllowConditions(s).map(c => ({ priority: ALLOW_PRIORITY, action: { type: 'allowAllRequests' }, condition: { ...c, isUrlFilterCaseSensitive: true, resourceTypes: ['main_frame'] } })))
    : [];
  const signal = s.enabled && s.privacySignal
    ? [{ priority: SIGNAL_PRIORITY, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] }, condition: { urlFilter: '|http', resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'image', 'stylesheet', 'media', 'font', 'ping', 'websocket', 'other'] } }]
    : [];
  const regex = forThisBrowser(await listRules(lists, 'regex', d => d.rules?.regex));
  const dynamic = [...allowRules, ...signal, ...regex].map((r, i) => ({ ...r, id: i + 1 }));
  const countRegex = rules => rules.filter(r => r.condition.regexFilter).length;
  const oldDynamic = await dnr.getDynamicRules();
  // dynamic and session rules share one regex limit, so make room before growing
  if (countRegex(dynamic) > countRegex(oldDynamic)) {
    await dnr.updateSessionRules({ removeRuleIds: (await dnr.getSessionRules()).map(r => r.id) });
  }
  await dnr.updateDynamicRules({ removeRuleIds: oldDynamic.map(r => r.id), addRules: dynamic });

  // browser rules for this session only: full-page blocks, and tabs on "allow once"
  const once = s.enabled ? await onceTabs() : [];
  const { strictSkip = [] } = await chrome.storage.session.get('strictSkip');
  const target = `${chrome.runtime.getURL('/blocked.html')}#\\0`;
  // There is not room for them all: one rule with a domain list covers far more than one regex pattern,
  // so those go first, then the patterns for dangerous sites.
  const byRisk = [...lists].sort((a, b) => (b.group === 'malware') - (a.group === 'malware'));
  const strict = (await listRules(byRisk, 'strictblock', d => d.rules?.strictblock)).map(r => {
    r.action.redirect.regexSubstitution = target;
    r.priority = STRICT_PRIORITY;
    return r;
  }).sort((a, b) => !!b.condition.requestDomains - !!a.condition.requestDomains);
  const regexLeft = dnr.MAX_NUMBER_OF_REGEX_RULES - countRegex(dynamic) - 50;
  const session = [
    ...(strictSkip.length ? [{ priority: STRICT_PRIORITY + 1, action: { type: 'allow' }, condition: { requestDomains: strictSkip, resourceTypes: ['main_frame'] } }] : []),
    ...strict.slice(0, regexLeft),
    ...once.map(o => ({ priority: ALLOW_PRIORITY, action: { type: 'allowAllRequests' }, condition: { tabIds: [o.tabId], resourceTypes: ['main_frame', 'sub_frame'] } })),
  ].map((r, i) => ({ ...r, id: i + 1 }));
  const oldSession = await dnr.getSessionRules();
  await dnr.updateSessionRules({ removeRuleIds: oldSession.map(r => r.id), addRules: session });

  await storeCosmetics(s, lists);

  // page scripts. "Allow once" can only be judged by address here, so it covers that site in every tab.
  const rules = structuredClone(s.rules);
  for (const o of once) rules[o.host] = { ...rules[o.host], ads: 'allow', tricks: 'allow' };
  const scripts = [];
  if (s.enabled) {
    if (lists.length) scripts.push(...await listScripts(lists, regions(rules, 'ads', !rootAllowsAds(s))));
    scripts.push(...trickScripts(s, regions(rules, 'tricks', true)));
    const { hidden = {} } = await chrome.storage.local.get('hidden');
    const hosts = Object.keys(hidden).filter(h => hidden[h].length);
    if (hosts.length) scripts.push({ id: 'hide', js: ['hide.js'], matches: hostPatterns(hosts), runAt: 'document_start' });
  }
  await chrome.scripting.unregisterContentScripts();
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}

// The lists' per-site cosmetic filters are read from local storage by css-specific.js.
async function storeCosmetics(s, lists) {
  const sig = `${chrome.runtime.getManifest().version}|${(await fetchJSON('/js/versions.json')).ubol}|${lists.map(d => d.id).join()}`;
  const stored = await chrome.storage.local.get(null);
  // css-specific.js uses this to stop filtering frames inside a page where ads are allowed
  const inner = Object.keys(s.rules).filter(k => s.rules[k].ads === 'block');
  const none = Object.keys(s.rules).filter(k => s.rules[k].ads === 'allow' && !k.includes('/') && !inner.some(i => inDomain(i.split('/')[0], k)));
  await chrome.storage.local.set({ filteringModeDetails: { none, basic: [], optimal: [], complete: [] } });
  const session = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(session).filter(k => k.startsWith('cache.css.')));
  if (stored.listsSig === sig) return;
  await chrome.storage.local.remove(Object.keys(stored).filter(k => k.startsWith('css.specific.')));
  for (const d of lists.filter(d => d.css?.specific)) {
    await chrome.storage.local.set({ [`css.specific.${d.id}`]: await fetchJSON(`/rulesets/scripting/specific/${d.id}.json`) });
  }
  await chrome.storage.local.set({ listsSig: sig });
}

// --- cookie banners: autoconsent answers them with "reject" ---
const CONSENT_CONFIG = {
  enabled: true, autoAction: 'optOut', disabledCmps: [], enablePrehide: true, enableCosmeticRules: true, enableGeneratedRules: true, detectRetries: 20,
  isMainWorld: false, prehideTimeout: 2000, enableHeuristicDetection: true, enablePopupMutationObserver: true, visualTest: false, performanceLoggingEnabled: false,
  heuristicPopupSearchTimeout: 2000, enableHeuristicHitTest: false, heuristicMode: 'tier1',
  logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false },
};
let consentRules;
function onConsentMessage(msg, sender) {
  const tabId = sender.tab?.id, frameId = sender.frameId;
  if (tabId === undefined) return;
  const send = m => chrome.tabs.sendMessage(tabId, m, { frameId }).catch(() => {});
  if (msg.type === 'init') {
    (consentRules ??= fetchJSON('/js/consent-rules.json')).then(all => send({
      type: 'initResp', config: CONSENT_CONFIG,
      rules: { autoconsent: [], compact: consentLib.filterCompactRules(all, { url: sender.url || `${sender.origin}/`, mainFrame: frameId === 0 }) },
    }));
  } else if (msg.type === 'eval') {
    const func = consentLib.evalSnippets[msg.snippetId];
    if (!func) { send({ id: msg.id, type: 'evalResp', result: false }); return; }
    chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func })
      .then(([r]) => send({ id: msg.id, type: 'evalResp', result: r.result }), () => send({ id: msg.id, type: 'evalResp', result: false }));
  }
}

// --- messages from page scripts and the popup ---
async function hideElement(host, selector, undo) {
  const { hidden = {} } = await chrome.storage.local.get('hidden');
  const list = new Set(hidden[host] ?? []);
  if (undo) list.delete(selector); else list.add(selector);
  if (list.size) hidden[host] = [...list]; else delete hidden[host];
  await chrome.storage.local.set({ hidden });
  await syncBlocking();
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.what === 'insertCSS' || msg.what === 'removeCSS') {
    const target = { tabId: sender.tab?.id, frameIds: [sender.frameId] };
    chrome.scripting[msg.what]({ css: msg.css, origin: 'USER', target }).catch(() => {});
    return;
  }
  if (msg.what === 'injectCSSProceduralAPI') {
    chrome.scripting.executeScript({ files: ['/js/scripting/css-procedural-api.js'], target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, injectImmediately: true })
      .catch(() => {}).then(() => reply(true));
    return true;
  }
  if (msg.type === 'init' || msg.type === 'eval') { onConsentMessage(msg, sender); return; }
  if (msg.type === 'allow-once') {
    setOnce(msg.tabId, msg.host, msg.on).then(() => chrome.tabs.reload(msg.tabId)).then(() => reply(true));
    return true;
  }
  if (msg.type === 'hide-pick') {
    chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ['picker.js'] }).then(() => reply(true), () => reply(false));
    return true;
  }
  if (msg.type === 'hide-element') {
    hideElement(msg.host, msg.selector, msg.undo).then(() => reply(true));
    return true;
  }
  if (msg.type === 'blocked-continue') {
    chrome.storage.session.get('strictSkip').then(async ({ strictSkip = [] }) => {
      await chrome.storage.session.set({ strictSkip: [...new Set([...strictSkip, msg.host])] });
      await syncBlocking();
      reply(true);
    });
    return true;
  }
});

// --- keeping the rules current ---
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' || changes.hidden) syncBlocking();
});
chrome.runtime.onStartup.addListener(syncBlocking);
chrome.runtime.onInstalled.addListener(() => {
  dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  syncBlocking();
});
chrome.tabs.onRemoved.addListener(async tabId => {
  if ((await chrome.storage.session.get(onceKey(tabId)))[onceKey(tabId)]) setOnce(tabId, '', false);
});
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url) return;
  const host = (await chrome.storage.session.get(onceKey(tabId)))[onceKey(tabId)];
  if (host && !inDomain(hostOf(change.url), host)) setOnce(tabId, '', false);
});
