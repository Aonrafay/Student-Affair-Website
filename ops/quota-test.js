'use strict';

/**
 * Unit tests for lib/uploadsQuota.js.
 *
 * The quota's refusal path is not exercised by security-test.ps1, because
 * forcing it over HTTP would mean either filling the real disk or restarting
 * the app with a one-byte cap. This drives assertRoom() directly against a
 * temp directory instead.
 *
 *   node ops/quota-test.js            (run inside the app container, or locally)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const quota = require('../server/lib/uploadsQuota');

let fails = 0;
function check(name, ok, detail) {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-test-'));
function writeFile(name, bytes) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
}

const original = process.env.UPLOADS_MAX_BYTES;

try {
  // --- disabled (cap 0) ----------------------------------------------------
  process.env.UPLOADS_MAX_BYTES = '0';
  quota.invalidate();
  check('cap of 0 disables the guard', quota.maxBytes() === 0);
  quota.assertRoom(tmp, 999999999, 'huge.bin');
  check('a disabled guard lets anything through', true);

  // --- no DB_CAP set: 20 GB default ---------------------------------------
  delete process.env.UPLOADS_MAX_BYTES;
  quota.invalidate();
  check('default cap is 20 GB', quota.maxBytes() === 20 * 1024 * 1024 * 1024,
    quota.formatBytes(quota.maxBytes()));

  // --- under the cap: allowed ----------------------------------------------
  process.env.UPLOADS_MAX_BYTES = '1000';
  quota.invalidate();
  writeFile('a.bin', 400);
  check('usage walks the directory', quota.usage(tmp) === 400, `${quota.usage(tmp)} bytes`);
  quota.assertRoom(tmp, 400, 'b.bin');
  check('an upload that fits is allowed', true);

  // --- exactly at the cap: allowed (the cap is inclusive) -----------------
  quota.invalidate();
  writeFile('c.bin', 200);           // now 600 used
  quota.assertRoom(tmp, 400, 'd.bin'); // 600 + 400 = 1000 = cap
  check('an upload that exactly reaches the cap is allowed', true);

  // --- over the cap: refused with 507 -------------------------------------
  quota.invalidate();
  let refused = null;
  try {
    quota.assertRoom(tmp, 401, 'e.bin');  // 600 + 401 > 1000
  } catch (e) {
    refused = e;
  }
  check('an upload past the cap is refused', refused !== null);
  check('the refusal carries HTTP 507', refused && refused.status === 507, refused && refused.status);
  check('the refusal names the limit in the message',
    refused && /limit/i.test(refused.message) && /1000 B/.test(refused.message),
    refused && refused.message);

  // --- recursive walk -------------------------------------------------------
  process.env.UPLOADS_MAX_BYTES = '100000';
  quota.invalidate();
  const nested = path.join(tmp, 'sub', 'deep');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'x.bin'), Buffer.alloc(1000, 1));
  check('usage recurses into subdirectories', quota.usage(tmp) >= 1600, `${quota.usage(tmp)} bytes`);

  // --- a missing directory counts as zero, not a crash ---------------------
  check('a missing directory reports 0', quota.usage('/no/such/path/at/all') === 0);

  // --- invalidate() forces a re-walk after a delete ------------------------
  process.env.UPLOADS_MAX_BYTES = '100000';
  quota.invalidate();
  const before = quota.usage(tmp);
  fs.unlinkSync(path.join(nested, 'x.bin'));
  const stale = quota.usage(tmp);
  check('usage is cached until invalidated', stale === before, `${before} then ${stale}`);
  quota.invalidate();
  check('invalidate() picks up the deletion', quota.usage(tmp) < before, `${stale} then ${quota.usage(tmp)}`);

  // --- formatting -----------------------------------------------------------
  check('formatBytes is human readable',
    quota.formatBytes(1024) === '1.0 KB' && quota.formatBytes(20 * 1024 ** 3) === '20.0 GB',
    `${quota.formatBytes(1024)} / ${quota.formatBytes(20 * 1024 ** 3)}`);
} finally {
  if (original === undefined) delete process.env.UPLOADS_MAX_BYTES;
  else process.env.UPLOADS_MAX_BYTES = original;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (fails === 0) { console.log('ALL QUOTA CHECKS PASSED'); process.exit(0); }
else { console.log(`${fails} CHECK(S) FAILED`); process.exit(1); }