'use strict';

const { q, qOne } = require('../config/db');

// ============================================================================
// Society year pages + their people (nested under societies).
//
// Each society gets one Markdown page per year ("2025-26"), and each year page
// carries its own cabinet: officers + committee members. Routes are wired
// explicitly in routes/api.js (not the generic module loop) because of the
// nested /years + /members paths:
//   GET    /api/admin/societies/:sid/years                list year pages
//   POST   /api/admin/societies/:sid/years                create year page
//   GET    /api/admin/societies/:sid/years/:yid           year page + members
//   PUT    /api/admin/societies/:sid/years/:yid           update
//   POST   /api/admin/societies/:sid/years/:yid/publish   publish/unpublish
//   DELETE /api/admin/societies/:sid/years/:yid            delete (+ members)
//   POST   /api/admin/societies/:sid/years/:yid/members            create member
//   PUT    /api/admin/societies/:sid/years/:yid/members/:mid        update member
//   DELETE /api/admin/societies/:sid/years/:yid/members/:mid        delete member
//   DELETE /api/admin/societies/:id                       cascade society delete
// ============================================================================

const YEAR_FIELDS = ['year', 'title', 'body', 'cover'];
const MEMBER_FIELDS = ['name', 'role', 'email', 'bio', 'photo', 'category', 'sort_order'];

/** Whitelist an incoming body: keep known fields only, trim strings, "" → null. */
function pickFields(body, fields) {
  const data = {};
  for (const key of fields) {
    if (body[key] === undefined) continue;
    let value = body[key];
    if (typeof value === 'string') value = value.trim();
    data[key] = value === '' ? null : value;
  }
  return data;
}

/** Normalise the optional sort_order (""/null/NaN → 0). */
function normSort(value) {
  const n = Number(value);
  return value === null || value === undefined || Number.isNaN(n) ? 0 : n;
}

async function findYear(societyId, yearId) {
  return qOne('SELECT * FROM society_years WHERE id = ? AND society_id = ?', [yearId, societyId]);
}

async function listMembers(yearId) {
  // ENUM('officer','committee') sorts officers first (declared order), then by
  // the admin's sort order — the public page uses that to pick the lead person.
  return q(
    'SELECT id, name, role, email, bio, photo, category, sort_order FROM society_members ' +
    'WHERE society_year_id = ? ORDER BY category ASC, sort_order ASC, id ASC',
    [yearId]
  );
}

async function getYearWithMembers(societyId, yearId) {
  const year = await findYear(societyId, yearId);
  if (!year) return null;
  year.members = await listMembers(year.id);
  return year;
}

// ------------------------------------------------------------- public -------

/** Published year pages of one society, newest first, each with its members. */
async function publicYears(societyId) {
  const years = await q(
    'SELECT id, `year`, title, body, cover, published_at FROM society_years ' +
    'WHERE society_id = ? AND status = \'published\' ORDER BY `year` DESC, id DESC',
    [societyId]
  );
  for (const y of years) y.members = await listMembers(y.id);
  return years;
}

// ----------------------------------------------------------- year pages -----

async function listYears(req, res) {
  res.json(await q(
    'SELECT * FROM society_years WHERE society_id = ? ORDER BY `year` DESC, id DESC',
    [Number(req.params.societyId)]
  ));
}

async function getYear(req, res) {
  const year = await getYearWithMembers(Number(req.params.societyId), Number(req.params.yearId));
  if (!year) return res.status(404).json({ error: 'Year page not found.' });
  res.json(year);
}

async function createYear(req, res) {
  const societyId = Number(req.params.societyId);
  const society = await qOne('SELECT id FROM societies WHERE id = ?', [societyId]);
  if (!society) return res.status(404).json({ error: 'Society not found.' });

  const data = pickFields(req.body || {}, YEAR_FIELDS);
  if (!data.year) return res.status(400).json({ error: 'A year label is required (e.g. 2025-26).' });

  const clash = await qOne(
    'SELECT id FROM society_years WHERE society_id = ? AND `year` = ?',
    [societyId, data.year]
  );
  if (clash) {
    return res.status(409).json({ error: 'A page for ' + data.year + ' already exists for this society.' });
  }

  const result = await q('INSERT INTO society_years SET ?', [{ ...data, society_id: societyId }]);
  res.status(201).json(await getYearWithMembers(societyId, result.insertId));
}

async function updateYear(req, res) {
  const societyId = Number(req.params.societyId);
  const yearId = Number(req.params.yearId);
  const year = await findYear(societyId, yearId);
  if (!year) return res.status(404).json({ error: 'Year page not found.' });

  const data = pickFields(req.body || {}, YEAR_FIELDS);
  if (data.year === null) return res.status(400).json({ error: 'A year label is required (e.g. 2025-26).' });
  if (data.year && data.year !== year.year) {
    const clash = await qOne(
      'SELECT id FROM society_years WHERE society_id = ? AND `year` = ? AND id <> ?',
      [societyId, data.year, yearId]
    );
    if (clash) {
      return res.status(409).json({ error: 'A page for ' + data.year + ' already exists for this society.' });
    }
  }

  if (Object.keys(data).length > 0) {
    await q('UPDATE society_years SET ? WHERE id = ?', [data, yearId]);
  }
  res.json(await getYearWithMembers(societyId, yearId));
}

async function publishYear(req, res) {
  const societyId = Number(req.params.societyId);
  const yearId = Number(req.params.yearId);
  const year = await findYear(societyId, yearId);
  if (!year) return res.status(404).json({ error: 'Year page not found.' });

  const status = (req.body && req.body.status) === 'draft' ? 'draft' : 'published';
  const data = { status };
  if (status === 'published') data.published_at = new Date();
  await q('UPDATE society_years SET ? WHERE id = ?', [data, yearId]);
  res.json(await getYearWithMembers(societyId, yearId));
}

async function deleteYear(req, res) {
  const societyId = Number(req.params.societyId);
  const yearId = Number(req.params.yearId);
  const year = await findYear(societyId, yearId);
  if (!year) return res.status(404).json({ error: 'Year page not found.' });

  await q('DELETE FROM society_members WHERE society_year_id = ?', [yearId]);
  await q('DELETE FROM society_years WHERE id = ?', [yearId]);
  res.json({ ok: true });
}

// -------------------------------------------------------------- members -----

async function createMember(req, res) {
  const societyId = Number(req.params.societyId);
  const yearId = Number(req.params.yearId);
  const year = await findYear(societyId, yearId);
  if (!year) return res.status(404).json({ error: 'Year page not found.' });

  const data = pickFields(req.body || {}, MEMBER_FIELDS);
  if (!data.name) return res.status(400).json({ error: 'A name is required.' });
  if (data.category !== 'officer' && data.category !== 'committee') data.category = 'committee';
  data.sort_order = normSort(data.sort_order);

  const result = await q('INSERT INTO society_members SET ?', [{ ...data, society_year_id: yearId }]);
  res.status(201).json(await qOne('SELECT * FROM society_members WHERE id = ?', [result.insertId]));
}

async function updateMember(req, res) {
  const societyId = Number(req.params.societyId);
  const yearId = Number(req.params.yearId);
  const memberId = Number(req.params.memberId);

  const member = await qOne(
    'SELECT * FROM society_members WHERE id = ? AND society_year_id = ?',
    [memberId, yearId]
  );
  if (!member) return res.status(404).json({ error: 'Member not found.' });

  const data = pickFields(req.body || {}, MEMBER_FIELDS);
  if (data.name === null) return res.status(400).json({ error: 'A name is required.' });
  if (data.category !== undefined && data.category !== 'officer' && data.category !== 'committee') {
    return res.status(400).json({ error: 'Category must be officer or committee.' });
  }
  if (data.sort_order !== undefined) data.sort_order = normSort(data.sort_order);

  if (Object.keys(data).length > 0) {
    await q('UPDATE society_members SET ? WHERE id = ?', [data, memberId]);
  }
  res.json(await qOne('SELECT * FROM society_members WHERE id = ?', [memberId]));
}

async function deleteMember(req, res) {
  const yearId = Number(req.params.yearId);
  const memberId = Number(req.params.memberId);

  const member = await qOne(
    'SELECT id FROM society_members WHERE id = ? AND society_year_id = ?',
    [memberId, yearId]
  );
  if (!member) return res.status(404).json({ error: 'Member not found.' });

  await q('DELETE FROM society_members WHERE id = ?', [memberId]);
  res.json({ ok: true });
}

// ------------------------------------------------------------- cascades -----

/** Delete a society together with all of its year pages and their members. */
async function deleteSocietyCascade(societyId) {
  await q(
    'DELETE sm FROM society_members sm ' +
    'JOIN society_years sy ON sm.society_year_id = sy.id WHERE sy.society_id = ?',
    [societyId]
  );
  await q('DELETE FROM society_years WHERE society_id = ?', [societyId]);
  await q('DELETE FROM societies WHERE id = ?', [societyId]);
}

module.exports = {
  publicYears,
  listYears,
  getYear,
  createYear,
  updateYear,
  publishYear,
  deleteYear,
  createMember,
  updateMember,
  deleteMember,
  deleteSocietyCascade
};
