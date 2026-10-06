'use strict';

const crypto = require('crypto');

/**
 * Baseline response hardening.
 *
 * Everything here is a defence-in-depth header. The one that matters most is
 * `nosniff`: without it a browser may re-interpret an uploaded file's bytes,
 * which is how an attacker smuggles script past an extension check.
 *
 * CSP is added by csp() below (it needs a per-request nonce).
 */

/** Static headers that never change per request. */
function baseline(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // Admin pages are served from the same origin as the public site, so a strict
  // cross-origin policy here is safe and blocks token-bearing XHRs from other
  // sites (a defence against token exfiltration via a malicious page).
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

/**
 * Content-Security-Policy with a fresh nonce per response.
 *
 * `nonce-<value>` is the only way to allow inline <script> without
 * 'unsafe-inline'. The admin token lives in localStorage, so an injected inline
 * script is a full account takeover — the nonce is what makes that impossible
 * for anything the server did not itself render.
 *
 * style-src keeps 'unsafe-inline' on purpose: Markdown bodies may carry inline
 * `style` attributes (marked passes raw HTML through), and blocking them would
 * silently break existing content. Styles cannot read localStorage, so the
 * script-src nonce is what carries the real protection.
 */
function csp(req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  req.cspNonce = nonce;
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'"
    ].join('; ')
  );
  next();
}

module.exports = { baseline, csp };