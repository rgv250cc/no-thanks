# Store listing

## Name

No Thanks

## Summary

Block ads, trackers, autoplay, sound and page tricks on any website, with exceptions for the sites and pages you choose.

## Category

Productivity / Tools

## Description

Ads, trackers, videos that start by themselves, tabs that make noise, cookie banners and pop-up prompts: No Thanks blocks what you did not ask for on every website, and lets you choose the exceptions.

BLOCK ADS AND TRACKERS
Uses the filter lists of uBlock Origin Lite, including those for your language. Known malware and phishing sites are blocked too, and you can choose to continue.

STOP PAGE TRICKS
Answers cookie banners with "reject". Notification and location prompts wait until you click or type on the page. Needless "Leave site?" dialogs stop, and they stay if you changed something on the page. Sites cannot block copy and paste or add text to what you copy. Scrolling comes back when a banner left the page locked. Sends Global Privacy Control.

HIDE WHAT YOU DO NOT WANT
Optional switches hide cookie notices, overlays, social buttons, chat widgets, notification nags and AI widgets. Point at anything else on a page to keep it hidden on that site.

BLOCK AUTOPLAY
Video and audio wait until you start them, on every website. This includes embedded players and videos that start after you open a page.

AUTO-MUTE TABS
Mute all tabs, or only background tabs so that just the active tab plays. If you mute or unmute a tab yourself, that choice wins until the tab goes to another site.

EXCEPTIONS FOR THE SITES YOU TRUST
Allow autoplay, sound, ads or page tricks for a whole site or a single page. Use the switches in the popup, or right-click any page. Checkmarks and switches show the current state. "Allow once" turns off ad blocking and page tricks until the tab leaves the site.

ALSO INCLUDED
- Mute all other tabs with one click
- Keyboard shortcuts: Alt+Shift+M mutes or unmutes the tab, Alt+Shift+O mutes all other tabs
- Settings page to manage every exception
- Settings sync through your browser account, plus JSON export and import
- Light and dark themes

PRIVATE
No account, no tracking and no ads. Nothing is sent to the developer, and filter lists are part of the extension. The code is open source under the GPLv3.

Default settings: ads, trackers, malware sites and autoplay blocked, all tabs muted, silent videos blocked, page tricks stopped. You can change each one.

## Single purpose

Blocks unwanted page content and behavior: ads, trackers, autoplay, sound and page tricks, with one set of per-site and per-page exceptions.

## Permission justifications

- **storage:** Saves the user's settings and site and page exceptions.
- **tabs:** Reads tab addresses to choose which user rule applies, and mutes or unmutes tabs.
- **contextMenus:** Adds the right-click menu that shows and changes the rules for the current site or page, and starts "Hide an element".
- **declarativeNetRequest:** Blocks ads, trackers and dangerous sites with filter lists included in the package, and applies the user's exceptions. Sends the Global Privacy Control header.
- **scripting:** Registers the page scripts that belong to the filter lists and the page trick blockers, limited by the user's exceptions, and starts "Hide an element".
- **unlimitedStorage:** Stores the filter data for hiding elements on the user's device.
- **Content scripts and host access on all sites:** Ads, autoplay and page tricks can occur on any website, so blocking must work on every page and frame, before page scripts.
- **Remote code:** No. All code is included in the package.

## Data usage

Collects no user data. Does not sell data, or use or transfer it for unrelated purposes or to determine creditworthiness.

## Links

- Privacy policy: https://github.com/rgv250cc/no-thanks/blob/main/PRIVACY.md
- Homepage and support: https://github.com/rgv250cc/no-thanks

## Notes for reviewers

No login is needed. To test: open a news site. Ads are gone, the video stays paused and the tab is muted. Click the video to start it. Use the toolbar popup to allow autoplay, sound, ads or page tricks for that site, and reload the page for ads and page tricks. The filter rules and page scripts come from uBlock Origin Lite and the cookie rules from autoconsent. `NOTICE.md` lists the versions and licenses. To rebuild them, run `node scripts/update-lists.mjs`.

## Images

In `docs/screenshots`: six 1280x800 screenshots, a 440x280 promo tile and a 1400x560 marquee tile.
