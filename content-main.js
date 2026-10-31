// Runs in the page's own JS world at document_start, before page scripts.
// Media may start only if the user asked for it on this page. A wrong "no" breaks a player,
// so every click that could mean "play" counts, except a click that opens another page.
(() => {
  const proto = HTMLMediaElement.prototype;
  const play = proto.play, pause = proto.pause;
  const WINDOW = 20000;  // a player may fetch a manifest or an ad between the click and play()
  const SAME_BOX = 1.5;  // an ancestor this much bigger than the media is still its player
  const PLAY_LABEL = /(^|[^a-zA-Z])[Pp]lay|[a-z]Play|PLAY|[Rr]eplay|[Ww]atch|[Ll]isten|▶|►/;
  const NOT_PLAY_KEY = /^(Tab|Escape|Shift|Control|Alt|Meta|CapsLock|Arrow|Page|Home|End|F\d)/;
  const GESTURE = 'no-thanks:gesture', ASK = 'no-thanks:ask';

  let mode = 'pending'; // until content.js tells us this page's rule
  let ruleKnown;
  const ready = new Promise(r => ruleKnown = r);
  let allowMuted = true;
  let page = 0;                  // goes up when a single-page site moves to another page
  let approved = new WeakMap();  // media element or player box -> page the user started it on
  const blocked = new Set();     // media we stopped, which the site still wants to play
  let starts = 0;                // media allowed to start, to see if the site answered a click
  let gesture = null;            // last user gesture

  const parentOf = n => n.parentNode || n.host;
  const area = r => r.width * r.height;
  const hidden = r => r.width < 2 || r.height < 2;
  const inside = (r, g) => g.x >= r.left && g.x <= r.right && g.y >= r.top && g.y <= r.bottom;

  // Opening a thumbnail is a click too, but it means "open": the site then swaps the URL and starts
  // a reused <video>. A hash or query update on the same path is not another page.
  window.navigation?.addEventListener('navigate', e => {
    if (e.hashChange) return;
    if (e.navigationType === 'replace' && new URL(e.destination.url).pathname === location.pathname) return;
    page++;
  });

  const isLink = a => a.localName === 'a' && a.href && !/^(#|javascript:)/i.test(a.getAttribute('href'));
  const isPlayControl = path => path.slice(0, 4).some(a => a.getAttribute && PLAY_LABEL.test([
    a.id, a.getAttribute('class'), a.getAttribute('aria-label'), a.getAttribute('title'),
    a.closest('button,[role=button]') === a ? a.textContent : '',
  ].join(' ')));

  // Is the last gesture about this media element (or iframe)?
  const related = el => {
    const g = gesture;
    if (!g || g.page !== page || performance.now() - g.time > WINDOW) return false;
    if (!g.path) return true; // key press, or a click relayed from the parent frame
    const r = el.getBoundingClientRect();
    // Audio and hidden video have no place on the page to compare the click with.
    if (hidden(r) || el.localName === 'audio') return !g.link;
    if (inside(r, g) || (g.control && !g.link)) return true;
    // The closest box holding both the click and the media: its player, if barely bigger than the media.
    for (let a = el; a; a = parentOf(a)) {
      if (g.path.includes(a)) return !!a.getBoundingClientRect && area(a.getBoundingClientRect()) <= SAME_BOX * area(r);
    }
    return false;
  };

  // Approving the player box as well covers players that move on to another element, as after an ad.
  const approve = el => {
    approved.set(el, page);
    const r = el.getBoundingClientRect();
    if (hidden(r)) return;
    let box = null;
    for (let a = parentOf(el); a && a !== document.body && a !== document.documentElement; a = parentOf(a)) {
      if (!a.getBoundingClientRect) continue; // shadow root
      if (area(a.getBoundingClientRect()) > SAME_BOX * area(r)) break;
      box = a;
    }
    if (box) approved.set(box, page);
  };

  const wasApproved = el => {
    for (let a = el; a; a = parentOf(a)) if (approved.get(a) === page) return true;
    return false;
  };

  // Calls and camera previews are not autoplay. They start long after any click.
  const allowed = el => {
    const yes = mode === 'allow' || el.srcObject instanceof MediaStream || wasApproved(el) || related(el);
    if (yes) approve(el);
    if (yes || (allowMuted && (el.muted || el.volume === 0))) { starts++; return true; }
    return false;
  };

  const block = el => {
    if (blocked.size > 100) for (const b of blocked) if (!b.isConnected) blocked.delete(b);
    blocked.add(el);
  };

  const start = el => {
    if (allowed(el)) { blocked.delete(el); return play.call(el); }
    block(el);
    // same error the browser's own autoplay policy throws, so players cope with it
    return Promise.reject(new DOMException('Autoplay blocked by No Thanks', 'NotAllowedError'));
  };

  // Until the rule arrives the promise just stays pending. A rejection would make players
  // on allowed sites fall back to muted playback.
  proto.play = function () {
    if (!this.paused) return play.call(this);
    return mode === 'pending' ? ready.then(() => start(this)) : start(this);
  };

  // catches the `autoplay` attribute and native-controls clicks (no play() call involved)
  const onPlay = e => {
    const el = e.target;
    if (!/^(video|audio)$/.test(el.localName)) return;
    if (mode === 'pending') {
      pause.call(el);
      ready.then(() => start(el).catch(() => {}));
    } else if (allowed(el)) {
      blocked.delete(el);
    } else {
      block(el);
      pause.call(el);
    }
  };
  document.addEventListener('play', onPlay, true);
  // Media events don't leave a shadow root, so each root needs its own listener.
  // ponytail: declarative shadow DOM skips attachShadow, so autoplay there is not caught; add a scan if that shows up.
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (...args) {
    const root = attachShadow.apply(this, args);
    root.addEventListener('play', onPlay, true);
    return root;
  };

  // A click in the parent frame never reaches a cross-origin player, so tell the iframes it's about.
  const relay = () => {
    for (const f of document.querySelectorAll('iframe')) if (related(f)) f.contentWindow?.postMessage(GESTURE, '*');
  };
  const keyGesture = () => { gesture = { path: null, page, time: performance.now() }; relay(); };
  // ponytail: a hostile page could post this message itself; it would have to target us specifically.
  addEventListener('message', e => {
    if (e.data === GESTURE && e.source === parent && parent !== window) keyGesture();
    if (e.data === ASK) {
      // a player iframe created by the click itself asks when it starts up
      const f = [...document.querySelectorAll('iframe')].find(f => f.contentWindow === e.source);
      if (f && related(f)) e.source.postMessage(GESTURE, '*');
    }
  });
  if (parent !== window) parent.postMessage(ASK, '*');

  // Window capture runs before any page handler can stop it.
  const onPointer = e => {
    if (!e.isTrusted || e.button !== 0) return;
    const path = e.composedPath();
    gesture = { path, x: e.clientX, y: e.clientY, page, time: performance.now(), link: path.some(isLink), control: isPlayControl(path) };
    // a click on a video stays good however late the site calls play()
    for (const v of [...document.querySelectorAll('video'), ...blocked]) {
      const r = v.getBoundingClientRect();
      if (!hidden(r) && inside(r, gesture)) approve(v);
    }
    relay();
  };
  // A touch only counts when it lifts: most touches are scrolling.
  addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') onPointer(e); }, true);
  addEventListener('pointerup', e => { if (e.pointerType === 'touch') onPointer(e); }, true);

  addEventListener('keydown', e => {
    if (!e.isTrusted || e.ctrlKey || e.metaKey || e.altKey || NOT_PLAY_KEY.test(e.key)) return;
    const path = e.composedPath(), t = path[0];
    if (t.isContentEditable || /^(input|textarea|select)$/.test(t.localName)) return; // typing
    const onPage = t === document.body || t === document.documentElement;
    if ((e.key === 'Enter' || e.key === ' ') && !onPage) {
      gesture = { path, page, time: performance.now(), link: path.some(isLink), control: isPlayControl(path) };
      relay();
    } else if (e.key !== 'Enter') {
      keyGesture();
    }
  }, true);

  // Last resort, so a video can always be started: the user clicked one the site tried to play, and
  // the site did nothing, or called pause() because it still believes the video is playing.
  addEventListener('click', e => {
    if (!e.isTrusted) return;
    const wanted = [...blocked].filter(v => inside(v.getBoundingClientRect(), { x: e.clientX, y: e.clientY }));
    if (!wanted.length) return;
    const before = starts, at = page;
    setTimeout(() => {
      if (starts !== before || page !== at) return;
      for (const v of wanted) if (v.paused) start(v).catch(() => {});
    }, 400);
  }, true);

  // First event = initial rule; later ones = rule changed from the popup / quick menu, or the page changed.
  // ponytail: a hostile page could fire this event itself to get 'allow'; it would have to target us specifically.
  document.addEventListener('no-thanks', e => {
    const cfg = JSON.parse(e.detail);
    const was = mode;
    mode = cfg.allow ? 'allow' : 'block';
    allowMuted = cfg.allowMuted;
    if (was === 'pending') {
      ruleKnown();
    } else if (mode === 'allow' && was === 'block') {
      // just allowed: start what we stopped, if it's on screen
      for (const el of blocked) {
        const r = el.getBoundingClientRect();
        if (!hidden(r) && r.bottom > 0 && r.top < innerHeight) start(el).catch(() => {});
      }
    } else if (mode === 'block' && was === 'allow') {
      // just switched to "stop": pause what's playing, and forget earlier click approvals
      approved = new WeakMap();
      for (const el of document.querySelectorAll('video, audio')) {
        if (!el.paused && !(el.srcObject instanceof MediaStream) && !(allowMuted && el.muted)) { block(el); pause.call(el); }
      }
    }
  });
})();
