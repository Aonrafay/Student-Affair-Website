'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const paths = require('./config/paths');
const buildApiRouter = require('./routes/api');
const security = require('./middleware/security');

const PORT = Number(process.env.PORT || 5000);
const BASE_PATH = (process.env.BASE_PATH || '/student-affairs').replace(/\/+$/, '');

const app = express();
app.disable('x-powered-by');
// Security headers go on before anything that can produce a response, so the
// static mounts, the API and the HTML renderer are all covered. `csp` must run
// before the HTML routes: it stashes the per-request nonce on req, which
// renderHtml() substitutes into __CSP_NONCE__.
app.use(security.baseline);
app.use(security.csp);
app.use(express.json({ limit: '2mb' }));

// ============================================================================
// Client configuration + API
// ============================================================================

// Injects the live base path so the frontend never hardcodes a host or path
// (README: "injected from /config.js").
app.get(BASE_PATH + '/config.js', (req, res) => {
  res.type('application/javascript').send(
    `window.SA_BASE_PATH = ${JSON.stringify(BASE_PATH)};\n` +
    `window.SA_API = window.SA_BASE_PATH + '/api';\n`
  );
});

// The API router defines unprefixed routes (/health, /posts, /admin/…) so it
// mounts at BASE_PATH + '/api' — mounted any lower it would shadow the HTML
// pages and put the admin behind the auth middleware.
app.use(BASE_PATH + '/api', buildApiRouter());

// ============================================================================
// Static assets (no raw HTML — pages go through the token renderer below)
// ============================================================================
app.use(BASE_PATH + '/uploads', express.static(paths.uploads));
app.use(BASE_PATH + '/css', express.static(path.join(paths.public, 'css')));
app.use(BASE_PATH + '/js', express.static(path.join(paths.public, 'js')));
app.use(BASE_PATH + '/admin/css', express.static(path.join(paths.admin, 'css')));
app.use(BASE_PATH + '/admin/js', express.static(path.join(paths.admin, 'js')));

// ============================================================================
// Pages
// ============================================================================
const htmlCache = new Map();

const readHtml = (file) => {
  if (!htmlCache.has(file)) {
    htmlCache.set(file, fs.readFileSync(file, 'utf8'));
  }
  return htmlCache.get(file);
};

// Every HTML file may use __BASE_PATH__ tokens for asset URLs and
// __CSP_NONCE__ on inline <script> tags; both are replaced at serve time, so
// changing BASE_PATH or tightening the CSP needs no code changes. The nonce is
// per-request, so the cached copy stays a template.
const renderHtml = (req, file) => readHtml(file)
  .replace(/__BASE_PATH__/g, BASE_PATH)
  .replace(/__CSP_NONCE__/g, req.cspNonce || '');

/** Route map: public path → HTML file (public/ or admin/ relative to root). */
const htmlRoutes = {
  '/': 'public/index.html',
  '/news': 'public/news.html',
  '/news/:slug': 'public/news-detail.html',
  '/events': 'public/events.html',
  '/events/:slug': 'public/event-details.html',
  '/notices': 'public/notices.html',
  '/societies': 'public/societies.html',
  '/societies/:slug': 'public/society-details.html',
  '/office': 'public/office.html',
  '/partners': 'public/partners.html',
  '/partners/:slug': 'public/partner-details.html',
  '/documents': 'public/documents.html',
  '/contact': 'public/contact.html',
  '/admin': 'admin/index.html',
  '/admin/login': 'admin/login.html'
};

for (const [route, file] of Object.entries(htmlRoutes)) {
  app.get(BASE_PATH + route, (req, res) => {
    res.type('html').send(renderHtml(req, path.join(__dirname, '..', file)));
  });
}

// Bare mount path: Express is not strict about trailing slashes, so the route
// above ('/') already answers `/student-affairs` as well as `/student-affairs/`.

// ============================================================================
// 404 + error handling
// ============================================================================
app.use((req, res) => {
  if (req.originalUrl.startsWith(BASE_PATH + '/api')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.status(404).type('html').send(renderHtml(req, path.join(paths.public, '404.html')));
});

// API errors become JSON instead of Express' HTML error pages.
//
// The client only ever sees a generic message. `err.message` is logged
// server-side instead of returned, because a raw driver error can quote the
// failing SQL, table and column names - free reconnaissance for anyone probing
// the API, and no help to a CMS user. An error that was raised deliberately as
// a validation message (res.status(...).json({error}) elsewhere in the app)
// still reaches the client directly and is unaffected.
app.use((err, req, res, next) => {
  const isApi = err && req.originalUrl && req.originalUrl.startsWith(BASE_PATH + '/api');
  if (!err) return next();
  const status = err.status || 500;
  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${status}`,
      err && err.stack ? err.stack : err);
  }
  if (isApi) {
    const message = status < 500 ? (err.message || 'Request failed.') : 'Server error.';
    return res.status(status).json({ error: message });
  }
  res.status(500).send('Server error.');
});

app.listen(PORT, () => {
  console.log(`Student Affairs CMS running at http://localhost:${PORT}${BASE_PATH}`);
});