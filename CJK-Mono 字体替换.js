// ==UserScript==
// @name         CJK/Mono 字体替换
// @namespace    http://tampermonkey.net/
// @version      3.10.1
// @description  高性能 CJK 及等宽字体替换方案。支持按网站配置、Shadow DOM、动态内容及输入框实时替换。附带热键控制面板 (Ctrl+Shift+F)。
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'CJK_MONO_FONT_CONFIG';
  const PATCH_ATTR = 'data-cjk-patched';
  const ORIG_ATTR = 'data-cjk-orig-font';
  const BATCH_SIZE = 400;
  const IDLE_TIMEOUT_MS = 150;
  const CURRENT_HOST = location.hostname;
  const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

  // 覆盖阅读站常用 CSS 变量（如 dutongjian 的正文/白话/注释/古本字体）
  const CSS_FONT_VARS = [
    '--font-family-classical',
    '--font-family-modern',
    '--font-family-translation',
    '--font-family-ui',
    '--font-family-guben-excerpt-fixed',
    '--font-family-serif',
    '--font-family-sans',
    '--reader-font-family',
    '--content-font-family',
  ];

  const DEFAULT_CONFIG = {
    enabled: true,
    siteBlacklist: [],
    fonts: {
      default: {
        cjk: 'KingHwaOldSong-GB',
        code: 'NewComputerModern Mono 10',
      },
      sites: {}
    },
    // 覆盖 CJK 基本区 + 扩展 A–J、假名、兼容汉字、全角等，避免生僻字不走 CJKPatch
    unicodeRange: [
      'U+2E80-2EFF', 'U+2F00-2FDF', 'U+3000-303F', 'U+3040-309F', 'U+30A0-30FF',
      'U+3100-312F', 'U+31A0-31BF', 'U+31C0-31EF', 'U+31F0-31FF',
      'U+3200-32FF', 'U+3300-33FF', 'U+3400-4DBF', 'U+4E00-9FFF',
      'U+F900-FAFF', 'U+FE10-FE1F', 'U+FE30-FE4F', 'U+FF00-FFEF',
      'U+20000-2A6DF', 'U+2A700-2B73F', 'U+2B740-2B81F', 'U+2B820-2CEAF',
      'U+2CEB0-2EBEF', 'U+2EBF0-2EE5F', 'U+2F800-2FA1F',
      'U+30000-3134F', 'U+31350-323AF', 'U+323B0-3347F',
    ].join(', '),
  };

  const FONT_CHOICES = {
    cjk: ['KingHwaOldSong-GB', 'Ku Mincho'],
    code: ['NewComputerModern Mono 10', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Courier New'],
  };

  function buildLocalSrc(fontName) {
    // 严格使用配置中的字体名（如 KingHwaOldSong-GB），不加变体别名
    return `local("${fontName}")`;
  }

  function buildCjkFallbackStack() {
    // CJKPatch 之后：仅当前 CJK 字体名 + 系统衬线回退（缺字时）
    const cjk = CONFIG.font?.cjk || DEFAULT_CONFIG.fonts.default.cjk;
    return `"${cjk}", "Songti SC", "STSong", "SimSun", "NSimSun", "Noto Serif CJK SC", "Source Han Serif SC", serif`;
  }

  const CONFIG = {};
  const pendingNodesMap = new WeakMap();
  const idleCallbackMap = new WeakMap();
  const observerMap = new WeakMap();

  const ric = window.requestIdleCallback || function (cb) {
    return setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 0 }), 1);
  };
  const cancelRic = window.cancelIdleCallback || clearTimeout;

  async function loadConfig() {
    const saved = await GM_getValue(STORAGE_KEY, {});

    if (saved.font && !saved.fonts) {
      saved.fonts = { sites: {} };
    }

    Object.assign(CONFIG, DEFAULT_CONFIG, {
      enabled: saved.enabled !== undefined ? saved.enabled : DEFAULT_CONFIG.enabled,
      siteBlacklist: saved.siteBlacklist || [],
      fonts: {
        default: { ...DEFAULT_CONFIG.fonts.default },
        sites: saved.fonts?.sites || {}
      }
    });

    const siteConfig = CONFIG.fonts.sites[CURRENT_HOST] || { ...CONFIG.fonts.default };
    CONFIG.font = { ...siteConfig };
  }

  async function saveConfig() {
    const toSave = {
      enabled: CONFIG.enabled,
      siteBlacklist: CONFIG.siteBlacklist,
      fonts: {
        sites: CONFIG.fonts.sites || {}
      }
    };
    await GM_setValue(STORAGE_KEY, toSave);
  }

  const isSiteBlacklisted = () => CONFIG.siteBlacklist.some(domain => {
    if (domain === CURRENT_HOST) return true;
    if (domain.startsWith('*.')) {
      const suffix = domain.slice(2);
      return CURRENT_HOST === suffix || CURRENT_HOST.endsWith('.' + suffix);
    }
    return false;
  });

  const isPatchActive = () => CONFIG.enabled && !isSiteBlacklisted();

  function injectGlobalStyle(doc = document) {
    if (!doc?.head) return;
    const oldStyle = doc.getElementById('cjk-mono-patch-style');
    if (oldStyle) oldStyle.remove();
    if (!isPatchActive()) return;

    const localSrc = buildLocalSrc(CONFIG.font.cjk);
    const fallbackStack = buildCjkFallbackStack();
    const varOverrides = CSS_FONT_VARS
      .map(v => `${v}: "CJKPatch", ${fallbackStack} !important;`)
      .join('\n        ');

    const css = `
      @font-face {
        font-family: "CJKPatch";
        src: ${localSrc};
        unicode-range: ${DEFAULT_CONFIG.unicodeRange};
        font-display: swap;
      }
      /* 阅读站（读通鉴等）用 CSS 变量控字体：直接覆盖，避免部分正文/白话/古本不生效 */
      :root, html, :host {
        ${varOverrides}
      }
      /* 常见正文容器再兜一层，防止仅靠变量、子元素又被 SPA 重置 */
      .original-text,
      .paragraph-classical,
      .paragraph-modern,
      .paragraph.translation,
      .section-text,
      .section-text--classical,
      .section-text--note,
      .guben-book-excerpt-card__surface,
      [class*="paragraph-content"],
      [class*="reader-content"] {
        font-family: "CJKPatch", ${fallbackStack} !important;
      }
      code, pre, kbd, samp {
        font-family: "${CONFIG.font.code}", "Cascadia Code", "JetBrains Mono", "Fira Code", "Consolas", "${CONFIG.font.cjk}", monospace !important;
        font-variant-ligatures: none;
      }
    `;
    const style = doc.createElement('style');
    style.id = 'cjk-mono-patch-style';
    style.textContent = css;
    doc.head.appendChild(style);

    // 站点可能用 documentElement.style.setProperty 写变量（无 !important），
    // 再主动写一遍带 important 的 inline，确保压过站点运行时赋值
    try {
      const root = doc.documentElement;
      if (root?.style) {
        for (const v of CSS_FONT_VARS) {
          root.style.setProperty(v, `"CJKPatch", ${fallbackStack}`, 'important');
        }
        root.setAttribute('data-cjk-vars-patched', '1');
      }
    } catch (e) {}
  }

  function clearCssVarOverrides(doc = document) {
    try {
      const root = doc?.documentElement;
      if (!root?.style || root.getAttribute('data-cjk-vars-patched') !== '1') return;
      for (const v of CSS_FONT_VARS) {
        root.style.removeProperty(v);
      }
      root.removeAttribute('data-cjk-vars-patched');
    } catch (e) {}
  }

  function collectTextNodes(rootNode) {
    if (!rootNode || !isPatchActive()) return;

    const doc = rootNode.ownerDocument || rootNode;
    if (!pendingNodesMap.has(doc)) pendingNodesMap.set(doc, []);
    const pendingTextNodes = pendingNodesMap.get(doc);

    const effectiveRoot = (rootNode.nodeType === 1 || rootNode.nodeType === 11) ? rootNode : doc.body;
    if (!effectiveRoot) return;

    const walker = doc.createTreeWalker(effectiveRoot, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return (node.nodeValue && CJK_REGEX.test(node.nodeValue)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      pendingTextNodes.push(node);
    }

    const elementWalker = doc.createTreeWalker(effectiveRoot, NodeFilter.SHOW_ELEMENT);
    while ((node = elementWalker.nextNode())) {
      if (node.shadowRoot) collectTextNodes(node.shadowRoot);
    }

    if (effectiveRoot.querySelectorAll) {
      effectiveRoot.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(el => {
        if (el.hasAttribute(PATCH_ATTR)) return;
        const text = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
          ? (el.value || el.placeholder || '')
          : (el.textContent || '');
        if (CJK_REGEX.test(text)) applyPatchToElement(el);
      });
    }

    scheduleProcessing(doc);
  }

  function scheduleProcessing(doc) {
    if (idleCallbackMap.has(doc) && idleCallbackMap.get(doc) !== null) return;
    const handle = ric(() => processPendingNodes(doc), { timeout: IDLE_TIMEOUT_MS });
    idleCallbackMap.set(doc, handle);
  }

  function findPatchableElement(textNode) {
    let el = textNode.parentElement;
    while (el) {
      const tag = el.tagName;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(tag)) return null;
      // 跳过纯装饰/语义包装，优先贴到更可能带 font-family 的祖先
      if (['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'MARK', 'RUBY', 'RT', 'RP', 'SUB', 'SUP', 'FONT'].includes(tag)) {
        // 若该 span 自身已写 font-family，则直接补丁它
        try {
          if (el.style.fontFamily || /font-family/i.test(el.getAttribute('style') || '')) return el;
        } catch (e) {}
        el = el.parentElement;
        continue;
      }
      return el;
    }
    return textNode.parentElement || null;
  }

  function applyPatchToElement(el) {
    if (!el || el.nodeType !== 1 || el.hasAttribute(PATCH_ATTR)) return;
    try {
      const computedFamily = getComputedStyle(el).fontFamily;
      if (computedFamily.includes('CJKPatch') || (el.style.fontFamily && el.style.fontFamily.includes('CJKPatch'))) {
        el.setAttribute(PATCH_ATTR, 'computed');
        return;
      }
      el.setAttribute(ORIG_ATTR, el.style.fontFamily || '');
      // 把 CJKPatch 放在最前；保留原计算栈作非 CJK / 缺字回退
      el.style.setProperty('font-family', `"CJKPatch", ${computedFamily}`, 'important');
      el.setAttribute(PATCH_ATTR, 'inlined');
    } catch (e) {}
  }

  function processPendingNodes(doc) {
    const pendingTextNodes = pendingNodesMap.get(doc);
    if (!pendingTextNodes || pendingTextNodes.length === 0) {
      idleCallbackMap.set(doc, null);
      return;
    }
    const batch = pendingTextNodes.splice(0, BATCH_SIZE);
    for (const node of batch) {
      if (!node?.parentElement) continue;
      const el = findPatchableElement(node);
      if (el) applyPatchToElement(el);
    }
    if (pendingTextNodes.length > 0) {
      scheduleProcessing(doc);
    } else {
      idleCallbackMap.set(doc, null);
    }
  }

  function observeMutations(rootNode) {
    if (observerMap.has(rootNode)) observerMap.get(rootNode).disconnect();
    if (!isPatchActive()) return;

    const target = rootNode.body || (rootNode.nodeType === 11 ? rootNode : null);
    if (!target) return;

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') {
          const textNode = m.target;
          if (textNode.nodeType === 3 && CJK_REGEX.test(textNode.nodeValue)) {
            const el = findPatchableElement(textNode);
            if (el) applyPatchToElement(el);
          }
          continue;
        }
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IFRAME') {
            processIframe(n);
          } else if (n.querySelectorAll) {
            n.querySelectorAll('iframe').forEach(processIframe);
          }
          collectTextNodes(n);
        }
      }
    });

    observer.observe(target, { childList: true, subtree: true, characterData: true });
    observerMap.set(rootNode, observer);
  }

  function processIframe(iframe) {
    try {
      const doc = iframe.contentDocument;
      if (doc && (doc.readyState === 'complete' || doc.readyState === 'interactive')) {
        runOnDocument(doc);
      } else {
        iframe.addEventListener('load', () => processIframe(iframe), { once: true });
      }
    } catch (e) {}
  }

  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) {
    const shadowRoot = originalAttachShadow.call(this, options);
    if (isPatchActive()) runOnDocument(shadowRoot);
    return shadowRoot;
  };

  function startSentinelPolling() {
    const interval = 800;
    // SPA（读通鉴等）会异步灌内容/改 CSS 变量，延长守护时间
    const duration = 60000;
    let elapsed = 0;
    const poller = setInterval(() => {
      if (!isPatchActive() || elapsed >= duration) {
        clearInterval(poller);
        return;
      }
      // 站点运行时可能重写 CSS 变量，周期性重新注入
      const root = document.documentElement;
      const styleMissing = !document.getElementById('cjk-mono-patch-style');
      const classical = root ? getComputedStyle(root).getPropertyValue('--font-family-classical').trim() : '';
      // 仅当站点实际使用该变量、且值里没有 CJKPatch 时才判定被顶掉
      const varsStolen = classical && !classical.includes('CJKPatch');
      if (styleMissing || varsStolen || root?.getAttribute('data-cjk-vars-patched') !== '1') {
        injectGlobalStyle(document);
      }
      document.querySelectorAll('iframe').forEach(processIframe);
      elapsed += interval;
    }, interval);
  }

  // 拦截 documentElement.style.setProperty，防止站点把我们的 CSS 变量顶掉
  function installCssVarGuard() {
    if (installCssVarGuard._done) return;
    installCssVarGuard._done = true;
    const proto = CSSStyleDeclaration.prototype;
    const original = proto.setProperty;
    proto.setProperty = function (prop, value, priority) {
      if (
        isPatchActive()
        && this === document.documentElement.style
        && typeof prop === 'string'
        && CSS_FONT_VARS.includes(prop)
        && typeof value === 'string'
        && !value.includes('CJKPatch')
      ) {
        // 保留站点选择的字体栈作缺字回退，只把 CJKPatch 插到最前
        return original.call(this, prop, `"CJKPatch", ${value}`, 'important');
      }
      return original.apply(this, arguments);
    };
  }

  function bindInputEvents(doc) {
    if (doc.__cjkInputBound) return;
    doc.__cjkInputBound = true;
    doc.addEventListener('input', (e) => {
      const el = e.target;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA'].includes(el.tagName))) {
        if (CJK_REGEX.test(el.value || el.textContent)) applyPatchToElement(el);
      }
    });
  }

  function undoAllPatches(doc = document) {
    if (!doc) return;
    observerMap.get(doc)?.disconnect();
    observerMap.delete(doc);
    doc.getElementById('cjk-mono-patch-style')?.remove();
    clearCssVarOverrides(doc);

    if (idleCallbackMap.has(doc)) {
      cancelRic(idleCallbackMap.get(doc));
      idleCallbackMap.set(doc, null);
    }
    pendingNodesMap.delete(doc);

    doc.querySelectorAll(`[${PATCH_ATTR}]`).forEach(el => {
      try {
        el.style.fontFamily = el.getAttribute(ORIG_ATTR) || '';
        el.removeAttribute(PATCH_ATTR);
        el.removeAttribute(ORIG_ATTR);
      } catch (e) {}
    });

    if (doc.querySelectorAll) {
      doc.querySelectorAll('iframe').forEach(iframe => {
        try { undoAllPatches(iframe.contentDocument); } catch (e) {}
      });
    }
  }

  function refreshStyles(doc = document) {
    if (!doc) return;
    if (isPatchActive()) injectGlobalStyle(doc);
    if (doc.querySelectorAll) {
      doc.querySelectorAll('iframe').forEach(iframe => {
        try { refreshStyles(iframe.contentDocument); } catch (e) {}
      });
    }
  }

  function runOnDocument(doc) {
    if (!isPatchActive() || !doc) return;
    const root = doc.body || doc;
    if (!root) return;
    injectGlobalStyle(doc);
    collectTextNodes(root);
    observeMutations(doc);
    bindInputEvents(doc);
  }

  function fullRescan() {
    undoAllPatches(document);
    runOnDocument(document);
    document.querySelectorAll('iframe').forEach(processIframe);
  }

  let controlPanel = null;

  function createControlPanel() {
    if (document.getElementById('cjk-mono-panel')) return;

    controlPanel = document.createElement('div');
    controlPanel.id = 'cjk-mono-panel';
    controlPanel.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; background: rgba(30,30,30,0.95); color: #f0f0f0;
      font-family: system-ui, sans-serif; font-size: 14px; padding: 15px; border-radius: 10px;
      z-index: 2147483647; line-height: 1.8; width: 300px; box-shadow: 0 8px 25px rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(10px); display: none;
    `;

    controlPanel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <b style="font-size:16px;">CJK/Mono 字体面板</b>
        <span id="cjkPanelClose" style="cursor:pointer;font-weight:bold;font-size:20px;">×</span>
      </div>
      <div style="margin-bottom:8px;font-size:13px;color:#aaa;">当前站点：<strong>${CURRENT_HOST}</strong></div>
      <label style="display:flex;align-items:center;cursor:pointer;">
        <input type="checkbox" id="cjkToggle"> 启用脚本
      </label>
      <hr style="border:0;border-top:1px solid #555;margin:10px 0;">
      <div>正文 CJK 字体:</div>
      <select id="cjkFontSelect" style="width:100%;background:#333;color:#fff;border:1px solid #555;border-radius:4px;padding:4px;"></select>
      <div style="margin-top:8px;">代码字体:</div>
      <select id="codeFontSelect" style="width:100%;background:#333;color:#fff;border:1px solid #555;border-radius:4px;padding:4px;"></select>
      <div style="margin-top:10px;">
        <button id="resetToGlobal" style="width:100%;padding:6px 12px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;cursor:pointer;">重置为全局默认</button>
      </div>
      <hr style="border:0;border-top:1px solid #555;margin:12px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <b>站点黑名单</b>
        <button id="blacklistAddCurrent" style="font-size:11px;padding:3px 8px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;cursor:pointer;">+ 添加当前</button>
      </div>
      <div id="blacklistContainer" style="margin-top:8px;max-height:80px;overflow-y:auto;font-size:12px;"></div>
      <div style="margin-top:12px;text-align:right;">
        <button id="debugStorageBtn" style="font-size:11px;padding:2px 8px;background:#333;color:#aaa;border:1px solid #555;border-radius:3px;cursor:pointer;">调试存储</button>
      </div>
    `;

    document.body.appendChild(controlPanel);

    const cjkSelect = controlPanel.querySelector('#cjkFontSelect');
    const codeSelect = controlPanel.querySelector('#codeFontSelect');
    FONT_CHOICES.cjk.forEach(f => cjkSelect.innerHTML += `<option value="${f}">${f}</option>`);
    FONT_CHOICES.code.forEach(f => codeSelect.innerHTML += `<option value="${f}">${f}</option>`);

    const ui = {
      toggle: controlPanel.querySelector('#cjkToggle'),
      cjkSelect,
      codeSelect,
      resetBtn: controlPanel.querySelector('#resetToGlobal'),
      blContainer: controlPanel.querySelector('#blacklistContainer'),
      addBtn: controlPanel.querySelector('#blacklistAddCurrent'),
      closeBtn: controlPanel.querySelector('#cjkPanelClose'),
      debugBtn: controlPanel.querySelector('#debugStorageBtn'),
    };

    function ensureSelectValue(select, value) {
      select.value = value;
      if (select.value !== value) select.selectedIndex = 0;
    }

    ui.toggle.checked = CONFIG.enabled;
    ensureSelectValue(ui.cjkSelect, CONFIG.font.cjk);
    ensureSelectValue(ui.codeSelect, CONFIG.font.code);

    ui.toggle.addEventListener('change', async () => {
      CONFIG.enabled = ui.toggle.checked;
      await saveConfig();
      fullRescan();
    });

    ui.cjkSelect.addEventListener('change', async () => {
      if (!CONFIG.fonts.sites[CURRENT_HOST]) CONFIG.fonts.sites[CURRENT_HOST] = {};
      CONFIG.fonts.sites[CURRENT_HOST].cjk = ui.cjkSelect.value;
      CONFIG.font.cjk = ui.cjkSelect.value;
      await saveConfig();
      fullRescan();
    });

    ui.codeSelect.addEventListener('change', async () => {
      if (!CONFIG.fonts.sites[CURRENT_HOST]) CONFIG.fonts.sites[CURRENT_HOST] = {};
      CONFIG.fonts.sites[CURRENT_HOST].code = ui.codeSelect.value;
      CONFIG.font.code = ui.codeSelect.value;
      await saveConfig();
      fullRescan();
    });

    ui.resetBtn.addEventListener('click', async () => {
      delete CONFIG.fonts.sites[CURRENT_HOST];
      CONFIG.font = { ...CONFIG.fonts.default };
      await saveConfig();
      ensureSelectValue(ui.cjkSelect, CONFIG.font.cjk);
      ensureSelectValue(ui.codeSelect, CONFIG.font.code);
      fullRescan();
    });

    ui.closeBtn.addEventListener('click', () => {
      controlPanel.style.display = 'none';
    });

    ui.addBtn.addEventListener('click', async () => {
      if (!CONFIG.siteBlacklist.includes(CURRENT_HOST)) {
        CONFIG.siteBlacklist.push(CURRENT_HOST);
        await saveConfig();
        renderDomainList();
        fullRescan();
      }
    });

    ui.debugBtn.addEventListener('click', async () => {
      const saved = await GM_getValue(STORAGE_KEY, {});
      console.log('[CJK Font] Storage:', saved);
      console.log('[CJK Font] Current CONFIG.fonts.default:', CONFIG.fonts.default);
    });

    function renderDomainList() {
      ui.blContainer.innerHTML = '';
      if (CONFIG.siteBlacklist.length === 0) {
        ui.blContainer.innerHTML = '<span style="color:#888;">无</span>';
        return;
      }
      CONFIG.siteBlacklist.forEach(domain => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 0;';
        item.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${domain}</span>
          <button style="font-size:10px;padding:1px 6px;background:#500;color:#fff;border:1px solid #800;border-radius:3px;cursor:pointer;">移除</button>`;
        item.querySelector('button').addEventListener('click', async () => {
          CONFIG.siteBlacklist = CONFIG.siteBlacklist.filter(d => d !== domain);
          await saveConfig();
          renderDomainList();
          fullRescan();
        });
        ui.blContainer.appendChild(item);
      });
    }

    renderDomainList();
  }

  function togglePanel() {
    if (!controlPanel) createControlPanel();
    controlPanel.style.display = (controlPanel.style.display === 'none' || !controlPanel.style.display) ? 'block' : 'none';
  }

  function setupHotkey() {
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        e.stopImmediatePropagation();
        togglePanel();
      }
    }, true);
  }

  async function main() {
    await loadConfig();
    installCssVarGuard();
    if (isPatchActive()) {
      runOnDocument(document);
      startSentinelPolling();

      // history 路由 SPA：切卷/切章后重新扫一遍
      const rescanOnNav = () => {
        if (!isPatchActive()) return;
        setTimeout(() => {
          injectGlobalStyle(document);
          collectTextNodes(document.body);
        }, 50);
      };
      window.addEventListener('popstate', rescanOnNav);
      const _push = history.pushState;
      const _replace = history.replaceState;
      history.pushState = function () {
        const r = _push.apply(this, arguments);
        rescanOnNav();
        return r;
      };
      history.replaceState = function () {
        const r = _replace.apply(this, arguments);
        rescanOnNav();
        return r;
      };

      if (location.hostname.includes('x.ai') || location.hostname.includes('grok')) {
        const grokProtector = setInterval(() => {
          if (!isPatchActive()) { clearInterval(grokProtector); return; }
          document.querySelectorAll('[data-testid*="conversation-turn"], .prose, .markdown-body').forEach(el => {
            if (el.textContent && CJK_REGEX.test(el.textContent) && !el.hasAttribute(PATCH_ATTR)) {
              applyPatchToElement(el);
            }
          });
        }, 1000);
        window.addEventListener('unload', () => clearInterval(grokProtector), { once: true });
      }
    }
    setupHotkey();
  }

  main().catch(console.error);
})();