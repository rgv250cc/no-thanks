// node test.js
const assert = require('assert');
const { DEFAULTS, ruleFor, autoplayAllowed, muteWanted } = require('./rules.js');

const s = {
  ...DEFAULTS,
  muteMode: 'all',
  rules: {
    'youtube.com': { autoplay: 'allow', mute: 'never' },
    'youtube.com/shorts': { autoplay: 'block' },
    'news.example.com': { mute: 'mute' },
  },
};

// host + subdomains, not lookalikes
assert.deepStrictEqual(ruleFor('https://www.youtube.com/watch?v=1', s.rules), { autoplay: 'allow', mute: 'never' });
assert.deepStrictEqual(ruleFor('https://notyoutube.com/', s.rules), {});
// page rule overrides only its own field
assert.deepStrictEqual(ruleFor('https://m.youtube.com/shorts/abc', s.rules), { autoplay: 'block', mute: 'never' });
assert.deepStrictEqual(ruleFor('not a url', s.rules), {});

assert.strictEqual(autoplayAllowed(s, 'https://youtube.com/watch'), true);
assert.strictEqual(autoplayAllowed(s, 'https://youtube.com/shorts/x'), false);
assert.strictEqual(autoplayAllowed(s, 'https://cnn.com/'), false);
assert.strictEqual(autoplayAllowed({ ...s, blockAutoplay: false }, 'https://cnn.com/'), true);
assert.strictEqual(autoplayAllowed({ ...s, enabled: false }, 'https://youtube.com/shorts/x'), true);

assert.strictEqual(muteWanted(s, 'https://youtube.com/', true), false);
assert.strictEqual(muteWanted(s, 'https://cnn.com/', true), true);
assert.strictEqual(muteWanted({ ...s, muteMode: 'off' }, 'https://cnn.com/', false), null);
assert.strictEqual(muteWanted({ ...s, muteMode: 'off' }, 'https://news.example.com/a', true), true);
assert.strictEqual(muteWanted({ ...s, muteMode: 'background' }, 'https://cnn.com/', true), false);
assert.strictEqual(muteWanted({ ...s, muteMode: 'background' }, 'https://cnn.com/', false), true);
assert.strictEqual(muteWanted({ ...s, enabled: false }, 'https://cnn.com/', false), null);

// quick toggles: write the minimal rule, drop it when the default/site rule already matches
const { allowedAt, scopeOf, valueFor } = require('./rules.js');
assert.strictEqual(DEFAULTS.allowMutedAutoplay, false);
assert.deepStrictEqual(scopeOf('https://www.cnn.com/live/', 'site'), { key: 'cnn.com', url: 'https://www.cnn.com/' });
assert.strictEqual(scopeOf('https://www.cnn.com/live/', 'page').key, 'cnn.com/live');
assert.strictEqual(allowedAt(s, 'https://cnn.com/', 'mute'), false);           // muteMode 'all'
assert.strictEqual(valueFor(s, 'cnn.com', 'mute', 'https://cnn.com/', true), 'never');
assert.strictEqual(valueFor(s, 'cnn.com', 'autoplay', 'https://cnn.com/', true), 'allow');
assert.strictEqual(valueFor(s, 'cnn.com', 'autoplay', 'https://cnn.com/', false), '');   // default already blocks
// page under an allowed site: blocking needs a page rule, re-allowing just drops it
assert.strictEqual(valueFor(s, 'youtube.com/shorts', 'autoplay', 'https://youtube.com/shorts', true), '');
assert.strictEqual(valueFor(s, 'youtube.com/live', 'autoplay', 'https://youtube.com/live', false), 'block');
assert.strictEqual(valueFor({ ...s, muteMode: 'background' }, 'x.com', 'mute', 'https://x.com/', false), 'mute');

console.log('ok');
