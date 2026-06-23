// db.js — Khởi tạo cơ sở dữ liệu SQLite và bảng dữ liệu
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// Cho phép đặt nơi lưu dữ liệu qua biến môi trường (để trỏ vào ổ đĩa bền khi deploy)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'reup.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Tạo bảng ----
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',   -- 'admin' | 'staff'
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category     TEXT,                              -- chủ đề / thể loại (vd: rap, gym...)
  channel_name TEXT NOT NULL,
  url          TEXT NOT NULL,
  channel_id   TEXT,
  thumbnail    TEXT,
  description  TEXT,                              -- mô tả kênh
  subscribers  TEXT,                              -- số subscriber (vd '503M')
  video_count  TEXT,                              -- số video
  recent_videos TEXT,                             -- JSON danh sách tiêu đề video gần đây
  platform     TEXT NOT NULL DEFAULT 'youtube',
  status       TEXT NOT NULL DEFAULT 'todo',      -- 'todo' | 'doing' | 'review' | 'done'
  quality      TEXT,                              -- ghi chú chất lượng key: 'ngon','tot','thuong'
  assigned_to  INTEGER,                           -- nhân sự được giao
  added_by     INTEGER,                           -- người thêm key
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS video_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id     INTEGER,
  user_id    INTEGER NOT NULL,
  log_date   TEXT NOT NULL,                       -- 'YYYY-MM-DD'
  count      INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (key_id) REFERENCES keys(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS finance (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id     INTEGER,
  type       TEXT NOT NULL,                       -- 'revenue' (doanh thu) | 'cost' (chi phí)
  amount     REAL NOT NULL DEFAULT 0,
  note       TEXT,
  log_date   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (key_id) REFERENCES keys(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tiktok_channels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,                     -- tên hiển thị (nickname)
  tiktok_id    TEXT,                              -- uniqueId (@handle)
  url          TEXT NOT NULL,
  url_norm     TEXT,                              -- url chuẩn hóa để chống trùng
  country      TEXT,                              -- quốc gia / region
  avatar       TEXT,
  bio          TEXT,
  followers    INTEGER DEFAULT 0,                 -- tổng follow
  likes        INTEGER DEFAULT 0,                 -- tổng tym
  video_count  INTEGER DEFAULT 0,                 -- tổng video
  total_views  INTEGER,                           -- tổng view (nhập tay, TikTok ẩn)
  monetized    INTEGER NOT NULL DEFAULT 0,        -- đã bật kiếm tiền chưa
  paypal_added INTEGER NOT NULL DEFAULT 0,        -- đã thêm Paypal chưa
  verified     INTEGER NOT NULL DEFAULT 0,        -- đã xác minh danh tính chưa
  status       TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'building' | 'banned' | 'paused'
  source_key_id INTEGER,                          -- key YouTube nguồn
  assigned_to  INTEGER,
  added_by     INTEGER,
  note         TEXT,
  last_synced  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_key_id) REFERENCES keys(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS key_workers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id     INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (key_id, user_id),
  FOREIGN KEY (key_id) REFERENCES keys(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tiktok_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL,
  snap_date   TEXT NOT NULL,                      -- 'YYYY-MM-DD'
  followers   INTEGER DEFAULT 0,
  likes       INTEGER DEFAULT 0,
  video_count INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (channel_id) REFERENCES tiktok_channels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_snap_channel ON tiktok_snapshots(channel_id, snap_date);

CREATE INDEX IF NOT EXISTS idx_videologs_date ON video_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_videologs_user ON video_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_keys_status ON keys(status);
CREATE INDEX IF NOT EXISTS idx_finance_date ON finance(log_date);
`);

// ---- Tự nâng cấp DB cũ: thêm cột mới nếu thiếu ----
const keyCols = db.prepare('PRAGMA table_info(keys)').all().map((c) => c.name);
const addKeyCol = (name, type) => {
  if (!keyCols.includes(name)) db.exec(`ALTER TABLE keys ADD COLUMN ${name} ${type}`);
};
addKeyCol('category', 'TEXT');
addKeyCol('description', 'TEXT');
addKeyCol('subscribers', 'TEXT');
addKeyCol('video_count', 'TEXT');
addKeyCol('recent_videos', 'TEXT');

// Thêm cột kiếm tiền cho tiktok_channels nếu thiếu
const ttCols = db.prepare('PRAGMA table_info(tiktok_channels)').all().map((c) => c.name);
const addTtCol = (name, type) => {
  if (!ttCols.includes(name)) db.exec(`ALTER TABLE tiktok_channels ADD COLUMN ${name} ${type}`);
};
addTtCol('monetized', 'INTEGER NOT NULL DEFAULT 0');
addTtCol('paypal_added', 'INTEGER NOT NULL DEFAULT 0');
addTtCol('verified', 'INTEGER NOT NULL DEFAULT 0');

addKeyCol('country', 'TEXT'); // quốc gia của key (nước kiếm tiền: US, JP, KR...)

// Thêm cột theo dõi đăng nhập cho users
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
const addUserCol = (name, type) => { if (!userCols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`); };
addUserCol('last_login', 'TEXT');
addUserCol('last_active', 'TEXT');

// Bỏ trạng thái "đợi duyệt" và "đã xong" -> gộp về "đang làm"
try { db.prepare("UPDATE keys SET status='doing' WHERE status IN ('review','done')").run(); } catch (_) {}

// Chuyển dữ liệu cũ: key đã giao 1 người -> bảng nhiều người (key_workers)
try {
  db.prepare(`INSERT OR IGNORE INTO key_workers (key_id, user_id)
              SELECT id, assigned_to FROM keys WHERE assigned_to IS NOT NULL`).run();
} catch (_) {}

// ---- Tạo tài khoản admin mặc định nếu chưa có ----
const adminExists = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get();
if (adminExists.c === 0) {
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = bcrypt.hashSync(pw, 10);
  db.prepare(
    "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, 'admin')"
  ).run('admin', hash, 'Quản trị viên');
  console.log('✓ Đã tạo tài khoản admin: admin / ' + (process.env.ADMIN_PASSWORD ? '(mật khẩu từ biến môi trường ADMIN_PASSWORD)' : 'admin123'));
}

module.exports = db;
