// SQLite 初始化：负责建库连接 + 建表（幂等，可重复执行）。
// 设计原则（见 FULLREADME.md 第6节）：
//   - users / game_records / drawings 走 SQLite 持久化
//   - 房间/对局的实时状态一律走内存，不在这里出现
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/drawguess.sqlite';
const resolvedPath = path.isAbsolute(DB_PATH)
  ? DB_PATH
  : path.join(process.cwd(), DB_PATH);

// 确保数据库文件所在目录存在
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const db = new Database(resolvedPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  // users：账号表（Phase 1 范围）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // game_records / drawings 属于后续 Phase（战绩、作画记录），
  // 这里先按 FULLREADME.md 第6节的字段草案建表，避免后面迁移时改动 users 表结构，
  // 但 Phase 1 不会有任何业务代码读写这两张表。
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_records (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      room_id       TEXT NOT NULL,
      mode          TEXT NOT NULL CHECK (mode IN ('guess', 'chain')),
      score         INTEGER NOT NULL DEFAULT 0,
      played_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS drawings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id),
      game_record_id  INTEGER REFERENCES game_records(id),
      stroke_data     TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // Phase 6（战绩/排行榜/个人作画记录）：game_records/drawings 从这个 Phase 开始真正有
  // 业务代码读写，补上按 user_id 查询、排行榜聚合、按时间排序需要的索引（见 FULLREADME.md 第15节）。
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_game_records_user_id ON game_records(user_id);
    CREATE INDEX IF NOT EXISTS idx_game_records_played_at ON game_records(played_at);
    CREATE INDEX IF NOT EXISTS idx_drawings_user_id ON drawings(user_id);
    CREATE INDEX IF NOT EXISTS idx_drawings_created_at ON drawings(created_at);
  `);
}

migrate();

module.exports = db;
