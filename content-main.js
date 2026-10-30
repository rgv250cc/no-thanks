// Runs in the page's own JS world at document_start, before page scripts.
// Blocks media from starting unless the user just interacted with *that player* on *this URL*.
(() => {
  const proto = HTMLMediaElement.prototype;
  const play = proto.play, pause = proto.pause;
  let mode = 'pending'; // until content.js tells us this page's rule
  let allowMuted = true;
  let approved = new WeakMap(); // media element -> URL it was approved on
  const held = new Set();
  const blocked = new WeakSet(); // videos we stopped, which the site may still believe are playing
  let wanted = null; // blocked video the user just clicked

  const under = (el, g) => {
    const r = el.getBoundingClientRect();
    return g.x >= r.left && g.x <= r.right && g.y >= r.top && g.y <= r.bottom;
  };

  // Last user gesture. Window capture runs before any page handler can stop it.
  let gesture = null;
  addEventListener('pointerdown', e => {
    gesture = { path: e.composedPath(), x: e.clientX, y: e.clientY, href: location.href };
    // a click on a video counts even if the site calls play() later, after the browser's activation window
    for (const v of document.querySelectorAll('video')) {
      if (!under(v, gesture)) continue;
      approved.set(v, location.href);
      if (blocked.has(v)) wanted = { el: v, time: e.timeStamp };
    }
  }, true);
  addEventListener('keydown', e => {
    // Enter follows links (e.g. a focused thumbnail), so it doesn't count as "play"
    if (!['Enter', 'Tab', 'Escape'].includes(e.key)) gesture = { path: null, href: location.href };
  }, true);

  // A click on a thumbnail is a gesture too, but it means "open", not "play":
  // SPAs (YouTube) then swap the URL and start the same reused <video>.
  // Counts if the click landed on the video's area (sites cover it with overlays, e.g. Instagram)
  // or in its player UI outside that area.
  // ponytail: "player UI" = inside one of the video's 6 closest ancestors; a control bar further out than that won't count.
  const userStarted = el => {
    if (!navigator.userActivation.isActive || !gesture || gesture.href !== location.href) return false;
    if (!gesture.path || el instanceof HTMLAudioElement || !el.offsetWidth) return true; // key press / invisible player
    if (under(el, gesture)) return true;
    for (let a = el, i = 0; a && i < 7; a = a.parentNode || a.host, i++) if (gesture.path.includes(a)) return true;
    return false;
  };

  const allowed = el => {
    if (userStarted(el)) { approved.set(el, location.href); return true; }
    if (approved.get(el) === location.href || mode === 'allow') return true;
    if (mode === 'pending') { held.add(el); return false; }
    return allowMuted && (el.muted || el.volume === 0);
  };

  proto.play = function () {
    if (allowed(this)) return play.call(this);
    blocked.add(this);
    // same error the browser's own autoplay policy throws, so players cope with it
    return Promise.reject(new DOMException('Autoplay blocked by No Thanks', 'NotAllowedError'));
  };

  // Sites like Instagram ignore that error and keep believing the video plays, so the user's
  // click on it arrives as pause(). The video is already paused: they meant play.
  proto.pause = function () {
    if (wanted?.el === this && this.paused && performance.now() - wanted.time < 1000) {
      wanted = null;
      blocked.delete(this);
      play.call(this).catch(() => {});
      return;
    }
    return pause.call(this);
  };

  // catches the `autoplay` attribute and native-controls clicks (no play() call involved)
  document.addEventListener('play', e => {
    const el = e.target;
    if (!(el instanceof HTMLMediaElement)) return;
    if (allowed(el)) {
      blocked.delete(el);
      if (wanted?.el === el) wanted = null;
    } else {
      blocked.add(el);
      pause.call(el);
    }
  }, true);

  // First event = initial rule; later ones = rule changed from the popup / quick menu.
  // ponytail: a hostile page could fire this event itself to get 'allow'; it would have to target us specifically.
  document.addEventListener('no-thanks', e => {
    const cfg = JSON.parse(e.detail);
    const wasBlocking = mode !== 'allow';
    mode = cfg.allow ? 'allow' : 'block';
    allowMuted = cfg.allowMuted;
    if (held.size) {
      for (const el of held) if (allowed(el)) play.call(el).catch(() => {});
      held.clear();
    } else if (mode === 'block' && !wasBlocking) {
      // just switched to "stop": pause what's playing, and forget earlier click approvals
      approved = new WeakMap();
      for (const el of document.querySelectorAll('video, audio')) {
        if (!el.paused && !(allowMuted && el.muted)) { blocked.add(el); pause.call(el); }
      }
    }
  });
})();
