<p align="center"><img src="icons/128.png" width="96" alt=""></p>
<h1 align="center">No Thanks</h1>
<p align="center">Block ads, trackers, autoplay, sound and page tricks on any website, in Chrome and Edge.<br>Ads, autoplay and noise: no thanks.</p>

![No Thanks stops autoplay and keeps sound off](docs/screenshots/1-autoplay-blocked.png)

## Features

- **Blocks ads and trackers.** Uses the filter lists and page scripts of [uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home), including the lists for your language.
- **Blocks malware and phishing sites.** A warning page lets you go back or continue.
- **Hides clutter, if you want.** Separate switches for cookie notices, overlays, social buttons, chat widgets, notification nags, AI widgets and other annoyances.
- **Stops page tricks.** Answers cookie banners with "reject", holds permission prompts until you click or type, stops needless "Leave site?" dialogs, keeps copy and paste honest, unlocks scrolling and sends Global Privacy Control.
- **Hide an element.** Point at something on a page and click it. It stays hidden on that site.
- **Allow once.** Turn off ad blocking and page tricks on a site until the tab closes or leaves it.
- **Blocks autoplay everywhere.** Video and audio wait until you start them. This covers the `autoplay` attribute, script `play()` calls and embedded players.
- **Mutes tabs automatically.** Choose all tabs, background tabs only (just the active tab plays), or off.
- **Exceptions for a site or a page.** `example.com` covers the site and its subdomains. `example.com/videos` covers pages under that path. The most specific rule wins. Autoplay, sound, ads and page tricks all use the same rules.
- **Quick controls.** Use the popup, or right-click the page or toolbar icon. Each one shows the current state. Autoplay and sound change at once. Ads and page tricks apply when the page next loads, and the popup offers a reload.
- **Your choice wins.** If you mute or unmute a tab yourself, auto-mute leaves it alone until that tab goes to another site.
- **Shortcuts.** `Alt+Shift+M` mutes or unmutes the tab. `Alt+Shift+O` mutes all other tabs.
- **Sync and backup.** Settings sync through your browser account, and you can export or import them as JSON.
- **Private.** No account, no tracking, no ads, and nothing is sent to any server. See the [privacy policy](PRIVACY.md).

By default, ads, trackers, malware sites, autoplay and silent videos are blocked, all tabs are muted, and all page tricks are stopped except for the optional right-click and text selection unlock. The clutter lists are off.

![Allow autoplay and sound for the sites you trust](docs/screenshots/2-allow-what-you-trust.png)
![Manage all your exceptions in the settings page](docs/screenshots/3-exceptions.png)
![No Thanks in light and dark themes](docs/screenshots/4-light-and-dark.png)

## Install from source

1. Download or clone this repository.
2. Run `node scripts/update-lists.mjs` in its folder to fetch the filter lists. They are not in the repository because they change every few days.
3. Open `chrome://extensions` (or `edge://extensions`).
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select the repository folder.

## How autoplay blocking works

Media starts when you ask for it on the current page. Any of these counts:

- A click on the video or anywhere in its player, including its control bar.
- A click on a button that is labelled as play, watch or listen, anywhere on the page.
- Any click that does not open a link, if the media has no place on the page, such as audio or a hidden video.
- A key press outside a text field, such as Space. Keys that only move around the page do not count.

If the site does not respond to your click on a video that it tried to start, No Thanks starts the video. The click also reaches players in embedded frames, and it still counts if the player takes a few seconds to load or plays an ad first.

Opening a video from a thumbnail does not start it, and neither does a player moving on to the next video at a new address. Clicks elsewhere on the page, right-clicks and typing do not start media. Video and voice calls are never blocked.

## How exceptions reach the browser

Filter rules run inside the browser, so blocking works from the first request after the browser starts, even while the extension sleeps. [`blocking.js`](blocking.js) turns your exceptions into browser rules and script registrations, and [`rules.js`](rules.js) holds the logic, which `test.js` checks against the rule that decides autoplay and sound.

## Known limits

- Chrome and Edge do not allow extensions to rewrite page responses or to use dynamic filtering, so some of what classic uBlock Origin does on Firefox is not possible.
- Filter lists update when the extension updates.
- Browser limits leave room for about three quarters of the full-page block rules. Rules that cover whole domain lists always fit, and the rest are single-site patterns.
- Ads already on the screen stay until the page reloads.
- A page rule for ads applies at once when a single-page site changes address, but the page scripts and page tricks for that rule apply on the next full load.
- "Allow ads" also turns off the clutter lists and malware blocking on that site. "Allow page tricks" does not unblock network requests from the clutter lists.
- If ads are off by default and you block them on one site, the other lists only work on that site too.
- "Allow once" covers the site in that tab for network rules, and in every tab for page scripts.
- A very brief moment of sound is possible if a page starts media before the extension has finished starting up.
- Sites that play sounds on their own, such as notification sounds, need an autoplay exception.
- Autoplay inside declarative shadow DOM is not caught.
- A site written specifically to target this extension could get around the block.
- About 1,800 exceptions fit in synced browser storage.
- Browser pages such as `chrome://` and the extension stores cannot be controlled by extensions.

## Development

Run the rule tests:

```bash
node test.js
```

Run the player tests. They use real clicks on local test pages in a muted headless browser, and take about a minute:

```bash
node test/e2e.mjs
```

Run the blocking tests. They map every host to a local server, so no real site is contacted. They need `puppeteer-core`:

```bash
npm install --no-save puppeteer-core
```

```bash
node test/e2e-blocking.mjs
```

Update the filter lists, then bump the version in `manifest.json`:

```bash
node scripts/update-lists.mjs
```

Build the zip that is uploaded to the stores:

```bash
mkdir -p dist && zip -r dist/no-thanks.zip manifest.json *.js *.html style.css LICENSE NOTICE.md icons tricks js rulesets web_accessible_resources -x test.js
```

## License

[GPLv3](LICENSE). See [the notices](NOTICE.md) for the work this builds on. Versions up to 1.0.1 were released under the MIT license.
