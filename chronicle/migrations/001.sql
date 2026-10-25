CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS ch_users(id text PRIMARY KEY, login text UNIQUE NOT NULL, enabled boolean NOT NULL, credential text NOT NULL);
CREATE TABLE IF NOT EXISTS ch_sessions(hash text PRIMARY KEY, owner text NOT NULL REFERENCES ch_users(id), expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS ch_tokens(id uuid PRIMARY KEY, owner text NOT NULL REFERENCES ch_users(id), hash text UNIQUE NOT NULL, info jsonb NOT NULL, revoked boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS ch_groups(id uuid PRIMARY KEY, owner text NOT NULL REFERENCES ch_users(id), name text NOT NULL);
CREATE TABLE IF NOT EXISTS ch_members(group_id uuid REFERENCES ch_groups(id) ON DELETE CASCADE, user_id text REFERENCES ch_users(id), PRIMARY KEY(group_id,user_id));
CREATE TABLE IF NOT EXISTS ch_invites(id uuid PRIMARY KEY, group_id uuid REFERENCES ch_groups(id) ON DELETE CASCADE, target text REFERENCES ch_users(id), expires timestamptz NOT NULL, accepted boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS ch_mutations(owner text REFERENCES ch_users(id), request_id uuid, digest text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(owner,request_id));
CREATE TABLE IF NOT EXISTS ch_sources(id uuid PRIMARY KEY, owner text REFERENCES ch_users(id), source_key text NOT NULL, revision integer NOT NULL DEFAULT 0, published uuid, tombstone boolean NOT NULL DEFAULT false, UNIQUE(owner,source_key));
CREATE TABLE IF NOT EXISTS ch_revisions(session_id uuid REFERENCES ch_sources(id), revision integer, snapshot jsonb NOT NULL, PRIMARY KEY(session_id,revision));
CREATE TABLE IF NOT EXISTS ch_ingest_receipts(owner text REFERENCES ch_users(id), source_key text, request_id uuid, digest text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(owner,source_key,request_id));
CREATE TABLE IF NOT EXISTS ch_jobs(id uuid PRIMARY KEY, session_id uuid REFERENCES ch_sources(id), revision integer NOT NULL, profile text NOT NULL, state text NOT NULL DEFAULT 'Queued', attempts integer NOT NULL DEFAULT 0, fence bigint NOT NULL DEFAULT 0, lease_until timestamptz, error text, UNIQUE(session_id,revision,profile));
CREATE TABLE IF NOT EXISTS ch_generations(id uuid PRIMARY KEY, session_id uuid REFERENCES ch_sources(id), revision integer NOT NULL, profile text NOT NULL);
CREATE TABLE IF NOT EXISTS ch_chunks(id uuid PRIMARY KEY, generation uuid REFERENCES ch_generations(id) ON DELETE CASCADE, value jsonb NOT NULL, document tsvector NOT NULL, embedding vector NOT NULL, ordinal integer NOT NULL);
CREATE INDEX IF NOT EXISTS ch_jobs_claim ON ch_jobs(state,lease_until);
CREATE TABLE IF NOT EXISTS ch_profile(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), active text NOT NULL, target text NOT NULL, maintenance boolean NOT NULL);

ALTER TABLE ch_chunks ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ch_chunks_order ON ch_chunks(generation,ordinal);
UPDATE ch_jobs j SET state='Failed',error='superseded-revision',fence=fence+1,lease_until=NULL
FROM ch_sources s WHERE s.id=j.session_id AND j.revision<s.revision AND j.state<>'Complete' AND j.error IS DISTINCT FROM 'superseded-revision';
