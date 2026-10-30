// Shared by background, popup, options and the node test.
// A rule key is "host" (matches host + subdomains) or "host/path-prefix".
// Rule value: { autoplay?: 'allow'|'block', mute?: 'mute'|'never' }.
const DEFAULTS = {
  enabled: true,
  blockAutoplay: true,
  allowMutedAutoplay: false, // true lets silent hero/background videos autoplay
  muteMode: 'all',           // 'off' | 'all' | 'background'
  rules: {},
};

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

// --- quick toggles (popup + right-click menu) ---
// field 'autoplay' -> is autoplay allowed; field 'mute' -> is sound allowed (judged as the active tab).
function allowedAt(s, url, field) {
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
  return field === 'autoplay' ? (allow ? 'allow' : 'block') : (allow ? 'never' : 'mute');
}

// ponytail: rules live in storage.sync (8KB/item ≈ 150 rules); move to storage.local if that ever bites.
async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

// --- UI helpers (popup + options) ---

async function setRule(key, field, value) {
  const { rules } = await getSettings();
  const r = { ...rules[key] };
  if (value) r[field] = value; else delete r[field];
  if (Object.keys(r).length) rules[key] = r; else delete rules[key];
  await chrome.storage.sync.set({ rules });
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
  for (const id of ['enabled', 'blockAutoplay', 'allowMutedAutoplay', 'muteMode']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const prop = el.type === 'checkbox' ? 'checked' : 'value';
    el[prop] = s[id];
    el.onchange = () => chrome.storage.sync.set({ [id]: el[prop] });
  }
  return s;
}

if (typeof module !== 'undefined') module.exports = { DEFAULTS, hostOf, ruleFor, autoplayAllowed, muteWanted, allowedAt, scopeOf, valueFor };
