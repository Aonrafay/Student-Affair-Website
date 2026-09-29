/* ==========================================================================
   Student Affairs CMS — public client helpers + API wrapper
   Loaded after /config.js (sets window.SA_BASE_PATH).
   ========================================================================== */
(function () {
  'use strict';

  const BASE = window.SA_BASE_PATH || '/student-affairs';
  const API = BASE + '/api';

  async function api(path, opts) {
    const res = await fetch(API + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed (' + res.status + ').');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function textToHtml(text) {
    if (!text) return '';
    return esc(text).replace(/\n/g, '<br>');
  }

  /**
   * Markdown → HTML via the vendored marked (js/vendor/marked.min.js —
   * include it on pages that render Markdown, before this file). Media
   * references stay as bare library filenames in the stored text and are
   * resolved to upload URLs here, so content survives base-path changes.
   */
  function mdToHtml(md) {
    var text = String(md == null ? '' : md);
    if (!text.trim()) return '';
    if (!window.marked) {
      return textToHtml(text); // graceful degrade if the library is missing
    }
    text = text.replace(/(!\[[^\]]*\]\()([^)\s]+)([^)]*\))/g, function (m, pre, src, post) {
      if (/^(https?:|\/|data:)/i.test(src)) return m;
      return pre + (mediaUrl(src) || src) + post;
    });
    return window.marked.parse(text, { breaks: true, gfm: true });
  }

  function mediaUrl(name) {
    return name ? BASE + '/uploads/' + encodeURIComponent(name) : null;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    let h = d.getHours();
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + ':' + String(d.getMinutes()).padStart(2, '0') + ampm;
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    return fmtDate(iso) + ', ' + fmtTime(iso);
  }

  /** First letters of up to two words — used for image placeholders. */
  function initials(text) {
    return String(text || '?').trim().split(/\s+/).slice(0, 2).map(function (w) {
      return w.charAt(0).toUpperCase();
    }).join('') || '?';
  }

  /** A thumb block: real image or a branded placeholder with initials. */
  function thumb(src, altText) {
    if (src) {
      return '<div class="thumb"><img src="' + esc(src) + '" alt="' + esc(altText) + '" loading="lazy"></div>';
    }
    return '<div class="thumb"><span class="ph-text">' + esc(initials(altText)) + '</span></div>';
  }

  window.SA = {
    BASE: BASE,
    API: API,
    api: api,
    esc: esc,
    textToHtml: textToHtml,
    mdToHtml: mdToHtml,
    mediaUrl: mediaUrl,
    fmtDate: fmtDate,
    fmtTime: fmtTime,
    fmtDateTime: fmtDateTime,
    initials: initials,
    thumb: thumb
  };
})();