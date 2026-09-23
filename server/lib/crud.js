'use strict';

const { q, qOne } = require('../config/db');
const { uniqueSlug, parseJSON, toJSON } = require('./helpers');

/**
 * Build a generic CRUD service for one module definition (see modules.js).
 * Every table follows the same convention:
 *   id, slug, status (draft|published), created_at, updated_at, published_at
 * plus module-specific columns listed in `def.fields`.
 */
function buildModuleCrud(def) {
  const table = def.table || def.id;
  const jsonFields = def.jsonFields || [];
  const orderBy = def.orderBy || 'id DESC';

  // Immutable admin-only columns that are never written from request bodies.
  const IGNORED_ON_WRITE = new Set(['id', 'created_at', 'updated_at']);

  // Date/time columns (start_time, end_time, published_at, …). The admin form
  // posts ISO 8601 strings ("2026-09-22T06:18:12.842Z"), which MySQL rejects for
  // DATETIME/TIMESTAMP columns ("Incorrect datetime value"), so they are converted
  // to Date objects — mysql2 serializes those using the pool's `timezone: 'Z'`.
  const TEMPORAL_KEY = /^date$|(_at|_time|_date|_on)$/;

  function normaliseTemporal(key, value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date/time for "${key}".`);
    }
    return date;
  }

  /** Parse JSON columns on the way out. */
  function prep(row) {
    if (!row) return row;
    const out = { ...row };
    for (const f of jsonFields) {
      out[f] = parseJSON(out[f], out[f] == null ? null : []);
    }
    return out;
  }

  const prepMany = (rows) => rows.map(prep);

  /** Whitelist + normalise an incoming body for INSERT/UPDATE. */
  function buildWriteData(body) {
    const data = {};
    for (const key of def.fields) {
      if (IGNORED_ON_WRITE.has(key)) continue;
      if (body[key] === undefined) continue;
      if (key === 'status') {
        if (body[key] !== 'draft' && body[key] !== 'published') continue;
        data[key] = body[key];
        continue;
      }
      data[key] = TEMPORAL_KEY.test(key) ? normaliseTemporal(key, body[key]) : body[key];
    }
    for (const f of jsonFields) {
      if (data[f] !== undefined) data[f] = toJSON(data[f]);
    }
    // Normalise boolean-flagged columns (checkbox fields submit true/false).
    for (const key of ['featured']) {
      if (data[key] !== undefined) data[key] = data[key] ? 1 : 0;
    }
    return data;
  }

  async function ensureUniqueSlug(data, ignoreId) {
    if (!def.fields.includes('slug')) return;
    const providedSlug = data.slug && String(data.slug).trim();
    const titleValue = data[def.titleField];
    // On update, a body that carries neither a slug nor the title (a partial
    // PUT) must keep the existing slug instead of being renamed to 'item'.
    if (!providedSlug && titleValue === undefined && ignoreId != null) return;
    const base = providedSlug || titleValue;
    data.slug = await uniqueSlug(table, base || 'item', ignoreId);
  }

  const crud = {
    def,

    /** Public list — only published rows, default ordering. */
    async listPublic(limit) {
      const rows = limit
        ? await q(`SELECT * FROM \`${table}\` WHERE status = 'published' ORDER BY ${orderBy} LIMIT ${Number(limit) || 20}`)
        : await q(`SELECT * FROM \`${table}\` WHERE status = 'published' ORDER BY ${orderBy}`);
      return prepMany(rows);
    },

    /** Public single item by slug. */
    async getPublic(slug) {
      return prep(await qOne(`SELECT * FROM \`${table}\` WHERE slug = ? AND status = 'published'`, [slug]));
    },

    /** Public list with a custom WHERE clause (e.g. upcoming events). */
    async listPublicWhere(whereSql, params = [], order = orderBy) {
      const rows = await q(
        `SELECT * FROM \`${table}\` WHERE status = 'published' AND ${whereSql} ORDER BY ${order}`,
        params
      );
      return prepMany(rows);
    },

    /** One published row matching a custom WHERE clause. */
    async onePublicWhere(whereSql, params = [], order = orderBy) {
      return prep(await qOne(
        `SELECT * FROM \`${table}\` WHERE status = 'published' AND ${whereSql} ORDER BY ${order} LIMIT 1`,
        params
      ));
    },

    /** Admin list — every row, optionally filtered by a free-text search. */
    async list({ q: term } = {}) {
      if (term && def.search && def.search.length) {
        const like = `%${term}%`;
        const where = def.search.map((c) => `\`${c}\` LIKE ?`).join(' OR ');
        const rows = await q(
          `SELECT * FROM \`${table}\` WHERE ${where} ORDER BY ${orderBy}`,
          def.search.map(() => like)
        );
        return prepMany(rows);
      }
      return prepMany(await q(`SELECT * FROM \`${table}\` ORDER BY ${orderBy}`));
    },

    async get(id) {
      return prep(await qOne(`SELECT * FROM \`${table}\` WHERE id = ?`, [id]));
    },

    async create(body) {
      const data = buildWriteData({ ...body, status: body.status === 'published' ? 'published' : 'draft' });
      await ensureUniqueSlug(data);
      const result = await q(`INSERT INTO \`${table}\` SET ?`, [data]);
      return crud.get(result.insertId);
    },

    async update(id, body) {
      const data = buildWriteData(body);
      if (Object.keys(data).length > 0) {
        await ensureUniqueSlug(data, id);
        await q(`UPDATE \`${table}\` SET ? WHERE id = ?`, [data, id]);
      }
      return crud.get(id);
    },

    async setStatus(id, status) {
      if (status !== 'draft' && status !== 'published') {
        throw new Error('Invalid status.');
      }
      const data = { status };
      if (status === 'published') data.published_at = new Date();
      await q(`UPDATE \`${table}\` SET ? WHERE id = ?`, [data, id]);
      return crud.get(id);
    },

    async remove(id) {
      await q(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
      return { ok: true };
    },

    async count() {
      const row = await qOne(`SELECT COUNT(*) AS c FROM \`${table}\``);
      return row ? row.c : 0;
    },

    /** Parse JSON columns on arbitrary already-fetched rows. */
    prep,
    prepMany
  };

  return crud;
}

module.exports = buildModuleCrud;