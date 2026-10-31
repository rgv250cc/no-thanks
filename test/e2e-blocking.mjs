// node test/e2e-blocking.mjs [extension folder]
// Ads, exceptions and page tricks in a muted headless browser. Every host is mapped to a local server,
// so no page or ad network is contacted, and the system clipboard is never touched.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const EXT = path.resolve(process.argv[2] || new URL('..', import.meta.url).pathname);
const BROWSER = process.env.BROWSER || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = f => JSON.parse(fs.readFileSync(path.join(EXT, f)));

// real entries from the lists, so the test follows them as they update
const AD = 'ad.doubleclick.net';
const specific = read('rulesets/scripting/specific/easylist.json');
const plainHost = specific.hostnames.findIndex(h => /^[a-z0-9-]+\.[a-z]{2,}$/.test(h) && !h.endsWith('.test'));
const SPECIFIC_HOST = specific.hostnames[plainHost];
const SPECIFIC_SEL = JSON.parse(`[${specific.selectorLists[specific.selectorListRefs[plainHost]]}]`).filter(i => i >= 0).map(i => specific.selectors[i]).find(s => /^[.#][a-zA-Z][\w-]+$/.test(s));
const STRICT_HOST = read('rulesets/strictblock/easylist.json')[0].condition.requestDomains.find(d => /^[a-z]+[a-z0-9-]*\.com$/.test(d));

const hits = [];
const server = http.createServer((req, res) => {
  const host = req.headers.host.split(':')[0];
  hits.push({ host, url: req.url, gpc: req.headers['sec-gpc'] });
  const send = (type, body) => { res.setHeader('content-type', type); res.end(body); };
  if (req.url.endsWith('.js')) return send('text/javascript', '1');
  if (req.url.startsWith('/selector') || req.url.startsWith('/elsewhere')) return send('text/html', `<!doctype html><title>t</title><div class="${SPECIFIC_SEL.slice(1)}" id="${SPECIFIC_SEL.slice(1)}" style="height:50px">x</div>`);
  if (req.url.startsWith('/leave')) return send('text/html', `<!doctype html><title>t</title><input id=box><div style="height:200px">text</div><script>addEventListener('beforeunload',e=>{e.preventDefault();e.returnValue='x'})</script>`);
  if (req.url.startsWith('/locked')) return send('text/html', `<!doctype html><title>t</title><style>html{overflow:hidden}</style><div style="height:5000px">tall</div>`);
  if (req.url.startsWith('/modal')) return send('text/html', `<!doctype html><title>t</title><style>html{overflow:hidden}</style><div style="height:5000px">tall</div><div style="position:fixed;inset:10%;background:#ddd">dialog</div>`);
  if (req.url.startsWith('/cookie')) return send('text/html', `<!doctype html><title>t</title><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#eee;display:block"><button id="onetrust-accept-btn-handler" onclick="window.answer='accept';document.getElementById('onetrust-banner-sdk').style.display='none'">Accept all</button><button id="onetrust-reject-all-handler" onclick="window.answer='reject';document.getElementById('onetrust-banner-sdk').style.display='none'">Reject all</button></div><script>window.OneTrust={};</script>`);
  if (req.url.startsWith('/pick')) return send('text/html', `<!doctype html><title>t</title><div id="promo" style="width:300px;height:100px;background:#fcc">promo</div><p id="keep">keep</p>`);
  send('text/html', '<!doctype html><title>t</title>ok');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

const browser = await puppeteer.launch({
  executablePath: BROWSER, headless: true, pipe: true, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'nt-e2e-')),
  ignoreDefaultArgs: ['--disable-extensions'], defaultViewport: { width: 1200, height: 800 },
  args: ['--mute-audio', '--no-first-run', `--host-resolver-rules=MAP * 127.0.0.1:${server.address().port}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
if (!execSync(`ps -o command= -p ${browser.process().pid}`).toString().includes('--mute-audio')) { await browser.close(); throw new Error('browser is not muted'); }

const worker = await (await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().endsWith('background.js'))).worker();
const extId = new URL(worker.url()).host;
let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };

const configure = (rules = {}, settings = {}) => worker.evaluate(async (rules, settings) => {
  await chrome.storage.sync.clear();
  await chrome.storage.sync.set({ settingsVersion: 2, muteMode: 'off', ...settings });
  await saveRules(rules);
  await syncBlocking();
  await syncBlocking();
}, rules, settings);

const probe = host => `fetch('http://${host}/ad.js?' + Math.random(), { mode: 'no-cors', cache: 'no-store' }).then(() => 'loaded', () => 'blocked')`;
const open = async url => { const p = await browser.newPage(); await p.goto(url, { waitUntil: 'load' }); return p; };
// Lists often answer ad scripts with a harmless stand-in, so a request counts as blocked if it never reached the server.
const adFrom = async p => { hits.length = 0; await p.evaluate(probe(AD)); return hits.some(h => h.host === AD) ? 'loaded' : 'blocked'; };
const adAt = async url => { const p = await open(url); const r = await adFrom(p); await p.close(); return r; };
const hiddenAt = async url => { const p = await open(url); await sleep(300); const r = await p.evaluate(sel => getComputedStyle(document.querySelector(sel)).display === 'none', SPECIFIC_SEL); await p.close(); return r; };
const pageSel = `http://${SPECIFIC_HOST}/selector`;

try {
  await sleep(3000); // first-run setup

  // --- default: ads blocked everywhere ---
  await configure();
  check('rulesets on by default', (await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).includes('easylist'), true);
  check('ad request blocked by default', await adAt('http://site.test/'), 'blocked');
  check(`list hides ${SPECIFIC_SEL} on ${SPECIFIC_HOST}`, await hiddenAt(pageSel), true);
  check('same element stays on other sites', await hiddenAt('http://other.test/selector'), false);

  // --- exceptions, same rule shape as autoplay and sound ---
  await configure({ 'site.test': { ads: 'allow' } });
  check('site allow: site', await adAt('http://site.test/'), 'loaded');
  check('site allow: subdomain', await adAt('http://www.site.test/a'), 'loaded');
  check('site allow: lookalike', await adAt('http://notsite.test/'), 'blocked');
  check('site allow: other site', await adAt('http://other.test/'), 'blocked');

  await configure({ 'site.test/videos': { ads: 'allow' } });
  check('page allow: inside', await adAt('http://site.test/videos/1'), 'loaded');
  check('page allow: outside', await adAt('http://site.test/news'), 'blocked');

  await configure({ 'site.test': { ads: 'allow' }, 'site.test/shorts': { ads: 'block' }, 'site.test/shorts/ok': { ads: 'allow' } });
  check('nesting: allowed site', await adAt('http://site.test/watch'), 'loaded');
  check('nesting: blocked page inside it', await adAt('http://site.test/shorts/1'), 'blocked');
  check('nesting: allowed page inside that', await adAt('http://site.test/shorts/ok/1'), 'loaded');
  {
    const p = await open('http://site.test/watch');
    await p.evaluate(() => history.pushState({}, '', '/shorts/9'));
    check('single-page move into a blocked page', await adFrom(p), 'blocked');
    await p.close();
  }

  // --- page scripts follow the same exceptions ---
  await configure({ [SPECIFIC_HOST]: { ads: 'allow' } });
  check('site allow: list stops hiding', await hiddenAt(pageSel), false);
  await configure({ [`${SPECIFIC_HOST}/selector`]: { ads: 'allow' } });
  check('page allow: list stops hiding there', await hiddenAt(pageSel), false);
  check('page allow: list still hides elsewhere on the site', await hiddenAt(`http://${SPECIFIC_HOST}/elsewhere`), true);
  await configure({ [SPECIFIC_HOST]: { ads: 'allow' }, [`${SPECIFIC_HOST}/selector`]: { ads: 'block' } });
  check('page block inside allowed site: list hides', await hiddenAt(pageSel), true);
  check('rest of allowed site: list stops', await hiddenAt(`http://${SPECIFIC_HOST}/elsewhere`), false);

  // --- default off ---
  await configure({}, { blockAds: false });
  check('ads off: ads load', await adAt('http://site.test/'), 'loaded');
  check('ads off: ad lists are off', (await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).includes('easylist'), false);
  check('ads off: malware list stays on', (await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).includes('ublock-badware'), true);
  await configure({ 'site.test': { ads: 'block' }, 'other.test/news': { ads: 'block' } }, { blockAds: false });
  check('ads off, blocked site: blocked', await adAt('http://site.test/'), 'blocked');
  check('ads off, blocked page: blocked', await adAt('http://other.test/news/1'), 'blocked');
  check('ads off, rest of that site: loads', await adAt('http://other.test/about'), 'loaded');
  check('ads off, any other site: loads', await adAt('http://third.test/'), 'loaded');

  // --- master switch ---
  await configure({}, { enabled: false });
  check('master off: ads load', await adAt('http://site.test/'), 'loaded');
  check('master off: no rulesets', (await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).length, 0);
  check('master off: no page scripts', (await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);

  // --- full-page block ---
  await configure();
  {
    const p = await browser.newPage();
    await p.goto(`http://${STRICT_HOST}/`).catch(() => {});
    await sleep(300);
    check('listed site shows the blocked page', p.url().startsWith(`chrome-extension://${extId}/blocked.html`), true);
    const nav = p.waitForNavigation({ timeout: 10000 });
    await p.click('#go');
    await nav;
    // the test server has no HTTPS, and this host insists on it, so getting past the blocked page is what counts
    check('"Continue anyway" leaves the blocked page', p.url().startsWith('chrome-extension://'), false);
    await p.close();
    await worker.evaluate(async () => { await chrome.storage.session.remove('strictSkip'); await syncBlocking(); });
  }

  // --- annoyance list switch ---
  await configure({}, { listOverlays: true });
  check('annoyance list turns on', (await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).includes('annoyances-overlays'), true);
  await configure();
  check('annoyance list off by default', (await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).includes('annoyances-overlays'), false);

  // --- allow once ---
  {
    const p = await open('http://site.test/');
    await p.bringToFront();
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'http://site.test/*' }))[0].id);
    await worker.evaluate((id) => setOnce(id, 'site.test', true), tabId);
    await p.reload();
    check('allow once: this tab allows', await adFrom(p), 'loaded');
    check('allow once: other sites still block', await adAt('http://other.test/'), 'blocked');
    await p.goto('http://other.test/');
    await sleep(800);
    check('allow once ends when the tab leaves the site', await adFrom(p), 'blocked');
    check('allow once record is gone', await worker.evaluate(id => chrome.storage.session.get('once:' + id).then(r => r['once:' + id] ?? null), tabId), null);
    await p.close();
  }

  // --- page tricks ---
  await configure();
  {
    const p = await open('http://localhost/');
    check('notification prompt without a click: quietly dismissed', await p.evaluate(() => Notification.requestPermission()), 'default');
    check('location without a click: denied', await p.evaluate(() => new Promise(r => navigator.geolocation.getCurrentPosition(() => r('ok'), e => r(e.code)))), 1);
    await p.mouse.click(50, 50);
    check('notification prompt after a click reaches the browser', await p.evaluate(() => Notification.requestPermission()), 'denied');
    await p.close();
  }
  {
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions('http://localhost', ['geolocation']);
    const p = await open('http://localhost/');
    await p.setGeolocation({ latitude: 1, longitude: 2 });
    check('location already granted still works', await p.evaluate(() => new Promise(r => navigator.geolocation.getCurrentPosition(() => r('ok'), e => r(e.code)))), 'ok');
    await p.close();
    await ctx.clearPermissionOverrides();
  }
  {
    const dialogs = async type => {
      const p = await open('http://site.test/leave');
      let shown = 0;
      p.on('dialog', d => { shown++; d.accept(); });
      await p.mouse.click(300, 100); // browsers only show these after a click
      if (type) { await p.focus('#box'); await p.keyboard.type('draft'); }
      await p.goto('http://site.test/next').catch(() => {});
      await sleep(200);
      await p.close();
      return shown;
    };
    check('"Leave site?" stopped on a page you only read', await dialogs(false), 0);
    check('"Leave site?" kept when you typed something', await dialogs(true), 1);
  }
  {
    const p = await open('http://site.test/locked');
    await sleep(800);
    check('locked scrolling comes back', await p.evaluate(() => getComputedStyle(document.documentElement).overflowY), 'auto');
    await p.close();
    const q = await open('http://site.test/modal');
    await sleep(800);
    check('a real dialog keeps its scroll lock', await q.evaluate(() => getComputedStyle(document.documentElement).overflowY), 'hidden');
    await q.close();
  }
  {
    hits.length = 0;
    const p = await open('http://localhost/');
    check('privacy signal: page property', await p.evaluate(() => navigator.globalPrivacyControl), true);
    check('privacy signal: header', hits.find(h => h.url === '/')?.gpc, '1');
    await p.close();
  }
  {
    const p = await open('http://site.test/cookie');
    await p.waitForFunction(() => window.answer, { timeout: 15000 }).catch(() => {});
    check('cookie banner answered with reject', await p.evaluate(() => window.answer ?? null), 'reject');
    await p.close();
  }
  {
    await configure({ 'localhost': { tricks: 'allow' }, 'site.test': { tricks: 'allow' } });
    const p = await open('http://localhost/');
    check('allowed site: prompts untouched', await p.evaluate(() => Notification.requestPermission.toString().includes('native code')), true);
    await p.close();
    const q = await open('http://site.test/cookie');
    await sleep(3000);
    check('allowed site: cookie banner left alone', await q.evaluate(() => window.answer ?? null), null);
    await q.close();
    const r = await open('http://site.test/locked');
    await sleep(800);
    check('allowed site: scroll lock left alone', await r.evaluate(() => getComputedStyle(document.documentElement).overflowY), 'hidden');
    await r.close();
    const t = await open('http://other.test/');
    check('other sites still protected', await t.evaluate(() => Notification.requestPermission.toString().includes('native code')), false);
    await t.close();
  }
  await configure({}, { quietPrompts: false, unlockScroll: false, privacySignal: false, rejectCookies: false });
  {
    hits.length = 0;
    const p = await open('http://localhost/');
    check('switches off: prompts untouched', await p.evaluate(() => Notification.requestPermission.toString().includes('native code')), true);
    check('switches off: no privacy signal', [await p.evaluate(() => navigator.globalPrivacyControl ?? false), hits.find(h => h.url === '/')?.gpc ?? null], [false, null]);
    await p.close();
  }

  // copy and paste, with synthetic events so the system clipboard stays out of it
  await configure();
  {
    const source = fs.readFileSync(path.join(EXT, 'tricks/clipboard.js'), 'utf8').replaceAll('!e.isTrusted', 'false').replaceAll('e.isTrusted', 'true');
    const p = await browser.newPage();
    await p.evaluateOnNewDocument(source);
    await p.goto('http://localhost/x', { waitUntil: 'load' });
    const copy = async handler => p.evaluate(async handler => {
      document.body.innerHTML = '<p id=t>hello world this is the text</p><input id=i><input id=otp>';
      window.wrote = null;
      navigator.clipboard.writeText = t => { window.wrote = t; return Promise.resolve(); };
      const h = new Function('e', handler);
      document.addEventListener('copy', h);
      getSelection().selectAllChildren(document.getElementById('t'));
      const e = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), cancelable: true, bubbles: true });
      document.getElementById('t').dispatchEvent(e);
      await new Promise(r => setTimeout(r, 50));
      document.removeEventListener('copy', h);
      return window.wrote;
    }, handler);
    check('copy blocked by the site: selection copied', await copy('e.preventDefault()'), 'hello world this is the text');
    check('copy with text added: selection copied', await copy(`e.clipboardData.setData('text/plain', getSelection().toString() + ' Read more at example.com'); e.preventDefault();`), 'hello world this is the text');
    check('site copy that rewrites the text: left alone', await copy(`e.clipboardData.setData('text/plain', 'formatted'); e.preventDefault();`), null);
    check('site that does not touch copy: left alone', await copy(''), null);
    const paste = async (handler, id = 'i') => p.evaluate(async (handler, id) => {
      const f = document.getElementById(id);
      f.value = '';
      f.focus();
      const h = new Function('e', handler);
      f.addEventListener('paste', h);
      const data = new DataTransfer();
      data.setData('text/plain', 'pasted');
      f.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
      f.removeEventListener('paste', h);
      return f.value;
    }, handler, id);
    check('paste blocked by the site: pasted anyway', await paste('e.preventDefault()'), 'pasted');
    check('site that handles paste itself: not pasted twice', await paste(`e.preventDefault(); e.target.value = 'site did it'`), 'site did it');
    await p.close();
  }

  // --- hide an element ---
  await configure();
  {
    const p = await open('http://site.test/pick');
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://site.test/pick' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['picker.js'] });
    });
    await sleep(200);
    await p.mouse.move(100, 50);
    await sleep(100);
    await p.mouse.click(100, 50);
    await sleep(800);
    check('picked element is hidden', await p.evaluate(() => getComputedStyle(document.getElementById('promo')).display), 'none');
    check('others are not', await p.evaluate(() => getComputedStyle(document.getElementById('keep')).display), 'block');
    check('stored for the site', await worker.evaluate(() => chrome.storage.local.get('hidden').then(r => r.hidden)), { 'site.test': ['#promo'] });
    await sleep(500);
    await p.reload();
    await sleep(300);
    check('still hidden after reload', await p.evaluate(() => getComputedStyle(document.getElementById('promo')).display), 'none');
    await p.close();
    await worker.evaluate(() => hideElement('site.test', '#promo', true));
    const q = await open('http://site.test/pick');
    await sleep(300);
    check('shown again after removing it', await q.evaluate(() => getComputedStyle(document.getElementById('promo')).display), 'block');
    await q.close();
  }

  // --- popup and settings ---
  await configure();
  {
    const p = await browser.newPage();
    await p.evaluateOnNewDocument(() => {
      const q = chrome.tabs.query;
      chrome.tabs.query = async o => (o.active ? [{ id: 999999, url: 'https://www.site.test/watch', mutedInfo: { muted: false } }] : q(o));
    });
    await p.setViewport({ width: 344, height: 700 });
    await p.goto(`chrome-extension://${extId}/popup.html`);
    await sleep(300);
    check('popup: ads blocked here', await p.$eval('#sads', e => e.textContent), 'Blocked');
    check('popup: tricks blocked here', await p.$eval('#stricks', e => e.textContent), 'Blocked');
    check('popup: reload hint starts hidden', await p.$eval('#reloadRow', e => e.hidden), true);
    await p.click('#rowads .switch');
    await sleep(300);
    check('popup: rule written the same way as autoplay', await worker.evaluate(() => getSettings().then(s => s.rules)), { 'site.test': { ads: 'allow' } });
    check('popup: switch shows allowed', await p.$eval('#sads', e => e.textContent), 'Allowed');
    check('popup: reload hint appears', await p.$eval('#reloadRow', e => e.hidden), false);
    await sleep(500);
    check('popup rule reaches the browser rules', await adAt('http://site.test/'), 'loaded');
    await p.screenshot({ path: path.join(os.tmpdir(), 'nt-popup.png'), fullPage: true });
    console.log('popup height', await p.evaluate(() => document.documentElement.scrollHeight));
    await p.close();
    const o = await browser.newPage();
    await o.setViewport({ width: 1000, height: 900 });
    await o.goto(`chrome-extension://${extId}/options.html`);
    await sleep(300);
    check('settings: exception table has the ads column', await o.$$eval('#rules tr:first-child select', e => e.map(s => s.value)), ['', '', 'allow', '']);
    await o.screenshot({ path: path.join(os.tmpdir(), 'nt-options.png'), fullPage: true });
    await o.close();
  }

  // --- storage: many exceptions ---
  {
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`site-${i}.example.com`, { ads: 'allow' }]));
    await configure(many);
    check('500 exceptions saved and read back', await worker.evaluate(() => getSettings().then(s => Object.keys(s.rules).length)), 500);
    check('500 exceptions reach the browser', await adAt('http://site-499.example.com/'), 'loaded');
    await worker.evaluate(() => saveRules({}));
    check('old chunks are removed', await worker.evaluate(() => chrome.storage.sync.get(null).then(a => Object.keys(a).filter(k => k.startsWith('rules_')).length)), 0);
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
