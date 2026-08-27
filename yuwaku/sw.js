// Service Worker: アプリシェルをキャッシュし、オフラインでも起動できるようにする。
// API（Cloudflare Workers）へのPOSTは横取りせず素通しする。
//
// ★2026-08-23追記（Cloudflare移行に伴う重要な変更）: 静的資産（config.js/api.js含む）は
// 下のfetchハンドラで「キャッシュ優先」のため、CACHEのバージョン文字列を変えない限り、
// 既にこのPWAを使ったことがある端末では、config.jsをGAS時代のURLのまま古いキャッシュから
// 返し続けてしまう（サーバー側でconfig.jsを差し替えても反映されない＝画面がずっと重いGAS
// バックエンドに繋がったまま、という不具合の直接原因）。CACHEのバージョンを上げると、
// activateハンドラが自動的に旧キャッシュを削除するため、次回アクセス時に新しいconfig.js
// （Cloudflare Workers宛て）が確実に取得される。config.js/api.js等の静的資産を差し替える
// デプロイのたびに、このバージョン番号を必ず1つ上げること。
//
// ★2026-08-23再追記（v146・重大な不具合の修正）: v145はSHELL配列に既に削除済みの
// `admin_new.html`が残ったままだった。installハンドラの`caches.addAll(SHELL)`は1件でも
// 404すると全体が失敗する仕様のため、v145の新規インストールが実際には毎回失敗し続けて
// いた（新しいCACHEのopenだけ実行されて中身が空のまま）。インストールが失敗すると
// ブラウザは新しいService Workerをactivateしないため、既にこのPWAを使ったことがある
// 端末は「本来はv145に上がっているはず」のつもりが実際にはv144のまま固定され、config.js
// がいつまでもGAS時代のURLを指し続ける（sales.html等が読み込み中のまま止まる・古い
// バックエンドへの再試行ループが発生する、という形で症状が出た）。
// 今回、削除済みファイルをSHELLから除去し、バージョンをv146へ上げることで、次回アクセス時に
// 改めてインストールが成功し、正しいconfig.js（Cloudflare Workers宛て）へ切り替わるようにした。
// 教訓: SHELLに載せるファイルを変更する際は、必ずデプロイ後の実際のファイル一覧と突き合わせる
// こと（今回は目視確認を怠ったのが原因）。
// ★2026-08-23再々追記（v147）: 全画面点検の結果を反映（clock.htmlのpunch/getEmployeeStatuses
// 未登録バグ修正、settings.html/backup.html/purchasing.htmlのメール送信系・スプレッドシート
// バックアップ機能を「利用不可」表示に変更＋代替案を明記）。静的資産（settings.html/backup.html/
// purchasing.html）を変更したため、キャッシュを必ず入れ替える。
// ★2026-08-25追記（v149・GPTレビューで発覚、v146と全く同じ不具合の再発）: SPAプロトタイプ
// 開発中止に伴いdocs/yuwaku/spa.htmlを削除したが、このSHELL配列から './spa.html' を
// 消し忘れていた。v146の教訓（このファイル上部のコメント参照）通り、caches.addAll(SHELL)は
// 1件でも404すると全体が失敗するため、v148のインストールは実際には毎回失敗し続けていた
// 可能性が高い。SHELLから './spa.html' を除去し、バージョンをv149へ上げて再インストールを
// 発生させる。教訓を教訓のままにせず、SHELL変更のたびに実ファイル一覧との突き合わせを徹底する。
// ★2026-08-25追記（v150）: confirm()/alert()の共通ダイアログ部品として新規追加した
// ./confirm.js をSHELLへ追加。新規ファイルなのでバージョンを上げてキャッシュへ確実に含める。
const CACHE = 'yuwaku-pos-v150';
const SHELL = [
  './',
  './index.html',
  './takeout.html',
  './kds.html',
  './admin.html',
  './manage.html',
  './coupons.html',
  './recipe.html',
  './drink_inv.html',
  './members.html',
  './sales.html',
  './attendance.html',
  './users.html',
  './menu_editor.html',
  './inventory.html',
  './settings.html',
  './clock.html',
  './expenses.html',
  './profit.html',
  './profit_sim.html',
  './dashboard.html',
  './register.html',
  './audit.html',
  './moves.html',
  './purchasing.html',
  './order_items.html',
  './feedback.html',
  './backup.html',
  './reserve.html',
  './reservations.html',
  './birthdays.html',
  './receipts.html',
  './todo.html',
  './requests.html',
  './printers.html',
  './overview.html',
  './system-overview.svg',
  './system-overview-en.svg',
  './styles.css',
  './config.js',
  './api.js',
  './i18n.js',
  './confirm.js',
  './app.js',
  './manifest.webmanifest',
  './admin.webmanifest',
  './attendance.webmanifest',
  './audit.webmanifest',
  './backup.webmanifest',
  './birthdays.webmanifest',
  './coupons.webmanifest',
  './dashboard.webmanifest',
  './expenses.webmanifest',
  './feedback.webmanifest',
  './inventory.webmanifest',
  './kds.webmanifest',
  './members.webmanifest',
  './menu_editor.webmanifest',
  './moves.webmanifest',
  './profit.webmanifest',
  './profit_sim.webmanifest',
  './purchasing.webmanifest',
  './order_items.webmanifest',
  './receipts.webmanifest',
  './recipe.webmanifest',
  './register.webmanifest',
  './reservations.webmanifest',
  './todo.webmanifest',
  './requests.webmanifest',
  './sales.webmanifest',
  './settings.webmanifest',
  './takeout.webmanifest',
  './users.webmanifest',
  './manage.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // GET以外・別オリジン（API）は素通し
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ページ遷移はネット優先→失敗時キャッシュのindex
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 静的資産はキャッシュ優先
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => hit))
  );
});
