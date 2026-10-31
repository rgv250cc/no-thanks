#!/usr/bin/env node
// Fetches the filter lists and their page scripts from a uBlock Origin Lite release, and the cookie
// rules from DuckDuckGo's autoconsent. Nothing here runs in the browser, and the extension never
// downloads lists itself. The results are not in git: they change every few days.
//
//   node scripts/update-lists.mjs            latest versions
//   node scripts/update-lists.mjs 2026.1026.1812
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'no-thanks-lists-'));

// --- uBlock Origin Lite ---
const release = process.argv[2]
  ? `tags/${process.argv[2]}`
  : 'latest';
const res = await fetch(`https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/${release}`);
if (!res.ok) throw new Error(`GitHub answered ${res.status} for release ${release}`);
const { tag_name: ubol, assets } = await res.json();
const asset = assets.find(a => a.name.endsWith('.chromium.zip'));
if (!asset) throw new Error(`release ${ubol} has no Chromium build`);
const zip = path.join(tmp, asset.name);
fs.writeFileSync(zip, Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer()));
const src = path.join(tmp, 'ubol');
run('unzip', ['-q', zip, '-d', src]);

// redirect rules name these folders from the extension root, so the layout has to stay as it is upstream
for (const dir of ['rulesets', 'web_accessible_resources', 'js']) fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
fs.cpSync(path.join(src, 'rulesets'), path.join(ROOT, 'rulesets'), { recursive: true });
fs.rmSync(path.join(ROOT, 'rulesets', 'urlskip'), { recursive: true, force: true });
fs.cpSync(path.join(src, 'web_accessible_resources'), path.join(ROOT, 'web_accessible_resources'), { recursive: true });
const scripts = ['css-api', 'isolated-api', 'css-generic', 'css-specific', 'css-procedural-api', 'prevent-popup', 'prevent-popup-target'];
fs.mkdirSync(path.join(ROOT, 'js', 'scripting'), { recursive: true });
for (const s of scripts) fs.copyFileSync(path.join(src, 'js', 'scripting', `${s}.js`), path.join(ROOT, 'js', 'scripting', `${s}.js`));

// --- autoconsent ---
const ac = path.join(tmp, 'ac');
fs.mkdirSync(ac);
fs.writeFileSync(path.join(ac, 'package.json'), '{}');
run('npm', ['install', '--silent', '--no-audit', '--no-fund', '@duckduckgo/autoconsent', 'esbuild'], ac);
const pkg = path.join(ac, 'node_modules', '@duckduckgo', 'autoconsent');
const autoconsent = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'))).version;
fs.copyFileSync(path.join(pkg, 'dist', 'addon-mv3', 'content.bundle.js'), path.join(ROOT, 'js', 'consent-content.js'));
fs.copyFileSync(path.join(pkg, 'dist', 'addon-mv3', 'compact-rules.json'), path.join(ROOT, 'js', 'consent-rules.json'));
fs.writeFileSync(path.join(ac, 'entry.js'), `import { evalSnippets, filterCompactRules } from '@duckduckgo/autoconsent';\nself.consentLib = { evalSnippets, filterCompactRules };\n`);
run(path.join(ac, 'node_modules', '.bin', 'esbuild'), ['entry.js', '--bundle', '--format=iife', '--log-level=error', `--outfile=${path.join(ROOT, 'js', 'consent-lib.js')}`], ac);

// --- manifest: rule files and redirect targets follow the release ---
const manifestPath = path.join(ROOT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath));
const upstream = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json')));
manifest.declarative_net_request = upstream.declarative_net_request;
const resources = upstream.web_accessible_resources.flatMap(w => w.resources).filter(r => r.startsWith('web_accessible_resources/'));
manifest.web_accessible_resources = [{ resources, matches: ['<all_urls>'], use_dynamic_url: true }, { resources: ['blocked.html'], matches: ['<all_urls>'], use_dynamic_url: true }];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

fs.writeFileSync(path.join(ROOT, 'js', 'versions.json'), JSON.stringify({ ubol, autoconsent }, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`uBlock Origin Lite ${ubol}, autoconsent ${autoconsent}`);
