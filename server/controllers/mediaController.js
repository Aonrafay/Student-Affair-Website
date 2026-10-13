'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { q, qOne } = require('../config/db');
const paths = require('../config/paths');
const quota = require('../lib/uploadsQuota');
const audit = require('../lib/audit');

// SVG is deliberately NOT allowed. An SVG is an XML document that can carry
// <script>, and uploads are served from the same origin as the admin panel by
// express.static - so so an SVG would be stored XSS that can read the admin JWT
// out of localStorage. Use PNG or WebP for logos instead.
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

/**
 * Magic-byte signatures per accepted MIME type.
 *
 * fileFilter below can only see the Content-Type the client declared, which is
 * attacker-controlled: `curl -F "file=@evil.html;type=image/png"` stores HTML
 * under a .png name. Combined with express.static serving uploads from the
 * admin's own origin, that is stored XSS whatever the extension says.
 *
 * The extension is still derived from the declared type (see the filename
 * callback) - this check then confirms the bytes actually agree, so a caller
 * cannot get HTML/JS/PDF-polyglot content served from this origin.
 *
 * Each entry is (offset, expected bytes as a latin1 string). Offsets are fixed
 * by the format specs; the checks are deliberately minimal but sufficient to
 * tell the five accepted formats apart and reject everything else.
 */
const SIGNATURES = {
  'image/jpeg': [
    [0, '\xff\xd8\xff']
  ],
  'image/png': [
    [0, '\x89PNG\r\n\x1a\n']
  ],
  'image/gif': [
    [0, 'GIF87a'],
    [0, 'GIF89a']
  ],
  'image/webp': [
    [0, 'RIFF'],       // then "WEBP" at offset 8, checked below
    [8, 'WEBP']
  ],
  'application/pdf': [
    [0, '%PDF-']
  ]
};

/**
 * Confirm a file's real bytes match the MIME type it was declared with.
 *
 * Reads only the first 16 bytes, so cost is independent of file size. Returns
 * null when the content matches, or a human-readable reason when it does not.
 */
function sniffMismatch(filePath, mime) {
  const expected = SIGNATURES[mime];
  // No signature table for this type means it never reaches here (fileFilter
  // gates it), but fail closed rather than wave an unknown type through.
  if (!expected) return 'unsupported content type';
  let fd;
  let head;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    head = buf.slice(0, read);
  } catch (e) {
    return 'could not be read back from disk';
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } }
  }
  if (head.length < 4) return 'file is empty or truncated';
  for (const [offset, magic] of expected) {
    const slice = head.slice(offset, offset + magic.length);
    if (slice.toString('latin1') !== magic) {
      return 'its contents do not look like ' + mime.replace('image/', '').toUpperCase();
    }
  }
  return null;
}

/**
 * Per-file ceiling.
 *
 * There is deliberately no per-type limit - one global number, set with
 * MAX_UPLOAD_BYTES (default 4 GB). The real ceiling an operator controls is
 * UPLOADS_MAX_BYTES in .env (see lib/uploadsQuota.js), which caps the library
 * as a whole; this only stops a single transfer from being unbounded.
 *
 * multer stops the stream mid-write, so an oversized upload never lands whole
 * on the disk. It cannot be removed entirely: with no fileSize limit multer
 * writes until the volume is full, and once the volume is full MySQL cannot
 * write either, so the whole site goes down rather than just the upload.
 */
const MAX_UPLOAD_BYTES = (() => {
  const raw = process.env.MAX_UPLOAD_BYTES;
  if (raw === undefined || raw === '') return 4 * 1024 * 1024 * 1024;
  const n = Number(raw);
  // 0 or an unparseable value means "no per-file cap"; the quota still applies.
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

function humanBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(paths.uploads, { recursive: true });
    cb(null, paths.uploads);
  },
  filename(req, file, cb) {
    const ext = ALLOWED_TYPES[file.mimetype] ||
      path.extname(file.originalname || '').toLowerCase() ||
      '.bin';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: MAX_UPLOAD_BYTES ? { fileSize: MAX_UPLOAD_BYTES } : {},
  fileFilter(req, file, cb) {
    if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
    cb(new Error('Only images (jpg, png, gif, webp) and PDF files are allowed.'));
  }
}).single('file');

/** POST /api/admin/media — multipart with field `file` (+ optional caption). */
function handleUpload(req, res) {
  upload(req, res, async (err) => {
    if (err) {
      // multer's own LIMIT_FILE_SIZE message is generic and mentions the number
      // in bytes; say it in terms the person uploading will recognise.
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `That file is larger than the ${humanBytes(MAX_UPLOAD_BYTES)} per-file limit.` +
            ' Raise MAX_UPLOAD_BYTES in .env, or compress the file first.'
        });
      }
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file received. Use a field named "file".' });
    }
    // Content check first. The declared Content-Type is client-controlled, so a
    // .png name with image/png proves nothing about the bytes; uploads are
    // served from the admin's own origin, so HTML stored here is stored XSS.
    const mismatch = sniffMismatch(req.file.path, req.file.mimetype);
    if (mismatch) {
      try { fs.unlinkSync(req.file.path); } catch (cleanupErr) { /* best effort */ }
      audit.record(req, 'media.reject', {
        module: 'media',
        target: req.file.originalname || req.file.filename,
        meta: { reason: 'content-signature-mismatch', declared_mime: req.file.mimetype }
      });
      return res.status(400).json({
        error: 'That file was rejected: ' + mismatch +
          '. The file type and its actual content must match.'
      });
    }
    // Disk guard: multer has already written the file to disk by this point,
    // so the quota check has to happen before the row is created AND the
    // orphaned file has to be removed when the limit is hit.
    try {
      quota.assertRoom(paths.uploads, req.file.size, req.file.original_name || req.file.filename);
    } catch (e) {
      try { fs.unlinkSync(path.filePath); } catch (cleanupErr) { /* best effort */ }
      return res.status(e.status || 507).json({ error: e.message });
    }
    try {
      const result = await q(
        'INSERT INTO media (filename, original_name, mime, size, caption) VALUES (?, ?, ?, ?, ?)',
        [
          req.file.filename,
          String(req.file.originalname).slice(0, 200),
          req.file.mimetype,
          req.file.size,
          String((req.body && req.body.caption) || '').slice(0, 200)
        ]
      );
      const row = await qOne('SELECT * FROM media WHERE id = ?', [result.insertId]);
      audit.record(req, 'media.upload', {
        module: 'media',
        target: row.original_name || row.filename,
        meta: { bytes: row.size, mime: row.mime }
      });
      return res.status(201).json(row);
    } catch (e) {
      // Generic message only. A driver error here names the table, the column
      // and the constraint, which is free schema reconnaissance; the detail goes
      // to the server log where it belongs. Mirrors the global error handler.
      console.error('media: could not record upload', e);
      return res.status(500).json({ error: 'Could not record the upload. Please try again.' });
    }
  });
}

/** GET /api/admin/media */
async function listMedia(req, res) {
  const rows = await q('SELECT * FROM media ORDER BY id DESC');
  return res.json(rows);
}

/** DELETE /api/admin/media/:id — removes the row and the file on disk. */
async function deleteMedia(req, res) {
  const row = await qOne('SELECT * FROM media WHERE id = ?', [req.params.id]);
  if (!row) {
    return res.status(404).json({ error: 'Media item not found.' });
  }
  const filePath = path.join(paths.uploads, row.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    // The cached total is now stale by at least one file.
    quota.invalidate();
  }
  await q('DELETE FROM media WHERE id = ?', [req.params.id]);
  audit.record(req, 'media.delete', { module: 'media', target: row.original_name || row.filename });
  return res.json({ ok: true });
}

/** Disk usage of the media library, for the admin dashboard. */
async function mediaUsage(req, res) {
  const used = quota.usage(paths.uploads);
  const cap = quota.maxBytes();
  return res.json({
    used_bytes: used,
    max_bytes: cap,
    used_label: quota.formatBytes(used),
    max_label: cap ? quota.formatBytes(cap) : null,
    count: (await qOne('SELECT COUNT(*) AS c FROM media')).c
  });
}

module.exports = {
  handleUpload, listMedia, deleteMedia, mediaUsage,
  ALLOWED_TYPES, MAX_UPLOAD_BYTES, humanBytes
};