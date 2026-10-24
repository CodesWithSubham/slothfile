export const migration001 = {
  version: 1,
  name: 'initial',
  sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE selected_folders (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_scanned_at INTEGER,
  is_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES selected_folders(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  name TEXT NOT NULL,
  extension TEXT NOT NULL,
  size INTEGER NOT NULL,
  modified_at INTEGER NOT NULL,
  content_hash TEXT,
  hash_status TEXT NOT NULL DEFAULT 'none' CHECK (hash_status IN ('none','hashed','failed','stale')),
  classification_status TEXT NOT NULL DEFAULT 'none' CHECK (classification_status IN ('none','pending','classified','skipped','failed')),
  missing INTEGER NOT NULL DEFAULT 0,
  last_scanned_at INTEGER NOT NULL,
  UNIQUE (folder_id, path)
);
CREATE INDEX idx_files_folder ON files(folder_id, missing);
CREATE INDEX idx_files_hash ON files(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX idx_files_size ON files(size);
CREATE INDEX idx_files_name ON files(name COLLATE NOCASE);

CREATE TABLE classifications (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  category TEXT NOT NULL,
  suggested_name TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_classifications_file ON classifications(file_id, created_at);

CREATE TABLE organization_plans (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES selected_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','executing','executed','partial','abandoned')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE planned_operations (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES organization_plans(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  classification_id TEXT REFERENCES classifications(id) ON DELETE SET NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('move','rename_move')),
  category TEXT NOT NULL,
  dest_dir_name TEXT NOT NULL,
  dest_file_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  destination_path TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed','approved','rejected','executing','completed','failed','interrupted')),
  validation_errors TEXT NOT NULL DEFAULT '[]',
  approved_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ops_plan ON planned_operations(plan_id);

-- Write-ahead journal. A row is inserted as 'started' BEFORE the filesystem is touched.
CREATE TABLE operation_history (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES planned_operations(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES organization_plans(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  destination_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed','interrupted')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  source_fingerprint TEXT NOT NULL,
  destination_fingerprint TEXT,
  created_dirs TEXT NOT NULL DEFAULT '[]',
  undo_status TEXT NOT NULL DEFAULT 'none' CHECK (undo_status IN ('none','undone','refused')),
  undone_at INTEGER,
  undo_message TEXT
);
CREATE INDEX idx_history_plan ON operation_history(plan_id);
CREATE INDEX idx_history_started ON operation_history(started_at DESC);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled','interrupted')),
  total INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  phase TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
`
} as const;
