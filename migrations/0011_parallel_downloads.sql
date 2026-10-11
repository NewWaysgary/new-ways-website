-- New Way's: correct tracking when a phone downloads the meditation over several connections at once.
-- ADDITIVE ONLY: new columns. Nothing is deleted and no existing row is changed here. (Downloads already recorded as
-- "interrupted" are looked at again by the website itself, with the corrected rule: see src/shop/downloads.js.)
--
-- Chrome for Android and Samsung Internet download a large file over two or three connections: one from the start,
-- and others for later parts. When the first connection reaches the start of a part another connection is already
-- fetching, the browser closes it on purpose. The website used to record that deliberate close as "interrupted".

-- For each request: up to which byte of the file it is counted towards the complete download, and whether another
-- request took over from it (the browser switching connections, or resuming after a drop)
ALTER TABLE download_transfers ADD COLUMN counted_until INTEGER;
ALTER TABLE download_transfers ADD COLUMN taken_over_at INTEGER;

-- How the website established that the whole file was sent: 'one_connection' (one request sent every byte and
-- finished) or 'several_connections' (the parts sent by several requests join up into the whole file)
ALTER TABLE download_entitlements ADD COLUMN completion_basis TEXT NOT NULL DEFAULT '';
