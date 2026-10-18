import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      industry TEXT, topic TEXT, audience TEXT,
      recency_months INTEGER, style TEXT, audited INTEGER, publisher TEXT, notes TEXT,
      requested_by TEXT, created_at TEXT, run_date TEXT,
      articles_json TEXT, selected_article INTEGER,
      draft TEXT, draft_version INTEGER DEFAULT 0,
      gate1_decision TEXT, gate1_comments TEXT, gate1_approver TEXT, gate1_at TEXT,
      gate2_decision TEXT, gate2_comments TEXT, gate2_approver TEXT, gate2_at TEXT,
      genai_ack INTEGER DEFAULT 0,
      due_at TEXT, published_url TEXT, published_at TEXT, failure_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, ts TEXT, actor TEXT, text TEXT
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, to_addr TEXT, subject TEXT, body TEXT, sent INTEGER DEFAULT 0, error TEXT
    );
  `);
  return db;
}
