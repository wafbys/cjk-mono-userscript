# Tampermonkey 脚本集

本仓库存放个人用的 Tampermonkey / 油猴用户脚本。

## 脚本列表

| 脚本 | 版本 | 说明 |
|------|------|------|
| [CJK-Mono 字体替换.js](./CJK-Mono%20字体替换.js) | 3.10.1 | 全站 CJK 与等宽代码字体替换 |

---

## CJK/Mono 字体替换

高性能 CJK（中日韩）及等宽字体替换方案。通过 `@font-face` + `unicode-range` 只替换汉字等 CJK 字形，西文与图标字体尽量不受影响。

### 功能

- **CJK 正文替换**：用本机字体（默认 `KingHwaOldSong-GB`）覆盖页面中的汉字、假名等
- **等宽代码字体**：`code` / `pre` / `kbd` / `samp` 使用独立等宽字体
- **按站点配置**：可为当前域名单独选择 CJK / 代码字体
- **站点黑名单**：一键排除不想替换的站点
- **Shadow DOM / iframe / 动态内容**：MutationObserver + 空闲批处理
- **输入框实时替换**：支持 `input`、`textarea`、`contenteditable`
- **控制面板**：`Ctrl+Shift+F` 开关与调字体
- **阅读站适配**（如 [读通鉴](https://www.dutongjian.com/)）：覆盖常见 CSS 字体变量，避免正文/白话/注释/古本只有一部分生效

### 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（或兼容扩展）
2. 新建脚本，将 `CJK-Mono 字体替换.js` 全文粘贴保存  
   或在仓库目录用「从文件安装 / 创建」导入
3. 确认本机已安装目标字体（默认 **KingHwaOldSong-GB**，family 名须完全一致）
4. 刷新目标网页；需要时 `Ctrl+Shift+F` 打开面板调整

### 使用

| 操作 | 说明 |
|------|------|
| `Ctrl+Shift+F` | 打开 / 关闭控制面板 |
| 启用脚本 | 全局开关（仍受黑名单约束） |
| 正文 CJK 字体 | 当前站点的 CJK 字体（写入站点配置） |
| 代码字体 | 当前站点的等宽字体 |
| 重置为全局默认 | 删除当前站点覆盖，恢复默认字体 |
| + 添加当前 | 将当前域名加入黑名单 |
| 调试存储 | 在控制台打印 GM 存储与配置 |

配置持久化键：`CJK_MONO_FONT_CONFIG`（`GM_getValue` / `GM_setValue`）。

### 默认字体

| 类型 | 默认值 |
|------|--------|
| CJK | `KingHwaOldSong-GB`（仅此精确名称，无变体别名） |
| 代码 | `NewComputerModern Mono 10` |

面板可选 CJK：`KingHwaOldSong-GB`、`Ku Mincho`。  
可选代码字体：`NewComputerModern Mono 10`、`Cascadia Code`、`Fira Code`、`JetBrains Mono`、`Courier New`。

可在脚本内修改 `DEFAULT_CONFIG` / `FONT_CHOICES` 以增删选项。

### 原理简述

1. 注入 `@font-face` 族名 `CJKPatch`，`src: local("你的字体名")`，并限定 `unicode-range` 覆盖 CJK 基本区、扩展 A–J、假名、兼容区、全角等
2. 对含 CJK 文本的节点父级写入 `font-family: "CJKPatch", … !important`
3. 同步覆盖阅读站常用 CSS 变量（如 `--font-family-classical`），并拦截 `documentElement.style.setProperty`，防止 SPA 运行时改回站点字体
4. 对 SPA 路由（`pushState` / `replaceState` / `popstate`）与短时守护轮询做二次注入

### 读通鉴等站点说明

读通鉴等站用 CSS 变量分区控制字体，例如：

- 文言正文：`--font-family-classical`
- 白话文：`--font-family-translation`
- 注释 / UI：`--font-family-modern`、`--font-family-ui`
- 古本摘录：`--font-family-guben-excerpt-fixed`

旧版只改部分 DOM 节点时，会出现「一部分中文换了字体、一部分没换」。3.10+ 通过变量覆盖 + 正文选择器兜底缓解该问题。

**仍可能不变的情况：**

- 字体本身缺字 → 浏览器回退到宋体等（正常缺字回退）
- 以图片显示的生僻字、Canvas 地图文字 → 无法用 CSS 改字体

### 权限与匹配

```text
@match   *://*/*
@run-at  document-idle
@grant   GM_getValue
@grant   GM_setValue
```

### 版本摘要

| 版本 | 变更 |
|------|------|
| 3.10.1 | CJK 字体严格使用配置名（如 `KingHwaOldSong-GB`），去掉多余别名 |
| 3.10.0 | 阅读站 CSS 变量覆盖、SPA 路由重扫、扩展 unicode-range、变量 setProperty 守卫 |
| 3.9.0 | 按站点配置、黑名单、控制面板等基础能力 |

### 许可证

个人脚本，按需自用；字体版权归各字体作者所有。
