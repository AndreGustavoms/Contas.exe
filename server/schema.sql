-- PostgreSQL schema for Contas_exe
-- Run this once on a fresh database to create all tables, indexes and constraints.
-- For Railway/Heroku: paste this into the SQL console or run via psql.

-- Enable UUID extension (for generating v4 UUIDs server-side if needed)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm for full-text search (trigram matching)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable unaccent for accent-insensitive username lookups
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ==================== USERS ====================
-- The user roster: logins, password hashes (scrypt), roles, 2FA config.
-- Replaces storage/users.json.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(64) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  full_name VARCHAR(120),
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('superadmin', 'admin', 'member')),
  avatar_url TEXT,
  avatar_removed BOOLEAN DEFAULT FALSE,
  
  -- 2FA (TOTP): secret and recovery codes are encrypted at rest (handled by crypto.mjs)
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT, -- encrypted
  recovery_codes TEXT[], -- array of encrypted hashes
  
  -- OAuth provider links (Google/GitHub)
  google_id VARCHAR(255),
  google_email VARCHAR(255),
  google_picture TEXT,
  github_id VARCHAR(255),
  github_login VARCHAR(255),
  github_avatar TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);

-- ==================== GROUPS ====================
-- Credential groups (e.g. "Vitissouls", "Backup 2024"). Each group has an owner
-- (user_id), and only the owner + admins can see it (ownership-scoped).

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for ownership queries (members filter by owner_id = current_user)
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);

-- ==================== ACCOUNTS ====================
-- The credential records: platform, role, email, username, password (encrypted),
-- recovery email (encrypted), phone (encrypted), notes (encrypted), status, 2FA.
-- Replaces the accounts array inside groups.json.

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  
  -- Core fields
  platform VARCHAR(64) NOT NULL,
  role VARCHAR(64) NOT NULL,
  owner VARCHAR(64) NOT NULL,
  label VARCHAR(255),
  email VARCHAR(255),
  username VARCHAR(255),
  
  -- Encrypted fields (marked with _enc suffix so we remember to encrypt/decrypt)
  password_enc TEXT,
  recovery_email_enc TEXT,
  phone_enc TEXT,
  notes_enc TEXT,
  
  -- Metadata
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'review', 'archived', 'inactive')),
  two_factor BOOLEAN DEFAULT FALSE,
  post_day VARCHAR(64),
  niche VARCHAR(255),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for filtering and sorting
CREATE INDEX IF NOT EXISTS idx_accounts_group ON accounts(group_id);
CREATE INDEX IF NOT EXISTS idx_accounts_platform ON accounts(platform);
CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);

-- Full-text search index (trigram for partial matches on email/username/label/niche)
CREATE INDEX IF NOT EXISTS idx_accounts_search_trgm ON accounts USING gin (
  (COALESCE(email, '') || ' ' || COALESCE(username, '') || ' ' || COALESCE(label, '') || ' ' || COALESCE(niche, '')) gin_trgm_ops
);

-- ==================== SESSIONS ====================
-- Server-side sessions (replaces storage/sessions.json). The cookie carries
-- session_id (opaque token); all state lives here. Metadata (ip, user_agent,
-- location) is encrypted at rest.

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(72) PRIMARY KEY, -- two UUIDs concatenated (same as before)
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Timestamps (ms since epoch for consistency with the old code)
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at TIMESTAMPTZ,
  reauth_at BIGINT, -- last successful re-auth (epoch ms)
  
  -- Encrypted metadata
  ip_enc TEXT,
  ip_hash VARCHAR(64),
  user_agent_enc TEXT,
  location_enc TEXT -- approximate city/state from GeoIP
);

-- Indexes for session lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON sessions(revoked_at) WHERE revoked_at IS NULL;

-- ==================== AUDIT ====================
-- Audit trail (replaces storage/audit.json): who did what, when. No secrets.

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  username VARCHAR(64),
  action VARCHAR(64) NOT NULL,
  target VARCHAR(255),
  ip_hash VARCHAR(64)
);

-- Indexes for filtering (admin panel queries)
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_username ON audit_events(username);

-- Full-text search on audit (username, action, target)
CREATE INDEX IF NOT EXISTS idx_audit_search_trgm ON audit_events USING gin (
  (COALESCE(username, '') || ' ' || COALESCE(action, '') || ' ' || COALESCE(target, '')) gin_trgm_ops
);

-- ==================== PASSWORD RESET TOKENS ====================
-- Time-limited tokens for password recovery (replaces in-memory store).

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_expires ON password_reset_tokens(expires_at);

-- ==================== YOUTUBE CHANNELS ====================
-- Connected YouTube channels (OAuth tokens). Replaces storage/youtube.json.

CREATE TABLE IF NOT EXISTS youtube_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id VARCHAR(64) NOT NULL,
  title VARCHAR(255),

  -- OAuth tokens (encrypted at rest)
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at BIGINT,

  connected_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT youtube_channels_owner_channel_unique UNIQUE (owner_id, channel_id)
);

-- Migrate: drop old global unique constraint if it exists (idempotent)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'youtube_channels_channel_id_key'
  ) THEN
    ALTER TABLE youtube_channels DROP CONSTRAINT youtube_channels_channel_id_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_youtube_owner ON youtube_channels(owner_id);

-- ==================== YOUTUBE UPLOAD HISTORY ====================
-- Video upload metadata (replaces storage/youtube-history.json).

CREATE TABLE IF NOT EXISTS youtube_uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id VARCHAR(64) NOT NULL,
  video_id VARCHAR(16) NOT NULL,
  title VARCHAR(255),
  description TEXT,
  tags TEXT,
  privacy_status VARCHAR(16),
  publish_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns missing from earlier schema versions (idempotent)
ALTER TABLE youtube_uploads ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE youtube_uploads ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;
ALTER TABLE youtube_uploads ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
ALTER TABLE youtube_uploads ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
-- Nome do canal no momento do upload: preserva de qual conta o vídeo saiu
-- mesmo depois que o canal é desconectado.
ALTER TABLE youtube_uploads ADD COLUMN IF NOT EXISTS channel_title TEXT;

CREATE INDEX IF NOT EXISTS idx_youtube_uploads_owner ON youtube_uploads(owner_id);
CREATE INDEX IF NOT EXISTS idx_youtube_uploads_channel ON youtube_uploads(channel_id);

-- ==================== TRIGGERS ====================
-- Auto-update updated_at on row changes

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DROP + CREATE em vez de CREATE OR REPLACE TRIGGER (este só existe no PG 14+)
-- para o schema poder ser re-aplicado no boot sem erro "trigger already exists".
DROP TRIGGER IF EXISTS trigger_users_updated_at ON users;
CREATE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_groups_updated_at ON groups;
CREATE TRIGGER trigger_groups_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_accounts_updated_at ON accounts;
CREATE TRIGGER trigger_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ==================== DONE ====================
-- Schema is ready. Run the migration script (migrate-json-to-pg.mjs) to import
-- existing data from storage/*.json into these tables.
