/**
 * Dashboard — main UI for Sitemap 盯同行
 */

let discoverSiteId = null;
/** @type {Map<string,{current:number,total:number,url:string,phase:string,startedAt:number}>} */
const syncState = new Map();
let syncStorageTick = 0;
let discoverChildren = [];

function $(id) {
  return document.getElementById(id);
}

function toast(msg, isErr = false) {
  const el = $("toast");
  el.hidden = false;
  el.textContent = msg;
  el.className = "toast" + (isErr ? " err" : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "—";
  }
}

/* ---------- tabs ---------- */
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    $("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "newurls") renderNewUrls();
    if (btn.dataset.tab === "candidates") renderCandidates();
    if (btn.dataset.tab === "watchlist") renderWatchlist();
    if (btn.dataset.tab === "settings") loadSettingsForm();
  });
});

/* ---------- sites ---------- */
async function renderSites(highlightId) {
  const sites = await Storage.getSites();
  const box = $("sitesContainer");
  const empty = $("sitesEmpty");
  box.innerHTML = "";
  if (!sites.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const s of sites.slice().reverse()) {
    const card = document.createElement("div");
    const syncing = s.status === "checking" || syncState.has(s.id);
    card.className =
      "site-card" +
      (highlightId === s.id ? " highlight" : "") +
      (syncing ? " syncing" : "");
    card.dataset.id = s.id;
    const selCount = s.selectedSitemaps?.length || 0;
    const st = syncState.get(s.id) || null;
    const pct =
      st && st.total
        ? Math.min(100, Math.round((st.current / st.total) * 100))
        : syncing
          ? 0
          : 0;
    const syncLabel = st
      ? `同步中 ${st.current}/${st.total}（${pct}%）`
      : syncing
        ? "同步中…"
        : "";
    card.innerHTML = `
      <div>
        <h3>${escapeHtml(s.domain)}${s.label ? ` <span class="muted" style="font-weight:500;font-size:13px">· ${escapeHtml(s.label)}</span>` : ""}</h3>
        <div class="site-meta">
          ${s.group ? `<span class="pill">${escapeHtml(s.group)}</span>` : ""}
          <span class="pill ${s.newCount ? "new" : ""}">新 URL ${s.newCount || 0}</span>
          <span class="pill">基线 ${s.baselineCount || 0}</span>
          <span class="pill">已选 Sitemap ${selCount}</span>
          <span class="pill">上次检查 ${formatTime(s.lastCheckedAt)}</span>
          ${
            s.status === "error"
              ? `<span class="pill err">错误: ${escapeHtml(s.error || "")}</span>`
              : syncing
                ? `<span class="pill sync">${escapeHtml(syncLabel || "同步中…")}</span>`
                : ""
          }
        </div>
        <div class="progress${syncing ? " active" : ""}" id="prog-${s.id}" data-site="${s.id}">
          <div class="progress-head">
            <span class="progress-label">${escapeHtml(syncLabel || "准备同步…")}</span>
            <span class="progress-pct">${st && st.total ? pct + "%" : ""}</span>
          </div>
          <div class="progress-url">${escapeHtml(st?.url ? shortUrl(st.url) : "")}</div>
          <div class="progress-bar"><i style="width:${pct}%"></i></div>
        </div>
      </div>
      <div class="site-actions">
        <button type="button" class="btn sm" data-act="discover" ${syncing ? "disabled" : ""}>发现 Sitemap</button>
        <button type="button" class="btn sm primary" data-act="check" ${!selCount || syncing ? "disabled" : ""}>${syncing ? "同步中…" : "检查更新"}</button>
        <button type="button" class="btn sm" data-act="viewnew" ${s.newCount ? "" : "disabled"}>查看新 URL</button>
        <button type="button" class="btn sm danger" data-act="remove" ${syncing ? "disabled" : ""}>删除</button>
      </div>
    `;
    card.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => onSiteAction(s.id, btn.dataset.act));
    });
    box.appendChild(card);
  }
}

function shortUrl(u) {
  try {
    const x = String(u);
    if (x.length <= 72) return x;
    return x.slice(0, 34) + "…" + x.slice(-28);
  } catch {
    return String(u || "");
  }
}

/** Patch only the progress block — avoid full list redraw mid-sync */
function paintSiteProgress(siteId) {
  const st = syncState.get(siteId);
  const card = document.querySelector(`.site-card[data-id="${CSS.escape(siteId)}"]`);
  const root = $(`prog-${siteId}`);
  if (!root) return;
  if (!st) {
    root.classList.remove("active");
    return;
  }
  root.classList.add("active");
  const pct = st.total ? Math.min(100, Math.round((st.current / st.total) * 100)) : 0;
  const label = st.phase === "done"
    ? "同步完成，正在写入…"
    : st.total
      ? `同步中 ${st.current}/${st.total}（${pct}%）`
      : "同步中…";
  const head = root.querySelector(".progress-label");
  const pctEl = root.querySelector(".progress-pct");
  const urlEl = root.querySelector(".progress-url");
  const bar = root.querySelector(".progress-bar > i");
  if (head) head.textContent = label;
  if (pctEl) pctEl.textContent = st.total ? pct + "%" : "";
  if (urlEl) urlEl.textContent = st.url ? shortUrl(st.url) : "";
  if (bar) bar.style.width = pct + "%";
  const pill = card?.querySelector(".pill.sync");
  if (pill) pill.textContent = label;
  card?.classList.add("syncing");
}

async function onSiteAction(siteId, act) {
  const sites = await Storage.getSites();
  const site = sites.find((s) => s.id === siteId);
  if (!site) return;

  if (act === "remove") {
    if (!confirm(`确定删除 ${site.domain} 及其基线数据？`)) return;
    await Storage.removeSite(siteId);
    await chrome.runtime.sendMessage({ type: "REFRESH_BADGE" }).catch(() => {});
    toast("已删除");
    await renderSites();
    return;
  }
  if (act === "discover") {
    await openDiscover(site);
    return;
  }
  if (act === "check") {
    await checkOneSite(site);
    return;
  }
  if (act === "viewnew") {
    document.querySelector('.nav-item[data-tab="newurls"]').click();
    $("newUrlSiteFilter").value = siteId;
    await renderNewUrls();
  }
}

async function checkOneSite(site) {
  if (syncState.has(site.id)) {
    toast("该站点正在同步中", true);
    return;
  }
  const totalSel = site.selectedSitemaps?.length || 0;
  syncState.set(site.id, {
    current: 0,
    total: totalSel,
    url: "",
    phase: "fetch",
    startedAt: Date.now(),
  });
  await Storage.updateSite(site.id, {
    status: "checking",
    error: null,
    syncCurrent: 0,
    syncTotal: totalSel,
  });
  // One render to show the progress UI; then only patch progress in place
  await renderSites(site.id);
  paintSiteProgress(site.id);
  toast(totalSel > 1 ? `开始同步 ${site.domain}（${totalSel} 个 Sitemap）…` : `开始同步 ${site.domain}…`);

  try {
    const baselines = await Storage.getBaselines();
    const result = await Sitemap.checkSite(site, baselines[site.id], {
      onProgress: ({ current, total, url }) => {
        syncState.set(site.id, {
          current,
          total,
          url: url || "",
          phase: "fetch",
          startedAt: syncState.get(site.id)?.startedAt || Date.now(),
        });
        paintSiteProgress(site.id);
        // Throttle storage writes so popup can show progress without jank
        const now = Date.now();
        if (now - syncStorageTick > 1500 || current === total) {
          syncStorageTick = now;
          Storage.updateSite(site.id, {
            status: "checking",
            syncCurrent: current,
            syncTotal: total,
          }).catch(() => {});
        }
      },
    });
    const fin = syncState.get(site.id);
    if (fin) {
      syncState.set(site.id, { ...fin, phase: "done", current: fin.total || fin.current, url: "" });
      paintSiteProgress(site.id);
    }

    // Snapshot + list are capped; baseline keeps membership set (compact)
    const snapshot = Object.entries(result.urlMap).map(([loc, lastmod]) => ({ loc, lastmod }));
    await Storage.setSnapshot(site.id, snapshot);

    if (result.isBaseline) {
      await Storage.setBaseline(site.id, result.urlMap);
      // First run: show a capped sample in URL list (not all, avoids quota blowups)
      const baselineRows = snapshot.map((u) => ({ ...u, isBaseline: true }));
      const saved = await Storage.setNewUrls(site.id, baselineRows);
      const counts = await Storage.getNewUrlCounts();
      counts[site.id] = 0;
      await chrome.storage.local.set({ newUrlCounts: counts });
      await Storage.updateSite(site.id, {
        status: "ok",
        lastCheckedAt: Date.now(),
        newCount: 0,
        baselineCount: result.total,
        error: result.fetchErrors?.length ? result.fetchErrors.slice(0, 2).join("; ") : null,
        baselineReady: true,
        syncCurrent: null,
        syncTotal: null,
      });
      const shown = saved?.stored ?? baselineRows.length;
      toast(
        shown < result.total
          ? `已建立基线 ${result.total} 条；列表展示最新 ${shown} 条（避免占满存储）`
          : `已建立基线并导入 ${result.total} 条 URL（下次检查只标真正新增）`
      );
      // Jump to URL tab
      document.querySelector('.nav-item[data-tab="newurls"]')?.click();
      const filter = $("newUrlSiteFilter");
      if (filter) filter.value = site.id;
      await renderNewUrls();
    } else {
      const merged = { ...(baselines[site.id]?.urls || {}), ...result.urlMap };
      await Storage.setBaseline(site.id, merged);
      await Storage.setNewUrls(site.id, result.newUrls);
      if (result.newUrls.length) {
        const terms = Keywords.extractFromUrls(result.newUrls, { sourceDomain: site.domain });
        await Storage.addCandidates(terms);
      }
      await Storage.updateSite(site.id, {
        status: "ok",
        lastCheckedAt: Date.now(),
        newCount: result.newUrls.length,
        error: result.fetchErrors?.length ? result.fetchErrors.slice(0, 2).join("; ") : null,
        syncCurrent: null,
        syncTotal: null,
      });
      toast(
        result.newUrls.length
          ? `发现 ${result.newUrls.length} 条新 URL（总计 ${result.total}）`
          : `无新增（总计 ${result.total}）`
      );
      if (result.newUrls.length) {
        document.querySelector('.nav-item[data-tab="newurls"]')?.click();
        const filter = $("newUrlSiteFilter");
        if (filter) filter.value = site.id;
        await renderNewUrls();
      }
    }
    await chrome.runtime.sendMessage({ type: "REFRESH_BADGE" }).catch(() => {});
  } catch (e) {
    const msg = String(e.message || e);
    await Storage.updateSite(site.id, {
      status: "error",
      error: msg,
      lastCheckedAt: Date.now(),
      syncCurrent: null,
      syncTotal: null,
    });
    if (Storage.isQuotaError?.(e) || /quota/i.test(msg)) {
      toast("存储配额不足：大数据已改存 IndexedDB，请到「设置」点清理缓存或少选 Sitemap 后重试", true);
    } else {
      toast(msg, true);
    }
  } finally {
    syncState.delete(site.id);
  }
  await renderSites(site.id);
}

$("dashAddForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("dashDomain");
  const msg = $("dashAddMsg");
  try {
    const site = await Storage.addSite(input.value.trim());
    input.value = "";
    msg.hidden = false;
    msg.className = "msg ok";
    msg.textContent = `已添加 ${site.domain}，请点击「发现 Sitemap」`;
    await renderSites(site.id);
  } catch (err) {
    msg.hidden = false;
    msg.className = "msg err";
    msg.textContent = err.message || String(err);
  }
});


async function seedBuiltinPresets() {
  const msg = $("dashAddMsg");
  try {
    const result = await Storage.seedPresets(Presets.list());
    const parts = [];
    if (result.added.length) parts.push(`新增 ${result.added.length} 个：${result.added.join(", ")}`);
    if (result.skipped.length) parts.push(`已存在 ${result.skipped.length} 个，已跳过`);
    if (result.capped) parts.push("已达 20 站上限，其余未加入");
    if (!result.added.length && !result.skipped.length) parts.push("没有可加入的预设");
    if (msg) {
      msg.hidden = false;
      msg.className = "msg ok";
      msg.textContent = parts.join(" · ") + (result.added.length ? "。请逐个点「发现 Sitemap」" : "");
    }
    toast(parts[0] || "完成");
    await renderSites();
  } catch (err) {
    if (msg) {
      msg.hidden = false;
      msg.className = "msg err";
      msg.textContent = err.message || String(err);
    }
    toast(err.message || String(err), true);
  }
}

$("btnSeedPresets")?.addEventListener("click", seedBuiltinPresets);
$("btnSeedPresetsEmpty")?.addEventListener("click", seedBuiltinPresets);

$("btnCheckAll").addEventListener("click", async () => {
  const sites = await Storage.getSites();
  const ready = sites.filter((s) => s.selectedSitemaps?.length);
  if (!ready.length) {
    toast("没有已配置 Sitemap 的站点", true);
    return;
  }
  toast(`开始检查 ${ready.length} 个站点…`);
  for (const s of ready) {
    await checkOneSite(s);
  }
});

/* ---------- discover modal ---------- */
async function openDiscover(site) {
  discoverSiteId = site.id;
  discoverChildren = [];
  const modal = $("discoverModal");
  modal.hidden = false;
  $("discoverTitle").textContent = `发现 Sitemap · ${site.domain}`;
  $("discoverBody").innerHTML = `<p class="muted">正在读取 robots.txt 与常见 Sitemap 路径…</p>`;
  $("btnSaveSelection").disabled = true;

  try {
    const disc = await Sitemap.discover(site.domain);
    if (!disc.sitemaps.length) {
      $("discoverBody").innerHTML = `
        <p class="msg err">未找到 Sitemap。</p>
        <p class="muted">尝试过 robots.txt 与 ${Sitemap.FALLBACKS.join(", ")}</p>
        <pre style="white-space:pre-wrap;font-size:11px;color:var(--muted);margin-top:8px">${escapeHtml(
          (disc.errors || []).join("\n")
        )}</pre>
        <p style="margin-top:12px">也可手动粘贴 Sitemap URL：</p>
        <div class="row" style="margin-top:6px">
          <input type="text" id="manualSitemap" placeholder="https://example.com/sitemap.xml" />
          <button type="button" class="btn" id="btnManualLoad">加载</button>
        </div>
      `;
      $("btnManualLoad")?.addEventListener("click", async () => {
        const u = $("manualSitemap").value.trim();
        if (!u) return;
        await loadSitemapRoots([u], site);
      });
      return;
    }

    await loadSitemapRoots(disc.sitemaps, site, disc.source);
  } catch (e) {
    $("discoverBody").innerHTML = `<p class="msg err">${escapeHtml(e.message || e)}</p>`;
  }
}

async function loadSitemapRoots(urls, site, source) {
  $("discoverBody").innerHTML = `<p class="muted">来源: ${escapeHtml(
    source || "手动"
  )} · 解析中…</p>`;

  const children = [];
  const notes = [];

  for (const url of urls) {
    try {
      const parsed = await Sitemap.fetchAndParse(url, { expandIndex: true });
      if (parsed.type === "index") {
        notes.push(`索引 ${url} → ${parsed.entries.length} 个子图`);
        for (const e of parsed.entries) {
          children.push(e);
        }
      } else if (parsed.type === "urlset") {
        // treat root urlset as selectable itself
        const cls = Sitemap.classifySitemapUrl(url);
        children.push({
          loc: url,
          lastmod: null,
          ...cls,
          _urlCount: parsed.entries.length,
        });
        notes.push(`URL 集 ${url} → ${parsed.entries.length} 条`);
      } else {
        notes.push(`${url}: 无法识别类型`);
      }
    } catch (e) {
      notes.push(`${url}: ${e.message || e}`);
    }
  }

  // sort: prefer / score first, then lastmod
  children.sort((a, b) => {
    const ds = (b.score || 0) - (a.score || 0);
    if (ds) return ds;
    if (a.lastmod && b.lastmod) return a.lastmod < b.lastmod ? 1 : -1;
    if (a.lastmod) return -1;
    if (b.lastmod) return 1;
    return 0;
  });
  discoverChildren = children;

  const selectedSet = new Set(site.selectedSitemaps || []);
  const auto = !selectedSet.size;
  const maxAuto = Sitemap.MAX_AUTO_SELECT || 30;
  // Cap auto-check: never select thousands of shards (e.g. lobehub ~4000)
  const autoLocs = new Set();
  if (auto) {
    const strong = children.filter((c) => c.strong && !c.skip);
    const soft = children.filter((c) => c.soft && !c.skip);
    const otherOk = children.filter((c) => !c.skip && !c.strong && !c.soft);
    const pick = [];
    for (const c of strong) {
      if (pick.length >= maxAuto) break;
      pick.push(c);
    }
    for (const c of soft) {
      if (pick.length >= maxAuto) break;
      pick.push(c);
    }
    // small indexes: fill with remaining non-skip
    if (children.length <= maxAuto) {
      for (const c of otherOk) {
        if (pick.length >= maxAuto) break;
        if (!pick.includes(c)) pick.push(c);
      }
    }
    for (const c of pick) autoLocs.add(c.loc);
  }

  let html = `<p class="muted">${escapeHtml(notes.join(" · "))}</p>`;
  if (children.length > maxAuto) {
    html += `<p class="msg ok" style="margin:8px 0">子图较多（${children.length}）。已自动勾选最多 ${maxAuto} 个推荐项，避免一次拉几千个卡住。需要盯 MCP/Skills 分片时可手动多选，但建议分批。</p>`;
  }
  html += `<p style="margin:10px 0 8px">请选择<strong>内容类</strong> Sitemap（推荐 blog / docs / page / mcp / skills；跳过 tag / category / icons）：</p>`;
  html += `<div class="row" style="margin-bottom:8px">
    <button type="button" class="btn sm" id="selPrefer">只选推荐(≤${maxAuto})</button>
    <button type="button" class="btn sm" id="selStrong">只要 blog/docs/page</button>
    <button type="button" class="btn sm" id="selAll">全选</button>
    <button type="button" class="btn sm" id="selNone">全不选</button>
  </div>`;
  html += `<ul class="sitemap-list">`;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    const autoCheck = auto && autoLocs.has(c.loc);
    const checked =
      selectedSet.has(c.loc) || autoCheck ? "checked" : "";
    const cls = c.skip ? "skip" : c.prefer ? "prefer" : "";
    html += `<li class="${cls}">
      <input type="checkbox" data-i="${i}" ${checked} />
      <div>
        <div class="loc">${escapeHtml(c.loc)}
          ${c.strong ? '<span class="tag">强推</span>' : c.prefer ? '<span class="tag">推荐</span>' : ""}
          ${c.skip ? '<span class="tag skip">建议跳过</span>' : ""}
          ${c._urlCount != null ? `<span class="tag">${c._urlCount} URLs</span>` : ""}
        </div>
        <div class="lm">lastmod: ${escapeHtml(c.lastmod || "—")}</div>
      </div>
    </li>`;
  }
  html += `</ul>`;
  if (!children.length) {
    html += `<p class="msg err">索引下没有子 Sitemap。</p>`;
  }
  $("discoverBody").innerHTML = html;
  $("btnSaveSelection").disabled = !children.length;

  function applyPick(pred) {
    let n = 0;
    $("discoverBody").querySelectorAll("input[type=checkbox]").forEach((cb) => {
      const c = children[+cb.dataset.i];
      const ok = pred(c, n);
      cb.checked = ok;
      if (ok) n++;
    });
  }

  $("selPrefer")?.addEventListener("click", () => {
    applyPick((c, n) => !!(c.prefer && !c.skip) && n < maxAuto);
  });
  $("selStrong")?.addEventListener("click", () => {
    applyPick((c) => !!(c.strong && !c.skip));
  });
  $("selAll")?.addEventListener("click", () => {
    if (children.length > (Sitemap.MAX_SELECT_WARN || 40)) {
      if (!confirm(`共 ${children.length} 个子图，全选会非常慢甚至卡住。确定全选？`)) return;
    }
    $("discoverBody").querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = true;
    });
  });
  $("selNone")?.addEventListener("click", () => {
    $("discoverBody").querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
    });
  });
}

$("btnSaveSelection").addEventListener("click", async () => {
  const checks = [...$("discoverBody").querySelectorAll("input[type=checkbox]:checked")];
  const selected = checks.map((cb) => discoverChildren[+cb.dataset.i].loc).filter(Boolean);
  if (!selected.length) {
    toast("请至少选择一个 Sitemap", true);
    return;
  }
  const warnAt = Sitemap.MAX_SELECT_WARN || 40;
  if (selected.length > warnAt) {
    if (
      !confirm(
        `已选 ${selected.length} 个子 Sitemap，拉取会较慢。建议先选 blog/docs/page 或不超过 ${warnAt} 个。仍要继续？`
      )
    ) {
      return;
    }
  }
  const siteId = discoverSiteId;
  await Storage.updateSite(siteId, { selectedSitemaps: selected });
  $("discoverModal").hidden = true;
  toast(`已保存 ${selected.length} 个 Sitemap，开始建立基线…`);

  const sites = await Storage.getSites();
  const site = sites.find((s) => s.id === siteId);
  if (site) await checkOneSite(site);
});

$("discoverModal").querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", () => {
    $("discoverModal").hidden = true;
  });
});

/* ---------- new urls ---------- */
async function fillNewUrlFilter() {
  const sites = await Storage.getSites();
  const sel = $("newUrlSiteFilter");
  const cur = sel.value;
  sel.innerHTML = `<option value="">全部站点</option>`;
  for (const s of sites) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.domain} (${s.newCount || 0})`;
    sel.appendChild(opt);
  }
  if (cur) sel.value = cur;
}

async function renderNewUrls() {
  await fillNewUrlFilter();
  const filter = $("newUrlSiteFilter").value;
  const sites = await Storage.getSites();
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  const allNew = await Storage.getNewUrls();
  const rows = [];
  for (const [siteId, list] of Object.entries(allNew)) {
    if (filter && siteId !== filter) continue;
    for (const u of list || []) {
      rows.push({ ...u, siteId, domain: byId[siteId]?.domain || siteId });
    }
  }
  const tbody = $("newUrlTable").querySelector("tbody");
  tbody.innerHTML = "";
  $("newUrlEmpty").hidden = rows.length > 0;
  if ($("newUrlHint")) {
    const hasBaseline = rows.some((r) => r.isBaseline);
    $("newUrlHint").hidden = !hasBaseline;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    const bl = r.isBaseline ? ' <span class="pill">基线</span>' : '';
    tr.innerHTML = `
      <td><a href="${escapeHtml(r.loc)}" target="_blank" rel="noopener">${escapeHtml(r.loc)}</a>${bl}</td>
      <td>${escapeHtml(r.lastmod || "—")}</td>
      <td>${escapeHtml(r.domain)}</td>
      <td><button type="button" class="btn sm" data-extract>提词</button></td>
    `;
    tr.querySelector("[data-extract]").addEventListener("click", async () => {
      const terms = Keywords.extractFromUrls([r], { sourceDomain: r.domain });
      await Storage.addCandidates(terms);
      toast(`已提取 ${terms.length} 个候选词`);
      renderCandidates();
    });
    tbody.appendChild(tr);
  }
}

$("newUrlSiteFilter").addEventListener("change", renderNewUrls);

$("btnClearNew").addEventListener("click", async () => {
  const filter = $("newUrlSiteFilter").value;
  if (!confirm(filter ? "清除该站点的新 URL 标记？" : "清除全部新 URL 标记？")) return;
  await Storage.clearNewUrls(filter || undefined);
  if (filter) {
    await Storage.updateSite(filter, { newCount: 0 });
  } else {
    const sites = await Storage.getSites();
    for (const s of sites) await Storage.updateSite(s.id, { newCount: 0 });
  }
  await chrome.runtime.sendMessage({ type: "REFRESH_BADGE" }).catch(() => {});
  toast("已清除");
  await renderSites();
  await renderNewUrls();
});

$("btnExtractFromNew").addEventListener("click", async () => {
  const filter = $("newUrlSiteFilter").value;
  const allNew = await Storage.getNewUrls();
  const sites = await Storage.getSites();
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  let total = 0;
  for (const [siteId, list] of Object.entries(allNew)) {
    if (filter && siteId !== filter) continue;
    if (!list?.length) continue;
    const terms = Keywords.extractFromUrls(list, { sourceDomain: byId[siteId]?.domain || "" });
    await Storage.addCandidates(terms);
    total += terms.length;
  }
  toast(total ? `已提取约 ${total} 条候选（已去重）` : "没有可提取的新 URL");
  document.querySelector('.nav-item[data-tab="candidates"]').click();
});

/* ---------- candidates ---------- */
/** @type {Set<string>} ids checked on the candidates tab */
const candSelected = new Set();

function updateCandSelectionUi() {
  const checks = [...document.querySelectorAll("#candList [data-cand-check]")];
  const n = checks.filter((cb) => cb.checked).length;
  const total = checks.length;
  const countEl = $("candSelectedCount");
  if (countEl) countEl.textContent = `已选 ${n} 条`;
  const all = $("candSelectAll");
  if (all) {
    if (n === 0 || total === 0) {
      all.checked = false;
      all.indeterminate = false;
    } else if (n === total) {
      all.checked = true;
      all.indeterminate = false;
    } else {
      all.checked = false;
      all.indeterminate = true;
    }
  }
  const bar = $("candToolbar");
  if (bar) bar.hidden = total === 0;
}

function resetCandSelection() {
  candSelected.clear();
}

async function renderCandidates() {
  const list = await Storage.getCandidates();
  const alive = new Set(list.map((c) => c.id));
  for (const id of candSelected) {
    if (!alive.has(id)) candSelected.delete(id);
  }
  const box = $("candList");
  box.innerHTML = "";
  $("candEmpty").hidden = list.length > 0;
  const bar = $("candToolbar");
  if (bar) bar.hidden = list.length === 0;
  for (const c of list) {
    const div = document.createElement("div");
    const on = candSelected.has(c.id);
    div.className = "chip" + (on ? " selected" : "");
    const idAttr = escapeHtml(c.id);
    div.innerHTML = `
      <input type="checkbox" data-cand-check value="${idAttr}" data-id="${idAttr}" ${on ? "checked" : ""} />
      <div class="chip-body">
        <div class="term">${escapeHtml(c.term)}</div>
        <div class="src" title="${escapeHtml(c.sourceUrl || "")}">${escapeHtml(
          c.sourceDomain || c.sourceUrl || ""
        )}</div>
        <div class="acts">
          <a class="btn sm" target="_blank" rel="noopener" href="${Keywords.googleTrendsUrl(c.term)}">Trends</a>
          <a class="btn sm" target="_blank" rel="noopener" href="${Keywords.googleSearchUrl(c.term)}">搜索</a>
          <button type="button" class="btn sm primary" data-watch>观察</button>
          <button type="button" class="btn sm danger" data-del>删</button>
        </div>
      </div>
    `;
    const cb = div.querySelector("[data-cand-check]");
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) candSelected.add(c.id);
      else candSelected.delete(c.id);
      div.classList.toggle("selected", cb.checked);
      updateCandSelectionUi();
    });
    div.querySelector("[data-watch]").addEventListener("click", async () => {
      try {
        await Storage.addToWatchlist(c.term, `来自 ${c.sourceDomain || ""}`);
        toast("已加入观察清单");
        renderWatchlist();
      } catch (e) {
        toast(e.message || String(e), true);
      }
    });
    div.querySelector("[data-del]").addEventListener("click", async () => {
      await Storage.removeCandidate(c.id);
      candSelected.delete(c.id);
      renderCandidates();
    });
    box.appendChild(div);
  }
  updateCandSelectionUi();
}

$("candSelectAll")?.addEventListener("change", () => {
  const on = $("candSelectAll").checked;
  const checks = [...document.querySelectorAll("#candList [data-cand-check]")];
  candSelected.clear();
  for (const cb of checks) {
    cb.checked = on;
    if (on) candSelected.add(cb.dataset.id);
    cb.closest(".chip")?.classList.toggle("selected", on);
  }
  updateCandSelectionUi();
});

$("btnCandBulkWatch")?.addEventListener("click", async () => {
  try {
    const list = await Storage.getCandidates();
    const picked = list.filter((c) => candSelected.has(c.id));
    if (!picked.length) {
      toast("请先选择候选词", true);
      return;
    }
    const result = await Storage.addManyToWatchlist(
      picked.map((c) => ({
        term: c.term,
        note: `来自 ${c.sourceDomain || ""}`,
      }))
    );
    toast(`已加入观察 ${result.added} 条，跳过 ${result.skipped} 条（已在清单）`);
    await renderWatchlist();
    resetCandSelection();
    await renderCandidates();
  } catch (e) {
    toast(e.message || String(e), true);
  }
});

$("btnCandBulkDelete")?.addEventListener("click", async () => {
  try {
    const list = await Storage.getCandidates();
    const ids = list.filter((c) => candSelected.has(c.id)).map((c) => c.id);
    if (!ids.length) {
      toast("请先选择要删除的候选词", true);
      return;
    }
    if (!confirm(`确定删除选中的 ${ids.length} 条候选？`)) return;
    await Storage.removeCandidates(ids);
    resetCandSelection();
    await renderCandidates();
    toast(`已删除 ${ids.length} 条候选`);
  } catch (e) {
    toast(e.message || String(e), true);
  }
});

$("btnCandClearAll")?.addEventListener("click", async () => {
  try {
    if (!confirm("确定清空全部候选词？不可恢复")) return;
    await Storage.clearCandidates();
    resetCandSelection();
    await renderCandidates();
    toast("已清空全部候选词");
  } catch (e) {
    toast(e.message || String(e), true);
  }
});

/* ---------- watchlist ---------- */
async function renderWatchlist() {
  const list = await Storage.getWatchlist();
  const tbody = $("watchTable").querySelector("tbody");
  tbody.innerHTML = "";
  $("watchEmpty").hidden = list.length > 0;
  for (const w of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(w.term)}</strong></td>
      <td><input type="text" data-note value="${escapeHtml(w.note || "")}" style="width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 8px" /></td>
      <td style="white-space:nowrap">
        <a class="btn sm" target="_blank" rel="noopener" href="${Keywords.googleTrendsUrl(w.term)}">Trends</a>
        <a class="btn sm" target="_blank" rel="noopener" href="${Keywords.googleSearchUrl(w.term)}">搜索</a>
        <button type="button" class="btn sm danger" data-del>删</button>
      </td>
    `;
    const noteInput = tr.querySelector("[data-note]");
    noteInput.addEventListener("change", async () => {
      await Storage.updateWatchlistItem(w.id, { note: noteInput.value });
      toast("备注已保存");
    });
    tr.querySelector("[data-del]").addEventListener("click", async () => {
      await Storage.removeWatchlistItem(w.id);
      renderWatchlist();
    });
    tbody.appendChild(tr);
  }
}

$("watchAddForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const term = $("watchTerm").value.trim();
  const note = $("watchNote").value.trim();
  if (!term) return;
  try {
    await Storage.addToWatchlist(term, note);
    $("watchTerm").value = "";
    $("watchNote").value = "";
    toast("已添加");
    renderWatchlist();
  } catch (err) {
    toast(err.message || String(err), true);
  }
});

/* ---------- settings ---------- */
async function loadSettingsForm() {
  const s = await Storage.getSettings();
  $("alarmEnabled").checked = !!s.alarmEnabled;
  await refreshStorageUsage();
}

async function refreshStorageUsage() {
  const el = $("storageUsageText");
  if (!el || !Storage.getStorageUsage) return;
  try {
    const u = await Storage.getStorageUsage();
    let line = `Chrome 存储：约 ${u.chromeLabel} · IndexedDB：约 ${u.idbLabel}`;
    if (u.estimate && u.estimate.quota) {
      const used = Storage.formatBytes(u.estimate.usage || 0);
      const quota = Storage.formatBytes(u.estimate.quota);
      line += `（浏览器估算合计 ${used} / ${quota}）`;
    }
    el.textContent = line;
  } catch (e) {
    el.textContent = "用量读取失败：" + (e.message || e);
  }
}

$("btnSaveSettings").addEventListener("click", async () => {
  await Storage.saveSettings({ alarmEnabled: $("alarmEnabled").checked });
  await chrome.runtime.sendMessage({ type: "ENSURE_ALARM" }).catch(() => {});
  const msg = $("settingsMsg");
  msg.hidden = false;
  msg.className = "msg ok";
  msg.textContent = "设置已保存";
  toast("设置已保存");
});

$("btnRunAlarmNow").addEventListener("click", async () => {
  toast("后台检查已开始…");
  try {
    await chrome.runtime.sendMessage({ type: "RUN_CHECKS_NOW" });
    toast("后台检查完成");
    await renderSites();
  } catch (e) {
    toast(String(e.message || e), true);
  }
});


$("btnRefreshUsage")?.addEventListener("click", async () => {
  await refreshStorageUsage();
  toast("用量已刷新");
});

$("btnPurgeCache")?.addEventListener("click", async () => {
  if (!confirm("清理所有站点的快照与 URL 列表？基线会保留，下次检查仍可对比新增。")) return;
  try {
    await Storage.purgeHeavyData({ keepBaselines: true });
    const sites = await Storage.getSites();
    for (const s of sites) {
      await Storage.updateSite(s.id, { newCount: 0 });
    }
    toast("已清理缓存");
    await refreshStorageUsage();
    await renderSites();
    await renderNewUrls();
  } catch (err) {
    toast("清理失败: " + (err.message || err), true);
  }
});

$("btnExport").addEventListener("click", async () => {
  const data = await Storage.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sitemap-monitor-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("已导出");
});

$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const merge = $("importMerge").checked;
    if (!merge && !confirm("确定覆盖全部本地数据？此操作不可撤销。")) {
      e.target.value = "";
      return;
    }
    await Storage.importAll(data, { merge });
    await chrome.runtime.sendMessage({ type: "REFRESH_BADGE" }).catch(() => {});
    toast("导入成功");
    await renderSites();
    await renderCandidates();
    await renderWatchlist();
    await loadSettingsForm();
  } catch (err) {
    toast("导入失败: " + (err.message || err), true);
  }
  e.target.value = "";
});

/* ---------- boot ---------- */
async function boot() {
  const hash = location.hash || "";
  let highlight = null;
  const m = hash.match(/site=([^&]+)/);
  if (m) highlight = decodeURIComponent(m[1]);
  await renderSites(highlight);
  await fillNewUrlFilter();
  await loadSettingsForm();
  if (highlight) {
    const el = document.querySelector(`.site-card[data-id="${CSS.escape(highlight)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

boot();
