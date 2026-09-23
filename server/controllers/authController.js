'use strict';

const bcrypt = require('bcryptjs');
const { qOne } = require('../config/db');
const { sign } = require('../middleware/auth');

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = await qOne(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = ?',
    [String(email).trim().toLowerCase()]
  );
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role };
  return res.json({ token: sign(publicUser), user: publicUser });
}

async function me(req, res) {
  return res.json({
    user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role }
  });
}

module.exports = { login, me };