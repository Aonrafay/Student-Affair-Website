# Student Affairs CMS — Rebuild Plan (Next.js)

Status: **Approved by user ("go"). Pending exit from plan/read-only mode.**

## Goal
A user-friendly CMS where non-technical staff create **events**, post about **societies**,
publish **news/notices**, upload **media**, and manage the office — all from a
login-protected admin area, no HTML editing. Mounts at a **subpath** on the existing
university site (no Docker) as a single Node process behind the current web server's
reverse proxy.

## Stack (decided with user)
- **Next.js 14 (App Router) + React 18 + TypeScript**, self-hosted (`next start`),
  fronted by nginx/Apache subpath proxy. `basePath` from `BASE_PATH` env.
- **Prisma ORM**, one model set:
  - **Dev = SQLite** (`file:./dev.db`, zero setup, no server needed).
  - **Prod = MySQL** (IT provides instance). Two schema files:
    - `prisma/schema.sqlite.prisma` (default, dev)
    - `prisma/schema.mysql.prisma` (prod build/deploy)
  - Commands: `npm run setup:dev` (generate+push+seed SQLite),
    `npm run db:push:prod` (push MySQL), `npm run seed`.
- **Auth**: JWT in httpOnly cookie (bcryptjs password hashing), `admin`/`editor` roles.
  `middleware.ts` redirects unauthenticated `/admin/*` to login. Server Actions do
  role-checked mutations (no separate API layer needed).
- **Uploads**: saved to disk under `uploads/` (git-ignored), served via
  `app/uploads/[...slug]/route.ts` under the subpath. Media URLs = `${BASE_PATH}/uploads/...`.
- **Styling**: Tailwind CSS v3 (clean, consistent, fast to build friendly UI).
- **Long text**: stored as Markdown, rendered with `marked` on public pages.

## "Easy to use" design choices
- **Module-driven admin**: `src/lib/modules.ts` config (fields per content type)
  auto-generates list + form + publish/draft + delete. Adding a future type = new
  table + one config entry.
- **Friendly structured fields** (the key UX win): `officers`, `team`, `gallery`,
  `highlights`, `results`, `features`, `achievements`, `programs` become **repeatable
  row sections / add-remove string lists** in the admin, stored as JSON — no raw JSON.
  Field types: text, textarea, richtext(markdown), number, email, url, tel, date,
  datetime-local, select, checkbox, slug(auto), media(image), media-pdf,
  `list` (array of object rows), `stringlist` (array of strings).
- **Media picker**: upload + choose-from-library for image/pdf fields.
- **Dashboard**: counts + recent drafts + upcoming events; inline validation
  (no `alert()`); loading/empty/error states everywhere.

## Content model (Prisma, SQLite-safe — no enums, use String + validation)
`User`, `Media`, `Post` (news/announcement/achievement), `Event`
(start/end, location, gallery, highlights, results, registrationUrl), `Notice` (pdf),
`Page` (home/about/contact copy + extra JSON), `Society` (officers/team/features),
`TeamMember`, `Ambassador` (achievements, featured), `Partner` (programs, featured),
`Document`, `Setting`. Every content row has `slug @unique`, `status`
('draft'|'published'), `publishedAt`, `createdAt`, `updatedAt`. Public reads filter
`status='published'`.

## File layout
```
package.json  tsconfig.json  next.config.mjs  postcss.config.js
tailwind.config.ts  .env.example  .gitignore(+uploads,.next,dev.db)
prisma/schema.sqlite.prisma  prisma/schema.mysql.prisma  prisma/seed.ts
src/
  middleware.ts                      # guard /admin
  lib/{db,auth,modules,slug,json,markdown}.ts
  actions.ts                        # 'use server' CRUD + auth + media + settings
  app/
    layout.tsx  globals.css  page.tsx (home)
    events/  events/[slug]/  societies/  societies/[slug]/
    news/  news/[slug]/  notices/  office/  ambassadors/  partners/  documents/  contact/
    uploads/[...slug]/route.ts
    admin/login/  admin/layout (guard + shell)  admin/page (dashboard)
    admin/[module]/page.tsx         # generic list+form from modules.ts
    admin/media/  admin/settings/  admin/users/
  components/
    public/{SiteHeader,SiteFooter,Cards,Prose}.tsx
    admin/{AdminNav, CrudTable, CrudForm, Field, RepeatableField,
           StringListField, MediaPicker, RichText}.tsx
    auth/LoginForm.tsx
```

## Execution phases
1. Scaffold: configs above; clean old Express app (done); `.gitignore` updates.
2. Prisma: two schemas + `npm run setup:dev` (generate, push SQLite, seed).
3. Auth: `lib/auth.ts` (JWT cookie, getSession), `middleware.ts`, login page + `loginAction`/`logoutAction`.
4. Admin core: shell + nav (role-filtered) + dashboard; generic list/form;
   friendly `list`/`stringlist` fields; media picker; `actions.ts` with role checks.
5. Public site: server-component pages (home: latest news + upcoming events;
   events/societies/news/notices + detail pages; office/ambassadors/partners/documents/contact).
6. Integration + docs: nginx/Apache subpath snippet (no Docker), prod MySQL env, README rewrite.
7. Verify (dev SQLite): boot → login (admin/editor) → create+draft+publish event →
   create society w/ officers+team → upload image → public pages render → unpublish hides.

## Out of scope (now)
Student login, paid tickets, email blasts, analytics. Add later as modules.

## Decisions / risks
- Prisma `provider` can't be an env var → two schema files (documented).
- SQLite has no enum/JSON type → status/category/role are `String`; JSON kept as `String`.
- basePath + middleware matcher: guard paths are matched without basePath prefix.
