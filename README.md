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

First login (seed values — override them via `.env` / `docker-compose.yml`, and change them before
exposing the app to anyone):

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

## Deploying to a VM (testing)

The stack is two containers (Node app + MySQL 8) defined in `docker-compose.yml`, so any VM with
Docker can host it. **2 vCPU / 2 GB RAM / 20 GB disk** is plenty.

### Best OS

**Ubuntu Server 24.04 LTS** — free security updates until 2029, best-documented Docker install,
runs comfortably on the specs above. Alternatives: Debian 12 (lighter) or Rocky/Alma Linux 9 (if
RHEL-style is required). Skip desktop editions — SSH is all you need.

Give the VM a static IP (or DHCP reservation) so testers always reach the same address, e.g.
`http://192.168.1.50:5000`.

### Setup on the VM (Ubuntu)

```bash
# 1. Base packages + Docker Engine
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker   # run docker without sudo

# 2. Get the code
git clone https://github.com/maisum77/Student-Affair-Website.git
cd Student-Affair-Website

# 3. Secrets — this file is git-ignored, never commit it.
#    docker-compose.yml reads JWT_SECRET, DB_PASSWORD, ADMIN_PASSWORD and
#    EDITOR_PASSWORD from here (dev fallbacks apply if absent).
cp .env.example .env
openssl rand -hex 32          # copy the output…
nano .env                     # …into JWT_SECRET; change DB_PASSWORD,
                              # ADMIN_PASSWORD and EDITOR_PASSWORD too

# 4. Firewall: allow SSH + app port
sudo ufw allow OpenSSH && sudo ufw allow 5000/tcp && sudo ufw enable

# 5. Build & run (migrates + seeds automatically on first boot)
docker compose up -d --build
docker compose ps             # both services should be running/healthy
docker compose logs -f app    # watch first-boot migrate/seed

# 6. Verify
curl http://localhost:5000/student-affairs/api/health
# → {"ok":true,"db":true}
```

Then from any machine on the LAN:

- **Site:** `http://<VM_IP>:5000/student-affairs/`
- **Admin:** `http://<VM_IP>:5000/student-affairs/admin/login` (credentials from the VM's `.env`)

### Operating on the VM

- **Auto-start on boot** — `restart: unless-stopped` in `docker-compose.yml` brings the stack back
  after a VM reboot (Docker starts by default).
- **Update after code changes** — `git pull && docker compose up -d --build`. MySQL data and
  uploaded media live in the named volumes `db_data` / `uploads_data`, so rebuilds don't lose them.
- **Backups** —
  ```bash
  docker compose exec db sh -c 'exec mysqldump -usa -p"sa" student_affairs' > backup.sql
  docker run --rm -v student-affair-website_uploads_data:/data -v "$PWD":/bkp alpine \
      tar czf /bkp/uploads.tgz -C /data .
  ```
  (Use the real `DB_PASSWORD` from `.env` in the `mysqldump` command.)
- **Port 80 instead of 5000** (optional) — change the compose port mapping to `"80:5000"`, or put
  nginx on the VM using the proxy block below. When university IT mounts the app under the real
  domain nothing else changes — `BASE_PATH=/student-affairs` already matches.
- **Fresh testing start** (⚠️ deletes DB data) — `docker compose down -v`.

> **Security:** change every secret in `.env` on the VM before exposing the app — especially
> `ADMIN_PASSWORD`, since the dev defaults are public in git history.

---


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
