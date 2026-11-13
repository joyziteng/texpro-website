/* TEXPRO replica — interactions */
(function () {
  'use strict';

  var LANG = (document.documentElement.lang || 'en').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';

  /* ---------- Hero carousel ---------- */
  function initSlider() {
    var focus = document.querySelector('.m-focus');
    if (!focus) return;
    var slides = focus.querySelectorAll('.bd li');
    var dotsWrap = focus.querySelector('.hd ul');
    if (!slides.length || !dotsWrap) return;
    var idx = 0, timer = null, userPaused = false;
    var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduce = function () { return !!(reduceMq && reduceMq.matches); };

    var dots = [];
    slides.forEach(function (_, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', LANG === 'zh'
        ? ('第' + (i + 1) + '张，共' + slides.length + '张')
        : ('Go to slide ' + (i + 1) + ' of ' + slides.length));
      b.addEventListener('click', function () { go(i); start(); });
      li.appendChild(b);
      dotsWrap.appendChild(li);
      dots.push(li);
    });

    /* 图片就绪跟踪：轮播只在目标图已下载完成时才切，避免慢网络下切到空白黑屏 */
    var ready = {};
    function bgUrl(el) {
      if (!el) return '';
      var bg = el.style.backgroundImage || '';
      var m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (m) return m[1];
      return el.getAttribute('data-bg') || ''; // hero2-6 的懒加载地址
    }
    function preload(i) {
      var el = slides[i];
      if (!el) return;
      var url = bgUrl(el);
      if (!url) { ready[i] = true; return; }
      /* data-bg 尚未注入时提前注入，避免轮播切到「无背景」的 li */
      if (!el.style.backgroundImage) el.style.backgroundImage = 'url(' + url + ')';
      if (ready[i] !== undefined) return;
      ready[i] = false;
      var im = new Image();
      im.onload = function () { ready[i] = true; };
      im.onerror = function () { ready[i] = true; }; // 加载失败也放行，避免永远卡住
      im.src = url;
    }
    function preloadAhead() {
      preload(idx);
      preload((idx + 1) % slides.length);
      preload((idx + 2) % slides.length);
    }
    function readyAt(i) { return ready[i] === true; }
    function nearestReady(from, dir) {
      for (var step = 1; step <= slides.length; step++) {
        var cand = (from + dir * step + slides.length) % slides.length;
        if (readyAt(cand)) return cand;
      }
      return -1;
    }

    function go(n) {
      idx = (n + slides.length) % slides.length;
      slides.forEach(function (s, i) { s.classList.toggle('on', i === idx); });
      dots.forEach(function (d, i) { d.classList.toggle('on', i === idx); });
      preloadAhead();
    }
    function next() {
      var target = nearestReady(idx, 1);
      if (target >= 0) go(target);
      else preload((idx + 1) % slides.length); // 下一张未就绪：留在当前张，下个周期再试
    }
    function prevSlide() {
      var target = nearestReady(idx, -1);
      if (target >= 0) go(target);
      else preload((idx - 1 + slides.length) % slides.length);
    }
    function autoAllowed() { return !userPaused && !reduce(); }
    function start() { clearInterval(timer); timer = null; if (autoAllowed()) timer = setInterval(next, 4200); }

    var prev = focus.querySelector('.prev'), nxt = focus.querySelector('.next');
    if (prev) prev.addEventListener('click', function () { prevSlide(); start(); });
    if (nxt) nxt.addEventListener('click', function () { next(); start(); });

    /* 悬停暂停保留；离开时若用户未手动暂停且未开启减弱动效，则恢复自动播放 */
    focus.addEventListener('mouseenter', function () { clearInterval(timer); timer = null; });
    focus.addEventListener('mouseleave', start);

    /* 左右方向键切换（整屏翻页脚本只占用上下方向键，无冲突） */
    focus.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { go(idx - 1); start(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { go(idx + 1); start(); e.preventDefault(); }
    });

    /* 可见「暂停/播放」按钮：⏸/▶ 图标 + 文案，aria-pressed 表状态，aria-label 表动作 */
    var ICON_PAUSE = '<svg viewBox="0 0 12 12" width="11" height="11" fill="currentColor" aria-hidden="true"><rect x="1.5" y="1" width="3" height="10" rx="1"/><rect x="7.5" y="1" width="3" height="10" rx="1"/></svg>';
    var ICON_PLAY = '<svg viewBox="0 0 12 12" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M2.8 1.1v9.8c0 .5.55.8 1 .55l7.8-4.9a.65.65 0 0 0 0-1.1L3.8.55c-.45-.25-1 .05-1 .55z"/></svg>';
    var pauseBtn = focus.querySelector('.hero-pause');
    if (pauseBtn) {
      var setPaused = function (p) {
        userPaused = p;
        pauseBtn.setAttribute('aria-pressed', p ? 'true' : 'false');
        pauseBtn.setAttribute('aria-label', LANG === 'zh'
          ? (p ? '播放自动轮播' : '暂停自动播放')
          : (p ? 'Resume auto-play' : 'Pause auto-play'));
        pauseBtn.innerHTML = (p ? ICON_PLAY : ICON_PAUSE) + '<span>' +
          ((LANG === 'zh') ? (p ? '播放' : '暂停') : (p ? 'Play' : 'Pause')) + '</span>';
        if (p) { clearInterval(timer); timer = null; } else start();
      };
      pauseBtn.addEventListener('click', function () { setPaused(!userPaused); });
      if (reduce()) pauseBtn.hidden = true; /* 无自动播放可暂停时隐藏 */
      if (reduceMq && reduceMq.addEventListener) {
        reduceMq.addEventListener('change', function (ev) {
          pauseBtn.hidden = !!ev.matches;
          if (ev.matches) { clearInterval(timer); timer = null; }
          else start();
        });
      }
    }

    /* 首屏：先预热第 0/1 张，首张就绪后再启动自动轮播（3s 兜底，避免图片挂了不播） */
    preload(0);
    preload(1);
    go(0);
    var started = false;
    function begin() { if (started) return; started = true; start(); }
    if (readyAt(0)) begin();
    else {
      var waitFrom = Date.now();
      (function wait() {
        if (readyAt(0) || Date.now() - waitFrom > 3000) { begin(); return; }
        setTimeout(wait, 100);
      })();
    }
  }

  /* ---------- Products tabs (left rail, hash deep-links) ---------- */
  function initProducts() {
    var layout = document.querySelector('.product-layout');
    if (!layout) return;
    var links = layout.querySelectorAll('.p-rail a');
    var panels = document.querySelectorAll('.p-panel');
    var title = document.getElementById('cat-title');

    function valid(key) {
      return !!key && /^[a-z]+$/.test(key) && !!document.querySelector('.p-panel[data-cat="' + key + '"]');
    }
    function activate(key, push) {
      var found = false;
      links.forEach(function (a) {
        var on = a.getAttribute('data-cat') === key;
        a.classList.toggle('current', on);
        if (on) { found = true; if (title) title.textContent = a.textContent; }
      });
      panels.forEach(function (p) {
        p.classList.toggle('active', p.getAttribute('data-cat') === key);
      });
      /* 切换分类时同步地址栏 hash（不产生历史记录），刷新/复制地址可回到同分类 */
      if (found && push !== false && history.replaceState)
        history.replaceState(null, '', '#' + key);
    }
    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        activate(a.getAttribute('data-cat'));
        window.scrollTo({ top: layout.offsetTop - 70, behavior: 'smooth' });
      });
    });

    function fromHash() {
      var h = (location.hash || '').replace('#', '');
      return valid(h) ? h : null;
    }
    /* 初始化：读 location.hash 选中对应分类 */
    var initial = fromHash();
    activate(initial || links[0].getAttribute('data-cat'), false);

    /* 前进/后退与手动改 hash 时同步选中态 */
    window.addEventListener('hashchange', function () {
      var k = fromHash();
      if (k) activate(k, false);
    });
    window.addEventListener('popstate', function () {
      var k = fromHash();
      activate(k || links[0].getAttribute('data-cat'), false);
    });
  }

  /* ---------- Mobile nav ---------- */
  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.m-nav');
    if (toggle && nav) {
      /* <button> 原生支持 Enter/Space 触发 click；这里同步 aria-expanded */
      function setOpen(open) {
        nav.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      toggle.addEventListener('click', function () {
        setOpen(!nav.classList.contains('open'));
      });
      /* Escape 关闭菜单并把焦点还给按钮 */
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('open')) {
          setOpen(false);
          toggle.focus();
        }
      });
      nav.querySelectorAll('.has-sub>a').forEach(function (a) {
        a.addEventListener('click', function (e) {
          if (window.innerWidth <= 980) { e.preventDefault(); a.parentNode.classList.toggle('open'); }
        });
      });
    }
  }

  /* ---------- Back to top ---------- */
  function initBackTop() {
    var btn = document.querySelector('.black');
    if (!btn) return;
    window.addEventListener('scroll', function () {
      btn.classList.toggle('show', window.scrollY > 400);
    }, { passive: true });
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ---------- Lightbox ---------- */
  function initLightbox() {
    var box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = '<span class="lb-close">&times;</span><img alt="">';
    document.body.appendChild(box);
    var img = box.querySelector('img');
    function open(src) { img.src = src; box.classList.add('show'); }
    function close() { box.classList.remove('show'); img.src = ''; }
    box.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.tagName === 'IMG' && (t.classList.contains('zoomable') ||
          t.closest('.p-grid') || t.closest('.pic-grid') || t.closest('.g-content') ||
          t.closest('.factory-media'))) {
        if (t.closest('.tile') || t.closest('.m-focus')) return;
        open(t.src);
      }
    });
  }

  /* ---------- Contact form — POST /inquiry.php ---------- */
  function initForm() {
    var form = document.querySelector('.contact-form form');
    if (!form) return;
    var note = form.querySelector('.form-note');
    var btn = form.querySelector('button[type="submit"]');
    if (!note || !btn) return;

    var L = {
      sending: LANG === 'zh' ? '正在发送…' : 'Sending…',
      ok: LANG === 'zh'
        ? '感谢留言！我们已收到您的询盘，销售团队将尽快与您联系。'
        : 'Thank you — we have received your inquiry and our sales team will reply soon.',
      failTitle: LANG === 'zh' ? '提交未成功：' : 'Submission failed: ',
      netfail: LANG === 'zh' ? '网络错误，请稍后重试。' : 'Network error, please try again later.',
      localHint: LANG === 'zh'
        ? '请按页面红框提示补全或修正填写项。'
        : 'Please complete or correct the highlighted fields above.',
      alt: LANG === 'zh'
        ? '或直接邮件 sandy@texpro.com.cn / 电话 +86 25 5287 6247'
        : 'Or email sandy@texpro.com.cn / call +86 25 5287 6247',
      fields: {
        name: LANG === 'zh' ? '姓名' : 'Name',
        email: LANG === 'zh' ? '电子邮箱' : 'Email',
        company: LANG === 'zh' ? '公司' : 'Company',
        category: LANG === 'zh' ? '意向品类' : 'Category',
        message: LANG === 'zh' ? '需求详情' : 'Message',
        rate: LANG === 'zh' ? '提交频率' : 'Submit rate',
        method: LANG === 'zh' ? '请求方式' : 'Request method',
        origin: LANG === 'zh' ? '请求来源' : 'Request origin',
        server: LANG === 'zh' ? '服务器' : 'Server'
      },
      reasons: {
        'required': LANG === 'zh' ? '必填' : 'required',
        'invalid email': LANG === 'zh' ? '格式不正确' : 'invalid format',
        'too long': LANG === 'zh' ? '超出长度限制' : 'too long',
        'too many requests': LANG === 'zh' ? '提交过于频繁，请一小时后再试' : 'too many submissions, please try again later',
        'POST required': LANG === 'zh' ? '请求方式不正确' : 'invalid request method',
        'forbidden': LANG === 'zh' ? '请求来源不被允许' : 'request origin not allowed',
        'storage error': LANG === 'zh' ? '服务器暂时不可用，请稍后重试或直接邮件联系' : 'server temporarily unavailable, please retry later or email us',
        'encoding error': LANG === 'zh' ? '内容包含无法识别的字符，请调整后重试' : 'content contains invalid characters, please adjust and retry'
      }
    };

    function setNote(kind, text) {
      note.classList.remove('ok', 'err');
      if (kind) note.classList.add(kind);
      note.textContent = text;
    }

    /* ---------- 本地即时校验：字段级红框 + 行内错误 + 焦点定位（免服务端往返） ---------- */
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function fieldOf(n) { return form.querySelector('[name="' + n + '"]'); }
    function markField(n, reason) {
      var el = fieldOf(n);
      var wrap = el && el.closest ? el.closest('.f-field') : null;
      if (!wrap) return;
      wrap.classList.add('err');
      var em = wrap.querySelector('.f-err');
      if (!em) { em = document.createElement('p'); em.className = 'f-err'; wrap.appendChild(em); }
      em.textContent = (L.fields[n] || n) + (LANG === 'zh' ? '：' : ': ') + (L.reasons[reason] || reason);
    }
    function clearField(n) {
      var el = fieldOf(n);
      var wrap = el && el.closest ? el.closest('.f-field') : null;
      if (!wrap) return;
      wrap.classList.remove('err');
      var em = wrap.querySelector('.f-err');
      if (em) em.remove();
    }
    function localValidate() {
      ['name', 'email', 'message'].forEach(clearField);
      var bad = [];
      var name = fieldOf('name'), email = fieldOf('email'), message = fieldOf('message');
      if (name && !String(name.value || '').trim()) { markField('name', 'required'); bad.push('name'); }
      if (email) {
        var ev = String(email.value || '').trim();
        if (!ev) { markField('email', 'required'); bad.push('email'); }
        else if (!EMAIL_RE.test(ev)) { markField('email', 'invalid email'); bad.push('email'); }
      }
      if (message && !String(message.value || '').trim()) { markField('message', 'required'); bad.push('message'); }
      if (bad.length) {
        var first = fieldOf(bad[0]);
        if (first && first.focus) first.focus();
        return false;
      }
      return true;
    }
    /* 修改已标红的字段时即时清除错误提示 */
    form.addEventListener('input', function (e) {
      var t = e.target;
      if (t.name && t.closest && t.closest('.f-field.err')) clearField(t.name);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!localValidate()) {
        setNote('err', L.failTitle + L.localHint + ' ' + L.alt);
        return;
      }
      var origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = L.sending;
      setNote(null, L.sending);

      var body = new URLSearchParams();
      new FormData(form).forEach(function (v, k) { body.append(k, String(v)); });

      function restore() { btn.disabled = false; btn.textContent = origText; }
      function fail(errors) {
        var msg = L.failTitle;
        if (errors) {
          /* 服务端字段错误同样落到字段级红框（与本地校验一致的反馈形态） */
          Object.keys(errors).forEach(function (f) { markField(f, errors[f]); });
          var parts = [];
          Object.keys(errors).forEach(function (f) {
            var label = L.fields[f] || f;
            var reason = L.reasons[errors[f]] || errors[f];
            parts.push(label + (LANG === 'zh' ? '：' : ': ') + reason);
          });
          msg += parts.join('；');
        } else {
          msg += L.netfail;
        }
        /* 失败保留全部输入，并给出邮件/电话替代路径 */
        setNote('err', msg + ' ' + L.alt);
        restore();
      }

      fetch('/inquiry.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body.toString()
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) {
            setNote('ok', L.ok);
            form.reset();
            restore();
          } else {
            fail(j && j.errors ? j.errors : null);
          }
        })
        .catch(function () { fail(null); });
    });
  }

  /* ---------- Footer year（noscript 静态回退为写入时的年份） ---------- */
  function initYear() {
    var y = String(new Date().getFullYear());
    document.querySelectorAll('.js-year').forEach(function (el) { el.textContent = y; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initSlider(); initProducts(); initNav(); initBackTop(); initLightbox(); initForm(); initYear();
  });
})();
