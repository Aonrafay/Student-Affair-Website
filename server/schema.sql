-- ============================================================================
-- Student Affairs CMS — MySQL schema
-- ============================================================================
-- Every content table follows the same module convention:
--   id, slug (unique), status (draft|published), created_at, updated_at,
--   optional published_at — plus the module's own fields.
-- New modules are created by adding a CREATE TABLE here and an entry in
-- server/modules.js (see README, "Adding a future module").
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(190)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  role          ENUM('admin','editor') NOT NULL DEFAULT 'editor',
  -- Bumped to invalidate every JWT already issued for this user. Compared on
  -- each request by middleware/authMiddleware.js, which is what makes a
  -- session revocable: without it, "sign out" only clears localStorage and a
  -- stolen token stays valid until it expires.
  token_version INT           NOT NULL DEFAULT 0,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing installations predate token_version. MySQL has no
-- "ADD COLUMN IF NOT EXISTS", but migrate.js treats ER_DUP_FIELDNAME (1060)
-- as success, so this is safe to re-run on every boot.
ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0;

-- Live website copy edited in the admin (keys: home, about-head, contact).
CREATE TABLE IF NOT EXISTS pages (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  `key`       VARCHAR(60)   NOT NULL UNIQUE,
  title       VARCHAR(200)  NOT NULL,
  content     MEDIUMTEXT    NULL,          -- JSON object, schema is client-side
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Key/value office settings (hours, contact details, featured IDs, …).
CREATE TABLE IF NOT EXISTS settings (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(60)  NOT NULL UNIQUE,
  value VARCHAR(1000) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uploaded files (images + PDFs). Bytes live in /uploads.
CREATE TABLE IF NOT EXISTS media (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  filename      VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime          VARCHAR(100) NOT NULL,
  size          INT          NOT NULL DEFAULT 0,
  caption       VARCHAR(200) NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS posts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(190) NOT NULL UNIQUE,
  title        VARCHAR(190) NOT NULL,
  category     ENUM('news','announcement','achievement') NOT NULL DEFAULT 'news',
  excerpt      TEXT         NULL,
  body         MEDIUMTEXT   NULL,
  cover        VARCHAR(255) NULL,
  status       ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP    NULL DEFAULT NULL,
  INDEX idx_posts_public (status, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  slug             VARCHAR(190) NOT NULL UNIQUE,
  title            VARCHAR(190) NOT NULL,
  description      MEDIUMTEXT   NULL,
  start_time       DATETIME     NULL,
  end_time         DATETIME     NULL,
  location         VARCHAR(255) NULL,
  cover            VARCHAR(255) NULL,
  gallery          TEXT         NULL,          -- JSON string[]
  highlights       TEXT         NULL,          -- JSON string[]
  results          TEXT         NULL,          -- JSON string[]
  registration_url VARCHAR(500) NULL,
  status           ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at     TIMESTAMP    NULL DEFAULT NULL,
  INDEX idx_events_public (status, start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notices (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(190) NOT NULL UNIQUE,
  title        VARCHAR(190) NOT NULL,
  body         MEDIUMTEXT   NULL,
  pdf          VARCHAR(255) NULL,
  status       ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP    NULL DEFAULT NULL,
  INDEX idx_notices_public (status, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS societies (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(190) NOT NULL UNIQUE,
  name         VARCHAR(190) NOT NULL,
  tagline      VARCHAR(255) NULL,
  motto        VARCHAR(255) NULL,
  purpose      TEXT         NULL,
  cover        VARCHAR(255) NULL,
  officers     TEXT         NULL,   -- JSON [{name, role, email}]
  team         TEXT         NULL,   -- JSON [{name, role}]
  features     TEXT         NULL,   -- JSON string[]
  status       ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP    NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One page per society per year (e.g. "2025-26"). The page body is Markdown
-- that can embed media-library images as ![alt](<uploaded filename>). People
-- attach to a specific year page — society cabinets change every year.
CREATE TABLE IF NOT EXISTS society_years (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  society_id   INT          NOT NULL,
  `year`       VARCHAR(20)  NOT NULL,
  title        VARCHAR(190) NULL,
  body         MEDIUMTEXT   NULL,          -- Markdown
  cover        VARCHAR(255) NULL,
  status       ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP    NULL DEFAULT NULL,
  INDEX idx_society_years (society_id, status, `year` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Officers + committee of one society year page.
CREATE TABLE IF NOT EXISTS society_members (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  society_year_id  INT          NOT NULL,
  name             VARCHAR(190) NOT NULL,
  role             VARCHAR(190) NULL,
  email            VARCHAR(190) NULL,
  bio              TEXT         NULL,          -- short intro shown on the society page
  photo            VARCHAR(255) NULL,
  category         ENUM('officer','committee') NOT NULL DEFAULT 'committee',
  sort_order       INT          NOT NULL DEFAULT 0,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_society_members (society_year_id, category, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Brings society_members created by an earlier version up to date. MySQL has no
-- "ADD COLUMN IF NOT EXISTS", so this is re-run on every boot and migrate.js
-- treats "duplicate column" (errno 1060) as already applied.
ALTER TABLE society_members ADD COLUMN bio TEXT NULL;

CREATE TABLE IF NOT EXISTS team_members (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(190) NOT NULL UNIQUE,
  name         VARCHAR(190) NOT NULL,
  role         VARCHAR(190) NULL,
  bio          TEXT         NULL,
  photo        VARCHAR(255) NULL,
  email        VARCHAR(190) NULL,
  sort_order   INT          NOT NULL DEFAULT 0,
  featured     TINYINT(1)   NOT NULL DEFAULT 0,
  status       ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP    NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partners (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(190) NOT NULL UNIQUE,
  name         VARCHAR(190) NOT NULL,
  category     VARCHAR(190) NULL,          -- collaboration type (admin select)
  description  MEDIUMTEXT   NULL,          -- Markdown story shown on the partner page
  cover        VARCHAR(255) NULL,          -- hero image for the partner page
  logo         VARCHAR(255) NULL,
  website      VARCHAR(500) NULL,
  sort_order   INT          NOT NULL DEFAULT 0,  -- lower = more important in its category
  status       ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP    NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Brings a `partners` table created by an earlier version up to date: the
-- Markdown story, the detail-page cover, and the importance order. Like the
-- society_members ALTER above this runs on every boot, and migrate.js treats
-- "duplicate column" (errno 1060) as already applied.
ALTER TABLE partners
  ADD COLUMN description MEDIUMTEXT NULL,
  ADD COLUMN cover VARCHAR(255) NULL,
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS documents (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(190) NOT NULL UNIQUE,
  title        VARCHAR(190) NOT NULL,
  category     VARCHAR(190) NULL,
  description  TEXT         NULL,
  file         VARCHAR(255) NULL,
  status       ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP    NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;