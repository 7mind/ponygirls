-- Haystack: read-only export of every stored document for the codec check. One line per stored text:
--   D|<items or item_revisions>|<revision>|<hex of the UTF-8 bytes of document_text>
-- and a closing line with the row counts, so a truncated stream is detected. Keys are not exported.
-- The output is document content: write it only into a private file and delete it after the check.
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
SELECT 'LR.server_encoding', current_setting('server_encoding');
SELECT 'D', 'items', revision, encode(convert_to(document_text, 'UTF8'), 'hex') FROM items;
SELECT 'D', 'item_revisions', revision, encode(convert_to(document_text, 'UTF8'), 'hex') FROM item_revisions;
SELECT 'LR.export.complete', (SELECT count(*) FROM items), (SELECT count(*) FROM item_revisions);
ROLLBACK;
