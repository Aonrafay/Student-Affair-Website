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

  /**
   * Download a file from an authenticated endpoint.
   *
   * A plain <a href> cannot be used: the token lives in localStorage and is
   * only ever sent as an Authorization header, so an anchor would fetch the
   * URL unauthenticated and get a 401. The response is read as a Blob and
   * handed to a temporary <a download>, which is what puts it in the user's
   * Downloads folder.
   */
  async function download(path, fallbackName) {
    var headers = {};
    if (token()) headers['Authorization'] = 'Bearer ' + token();

    var res = await fetch(API + path, { headers: headers });
    if (res.status === 401) {
      clearSession();
      location.href = loginUrl();
      throw new Error('Session expired. Sign in again.');
    }
    if (!res.ok) {
      var msg = '';
      try { msg = (await res.json()).error || ''; } catch (e) { /* not json */ }
      throw new Error(msg || ('Download failed (' + res.status + ').'));
    }

    var blob = await res.blob();
    var name = fallbackName || 'download';
    var disposition = res.headers.get('Content-Disposition') || '';
    var match = /filename="?([^"]+)"?/.exec(disposition);
    if (match && match[1]) name = match[1];

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking immediately can cancel the download in some browsers; a short
    // delay is the pragmatic fix.
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    return { name: name, bytes: blob.size };
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
    download: download,
    mediaUrl: function (name) {
      return name ? BASE + '/uploads/' + encodeURIComponent(name) : null;
    }
  };
})();
