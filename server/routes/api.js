'use strict';

const express = require('express');
const modules = require('../modules');
const buildModuleCrud = require('../lib/crud');
const authController = require('../controllers/authController');
const contentController = require('../controllers/contentController');
const mediaController = require('../controllers/mediaController');
const usersController = require('../controllers/usersController');
const { protect, requireRole, requireModuleRole } = require('../middleware/authMiddleware');
const societyYearsController = require('../controllers/societyYearsController');

/** Express router with every CMS route. Mounted at BASE_PATH + '/api'. */

/** Only real module definitions — never the (non-enumerable) `list` helper. */
function moduleDefs() {
  return Object.values(modules).filter((def) => def && def.id && def.fields);
}

/** Wrap an async handler so rejections reach the error middleware (Express 4). */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function buildApiRouter() {
  const router = express.Router();

  // --- Public: health ----------------------------------------------------------
  router.get('/health', async (req, res) => {
    try {
      const { pool } = require('../config/db');
      await pool.query('SELECT 1');
      res.json({ ok: true, db: true });
    } catch (e) {
      res.status(503).json({ ok: false, db: false, error: e.message });
    }
  });

  // --- Auth --------------------------------------------------------------------
  router.post('/auth/login', h(authController.login));
  router.get('/auth/me', protect, h(authController.me));

  // --- Public: site copy + settings ---------------------------------------------
  router.get('/settings', h(contentController.getPublicSettings));
  router.get('/pages/:key', h(contentController.getPublicPage));

  // --- Public: societies detail (carries its published year pages) --------------
  // Registered BEFORE the generic module loop — Express matches this route
  // first, so GET /api/societies/:slug returns the society plus `years`, each
  // year page with its Markdown body and officers/committee members.
  const societiesCrud = buildModuleCrud(modules.societies);
  router.get('/societies/:slug', h(async (req, res) => {
    const row = await societiesCrud.getPublic(req.params.slug);
    if (!row) return res.status(404).json({ error: 'Not found.' });
    // People moved to society_members (attached to year pages) — drop the
    // legacy embedded JSON columns from the public payload.
    delete row.officers;
    delete row.team;
    row.years = await societyYearsController.publicYears(row.id);
    res.json(row);
  }));

  // --- Public: module content (published rows only) -----------------------------
  for (const def of moduleDefs()) {
    const crud = buildModuleCrud(def);
    const base = `/${def.id}`;

    if (def.id === 'events') {
      /** Optional `?limit=N` — used by the home page ("next 3 events"). */
      const slice = (rows, limitParam) => {
        const n = Number(limitParam);
        return Number.isInteger(n) && n > 0 ? rows.slice(0, n) : rows;
      };
      // `config/db.js` writes/reads every timestamp as UTC (timezone: 'Z'), so
      // comparisons must use a UTC "now" from Node — MySQL's NOW() would use the
      // server's session time zone and shift the upcoming/past split.
      const utcNow = () => new Date();

      router.get(`${base}/upcoming`, h(async (req, res) => {
        const rows = await crud.listPublicWhere('start_time >= ?', [utcNow()], 'start_time ASC');
        res.json(slice(rows, req.query.limit));
      }));
      router.get(`${base}/next`, h(async (req, res) => {
        const row = await crud.onePublicWhere('start_time >= ?', [utcNow()], 'start_time ASC');
        if (!row) return res.status(404).json({ error: 'No upcoming event found.' });
        res.json(row);
      }));
      router.get(`${base}/past`, h(async (req, res) => {
        const rows = await crud.listPublicWhere('start_time < ?', [utcNow()], 'start_time DESC');
        res.json(slice(rows, req.query.limit));
      }));
    }

    router.get(base, h(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : null;
      const n = Number.isInteger(limit) && limit > 0 ? limit : null;
      res.json(await crud.listPublic(n));
    }));

    router.get(`${base}/:slug`, h(async (req, res) => {
      const row = await crud.getPublic(req.params.slug);
      if (!row) return res.status(404).json({ error: 'Not found.' });
      res.json(row);
    }));
  }

  // --- Admin (everything below requires a valid session) ------------------------
  router.use('/admin', protect);

  // --- Society year pages + members (nested under societies) ---------------------
  // Registered BEFORE the generic module loop, so these routes win over the
  // generic /admin/societies/:id ones. Roles follow the societies module
  // (admin + editor). Deleting a society cascades to its years + members.
  const socGuard = requireModuleRole(modules.societies);
  router.get('/admin/societies/:societyId(\\d+)/years', socGuard, h(societyYearsController.listYears));
  router.post('/admin/societies/:societyId(\\d+)/years', socGuard, h(societyYearsController.createYear));
  router.get('/admin/societies/:societyId(\\d+)/years/:yearId(\\d+)', socGuard, h(societyYearsController.getYear));
  router.put('/admin/societies/:societyId(\\d+)/years/:yearId(\\d+)', socGuard, h(societyYearsController.updateYear));
  router.post('/admin/societies/:societyId(\\d+)/years/:yearId(\\d+)/publish', socGuard, h(societyYearsController.publishYear));
  router.delete('/admin/societies/:societyId(\\d+)/years/:yearId(\\d+)', socGuard, h(societyYearsController.deleteYear));
  router.post('/admin/societies/:societyId(\\d+)/years/:yearId(\\d+)/members', socGuard, h(societyYearsController.createMember));
  router.put('/admin/societies/:societyId(\\d+)/years/:yearId(\\d+)/members/:memberId(\\d+)', socGuard, h(societyYearsController.updateMember));
  router.delete('/admin/societies/:societyId(\\d+)/years/:yearId(\\d+)/members/:memberId(\\d+)', socGuard, h(societyYearsController.deleteMember));
  // Cascade delete — replaces the generic societies DELETE (this one wins).
  router.delete('/admin/societies/:id(\\d+)', socGuard, h(async (req, res) => {
    await societyYearsController.deleteSocietyCascade(Number(req.params.id));
    res.json({ ok: true });
  }));

  for (const def of moduleDefs()) {
    const crud = buildModuleCrud(def);
    const base = `/admin/${def.id}`;
    // The legacy `officers`/`team` JSON columns on `societies` were replaced by
    // society_members (attached to year pages). They stay in the table for
    // rollback safety but are no longer part of the API surface.
    const stripLegacy = (row) => {
      if (def.id !== 'societies' || !row) return row;
      const { officers, team, ...rest } = row;
      return rest;
    };

    router.get(base, requireModuleRole(def), h(async (req, res) => {
      res.json((await crud.list({ q: req.query.q })).map(stripLegacy));
    }));

    router.get(`${base}/:id(\\d+)`, requireModuleRole(def), h(async (req, res) => {
      const row = await crud.get(Number(req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found.' });
      res.json(stripLegacy(row));
    }));

    router.post(base, requireModuleRole(def), h(async (req, res) => {
      try {
        res.status(201).json(stripLegacy(await crud.create(req.body || {})));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    }));

    router.post(`${base}/:id(\\d+)/publish`, requireModuleRole(def), h(async (req, res) => {
      try {
        const status = (req.body && req.body.status) || 'published';
        const row = await crud.setStatus(Number(req.params.id), status);
        if (!row) return res.status(404).json({ error: 'Not found.' });
        res.json(stripLegacy(row));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    }));

    router.put(`${base}/:id(\\d+)`, requireModuleRole(def), h(async (req, res) => {
      try {
        const row = await crud.update(Number(req.params.id), req.body || {});
        if (!row) return res.status(404).json({ error: 'Not found.' });
        res.json(stripLegacy(row));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    }));

    router.delete(`${base}/:id(\\d+)`, requireModuleRole(def), h(async (req, res) => {
      await crud.remove(Number(req.params.id));
      res.json({ ok: true });
    }));
  }

  // Media — any authenticated staff member (editor is allowed).
  router.get('/admin/media', h(mediaController.listMedia));
  router.post('/admin/media', h(mediaController.handleUpload));
  router.delete('/admin/media/:id(\\d+)', h(mediaController.deleteMedia));

  // Dashboard stats — any authenticated staff member.
  router.get('/admin/stats', h(contentController.stats));

  // Users — admins only.
  router.get('/admin/users', requireRole('admin'), h(usersController.listUsers));
  router.post('/admin/users', requireRole('admin'), h(usersController.createUser));
  router.put('/admin/users/:id(\\d+)', requireRole('admin'), h(usersController.updateUser));
  router.delete('/admin/users/:id(\\d+)', requireRole('admin'), h(usersController.deleteUser));

  // Pages + settings copy — admins only.
  router.get('/admin/pages', requireRole('admin'), h(contentController.listPages));
  router.get('/admin/pages/:key', requireRole('admin'), h(contentController.getAdminPage));
  router.put('/admin/pages/:key', requireRole('admin'), h(contentController.updatePage));
  router.get('/admin/settings', requireRole('admin'), h(contentController.getAdminSettings));
  router.put('/admin/settings', requireRole('admin'), h(contentController.updateSettings));

  return router;
}

module.exports = buildApiRouter;