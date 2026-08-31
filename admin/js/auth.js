/* ==========================================================================
   Student Affairs CMS — admin session + API helpers
   Loaded after /config.js (sets window.SA_BASE_PATH).
   ========================================================================== */
(function () {
  'use strict';

  var BASE = window.SA_BASE_PATH || '/student-affairs';
  var API = BASE + '/api';
  var TOKEN_KEY = 'sa_admin_token';
  var USER_KEY = 'sa_admin_user';

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function saveSession(newToken, newUser) {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function loginUrl() {
    return BASE + '/admin/login';
  }

  /** JSON fetch with the bearer token; redirects to login on expired sessions. */
  async function api(path, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token()) headers['Authorization'] = 'Bearer ' + token();

    var res = await fetch(API + path, {
      method: opts.method || (opts.body !== undefined ? 'PUT' : 'GET'),
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });

    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }

    if (res.status === 401 && token() && path !== '/auth/login') {
      clearSession();
      location.href = loginUrl();
      throw new Error('Session expired. Sign in again.');
    }
    if (!res.ok) {
      var err = new Error((data && data.error) || 'Request failed (' + res.status + ').');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Multipart upload (media library) with the bearer token. */
  async function upload(path, formData) {
    var headers = {};
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    var res = await fetch(API + path, { method: 'POST', headers: headers, body: formData });
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (res.status === 401 && token()) {
      clearSession();
      location.href = loginUrl();
      throw new Error('Session expired. Sign in again.');
    }
    if (!res.ok) {
      throw new Error((data && data.error) || 'Upload failed (' + res.status + ').');
    }
    return data;
  }

  window.AdminAuth = {
    BASE: BASE,
    API: API,
    token: token,
    user: user,
    saveSession: saveSession,
    clearSession: clearSession,
    loginUrl: loginUrl,
    api: api,
    upload: upload,
    mediaUrl: function (name) {
      return name ? BASE + '/uploads/' + encodeURIComponent(name) : null;
    }
  };
})();
