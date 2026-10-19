/**
 * Sitemap discovery & parsing
 * - robots.txt Sitemap: lines
 * - fallbacks: /sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml
 * - index → children with lastmod
 * - urlset → loc + lastmod
 * - .gz via DecompressionStream
 * - nested index one level
 * DOMParser when available; regex fallback for service worker
 */

const Sitemap = (() => {
  const FALLBACKS = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"];

  const CONTENT_HINTS = [
    "post", "product", "game", "page", "article", "blog", "news", "item",
    "docs", "changelog", "growth", "mcp", "skill", "agent", "plugin", "tool",
  ];
  const SKIP_HINTS = [
    "tag", "category", "author", "user", "archive", "image", "video", "news-sitemap",
    "icons", "taxonomy", "attribute", "collection",
  ];
  const MAX_AUTO_SELECT = 30;
  const MAX_SELECT_WARN = 40;

  async function fetchText(url, { timeoutMs = 20000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          Accept: "application/xml,text/xml,text/plain,*/*",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText || ""}`.trim());
      }
      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      const isGz =
        url.toLowerCase().endsWith(".gz") ||
        ctype.includes("gzip") ||
        ctype.includes("x-gzip");

      if (isGz && typeof DecompressionStream !== "undefined") {
        const ds = new DecompressionStream("gzip");
        const stream = res.body.pipeThrough(ds);
        return await new Response(stream).text();
      }
      // try raw; if gzip magic and no DecompressionStream, fail clearly
      const buf = await res.arrayBuffer();
      const u8 = new Uint8Array(buf);
      if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("当前环境无法解压 .gz Sitemap（需要 DecompressionStream）");
        }
        const ds = new DecompressionStream("gzip");
        const stream = new Blob([buf]).stream().pipeThrough(ds);
        return await new Response(stream).text();
      }
      return new TextDecoder("utf-8").decode(buf);
    } finally {
      clearTimeout(timer);
    }
  }

  function originOf(domain) {
    const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return `https://${d}`;
  }

  /**
   * Discover sitemap URLs for a domain
   * @returns {{sitemaps: string[], source: string, errors: string[]}}
   */
  async function discover(domain) {
    const origin = originOf(domain);
    const found = [];
    const errors = [];
    let source = "none";

    // 1) robots.txt
    try {
      const robots = await fetchText(`${origin}/robots.txt`, { timeoutMs: 12000 });
      const lines = robots.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
        if (m) {
          let u = m[1].trim();
          if (u.startsWith("/")) u = origin + u;
          if (!found.includes(u)) found.push(u);
        }
      }
      if (found.length) source = "robots.txt";
    } catch (e) {
      errors.push(`robots.txt: ${e.message || e}`);
    }

    // 2) fallbacks
    if (!found.length) {
      for (const path of FALLBACKS) {
        const url = origin + path;
        try {
          const text = await fetchText(url, { timeoutMs: 10000 });
          if (looksLikeSitemap(text)) {
            found.push(url);
            source = "fallback";
            break;
          }
        } catch (e) {
          errors.push(`${path}: ${e.message || e}`);
        }
      }
    }

    return { sitemaps: found, source, errors, origin };
  }

  function looksLikeSitemap(text) {
    if (!text || text.length < 20) return false;
    const t = text.slice(0, 2000).toLowerCase();
    return (
      t.includes("<urlset") ||
      t.includes("<sitemapindex") ||
      t.includes("<sitemap>") ||
      (t.includes("<url>") && t.includes("<loc>"))
    );
  }

  /**
   * Parse XML string into {type: 'index'|'urlset'|'unknown', entries: [{loc, lastmod}]}
   */
  function parseXml(xml) {
    if (typeof DOMParser !== "undefined") {
      return parseWithDom(xml);
    }
    return parseWithRegex(xml);
  }

  function parseWithDom(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const parseErr = doc.querySelector("parsererror");
    if (parseErr) {
      // fall back to regex on broken XML
      return parseWithRegex(xml);
    }

    const root = doc.documentElement;
    const name = (root?.localName || root?.tagName || "").toLowerCase();

    if (name === "sitemapindex" || name.endsWith("sitemapindex")) {
      const entries = [];
      const nodes = [
        ...doc.getElementsByTagNameNS("*", "sitemap"),
        ...doc.getElementsByTagName("sitemap"),
      ];
      const seen = new Set();
      for (const sm of nodes) {
        const loc = textOf(sm, "loc");
        const lastmod = textOf(sm, "lastmod");
        if (loc && !seen.has(loc.trim())) {
          seen.add(loc.trim());
          entries.push({ loc: loc.trim(), lastmod: lastmod ? lastmod.trim() : null });
        }
      }
      if (!entries.length) return parseWithRegex(xml);
      return { type: "index", entries };
    }

    if (name === "urlset" || name.endsWith("urlset")) {
      const entries = [];
      const nodes = [
        ...doc.getElementsByTagNameNS("*", "url"),
        ...doc.getElementsByTagName("url"),
      ];
      const seen = new Set();
      for (const url of nodes) {
        const loc = textOf(url, "loc");
        const lastmod = textOf(url, "lastmod");
        if (loc && !seen.has(loc.trim())) {
          seen.add(loc.trim());
          entries.push({ loc: loc.trim(), lastmod: lastmod ? lastmod.trim() : null });
        }
      }
      if (!entries.length) return parseWithRegex(xml);
      return { type: "urlset", entries };
    }

    // unknown root — try collecting any loc
    return parseWithRegex(xml);
  }

  function textOf(parent, local) {
    const els = parent.getElementsByTagNameNS("*", local);
    if (els.length) return els[0].textContent || "";
    return "";
  }

  function parseWithRegex(xml) {
    const lower = xml.slice(0, 500).toLowerCase();
    const isIndex = lower.includes("<sitemapindex");
    const blockRe = isIndex
      ? /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi
      : /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
    const entries = [];
    let m;
    while ((m = blockRe.exec(xml)) !== null) {
      const block = m[1];
      const locM = block.match(/<loc[^>]*>\s*([^<]+?)\s*<\/loc>/i);
      const lmM = block.match(/<lastmod[^>]*>\s*([^<]+?)\s*<\/lastmod>/i);
      if (locM) {
        entries.push({
          loc: decodeXml(locM[1].trim()),
          lastmod: lmM ? decodeXml(lmM[1].trim()) : null,
        });
      }
    }
    // bare loc fallback
    if (!entries.length) {
      const locRe = /<loc[^>]*>\s*([^<]+?)\s*<\/loc>/gi;
      while ((m = locRe.exec(xml)) !== null) {
        entries.push({ loc: decodeXml(m[1].trim()), lastmod: null });
      }
    }
    return {
      type: isIndex ? "index" : entries.length ? "urlset" : "unknown",
      entries,
    };
  }

  function decodeXml(s) {
    return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  /**
   * Classify child sitemap URL for UI preference
   */
  function classifySitemapUrl(url) {
    const u = url.toLowerCase();
    const skip = SKIP_HINTS.some((h) => u.includes(h));
    // Strong content pages (few, high priority for 新词)
    const strongHints = ["blog", "docs", "changelog", "growth", "post", "article", "news", "page", "product", "game"];
    const softHints = ["mcp", "skill", "agent", "plugin", "tool", "item"];
    const strong = strongHints.some((h) => u.includes(h));
    const soft = softHints.some((h) => u.includes(h));
    const prefer = (strong || soft) && !skip;
    let score = 0;
    if (strong) score += 4;
    else if (soft) score += 2;
    if (skip) score -= 5;
    if (u.includes("sitemap") && !skip) score += 1;
    // paginated shards like skills-999 get slightly lower than *-recommend / non-numbered
    if (/-(?:\d+)\.xml(?:$|\?)/.test(u) || /[?&]page=\d+/i.test(u)) score -= 1;
    return { prefer, skip, strong: strong && !skip, soft: soft && !skip && !strong, score };
  }

  /**
   * Fetch a sitemap URL and return parsed result.
   * If index, optionally expand children one level (when expandIndex).
   */
  async function fetchAndParse(url, { expandIndex = false, depth = 0 } = {}) {
    const text = await fetchText(url);
    const parsed = parseXml(text);
    if (parsed.type === "index" && expandIndex && depth < 1) {
      const children = [];
      for (const entry of parsed.entries) {
        children.push({
          ...entry,
          ...classifySitemapUrl(entry.loc),
        });
      }
      return { type: "index", url, entries: children, rawCount: children.length };
    }
    return { type: parsed.type, url, entries: parsed.entries, rawCount: parsed.entries.length };
  }

  /**
   * After user selects content sitemap URLs, fetch all and merge URL entries.
   * Nested index: expand one level.
   */
  async function fetchSelected(urls, { onProgress, concurrency = 6 } = {}) {
    const all = [];
    const errors = [];
    let done = 0;
    const total = urls.length;
    const queue = urls.slice();

    async function handleOne(url) {
      try {
        const parsed = await fetchAndParse(url, { expandIndex: false });
        if (parsed.type === "index") {
          for (const child of parsed.entries) {
            try {
              const sub = await fetchAndParse(child.loc, { expandIndex: false, depth: 1 });
              if (sub.type === "urlset") all.push(...sub.entries);
              else if (sub.entries?.length) all.push(...sub.entries);
            } catch (e) {
              errors.push(`${child.loc}: ${e.message || e}`);
            }
          }
        } else if (parsed.type === "urlset") {
          all.push(...parsed.entries);
        } else {
          all.push(...(parsed.entries || []));
        }
      } catch (e) {
        errors.push(`${url}: ${e.message || e}`);
      } finally {
        done++;
        if (onProgress) onProgress({ current: done, total, url });
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(concurrency, total || 1));
    for (let w = 0; w < n; w++) {
      workers.push(
        (async () => {
          while (queue.length) {
            const url = queue.shift();
            if (!url) break;
            await handleOne(url);
          }
        })()
      );
    }
    await Promise.all(workers);

    const map = new Map();
    for (const e of all) {
      if (!e?.loc) continue;
      const prev = map.get(e.loc);
      if (!prev || (e.lastmod && (!prev.lastmod || e.lastmod > prev.lastmod))) {
        map.set(e.loc, { loc: e.loc, lastmod: e.lastmod || null });
      }
    }
    return { urls: [...map.values()], errors };
  }

  /**
   * Diff against baseline map { [loc]: lastmod|null }
   * First run (no baseline): all become baseline, newUrls empty (or optionally all)
   * Later: only locs not in baseline
   */
  function diff(entries, baseline) {
    const urlMap = {};
    for (const e of entries) {
      urlMap[e.loc] = e.lastmod || null;
    }
    if (!baseline || !baseline.urls || Object.keys(baseline.urls).length === 0) {
      return {
        isBaseline: true,
        newUrls: [],
        urlMap,
        total: entries.length,
      };
    }
    const old = baseline.urls;
    const newUrls = [];
    for (const e of entries) {
      if (!(e.loc in old)) {
        newUrls.push(e);
      }
    }
    // sort by lastmod desc when available
    newUrls.sort((a, b) => {
      if (a.lastmod && b.lastmod) return a.lastmod < b.lastmod ? 1 : -1;
      if (a.lastmod) return -1;
      if (b.lastmod) return 1;
      return 0;
    });
    return {
      isBaseline: false,
      newUrls,
      urlMap,
      total: entries.length,
      previousCount: Object.keys(old).length,
    };
  }

  /**
   * Full pipeline for one site (used by dashboard / alarm)
   */
  async function checkSite(site, baseline, { onProgress } = {}) {
    const selected = site.selectedSitemaps || [];
    if (!selected.length) {
      throw new Error("尚未选择要监控的内容 Sitemap，请先「发现并选择」");
    }
    const { urls, errors } = await fetchSelected(selected, { onProgress });
    const result = diff(urls, baseline);
    return { ...result, fetchErrors: errors };
  }

  return {
    FALLBACKS,
    CONTENT_HINTS,
    SKIP_HINTS,
    MAX_AUTO_SELECT,
    MAX_SELECT_WARN,
    fetchText,
    originOf,
    discover,
    parseXml,
    classifySitemapUrl,
    fetchAndParse,
    fetchSelected,
    diff,
    checkSite,
    looksLikeSitemap,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.Sitemap = Sitemap;
}
