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
// express.static - so an SVG would be stored XSS that can read the admin JWT
// out of localStorage. Use PNG or WebP for logos instead.
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf'
};

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
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
    cb(new Error('Only images (jpg, png, gif, webp) and PDF files are allowed.'));
  }
}).single('file');

/** POST /api/admin/media — multipart with field `file` (+ optional caption). */
function handleUpload(req, res) {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file received. Use a field named "file".' });
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
      return res.status(500).json({ error: 'Could not record upload: ' + e.message });
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

module.exports = { handleUpload, listMedia, deleteMedia, mediaUsage, ALLOWED_TYPES };