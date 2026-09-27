(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var API = {};
  var TABLE_SESSION_ACTIONS = {
    submitOrder:1, getOrdersByTable:1, getTableCheckoutStamp:1,
    setTablePartySize:1, getTablePartySize:1, callStaff:1, submitFeedback:1
  };
  var TIMEOUT_MS = { fast:4500, default:30000, write:30000 };
  API.TIMEOUT_MS = TIMEOUT_MS;

  function validStoreId(value) {
    return /^[a-z0-9][a-z0-9-]{2,31}$/.test(String(value || ''));
  }
  function tableTokenFromUrl() {
    try { return new URLSearchParams(location.search).get('t') || ''; }
    catch (_) { return ''; }
  }
  function configReady() {
    return CFG.AUTH_SCHEMA_VERSION === 2 &&
      validStoreId(CFG.STORE_ID) &&
      /^https:\/\//i.test(String(CFG.API_URL || '')) &&
      !!CFG.STORAGE_PREFIX &&
      !!CFG.OFFLINE_DB_NAME;
  }
  API.publicStoreId = function () { return validStoreId(CFG.STORE_ID) ? CFG.STORE_ID : ''; };
  API.imageUrl = function (value) {
    var v = String(value || '');
    return /^https:\/\//i.test(v) ? v : '';
  };

  async function fetchOnce(body, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || TIMEOUT_MS.default) : null;
    try {
      var res = await fetch(String(CFG.API_URL || '') + '?api=1', {
        method:'POST',
        headers:{ 'Content-Type':'text/plain;charset=utf-8' },
        body:body,
        signal:ctrl ? ctrl.signal : undefined
      });
      var json;
      try { json = await res.json(); }
      catch (_) { throw new Error('invalid_server_response'); }
      if (!res.ok && (!json || json.ok !== false)) throw new Error('http_' + res.status);
      return json;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  API.post = async function (action, payload) {
    if (!configReady()) throw new Error('invalid_store_link');
    payload = payload || {};
    var timeoutMs = typeof payload.__timeoutMs === 'number' ? payload.__timeoutMs : TIMEOUT_MS.default;
    var send = Object.assign({}, payload);
    delete send.__silent; delete send.__msg; delete send.__timeoutMs; delete send.__noInternalRetry;
    send.storeId = CFG.STORE_ID;
    if (TABLE_SESSION_ACTIONS[action] && !send.tableToken) send.tableToken = tableTokenFromUrl();
    var json = await fetchOnce(JSON.stringify(Object.assign({ action:action }, send)), timeoutMs);
    if (!json || json.ok === false) {
      var err = new Error(json && json.error || 'api_error');
      err.__server = true;
      throw err;
    }
    return json;
  };

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!configReady()) { reject(new Error('invalid_store_link')); return; }
      var r = indexedDB.open(CFG.OFFLINE_DB_NAME, 1);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath:'id' });
      };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function tx(store, mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  API.queuePut = function (rec) { return tx('outbox', 'readwrite', function (s) { return s.put(rec); }); };
  API.queueDel = function (id) { return tx('outbox', 'readwrite', function (s) { return s.delete(id); }); };
  API.queueAll = function () {
    return tx('outbox', 'readonly', function (s) {
      return new Promise(function (resolve) {
        var items = [];
        s.openCursor().onsuccess = function (e) {
          var cur = e.target.result;
          if (cur) { items.push(cur.value); cur.continue(); }
          else resolve(items);
        };
      });
    });
  };

  function queueRecord(order) {
    return {
      id:order.clientId,
      storeId:CFG.STORE_ID,
      tableToken:tableTokenFromUrl(),
      order:order,
      ts:Date.now(),
      attempts:0
    };
  }

  API.submitOrder = async function (order) {
    if (!order.clientId) order.clientId = 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    var rec = queueRecord(order);
    if (!rec.tableToken) return 'rejected:invalid_table_session';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await API.queuePut(rec);
      return 'queued';
    }
    try {
      var res = await API.post('submitOrder', {
        order:order, tableToken:rec.tableToken, __timeoutMs:TIMEOUT_MS.write
      });
      var d = res && res.data;
      if (d === 'Locked, please retry') { await API.queuePut(rec); return 'queued'; }
      if (d && d !== 'OK') return 'rejected:' + d;
      return 'sent';
    } catch (err) {
      if (err && err.__server) return 'rejected:' + (err.message || 'api_error');
      await API.queuePut(rec);
      return 'queued';
    }
  };

  API.flush = async function () {
    var pending = await API.queueAll(), sent = 0, dropped = 0;
    for (var i = 0; i < pending.length; i++) {
      var rec = pending[i];
      if (rec.storeId !== CFG.STORE_ID || !rec.tableToken) {
        await API.queueDel(rec.id); dropped++; continue;
      }
      try {
        await API.post('submitOrder', {
          order:rec.order, tableToken:rec.tableToken, __timeoutMs:TIMEOUT_MS.write
        });
        await API.queueDel(rec.id); sent++;
      } catch (err) {
        if (err && err.__server) {
          rec.attempts = (rec.attempts || 0) + 1;
          if (rec.attempts >= 5) { await API.queueDel(rec.id); dropped++; }
          else await API.queuePut(rec);
          continue;
        }
        break;
      }
    }
    return { sent:sent, dropped:dropped, remaining:(await API.queueAll()).length };
  };
  API.pendingCount = async function () { return (await API.queueAll()).length; };

  window.API = API;
})();
