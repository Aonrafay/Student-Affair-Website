'use strict';

/**
 * In-memory rate limiter for the login endpoint.
 *
 * Why it exists: `POST /api/auth/login` had no throttling at all, so an
 * 8-character-minimum password could be brute forced from anywhere that can
 * reach the site. This caps attempts per (email, IP) pair.
 *
 * Deliberate design choices:
 *
 * - Only FAILED attempts are counted. A legitimate user who signs in
 *   repeatedly, or a busy admin, is never locked out.
 * - A successful login clears the counter for that pair, so a typo followed by
 *   a correct attempt costs nothing.
 * - The lockout response is identical to the "wrong password" response except
 *   for the status code. It does not confirm that the email exists.
 * - In-memory means it resets when the container restarts. That is acceptable
 *   for a single-node test deployment; a multi-node one would need Redis or a
 *   DB table instead. The tradeoff is documented rather than hidden.
 *
 * The map is keyed by a hash of email+IP so the raw email is not retained in
 * process memory any longer than the request that needed it.
 */

const crypto = require('crypto');

// Long enough to blunt a scripted attack, short enough that nobody gets locked
// out of their own admin panel after a bad afternoon.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const attempts = new Map();

// Bound the memory the map can grow to: prune expired entries on every call.
// Without this a distributed attempt (many emails from one IP, or vice versa)
// would grow the map without limit.
function prune(now) {
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
}

function pairKey(req, email) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return crypto
    .createHash('sha256')
    .update(`${String(email).trim().toLowerCase()}|${ip}`)
    .digest('hex');
}

/** Remaining attempts before this pair is locked out (for the 429 message). */
function retryAfterSeconds(entry, now) {
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
}

/**
 * Express middleware factory.
 * Call once per route: `router.post('/auth/login', loginLimiter(), handler)`.
 */
function loginLimiter({ max = MAX_FAILURES, windowMs = WINDOW_MS } = {}) {
  return function loginLimiterMiddleware(req, res, next) {
    const email = (req.body && req.body.email) || '';
    // Without an email there is nothing to rate limit on; the handler rejects
    // the request with 400 anyway.
    if (!email) return next();

    const now = Date.now();
    prune(now);

    const key = pairKey(req, email);
    const entry = attempts.get(key);
    if (entry && entry.count >= max) {
      const seconds = retryAfterSeconds(entry, now);
      res.setHeader('Retry-After', String(seconds));
      return res.status(429).json({
        error: 'Too many failed sign-in attempts. Please wait a few minutes and try again.'
      });
    }
    return next();
  };
}

/** Record a failed attempt. Called by the login handler on a bad password. */
function recordFailure(req, email) {
  if (!email) return;
  const now = Date.now();
  const key = pairKey(req, email);
  const entry = attempts.get(key);
  if (entry && entry.resetAt > now) {
    entry.count += 1;
  } else {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  }
}

/** Clear the counter after a successful login. */
function recordSuccess(req, email) {
  if (email) attempts.delete(pairKey(req, email));
}

/** Test/introspection helper - not used by the app itself. */
function _reset() {
  attempts.clear();
}

module.exports = { loginLimiter, recordFailure, recordSuccess, _reset, WINDOW_MS, MAX_FAILURES };