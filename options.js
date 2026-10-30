const $ = id => document.getElementById(id);
const AUTOPLAY = { '': 'Default', allow: 'Allow', block: 'Block' };
const MUTE = { '': 'Default', never: 'Allow', mute: 'Mute' };

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
      chrome.storage.sync.set({ rules });
    };
    const ap = fill(document.createElement('select'), AUTOPLAY, rules[key].autoplay);
    ap.onchange = () => setRule(key, 'autoplay', ap.value);
    const mu = fill(document.createElement('select'), MUTE, rules[key].mute);
    mu.onchange = () => setRule(key, 'mute', mu.value);
    for (const content of [key, ap, mu, del]) tr.insertCell().append(content);
    return tr;
  }));
}

fill($('newAutoplay'), AUTOPLAY, 'allow');
fill($('newMute'), MUTE);

$('add').onsubmit = async e => {
  e.preventDefault();
  const key = normalize($('newKey').value);
  if (!key) return;
  const { rules } = await getSettings();
  const r = { ...rules[key] };
  if ($('newAutoplay').value) r.autoplay = $('newAutoplay').value;
  if ($('newMute').value) r.mute = $('newMute').value;
  if (!Object.keys(r).length) return;
  rules[key] = r;
  await chrome.storage.sync.set({ rules });
  $('newKey').value = '';
};

$('export').onclick = async () => {
  const blob = new Blob([JSON.stringify(await getSettings(), null, 2)], { type: 'application/json' });
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
      const valid = { autoplay: ['allow', 'block'], mute: ['mute', 'never'] };
      clean.rules = Object.fromEntries(Object.entries(clean.rules).map(([key, r]) =>
        [normalize(key), Object.fromEntries(Object.entries(r || {}).filter(([f, v]) => valid[f]?.includes(v)))]
      ).filter(([key, r]) => key && Object.keys(r).length));
    }
    await chrome.storage.sync.set(clean);
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
chrome.storage.onChanged.addListener(renderRules);
