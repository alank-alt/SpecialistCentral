import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.DB_PATH || './db/database.sqlite';

// Ensure directory exists
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    logs TEXT,
    result_file TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS widget_scripts_config (
    script_name TEXT PRIMARY KEY,
    config_json TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default configurations
try {
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('company_id', '1299847');
  insertSetting.run('api_token', 'wdgankhxxytuwam7ugxs');
  insertSetting.run('user_token', '498c67ba490f6fefe0ce16f2171a3d70');
  console.log('[Database] Seeded credentials settings.');
} catch (err) {
  console.error('[Database] Failed to seed settings:', err);
}

console.log(`[Database] Initialized successfully at ${dbPath}`);

export default db;
