/* ============================================================
   整屏翻页滚动 — fullpage-scroll.js
   来源：莎夏尚品官网（整理后可复用到任意项目）

   依赖结构：
   <html>                                ← page-transition class 会加在这里
     <body>
       <div class="page-stack">          ← 面板容器
         <div class="relative"><section class="snap-section">第1屏</section></div>
         <div class="relative"><section class="snap-section">第2屏</section></div>
         ...
       </div>
     </body>

   依赖样式：page-transition.css
   ============================================================ */
(function () {
  'use strict';

  var CONFIG = {
    // 重要：root 必须是 <html>（document.documentElement）
    // ——CSS 选择器前缀是 html.page-transition，class 加在别的元素上会导致隐藏/动画规则全部失效
    rootSelector: null, // null = document.documentElement
    stackSelector: '.page-stack',
    sectionSelector: '.snap-section',
    mobileBreakpoint: '(max-width: 767px)',
    initDelay: 800,        // 框架重渲染后初始化更稳
    animDuration: 800,     // 与 CSS transform 1s 动画同步
    wheelThrottle: 34,     // 滚轮节流（ms）
    touchThreshold: 40,    // 触摸翻页位移阈值（px）
    retryTimes: 30
  };

  var root, stack, panels, nums = 0, index = 0, animating = false, inited = false;

  function collect() {
    root = CONFIG.rootSelector ? document.querySelector(CONFIG.rootSelector) : document.documentElement;
    if (!root) return false;
    stack = root.querySelector(CONFIG.stackSelector);
    if (!stack) return false;
    panels = [].filter.call(stack.children, function (el) { return el.tagName === 'DIV'; });
    if (panels.length < 2) return false;
    nums = panels.length;
    return true;
  }

  function playEnter() {
    var cur = panels[index];
    cur.classList.remove('page-play', 'page-visible');
    void cur.offsetWidth; // 强制重排以重放动画
    cur.classList.add('page-play');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { cur.classList.add('page-visible'); });
    });
  }

  function render() {
    panels.forEach(function (p, i) {
      var near = Math.abs(i - index) <= 1;                 // 仅渲染相邻屏
      p.classList.toggle('page-near', near);
      p.style.transform = 'translateY(' + ((i - index) * 100) + '%)';
      p.classList.toggle('page-visible', i === index);
    });
    // 最后一屏释放原生滚动（长页脚可滚），其余屏锁定；锁定时窗口滚动归零，
    // 否则面板（按文档坐标排布）会整体上移错位、头部被滚出视口
    document.body.style.overflowY = (index === nums - 1) ? 'auto' : 'hidden';
    if (index !== nums - 1) window.scrollTo(0, 0);
    playEnter();
  }

  function goTo(i) {
    if (animating) return;
    i = Math.max(0, Math.min(nums - 1, i));
    if (i === index) return;
    index = i;
    animating = true;
    render();
    setTimeout(function () {
      animating = false;
      // Chrome 合成层缺陷规避：transform 动画落位后层可能不重栅格化（表现为整屏黑块），
      // 以无过渡微扰强制两帧重绘（0.01%≈0.07px，视觉不可感知）
      var cur = panels[index];
      if (cur) {
        cur.style.transition = 'none';
        cur.style.transform = 'translateY(0.01%)';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            cur.style.transform = 'translateY(0%)';
            cur.style.transition = '';
          });
        });
      }
    }, CONFIG.animDuration);
  }

  /* 量取大头部实际高度写入 CSS 变量：翻页面板高度=视口-头部，底部内容不再被推出视口 */
  function measureHeader() {
    var hd = document.querySelector('header.m-nav');
    root.style.setProperty('--hdr-h', (hd ? hd.offsetHeight : 0) + 'px');
  }

  function init() {
    if (inited) return true;
    if (!collect()) return false;
    if (root.classList.contains('page-transition')) return true;

    root.classList.add('page-transition');
    stack.classList.add('page-stack');
    measureHeader();

    // 初始化定位（无动画）
    panels.forEach(function (p, i) {
      p.classList.add('page-panel', 'no-anim');
      p.style.transform = 'translateY(' + (i * 100) + '%)';
    });
    index = 0;
    render();
    panels.forEach(function (p) { p.classList.remove('no-anim'); });

    bindEvents();
    inited = true;
    return true;
  }

  function bindEvents() {
    // 头部尺寸随窗口变化时重测（字号/换行会影响头部高度）
    window.addEventListener('resize', function () {
      if (inited) measureHeader();
    });
    // 1) 滚轮：屏内可滚动时先滚屏内，到底再翻页
    var wheelLock = false;
    window.addEventListener('wheel', function (e) {
      if (animating || wheelLock) return;
      wheelLock = true;
      setTimeout(function () { wheelLock = false; }, CONFIG.wheelThrottle);
      var sec = panels[index].querySelector(CONFIG.sectionSelector);
      var canScroll = sec && sec.scrollHeight > sec.clientHeight + 1;
      if (e.deltaY > 0) {
        if (index < nums - 1 && (!canScroll || sec.scrollTop >= sec.scrollHeight - sec.clientHeight - 2)) goTo(index + 1);
        else if (canScroll) sec.scrollTop += Math.min(e.deltaY, 80);
      } else if (e.deltaY < 0) {
        if (canScroll && sec.scrollTop > 0) sec.scrollTop -= Math.min(-e.deltaY, 80);
        else goTo(index - 1);
      }
    }, { passive: true });

    // 2) 键盘
    window.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); goTo(index + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); goTo(index - 1); }
    });

    // 3) 触摸滑动
    var sy = 0, sx = 0;
    window.addEventListener('touchstart', function (e) {
      sy = e.touches[0].clientY; sx = e.touches[0].clientX;
    }, { passive: true });
    window.addEventListener('touchend', function (e) {
      var dy = sy - e.changedTouches[0].clientY;
      var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dy) > CONFIG.touchThreshold && Math.abs(dy) > Math.abs(dx)) {
        if (dy > 0) goTo(index + 1); else goTo(index - 1);
      }
    }, { passive: true });

    // 4) 点击导航点（容器内 button 的顺序即页码）
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var btn = t.closest('button');
      if (!btn) return;
      var box = btn.closest('[aria-label="页面导航"]');
      if (!box) return;
      var i = Array.prototype.indexOf.call(box.children, btn);
      if (i >= 0) { e.preventDefault(); e.stopPropagation(); goTo(i); }
    }, true);

    // 断点切换：切到移动端时销毁翻页，恢复自然滚动
    var mq = window.matchMedia(CONFIG.mobileBreakpoint);
    var onChange = function (ev) {
      if (ev.matches) destroy();
      else if (!inited) boot();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  function destroy() {
    if (!inited) return;
    root.classList.remove('page-transition');
    if (stack) stack.classList.remove('page-stack');
    panels.forEach(function (p) {
      p.classList.remove('page-panel', 'page-near', 'page-visible', 'page-play', 'no-anim');
      p.style.transform = '';
    });
    document.body.style.overflowY = '';
    inited = false;
  }

  function boot() {
    // 移动端不启用整屏翻页（用自然滚动）
    if (window.matchMedia(CONFIG.mobileBreakpoint).matches) return;
    var tries = 0;
    function run() {
      tries++;
      if (init()) return;
      if (tries < CONFIG.retryTimes) setTimeout(run, 400);
    }
    if (document.readyState === 'complete') setTimeout(run, CONFIG.initDelay);
    else window.addEventListener('load', function () { setTimeout(run, CONFIG.initDelay); });
  }

  // 对外暴露（可选调用：window.fullpage.goTo(2)）
  window.fullpage = { goTo: goTo, destroy: destroy, init: boot };
  boot();
})();
