# Student Affairs CMS

A content management system for a university **Office of Student Affairs**, designed to be mounted at a
subpath on the main university site (default: `/student-affairs`) behind a reverse proxy. Built with
**Express + MySQL + vanilla HTML/CSS/JS** — no build step, one Node process.

Staff can run the office (news, events, notices, societies, team, partners, documents,
media, and site copy) from a login-protected admin area **without touching HTML**. Adding a new content
type later is a documented module, not a rewrite.

---

## Quick start

### Option A — Docker (recommended for deployment)

```bash
docker compose up --build
```

This starts MySQL 8 and the Node app, runs migrations, and seeds a working office on first boot.
Open:

- **Site:** http://localhost:5000/student-affairs/
- **Admin:** http://localhost:5000/student-affairs/admin/login

First login (from `docker-compose.yml`, change these):

- Admin — `admin@niit.edu.pk` / `admin123`
- Editor — `editor@niit.edu.pk` / `editor123`

### Option B — Local Node (if you already have MySQL)

```bash
cp .env.example .env          # edit DB_* to match your MySQL
npm install
npm run migrate
npm run seed
npm run dev                    # nodemon, or: npm start
```

Then open the same URLs as above.

> The app reads `BASE_PATH` from `.env` (or `docker-compose.yml`). Local and deploy both default to
> `/student-affairs` so there is no difference between your laptop and production.

### Health check

```bash
curl http://localhost:5000/student-affairs/api/health
# → {"ok":true,"db":true}
```

---

## How it mounts on the university site

The Express app is mounted with `app.use(BASE_PATH, router)`, so **every** route — public pages, the
admin area, the API, and uploads — lives under `/student-affairs`. All links and asset URLs in the
frontend are relative to `BASE_PATH` (injected from `/config.js`); the client never hardcodes a host.

IT only needs to proxy the path to Node and provide MySQL credentials:

**nginx**

```nginx
location /student-affairs/ {
    proxy_pass http://127.0.0.1:5000/student-affairs/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Apache** (`mod_proxy` enabled)

```apache
<Location /student-affairs/>
    ProxyPass http://127.0.0.1:5000/student-affairs/
    ProxyPassReverse http://127.0.0.1:5000/student-affairs/
</Location>
```

If you ever need a different path, set `BASE_PATH` and re-deploy — no code changes.

---

## Environment variables

| Variable         | Purpose                                  | Example            |
|------------------|------------------------------------------|--------------------|
| `PORT`           | App port                                 | `5000`             |
| `BASE_PATH`      | Mount path (no trailing slash)           | `/student-affairs` |
| `JWT_SECRET`     | Signing secret for admin tokens          | random string      |
| `DB_HOST`        | MySQL host                               | `localhost` / `db` |
| `DB_USER`        | MySQL user                               | `sa`               |
| `DB_PASSWORD`    | MySQL password                           | `sa`               |
| `DB_NAME`        | MySQL database                           | `student_affairs`  |
| `ADMIN_EMAIL`    | Seed admin email                         | `admin@…`          |
| `ADMIN_PASSWORD` | Seed admin password                      | `…`                |
| `EDITOR_EMAIL`   | Seed editor email                        | `editor@…`         |
| `EDITOR_PASSWORD`| Seed editor password                     | `…`                |

`.env` is git-ignored. `server/.env.example` documents the same set. **Never commit real secrets.**

---

## Roles

- **Admin** — everything: all modules, users, pages, settings.
- **Editor** — posts, events, notices, and media only.

The admin sidebar is driven by a module list, so unavailable modules are simply not shown to an editor.

---

## Content model

Every public item has `status` (`draft` | `published`), a `slug`, and `created_at` / `updated_at` /
optional `published_at`. **Public APIs only return published rows.**

| Table           | Public API            | Admin API              | Notes |
|-----------------|-----------------------|------------------------|-------|
| `posts`         | `/api/posts`          | `/api/admin/posts`     | news / announcements / achievements |
| `events`        | `/api/events` (+ `/upcoming`, `/next`, `/past`) | `/api/admin/events` | start/end, location, gallery, highlights, results, registration URL |
| `notices`       | `/api/notices`        | `/api/admin/notices`   | short circulars, optional PDF |
| `societies`     | `/api/societies`      | `/api/admin/societies` | motive, officers (JSON), team (JSON), features |
| `team_members`  | `/api/team`           | `/api/admin/team`      | office staff + roles |
| `partners`      | `/api/partners`       | `/api/admin/partners`  | category, logo, website |
| `documents`     | `/api/documents`      | `/api/admin/documents` | downloadable forms/policies |
| `pages`         | `/api/pages/:key`     | `/api/admin/pages/:key`| CMS copy: `home`, `about-head`, `contact` |
| `media`         | —                     | `/api/admin/media`     | multer upload (images + PDF) |
| `users`         | —                     | `/api/admin/users`     | admin / editor |
| `settings`      | `/api/settings` (public subset) | `/api/admin/settings` | office hours, email, phone, featured IDs |

Auth routes: `POST /api/auth/login`, `GET /api/auth/me`.

---

## Adding a future module (e.g. "Internships")

No routing changes needed — the generic CRUD factory handles list / get / create / update / delete /
publish for any table.

1. **Schema** — add a `CREATE TABLE` to `server/schema.sql` with at least:
   `id`, `slug` (unique), `status` (enum draft/published), `created_at`, `updated_at`, and your fields.
2. **Server registry** — add an entry to `server/modules.js`:
   ```js
   { id: 'internships', table: 'internships', roles: ['admin','editor'],
     jsonFields: [], search: ['title','company'], orderBy: 'posted_at DESC', titleField: 'title' }
   ```
   That single entry creates `/api/internships` and `/api/admin/internships` automatically.
3. **Admin UI** — add a matching entry to `admin/js/modules.js` with the `fields` config (text, textarea,
   json, select, media, checkbox, date, datetime-local, slug…). The list, form, publish toggle, edit,
   and delete all appear with no extra code.
4. **Public page** — add an HTML file under `public/` and a loader in `public/js/pages.js`
   (copy an existing one). Add the route in `server/index.js` `htmlRoutes`.

Done. The next intern does not touch the router guts.

---

## Browser walkthrough (acceptance)

1. Open `/student-affairs/admin/login`, sign in as admin.
2. **Create an event** → fill title/date/location/description → **Save** (draft).
3. **Create a post** → write body, set category → **Save** (draft).
4. Open each, click **publish**.
5. On the public home (`/student-affairs/`) the event shows under "Upcoming events" and the post under
   "Latest news"; the detail pages resolve at `/student-affairs/events/:slug` and `/student-affairs/news/:slug`.
6. Back in admin, **unpublish** the post → it disappears from `/student-affairs/news/`.
7. In **Media library**, upload an image, then "Choose from media" inside an event's cover field.
8. **Sign out** → admin routes redirect to login.

All admin screens have loading, empty, and error states (no silent failures, no `alert()` for
validation — inline messages instead).

---

## Project structure

```
.
├── docker-compose.yml          # MySQL + app, auto-migrate + seed
├── Dockerfile                  # node:20-alpine, production deps
├── .env.example                # copy to .env for local Node
├── server/
│   ├── index.js                # express app, BASE_PATH mount, HTML serving
│   ├── schema.sql              # all tables
│   ├── modules.js              # CMS module registry (add types here)
│   ├── config/{db,paths}.js
│   ├── middleware/{auth,authMiddleware}.js   # JWT protect + requireRole
│   ├── lib/{crud,helpers}.js   # generic CRUD factory, slug/JSON helpers
│   ├── controllers/            # auth, content (pages/settings/stats), media
│   ├── routes/api.js
│   └── scripts/{migrate,seed}.js
├── public/                     # data-driven public site
│   ├── index.html news.html events.html … contact.html 404.html
│   ├── css/site.css
│   └── js/{api,pages,site}.js
├── admin/                      # separate admin chrome (not public nav)
│   ├── login.html index.html
│   ├── css/admin.css
│   └── js/{auth,modules,admin,login}.js
└── uploads/                    # media files (git-ignored)
```

---

## Notes / out of scope

Intentionally **not** built: student login, paid tickets, email blasts, analytics dashboards. The data
model and module pattern leave room for these as future tables + admin modules.

Seeded content is believable Student Affairs office copy — not placeholder marketing language — and the
site is never empty on first boot.

---

## License

Internal university tooling.
