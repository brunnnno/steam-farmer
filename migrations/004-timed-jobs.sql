-- Migration 004: Durable Timed Achievement Modification Jobs & Queue
-- Prevents Render container sleep/restarts from losing multi-hour timed schedules.

CREATE TABLE IF NOT EXISTS steamfarmer_timed_jobs (
  job_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  appid INTEGER NOT NULL CHECK (appid > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused_collision', 'completed', 'cancelled')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS steamfarmer_timed_jobs_status_idx
  ON steamfarmer_timed_jobs (status, account_id, appid);

CREATE TABLE IF NOT EXISTS steamfarmer_timed_queue (
  job_id TEXT NOT NULL REFERENCES steamfarmer_timed_jobs(job_id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL CHECK (item_index >= 0),
  apiname TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('unlock', 'remove')),
  run_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  PRIMARY KEY (job_id, item_index)
);

CREATE INDEX IF NOT EXISTS steamfarmer_timed_queue_pending_idx
  ON steamfarmer_timed_queue (job_id, completed, run_at);
