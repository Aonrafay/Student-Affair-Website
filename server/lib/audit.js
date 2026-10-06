'use strict';

const { q } = require('../config/db');

/**
 * Append-only activity log.
 *
 * The admin panel has two roles and shared accounts, so "who unpublished that
 * notice?" currently has no answer. Every admin mutation records who, what and
 * from where.
 *
 * Deliberately non-blocking and non-throwing: an audit write must never fail a
 * content edit the user successfully made. If the table is missing (an old
 * installation that has not migrated) or the write fails, the entry is dropped
 * and a line goes to stderr - the edit itself still succeeds.
 */

function record(req, action, options = {}) {
  const user = (req && req.user) || {};
  const meta = options.meta ? safeStringify(options.meta) : null;
  const row = {
    user_id: user.id != null ? user.id : null,
    user_email: String(user.email || 'system').slice(0, 190),
    action: String(action).slice(0, 60),
    module: String(options.module || '').slice(0, 40),
    target: String(options.target || '').slice(0, 255),
    meta,
    ip: String((req && (req.ip || req.socket?.remoteAddress)) || '').slice(0, 45)
  };

  // Fire and forget. The returned promise settles on its own; nothing awaits it.
  q(
    `INSERT INTO audit_log (user_id, user_email, action, module, target, meta, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.user_id, row.user_email, row.action, row.module, row.target, row.meta, row.ip]
  ).catch((e) => {
    console.error(`[audit] could not record "${row.action}": ${e.message}`);
  });
}

function safeStringify(value) {
  try {
    return JSON.stringify(value).slice(0, 4000);
  } catch (e) {
    return null;
  }
}

/** Most recent entries, newest first. */
async function list(req, res) {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const rows = await q(
    `SELECT id, user_id, user_email, action, module, target, meta, ip, created_at
       FROM audit_log
      ORDER BY id DESC
      LIMIT ${limit}`
  );
  return res.json(rows.map((r) => ({ ...r, meta: safeParse(r.meta) })));
}

/** Distinct action names, for the Activity page filter. */
async function actions(req, res) {
  const rows = await q('SELECT DISTINCT action FROM audit_log ORDER BY action');
  return res.json(rows.map((r) => r.action));
}

function safeParse(value) {
  if (value == null) return null;
  try { return JSON.parse(value); } catch (e) { return value; }
}

/** Keep the table from growing without bound. */
async function prune(req, res) {
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 180));
  const result = await q(`DELETE FROM audit_log WHERE created_at < (NOW() - INTERVAL ? DAY)`, [days]);
  return res.json({ ok: true, deleted: result.affectedRows, keep_days: days });
}

module.exports = { record, list, actions, prune };