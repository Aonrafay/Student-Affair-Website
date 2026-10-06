'use strict';

const { verify } = require('./auth');
const { qOne } = require('../config/db');

/**
 * Require a valid `Authorization: Bearer <token>` header.
 * Sets `req.user` to the fresh user row (id, name, email, role).
 *
 * The token_version check is what makes sessions revocable: a token signed
 * before the user's token_version was bumped is rejected even though its
 * signature and expiry are still valid. Without it a leaked token could not be
 * withdrawn until it expired.
 */
async function protect(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  try {
    const payload = verify(token);
    const user = await qOne(
      'SELECT id, name, email, role, token_version, created_at FROM users WHERE id = ?',
      [payload.id]
    );
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    // A token issued before the last revocation attempt is no longer valid.
    // `|| 0` keeps tokens minted before this column existed working.
    if (Number(payload.tv || 0) !== Number(user.token_version || 0)) {
      return res.status(401).json({
        error: 'This session has been signed out. Please sign in again.'
      });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  }
}

/** Restrict a route to one or more roles (after `protect`). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this area.' });
    }
    next();
  };
}

/** Restrict a route to the roles allowed for a module definition. */
function requireModuleRole(moduleDef) {
  const roles = moduleDef.roles || ['admin'];
  return requireRole(...roles);
}

module.exports = { protect, requireRole, requireModuleRole };