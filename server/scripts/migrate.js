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
    await q(stmt);
  }
  console.log(`Migration complete — applied ${statements.length} statement(s).`);
}

migrate()
  .then(() => pool.end())
  .catch((e) => {
    console.error('Migration failed:', e.message);
    pool.end().finally(() => process.exit(1));
  });