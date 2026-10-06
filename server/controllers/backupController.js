'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Lists and streams the backups produced by ops/backup.sh.
 *
 * Backups are made by cron on the host; this only exposes what already exists.
 * On-demand creation was deliberately left out: the app container has no
 * mysqldump, and a web endpoint that spawns processes is a DoS waiting to
 * happen. Nightly at 02:15 is fresher than any manual click.
 *
 * The directory is mounted read-only (/backups), so nothing here can create,
 * modify or delete a backup even if a future bug tried.
 *
 * Two safety rules that matter:
 *
 * 1. env/current.env is NOT downloadable. It holds JWT_SECRET and every
 *    password. Handing it to a browser widens exposure for no benefit - the
 *    VM's copy is already on disk, and an admin who needs it can read it over
 *    SSH. It is listed as `secrets: true` so the UI can say so plainly.
 *
 * 2. The artifact name comes from a fixed whitelist, never from the URL, and
 *    the resolved path is re-checked to be inside the root. A path like
 *    ../../.env cannot escape.
 */

const ROOT = process.env.BACKUPS_DIR_IN_CONTAINER || '/backups';

// name -> { subdir, label, secrets }
const ARTIFACTS = {
  db:      { subdir: ['db/daily', 'db/weekly'], label: 'Database dump (.sql.gz)', secrets: false },
  binlog:  { subdir: ['db/binlog'],              label: 'Binary logs (.tgz)',     secrets: false },
  media:   { subdir: ['media'],                   label: 'Uploaded media (.tgz)',  secrets: false },
  manifest:{ subdir: ['db/manifests'],            label: 'Dump manifest (.txt)',    secrets: false },
  env:     { subdir: ['env'],                     label: 'Secrets (.env)',          secrets: true }
};

const STAMP_RE = /^\d{8}-\d{6}$/;

function exists(p) {
  try { fs.accessSync(p); return true; } catch (e) { return false; }
}

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => STAMP_RE.test(f.replace(/\.(sql\.gz|tgz|txt|env)$/, '')))
      .map((f) => ({ name: f, mtime: (() => { try { return fs.statSync(path.join(dir, f)).mtime.toISOString(); } catch (e) { return null; } })() }));
  } catch (e) {
    return [];
  }
}

/**
 * GET /api/admin/backups
 * Grouped by artifact so the UI can render one row per kind.
 */
async function list(req, res) {
  if (!exists(ROOT)) {
    return res.json({
      mounted: false,
      message: 'No backups directory is mounted into the app container. Set BACKUPS_DIR and restart.',
      groups: []
    });
  }

  const groups = [];
  for (const [kind, def] of Object.entries(ARTIFACTS)) {
    if (def.secrets) {
      // Present, but deliberately not offered as a download.
      groups.push({
        kind, label: def.label, secrets: true,
        items: exists(path.join(ROOT, def.subdir[0]))
          ? [{ name: 'current.env', bytes: sizeOf(path.join(ROOT, def.subdir[0], 'current.env')) }]
          : [],
        note: 'Contains JWT_SECRET and every password, so it is not downloadable here. It is on the VM at /opt/student-affairs/backups/env/current.env.'
      });
      continue;
    }
    const items = [];
    for (const sub of def.subdir) {
      const dir = path.join(ROOT, sub);
      for (const f of listDir(dir)) {
        const ext = kind === 'db' ? '.sql.gz' : kind === 'manifest' ? '.meta' : '.tgz';
        items.push({ name: f.name, bucket: sub, bytes: sizeOf(path.join(dir, f.name)), mtime: f.mtime, download: `${f.name.replace(/\.meta$/, '')}` });
      }
    }
    items.sort((a, b) => String(b.name).localeCompare(String(a.name)));
    groups.push({ kind, label: def.label, secrets: false, items });
  }

  // Newest dump, which is what most people actually want.
  const newestDump = (groups.find((g) => g.kind === 'db') || {}).items || [];

  return res.json({
    mounted: true,
    root: ROOT,
    groups,
    newest: newestDump.length ? newestDump[0] : null,
    totals: {
      db: (groups.find((g) => g.kind === 'db') || { items: [] }).items.length,
      media: (groups.find((g) => g.kind === 'media') || { items: [] }).items.length,
      binlog: (groups.find((g) => g.kind === 'binlog') || { items: [] }).items.length
    }
  });
}

/**
 * GET /api/admin/backups/:kind/:stamp
 * Streams one artifact as an attachment.
 *
 * createReadStream, never readFile: a media archive can be tens of gigabytes
 * and buffering one would take the container down.
 */
async function download(req, res) {
  const kind = String(req.params.kind || '');
  const stamp = String(req.params.stamp || '').replace(/\.(sql\.gz|tgz|meta|env)$/, '');

  const def = ARTIFACTS[kind];
  if (!def) return res.status(404).json({ error: 'Unknown backup type.' });
  if (def.secrets) {
    return res.status(403).json({
      error: 'The secrets file is not downloadable. It contains JWT_SECRET and every password; read it on the VM instead.'
    });
  }
  // Only the canonical stamp shape is accepted. This is the second half of the
  // traversal guard - the resolved path is checked against ROOT below too.
  if (!STAMP_RE.test(stamp)) {
    return res.status(400).json({ error: 'Invalid backup name.' });
  }

  const suffix = kind === 'db' ? '.sql.gz' : kind === 'manifest' ? '.meta' : '.tgz';
  let file = null;
  for (const sub of def.subdir) {
    const candidate = path.resolve(ROOT, sub, stamp + suffix);
    // Belt and braces: resolve() already collapsed any "..", this asserts the
    // result is genuinely under the backup root.
    if (!candidate.startsWith(path.resolve(ROOT) + path.sep)) continue;
    if (exists(candidate)) { file = candidate; break; }
  }
  if (!file) return res.status(404).json({ error: 'No such backup.' });

  const bytes = sizeOf(file);
  const filename = path.basename(file);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(bytes));
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const stream = fs.createReadStream(file);
  // If the browser aborts (closes the tab) destroy the read side too, or the
  // process keeps pulling gigabytes off disk for nobody.
  res.on('close', () => stream.destroy());

  stream.on('error', () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  stream.pipe(res);
}

module.exports = { list, download, ARTIFACTS, ROOT };