# Notices

No Thanks is free software under the [GNU General Public License, version 3](LICENSE). Versions up to 1.0.1 were released under the MIT license.

Release packages and folders created by `scripts/update-lists.mjs` contain the work of others:

| Part | Where | Source | License |
|---|---|---|---|
| Filter rules and page scripts | `rulesets/`, `js/scripting/`, `web_accessible_resources/` | [uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home), by Raymond Hill and contributors | GPLv3 |
| Cookie banner rules and code | `js/consent-content.js`, `js/consent-lib.js`, `js/consent-rules.json` | [autoconsent](https://github.com/duckduckgo/autoconsent), by DuckDuckGo | MPL 2.0 |

The filter lists inside the rules have their own licenses. EasyList and EasyPrivacy use GPLv3 or CC BY-SA 3.0, uBlock filters and AdGuard lists use GPLv3, and the URLhaus list uses CC0. Peter Lowe's list allows non-commercial use only. See the [list of filter list licenses](https://github.com/uBlockOrigin/uBlock-issues/wiki/Filter-list-licenses).

`js/versions.json` records the versions in a package.
