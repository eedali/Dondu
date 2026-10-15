-- Revision 1: topic-based organisation

ALTER TABLE plan_items ADD COLUMN unit_id TEXT;
ALTER TABLE plan_items ADD COLUMN unit_title TEXT;
ALTER TABLE plan_items ADD COLUMN topic TEXT;

-- The user's folder choices: "this topic/kind goes to this folder" (fed to the folder architect).
CREATE TABLE folder_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root TEXT NOT NULL,
  topic TEXT NOT NULL,
  kind TEXT NOT NULL,
  folder TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_folder_prefs_root ON folder_prefs(root, created_at);
