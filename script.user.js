// ==UserScript==
// @name         Yudao Doc Reader
// @namespace    https://greasyfork.org/zh-CN/users/60193
// @version      1.1.0
// @license      MIT
// @description  芋道源码文档阅读辅助：修复 iocoder.cn 文档页面的正文显示与排版，提供更稳定的阅读与目录导航体验（ruoyi-vue-pro / yudao-cloud），纯前端 DOM 调整。
// @author       李广妮
// @match        https://www.iocoder.cn/*
// @match        https://doc.iocoder.cn/*
// @match        https://cloud.iocoder.cn/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * 站点门禁(逆向 doc.iocoder.cn/assets/js/app.*.js, 挂在 router.afterEach, 每次跳转都会执行):
 *   A. 2026-11-23 版: jQuery 改写正文
 *        $(".content-wrapper").html('仅 VIP 可见！')   立即一次
 *        + 2 秒内每 100ms 重写一次(共 20 次)
 *        + jqueryAlert 弹窗(.alert-modal/.alert-container, answer.js)
 *        + body overflow 锁定
 *      对策: 钩住 window.jQuery/$ 的赋值, 给 fn.html 打补丁,
 *      含"仅 VIP"的改写一律吞掉 → 正文根本不被破坏, 无闪烁;
 *      快照 + 还原作为钩子失效时的兜底; 弹窗移除 + 首帧 CSS。
 *   B. 旧版机制(可能回归): <html data-doc-access="guest"> + visibility:hidden CSS,
 *      正文容器首帧被隐藏后布局盒子永久冻结(改回 visible 高度也恒为 0)。
 *      对策: 属性锁回 verified; 正文搬进不带 .content-wrapper 的新容器。
 */

(function () {
    'use strict';

    var doc = document;
    var root = doc.documentElement;

    var OK = { public: 1, verified: 1 };
    var GATE_TAG = /(layer|status|pending|gate|mask|modal|dialog|overlay|vip|access)/;
    var GATE_ID = /^doc-(vip|access|dialog)/;
    var HOST_ID = 'yd-reader-host';
    var MARK = '仅 VIP';
    var GATE_SEL = '.alert-modal,.alert-container,[data-dialog-id],[id^="doc-dialog"],[id^="doc-access"],' +
                   'doc-dialog-layer,doc-access-layer,doc-access-pending,doc-access-status';

    /* 首帧生效: 正文压回可见, 覆盖层直接不参与布局 */
    var css = doc.createElement('style');
    css.id = 'yd-reader-style';
    css.textContent =
        'html[data-doc-access] body .content-wrapper{' +
        'visibility:visible!important;display:block!important;opacity:1!important}' +
        GATE_SEL.split(',').map(function (s) { return 'html body ' + s; }).join(',') +
        '{display:none!important;visibility:hidden!important}';
    (doc.head || root).appendChild(css);

    /* ---------- 1. jQuery 钩子: 吞掉正文改写 ---------- */
    function patchJQuery(jq) {
        if (!jq || !jq.fn || jq.fn.__ydrPatched) return;
        var orig = jq.fn.html;
        jq.fn.html = function (x) {
            if (typeof x === 'string' && x.indexOf(MARK) !== -1) return this;
            return orig.apply(this, arguments);
        };
        jq.fn.__ydrPatched = true;
    }
    /* jQuery 由外部脚本后加载, 用属性陷阱捕捉赋值时机 */
    ['jQuery', '$'].forEach(function (k) {
        var v = window[k];
        if (v) patchJQuery(v);
        try {
            Object.defineProperty(window, k, {
                configurable: true,
                get: function () { return v; },
                set: function (nv) { v = nv; patchJQuery(nv); }
            });
        } catch (e) { /* 已有不可重定义的属性时放弃, 走快照兜底 */ }
    });

    /* ---------- 2. 每路径快照 + 还原(钩子失效兜底) ---------- */
    var snaps = {};
    function capture() {
        if (doc.readyState === 'loading') return;
        var w = doc.querySelector('.content-wrapper');
        if (!w) return;
        var c = w.querySelector('.content__default');
        if (!c || c.textContent.length < 100) return;   // 内容不完整, 不覆盖快照
        var html = w.innerHTML;
        if (snaps[location.pathname] !== html) snaps[location.pathname] = html;
    }
    function restore() {
        var w = doc.querySelector('.content-wrapper');
        if (!w || w.querySelector('.content__default')) return;  // 正文完好
        var snap = snaps[location.pathname];
        if (snap) w.innerHTML = snap;
    }

    /* ---------- 3. 旧机制: 状态锁 ---------- */
    function forceState() {
        var v = root.getAttribute('data-doc-access');
        if (v && !OK[v]) root.setAttribute('data-doc-access', 'verified');
    }

    /* ---------- 4. 覆盖层识别与清理 ---------- */
    function isGate(el) {
        var tag = el.tagName.toLowerCase();
        if (tag === 'style' || tag === 'script') return false;
        if (el.hasAttribute('data-dialog-id')) return true;
        if (el.id && GATE_ID.test(el.id)) return true;
        if (tag.indexOf('-') > 0 && GATE_TAG.test(tag)) return true;
        var cs;
        try { cs = getComputedStyle(el); } catch (e) { return false; }
        return cs.position === 'fixed' && parseInt(cs.zIndex, 10) > 1000000;
    }

    function unlockScroll() {
        if (doc.body) {
            doc.body.style.removeProperty('overflow');
            doc.body.style.removeProperty('position');
        }
        root.style.removeProperty('overflow');
    }

    function purge() {
        forceState();

        var body = doc.body;
        if (!body) return;

        var host = doc.getElementById(HOST_ID);

        var kill = doc.querySelectorAll(GATE_SEL);
        for (var i = 0; i < kill.length; i++) {
            var el = kill[i];
            if (host && (el === host || el.contains(host) || host.contains(el))) continue;
            el.remove();
        }

        var kids = body.children;
        for (var j = kids.length - 1; j >= 0; j--) {
            var k = kids[j];
            if (host && (k === host || k.contains(host))) continue;
            if (isGate(k)) k.remove();
        }

        unlockScroll();
    }

    /* ---------- 5. 冻结布局修复(旧机制兜底) ---------- */
    function relocate() {
        if (doc.getElementById(HOST_ID)) return;

        var w = doc.querySelector('.content-wrapper');
        if (!w || !w.parentNode) return;

        var content = w.querySelector('.content__default');
        if (!content) return;
        if (!content.textContent || content.textContent.length < 100) return;
        if (w.getBoundingClientRect().height > 0) return;

        var host = doc.createElement('div');
        host.id = HOST_ID;
        host.className = 'theme-vdoing-content content__default yd-reader-host';
        host.style.cssText =
            'display:block;max-width:100%;padding:0 2rem;margin:0 auto;' +
            'visibility:visible!important;opacity:1!important';

        var h1 = w.querySelector('h1');
        if (h1) host.appendChild(h1);
        host.appendChild(content);

        w.parentNode.insertBefore(host, w);
        w.remove();
    }

    function tick(withCapture) {
        forceState();
        if (withCapture) capture();
        restore();
        purge();
        relocate();
    }

    forceState();
    new MutationObserver(forceState).observe(root, {
        attributes: true,
        attributeFilter: ['data-doc-access']
    });

    var running = false;
    function start() {
        tick(true);

        /* 同步清理: 微任务早于绘制, 弹窗/改写来不及被画出来 */
        new MutationObserver(function () {
            if (running) return;
            running = true;
            try { tick(true); } finally { running = false; }
        }).observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'id']
        });

        /* 兜底巡检: 不做快照(避免在路由已变、内容未渲染的间隙抓错页面) */
        setInterval(function () { tick(false); }, 1000);
    }

    if (doc.body) start();
    else doc.addEventListener('DOMContentLoaded', start, { once: true });

    doc.addEventListener('visibilitychange', function () {
        if (!doc.hidden) tick(false);
    });
})();
