# Sitemap 盯同行（Sitemap Competitor Monitor）

[English](./README.md) · [简体中文](./README.zh-Hans.md)

Chrome / Microsoft Edge **Manifest V3** 浏览器扩展：用同行 **Sitemap** 盯住**最近更新的页面**，从新 URL 路径里拆出**候选词**，并一键打开 Google Trends / 搜索。

思路来自哥飞 SEO 教程：[找不到新词？用 Sitemap 盯住同行最近更新的页面](https://mp.weixin.qq.com/s/-gg2WIpfMml1L9PmstEJ_w)。

**当前版本：** `1.2.5` · **开源协议：** [MIT](./LICENSE)

## 为什么做这个

关键词工具经常滞后，同行 Sitemap 往往更早露出新页面。本扩展把轻量流程自动化：

1. 盯 5–20 个同行域名  
2. 发现并勾选「内容类」Sitemap  
3. 首次建基线，之后只看**新增 URL**  
4. 从路径拆候选词  
5. 用 Trends / 搜索验证，收进观察清单  

**不会**爬正文、不会自动写文上站、也不会把数据上传到任何服务器。

## 功能一览

| 模块 | 能力 |
|------|------|
| 监控列表 | 添加域名（建议 5–20，上限 20） |
| 发现 Sitemap | 读 `robots.txt` 的 `Sitemap:`；回退 `/sitemap.xml`、`/sitemap_index.xml`、`/wp-sitemap.xml`；可手动粘贴 |
| 选择内容图 | 展开索引；推荐 post/product/game/page；跳过 tag/category/author |
| 基线 + 增量 | 首次全量基线；之后只显示新 `loc`；支持 `.gz` |
| 候选词 | 路径分词；批量加入观察 / 删除 / 清空 |
| 观察清单 | 收藏词 + 备注 |
| 每日复查 | `chrome.alarms` + 工具栏徽章 |
| 导入 / 导出 | JSON 合并或覆盖 |
| 存储（1.2.4+） | 轻量数据在 `chrome.storage.local`；基线/快照/新 URL 在 **IndexedDB**（`sitemap_monitor`）+ `unlimitedStorage` |

对照教程步骤见 [SUMMARY.md](./SUMMARY.md)。

## 安装（开发者模式）

加载**含有 `manifest.json` 的文件夹**（不要直接加载 zip）。

### Google Chrome

1. 打开 `chrome://extensions/`  
2. 打开 **开发者模式**  
3. **加载已解压的扩展程序** → 选本仓库目录  
4. 固定图标；用弹窗或「打开控制台」  

### Microsoft Edge

1. 打开 `edge://extensions/`  
2. 打开 **开发人员模式**  
3. **加载解压缩的扩展** → 选本仓库目录  

### 从 zip 安装

解压后加载解压目录（内含 `manifest.json` 的那一层）。

## 推荐使用流程

1. 在弹窗或控制台添加同行域名  
2. **发现 Sitemap** → 勾选内容子图 → **保存选择并建立基线**  
3. 过几天或点 **检查更新**，在 **新 URL** 看增量  
4. **提取候选词** → Trends → 加入 **观察清单**  

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 站点、候选词、观察清单、设置 |
| `unlimitedStorage` | 放开 storage 配额；大数据走 IndexedDB |
| `alarms` | 每日自动复查 |
| `host_permissions` `http(s)://*/*` | 拉取同行 robots / Sitemap |

数据只存在本机。

## 目录结构

```text
sitemap-monitor-ext/
  manifest.json
  background.js
  popup.html|css|js
  dashboard.html|css|js
  lib/idb.js · storage.js · sitemap.js · keywords.js · presets.js
  icons/
  README.md · README.zh-Hans.md · SUMMARY.md · LICENSE
```

## 技术说明

- 纯 HTML/CSS/JS，无打包器  
- 控制台用 `DOMParser`；Service Worker 用正则回退  
- `.gz` 用 `DecompressionStream`  
- 嵌套 sitemap index **只再展开一层**  

## 注意事项

- 部分站点 / WAF 可能拦截扩展 `fetch`  
- 首次检查建基线，**不会**把历史 URL 全标成「新」  
- 请控制监控数量与检查频率，尊重目标站  

## 版本摘要

- **1.2.5** — 候选词批量：全选、批量观察/删除/清空  
- **1.2.4** — IndexedDB 存基线；用量展示；`unlimitedStorage`  
- **1.2.x** — 大索引自动勾选与并行拉取；预设域名  

## 参与贡献

欢迎 Issue / PR。行为变更请同步 bump `manifest.json` 版本号。

## 致谢

流程思路来自哥飞 SEO 教程（见上方链接）。本实现为独立开源项目，与教程作者无隶属关系。

## 许可

[MIT](./LICENSE) © 2026 huodesheng
