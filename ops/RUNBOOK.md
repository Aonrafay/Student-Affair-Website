# Operations runbook — Student Affairs CMS test deployment

Live site: **http://10.116.233.254:5000/student-affairs/**
Admin: **http://10.116.233.254:5000/student-affairs/admin/login**

Reachable from the campus network / VPN only (`10.116.233.0/24`). There is no
public URL and no TLS — it is a test deployment for people on the same network.

---

## 1. Topology

| | |
|---|---|
| VM | `f24-bscs@10.116.233.254`, Ubuntu 24.04.5 LTS, 4 vCPU, 5.9 GB RAM, 81 GB free |
| Runtime | Docker 29.8.2 + Compose v5.6.0, containers `app-app-1` / `app-db-1` |
| App dir | `/opt/student-affairs/app` (git clone of this repo, branch `main`) |
| Backups | `/opt/student-affairs/backups/{db,uploads,env,weekly}` |
| Operator PC | `DESKTOP-5LO3UH5` / `10.116.233.252`, Windows 11, PowerShell 5.1 |
| Firewall | ufw active, deny incoming; open: `22/tcp` (SSH), `5000/tcp` (app) |

`3306` is **not** published — MySQL is reachable only inside the compose
network.

---

## 2. Getting in

The operator PC holds an ed25519 key at `~/.ssh/id_ed25519_vm`; the public key
is in the VM's `~/.ssh/authorized_keys`. `~/.ssh/config` defines the alias:

```
ssh vm-students          # no password prompt
scp file vm-students:/opt/student-affairs/
```

**The VM's `sudo` requires a password and its ticket is per-tty**, so it cannot
be cached between SSH sessions. For the few commands that need root, use the
helper rather than typing the password into a pipeline by hand:

```powershell
powershell -ExecutionPolicy Bypass -File ops\vm-sudo.ps1 -Script ops\prepare-dirs.sh -Pass '<sudo password>'
```

It uploads the script, runs it under `sudo -S`, and deletes it. The password is
passed per call and never written to a file.

---

## 3. Day-to-day operations

All of these run on the VM as `f24-bscs` (no sudo — `f24-bscs` is in the
`docker` group).

```bash
ssh vm-students

cd /opt/student-affairs/app

docker compose ps                 # status
docker compose logs -f app        # follow app logs
docker compose logs -f db         # follow MySQL logs

bash /opt/student-affairs/deploy.sh        # git pull + rebuild + migrate/seed + health wait
curl -s http://127.0.0.1:5000/student-affairs/api/health     # {"ok":true,"db":true}

docker compose restart app        # restart just the app (content is untouched)
docker compose down && docker compose up -d   # recreate containers; data lives in volumes
```

`deploy.sh` is idempotent. It **never regenerates `.env`** once it exists, so
secrets survive redeploys.

> `f24-bscs` being in the `docker` group is root-equivalent on this VM. That is
> an accepted trade-off on a single-tenant test host. To revoke:
> `sudo gpasswd -d f24-bscs docker`.

---

## 4. Backups

### What is captured, and why

| Artifact | Path | Why it matters |
|---|---|---|
| Database dump | `backups/db/daily/<stamp>.sql.gz` | All content: posts, events, notices, societies + years + people, team, partners, documents, page copy, settings, users |
| Binary logs | `backups/db/binlog/<stamp>.tgz` | Every closed MySQL binlog for 14 days. This is what makes **restore to any minute** possible — see §5 |
| Uploaded media | `backups/media/<stamp>.tgz` | Images and PDFs live on disk, **not** in MySQL — a dump alone leaves every picture broken |
| Secrets | `backups/env/current.env` | Admin/editor passwords and `JWT_SECRET`. Without it a restore locks everyone out of the admin. One snapshot of *current* config, not one per run |
| Manifest | `backups/db/manifests/<stamp>.meta` | Binlog position, table count, deployed commit, and sha256 of each artifact |

The site is **not** backed up as a filesystem copy of the VM. It is
reproducible from this repo plus those artifacts.

### Retention is small on purpose

| | Count | Why so few |
|---|---|---|
| `db/daily/` | 3 | Dumps are ~8 KB. Keeping more is pointless. |
| `db/weekly/` | 1 | One weekly point of reference |
| `media/` | 1 | Images/PDFs are already compressed; a copy costs what the media costs |
| `db/binlog/` | 14 **days** | Replaces the need for many full dumps |
| `env/` | 1 | It's a snapshot of now, not history |

**Compression is not the lever here.** The database dumps to a few KB and
`jpg`/`png`/`pdf` are already compressed, so `tar.gz` on media saves ~0%. The
only thing that consumes disk is keeping copies — which is why retention is
counted in *days* (via binlogs) rather than *copies*.

### Schedule (VM cron, times are Asia/Karachi)

```
15 2 * * *   /opt/student-affairs/backup.sh daily     # dump + binlogs + .env
30 3 * * 0   /opt/student-affairs/backup.sh weekly    # the above + 1 media archive
```

`backup.sh` refuses to run at all below `MIN_FREE_GB` (default 10) — filling
the volume takes MySQL down with it. It writes to `backups/backup.log`, and
never records a backup that is empty, gzip-corrupt, or has zero tables: a
silently broken dump is worse than none, because it looks like a success. It
never deletes the newest backup of anything, even under budget pressure.

### Run one by hand

```bash
bash /opt/student-affairs/backup.sh daily
bash /opt/student-affairs/backup.sh weekly
tail -20 /opt/student-affairs/backups/backup.log
```

### Off-site copy on the operator PC

Windows Scheduled Task **"StudentAffairs - Pull Backups from VM"** runs
`ops\pull-backups.ps1`:

- pulls the 3 newest dumps plus the weekly keepers over `scp`
- **verifies every pulled file's sha256 against the VM manifest** and fails the
  run on any mismatch
- prunes to a 7-day / 4-week local window

Local layout: `StudentAffair\backups\<date>\<stamp>\` containing `db.sql.gz`,
`uploads.tgz`, `manifest.txt`, `app.env`. History: `StudentAffair\backup-pull.log`.

Triggers are **daily 09:00 and at log on**, because the PC is often off at 09:00
and the script always pulls the newest dumps, so a missed run catches up. It
runs under the interactive account rather than storing a Windows password, so
it only runs while someone is logged in — VM-side cron is unaffected either way.

Manual run / task status:

```powershell
powershell -ExecutionPolicy Bypass -File ops\pull-backups.ps1
Get-ScheduledTask -TaskName 'StudentAffairs - Pull Backups from VM' | Get-ScheduledTaskInfo
Start-ScheduledTask -TaskName 'StudentAffairs - Pull Backups from VM'   # force one
```

### Verify the backups

```bash
bash /opt/student-affairs/restore-drill.sh          # non-destructive
```

Imports the newest dump into a throwaway schema, compares every table against
live, cross-checks that every `media` row in the restored copy has its file
inside the uploads archive, checks the secrets backup exists at mode 600, then
drops the scratch schema. **The live database is never touched.** Run it after
any change to the backup scripts.

---

## 5. Restoring

### Recover content (the common case)

```bash
ssh vm-students
bash /opt/student-affairs/restore.sh                  # newest backup, asks to confirm
bash /opt/student-affairs/restore.sh 20261005-103540  # a specific backup
bash /opt/student-affairs/restore.sh --db-only        # database, keep current media
```

Downtime is ~30 s while the app is stopped for the table swap. It drops and
recreates the *tables*, not the schema, so the `sa` grants survive; the app is
restarted afterwards and re-runs migrations. The script verifies the dump's gzip
integrity first and refuses to run if the restored schema ends up empty. If it
reports that `.env` has changed since the backup, the admin password was rotated
after that point and needs restoring too:

```bash
install -m 600 /opt/student-affairs/backups/env/current.env /opt/student-affairs/app/.env
docker compose up -d
```

### Restore to a specific moment (point-in-time)

For "someone deleted the notice an hour ago" — full-dump restores only get you
back to 02:15. Binary logs get you the exact minute.

```bash
bash /opt/student-affairs/restore-to-time.sh --list          # what is recoverable
bash /opt/student-affairs/restore-to-time.sh '2026-10-05 14:30'           # scratch schema, safe
bash /opt/student-affairs/restore-to-time.sh '2026-10-05 14:30' --apply   # restore live
```

Times are **UTC**. Without `--apply` it imports into a throwaway schema and
drops it, so you can look before you commit. `--from <stamp>` pins the base dump
instead of letting the timestamp choose — that is what makes the replay do real
work. Requires `mysqlbinlog` on the host (`ops/install-mysqlbinlog.sh`).

Proof it works: `bash /opt/student-affairs/pitr-test.sh` creates a post, deletes
it, then recovers to a moment when it existed (must reappear) and to a moment
before it existed (must not). Live data is never modified.

### Rebuild the whole VM from scratch

1. Install Ubuntu 24.04, create user `f24-bscs`, add it to `sudo`.
2. Copy the public key from `~/.ssh/id_ed25519_vm.pub` into `~/.ssh/authorized_keys`.
3. `sudo bash ops/base-setup.sh` (Docker, packages, ufw with SSH + 5000 open).
4. `sudo bash ops/install-mysqlbinlog.sh` (needed for point-in-time restore).
5. `bash ops/prepare-dirs.sh` under `sudo` → creates `/opt/student-affairs`.
6. `scp ops/*.sh f24-bscs@10.116.233.254:/opt/student-affairs/` then
   `bash /opt/student-affairs/deploy.sh`.
7. **The site is back but empty.** Content comes from GitHub plus the backups on
   the operator PC (`StudentAffair\backups\`): copy `db/daily/*.sql.gz`,
   `db/binlog/*.tgz` and `env/current.env` back into `/opt/student-affairs/backups/`.
8. `bash /opt/student-affairs/restore.sh --yes`
9. `bash /opt/student-affairs/install-cron.sh` and re-register the Windows task.

---

## 6. Tests

```powershell
# end-to-end over HTTP: login, draft, publish, unpublish, media upload, cleanup
powershell -ExecutionPolicy Bypass -File ops\smoke-test.ps1

# ~60 assertions over real HTTP: headers, CSP nonce, SVG refusal, login lockout,
# token revocation, SQLi, audit log, backup download, traversal probes
powershell -ExecutionPolicy Bypass -File ops\security-test.ps1
```

On the VM:

```bash
bash /opt/student-affairs/restore-drill.sh              # backup restores, live untouched
bash /opt/student-affairs/pitr-test.sh                  # point-in-time recovery, both directions
bash /opt/student-affairs/test-volume-persistence.sh     # data survives compose down/up
docker compose exec -T app node server/tests/uploadsQuota.test.js
```

All of these were run against this deployment and pass. `smoke-test.ps1
-KeepData` leaves its test post and media in place, which is what you want if the
next step is to prove the backup captured them.

> A **restore drill is not the same as a restore.** `restore-drill.sh` and
> `pitr-test.sh` never touch live data; `restore.sh` and `restore-to-time.sh
> --apply` do. Keep that distinction when you run them under pressure.

---

## 7. Credentials

Generated at deploy time and stored **only** in `/opt/student-affairs/app/.env`
(mode 600) plus the single `backups/env/current.env` snapshot.

`current.env` is **not downloadable from the admin panel** on purpose — the
`Backup & download` page lists it and refuses to serve it, because it holds
`JWT_SECRET` and every password. Read it over SSH instead.

- On the VM: `/opt/student-affairs/app/.env`
- On the operator PC: `StudentAffair\secrets\vm-credentials.txt` (ACL: Aon-PC only)

The dev defaults (`admin@niit.edu.pk` / `admin123`) are public in this repo's
history and are **not** what the VM uses — verified: the API returns 401 for
`admin123`. If you ever lose the admin password:

```bash
# generate a new one, then reset it in the database
NEW=$(openssl rand -hex 12); echo "$NEW"
docker compose exec -T -e MYSQL_PWD="$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2-)" \
  db mysql -uroot student_affairs \
  -e "UPDATE users SET password_hash='<bcrypt hash of $NEW>' WHERE email='admin@niit.edu.pk'"
```

Getting the bcrypt hash requires node in the app container:
`docker compose exec app node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" '<new password>'`

Seeding only happens on an empty database, so changing `ADMIN_PASSWORD` in `.env`
alone does **not** change an existing account.

---

## 8. Giving access to testers

- **Site** — `http://10.116.233.254:5000/student-affairs/`
- **Admin** — `http://10.116.233.254:5000/student-affairs/admin/login`

The CMS has no self-registration; accounts are created by an admin under
**Users**. Create one `editor` login per tester rather than sharing one, so a
person can be revoked individually. An editor can manage posts, events, notices
and media but not users, pages or settings.

### Admin sections

| Section | Who | What it does |
|---|---|---|
| Content modules | admin + editor | Posts, events, notices, societies, team, partners, documents |
| Media library | admin + editor | Upload and delete images/PDFs. Shows disk usage against the 20 GB cap |
| Site copy / Settings / Users | admin only | Page text, office details, staff accounts |
| Activity | admin only | Who changed what, and when — the audit log |
| Backup & download | admin only | Download any existing backup. Cannot create one, cannot delete one |

Sessions last **8 hours** and "Sign out everywhere" in the sidebar invalidates
every token for that account at once. Use it if you think someone copied your
session.

There is **no HTTPS**, and the admin password travels in clear text over the
campus network. Acceptable for short-lived testing on a trusted network; do not
put real or personal content in it, and do not reuse these passwords elsewhere.

---

## 9. Known gaps

- **No TLS.** Clear-text HTTP on port 5000.
- **No full-VM reboot test.** `docker.service` is enabled and both containers are
  `restart: unless-stopped`, and a full `compose down`/`up` was tested, but the
  VM itself has not been rebooted.
- **Local pull needs the PC logged on** (see §4).
- **Backups are not off-site in the cloud** — they live on the VM and on the
  operator PC. If both are lost simultaneously, only GitHub remains.
- **uploads has a 20 GB quota** (`UPLOADS_MAX_BYTES`), and `backup.sh` refuses to
  run below 10 GB free, so a runaway upload cannot silently fill the disk. But
  **nothing pages you** when the disk gets low — check `df -h /` and the last
  lines of `backups/backup.log` occasionally.
- **At ~40 GB of media, the on-VM media archive has to be turned off**
  (`MEDIA_BACKUP=never`), because 40 GB of media plus even one archive exceeds
  the 78 GB free. At that point the originals on your PC are the only copy and
  they must live on something with room.
- **Restore is a single-VM operation.** There is no standby and the backup files
  are only as safe as the disk they sit on.
- **Point-in-time restore covers 14 days** of binary logs, not forever. After
  that you are back to whatever full dumps survive.
- **The login rate limiter is in process memory**, so it resets if the app
  container restarts, and it would not be shared across replicas. Fine for one
  node; not a distributed limiter.
- **Sessions are 8 hours and revocable**, but a token stolen before a revocation
  stays valid until it expires. There is no IP or device list to inspect.
- **`audit_log` is kept 180 days** and never pruned automatically — the prune
  endpoint (`POST /api/admin/activity/prune`) exists but nothing calls it yet.
