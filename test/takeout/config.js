(function () {
  var store = String(new URLSearchParams(location.search).get('store') || '').trim().toLowerCase();
  var valid = /^[a-z0-9][a-z0-9-]{2,31}$/.test(store);
  window.APP_CONFIG = {
    AUTH_SCHEMA_VERSION: 2,
    API_URL: 'https://izakanpai-api-test.izakanpai.workers.dev',
    STORE_ID: valid ? store : '',
    TEST_ENV: true,
    STORAGE_PREFIX: 'izakanpai:public-takeout:test:' + (valid ? store : 'invalid') + ':',
    AUTH_STORAGE_PREFIX: 'izakanpai:public-takeout:test:' + (valid ? store : 'invalid') + ':',
    OFFLINE_DB_NAME: 'izakanpai-public-takeout-test-' + (valid ? store : 'invalid')
  };
})();
