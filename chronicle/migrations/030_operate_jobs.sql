-- Job operations for tokens (R-f): `operate_jobs` is the account-plane scope OperateJobs of a token (never part of the
-- typed TokenInfo; every existing token keeps false), `token` the token that executed a mutation first (NULL: a browser
-- session or an earlier release; no foreign key, configured tokens can be deleted). Runs at every start; idempotent;
-- metadata only. An earlier release ignores both columns.
ALTER TABLE ch_tokens ADD COLUMN IF NOT EXISTS operate_jobs boolean NOT NULL DEFAULT false;
ALTER TABLE ch_mutations ADD COLUMN IF NOT EXISTS token uuid;
