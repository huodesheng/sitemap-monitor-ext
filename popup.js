async function load() {
  const sites = await Storage.getSites();
  const totalNew = await Storage.totalNewCount();
  const candidates = await Storage.getCandidates();

  document.getElementById("siteCount").textContent = sites.length;
  document.getElementById("newCount").textContent = totalNew;
  document.getElementById("candCount").textContent = candidates.length;

  const list = document.getElementById("siteList");
  const empty = document.getElementById("empty");
  list.innerHTML = "";

  if (!sites.length) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    for (const s of sites.slice().reverse()) {
      const li = document.createElement("li");
      const left = document.createElement("div");
      left.innerHTML = `<div class="domain">${escapeHtml(s.domain)}</div>
        <div class="meta">${statusText(s)}</div>`;
      const badge = document.createElement("span");
      badge.className = "badge" + (s.newCount ? "" : " zero");
      badge.textContent = s.newCount || 0;
      li.appendChild(left);
      li.appendChild(badge);
      li.style.cursor = "pointer";
      li.title = "在控制台中查看";
      li.addEventListener("click", () => openDash("#site=" + encodeURIComponent(s.id)));
      list.appendChild(li);
    }
  }
}

function statusText(s) {
  if (s.status === "error") return "错误: " + (s.error || "");
  if (s.status === "checking") {
    if (s.syncTotal) return `同步中 ${s.syncCurrent || 0}/${s.syncTotal}`;
    return "同步中…";
  }
  if (!s.selectedSitemaps?.length) return "待选择 Sitemap";
  if (s.lastCheckedAt) {
    return "上次: " + formatTime(s.lastCheckedAt);
  }
  return "未检查";
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "";
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showMsg(text, ok) {
  const el = document.getElementById("addMsg");
  el.hidden = !text;
  el.textContent = text || "";
  el.className = "hint " + (ok ? "ok" : "err");
}

async function openDash(hash = "") {
  try {
    await chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD", hash });
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") + hash });
  }
  window.close();
}

document.getElementById("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("domainInput");
  const raw = input.value.trim();
  if (!raw) return;
  try {
    await Storage.addSite(raw);
    input.value = "";
    showMsg("已添加，请在控制台中发现 Sitemap", true);
    await load();
  } catch (err) {
    showMsg(err.message || String(err), false);
  }
});

document.getElementById("openDash").addEventListener("click", () => openDash());

load();
