'use strict';

const express = require('express');
const modules = require('../modules');
const buildModuleCrud = require('../lib/crud');
const authController = require('../controllers/authController');
const contentController = require('../controllers/contentController');
const mediaController = require('../controllers/mediaController');
const usersController = require('../controllers/usersController');
const { protect, requireRole, requireModuleRole } = require('../middleware/authMiddleware');

/** Express router with every CMS route. Mounted at BASE_PATH + '/api'. */

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

  // --- Public: module content (published rows only) -----------------------------
  for (const def of Object.values(modules)) {
    const crud = buildModuleCrud(def);
    const base = `/${def.id}`;

    if (def.id === 'events') {
      router.get(`${base}/upcoming`, h(async (req, res) => {
        const rows = await crud.listPublicWhere('start_time >= NOW()', [], 'start_time ASC');
        res.json(rows);
      }));
      router.get(`${base}/next`, h(async (req, res) => {
        const row = await crud.onePublicWhere('start_time >= NOW()', [], 'start_time ASC');
        if (!row) return res.status(404).json({ error: 'No upcoming event found.' });
        res.json(row);
      }));
      router.get(`${base}/past`, h(async (req, res) => {
        const rows = await crud.listPublicWhere('start_time < NOW()', [], 'start_time DESC');
        res.json(rows);
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

  for (const def of Object.values(modules)) {
    const crud = buildModuleCrud(def);
    const base = `/admin/${def.id}`;

    router.get(base, requireModuleRole(def), h(async (req, res) => {
      res.json(await crud.list({ q: req.query.q }));
    }));

    router.get(`${base}/:id(\\d+)`, requireModuleRole(def), h(async (req, res) => {
      const row = await crud.get(Number(req.params.id));
      if (!row) return res.status(404).json({ error: 'Not found.' });
      res.json(row);
    }));

    router.post(base, requireModuleRole(def), h(async (req, res) => {
      try {
        res.status(201).json(await crud.create(req.body || {}));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    }));

    router.post(`${base}/:id(\\d+)/publish`, requireModuleRole(def), h(async (req, res) => {
      try {
        const status = (req.body && req.body.status) || 'published';
        const row = await crud.setStatus(Number(req.params.id), status);
        if (!row) return res.status(404).json({ error: 'Not found.' });
        res.json(row);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    }));

    router.put(`${base}/:id(\\d+)`, requireModuleRole(def), h(async (req, res) => {
      try {
        const row = await crud.update(Number(req.params.id), req.body || {});
        if (!row) return res.status(404).json({ error: 'Not found.' });
        res.json(row);
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