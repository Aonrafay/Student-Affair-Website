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
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  category     VARCHAR(190) NULL,
  logo         VARCHAR(255) NULL,
  website      VARCHAR(500) NULL,
  status       ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP    NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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