CREATE TABLE IF NOT EXISTS steamfarmer_achievement_operations (
  account_id TEXT NOT NULL,
  operation_id UUID NOT NULL,
  appid BIGINT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, operation_id)
);
CREATE TABLE IF NOT EXISTS steamfarmer_operation_targets (
  account_id TEXT NOT NULL,
  operation_id UUID NOT NULL,
  appid BIGINT NOT NULL,
  apiname TEXT NOT NULL,
  receipt JSONB NOT NULL,
  reserved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, operation_id, apiname),
  FOREIGN KEY (account_id, operation_id) REFERENCES steamfarmer_achievement_operations(account_id, operation_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS steamfarmer_operation_targets_active
  ON steamfarmer_operation_targets(account_id, appid, apiname) WHERE reserved;
CREATE INDEX IF NOT EXISTS steamfarmer_operation_targets_history
  ON steamfarmer_operation_targets(account_id, appid, apiname, created_at DESC);
CREATE INDEX IF NOT EXISTS steamfarmer_achievement_operations_history
  ON steamfarmer_achievement_operations(account_id, created_at DESC);
