const $ = id => document.getElementById(id);
const AUTOPLAY = { '': 'Default', allow: 'Allow', block: 'Block' };
const MUTE = { '': 'Default', never: 'Allow', mute: 'Mute' };
const BLOCKABLE = AUTOPLAY;
const COLUMNS = [['autoplay', AUTOPLAY, 'newAutoplay'], ['mute', MUTE, 'newMute'], ['ads', BLOCKABLE, 'newAds'], ['tricks', BLOCKABLE, 'newTricks']];

function fill(select, opts, value = '') {
  for (const [v, t] of Object.entries(opts)) select.add(new Option(t, v));
  select.value = value;
  return select;
}

// "https://www.Example.com/Videos/?x=1" -> "example.com/Videos" (paths are case-sensitive, hosts aren't)
function normalize(s) {
  const [host, ...path] = s.trim().replace(/^[a-z]+:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').split('/');
  return [host.toLowerCase().replace(/^www\./, ''), ...path].join('/');
}

async function renderRules() {
  const { rules, enabled } = await getSettings();
  const keys = Object.keys(rules).sort();
  document.body.classList.toggle('off', !enabled);
  $('empty').hidden = keys.length > 0;
  $('tableWrap').hidden = !keys.length;
  $('rules').replaceChildren(...keys.map(key => {
    const tr = document.createElement('tr');
    const del = document.createElement('button');
    del.textContent = 'Remove';
    del.className = 'ghost';
    del.onclick = async () => {
      const { rules } = await getSettings();
      delete rules[key];
      saveRules(rules);
    };
    const selects = COLUMNS.map(([field, opts]) => {
      const sel = fill(document.createElement('select'), opts, rules[key][field]);
      sel.onchange = () => setRule(key, field, sel.value);
      return sel;
    });
    for (const content of [key, ...selects, del]) tr.insertCell().append(content);
    return tr;
  }));
}

async function renderHidden() {
  const { hidden = {} } = await chrome.storage.local.get('hidden');
  const rows = Object.entries(hidden).flatMap(([host, list]) => list.map(selector => ({ host, selector })));
  $('hiddenEmpty').hidden = rows.length > 0;
  $('hiddenWrap').hidden = !rows.length;
  $('hidden').replaceChildren(...rows.map(({ host, selector }) => {
    const tr = document.createElement('tr');
    const del = document.createElement('button');
    del.textContent = 'Show again';
    del.className = 'ghost';
    del.onclick = () => chrome.runtime.sendMessage({ type: 'hide-element', host, selector, undo: true });
    for (const content of [`${host}  ${selector}`, del]) tr.insertCell().append(content);
    return tr;
  }));
}

fill($('newAutoplay'), AUTOPLAY, 'allow');
fill($('newMute'), MUTE);
fill($('newAds'), BLOCKABLE);
fill($('newTricks'), BLOCKABLE);

$('add').onsubmit = async e => {
  e.preventDefault();
  const key = normalize($('newKey').value);
  if (!key) return;
  const { rules } = await getSettings();
  const r = { ...rules[key] };
  for (const [field, , id] of COLUMNS) if ($(id).value) r[field] = $(id).value;
  if (!Object.keys(r).length) return;
  rules[key] = r;
  await saveRules(rules);
  $('newKey').value = '';
};

$('export').onclick = async () => {
  const { hidden = {} } = await chrome.storage.local.get('hidden');
  const blob = new Blob([JSON.stringify({ ...await getSettings(), hidden }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'no-thanks-settings.json' });
  a.click();
  URL.revokeObjectURL(a.href);
};

$('import').onclick = () => $('file').click();
$('file').onchange = async () => {
  try {
    const data = JSON.parse(await $('file').files[0].text());
    // only take known keys with the right types
    const clean = {};
    for (const [k, def] of Object.entries(DEFAULTS)) {
      if (k in data && typeof data[k] === typeof def) clean[k] = data[k];
    }
    if (clean.rules) {
      const valid = VALUES;
      clean.rules = Object.fromEntries(Object.entries(clean.rules).map(([key, r]) =>
        [normalize(key), Object.fromEntries(Object.entries(r || {}).filter(([f, v]) => valid[f]?.includes(v)))]
      ).filter(([key, r]) => key && Object.keys(r).length));
    }
    const { rules, ...settings } = clean;
    await chrome.storage.sync.set(settings);
    if (rules) await saveRules(rules);
    if (data.hidden && typeof data.hidden === 'object') {
      const hidden = Object.fromEntries(Object.entries(data.hidden)
        .filter(([host, list]) => /^[a-z0-9.-]+$/.test(host) && Array.isArray(list))
        .map(([host, list]) => [host, list.filter(v => typeof v === 'string' && !/[{}]/.test(v))]));
      await chrome.storage.local.set({ hidden });
    }
    await bindSettings();
  } catch (err) {
    alert('Could not import: ' + err.message);
  }
  $('file').value = '';
};

// Edge maps chrome:// to edge:// on its own
$('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

bindSettings();
renderRules();
renderHidden();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') renderRules();
  if (changes.hidden) renderHidden();
});
