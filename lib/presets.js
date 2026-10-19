/**
 * Built-in competitor / directory presets for Sitemap 盯同行
 */
const Presets = (() => {
  const BUILTIN = [
    { domain: "toolify.ai", label: "Toolify", group: "导航" },
    { domain: "aixploria.com", label: "AIxploria", group: "导航" },
    { domain: "ai-bot.cn", label: "AI工具集", group: "导航" },
    { domain: "opentools.ai", label: "OpenTools", group: "导航" },
    { domain: "dang.ai", label: "Dang.ai", group: "导航" },
    { domain: "clipfly.ai", label: "Clipfly", group: "导航" },
    { domain: "aitoptools.com", label: "AITopTools", group: "导航" },
    { domain: "futurepedia.io", label: "Futurepedia", group: "导航" },
    { domain: "glama.ai", label: "Glama", group: "MCP" },
    { domain: "mcp.so", label: "MCP.so", group: "MCP" },
    { domain: "lobehub.com", label: "LobeHub", group: "MCP" },
  ];

  function list() {
    return BUILTIN.slice();
  }

  function domains() {
    return BUILTIN.map((p) => p.domain);
  }

  return { BUILTIN, list, domains };
})();

if (typeof globalThis !== "undefined") {
  globalThis.Presets = Presets;
}
