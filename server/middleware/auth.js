'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'insecure-default-change-me';

/** Sign a JWT for a user object (id, role, … — picked fields only). */
function sign(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    SECRET,
    { expiresIn: '7d' }
  );
}

/** Verify a token; throws on invalid/expired. */
function verify(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { sign, verify };