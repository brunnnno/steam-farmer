CREATE TABLE IF NOT EXISTS steamfarmer_shared_reservations (
  account_id TEXT NOT NULL,
  appid BIGINT NOT NULL,
  apiname TEXT NOT NULL,
  owner_apiname TEXT NOT NULL,
  PRIMARY KEY (account_id, appid, apiname),
  FOREIGN KEY (account_id, appid, owner_apiname)
    REFERENCES steamfarmer_achievement_writes(account_id, appid, apiname)
);
