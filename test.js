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

// --- ads and page tricks ---
const { adsAllowed, tricksAllowed, adAllowConditions, notAny, regions, rootAllowsAds, chunkRules } = require('./rules.js');
const ads = rules => ({ ...DEFAULTS, rules });

assert.strictEqual(DEFAULTS.blockAds, true);
assert.strictEqual(adsAllowed(ads({}), 'https://cnn.com/'), false);
assert.strictEqual(adsAllowed({ ...ads({}), blockAds: false }, 'https://cnn.com/'), true);
assert.strictEqual(adsAllowed({ ...ads({}), enabled: false }, 'https://cnn.com/'), true);
assert.strictEqual(adsAllowed(ads({ 'cnn.com': { ads: 'allow' } }), 'https://www.cnn.com/'), true);
assert.strictEqual(adsAllowed(ads({ 'cnn.com': { ads: 'allow' }, 'cnn.com/live': { ads: 'block' } }), 'https://cnn.com/live/1'), false);
assert.strictEqual(tricksAllowed(ads({}), 'https://cnn.com/'), false);
assert.strictEqual(tricksAllowed(ads({ 'cnn.com': { tricks: 'allow' } }), 'https://cnn.com/'), true);
assert.strictEqual(allowedAt(ads({ 'cnn.com': { ads: 'allow' } }), 'https://cnn.com/', 'ads'), true);
assert.strictEqual(allowedAt(ads({}), 'https://cnn.com/', 'tricks'), false);
assert.strictEqual(valueFor(ads({}), 'cnn.com', 'ads', 'https://cnn.com/', true), 'allow');
assert.strictEqual(valueFor(ads({}), 'cnn.com', 'ads', 'https://cnn.com/', false), '');
assert.strictEqual(valueFor(ads({ 'cnn.com': { ads: 'allow' } }), 'cnn.com/live', 'ads', 'https://cnn.com/live', false), 'block');
assert.strictEqual(valueFor(ads({}), 'cnn.com', 'tricks', 'https://cnn.com/', true), 'allow');

// the regex that says "this text does not start with any of these": no lookahead in RE2
const re = p => new RegExp('^' + notAny(p));
for (const yes of ['', 'x', 's', 'sh', 'sho', 'shop', 'shortz', 'SHORTS']) assert.ok(re(['shorts']).test(yes), yes);
for (const no of ['shorts', 'shorts/1', 'shorts?a']) assert.ok(!re(['shorts']).test(no), no);
for (const yes of ['a', 'ab', 'abd', 'abx', 'b', 'x']) assert.ok(re(['abc', 'abe', 'c']).test(yes), yes);
for (const no of ['abc', 'abe/1', 'c', 'cat']) assert.ok(!re(['abc', 'abe', 'c']).test(no), no);
assert.ok(!re(['a.b']).test('a.b') && re(['a.b']).test('axb'), 'special characters are literal');

// Every URL gets the same answer from the DNR conditions as from ruleFor.
const condMatch = (c, url) => {
  const u = new URL(url);
  const inDomain = (h, d) => h === d || h.endsWith('.' + d);
  if (c.excludedRequestDomains?.some(d => inDomain(u.hostname, d))) return false;
  if (c.regexFilter) return new RegExp(c.regexFilter).test(url);
  if (c.urlFilter === '|http') return true;
  const [host, ...rest] = c.urlFilter.slice(2).split('/');
  return inDomain(u.hostname, host) && u.pathname.startsWith('/' + rest.join('/'));
};
const URLS = ['https://site.test/', 'https://www.site.test/watch?v=1', 'https://site.test/shop', 'https://site.test/sho', 'https://site.test/shorts',
  'https://site.test/shorts/1?a=/b', 'https://site.test/shorts/ok', 'https://site.test/shorts/ok/1', 'https://site.test/shorts/ok/x/9',
  'https://a.site.test/', 'https://a.site.test/x', 'https://a.site.test/x/1', 'https://a.site.test/y', 'https://b.site.test/z',
  'https://notsite.test/', 'https://other.test/shorts'];
const CASES = [
  {},
  { 'site.test': { ads: 'allow' } },
  { 'site.test/shorts': { ads: 'allow' } },
  { 'site.test': { ads: 'allow' }, 'site.test/shorts': { ads: 'block' } },
  { 'site.test': { ads: 'allow' }, 'site.test/shorts': { ads: 'block' }, 'site.test/shorts/ok': { ads: 'allow' } },
  { 'site.test': { ads: 'allow' }, 'site.test/shorts': { ads: 'block' }, 'site.test/shorts/ok': { ads: 'allow' }, 'site.test/shorts/ok/x': { ads: 'block' } },
  { 'site.test': { ads: 'allow' }, 'site.test/shop': { ads: 'block' }, 'site.test/shorts': { ads: 'block' } },
  { 'site.test': { ads: 'allow' }, 'a.site.test': { ads: 'block' } },
  { 'site.test': { ads: 'allow' }, 'a.site.test/x': { ads: 'block' } },
  { 'site.test': { ads: 'block' } },
  { 'site.test': { ads: 'block' }, 'site.test/shorts': { ads: 'allow' } },
  { 'site.test/shorts': { ads: 'block' } },
  { 'a.site.test/x': { ads: 'block' }, 'other.test': { ads: 'allow' } },
  { 'site.test': { autoplay: 'allow' } },
];
for (const blockAds of [true, false]) {
  for (const rules of CASES) {
    const st = { ...ads(rules), blockAds };
    // with ads off and nothing to block the lists are simply off, so there is nothing to allow
    if (!blockAds && !rootAllowsAds(st)) continue;
    const conds = adAllowConditions(st);
    for (const url of URLS) {
      assert.strictEqual(conds.some(c => condMatch(c, url)), adsAllowed(st, url), `${url} with ${JSON.stringify(rules)} blockAds=${blockAds}`);
    }
  }
}
assert.deepStrictEqual(adAllowConditions(ads({ 'site.test/a*b': { ads: 'allow' } })).map(c => c.regexFilter), ['^https?://(?:[^/]+\\.)?site\\.test(?::[0-9]+)?\\/a\\*b']);
assert.deepStrictEqual(adAllowConditions(ads({ 'bad host!': { ads: 'allow' }, 'ok.test': { ads: 'allow' } })).length, 1);

// Where page scripts run: a match pattern for each level, and a URL runs them on the level that matches.
const inPattern = (p, url) => {
  if (p === '<all_urls>') return true;
  const u = new URL(url), [, host, path] = /^\*:\/\/\*\.([^/]+)(\/.*)\*$/.exec(p);
  return (u.hostname === host || u.hostname.endsWith('.' + host)) && (u.pathname + u.search).startsWith(path);
};
for (const rootBlocked of [true, false]) {
  for (const rules of CASES) {
    const st = { ...ads(rules), blockAds: rootBlocked };
    const levels = regions(rules, 'ads', rootBlocked);
    for (const url of URLS) {
      const runs = levels.some(l => l.matches.some(p => inPattern(p, url)) && !l.excludeMatches.some(p => inPattern(p, url)));
      assert.strictEqual(runs, !adsAllowed(st, url), `scripts at ${url} with ${JSON.stringify(rules)} rootBlocked=${rootBlocked}`);
    }
  }
}
assert.deepStrictEqual(regions({}, 'ads', false), []);
assert.deepStrictEqual(regions({}, 'ads', true), [{ matches: ['<all_urls>'], excludeMatches: [] }]);

// long exception lists are split to fit the 8 KB storage.sync item limit
const many = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`site-number-${i}.example.com/some/path`, { ads: 'allow', mute: 'never' }]));
const chunks = chunkRules(many);
assert.ok(chunks.length > 1 && chunks.every(c => JSON.stringify(c).length < 8000));
assert.deepStrictEqual(Object.assign({}, ...chunks), many);
assert.deepStrictEqual(chunkRules({}), [{}]);

console.log('ok');
