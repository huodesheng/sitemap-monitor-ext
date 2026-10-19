# Sitemap Competitor Monitor（Sitemap 盯同行）

[English](./README.md) · [简体中文](./README.zh-Hans.md)

Chrome / Microsoft Edge **Manifest V3** extension that watches competitors’ **Sitemaps**, surfaces **newly published URLs**, extracts **keyword candidates** from paths, and opens Google Trends / Search in one click.

Inspired by the 哥飞 SEO tutorial: *[找不到新词？用 Sitemap 盯住同行最近更新的页面](https://mp.weixin.qq.com/s/-gg2WIpfMml1L9PmstEJ_w)*.

**Current version:** `1.2.5` · **License:** [MIT](./LICENSE)

## Why this exists

Keyword tools often lag. Competitor sitemaps reveal new pages early. This extension automates the light workflow:

1. Track 5–20 competitor domains  
2. Discover and select content sitemaps  
3. Baseline once, then only show **new URLs**  
4. Split path segments into candidate terms  
5. Validate with Trends / Search and keep a watchlist  

It does **not** scrape page bodies, auto-write articles, or upload your data to any server.

## Features

| Area | What you get |
|------|----------------|
| Monitor list | Add domains (suggested 5–20, hard cap 20) |
| Sitemap discovery | `robots.txt` `Sitemap:` lines; fallbacks `/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml`; paste URL manually |
| Content selection | Expand sitemap indexes; prefer post/product/game/page; skip tag/category/author |
| Baseline + delta | First run = baseline; later runs only **new** `loc`s; `.gz` supported |
| Candidates | Path tokenization; batch watch / delete / clear |
| Watchlist | Save terms with notes |
| Daily check | `chrome.alarms` + toolbar badge count |
| Import / export | JSON merge or replace |
| Storage (1.2.4+) | Light data in `chrome.storage.local`; baselines / snapshots / new URLs in **IndexedDB** (`sitemap_monitor`) + `unlimitedStorage` |

## Install (developer mode)

Load the **unpacked** folder that contains `manifest.json` (do not load the `.zip` itself).

### Google Chrome

1. Open `chrome://extensions/`  
2. Enable **Developer mode**  
3. **Load unpacked** → select this repo folder  
4. Pin the icon; open the popup or dashboard  

### Microsoft Edge

1. Open `edge://extensions/`  
2. Enable **Developer mode**  
3. **Load unpacked** → select this repo folder  

### From a release zip

Unzip, then load the extracted directory (the one with `manifest.json`).

## Recommended workflow

1. Add competitor domains in the popup or dashboard  
2. **Discover Sitemap** → tick content sitemaps → **Save & create baseline**  
3. Later (or **Check updates**): review **New URLs**  
4. **Extract candidates** → Trends → add to **Watchlist**  

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Sites, candidates, watchlist, settings |
| `unlimitedStorage` | Raise chrome.storage quota; large baselines live in IndexedDB |
| `alarms` | Daily automatic recheck |
| `host_permissions` `http(s)://*/*` | Fetch competitors’ robots.txt / sitemaps |

All data stays on your device.

## Project layout

```text
sitemap-monitor-ext/
  manifest.json
  background.js          # service worker: alarms, badge, messaging
  popup.html|css|js      # quick add / badge / open dashboard
  dashboard.html|css|js  # full console
  lib/idb.js             # IndexedDB helpers
  lib/storage.js         # storage + migration
  lib/sitemap.js         # fetch / parse / .gz / one-level index
  lib/keywords.js        # path → candidates
  lib/presets.js         # one-click domain presets
  icons/
  README.md
  README.zh-Hans.md
  SUMMARY.md             # feature ↔ tutorial mapping (zh)
  LICENSE
```

## Tech notes

- Plain HTML / CSS / JS — no bundler  
- Dashboard uses `DOMParser`; service worker falls back to regex  
- `.gz` via `DecompressionStream`  
- Nested sitemap indexes expand **one** level only  

## Caveats

- Some sites / WAFs may block extension `fetch`  
- First check builds a baseline and does **not** mark history as “new”  
- Be polite: limit domains and check frequency  

## Changelog (high level)

- **1.2.5** — Candidates batch: select-all, bulk watch / delete / clear  
- **1.2.4** — IndexedDB for baselines; storage meter; `unlimitedStorage`  
- **1.2.x** — Large sitemap index auto-select + parallel fetch; presets  

## Contributing

Issues and PRs welcome. Keep changes focused; update `manifest.json` version when shipping behavior changes.

## Credits

Workflow idea from 哥飞’s SEO tutorial (link above). Implementation is independent and unaffiliated.

## License

[MIT](./LICENSE) © 2026 huodesheng
