'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'insecure-default-change-me';

// Session lifetime. Short on purpose: a stolen token is only useful until it
// expires, and the admin token is readable by any script that runs in the
// page's origin. 8 hours comfortably covers a working day.
const EXPIRES_IN = process.env.SESSION_HOURS
  ? `${Number(process.env.SESSION_HOURS)}h`
  : '8h';

/**
 * Sign a JWT for a user object.
 *
 * Only `id`, `role` and `tv` are carried - never the whole row.
 * `tv` is the user's token_version at the moment of signing; bumping it in the
 * database invalidates every token issued before that moment.
 */
function sign(user) {
  return jwt.sign(
    { id: user.id, role: user.role, tv: user.token_version || 0 },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

/** Verify a token; throws if invalid or expired. */
function verify(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { sign, verify, EXPIRES_IN };