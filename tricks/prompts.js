// Permission prompts only appear after you click or type on the page. Sites that ask the moment they
// load get the same answer as if you had dismissed the prompt. Permissions you already gave still work.
(() => {
  const WINDOW = 5000;
  let last = -Infinity;
  const mark = e => { if (e.isTrusted) last = performance.now(); };
  addEventListener('pointerdown', mark, true);
  addEventListener('keydown', mark, true);
  const asked = () => performance.now() - last < WINDOW;

  if (self.Notification) {
    const request = Notification.requestPermission;
    Notification.requestPermission = function (callback) {
      if (Notification.permission !== 'default' || asked()) return request.apply(this, arguments);
      callback?.('default');
      return Promise.resolve('default');
    };
  }
  if (self.PushManager) {
    const subscribe = PushManager.prototype.subscribe;
    PushManager.prototype.subscribe = function () {
      if (self.Notification?.permission !== 'default' || asked()) return subscribe.apply(this, arguments);
      return Promise.reject(new DOMException('Registration failed - permission denied', 'NotAllowedError'));
    };
  }

  if (!self.Geolocation || !navigator.permissions) return;
  const proto = Geolocation.prototype;
  const get = proto.getCurrentPosition, watch = proto.watchPosition, clear = proto.clearWatch;
  const denied = fail => fail?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'User denied Geolocation' });
  const granted = () => navigator.permissions.query({ name: 'geolocation' }).then(p => p.state === 'granted', () => true);

  proto.getCurrentPosition = function (ok, fail, options) {
    if (asked()) return get.call(this, ok, fail, options);
    granted().then(yes => (yes ? get.call(this, ok, fail, options) : denied(fail)));
  };
  // watchPosition has to return its id right away, but finding out the permission takes a moment
  const ids = new Map();
  let nextId = 1e6;
  proto.watchPosition = function (ok, fail, options) {
    if (asked()) return watch.call(this, ok, fail, options);
    const id = nextId++;
    ids.set(id, null);
    granted().then(yes => {
      if (!ids.has(id)) return;
      if (yes) ids.set(id, watch.call(this, ok, fail, options));
      else denied(fail);
    });
    return id;
  };
  proto.clearWatch = function (id) {
    if (!ids.has(id)) return clear.call(this, id);
    const real = ids.get(id);
    ids.delete(id);
    if (real !== null) clear.call(this, real);
  };
})();
