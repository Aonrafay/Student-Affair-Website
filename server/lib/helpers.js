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

module.exports = { slugify, uniqueSlug, parseJSON, toJSON };