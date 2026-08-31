'use strict';

const { q, qOne } = require('../config/db');
const { parseJSON } = require('../lib/helpers');
const modules = require('../modules');

// --- Public -----------------------------------------------------------------

/** GET /api/pages/:key — one CMS page with parsed JSON content. */
async function getPublicPage(req, res) {
  const page = await qOne('SELECT `key`, title, content FROM pages WHERE `key` = ?', [req.params.key]);
  if (!page) {
    return res.status(404).json({ error: 'Page not found.' });
  }
  return res.json({
    key: page.key,
    title: page.title,
    content: parseJSON(page.content, {})
  });
}

/** GET /api/settings — public subset of office details (no secrets held here). */
async function getPublicSettings(req, res) {
  const rows = await q('SELECT `key`, `value` FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return res.json(out);
}

// --- Admin ------------------------------------------------------------------

/** GET /api/admin/pages — list page keys + titles. */
async function listPages(req, res) {
  const rows = await q('SELECT `key`, title, updated_at FROM pages ORDER BY `key`');
  return res.json(rows);
}

/** GET /api/admin/pages/:key */
async function getAdminPage(req, res) {
  const page = await qOne('SELECT * FROM pages WHERE `key` = ?', [req.params.key]);
  if (!page) {
    return res.status(404).json({ error: 'Page not found.' });
  }
  page.content = parseJSON(page.content, {});
  return res.json(page);
}

/** PUT /api/admin/pages/:key — upsert (admin can also add new page keys). */
async function updatePage(req, res) {
  const key = req.params.key;
  const body = req.body || {};
  if (!key) return res.status(400).json({ error: 'Page key is required.' });

  const data = {};
  if (body.title !== undefined) data.title = String(body.title).slice(0, 190);
  if (body.content !== undefined) {
    if (typeof body.content !== 'string' && typeof body.content !== 'object') {
      return res.status(400).json({ error: 'Page content must be a JSON object.' });
    }
    data.content = typeof body.content === 'string' ? body.content : JSON.stringify(body.content);
  }

  await q(
    'INSERT INTO pages (`key`, title, content) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content), updated_at = NOW()',
    [key, data.title || key, data.content || '{}']
  );

  const page = await qOne('SELECT * FROM pages WHERE `key` = ?', [key]);
  page.content = parseJSON(page.content, {});
  return res.json(page);
}

/** GET /api/admin/settings — every key/value as an object. */
async function getAdminSettings(req, res) {
  const rows = await q('SELECT `key`, `value` FROM settings ORDER BY `key`');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return res.json(out);
}

/** PUT /api/admin/settings — accepts { key: value, … }, upserts each. */
async function updateSettings(req, res) {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return res.status(400).json({ error: 'Provide at least one setting.' });
  }
  for (const [key, value] of Object.entries(body)) {
    const safeKey = String(key).slice(0, 60);
    const safeValue = String(value == null ? '' : value).slice(0, 1000);
    await q(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [safeKey, safeValue]
    );
  }
  return getAdminSettings(req, res);
}

/** GET /api/admin/stats — dashboard numbers. */
async function stats(req, res) {
  const counts = {};
  for (const def of Object.values(modules)) {
    counts[def.id] = (await qOne(`SELECT COUNT(*) AS c FROM \`${def.table || def.id}\``)).c;
  }
  const totalUsers = (await qOne('SELECT COUNT(*) AS c FROM users')).c;
  const totalMedia = (await qOne('SELECT COUNT(*) AS c FROM media')).c;

  const nextEvent = await qOne(
    `SELECT id, slug, title, start_time, location, status
     FROM events
     WHERE status = 'published' AND start_time >= NOW()
     ORDER BY start_time ASC
     LIMIT 1`
  );
  const recentPosts = await q(
    `SELECT id, slug, title, category, status, published_at
     FROM posts
     ORDER BY updated_at DESC
     LIMIT 5`
  );

  return res.json({ counts, totalUsers, totalMedia, nextEvent, recentPosts });
}

module.exports = {
  getPublicPage,
  getPublicSettings,
  listPages,
  getAdminPage,
  updatePage,
  getAdminSettings,
  updateSettings,
  stats
};