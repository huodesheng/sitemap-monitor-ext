/**
 * Extract 候选词 from new URL paths (哥飞教程风格)
 * - strip domain
 * - split by / _ -
 * - drop years 20xx, stopwords, short tokens, pure numbers
 */

const Keywords = (() => {
  const STOPWORDS = new Set([
    "www", "com", "net", "org", "io", "co", "uk", "us", "cn", "jp", "de", "fr",
    "html", "htm", "php", "asp", "aspx", "jsp", "index", "page", "pages",
    "post", "posts", "blog", "blogs", "article", "articles", "news",
    "category", "categories", "tag", "tags", "author", "authors", "user", "users",
    "wp", "wordpress", "wp-content", "uploads", "feed", "rss", "amp",
    "en", "zh", "zh-cn", "zh-tw", "es", "pt", "ru", "ko",
    "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "at", "by",
    "with", "from", "is", "are", "was", "be", "this", "that", "it",
    "how", "what", "why", "when", "where", "who", "which",
    "new", "old", "best", "top", "free", "online", "home", "about", "contact",
    "privacy", "terms", "login", "signup", "register", "search", "sitemap",
    "product", "products", "item", "items", "shop", "store", "cart",
    "game", "games", "app", "apps", "tool", "tools",
    "id", "ids", "v1", "v2", "v3", "api", "cdn", "static", "assets", "img", "image", "images",
    "http", "https", "www2", "m", "mobile",
  ]);

  /**
   * @param {string} url
   * @returns {string[]} candidate terms (phrases + tokens)
   */
  function extractFromUrl(url) {
    let path = "";
    try {
      const u = new URL(url);
      path = u.pathname || "";
    } catch {
      path = String(url).replace(/^https?:\/\/[^/]+/i, "");
    }
    // drop extension
    path = path.replace(/\.[a-z0-9]{1,5}$/i, "");
    // decode
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep raw */
    }
    const segments = path.split("/").filter(Boolean);
    const terms = [];
    const tokens = [];

    for (const seg of segments) {
      // slug → phrase
      const parts = seg
        .split(/[-_+.~]+/)
        .map((p) => p.trim().toLowerCase())
        .filter((p) => isUsefulToken(p));

      if (parts.length === 0) continue;

      // multi-word phrase from hyphen slug
      if (parts.length >= 2 && parts.length <= 6) {
        const phrase = parts.join(" ");
        if (phrase.length >= 4 && phrase.length <= 60) {
          terms.push(phrase);
        }
      }
      tokens.push(...parts);
    }

    // also single useful tokens (longer ones)
    for (const t of tokens) {
      if (t.length >= 4 && !STOPWORDS.has(t)) {
        terms.push(t);
      }
    }

    return uniquePreserve(terms);
  }

  function isUsefulToken(t) {
    if (!t || t.length < 2) return false;
    if (/^20\d{2}$/.test(t)) return false; // years 2000-2099
    if (/^\d+$/.test(t)) return false;
    if (/^[a-f0-9]{8,}$/i.test(t)) return false; // hex ids
    if (STOPWORDS.has(t)) return false;
    if (!/[a-z\u4e00-\u9fff]/.test(t)) return false;
    return true;
  }

  function uniquePreserve(arr) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = x.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(x);
      }
    }
    return out;
  }

  /**
   * Batch extract from list of {loc, lastmod?}
   */
  function extractFromUrls(urls, { sourceDomain = "" } = {}) {
    const map = new Map(); // term -> {term, sourceUrl, count}
    for (const item of urls) {
      const loc = typeof item === "string" ? item : item.loc;
      if (!loc) continue;
      for (const term of extractFromUrl(loc)) {
        const key = term.toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            term,
            sourceUrl: loc,
            sourceDomain,
            count: 1,
          });
        } else {
          map.get(key).count += 1;
        }
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  }

  function googleTrendsUrl(term, geo = "") {
    const q = encodeURIComponent(term);
    const g = geo ? `&geo=${encodeURIComponent(geo)}` : "";
    return `https://trends.google.com/trends/explore?q=${q}${g}&date=today%2012-m`;
  }

  function googleSearchUrl(term) {
    return `https://www.google.com/search?q=${encodeURIComponent(term)}`;
  }

  return {
    STOPWORDS,
    extractFromUrl,
    extractFromUrls,
    googleTrendsUrl,
    googleSearchUrl,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.Keywords = Keywords;
}
