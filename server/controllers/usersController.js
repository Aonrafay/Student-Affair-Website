'use strict';

const bcrypt = require('bcryptjs');
const { q, qOne } = require('../config/db');
const audit = require('../lib/audit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function listUsers(req, res) {
  const rows = await q('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC, id DESC');
  return res.json(rows);
}

async function createUser(req, res) {
  const { name, email, role, password } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!email || !EMAIL_RE.test(String(email))) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (role !== 'admin' && role !== 'editor') {
    return res.status(400).json({ error: 'Role must be admin or editor.' });
  }

  const existing = await qOne('SELECT id FROM users WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (existing) {
    return res.status(409).json({ error: 'A user with that email already exists.' });
  }

  const result = await q(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [
      String(name).trim().slice(0, 120),
      String(email).trim().toLowerCase(),
      await bcrypt.hash(String(password), 10),
      role
    ]
  );
  const user = await qOne('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [result.insertId]);
  audit.record(req, 'user.create', {
    module: 'users',
    target: user.email,
    meta: { role: user.role }
  });
  return res.status(201).json(user);
}

async function updateUser(req, res) {
  const id = Number(req.params.id);
  const body = req.body || {};
  const user = await qOne('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const data = {};
  if (body.name !== undefined) data.name = String(body.name).trim().slice(0, 120);
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email address is required.' });
    const clash = await qOne('SELECT id FROM users WHERE email = ? AND id <> ?', [email, id]);
    if (clash) return res.status(409).json({ error: 'A user with that email already exists.' });
    data.email = email;
  }
  if (body.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'editor') {
      return res.status(400).json({ error: 'Role must be admin or editor.' });
    }
    if (req.user.id === id && body.role !== user.role) {
      return res.status(400).json({ error: 'You cannot change your own role.' });
    }
    data.role = body.role;
  }
  if (body.password !== undefined) {
    if (String(body.password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    data.password_hash = await bcrypt.hash(String(body.password), 10);
  }

  if (Object.keys(data).length > 0) {
    // Changing a password or a role must invalidate that user's existing
    // sessions: a token issued before the change is no longer trustworthy.
    // Bumping token_version is the same mechanism as "sign out everywhere".
    if (data.password_hash !== undefined || data.role !== undefined) {
      data.token_version = Number(user.token_version || 0) + 1;
    }
    await q('UPDATE users SET ? WHERE id = ?', [data, id]);
  }

  const updated = await qOne('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [id]);
  // Password and role changes are the security-relevant ones, and they also
  // bump token_version (see the UPDATE above) - worth spelling out in the log.
  const notable = ['password_hash', 'role', 'email'].filter((k) => data[k] !== undefined);
  if (notable.length) {
    audit.record(req, 'user.update', {
      module: 'users',
      target: updated.email,
      meta: {
        changed: notable.map((k) => (k === 'password_hash' ? 'password' : k)),
        // Never log the new role value for password changes; the field list is
        // enough to answer "did someone reset this account?".
        sessions_revoked: data.token_version !== undefined
      }
    });
  }
  return res.json(updated);
}

async function deleteUser(req, res) {
  const id = Number(req.params.id);
  if (req.user.id === id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  const user = await qOne('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  if (user.role === 'admin') {
    const admins = await qOne('SELECT COUNT(*) AS c FROM users WHERE role = ?', ['admin']);
    if (Number(admins.c) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last administrator.' });
    }
  }
  await q('DELETE FROM users WHERE id = ?', [id]);
  audit.record(req, 'user.delete', { module: 'users', target: user.email, meta: { role: user.role } });
  return res.json({ ok: true });
}

module.exports = { listUsers, createUser, updateUser, deleteUser };