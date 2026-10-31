// Shared by background, popup, options and the node test.
// A rule key is "host" (matches host + subdomains) or "host/path-prefix".
// Rule value: { autoplay?: 'allow'|'block', mute?: 'mute'|'never', ads?: 'allow'|'block', tricks?: 'allow'|'block' }.
const DEFAULTS = {
  enabled: true,
  blockAutoplay: true,
  allowMutedAutoplay: false, // true lets silent hero/background videos autoplay
  muteMode: 'all',           // 'off' | 'all' | 'background'
  blockAds: true,            // ads and trackers
  blockMalware: true,
  listCookies: false,        // annoyance lists: hide these things
  listOverlays: false,
  listSocial: false,
  listWidgets: false,
  listNotifications: false,
  listAI: false,
  listOthers: false,
  rejectCookies: true,       // page tricks: answer or stop these things
  quietPrompts: true,
  noLeaveDialogs: true,
  fixClipboard: true,
  unlockScroll: true,
  unlockMenu: false,
  privacySignal: true,
  rules: {},
};
const VALUES = { autoplay: ['allow', 'block'], mute: ['never', 'mute'], ads: ['allow', 'block'], tricks: ['allow', 'block'] };

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// Merge every matching rule, most specific (longest key) last, so a page rule
// can override just one field of its site rule.
function ruleFor(url, rules) {
  let u;
  try { u = new URL(url); } catch { return {}; }
  const keys = Object.keys(rules).filter(key => {
    const i = key.indexOf('/');
    const h = i < 0 ? key : key.slice(0, i), p = i < 0 ? '' : key.slice(i);
    return (u.hostname === h || u.hostname.endsWith('.' + h)) && u.pathname.startsWith(p || '/');
  });
  keys.sort((a, b) => a.length - b.length);
  return Object.assign({}, ...keys.map(k => rules[k]));
}

function autoplayAllowed(s, url) {
  if (!s.enabled) return true;
  const r = ruleFor(url, s.rules).autoplay;
  return r ? r === 'allow' : !s.blockAutoplay;
}

// true = mute, false = unmute, null = leave it alone
function muteWanted(s, url, active) {
  if (!s.enabled) return null;
  const r = ruleFor(url, s.rules).mute;
  if (r === 'mute') return true;
  if (r === 'never') return false;
  if (s.muteMode === 'all') return true;
  if (s.muteMode === 'background') return !active;
  return null;
}

function adsAllowed(s, url) {
  if (!s.enabled) return true;
  const r = ruleFor(url, s.rules).ads;
  return r ? r === 'allow' : !s.blockAds;
}

function tricksAllowed(s, url) {
  return !s.enabled || ruleFor(url, s.rules).tricks === 'allow';
}

// --- quick toggles (popup + right-click menu) ---
// field 'autoplay' -> is autoplay allowed; field 'mute' -> is sound allowed (judged as the active tab).
function allowedAt(s, url, field) {
  if (field === 'ads') return adsAllowed(s, url);
  if (field === 'tricks') return tricksAllowed(s, url);
  return field === 'autoplay' ? autoplayAllowed(s, url) : muteWanted(s, url, true) !== true;
}

// scope 'site' -> rule key "host", judged at the site root; 'page' -> "host/path", judged at this URL
function scopeOf(url, scope) {
  const u = new URL(url), host = u.hostname.replace(/^www\./, '');
  return scope === 'site' ? { key: host, url: u.origin + '/' } : { key: host + u.pathname.replace(/\/$/, ''), url };
}

// Rule value that makes `field` at `key` come out as `allow`.
// '' (drop the field) when the inherited site rule / default already gives that, so rules stay minimal.
function valueFor(s, key, field, url, allow) {
  const r = { ...s.rules[key] };
  delete r[field];
  const inherited = allowedAt({ ...s, rules: { ...s.rules, [key]: r } }, url, field);
  if (allow === inherited) return '';
  return VALUES[field][allow ? 0 : 1];
}

// --- from exceptions to browser rules ---
const parseKey = key => {
  const i = key.indexOf('/');
  return { key, host: i < 0 ? key : key.slice(0, i), path: i < 0 ? '' : key.slice(i) };
};
// DNR and match patterns reject anything else, and one bad key would fail the whole update
const validKey = key => /^[a-z0-9-]+(\.[a-z0-9-]+)*(\/|$)/.test(key);
const fieldKeys = (rules, field) => Object.keys(rules).filter(k => rules[k][field] && validKey(k)).map(parseKey);
const inDomain = (host, domain) => host === domain || host.endsWith('.' + domain);
// is key a strictly inside key b? An empty b.host is the whole web.
const inside = (a, b) => a.key !== b.key && (!b.host || (inDomain(a.host, b.host) && a.path.startsWith(b.path || '')));
const escRe = t => t.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

// RE2 has no lookahead, so "does not start with any of these" is spelled out character by character.
function notAny(prefixes) {
  const trie = {};
  for (const p of prefixes) {
    let n = trie;
    for (const c of p) n = n[c] ??= {};
    n.$end = true;
  }
  const walk = n => {
    const chars = Object.keys(n).filter(c => c !== '$end');
    const parts = ['$'];
    if (chars.length) parts.push(`[^${chars.map(escRe).join('')}]`);
    for (const c of chars) if (!n[c].$end) parts.push(escRe(c) + walk(n[c]));
    return `(?:${parts.join('|')})`;
  };
  return walk(trie);
}

// With ads off by default, a site set to "block" still needs the lists on, with the rest of the web allowed.
const rootAllowsAds = s => !s.blockAds && Object.values(s.rules).some(r => r.ads === 'block');

// Conditions of the allowAllRequests rules that make the browser agree with ruleFor. A rule with a higher
// priority cannot switch a matching allowAllRequests back off, so each one leaves out the blocked keys
// inside it. Rules are limited to main_frame, so frames follow their page, as autoplay does.
// ponytail: a path rule on a parent and a host rule on a subdomain ("site/x", "a.site") tie on length in
// ruleFor and are not reconciled here; nobody writes those on purpose.
function adAllowConditions(s) {
  const keys = fieldKeys(s.rules, 'ads');
  const blocks = keys.filter(k => s.rules[k.key].ads === 'block');
  const allows = keys.filter(k => s.rules[k.key].ads === 'allow');
  if (rootAllowsAds(s)) allows.unshift({ key: '', host: '', path: '' });
  // A blocked page on a subdomain takes that whole subdomain out of its parent, so the rest of it is allowed again.
  for (const b of blocks) {
    if (b.path && !keys.some(k => k.key === b.host) && allows.some(a => inside(b, a) && a.host !== b.host)) {
      allows.push(parseKey(b.host));
    }
  }
  return allows.map(a => {
    const within = blocks.filter(b => inside(b, a));
    const samePath = within.filter(b => b.host === a.host);
    const other = [...new Set(within.filter(b => b.host !== a.host).map(b => b.host))];
    const cond = other.length ? { excludedRequestDomains: other } : {};
    if (!a.host) return { urlFilter: '|http', ...cond };
    const base = a.path || '/';
    if (samePath.length || /[*^|]/.test(base)) {
      const tail = samePath.length ? notAny(samePath.map(b => b.path.slice(base.length))) : '';
      return { regexFilter: `^https?://(?:[^/]+\\.)?${escRe(a.host)}(?::[0-9]+)?${escRe(base)}${tail}`, ...cond };
    }
    return { urlFilter: `||${a.host}${base}`, ...cond };
  });
}

// Where page scripts should run for a field: match patterns grouped in levels, because a script
// registration has one include and one exclude list, and exceptions can nest. Each key's level is the
// number of times the answer flips on the way down from the default.
function regions(rules, field, rootBlocked) {
  const keys = fieldKeys(rules, field).sort((a, b) => a.key.length - b.key.length);
  const pattern = k => `*://*.${k.host}${k.path || '/'}*`;
  const levels = [];
  const level = i => levels[i] ??= { matches: [], excludeMatches: [] };
  if (rootBlocked) level(0).matches.push('<all_urls>');
  const known = new Map();
  for (const k of keys) {
    const blocked = rules[k.key][field] === 'block';
    const parent = keys.filter(p => known.has(p.key) && inside(k, p)).at(-1);
    const up = parent ? known.get(parent.key) : { blocked: rootBlocked, depth: 0 };
    const depth = blocked === up.blocked ? up.depth : up.depth + 1;
    known.set(k.key, { blocked, depth });
    if (blocked === up.blocked) continue;
    if (blocked) level(depth).matches.push(pattern(k));
    else level(depth - 1).excludeMatches.push(pattern(k));
  }
  return levels.filter(Boolean);
}

// storage.sync holds 8 KB per item, about 150 exceptions, so long lists spread over rules, rules_1, rules_2...
function chunkRules(rules) {
  const chunks = [{}];
  let size = 2;
  for (const [k, v] of Object.entries(rules)) {
    const n = JSON.stringify(k).length + JSON.stringify(v).length + 2;
    if (size + n > 7500) { chunks.push({}); size = 2; }
    chunks.at(-1)[k] = v;
    size += n;
  }
  return chunks;
}

async function getSettings() {
  const all = await chrome.storage.sync.get(null);
  const s = { ...DEFAULTS, ...all, rules: { ...all.rules } };
  for (const k of Object.keys(s)) {
    if (k.startsWith('rules_')) { Object.assign(s.rules, s[k]); delete s[k]; }
  }
  return s;
}

async function saveRules(rules) {
  const [first, ...rest] = chunkRules(rules);
  await chrome.storage.sync.set({ rules: first, ...Object.fromEntries(rest.map((c, i) => [`rules_${i + 1}`, c])) });
  const stale = Object.keys(await chrome.storage.sync.get(null)).filter(k => /^rules_\d+$/.test(k) && +k.slice(6) > rest.length);
  if (stale.length) await chrome.storage.sync.remove(stale);
}

// --- UI helpers (popup + options) ---

async function setRule(key, field, value) {
  const { rules } = await getSettings();
  const r = { ...rules[key] };
  if (value) r[field] = value; else delete r[field];
  if (Object.keys(r).length) rules[key] = r; else delete rules[key];
  await saveRules(rules);
}

async function setAllowed(scope, url, field, allow, tabId) {
  const s = await getSettings(), sc = scopeOf(url, scope);
  // an explicit choice here beats an earlier manual mute/unmute of this tab
  if (field === 'mute' && tabId !== undefined) await chrome.storage.session.remove('manual:' + tabId);
  await setRule(sc.key, field, valueFor(s, sc.key, field, sc.url, allow));
}

// Wires any element whose id is a top-level setting to storage.
async function bindSettings() {
  const s = await getSettings();
  for (const id of Object.keys(DEFAULTS).filter(k => k !== 'rules')) {
    const el = document.getElementById(id);
    if (!el) continue;
    const prop = el.type === 'checkbox' ? 'checked' : 'value';
    el[prop] = s[id];
    el.onchange = () => chrome.storage.sync.set({ [id]: el[prop] });
  }
  return s;
}

if (typeof module !== 'undefined') module.exports = { DEFAULTS, hostOf, ruleFor, autoplayAllowed, muteWanted, allowedAt, scopeOf, valueFor, adsAllowed, tricksAllowed, adAllowConditions, notAny, regions, rootAllowsAds, chunkRules };
