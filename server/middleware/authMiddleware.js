'use strict';

const { verify } = require('./auth');
const { qOne } = require('../config/db');

/**
 * Require a valid `Authorization: Bearer <token>` header.
 * Sets `req.user` to the fresh user row (id, name, email, role).
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
      'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
      [payload.id]
    );
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists.' });
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