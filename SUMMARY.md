# 功能 ↔ 哥飞教程步骤对照

教程原文：[找不到新词？用 Sitemap 盯住同行最近更新的页面](https://mp.weixin.qq.com/s/-gg2WIpfMml1L9PmstEJ_w)

| # | 教程步骤（意图） | 扩展实现 |
|---|------------------|----------|
| 1 | 选一批同行站点持续盯 | **站点监控**：添加域名，建议 5–20 个（上限 20） |
| 2 | 找对方 Sitemap（robots / 常见路径） | **发现 Sitemap**：解析 `robots.txt` 的 `Sitemap:`；回退 `/sitemap.xml`、`/sitemap_index.xml`、`/wp-sitemap.xml`；支持手动粘贴 URL |
| 3 | 若是索引，挑「内容」子图，跳过标签/分类等 | 模态框列出子图 + lastmod；**推荐** post/product/game/page/article/blog；**建议跳过** tag/category/author；可「只选推荐」 |
| 4 | 拉取 URL + lastmod，处理压缩与嵌套 | `lib/sitemap.js`：urlset/index 解析；`.gz` → `DecompressionStream`；嵌套 index **一层** |
| 5 | 第一次记全量，之后只看新增页面 | `chrome.storage.local` 基线；首次 `isBaseline`；之后 diff 只保留新 `loc`；徽章显示新 URL 数 |
| 6 | 从新 URL 路径猜「候选词」 | `lib/keywords.js`：去域名、按 `-_/` 拆、去 20xx 年与停用词；**候选词**页 |
| 7 | 用 Trends / 搜索验证，并记下观察 | 每词 **Trends** / **搜索** 链接；**观察清单** + 备注 |
| — | 定期复查 | `chrome.alarms` 约每日；弹窗/控制台可手动「全部检查」「立即后台检查」 |
| — | 数据可带走 | **设置**页导出/导入 JSON（合并或覆盖） |

## UI 入口

- **弹窗 `popup`**：快速加站、看徽章数字、打开控制台  
- **控制台 `dashboard`**：发现/选择 Sitemap、检查、新 URL、候选词、观察清单、设置

## 刻意不做的事

- 不爬页面正文（教程强调盯 Sitemap 就够轻）  
- 不自动写文章/上站（只到「找词 / 观察」）  
- 不在 Service Worker 里依赖 `DOMParser`（控制台用 DOM；SW 正则回退）
