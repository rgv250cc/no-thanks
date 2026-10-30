# Store listing

## Name

No Thanks

## Summary

Stop autoplay and auto-mute tabs on any website, with exceptions for the sites and pages you choose.

## Category

Productivity / Tools

## Description

Tired of videos starting by themselves and tabs making noise? No Thanks makes media wait until you start it.

BLOCK AUTOPLAY
Video and audio wait until you start them, on every website. This includes embedded players and videos that start after you open a page.

AUTO-MUTE TABS
Mute all tabs, or only background tabs so that just the active tab plays. If you mute or unmute a tab yourself, that choice wins until the tab goes to another site.

EXCEPTIONS FOR THE SITES YOU TRUST
Allow autoplay or sound for a whole site or a single page. Use the switches in the popup, or right-click any page. Checkmarks and switches show the current state, and changes apply with no reload.

ALSO INCLUDED
- Mute all other tabs with one click
- Keyboard shortcuts: Alt+Shift+M mutes or unmutes the tab, Alt+Shift+O mutes all other tabs
- Settings page to manage every exception
- Settings sync through your browser account, plus JSON export and import
- Light and dark themes

PRIVATE
No account, no tracking and no ads. Nothing is sent to any server. The code is open source.

Default settings: autoplay blocked, all tabs muted, silent videos blocked. You can change each one.

## Single purpose

Gives the user control over when web media plays and whether tabs make sound, by blocking autoplay and muting tabs, with per-site and per-page exceptions.

## Permission justifications

- **storage:** Saves the user's settings and site and page exceptions.
- **tabs:** Reads tab addresses to choose which user rule applies, and mutes or unmutes tabs.
- **contextMenus:** Adds the right-click menu that shows and changes autoplay and sound for the current site or page.
- **Content scripts on all sites (host access):** Autoplay can happen on any website, so the script must run on every page and frame, before page scripts, to stop media from starting by itself.
- **Remote code:** No. All code is included in the package.

## Data usage

Collects no user data. Does not sell data, or use or transfer it for unrelated purposes or to determine creditworthiness.

## Links

- Privacy policy: https://github.com/rgv250cc/no-thanks/blob/main/PRIVACY.md
- Homepage and support: https://github.com/rgv250cc/no-thanks

## Notes for reviewers

No login is needed. To test: open a page with a video that autoplays, such as a news site. The video stays paused and the tab is muted. Click the video to start it. Use the toolbar popup to allow autoplay or sound for that site.

## Images

In `docs/screenshots`: four 1280x800 screenshots and a 440x280 promo tile.
