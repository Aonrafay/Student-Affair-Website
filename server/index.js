'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const paths = require('./config/paths');
const buildApiRouter = require('./routes/api');

const PORT = Number(process.env.PORT || 5000);
const BASE_PATH = (process.env.BASE_PATH || '/student-affairs').replace(/\/+$/, '');

const app = express();
app.disable('x-powered-by');
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

// Every HTML file may use __BASE_PATH__ tokens for asset URLs; they are
// replaced at serve time so changing BASE_PATH needs no code changes.
const renderHtml = (file) => readHtml(file).replace(/__BASE_PATH__/g, BASE_PATH);

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
  '/documents': 'public/documents.html',
  '/contact': 'public/contact.html',
  '/admin': 'admin/index.html',
  '/admin/login': 'admin/login.html'
};

for (const [route, file] of Object.entries(htmlRoutes)) {
  app.get(BASE_PATH + route, (req, res) => {
    res.type('html').send(renderHtml(path.join(__dirname, '..', file)));
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
  res.status(404).type('html').send(renderHtml(path.join(paths.public, '404.html')));
});

// API errors become JSON instead of Express' HTML error pages.
app.use((err, req, res, next) => {
  if (err && req.originalUrl && req.originalUrl.startsWith(BASE_PATH + '/api')) {
    return res.status(err.status || 500).json({ error: err.message || 'Server error.' });
  }
  res.status(500).send('Server error.');
});

app.listen(PORT, () => {
  console.log(`Student Affairs CMS running at http://localhost:${PORT}${BASE_PATH}`);
});