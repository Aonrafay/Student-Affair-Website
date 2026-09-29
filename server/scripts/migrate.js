'use strict';

const fs = require('fs');
const { q, pool } = require('../config/db');
const paths = require('../config/paths');

/** Apply server/schema.sql (idempotent — every statement uses IF NOT EXISTS). */
async function migrate() {
  console.log('Connecting to MySQL…');
  const raw = fs.readFileSync(paths.schema, 'utf8');

  // Strip -- line comments, then split into individual statements.
  const statements = raw
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /^(CREATE|ALTER)/i.test(s));

  for (const stmt of statements) {
    try {
      await q(stmt);
    } catch (e) {
      // MySQL has no "ADD COLUMN IF NOT EXISTS", so the ALTERs that upgrade an
      // older installation are re-run on every boot. Reaching this point on the
      // second boot means the change is already there — that is success, not a
      // failure. Anything else is a real error and must stop the boot.
      const alreadyThere = e.code === 'ER_DUP_FIELDNAME' || e.errno === 1060;
      if (!alreadyThere) throw e;
      console.log(`  skipped (already applied): ${stmt.slice(0, 60)}…`);
    }
  }
  console.log(`Migration complete — applied ${statements.length} statement(s).`);
}

migrate()
  .then(() => pool.end())
  .catch((e) => {
    console.error('Migration failed:', e.message);
    pool.end().finally(() => process.exit(1));
  });