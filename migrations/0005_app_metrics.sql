-- Private, aggregate-only counters for the New Way's Admin dashboard.
-- No visitor names, addresses, IPs or device identifiers are stored.
CREATE TABLE app_metrics (
  key TEXT PRIMARY KEY CHECK (key IN ('unique_visitors', 'app_installs')),
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0)
);
INSERT INTO app_metrics (key, value) VALUES ('unique_visitors', 0), ('app_installs', 0);
