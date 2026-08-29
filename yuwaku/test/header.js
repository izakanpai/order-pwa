// 全画面共通ヘッダー。各HTMLに個別実装せず、config.jsから一度だけ読み込む。
(function () {
  'use strict';
  if (window.IZHeader) return;

  var CFG = window.APP_CONFIG || {};
  var PREFIX = CFG.AUTH_STORAGE_PREFIX || '';
  var state = { timezone: '', timer: null, clock: null, user: null, lang: null };

  function pageName(pathname) {
    var p = String(pathname || '').split(/[?#]/)[0].replace(/\\/g, '/');
    var last = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    return last || 'index.html';
  }

  // 署名の真正性はサーバーで検証する。ここでは期限・環境を含む構造だけを確認し、
  // 期限切れトークンでログイン者名を表示し続けないために使用する。
  function validSession(token, now) {
    if (typeof token !== 'string') return false;
    var dot = token.lastIndexOf('.'), parts = token.slice(0, dot).split('~');
    var audience = CFG.TEST_ENV ? 'test' : 'production';
    return dot > 0 && /^[a-f0-9]{64}$/.test(token.slice(dot + 1)) && parts.length === 6 &&
      parts[0] === 'v2' && Number(parts[1]) > Number(now == null ? Date.now() : now) &&
      !!parts[2] && !!parts[3] && !!parts[4] && parts[5] === audience;
  }

  function pagePolicy(pathname, loggedIn) {
    var page = pageName(pathname);
    var customerOrder = page === 'index.html' || page === 'takeout.html';
    return {
      page: page,
      customerOrder: customerOrder,
      showBack: !customerOrder,
      showManage: !!loggedIn && page !== 'manage.html',
      showUser: !!loggedIn,
    };
  }

  function readSession() {
    try {
      var token = localStorage.getItem(PREFIX + 'mgmtToken') || '';
      return {
        loggedIn: validSession(token),
        token: token,
        name: localStorage.getItem(PREFIX + 'mgmtName') || '',
        role: localStorage.getItem(PREFIX + 'mgmtRole') || '',
      };
    } catch (e) { return { loggedIn: false, token: '', name: '', role: '' }; }
  }

  function currentLang() {
    try {
      if (window.I18n && typeof window.I18n.lang === 'function') return window.I18n.lang();
      return localStorage.getItem('lang') === 'ja' ? 'ja' : 'en';
    } catch (e) { return 'en'; }
  }

  function validTimezone(value) {
    var tz = String(value || '').trim();
    if (!tz) return '';
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone; }
    catch (e) { return ''; }
  }

  function cachedTimezone() {
    try { return validTimezone(localStorage.getItem(PREFIX + 'storeTimezone')); }
    catch (e) { return ''; }
  }

  function saveTimezone(value) {
    var tz = validTimezone(value);
    if (!tz) return;
    state.timezone = tz;
    try { localStorage.setItem(PREFIX + 'storeTimezone', tz); } catch (e) {}
    renderClock();
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function wallClockParts(date, timezone) {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    var out = {};
    parts.forEach(function (p) { if (p.type !== 'literal') out[p.type] = p.value; });
    return out.year + '-' + pad(out.month) + '-' + pad(out.day) + ' ' + pad(out.hour) + ':' + pad(out.minute) + ':' + pad(out.second);
  }

  function renderClock() {
    if (!state.clock) return;
    var tz = state.timezone || cachedTimezone() || validTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
    try { state.clock.textContent = wallClockParts(new Date(), tz); }
    catch (e) { state.clock.textContent = ''; }
    state.clock.title = tz;
  }

  function text(isJa, ja, en) { return isJa ? ja : en; }
  function renderLanguage() {
    var isJa = currentLang() === 'ja';
    if (state.lang) {
      state.lang.textContent = isJa ? 'EN' : '日本語';
      state.lang.setAttribute('aria-label', text(isJa, '英語へ切替', 'Switch to Japanese'));
      state.lang.title = state.lang.getAttribute('aria-label');
    }
    var refresh = document.getElementById('izHeaderRefresh');
    var manage = document.getElementById('izHeaderManage');
    var back = document.getElementById('izHeaderBack');
    if (refresh) { refresh.textContent = text(isJa, '↻ 更新', '↻ Refresh'); refresh.title = text(isJa, '画面を更新', 'Refresh page'); }
    if (manage) { manage.textContent = text(isJa, '⌂ 管理', '⌂ Manage'); manage.title = text(isJa, '管理メニューに戻る', 'Return to management menu'); }
    if (back) { back.textContent = text(isJa, '← 戻る', '← Back'); back.title = text(isJa, '前の画面に戻る', 'Go back'); }
  }

  function switchLanguage() {
    if (window.I18n && typeof window.I18n.toggle === 'function') window.I18n.toggle();
    else if (typeof window.toggleLang === 'function') window.toggleLang();
    else {
      try { localStorage.setItem('lang', currentLang() === 'ja' ? 'en' : 'ja'); } catch (e) {}
      location.reload();
    }
    setTimeout(renderLanguage, 0);
  }

  function goBack(policy) {
    try {
      if (document.referrer && new URL(document.referrer).origin === location.origin) { history.back(); return; }
    } catch (e) {}
    location.href = policy.showManage ? './manage.html' : './';
  }

  function button(id, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.id = id; b.className = 'iz-header-btn'; b.textContent = label; b.onclick = onClick;
    return b;
  }

  function findLegacyHeader(page) {
    var selectors = ['body > .head', 'body > .kds-head', 'body > .header', 'body > .appbar', 'body > .bar'];
    for (var i = 0; i < selectors.length; i++) {
      var found = document.querySelector(selectors[i]); if (found) return found;
    }
    if (page === 'reserve.html') return document.querySelector('.rhead');
    if (page === 'takeout.html') return document.querySelector('.to-head');
    if (page === 'bridge.html') {
      var h = document.querySelector('body h1'); return h && h.parentElement;
    }
    return null;
  }

  function isOldCommon(el) {
    if (!el || el.nodeType !== 1) return true;
    var id = el.id || '', href = el.getAttribute && (el.getAttribute('href') || '');
    var click = el.getAttribute && (el.getAttribute('onclick') || '');
    return el.hasAttribute('data-tlang') || /(?:langBtn|langToggle|headClock|appbarClock|mgmtBack)/i.test(id) ||
      /manage\.html/i.test(href) || /(?:I18n\.toggle|toggleLang|reloadAll|location\.reload|^reload\(\))/i.test(click);
  }

  function takeLegacyExtras(legacy, extra) {
    if (!legacy) return;
    var title = legacy.querySelector('h1,.title,.kds-title,.to-shop');
    var titleSlot = document.getElementById('izHeaderTitle');
    if (title && titleSlot) { titleSlot.textContent = ''; titleSlot.appendChild(title); }
    var candidates = Array.prototype.slice.call(legacy.querySelectorAll('button,a'));
    ['cnt', 'kcount', 'tableChip', 'tagTakeout'].forEach(function (id) {
      var el = legacy.querySelector('#' + id); if (el) candidates.push(el);
    });
    candidates.forEach(function (el) {
      if (isOldCommon(el) || extra.contains(el)) return;
      extra.appendChild(el);
    });
    legacy.style.display = 'none';
    if (extra.children.length) extra.hidden = false;
    ['mgmtBackBtn', 'mgmtBack', 'langBtn', 'langToggle'].forEach(function (id) {
      var el = document.getElementById(id); if (el && !el.closest('#izCommonHeader')) el.style.display = 'none';
    });
  }

  function addStyles() {
    if (document.getElementById('izHeaderStyle')) return;
    var s = document.createElement('style'); s.id = 'izHeaderStyle';
    s.textContent =
      '#izCommonHeader{position:sticky;top:0;z-index:2147483000;background:#0f172a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;box-shadow:0 1px 0 rgba(255,255,255,.1)}' +
      '#izCommonHeader .iz-header-main{display:flex;align-items:center;gap:10px;padding:10px 14px;min-height:58px;flex-wrap:wrap}' +
      '#izHeaderTitle{font-size:17px;font-weight:900;line-height:1.25;flex:1 1 180px;min-width:120px}' +
      '#izHeaderTitle>*{font:inherit!important;margin:0!important;color:inherit!important}' +
      '#izHeaderMeta,#izHeaderActions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}' +
      '.iz-header-clock,.iz-header-user{font-size:12px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums;background:rgba(255,255,255,.1);padding:7px 9px;border-radius:8px}' +
      '.iz-header-user{max-width:180px;overflow:hidden;text-overflow:ellipsis}' +
      '.iz-header-btn{border:0;border-radius:8px;background:rgba(255,255,255,.15);color:#fff;padding:8px 10px;min-height:34px;font:800 12px/1.2 inherit;cursor:pointer;white-space:nowrap}' +
      '.iz-header-btn:hover{background:rgba(255,255,255,.25)}' +
      '#izHeaderExtra{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:7px 14px;background:#0b1220;border-top:1px solid rgba(255,255,255,.08)}' +
      '#izHeaderExtra[hidden]{display:none}' +
      '#izHeaderExtra a,#izHeaderExtra button{margin:0!important}' +
      '@media(max-width:720px){#izCommonHeader .iz-header-main{gap:7px;padding:8px 10px}#izHeaderTitle{flex-basis:100%;font-size:15px}#izHeaderMeta{flex:1}.iz-header-clock{font-size:11px}.iz-header-user{max-width:130px}.iz-header-btn{padding:7px 8px;font-size:11px}}' +
      '@media(max-width:430px){.iz-header-clock{font-size:10px}.iz-header-user{max-width:110px}#izHeaderActions{gap:5px}}';
    document.head.appendChild(s);
  }

  function fetchTimezone(session, policy) {
    var payload = { __silent: true, __noInternalRetry: true, __timeoutMs: 4500 };
    var action = session.loggedIn ? 'getSettings' : 'bootstrap';
    if (session.loggedIn) payload.token = session.token;
    var request;
    if (window.API && typeof window.API.post === 'function') {
      request = window.API.post(action, payload);
    } else if (CFG.API_URL && typeof fetch === 'function') {
      // clock/bridge/overview等、api.jsを使わない画面も同じ店舗標準時間を表示する。
      // 読取1回・4.5秒上限・自動再試行なしとし、失敗時はキャッシュまたは端末時刻を維持する。
      var ctrl = new AbortController();
      var timeout = setTimeout(function () { ctrl.abort(); }, 4500);
      var body = { action: action };
      if (session.loggedIn) body.token = session.token;
      request = fetch(CFG.API_URL + '?api=1', {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body), redirect: 'follow', signal: ctrl.signal,
      }).then(function (res) { if (!res.ok) throw new Error('http_' + res.status); return res.json(); })
        .finally(function () { clearTimeout(timeout); });
    } else return;
    request.then(function (r) {
      // GAS互換bootstrap/getSettingsはフラット、ネイティブ経路はdata配下で返るため両方を扱う。
      var d = (r && r.data) || r || {};
      var settings = d.settings || d;
      saveTimezone(settings.timezone);
    }).catch(function () {});
  }

  function init() {
    if (!document.body || document.getElementById('izCommonHeader')) return;
    addStyles();
    var session = readSession(), policy = pagePolicy(location.pathname, session.loggedIn);
    var legacy = findLegacyHeader(policy.page);
    var header = document.createElement('header'); header.id = 'izCommonHeader';
    var main = document.createElement('div'); main.className = 'iz-header-main';
    var title = document.createElement('div'); title.id = 'izHeaderTitle'; title.textContent = document.title || '';
    var meta = document.createElement('div'); meta.id = 'izHeaderMeta';
    var clock = document.createElement('span'); clock.id = 'izHeaderClock'; clock.className = 'iz-header-clock'; meta.appendChild(clock); state.clock = clock;
    if (policy.showUser && session.name) {
      var user = document.createElement('span'); user.id = 'izHeaderUser'; user.className = 'iz-header-user';
      user.textContent = '👤 ' + session.name + (session.role ? ' (' + session.role + ')' : ''); meta.appendChild(user); state.user = user;
    }
    var actions = document.createElement('div'); actions.id = 'izHeaderActions';
    var lang = button('izHeaderLang', '', switchLanguage); lang.setAttribute('data-tlang', ''); actions.appendChild(lang); state.lang = lang;
    actions.appendChild(button('izHeaderRefresh', '↻', function () { location.reload(); }));
    if (policy.showManage) actions.appendChild(button('izHeaderManage', '⌂', function () { location.href = './manage.html'; }));
    if (policy.showBack) actions.appendChild(button('izHeaderBack', '←', function () { goBack(policy); }));
    main.appendChild(title); main.appendChild(meta); main.appendChild(actions); header.appendChild(main);
    var extra = document.createElement('div'); extra.id = 'izHeaderExtra'; extra.hidden = true; header.appendChild(extra);
    document.body.insertBefore(header, document.body.firstChild);
    takeLegacyExtras(legacy, extra);
    state.timezone = cachedTimezone(); renderClock(); renderLanguage();
    state.timer = setInterval(renderClock, 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) renderClock(); });
    window.addEventListener('storage', function () { renderLanguage(); renderClock(); });
    try { new MutationObserver(renderLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] }); } catch (e) {}
    fetchTimezone(session, policy);
  }

  window.IZHeader = { init: init, validSession: validSession, pagePolicy: pagePolicy, wallClockParts: wallClockParts, saveTimezone: saveTimezone };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})();
