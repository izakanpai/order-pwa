// ★テスト環境の設定（本番とは別のCloudflare Worker・別のD1データベースを指す）
// このファイルは deploy_test.bat の robocopy 同期対象から除外されているため、
// 本番の docs/yuwaku/config.js を更新しても上書きされない（sw.js も同様）。
//
// テスト用D1・テスト用Workerのセットアップ手順は、リポジトリ直下の
// 「デプロイ手順_テスト環境構築_2026-08-23.md」を参照してください。
window.APP_CONFIG = {
  AUTH_SCHEMA_VERSION: 2,
  API_URL: 'https://izakanpai-api-test.izakanpai.workers.dev',
  VERSION: 'test',
  AUTH_STORAGE_PREFIX: 'izakanpai:test:',
  STORAGE_PREFIX: 'izakanpai:test:',
  OFFLINE_DB_NAME: 'izakanpai-pos-test',
  TEST_ENV: true             // 画面左下に「🧪 TEST」バッジを表示（api.jsの既存の仕組み）
};

// 全画面共通ヘッダーを一元読込する。各HTMLへ同じマークアップを複製しない。
(function () {
  if (typeof document === 'undefined' || document.querySelector('script[data-iz-common-header]')) return;
  var script = document.createElement('script');
  script.src = './header.js?v=auth2';
  script.async = false;
  script.setAttribute('data-iz-common-header', '');
  document.head.appendChild(script);
})();
