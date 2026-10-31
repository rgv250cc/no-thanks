// node test/e2e.mjs [extension-dir]
// Real clicks against local test players in headless Edge, using silent audio in a muted browser.
// Set BROWSER to use another Chromium browser.
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const EXT = path.resolve(process.argv[2] || new URL('..', import.meta.url).pathname);
const BROWSER = process.env.BROWSER || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const PORT = +process.env.PORT || 8765, CDP = PORT + 600;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 60 s of silence
const silence = (() => {
  const n = 8000 * 60, h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(8000, 28);
  h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
  return Buffer.concat([h, Buffer.alloc(n, 128)]);
})();

const LAYOUT = `<!doctype html><body style="margin:0">
<div id=player style="width:320px"><video id=v src=/silent.wav loop style="display:block;width:320px;height:180px"></video>
<button id=bar style="display:block;width:320px;height:30px"></button></div>
<div id=far style="margin-top:300px;width:200px;height:50px">x</div><button id=farbtn style="width:200px;height:50px"></button>
<input id=box style="width:200px"><script>const v=window.v=document.getElementById('v');const retry=()=>setInterval(()=>v.play().catch(()=>{}),300);`;
const FRAME = `addEventListener('message',e=>{if(e.data==='playing')window.childPlaying=true});window.state=()=>!!window.childPlaying;`;
const HOST = `document.body.innerHTML='<div id=host style="width:320px;height:180px"></div>';const r=document.getElementById('host').attachShadow({mode:'open'});r.innerHTML='<video src=/silent.wav loop autoplay style="width:320px;height:180px"></video>';window.v=r.firstChild;`;

// expect: true = must be playing at the end, false = must be paused
const CASES = [
  { name: 'autoplay attribute is stopped', js: `v.autoplay=true;v.load();`, expect: false },
  { name: 'script play() is stopped', js: `v.play().catch(()=>{});`, expect: false },
  { name: 'autoplay in shadow DOM is stopped', js: HOST, expect: false },
  { name: 'click elsewhere on the page does not start a retrying video', js: `retry();`, acts: [{ click: '#far' }], expect: false },
  { name: 'right-click on a video does not start it', js: `retry();`, acts: [{ click: '#v', button: 'right' }], expect: false },
  { name: 'click from a script does not count', js: `retry();const r=v.getBoundingClientRect();v.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+5,clientY:r.y+5}));document.getElementById('bar').click();`, expect: false },
  { name: 'typing in a field does not start it', js: `retry();document.getElementById('box').focus();`, acts: [{ key: 'a' }, { key: 'b' }], expect: false },
  { name: 'thumbnail link that swaps the URL does not start it', js: `const a=document.createElement('a');a.href='/watch?x=1';a.textContent='open';a.style.cssText='display:block;width:200px;height:50px';a.id='thumb';document.body.append(a);a.onclick=e=>{e.preventDefault();history.pushState({},'','/watch?x=1');v.play().catch(()=>{})};`, acts: [{ click: '#thumb' }], expect: false },
  { name: 'video link that swaps the URL does not start it', js: `const a=document.createElement('a');a.href='/watch?x=2';v.before(a);a.append(v);a.onclick=e=>{e.preventDefault();history.pushState({},'','/watch?x=2');setTimeout(()=>v.play().catch(()=>{}),200)};`, acts: [{ click: '#v' }], expect: false },

  { name: 'click on video, site calls play()', js: `v.onclick=()=>v.play();`, acts: [{ click: '#v' }], expect: true },
  { name: 'control bar outside the video, slow start past browser activation', js: `bar.onclick=()=>setTimeout(()=>v.play(),6000);`, acts: [{ click: '#bar' }], wait: 6500, expect: true },
  { name: 'click also opens a popup, which uses up browser activation', wait: 2500, js: `bar.onclick=()=>{window.open('about:blank');setTimeout(()=>v.play(),300)};`, acts: [{ click: '#bar' }], expect: true },
  { name: 'hidden video, button elsewhere, popup on click', js: `v.style.display='none';farbtn.onclick=()=>{window.open('about:blank');v.play()};`, acts: [{ click: '#farbtn' }], expect: true },
  { name: 'button labelled Play outside the player, slow start', js: `farbtn.setAttribute('aria-label','Play trailer');farbtn.onclick=()=>setTimeout(()=>v.play(),1500);`, acts: [{ click: '#farbtn' }], wait: 2000, expect: true },
  { name: 'site ignores the rejection and does nothing on click', js: `v.play().catch(()=>{});`, acts: [{ click: '#v' }], expect: true },
  { name: 'site believes it is playing and calls pause() on click', js: `v.play().catch(()=>{});v.onclick=()=>v.pause();`, acts: [{ click: '#v' }], expect: true },
  { name: 'site updates the query on click, then plays', js: `bar.onclick=()=>{history.replaceState({},'','?t=1');setTimeout(()=>v.play(),200)};`, acts: [{ click: '#bar' }], expect: true },
  { name: 'site updates the hash on click, then plays', js: `bar.onclick=()=>{location.hash='t=1';setTimeout(()=>v.play(),200)};`, acts: [{ click: '#bar' }], expect: true },
  { name: 'click on a video in shadow DOM', js: HOST, acts: [{ click: '#host' }], expect: true },
  { name: 'keyboard shortcut', js: `addEventListener('keydown',e=>{if(e.key==='k')v.play()});`, acts: [{ key: 'k' }], expect: true },
  { name: 'Enter on a focused play button', js: `bar.focus();bar.onclick=()=>v.play();`, acts: [{ key: 'Enter' }], expect: true },
  { name: 'video call stream starts with no click', js: `const c=document.createElement('canvas');c.getContext('2d').fillRect(0,0,9,9);v.removeAttribute('src');v.srcObject=c.captureStream();v.muted=true;v.play().catch(()=>{});`, expect: true },
  { name: 'ad ends, then the main video starts in another element', js: `const ad=document.createElement('video');ad.src='/silent.wav';ad.style.cssText='display:block;width:320px;height:180px';v.style.display='none';v.before(ad);ad.onclick=()=>{ad.play();setTimeout(()=>{ad.pause();ad.remove();v.style.display='block';v.play().catch(()=>{})},21000)};ad.id='ad';`, acts: [{ click: '#ad' }], wait: 21500, expect: true },
  { name: 'own Play button controls a cross-origin iframe player', js: `${FRAME}document.body.insertAdjacentHTML('beforeend','<iframe id=f allow=autoplay src="http://localhost:${PORT}/child" style="width:320px;height:180px"></iframe>');farbtn.setAttribute('aria-label','Play');farbtn.onclick=()=>document.getElementById('f').contentWindow.postMessage('go','*');`, acts: [{ sleep: 800 }, { click: '#farbtn' }], expect: true },
  { name: 'click loads a cross-origin player that starts itself', js: `${FRAME}const p=document.getElementById('player');bar.onclick=()=>{p.innerHTML='<iframe allow=autoplay src="http://localhost:${PORT}/child?auto" style="width:320px;height:210px"></iframe>'};`, acts: [{ click: '#bar' }], wait: 1500, expect: true },
  { name: 'cross-origin iframe player does not start itself', js: `${FRAME}document.body.insertAdjacentHTML('beforeend','<iframe allow=autoplay src="http://localhost:${PORT}/child?auto" style="width:320px;height:180px"></iframe>');`, wait: 1500, expect: false },
  { name: 'allowing the site starts the stopped video', js: `v.play().catch(()=>{});`, acts: [{ rules: { '127.0.0.1': { autoplay: 'allow' } } }], wait: 800, expect: true, rulesAfter: {} },
  { name: 'page rule applies after a single-page URL change', js: `setTimeout(()=>{history.pushState({},'','/allowed');setTimeout(()=>v.play().catch(()=>{}),800)},300);`, before: { '127.0.0.1/allowed': { autoplay: 'allow' } }, wait: 1500, expect: true, rulesAfter: {} },
];

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/silent.wav') { res.setHeader('Content-Type', 'audio/wav'); return res.end(silence); }
  res.setHeader('Content-Type', 'text/html');
  if (u.pathname === '/child') {
    return res.end(`<!doctype html><video id=v src=/silent.wav loop style="width:300px;height:150px"></video><script>const v=document.getElementById('v');v.onplaying=()=>parent.postMessage('playing','*');addEventListener('message',e=>{if(e.data==='go')v.play().catch(()=>{})});${u.search === '?auto' ? 'setTimeout(()=>v.play().catch(()=>{}),300);' : ''}</script>`);
  }
  const c = CASES[+u.searchParams.get('c')];
  res.end(`${LAYOUT}${c ? c.js : ''}</script>`);
}).listen(PORT); // 127.0.0.1 and localhost are different origins, which gives us cross-origin iframes

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'no-thanks-e2e-'));
const browser = spawn(BROWSER, ['--headless=new', '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1280,900', `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, 'about:blank'], { stdio: 'ignore' });
const finish = code => { browser.kill('SIGKILL'); server.close(); setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(code); }, 300); };

const connect = async url => {
  const ws = new WebSocket(url); await new Promise(r => ws.onopen = r);
  let id = 0; const p = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); p[d.id]?.(d); };
  return (method, params) => new Promise(r => { p[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
};
const targets = async () => (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
for (let i = 0; i < 60; i++) { try { await targets(); break; } catch { await sleep(250); } }
let sw;
for (let i = 0; i < 40 && !sw; i++) { sw = (await targets()).find(t => t.url.endsWith('background.js')); if (!sw) await sleep(250); }
if (!sw) { console.log('extension did not load'); finish(1); }
const bg = await connect(sw.webSocketDebuggerUrl);
const setRules = rules => bg('Runtime.evaluate', { expression: `chrome.storage.sync.set({rules:${JSON.stringify(rules)}})`, awaitPromise: true });
await sleep(500);

let failed = 0;
for (const [i, c] of CASES.entries()) {
  const t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const send = await connect(t.webSocketDebuggerUrl);
  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result?.value;
  if (c.before) { await setRules(c.before); await sleep(200); }
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/case?c=${i}` });
  await sleep(700);
  for (const a of c.acts || []) {
    if (a.sleep) await sleep(a.sleep);
    if (a.rules) await setRules(a.rules);
    if (a.click) {
      const b = JSON.parse(await ev(`JSON.stringify(document.querySelector('${a.click}').getBoundingClientRect())`));
      const x = b.x + b.width / 2, y = b.y + b.height / 2, button = a.button || 'left';
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1 });
    }
    if (a.key) {
      const text = a.key === 'Enter' ? '\r' : a.key, code = { Enter: 13, k: 75, a: 65, b: 66 }[a.key];
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: a.key, windowsVirtualKeyCode: code, ...(type === 'keyDown' ? { text } : {}) });
    }
  }
  await sleep(c.wait || 800);
  const playing = await ev(`window.state ? window.state() : !window.v.paused`);
  const ok = playing === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}${ok ? '' : ` (playing=${playing})`}`);
  if (c.rulesAfter) { await setRules(c.rulesAfter); await sleep(200); }
  await fetch(`http://127.0.0.1:${CDP}/json/close/${t.id}`);
}
console.log(failed ? `${failed} of ${CASES.length} failed` : `all ${CASES.length} passed`);
finish(failed ? 1 : 0);
