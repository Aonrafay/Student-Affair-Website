'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Disk usage guard for the uploads directory.
 *
 * Why this exists: multer caps a single file at 15 MB but nothing capped the
 * total, so one editor (or one runaway script) could fill the VM's disk. Once
 * the volume is full MySQL cannot write either, which takes the whole site
 * down rather than just failing an upload.
 *
 * Directory walking is O(files), and this directory is expected to hold tens of
 * thousands of media files, so the total is cached for CACHE_MS and recomputed
 * at most that often. The result is deliberately allowed to be slightly stale:
 * a handful of concurrent uploads can overshoot the limit by a few files. That
 * is fine for a guard whose job is to stop a runaway, and it keeps every
 * upload from re-walking the whole tree.
 */

const CACHE_MS = 60 * 1000;

// 20 GB default. Raise with UPLOADS_MAX_BYTES, or set 0 to disable the guard.
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024 * 1024;

// Keyed by directory: usage() can be called for more than one path (the app
// uses one, tests use a temp dir), and a single shared value would answer with
// the previous directory's total.
const cache = new Map();

function maxBytes() {
  const raw = process.env.UPLOADS_MAX_BYTES;
  if (raw === undefined || raw === '') return DEFAULT_MAX_BYTES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Sum the sizes of every regular file under `dir`. Missing dir counts as 0. */
function walk(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += walk(full);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch (e) { /* raced with a delete - ignore */ }
    }
  }
  return total;
}

/** Current bytes used in `dir`, cached per-directory for CACHE_MS. */
function usage(dir) {
  const now = Date.now();
  const hit = cache.get(dir);
  if (hit && now - hit.at < CACHE_MS) return hit.bytes;
  const bytes = walk(dir);
  cache.set(dir, { bytes, at: now });
  return bytes;
}

/** Force the next usage() call for `dir` (or all dirs) to re-walk. */
function invalidate(dir) {
  if (dir) cache.delete(dir);
  else cache.clear();
}

/**
 * Throw if accepting `incomingBytes` would push usage over the cap.
 * @throws {Error} with `status = 507` when there is not enough room.
 */
function assertRoom(dir, incomingBytes, label) {
  const cap = maxBytes();
  if (!cap) return { used: usage(dir), cap: 0 };            // guard disabled
  const used = usage(dir);
  if (used + incomingBytes > cap) {
    const err = new Error(
      `Not enough upload space. ${label} would take the media library to ` +
      `${formatBytes(used + incomingBytes)}, over its ${formatBytes(cap)} limit. ` +
      'Delete unused media or ask an administrator to raise UPLOADS_MAX_BYTES.'
    );
    err.status = 507;
    throw err;
  }
  return { used, cap };
}

function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

module.exports = { usage, maxBytes, assertRoom, invalidate, formatBytes, DEFAULT_MAX_BYTES };