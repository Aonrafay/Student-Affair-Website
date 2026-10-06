'use strict';

const bcrypt = require('bcryptjs');
const { q, qOne } = require('../config/db');
const { sign } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

/**
 * One message for every failure mode (unknown email, wrong password, locked
 * out) so the endpoint cannot be used to enumerate which addresses have
 * accounts.
 */
const INVALID = 'Invalid email or password.';

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const key = String(email).trim().toLowerCase();

  // token_version MUST be selected here. It is what gets baked into the JWT as
  // `tv` and compared against the stored value on every request. Leaving it out
  // signs every token with tv=0, which silently invalidates all logins as soon
  // as the stored value moves off 0 - e.g. after the first "sign out
  // everywhere" - because a fresh token would no longer match the row.
  const user = await qOne(
    'SELECT id, name, email, role, password_hash, token_version FROM users WHERE email = ?',
    [key]
  );

  // Always run a bcrypt comparison, even when the email is unknown, so the
  // response time does not reveal whether the account exists.
  //
  // This is a real, well-formed bcrypt hash (of the literal string "password").
  // It has to be structurally valid: bcrypt.compare short-circuits on a
  // malformed hash, which would reintroduce the timing difference it is here
  // to remove. It belongs to no account, and `!user` still rejects the login
  // even if someone submits "password".
  const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
  const hash = user ? user.password_hash : DUMMY_HASH;
  const ok = await bcrypt.compare(String(password), hash);

  if (!user || !ok) {
    rateLimit.recordFailure(req, key);
    return res.status(401).json({ error: INVALID });
  }

  rateLimit.recordSuccess(req, key);
  const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  // token_version rides along so the JWT can be checked against the current
  // value on every request (see middleware/authMiddleware.js).
  return res.json({
    token: sign({ ...publicUser, token_version: user.token_version }),
    user: publicUser
  });
}

/**
 * Invalidate every session for the signed-in user by bumping token_version.
 * The caller's own token dies too, so the UI redirects to login afterwards.
 */
async function logoutAll(req, res) {
  await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.id]);
  return res.json({ ok: true });
}

async function me(req, res) {
  return res.json({
    user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role }
  });
}

module.exports = { login, me, logoutAll };