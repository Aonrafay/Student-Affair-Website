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
git clone https://github.com/Aonrafay/Student-Affair-Website.git
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
- **Backups** — never hardcode the password; read it from `.env`:
  ```bash
  DB_PASSWORD=$(grep -E '^DB_PASSWORD=' .env | cut -d= -f2-)
  docker compose exec -T db sh -c "exec mysqldump -usa -p'$DB_PASSWORD' \
      --single-transaction --routines --triggers student_affairs" | gzip -9 > backup.sql.gz
  docker compose exec -T app tar czf - -C /app uploads > uploads.tgz
  ```
  `--single-transaction` keeps the dump consistent without locking the site out.
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
| `societies`     | `/api/societies`      | `/api/admin/societies` | motto, purpose, features + **year pages** (see below) |
| `society_years` | (inside `/api/societies/:slug`) | `/api/admin/societies/:id/years…` | one Markdown page per year (e.g. `2025-26`) |
| `society_members` | (inside each year page) | `/api/admin/societies/:id/years/:yid/members…` | that year's officers + committee, with photo |
| `team_members`  | `/api/team`           | `/api/admin/team`      | office staff + roles |
| `partners`      | `/api/partners` (+ `/:slug`) | `/api/admin/partners` | collaboration type, Markdown story, cover + logo, website, importance order |
| `documents`     | `/api/documents`      | `/api/admin/documents` | downloadable forms/policies |
| `pages`         | `/api/pages/:key`     | `/api/admin/pages/:key`| CMS copy: `home`, `about-head`, `contact` |
| `media`         | —                     | `/api/admin/media`     | multer upload (images + PDF) |
| `users`         | —                     | `/api/admin/users`     | admin / editor |
| `settings`      | `/api/settings` (public subset) | `/api/admin/settings` | office hours, email, phone, featured IDs |

Auth routes: `POST /api/auth/login`, `GET /api/auth/me`.

---

## Writing in Markdown (news, events, notices, society year pages)

Every long-form field is a **Markdown editor** in the admin: a toolbar (**B**, *I*, Heading, list,
link, image), a **live preview**, and an **Image** button that opens the media library — upload a
file right there — and drops `![alt text](filename)` at the cursor.

| Where | Field |
|-------|-------|
| News / posts | `body` — the full article |
| Events | `description` (the separate **Gallery** photo strip stays as it is) |
| Notices | `body` |
| Society year pages | the year page's Markdown story |

Rendering uses the vendored `marked` v12 (`public/js/vendor/marked.min.js`, loaded by the pages that
need it, and `admin/js/vendor/marked.min.js` for the admin preview) — no CDN, so it works behind the
university proxy. On the public side every body is wrapped in `.md-body`, whose styles live in
`public/css/site.css`.

**Images never go into MySQL.** The file sits in `uploads/` (a Docker volume on the VM) and the
database only stores its metadata in the `media` table. Markdown references the **bare filename**, the
same convention as the `cover` / `photo` columns, and `SA.mdToHtml()` resolves it to
`BASE_PATH/uploads/…` at render time — so content survives a base-path change and a 20 GB VM holds
thousands of pictures without the database growing.

Old plain-text bodies are fine: Markdown renders them as normal paragraphs with their line breaks
intact, so existing posts need no migration.

> Markdown is authored by authenticated staff (admin/editor) only, and `marked` passes raw HTML
> through — the same trust level as the existing post bodies.

---

## Societies: year pages in Markdown (with images)

A society keeps its timeless info (tagline, motto, purpose, features). Everything that changes every
academic year lives on its **year pages** — one per year, e.g. `2025-26`. Each year page is:

* a **Markdown** body (stored as text in `society_years.body`) that may embed media-library images, and
* its **own people** in `society_members` (`category` = `officer` | `committee`, sort order, photo) —
  society cabinets change every year, so people belong to a year, not to the society.

### Admin flow (drill-down)

```
Societies  →  + New society          (name, motto, purpose, cover, features)
          →  auto-redirects to       Society — year pages
          →  + Add year page         (year, title, Markdown body, cover)
          →  auto-redirects to       Year page editor (Markdown + People of <year>)
          →  Publish the year page, then publish the society
```

Routes: `#/m/societies/<id>/years` (list), `#/m/societies/<id>/years/new`,
`#/m/societies/<id>/years/<yid>` (editor + people). The "Years" button on each societies row jumps
straight to the year pages.

### The Markdown editor

A toolbar (**B**, *I*, Heading, list, link, image) wraps the current selection, **Preview** toggles a
live rendered pane, and **Image** opens the media picker — you can upload a file right there — then
inserts `![alt text](filename)` at the cursor. Rendering uses the vendored
`marked` v12 (`public/js/vendor/marked.min.js`, `admin/js/vendor/marked.min.js`) — no CDN, so it works
behind the university proxy.

**Images are stored as the bare media filename** (`![Debate winners](1790591….png)`), the same
convention as the `cover` / `photo` columns. `SA.mdToHtml()` (public) and `mdRender()` (admin) resolve
those names to `BASE_PATH/uploads/…` at render time, so stored content survives a base-path change and
an image is never duplicated in the database — the file lives in `uploads/`, its metadata in the
`media` table.

### Public page

`/student-affairs/societies/:slug` shows the society header plus one **tab per published year**
(newest first). Each tab renders that year's Markdown, cover, and its own people.

**People are sized by designation** so the page reads top-down by post:

| Tier | Who | Layout |
|------|-----|--------|
| Hero | the **first officer in sort order** (your President) | large photo (132px), 22px name, role badge, 16px intro |
| Medium | the other officers | 88px photo, 15.5px name, intro |
| Compact | committee | 52px avatar row, no intro |

Each person has an **Intro** field in the admin ("Intro (shown under the role on the society page)")
— set it to one or two sentences and the page leads with the person, not just the post. Missing
photo falls back to initials; a society with no officers simply skips the hero tier.

The **Office** page (`/office`) uses the same idea: staff ticked "Featured on the office page" in the
admin get a large image-led card at the top (the Head, typically), and everyone else gets standard
cards with slightly larger photos. No extra field needed — `team_members.featured` already existed.

Draft year pages stay hidden until published. Deleting a year page removes its people; deleting a
society removes its year pages and their people (cascade in
`server/controllers/societyYearsController.js`).

---

## Partners — collaboration types, importance, detail pages

The partners page groups organisations by **collaboration type**, in this fixed order:

1. Strategic Partners → 2. Academic Collaborations → 3. Industry Partners → 4. Community Partners

The list lives in two mirrored places (same pattern as the rest of the registry):
`admin/js/modules.js` → `partnerCategories` (the admin **select**) and
`public/js/pages.js` → `PARTNER_CATEGORIES` (the display order). Any category outside the list —
e.g. a row created before the select existed — still renders, after the known groups, so nothing
disappears.

**Importance** is a per-partner *sort order* number (lower = more important, same convention as the
office team and society people). Within each group partners sit by that number, and the **first one
in each group becomes a spotlight card** — twice the width, a bigger logo, a "View partnership →"
hint — so the most important collaboration of every type reads first.

Clicking a tile opens the partner's **own page** at `/partners/:slug` (the external website moved
to a "Visit website ↗" button there). Each partner page shows the logo, a category badge, a cover
image, and a **Markdown story** written in the same editor as news and events — so a partner page can
have headings, lists and pictures.

Admin fields: name, collaboration type (select), **description (Markdown)**, cover, logo, website,
**sort order**, slug.

---

> Markdown is authored by authenticated staff (admin/editor) only, and `marked` passes raw HTML
> through — the same trust level as the existing post bodies.

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
   json, select, media, markdown, checkbox, date, datetime-local, slug…). The list, form, publish toggle,
   edit, and delete all appear with no extra code. A `markdown` field gives the full editor
   (toolbar + live preview + image insert) for free.
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
8. **Societies** → create a society → you land on its year pages → add a year page, type Markdown,
   press **Image** to insert an uploaded picture, add an officer and a committee member → publish the
   year page, then publish the society.
9. On `/student-affairs/societies/<slug>` the year appears as a tab: rendered Markdown with the image,
   plus that year's Officers and Committee.
10. **Sign out** → admin routes redirect to login.

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
│   ├── controllers/            # auth, content (pages/settings/stats), media,
│   │                           # societyYears (year pages + people)
│   ├── routes/api.js
│   └── scripts/{migrate,seed}.js
├── public/                     # data-driven public site
│   ├── index.html news.html events.html … contact.html 404.html
│   ├── css/site.css
│   ├── js/vendor/marked.min.js # Markdown renderer (vendored, no CDN)
│   └── js/{api,pages,site}.js
├── admin/                      # separate admin chrome (not public nav)
│   ├── login.html index.html
│   ├── css/admin.css
│   ├── js/vendor/marked.min.js # Markdown editor preview
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
