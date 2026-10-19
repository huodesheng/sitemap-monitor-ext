/**
 * Service worker: alarms, badge, messaging
 * Heavy DOMParser work prefers dashboard; here we use regex parse via Sitemap lib.
 */

importScripts("lib/idb.js", "lib/storage.js", "lib/sitemap.js", "lib/keywords.js");

const ALARM_NAME = "sitemap-daily-check";

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await refreshBadge();
});

async function ensureAlarm() {
  const settings = await Storage.getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  if (!settings.alarmEnabled) return;
  // daily around configured hour (local)
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: 24 * 60,
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await runScheduledChecks();
});

async function runScheduledChecks() {
  const sites = await Storage.getSites();
  const baselines = await Storage.getBaselines();
  for (const site of sites) {
    if (!site.selectedSitemaps?.length) continue;
    try {
      const total = site.selectedSitemaps.length;
      let lastWrite = 0;
      await Storage.updateSite(site.id, {
        status: "checking",
        error: null,
        syncCurrent: 0,
        syncTotal: total,
      });
      const result = await Sitemap.checkSite(site, baselines[site.id], {
        onProgress: ({ current, total: t }) => {
          const now = Date.now();
          if (now - lastWrite > 2000 || current === t) {
            lastWrite = now;
            Storage.updateSite(site.id, {
              status: "checking",
              syncCurrent: current,
              syncTotal: t,
            }).catch(() => {});
          }
        },
      });
      if (result.isBaseline) {
        await Storage.setBaseline(site.id, result.urlMap);
        await Storage.setNewUrls(site.id, []);
        await Storage.updateSite(site.id, {
          status: "ok",
          lastCheckedAt: Date.now(),
          newCount: 0,
          error: null,
          syncCurrent: null,
          syncTotal: null,
        });
      } else {
        const merged = { ...(baselines[site.id]?.urls || {}), ...result.urlMap };
        await Storage.setBaseline(site.id, merged);
        await Storage.setNewUrls(site.id, result.newUrls);
        if (result.newUrls.length) {
          const terms = Keywords.extractFromUrls(result.newUrls, {
            sourceDomain: site.domain,
          });
          await Storage.addCandidates(terms);
        }
        await Storage.updateSite(site.id, {
          status: "ok",
          lastCheckedAt: Date.now(),
          newCount: result.newUrls.length,
          error: result.fetchErrors?.length
            ? result.fetchErrors.slice(0, 2).join("; ")
            : null,
          syncCurrent: null,
          syncTotal: null,
        });
      }
    } catch (e) {
      await Storage.updateSite(site.id, {
        status: "error",
        error: String(e.message || e),
        lastCheckedAt: Date.now(),
        syncCurrent: null,
        syncTotal: null,
      });
    }
  }
  await refreshBadge();
}

async function refreshBadge() {
  const total = await Storage.totalNewCount();
  if (total > 0) {
    await chrome.action.setBadgeText({ text: total > 99 ? "99+" : String(total) });
    await chrome.action.setBadgeBackgroundColor({ color: "#0d9488" });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then((r) => sendResponse({ ok: true, data: r }))
    .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});

async function handleMessage(msg) {
  switch (msg?.type) {
    case "REFRESH_BADGE":
      await refreshBadge();
      return { total: await Storage.totalNewCount() };
    case "ENSURE_ALARM":
      await ensureAlarm();
      return true;
    case "RUN_CHECKS_NOW":
      await runScheduledChecks();
      return { total: await Storage.totalNewCount() };
    case "OPEN_DASHBOARD": {
      const url = chrome.runtime.getURL("dashboard.html") + (msg.hash || "");
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("dashboard.html") + "*" });
      if (tabs[0]?.id) {
        await chrome.tabs.update(tabs[0].id, { active: true, url });
        if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url });
      }
      return true;
    }
    default:
      throw new Error("未知消息类型: " + msg?.type);
  }
}

// storage change → badge
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.newUrlCounts || changes.newUrls) {
    refreshBadge();
  }
});
