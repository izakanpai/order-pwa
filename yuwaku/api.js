// API クライアント ＋ オフライン送信キュー（IndexedDB）
// GASは Content-Type: text/plain でPOSTするとプリフライトを回避できる。
(function () {
  const CFG = Object.freeze(Object.assign({}, window.APP_CONFIG || {}));
  const AUTH_PREFIX = CFG.AUTH_STORAGE_PREFIX;
  const API = {};

  function publicStoreFromQuery() {
    if (typeof location === 'undefined') return '';
    var storeId = String(new URLSearchParams(location.search).get('store') || '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]{2,31}$/.test(storeId) ? storeId : '';
  }

  // 同一originの本番／テスト間で、古い親Service Workerが別環境のconfig.jsを返しても
  // データ取得前にfail closedする。認証情報は削除せず、誤環境での表示とAPI通信だけを止める。
  function environmentMismatch() {
    var pathIsTest = /\/test(?:\/|$)/i.test(location.pathname);
    var configIsTest = CFG.TEST_ENV === true || /^test$/i.test(String(CFG.VERSION || '')) || /api-test\./i.test(String(CFG.API_URL || ''));
    var localTestApi = pathIsTest && CFG.TEST_ENV === true && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(String(CFG.API_URL || ''));
    var env = pathIsTest ? 'test' : 'production';
    var expectedPrefix = 'izakanpai:' + env + ':';
    var expectedDb = 'izakanpai-pos-' + env;
    if (CFG.PUBLIC_ORDER === true) {
      var publicStoreId = publicStoreFromQuery();
      if (!publicStoreId) return true;
      expectedPrefix += 'public-order:' + publicStoreId + ':';
      expectedDb += '-public-order-' + publicStoreId;
    }
    return pathIsTest !== configIsTest || CFG.AUTH_SCHEMA_VERSION !== 2 ||
      AUTH_PREFIX !== expectedPrefix ||
      CFG.STORAGE_PREFIX !== expectedPrefix || CFG.OFFLINE_DB_NAME !== expectedDb ||
      (!/^https:\/\//i.test(String(CFG.API_URL || '')) && !localTestApi) ||
      (!localTestApi && /api-test\./i.test(String(CFG.API_URL || '')) !== pathIsTest);
  }
  function blockEnvironmentMismatch() {
    if (!environmentMismatch() || document.getElementById('izEnvMismatch')) return;
    var el = document.createElement('div');
    el.id = 'izEnvMismatch';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;color:#991b1b;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:700 18px/1.6 sans-serif';
    el.textContent = '環境情報が一致しないため表示を停止しました。ページを再読み込みしてください。 / Environment mismatch. Reload this page.';
    (document.body || document.documentElement).appendChild(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', blockEnvironmentMismatch, { once: true });
  else blockEnvironmentMismatch();
  window.addEventListener('pageshow', blockEnvironmentMismatch);
  API.authReady = function () {
    blockEnvironmentMismatch();
    return !environmentMismatch();
  };
  function storedToken() {
    try { return localStorage.getItem(AUTH_PREFIX + 'mgmtToken') || ''; } catch (e) { return ''; }
  }
  function storedRefreshToken() {
    try { return localStorage.getItem(AUTH_PREFIX + 'mgmtRefreshToken') || ''; } catch (e) { return ''; }
  }
  // Structural validation only; authenticity/authorization always remains server-side.
  function tokenInfo(token, allowExpired) {
    if (typeof token !== 'string') return null;
    var dot = token.lastIndexOf('.'), parts = token.slice(0, dot).split('~');
    if (dot < 0 || !/^[a-f0-9]{64}$/.test(token.slice(dot + 1)) ||
        !((parts.length === 6 && parts[0] === 'v2') || (parts.length === 7 && parts[0] === 'v3')) ||
        !Number.isFinite(Number(parts[1])) || (!allowExpired && Number(parts[1]) <= Date.now()) ||
        !parts[2] || !parts[3] || !parts[4] || parts[5] !== (CFG.TEST_ENV ? 'test' : 'production')) return null;
    return { version:parts[0], exp:Number(parts[1]), role:parts[2], store:parts[3], uid:parts[4], audience:parts[5], sessionId:parts[6]||'' };
  }
  function validRefreshToken(token) {
    return /^(?:r1\.[0-9a-f-]{36}\.[0-9a-f]{64}|r2\.[a-z0-9][a-z0-9-]{0,31}\.[0-9a-f-]{36}\.[0-9a-f]{64})$/i.test(String(token || ''));
  }
  API.acceptLogin = function (r) {
    if (!API.authReady()) throw new Error('environment_mismatch');
    var info = tokenInfo(r && r.token);
    if (!info || info.role !== r.role) throw new Error('invalid_login_response');
    // Token is written last: partially failed persistence must not announce login success.
    localStorage.setItem(AUTH_PREFIX + 'mgmtName', r.name || '');
    localStorage.setItem(AUTH_PREFIX + 'mgmtRole', r.role);
    if (info.version === 'v3') {
      if (!validRefreshToken(r.refreshToken)) throw new Error('invalid_login_response');
      localStorage.setItem(AUTH_PREFIX + 'mgmtRefreshToken', r.refreshToken);
    } else localStorage.removeItem(AUTH_PREFIX + 'mgmtRefreshToken');
    localStorage.setItem(AUTH_PREFIX + 'mgmtToken', r.token);
    if (storedToken() !== r.token) throw new Error('auth_storage_unavailable');
  };
  API.isCurrentToken = function (token) { return !!token && storedToken() === token; };
  API.currentStoreId = function () {
    var info = tokenInfo(storedToken(), true);
    if (info) return info.store;
    if (CFG.STORE_ID) return String(CFG.STORE_ID);
    return CFG.PUBLIC_ORDER === true ? publicStoreFromQuery() : '';
  };
  API.clearSession = function () {
    try { localStorage.removeItem(AUTH_PREFIX + 'mgmtToken'); localStorage.removeItem(AUTH_PREFIX + 'mgmtRefreshToken'); } catch (e) {}
  };
  API.imageUrl = function (value) {
    var v = String(value || '');
    return /^https:\/\//i.test(v) ? v : '';
  };

  // ---- ロード中オーバーレイ（全アクション共通の待機表示。完了で自動クローズ）----
  // api.js は全ページが読み込むため、ここに置くだけで共通部品になる。
  const _load = (function () {
    let count = 0, el = null, txt = null, hideTimer = null;
    function ensure() {
      if (el || typeof document === 'undefined' || !document.body) return;
      const st = document.createElement('style');
      st.textContent = '@keyframes izspin{to{transform:rotate(360deg)}}'
        + '#izLoad{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.42);opacity:0;transition:opacity .15s;}'
        + '#izLoad.on{opacity:1;}'
        + '#izLoad .box{background:#fff;border-radius:14px;padding:20px 26px;display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);min-width:150px;}'
        + '#izLoad .sp{width:34px;height:34px;border:3px solid #e5e7eb;border-top-color:#0f172a;border-radius:50%;animation:izspin .8s linear infinite;}'
        + '#izLoad .tx{font-size:14px;font-weight:800;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Noto Sans JP\',sans-serif;}';
      document.head.appendChild(st);
      el = document.createElement('div'); el.id = 'izLoad';
      el.innerHTML = '<div class="box"><div class="sp"></div><div class="tx" id="izLoadTx"></div></div>';
      document.body.appendChild(el);
      txt = el.querySelector('#izLoadTx');
    }
    function defMsg() { return _isEN() ? 'Please wait…' : '処理中…'; }
    return {
      show: function (msg) {
        count++; ensure(); if (!el) return;
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (txt) txt.textContent = msg || defMsg();
        el.style.display = 'flex'; void el.offsetWidth; el.classList.add('on');
      },
      hide: function () {
        count = Math.max(0, count - 1); if (count > 0 || !el) return;
        el.classList.remove('on');
        hideTimer = setTimeout(function () { if (count === 0 && el) el.style.display = 'none'; }, 160);
      }
    };
  })();
  API.loading = _load; // 手動利用も可（API.loading.show('...') / .hide()）

  // 定期ポーリング等、待機表示を出さない（点滅防止）アクション
  const BG_ACTIONS = { checkToken: 1, getOrders: 1, getOperationsDelta: 1, checkoutStatus: 1, bootstrap: 1, getSettings: 1, getStaffCalls: 1, getTableCheckoutStamp: 1 };
  const TABLE_SESSION_ACTIONS = { submitOrder:1, getOrdersByTable:1, getTableCheckoutStamp:1, setTablePartySize:1, getTablePartySize:1, callStaff:1, submitFeedback:1 };
  const BG_RPC = { getPrintQueue: 1, getPrintQueueCounts: 1, getSettings: 1 };

  // ---- タイムアウト設定（全画面共通・唯一の定義元）----
  // [応答速度改善(2026-08-22)/タイムアウト共通化] 従来は各画面（admin.html/kds.html/dashboard.html/
  // profit.html/sales.html/inventory.html等）がそれぞれ独自にミリ秒の数値をベタ書きしており、
  // 「何秒でタイムアウトさせるか」の方針が画面ごとにバラバラで、変更時にファイルを横断して
  // 探す必要があった。ここを唯一の定義元とし、各画面はAPI.TIMEOUT_MS.xxxを参照する（数値を
  // 直接書かない）。個々のRPCの実際の応答分布は izakanpai_perf_report_2026-08-22.xlsx を参照。
  //   fast    : 4.5秒  … 注文状況・KDS等、体感速度を最優先し「遅ければ次のポーリングに任せる」画面向け
  //   default : 30秒   … 上記以外の一般的な読み取り・書き込み全般の既定値（未指定時はこれが使われる）
  //   write   : 30秒   … 客が結果を待つ書き込み系（submitOrder/submitTakeoutOrder/finalizeBill等）。
  //             defaultと同値だが、defaultの方針を今後変えても影響を受けないよう意図的に独立させている
  //   heavy   : 23秒   … 売上集計等の重いRPC（画面側が独自のbusyRetryで再試行するため、内部再送は
  //             行わずdefaultよりむしろ短く区切る。詳細はdashboard.html等の_HEAVY_RPC_TIMEOUT_MS参照）
  //   ai      : 45秒   … 外部AI（Gemini Vision）呼び出し。実物のボトル画像はテスト画像より
  //             大幅に時間がかかり得るため、他より大きく余裕を持たせる
  var TIMEOUT_MS = { fast: 4500, default: 30000, write: 30000, heavy: 23000, ai: 45000 };
  API.TIMEOUT_MS = TIMEOUT_MS; // 各画面から参照する唯一の公開窓口

  // ---- 通信エラー時の自動リトライ＋再読み込み案内バナー（全アクション共通）----
  // GAS側のコールドスタート等で最初の呼び出しが固まる/404になることがあるため、
  // 「読み取り系」アクションに限り1回だけ自動リトライする（書き込み系は二重実行を避けるためリトライしない）。
  // それでも失敗した場合は控えめなバナーで案内する（次に何か1回でも成功すれば自動的に消える）。
  const _FETCH_TIMEOUT_MS = TIMEOUT_MS.default;
  const _RETRY_DELAY_MS = 1200;
  const _READ_ACTIONS = { getSettings: 1, checkToken: 1, bootstrap: 1, checkoutStatus: 1, getStaffCalls: 1, getTableCheckoutStamp: 1, getOperationsDelta: 1 };
  function _isReadOnly(action, fn) {
    if (action === 'rpc') return /^(get|check|list|count|fetch)/i.test(fn || '');
    return !!_READ_ACTIONS[action];
  }
  function _isEN() { try { if(window.I18n&&typeof window.I18n.lang==='function')return window.I18n.lang()==='en';var s=localStorage.getItem('lang');if(s==='ja'||s==='en')return s==='en';var first=(navigator.languages&&navigator.languages.length)?navigator.languages[0]:navigator.language;return String(first||'').toLowerCase().indexOf('ja')!==0; } catch (e) { return true; } }
  API.userErrorText = function (error, fallback) {
    var raw = String(error && error.message || error || '').trim();
    var en = _isEN();
    var generic = fallback || (en ? 'The operation could not be completed. Please try again.' : '処理を完了できませんでした。もう一度お試しください。');
    var network = en ? 'Could not connect to the server. Please check your connection and try again.' : 'サーバーに接続できませんでした。通信状況を確認して、もう一度お試しください。';
    var permission = en ? 'You do not have permission to perform this operation.' : 'この操作を行う権限がありません。';
    var notFound = en ? 'The requested data could not be found.' : '対象のデータが見つかりませんでした。';
    var retryLater = en ? 'Too many attempts were made. Please wait a while and try again.' : '操作回数が多すぎます。しばらく待ってからもう一度お試しください。';
    var code = raw.toLowerCase();
    if (!raw) return generic;
    if (code === 'unauthorized' || code === 'invalid_refresh_session' || code === 'stale_session_response') return en ? 'Your session has expired. Please log in again.' : 'ログインの有効期限が切れました。再度ログインしてください。';
    if (code === 'forbidden' || code.indexOf('forbidden_page:') === 0 || code === 'forbidden_fn') return permission;
    if (code === 'not_found' || code.endsWith('_not_found')) return notFound;
    if (code === 'rate_limited' || code === 'signup_rate_limited' || code === 'login_rate_limited') return retryLater;
    if (code.indexOf('plan_feature_pro_required') === 0) return en ? 'This feature is available on the Pro plan.' : 'この機能はProプランでご利用いただけます。';
    if (/^(?:http_\d+|api_error|internal_error|save_failed|delete_failed|request_failed|load_failed|server_busy_retry|environment_mismatch|auth_environment_not_configured)$/.test(code)) return generic;
    if (/d1_error|sqlite|constraint|primary\s*key|foreign\s*key|sql\b|typeerror|referenceerror|syntaxerror|stack|\bat\s+[^\s]+\s*\(|failed to fetch|networkerror|aborterror|timeout/i.test(raw)) return /fetch|network|abort|timeout/i.test(raw) ? network : generic;
    if (/[ぁ-んァ-ヶ一-龠]/.test(raw)) return raw;
    if (/\s/.test(raw) && !/^[A-Za-z]+(?:Error|Exception)\b/.test(raw)) return raw;
    return generic;
  };
  const _errBar = (function () {
    let el = null;
    function ensure() {
      if (el || typeof document === 'undefined' || !document.body) return;
      const st = document.createElement('style');
      st.textContent = '#izErrBar{position:fixed;left:0;right:0;bottom:0;z-index:99998;display:none;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;background:#b91c1c;color:#fff;font:700 13px -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Noto Sans JP\',sans-serif;padding:10px 14px;text-align:center;}'
        + '#izErrBar button{background:#fff;color:#b91c1c;border:0;border-radius:8px;padding:6px 14px;font-weight:800;cursor:pointer;}';
      document.head.appendChild(st);
      el = document.createElement('div'); el.id = 'izErrBar';
      el.innerHTML = '<span id="izErrTx"></span><button type="button" id="izErrBtn"></button>';
      el.querySelector('#izErrBtn').onclick = function () { location.reload(); };
      document.body.appendChild(el);
    }
    return {
      show: function () {
        ensure(); if (!el) return;
        el.querySelector('#izErrTx').textContent = _isEN()
          ? 'Having trouble connecting to the server. Some data may not have loaded correctly.'
          : 'サーバーとの通信がうまくいっていません。データが正しく表示されていない可能性があります。';
        el.querySelector('#izErrBtn').textContent = _isEN() ? '🔄 Reload' : '🔄 再読み込み';
        el.style.display = 'flex';
      },
      hide: function () { if (el) el.style.display = 'none'; }
    };
  })();

  function _fetchOnce(body, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort('timeout'); }, ms);
    return fetch(CFG.API_URL + '?api=1', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      redirect: 'follow',
      signal: ctrl.signal
    }).then(function (res) {
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          return res.json().catch(function () { throw new Error('http_' + res.status); });
        }
        throw new Error('http_' + res.status);
      }
      return res.json();
    }).finally(function () { clearTimeout(t); });
  }

  var refreshPending = null;
  API.refreshSession = function () {
    if (refreshPending) return refreshPending;
    var beforeToken = storedToken(), before = tokenInfo(beforeToken, true), refreshToken = storedRefreshToken();
    if (!before || before.version !== 'v3' || !refreshToken) return Promise.reject(new Error('invalid_refresh_session'));
    refreshPending = _fetchOnce(JSON.stringify({ action:'refreshSession', storeId:before.store, refreshToken:refreshToken }), TIMEOUT_MS.fast)
      .then(function (json) {
        var after = tokenInfo(json && json.token), nextRefresh = String(json && json.refreshToken || '');
        if (!json || !json.ok || !after || !validRefreshToken(nextRefresh) ||
            before.role !== after.role || before.store !== after.store || before.uid !== after.uid ||
            before.audience !== after.audience || before.sessionId !== after.sessionId || storedToken() !== beforeToken) {
          throw new Error((json && json.error) || 'invalid_refresh_session');
        }
        localStorage.setItem(AUTH_PREFIX + 'mgmtRefreshToken', nextRefresh);
        localStorage.setItem(AUTH_PREFIX + 'mgmtToken', json.token);
        return json.token;
      }).catch(function (error) {
        API.clearSession();
        throw error;
      }).finally(function () { refreshPending = null; });
    return refreshPending;
  };
  API.logoutSession = async function () {
    var token = storedToken(), refreshToken = storedRefreshToken();
    var info = tokenInfo(token, true);
    try {
      if (token || refreshToken) await _fetchOnce(JSON.stringify({ action:'logoutSession', storeId:info ? info.store : '', token:token, refreshToken:refreshToken }), TIMEOUT_MS.fast);
    } catch (e) {
      // Local logout must complete even while offline; server expiry remains the fallback.
    } finally { API.clearSession(); }
  };

  // ---- 低レベル POST ----
  // [GPT第22回レポート対応/G22-1] 重い集計RPC（getSalesAnalytics等）は、呼び出し元（各画面）が
  // 独自のbusy/timeout再試行ロジック（rpcBusyRetry）を持つ。API.post自身の内部再送（下記canRetry）と
  // 重ねると最大4 fetch・総待ち時間100秒超になり得たため、呼び出し元は以下のオプションを渡せる：
  //   payload.__timeoutMs         : このリクエストのfetchタイムアウトを個別に指定（省略時は既定25秒）
  //   payload.__noInternalRetry   : trueならAPI.post自身の内部再送を行わない（＝常に1 fetchのみ）
  // これにより「内部再送」と「画面側再送」の責務を分離し、二重再試行を避ける。
  API.post = async function (action, payload) {
    if (environmentMismatch()) {
      blockEnvironmentMismatch();
      throw new Error('environment_mismatch');
    }
    payload = payload || {};
    const silent = !!payload.__silent || BG_ACTIONS[action] || (action === 'rpc' && BG_RPC[payload.fn]);
    const timeoutMs = (typeof payload.__timeoutMs === 'number') ? payload.__timeoutMs : _FETCH_TIMEOUT_MS;
    const noInternalRetry = !!payload.__noInternalRetry;
    const send = Object.assign({}, payload); delete send.__silent; delete send.__msg; delete send.__timeoutMs; delete send.__noInternalRetry;
    if (!send.storeId) {
      if (CFG.STORE_ID) send.storeId = CFG.STORE_ID;
      else if (CFG.PUBLIC_ORDER === true) send.storeId = publicStoreFromQuery();
    }
    if (TABLE_SESSION_ACTIONS[action] && !send.token && !send.tableToken && typeof location !== 'undefined') {
      send.tableToken = new URLSearchParams(location.search).get('t') || '';
    }
    // 2026-08-25追加: 各画面はログイン時に取得したTOKENをページ内変数として持ち続けており、
    // サーバー側がスライディング・エクスパイア（下記newToken参照）でトークンを再発行しても
    // ページ内変数までは自動更新されない。送信直前にlocalStorageのmgmtToken（＝直前のレスポンスの
    // newTokenで更新され得る最新値）があればそちらを優先することで、各画面のコードを一切
    // 変更せずに「操作が続く限りログイン状態を保持する」を実現する。token不要な公開アクション
    // （客注文画面等）には影響しない。
    if (send.token) {
      const latest = storedToken();
      if (latest) send.token = latest;
      const access = tokenInfo(send.token, true);
      if (access && access.version === 'v3' && access.exp <= Date.now() + 60000) {
        try { send.token = await API.refreshSession(); }
        catch (e) { location.href = './manage.html'; throw new Error('unauthorized'); }
      }
    }
    const body = JSON.stringify(Object.assign({ action: action }, send));
    const canRetry = !noInternalRetry && _isReadOnly(action, payload.fn);
    if (!silent) _load.show(payload.__msg);
    try {
      let json;
      try {
        json = await _fetchOnce(body, timeoutMs);
      } catch (e1) {
        if (!canRetry) { _errBar.show(); throw e1; }
        await new Promise(function (r) { setTimeout(r, _RETRY_DELAY_MS); });
        try {
          json = await _fetchOnce(body, timeoutMs);
        } catch (e2) {
          _errBar.show();
          throw e2;
        }
      }
      _errBar.hide();
      if (!json.ok) {
        // ログイントークン失効（unauthorized）は生のエラーを見せず、管理画面（ログイン）へ自動的に戻す
        if (json.error === 'unauthorized' && API.isCurrentToken(send.token)) {
          try { API.clearSession(); localStorage.removeItem(AUTH_PREFIX + 'mgmtName'); localStorage.removeItem(AUTH_PREFIX + 'mgmtRole'); } catch (e) {}
          location.href = './manage.html';
        }
        // Legacy page catch handlers redirect on the literal "unauthorized".
        // A stale rejection must not trigger those handlers against a newer login.
        const stale = json.error === 'unauthorized' && storedToken() && !API.isCurrentToken(send.token);
        const e = new Error(stale ? 'stale_session_response' : (json.error || 'api_error')); e.__server = true; throw e;
      }
      if (send.token && !API.isCurrentToken(send.token)) {
        const sent = tokenInfo(send.token), current = tokenInfo(storedToken());
        if (!current || !sent || sent.uid !== current.uid || sent.store !== current.store || sent.role !== current.role || sent.audience !== current.audience) {
          throw new Error('stale_session_response');
        }
      }
      // 2026-08-25追加: サーバー側（gasApi.js handleGasCompatRequest）がスライディング・
      // エクスパイアで再発行したトークンをlocalStorageへ反映する。これにより、設定画面で
      // 設定したログイン保持時間の範囲内で操作が続く限りログイン状態が維持され、無操作のまま
      // その時間が過ぎれば（新しいnewTokenが来ないため）元のトークンの期限どおり自動的に
      // ログアウトされる。
      if (json.newToken && API.isCurrentToken(send.token)) {
        const before = tokenInfo(send.token), after = tokenInfo(json.newToken);
        if (before && after && before.role === after.role && before.store === after.store && before.uid === after.uid && before.audience === after.audience) {
          try { localStorage.setItem(AUTH_PREFIX + 'mgmtToken', json.newToken); } catch (e) {}
        }
      }
      return json;
    } finally {
      if (!silent) _load.hide();
    }
  };

  API.dateKeysInTimeZone = function (timeZone, at) {
    var tz = String(timeZone || 'UTC').trim() || 'UTC';
    var now = at instanceof Date ? at : new Date();
    var parts;
    try {
      parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
    } catch (e) {
      tz = 'UTC';
      parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
    }
    var map = {};
    parts.forEach(function (p) { if (p.type !== 'literal') map[p.type] = p.value; });
    var date = map.year + '-' + map.month + '-' + map.day;
    return { timezone:tz, date:date, month:map.year + '-' + map.month };
  };

  API.getStoreDateKeys = function () {
    return API.post('getSettings', { __silent:true }).then(function (r) {
      var settings = (r && r.data) || {};
      return API.dateKeysInTimeZone(settings.timezone || 'UTC');
    }).catch(function () {
      return API.dateKeysInTimeZone('UTC');
    });
  };

  API.initStoreDateInputs = function (specs, onAdjusted) {
    specs = Array.isArray(specs) ? specs : [];
    var fallback = API.dateKeysInTimeZone('UTC'), initial = {};
    specs.forEach(function (s) {
      var el = document.getElementById(s.id);
      if (!el || !fallback[s.kind]) return;
      if (!el.value) el.value = fallback[s.kind];
      initial[s.id] = el.value;
    });
    return API.getStoreDateKeys().then(function (keys) {
      var adjusted = false;
      specs.forEach(function (s) {
        var el = document.getElementById(s.id);
        if (!el || !keys[s.kind] || initial[s.id] === undefined) return;
        if (el.value === initial[s.id] && el.value !== keys[s.kind]) {
          el.value = keys[s.kind];
          adjusted = true;
        }
      });
      if (adjusted && typeof onAdjusted === 'function') onAdjusted(keys);
      return keys;
    });
  };

  // ---- IndexedDB（送信待ち注文の保管） ----
  function openDB() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(CFG.OFFLINE_DB_NAME, 1);
      r.onupgradeneeded = function () {
        const db = r.result;
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id' });
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function tx(store, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    }));
  }
  API.queuePut = (rec) => tx('outbox', 'readwrite', (s) => s.put(rec));
  API.queueDel = (id) => tx('outbox', 'readwrite', (s) => s.delete(id));
  API.queueAll = () => tx('outbox', 'readonly', (s) => {
    return new Promise((resolve) => {
      const items = [];
      s.openCursor().onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { items.push(cur.value); cur.continue(); }
        else resolve(items);
      };
    });
  });

  // ---- 注文送信（オフライン耐性つき） ----
  // 返り値: 'sent'（サーバ確定） / 'queued'（オフライン保留）
  // clientId でサーバ側が冪等化するため、再送しても二重登録されない。
  API.submitOrder = async function (order, authToken) {
    if (!order.clientId) order.clientId = 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    var currentQueueStoreId = API.currentStoreId() || '';
    var authQueueStoreId = (authToken && tokenInfo(authToken, true) || {}).store || '';
    if (authQueueStoreId && currentQueueStoreId && authQueueStoreId !== currentQueueStoreId) {
      return 'rejected:store_context_mismatch';
    }
    var queueStoreId = authQueueStoreId || currentQueueStoreId;
    // Never create an unassigned outbox record. It could later be replayed
    // under a different staff account/store after logout and login.
    if (!queueStoreId) return 'rejected:store_context_required';
    // オフラインが自明なら即キュー（無駄な待ち時間を回避）
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await API.queuePut({ id: order.clientId, storeId: queueStoreId, order: order, token: authToken || '', ts: Date.now(), attempts: 0 });
      return 'queued';
    }
    try {
      const payload = { order: order, __timeoutMs: TIMEOUT_MS.write };
      if (authToken) payload.token = authToken;
      const res = await API.post('submitOrder', payload);
      const d = res && res.data;
      // [H4] ロック競合による一時的な失敗はサーバー未登録なので再送キューへ（「拒否」扱いにしない）。
      if (d === 'Locked, please retry') { await API.queuePut({ id: order.clientId, storeId: queueStoreId, order: order, token: authToken || '', ts: Date.now(), attempts: 0 }); return 'queued'; }
      if (d && d !== 'OK') { return 'rejected:' + d; }   // サーバが拒否（例: Invalid table）。キューせず即エラー通知
      return 'sent';
    } catch (err) {
      await API.queuePut({ id: order.clientId, storeId: queueStoreId, order: order, token: authToken || '', ts: Date.now(), attempts: 0 });
      return 'queued';
    }
  };

  // ---- 送信待ちの再送（online復帰・定期・起動時に呼ぶ） ----
  // ネットワーク不通なら中断して次の機会に。サーバ到達済みの業務エラーは
  // 再送しても無駄なので試行上限で破棄し、キューの目詰まりを防ぐ。
  var _flushPending = null;
  API.canFlushQueuedOrder = function (rec, currentStoreId) {
    // Legacy records without an immutable originating store are quarantined;
    // never fill their empty storeId using the currently logged-in session.
    if (!(rec && typeof rec.storeId === 'string' && rec.storeId &&
      currentStoreId && rec.storeId === currentStoreId)) return false;
    if (rec.token) {
      var info = tokenInfo(rec.token, true);
      if (!info || info.store !== rec.storeId) return false;
    }
    return true;
  };
  API.flush = function () {
    if (_flushPending) return _flushPending;
    _flushPending = (async function () {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { sent: 0, dropped: 0, remaining: await API.pendingCount(), offline: true };
      }
      const pending = await API.queueAll();
      let sent = 0, dropped = 0, quarantined = 0;
      const currentStoreId = API.currentStoreId() || '';
      for (const rec of pending) {
        if (!API.canFlushQueuedOrder(rec, currentStoreId)) {
          if (!rec.storeId) quarantined++;
          continue;
        }
      try {
        const payload = { order: rec.order, __silent: true, __timeoutMs: TIMEOUT_MS.write };
        if (rec.storeId) payload.storeId = rec.storeId;
        if (rec.token) payload.token = rec.token;
        await API.post('submitOrder', payload);
        await API.queueDel(rec.id);
        sent++;
      } catch (err) {
        if (err && err.__server) {
          rec.attempts = (rec.attempts || 0) + 1;
          if (rec.attempts >= 5) { await API.queueDel(rec.id); dropped++; }
          else { await API.queuePut(rec); }
          continue; // 次の保留分へ
        }
        break; // ネットワーク不通。次の機会に。
      }
      }
      const remaining = await API.pendingCount();
      return { sent: sent, dropped: dropped, remaining: remaining, quarantined: quarantined };
    })().finally(function () { _flushPending = null; });
    return _flushPending;
  };

  API.pendingCount = async function () {
    const all = await API.queueAll();
    const currentStoreId = API.currentStoreId() || '';
    return all.filter(function (rec) {
      return !rec.storeId || !currentStoreId || rec.storeId === currentStoreId;
    }).length;
  };

  function bufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer), out = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    return btoa(out);
  }
  API.fileToBase64 = async function (file) {
    if (!file) throw new Error('file_required');
    if (typeof file.arrayBuffer === 'function') { try { return bufferToBase64(await file.arrayBuffer()); } catch (e) {} }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '').split(',')[1] || ''); };
      reader.onerror = function () { reject(new Error('file_read_failed')); };
      reader.onabort = function () { reject(new Error('file_read_aborted')); };
      try { reader.readAsDataURL(file); } catch (e) { reject(new Error('file_read_failed')); }
    });
  };
  API.readFileAsDataURL = async function (file) { return 'data:' + String((file && file.type) || 'application/octet-stream') + ';base64,' + await API.fileToBase64(file); };
  API.readFileAsText = async function (file) {
    if (!file) throw new Error('file_required');
    if (typeof file.text === 'function') { try { return await file.text(); } catch (e) {} }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('file_read_failed')); };
      reader.onabort = function () { reject(new Error('file_read_aborted')); };
      try { reader.readAsText(file, 'utf-8'); } catch (e) { reject(new Error('file_read_failed')); }
    });
  };

  window.API = API;

  // ---- テスト環境バッジ（config.jsで TEST_ENV:true のときだけ表示。本番では出ない）----
  if (CFG && CFG.TEST_ENV && typeof document !== 'undefined') {
    var _mkBadge = function () {
      if (document.getElementById('izTestBadge')) return;
      var b = document.createElement('div');
      b.id = 'izTestBadge';
      b.textContent = '🧪 TEST';
      b.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483647;background:#b91c1c;color:#fff;font:800 12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:4px 10px;border-top-right-radius:8px;letter-spacing:1px;pointer-events:none;opacity:.92;';
      (document.body || document.documentElement).appendChild(b);
    };
    if (document.body) _mkBadge(); else document.addEventListener('DOMContentLoaded', _mkBadge);
  }

  // Register on every screen, including login. Never reload during login/form entry:
  // Critical auth scripts prefer network, with exact-release offline fallback only.
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(function () {});
    } catch (e) {}
  }

  // 入力欄でEnter→そのブロックの主ボタンを実行（フォーム未使用のため共通で補う）。
  // i18n.js を読まないページ（注文/KDS/テイクアウト等）でもここで有効化。二重バインドは防止。
  if (typeof window !== 'undefined' && !window.__izEnterBound) {
    window.__izEnterBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      var t = e.target;
      if (!t || t.tagName !== 'INPUT') return;
      var ty = (t.getAttribute('type') || 'text').toLowerCase();
      if (['checkbox','radio','file','button','submit','reset','range','color','date','datetime-local','month','week','time'].indexOf(ty) >= 0) return;
      if (t.hasAttribute('data-noenter')) return;
      var scope = (t.closest && t.closest('.card, .login, form, .sheet, .box, section')) || document.body;
      var btns = scope.querySelectorAll('button'), fb = null, i, b, cls;
      for (i = 0; i < btns.length; i++) {
        b = btns[i];
        if (b.hasAttribute('data-tlang') || b.disabled) continue;
        if (b.offsetParent === null && b.getClientRects().length === 0) continue;
        if (!fb) fb = b;
        cls = ' ' + b.className + ' ';
        if (cls.indexOf(' btn-sec ') < 0 && cls.indexOf(' sec ') < 0 && cls.indexOf(' act-back ') < 0 && cls.indexOf(' close ') < 0) { fb = b; break; }
      }
      if (fb) { e.preventDefault(); fb.click(); }
    }, false);
  }
})();
