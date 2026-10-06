'use strict';

const bcrypt = require('bcryptjs');
const { qOne } = require('../config/db');
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

  const user = await qOne(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = ?',
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
  return res.json({ token: sign(publicUser), user: publicUser });
}

async function me(req, res) {
  return res.json({
    user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role }
  });
}

module.exports = { login, me };