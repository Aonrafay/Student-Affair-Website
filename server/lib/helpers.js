'use strict';

const { qOne } = require('../config/db');

/** Turn any string-ish value into a URL-safe slug. */
function slugify(input) {
  const base = String(input == null ? '' : input)
    .toLowerCase()
    .trim()
    .replace(/['"]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 160);
  return base || 'item';
}

/**
 * Return a slug for `base` that is unique in `table`, appending -2, -3, …
 * when the base is taken. `ignoreId` keeps that row's own slug valid on edit.
 */
async function uniqueSlug(table, base, ignoreId = null) {
  const start = slugify(base);
  let slug = start;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = ignoreId
      ? await qOne('SELECT id FROM `' + table + '` WHERE slug = ? AND id <> ?', [slug, ignoreId])
      : await qOne('SELECT id FROM `' + table + '` WHERE slug = ?', [slug]);
    if (!row) return slug;
    slug = `${start}-${n++}`;
  }
}

/** Parse a stored JSON string; fall back to `fallback` on any failure. */
function parseJSON(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

/** Serialize a value to a JSON string (or null for missing values). */
function toJSON(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * Decide whether an error's message is safe to return to the client.
 *
 * The module routes catch their own CRUD call and answer 400 with e.message so
 * that validation problems ("slug is required") read clearly. But a failure
 * that came from the driver instead names the table, the column and the
 * constraint - "Data too long for column 'title' at row 1" - which is free
 * schema reconnaissance and does not belong in an HTTP response.
 *
 * mysql2 tags its errors with code/errno/sqlState/sql; our own thrown errors
 * have none of those. So: keep messages from application code, log and genericise
 * everything the database produced.
 */
function isDatabaseError(e) {
  return !!(e && (e.code || e.errno || e.sqlState || e.sql || e.sqlMessage));
}

/**
 * A message that is safe to send to the client, logging the original.
 * Falls back to `generic` for driver errors and anything unexpected.
 */
function clientErrorMessage(e, generic = 'Request failed. Please try again.') {
  if (isDatabaseError(e)) {
    console.error('api: suppressed database error', e);
    return generic;
  }
  return (e && e.message) || generic;
}

module.exports = {
  slugify,
  uniqueSlug,
  parseJSON,
  toJSON,
  isDatabaseError,
  clientErrorMessage
};