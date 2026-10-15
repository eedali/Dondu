-- Döndü schema v1 (docs/02 §3)

CREATE TABLE scan_sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  roots_json TEXT NOT NULL,
  settings_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
  root TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  kind TEXT NOT NULL,
  family TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  ctime INTEGER NOT NULL,
  mime TEXT,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  is_cloud_placeholder INTEGER NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  hash_fast TEXT,
  hash_full TEXT,
  phash TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  sensitive_reason TEXT,
  rule_category TEXT,
  rule_confidence REAL,
  UNIQUE(session_id, root, rel_path)
);
CREATE INDEX idx_files_session ON files(session_id);
CREATE INDEX idx_files_size ON files(session_id, size);
CREATE INDEX idx_files_hash_fast ON files(session_id, hash_fast);

CREATE TABLE file_meta (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  json TEXT NOT NULL
);

CREATE TABLE ai_cache (
  content_key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  roots_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  action TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  suggested_name TEXT,
  confidence REAL NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  user_edited INTEGER NOT NULL DEFAULT 0,
  group_key TEXT NOT NULL,
  flags_json TEXT NOT NULL DEFAULT '[]',
  duplicate_of TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_plan_items_plan ON plan_items(plan_id);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  stats_json TEXT NOT NULL DEFAULT '{}',
  roots_json TEXT NOT NULL DEFAULT '[]',
  undo_of TEXT,
  ai_json TEXT
);

CREATE TABLE journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  item_id TEXT,
  seq INTEGER NOT NULL,
  op TEXT NOT NULL,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  size INTEGER,
  mtime INTEGER,
  hash TEXT,
  status TEXT NOT NULL,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  undone_at INTEGER
);
CREATE INDEX idx_journal_run ON journal(run_id, seq);
CREATE INDEX idx_journal_status ON journal(status);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name_tr TEXT NOT NULL,
  name_en TEXT NOT NULL,
  folder_template TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  examples_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  builtin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext TEXT NOT NULL,
  name_pattern TEXT NOT NULL,
  old_category TEXT NOT NULL,
  new_category TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
