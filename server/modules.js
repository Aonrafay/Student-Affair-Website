'use strict';

// ============================================================================
// CMS module registry.
//
// Every entry creates these API routes automatically (see routes/api.js):
//   GET    /api/<id>                  → published rows
//   GET    /api/<id>/:slug            → single published row
//   GET    /api/admin/<id>            → all rows (auth, optional ?q=search)
//   GET    /api/admin/<id>/:id        → single row
//   POST   /api/admin/<id>            → create
//   PUT    /api/admin/<id>/:id        → update
//   DELETE /api/admin/<id>/:id        → delete
//   POST   /api/admin/<id>/:id/publish → set status (publish/unpublish)
//
// Each entry:
//   id          module key (route segment, must match the admin UI key)
//   table       MySQL table name (defaults to id)
//   roles       roles allowed to manage the module in the admin
//   fields      editable columns. `slug` is auto-generated from titleField
//               when empty and de-duplicated automatically.
//   jsonFields  columns storing JSON (written as strings, read back parsed)
//   search      columns searched by the admin's ?q= parameter
//   orderBy     default ORDER BY for lists
//   titleField  human label column (used for slugs + admin lists)
//
// Adding "Internships"? Add a table to schema.sql + one entry here + one entry
// in admin/js/modules.js + a page in public/. See README.
// ============================================================================

const modules = {
  posts: {
    id: 'posts',
    table: 'posts',
    roles: ['admin', 'editor'],
    fields: ['slug', 'title', 'category', 'excerpt', 'body', 'cover', 'published_at'],
    jsonFields: [],
    search: ['title', 'excerpt'],
    orderBy: 'published_at DESC, id DESC',
    titleField: 'title'
  },

  events: {
    id: 'events',
    table: 'events',
    roles: ['admin', 'editor'],
    fields: ['slug', 'title', 'description', 'start_time', 'end_time', 'location',
      'cover', 'gallery', 'highlights', 'results', 'registration_url', 'published_at'],
    jsonFields: ['gallery', 'highlights', 'results'],
    search: ['title', 'location'],
    orderBy: 'start_time DESC, id DESC',
    titleField: 'title'
  },

  notices: {
    id: 'notices',
    table: 'notices',
    roles: ['admin', 'editor'],
    fields: ['slug', 'title', 'body', 'pdf', 'published_at'],
    jsonFields: [],
    search: ['title', 'body'],
    orderBy: 'published_at DESC, id DESC',
    titleField: 'title'
  },

  societies: {
    id: 'societies',
    table: 'societies',
    roles: ['admin', 'editor'],
    fields: ['slug', 'name', 'tagline', 'motto', 'purpose', 'cover',
      'officers', 'team', 'features', 'published_at'],
    jsonFields: ['officers', 'team', 'features'],
    search: ['name', 'motto'],
    orderBy: 'name ASC',
    titleField: 'name'
  },

  team: {
    id: 'team',
    table: 'team_members',
    roles: ['admin', 'editor'],
    fields: ['slug', 'name', 'role', 'bio', 'photo', 'email', 'sort_order',
      'featured', 'published_at'],
    jsonFields: [],
    search: ['name', 'role'],
    orderBy: 'sort_order ASC, id ASC',
    titleField: 'name'
  },

  partners: {
    id: 'partners',
    table: 'partners',
    roles: ['admin', 'editor'],
    fields: ['slug', 'name', 'category', 'logo', 'website', 'published_at'],
    jsonFields: [],
    search: ['name', 'category'],
    orderBy: 'category ASC, name ASC',
    titleField: 'name'
  },

  documents: {
    id: 'documents',
    table: 'documents',
    roles: ['admin', 'editor'],
    fields: ['slug', 'title', 'category', 'description', 'file', 'published_at'],
    jsonFields: [],
    search: ['title', 'category'],
    orderBy: 'category ASC, title ASC',
    titleField: 'title'
  }
};

module.exports = modules;

// `list` exposes the definitions as an array, but it MUST stay non-enumerable:
// the router and the dashboard counters iterate `Object.values(modules)`, and an
// enumerable `list` makes them loop over the array itself as if it were a
// module (producing `SELECT COUNT(*) FROM \`undefined\``).
Object.defineProperty(module.exports, 'list', {
  value: Object.values(modules),
  enumerable: false
});