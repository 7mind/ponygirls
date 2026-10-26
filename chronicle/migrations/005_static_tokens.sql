ALTER TABLE ch_tokens ADD COLUMN IF NOT EXISTS static_config boolean NOT NULL DEFAULT false;
