-- Apply using a direct PostgreSQL connection after testing on an isolated branch.
CREATE TABLE IF NOT EXISTS steamfarmer_app_state (
  id TEXT PRIMARY KEY,
  version BIGINT NOT NULL,
  encrypted JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS steamfarmer_achievement_writes (
  account_id TEXT NOT NULL,
  appid BIGINT NOT NULL,
  apiname TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, appid, apiname)
);
