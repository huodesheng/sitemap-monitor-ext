/**
 * Storage for Sitemap 盯同行
 * Light keys → chrome.storage.local
 * Heavy keys (baselines, snapshots, newUrls) → IndexedDB (via SitemapIDB)
 */
const Storage = (() => {
  const DEFAULT_SETTINGS = {
    alarmEnabled: true,
    alarmHour: 9,
    preferTypes: ["post", "product", "game", "page", "article", "blog"],
    skipTypes: ["tag", "category", "author", "user", "archive"],
  };

  const MAX_NEW_URL_ROWS = 2000;
  const MAX_SNAPSHOT_ROWS = 1500;
  const MAX_BASELINE_URLS = 60000;

  let _migratePromise = null;

  async function get(keys) {
    return chrome.storage.local.get(keys);
  }

  function isQuotaError(err) {
    const msg = String(err?.message || err || "");
    return /quota/i.test(msg) || /QuotaBytes/i.test(msg);
  }

  async function ensureMigrated() {
    if (_migratePromise) return _migratePromise;
    _migratePromise = (async () => {
      const { idbMigrated } = await get(["idbMigrated"]);
      if (idbMigrated) return;
      const data = await get(["baselines", "snapshots", "newUrls"]);
      const hasHeavy =
        (data.baselines && Object.keys(data.baselines).length) ||
        (data.snapshots && Object.keys(data.snapshots).length) ||
        (data.newUrls && Object.keys(data.newUrls).length);
      if (hasHeavy && typeof SitemapIDB !== "undefined") {
        if (data.baselines) await SitemapIDB.putMap("baselines", data.baselines);
        if (data.snapshots) await SitemapIDB.putMap("snapshots", data.snapshots);
        if (data.newUrls) await SitemapIDB.putMap("newUrls", data.newUrls);
      }
      await chrome.storage.local.remove(["baselines", "snapshots", "newUrls"]);
      await chrome.storage.local.set({ idbMigrated: true });
    })().catch((err) => {
      _migratePromise = null;
      throw err;
    });
    return _migratePromise;
  }

  async function set(obj) {
    try {
      await chrome.storage.local.set(obj);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      await purgeHeavyData({ keepBaselines: true });
      try {
        await chrome.storage.local.set(obj);
      } catch (err2) {
        if (isQuotaError(err2)) {
          throw new Error(
            "本地存储空间不足（Resource::kQuotaBytes）。大数据已改存 IndexedDB；请到「设置」点「清理缓存」，或减少已选 Sitemap 数量后重试。"
          );
        }
        throw err2;
      }
    }
  }

  async function purgeHeavyData({ keepBaselines = true } = {}) {
    await ensureMigrated();
    if (typeof SitemapIDB !== "undefined") {
      await SitemapIDB.clearStore("snapshots");
      await SitemapIDB.clearStore("newUrls");
      if (!keepBaselines) await SitemapIDB.clearStore("baselines");
    }
    // Also clear any leftover chrome.storage heavy keys
    const removeKeys = ["snapshots", "newUrls"];
    if (!keepBaselines) removeKeys.push("baselines");
    await chrome.storage.local.remove(removeKeys);
    const counts = await getNewUrlCounts();
    for (const k of Object.keys(counts)) counts[k] = 0;
    await chrome.storage.local.set({ newUrlCounts: counts });
  }

  function trimUrlRows(urls, max) {
    const list = Array.isArray(urls) ? urls.slice() : [];
    list.sort((a, b) => {
      if (a?.lastmod && b?.lastmod) return a.lastmod < b.lastmod ? 1 : -1;
      if (a?.lastmod) return -1;
      if (b?.lastmod) return 1;
      return 0;
    });
    return list.slice(0, max);
  }

  function compactBaselineMap(urlMap) {
    const entries = Object.entries(urlMap || {});
    if (entries.length <= MAX_BASELINE_URLS) {
      return {
        locs: entries.map(([loc]) => loc),
        updatedAt: Date.now(),
        count: entries.length,
      };
    }
    entries.sort((a, b) => {
      const am = a[1] || "";
      const bm = b[1] || "";
      if (am && bm) return am < bm ? 1 : -1;
      if (am) return -1;
      if (bm) return 1;
      return 0;
    });
    const kept = entries.slice(0, MAX_BASELINE_URLS);
    return {
      locs: kept.map(([loc]) => loc),
      updatedAt: Date.now(),
      count: kept.length,
      truncated: true,
      rawTotal: entries.length,
    };
  }

  function baselineToUrlMap(baseline) {
    if (!baseline) return null;
    if (baseline.urls && typeof baseline.urls === "object" && !Array.isArray(baseline.urls)) {
      return baseline;
    }
    if (Array.isArray(baseline.locs)) {
      const urls = Object.create(null);
      for (const loc of baseline.locs) {
        if (loc) urls[loc] = null;
      }
      return { urls, updatedAt: baseline.updatedAt || null, count: baseline.count || baseline.locs.length };
    }
    return baseline;
  }

  async function getSites() {
    const { sites = [] } = await get(["sites"]);
    return sites;
  }

  async function saveSites(sites) {
    await set({ sites });
    return sites;
  }

  async function addSite(domain) {
    const cleaned = normalizeDomain(domain);
    if (!cleaned) throw new Error("域名无效");
    const sites = await getSites();
    if (sites.some((s) => s.domain === cleaned)) {
      throw new Error("该站点已在监控列表中");
    }
    if (sites.length >= 20) {
      throw new Error("最多监控 20 个站点");
    }
    const site = {
      id: crypto.randomUUID(),
      domain: cleaned,
      addedAt: Date.now(),
      selectedSitemaps: [],
      lastCheckedAt: null,
      newCount: 0,
      status: "idle",
      error: null,
    };
    sites.push(site);
    await saveSites(sites);
    return site;
  }

  async function updateSite(id, patch) {
    const sites = await getSites();
    const i = sites.findIndex((s) => s.id === id);
    if (i < 0) throw new Error("站点不存在");
    sites[i] = { ...sites[i], ...patch };
    await saveSites(sites);
    return sites[i];
  }

  async function removeSite(id) {
    await ensureMigrated();
    const sites = (await getSites()).filter((s) => s.id !== id);
    await saveSites(sites);
    if (typeof SitemapIDB !== "undefined") {
      await SitemapIDB.remove("baselines", id);
      await SitemapIDB.remove("newUrls", id);
      await SitemapIDB.remove("snapshots", id);
    }
    const counts = await getNewUrlCounts();
    delete counts[id];
    await set({ newUrlCounts: counts });
  }

  async function getBaselines() {
    await ensureMigrated();
    const baselines =
      typeof SitemapIDB !== "undefined"
        ? await SitemapIDB.getAllMap("baselines")
        : {};
    const out = {};
    for (const [id, b] of Object.entries(baselines)) {
      out[id] = baselineToUrlMap(b) || b;
    }
    return out;
  }

  async function setBaseline(siteId, urlMap) {
    await ensureMigrated();
    const compact = compactBaselineMap(urlMap);
    if (typeof SitemapIDB !== "undefined") {
      await SitemapIDB.put("baselines", siteId, compact);
    }
  }

  async function getCandidates() {
    const { candidates = [] } = await get(["candidates"]);
    return candidates;
  }

  async function addCandidates(items) {
    const list = await getCandidates();
    const seen = new Set(list.map((c) => c.term.toLowerCase()));
    for (const item of items) {
      const key = item.term.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.unshift({
          id: crypto.randomUUID(),
          term: item.term,
          sourceUrl: item.sourceUrl || "",
          sourceDomain: item.sourceDomain || "",
          createdAt: Date.now(),
        });
      }
    }
    await set({ candidates: list.slice(0, 500) });
    return list;
  }

  async function removeCandidate(id) {
    const list = (await getCandidates()).filter((c) => c.id !== id);
    await set({ candidates: list });
  }

  /** Delete many candidates in one read/write. Unknown ids are ignored. */
  async function removeCandidates(ids) {
    const drop = new Set((ids || []).map((id) => String(id)));
    const list = (await getCandidates()).filter((c) => !drop.has(c.id));
    await set({ candidates: list });
    return list;
  }

  async function clearCandidates() {
    await set({ candidates: [] });
  }

  async function getWatchlist() {
    const { watchlist = [] } = await get(["watchlist"]);
    return watchlist;
  }

  async function addToWatchlist(term, note = "") {
    const list = await getWatchlist();
    if (list.some((w) => w.term.toLowerCase() === term.toLowerCase())) {
      throw new Error("已在观察清单中");
    }
    list.unshift({
      id: crypto.randomUUID(),
      term,
      note,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await set({ watchlist: list });
    return list[0];
  }

  /**
   * Add many terms to the watchlist.
   * Skips blanks and terms already present (case-insensitive). Does not throw on duplicates.
   * @param {{term: string, note?: string}[]} items
   * @returns {Promise<{added: number, skipped: number}>}
   */
  async function addManyToWatchlist(items) {
    const list = await getWatchlist();
    const seen = new Set(list.map((w) => String(w.term || "").toLowerCase()));
    const fresh = [];
    let skipped = 0;
    for (const item of items || []) {
      const term = String(item?.term || "").trim();
      if (!term) {
        skipped++;
        continue;
      }
      const key = term.toLowerCase();
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      fresh.push({
        id: crypto.randomUUID(),
        term,
        note: item?.note || "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    if (fresh.length) {
      await set({ watchlist: fresh.concat(list) });
    }
    return { added: fresh.length, skipped };
  }

  async function updateWatchlistItem(id, patch) {
    const list = await getWatchlist();
    const i = list.findIndex((w) => w.id === id);
    if (i < 0) throw new Error("条目不存在");
    list[i] = { ...list[i], ...patch, updatedAt: Date.now() };
    await set({ watchlist: list });
    return list[i];
  }

  async function removeWatchlistItem(id) {
    const list = (await getWatchlist()).filter((w) => w.id !== id);
    await set({ watchlist: list });
  }

  async function getSettings() {
    const { settings } = await get(["settings"]);
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  async function saveSettings(patch) {
    const cur = await getSettings();
    const next = { ...cur, ...patch };
    await set({ settings: next });
    return next;
  }

  async function getNewUrlCounts() {
    const { newUrlCounts = {} } = await get(["newUrlCounts"]);
    return newUrlCounts;
  }

  async function setNewUrls(siteId, urls, { cap = MAX_NEW_URL_ROWS } = {}) {
    await ensureMigrated();
    const trimmed = trimUrlRows(urls, cap).map((u) => ({
      loc: u.loc,
      lastmod: u.lastmod || null,
      ...(u.isBaseline ? { isBaseline: true } : {}),
    }));
    if (typeof SitemapIDB !== "undefined") {
      await SitemapIDB.put("newUrls", siteId, trimmed);
    }
    const newUrlCounts = await getNewUrlCounts();
    newUrlCounts[siteId] = trimmed.length;
    await set({ newUrlCounts });
    return { stored: trimmed.length, total: (urls || []).length };
  }

  async function getNewUrls(siteId) {
    await ensureMigrated();
    if (typeof SitemapIDB === "undefined") return siteId ? [] : {};
    if (siteId) {
      const v = await SitemapIDB.get("newUrls", siteId);
      return v || [];
    }
    return SitemapIDB.getAllMap("newUrls");
  }

  async function setSnapshot(siteId, urls) {
    await ensureMigrated();
    const trimmed = trimUrlRows(urls, MAX_SNAPSHOT_ROWS);
    const snap = {
      urls: trimmed.map((u) => ({ loc: u.loc, lastmod: u.lastmod || null })),
      updatedAt: Date.now(),
      total: (urls || []).length,
    };
    if (typeof SitemapIDB !== "undefined") {
      await SitemapIDB.put("snapshots", siteId, snap);
    }
  }

  async function getSnapshot(siteId) {
    await ensureMigrated();
    if (typeof SitemapIDB === "undefined") return siteId ? null : {};
    if (siteId) {
      const v = await SitemapIDB.get("snapshots", siteId);
      return v || null;
    }
    return SitemapIDB.getAllMap("snapshots");
  }

  async function clearNewUrls(siteId) {
    await ensureMigrated();
    if (typeof SitemapIDB !== "undefined") {
      if (siteId) {
        await SitemapIDB.put("newUrls", siteId, []);
      } else {
        await SitemapIDB.clearStore("newUrls");
      }
    }
    const counts = await getNewUrlCounts();
    if (siteId) counts[siteId] = 0;
    else for (const k of Object.keys(counts)) counts[k] = 0;
    await set({ newUrlCounts: counts });
  }

  async function totalNewCount() {
    const counts = await getNewUrlCounts();
    return Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  }

  async function exportAll() {
    await ensureMigrated();
    const light = await get([
      "sites",
      "candidates",
      "watchlist",
      "settings",
      "newUrlCounts",
    ]);
    const baselines =
      typeof SitemapIDB !== "undefined" ? await SitemapIDB.getAllMap("baselines") : {};
    const newUrls =
      typeof SitemapIDB !== "undefined" ? await SitemapIDB.getAllMap("newUrls") : {};
    const snapshots =
      typeof SitemapIDB !== "undefined" ? await SitemapIDB.getAllMap("snapshots") : {};
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      ...light,
      baselines,
      newUrls,
      snapshots,
    };
  }

  async function importAll(payload, { merge = true } = {}) {
    await ensureMigrated();
    if (!payload || typeof payload !== "object") {
      throw new Error("无效的导入数据");
    }
    if (!merge) {
      await chrome.storage.local.clear();
      if (typeof SitemapIDB !== "undefined") await SitemapIDB.clearAll();
      await set({
        sites: payload.sites || [],
        candidates: payload.candidates || [],
        watchlist: payload.watchlist || [],
        settings: { ...DEFAULT_SETTINGS, ...(payload.settings || {}) },
        newUrlCounts: payload.newUrlCounts || {},
        idbMigrated: true,
      });
      if (typeof SitemapIDB !== "undefined") {
        await SitemapIDB.putMap("baselines", payload.baselines || {});
        await SitemapIDB.putMap("newUrls", payload.newUrls || {});
        await SitemapIDB.putMap("snapshots", payload.snapshots || {});
      }
      return;
    }
    const sites = await getSites();
    const byDomain = new Map(sites.map((s) => [s.domain, s]));
    for (const s of payload.sites || []) {
      if (!byDomain.has(s.domain)) {
        byDomain.set(s.domain, s);
      }
    }
    await saveSites([...byDomain.values()].slice(0, 20));

    if (payload.baselines && typeof SitemapIDB !== "undefined") {
      const cur = await SitemapIDB.getAllMap("baselines");
      Object.assign(cur, payload.baselines);
      await SitemapIDB.putMap("baselines", cur);
    }
    if (payload.newUrls && typeof SitemapIDB !== "undefined") {
      const cur = await SitemapIDB.getAllMap("newUrls");
      Object.assign(cur, payload.newUrls);
      await SitemapIDB.putMap("newUrls", cur);
    }
    if (payload.snapshots && typeof SitemapIDB !== "undefined") {
      const cur = await SitemapIDB.getAllMap("snapshots");
      Object.assign(cur, payload.snapshots);
      await SitemapIDB.putMap("snapshots", cur);
    }
    if (payload.newUrlCounts) {
      const counts = await getNewUrlCounts();
      Object.assign(counts, payload.newUrlCounts);
      await set({ newUrlCounts: counts });
    }

    if (payload.candidates?.length) await addCandidates(payload.candidates);
    if (payload.watchlist?.length) {
      const wl = await getWatchlist();
      const seen = new Set(wl.map((w) => w.term.toLowerCase()));
      for (const w of payload.watchlist) {
        if (!seen.has(w.term.toLowerCase())) {
          wl.push(w);
          seen.add(w.term.toLowerCase());
        }
      }
      await set({ watchlist: wl });
    }
    if (payload.settings) await saveSettings(payload.settings);
  }

  async function seedPresets(presets) {
    const list = Array.isArray(presets) ? presets : [];
    const sites = await getSites();
    const existing = new Set(sites.map((s) => s.domain));
    const added = [];
    const skipped = [];
    let capped = false;
    for (const p of list) {
      const cleaned = normalizeDomain(p.domain || p);
      if (!cleaned) continue;
      if (existing.has(cleaned)) {
        skipped.push(cleaned);
        continue;
      }
      if (sites.length >= 20) {
        capped = true;
        break;
      }
      const site = {
        id: crypto.randomUUID(),
        domain: cleaned,
        label: p.label || "",
        group: p.group || "",
        builtin: true,
        addedAt: Date.now(),
        selectedSitemaps: [],
        lastCheckedAt: null,
        newCount: 0,
        status: "idle",
        error: null,
      };
      sites.push(site);
      existing.add(cleaned);
      added.push(cleaned);
    }
    if (added.length) await saveSites(sites);
    return { added, skipped, capped };
  }

  function normalizeDomain(input) {
    if (!input) return "";
    let s = String(input).trim().toLowerCase();
    s = s.replace(/^https?:\/\//, "");
    s = s.replace(/\/.*$/, "");
    s = s.replace(/:\d+$/, "");
    s = s.replace(/^www\./, "");
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(s) || !s.includes(".")) {
      return "";
    }
    return s;
  }

  function formatBytes(n) {
    const x = Number(n) || 0;
    if (x < 1024) return x + " B";
    if (x < 1024 * 1024) return (x / 1024).toFixed(1) + " KB";
    return (x / (1024 * 1024)).toFixed(2) + " MB";
  }

  async function getStorageUsage() {
    await ensureMigrated();
    let chromeBytes = 0;
    try {
      if (chrome.storage?.local?.getBytesInUse) {
        chromeBytes = await chrome.storage.local.getBytesInUse(null);
      }
    } catch (_) {}
    let idbBytes = 0;
    try {
      if (typeof SitemapIDB !== "undefined") {
        idbBytes = await SitemapIDB.estimateBytes();
      }
    } catch (_) {}
    let estimate = null;
    try {
      if (navigator?.storage?.estimate) {
        estimate = await navigator.storage.estimate();
      }
    } catch (_) {}
    return {
      chromeBytes,
      idbBytes,
      estimate,
      chromeLabel: formatBytes(chromeBytes),
      idbLabel: formatBytes(idbBytes),
    };
  }

  return {
    DEFAULT_SETTINGS,
    MAX_NEW_URL_ROWS,
    MAX_SNAPSHOT_ROWS,
    MAX_BASELINE_URLS,
    get,
    set,
    purgeHeavyData,
    isQuotaError,
    ensureMigrated,
    getSites,
    saveSites,
    addSite,
    updateSite,
    removeSite,
    getBaselines,
    setBaseline,
    getCandidates,
    addCandidates,
    removeCandidate,
    removeCandidates,
    clearCandidates,
    getWatchlist,
    addToWatchlist,
    addManyToWatchlist,
    updateWatchlistItem,
    removeWatchlistItem,
    getSettings,
    saveSettings,
    getNewUrlCounts,
    setNewUrls,
    getNewUrls,
    clearNewUrls,
    setSnapshot,
    getSnapshot,
    totalNewCount,
    exportAll,
    importAll,
    seedPresets,
    normalizeDomain,
    getStorageUsage,
    formatBytes,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.Storage = Storage;
}
