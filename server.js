// server.js — API server cho hệ thống quản lý team reup video
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // chạy sau proxy của Fly/Cloudflare (lấy đúng IP)

// Header bảo mật cơ bản
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '256kb' }));
// API không bao giờ được cache (để thêm/sửa là thấy ngay, không phải tải lại trang)
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
// Chống cache file giao diện -> trình duyệt luôn lấy bản mới nhất sau khi cập nhật
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));

// Chống dò mật khẩu: giới hạn số lần đăng nhập sai theo IP
const loginAttempts = new Map();
function loginLimiter(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (rec.until > now) return res.status(429).json({ error: 'Sai quá nhiều lần, thử lại sau ít phút' });
  next();
}
function recordLoginFail(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 8) { rec.until = now + 10 * 60 * 1000; rec.count = 0; } // khóa 10 phút
  loginAttempts.set(ip, rec);
}

// ============ TIỆN ÍCH ============
function token() {
  return crypto.randomBytes(24).toString('hex');
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Giải mã ký tự đặc biệt (HTML + chuỗi JSON \uXXXX, \n)
function decodeText(s) {
  if (!s) return s;
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, ' ')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

async function getHtml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Lấy thông tin kênh YouTube từ link: tên, ảnh, mô tả, sub, số video, video gần đây
async function fetchChannelInfo(url) {
  const result = {
    channel_name: null, thumbnail: null, channel_id: null,
    description: null, subscribers: null, video_count: null, recent_videos: [],
  };
  try {
    const html = await getHtml(url);
    const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };

    let name =
      pick(/<meta property="og:title" content="([^"]+)"/i) ||
      pick(/"author":"([^"]+)"/i) ||
      pick(/<title>([^<]+)<\/title>/i);
    if (name) name = decodeText(name.replace(/ - YouTube$/i, ''));
    result.channel_name = name;

    result.thumbnail = pick(/<meta property="og:image" content="([^"]+)"/i) || null;
    result.channel_id =
      pick(/"channelId":"([^"]+)"/i) ||
      pick(/<meta itemprop="identifier" content="([^"]+)"/i) || null;

    const desc = pick(/<meta property="og:description" content="([^"]+)"/i);
    if (desc) result.description = decodeText(desc).slice(0, 500);

    // Số sub kênh chính ở dạng "content":"503M subscribers" (duy nhất 1 kết quả)
    const subs =
      pick(/"content":"([\d.,]+[KMB]?)\s*subscribers"/i) ||
      pick(/"subscriberCountText":"([\d.,]+[KMB]?)\s*subscribers"/i) ||
      pick(/"simpleText":"([\d.,]+[KMB]?)\s*subscribers"/i);
    if (subs) result.subscribers = subs.replace(/[^\d.,KMB]/gi, '').trim();

    const vids =
      pick(/"content":"([\d.,]+[KMB]?)\s*videos"/i) ||
      pick(/"videosCountText".{0,80}?"content":"([\d.,]+)"/i);
    if (vids) result.video_count = vids.replace(/[^\d.,KMB]/gi, '');

    // Lấy tiêu đề video gần đây từ trang /videos
    result.recent_videos = await fetchRecentVideos(url, result.channel_id);
  } catch (e) {
    console.warn('fetchChannelInfo lỗi:', e.message);
  }
  return result;
}

// Lấy tối đa 6 tiêu đề video gần nhất
async function fetchRecentVideos(url, channelId) {
  try {
    let videosUrl;
    if (channelId) videosUrl = `https://www.youtube.com/channel/${channelId}/videos`;
    else videosUrl = url.replace(/\/+$/, '').replace(/\/(videos|featured|streams|shorts)$/i, '') + '/videos';
    const html = await getHtml(videosUrl);
    const titles = [...html.matchAll(/"lockupMetadataViewModel":\{"title":\{"content":"([^"]{4,110})"/g)].map((m) => m[1]);
    // Loại bỏ chuỗi rác của giao diện trình phát YouTube
    const JUNK = new Set(['Keyboard shortcuts', 'Playback', 'General', 'Subtitles and closed captions', 'Audio track', 'Want to join this channel?', 'Spherical Videos', 'Sign in', 'NaN / NaN']);
    const seen = new Set();
    const clean = [];
    for (const t of titles) {
      const d = decodeText(t);
      if (d && !JUNK.has(d) && !seen.has(d)) { seen.add(d); clean.push(d); }
      if (clean.length >= 6) break;
    }
    return clean;
  } catch (_) {
    return [];
  }
}

// Chuẩn hóa link để so trùng (bỏ https/www, query, đuôi /videos...)
function normalizeUrl(u) {
  if (!u) return '';
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('?')[0].split('#')[0].replace(/\/+$/, '');
  s = s.replace(/\/(videos|featured|shorts|streams|about|community|playlists)$/, '');
  return s;
}

// Chấp nhận cả link đầy đủ lẫn ID kênh -> trả về link chuẩn
function toTiktokUrl(input) {
  let s = String(input || '').trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  s = s.replace(/^.*tiktok\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return 'https://www.tiktok.com/@' + s;
}

// Lấy thông tin kênh TikTok (follower, tym, video, ảnh, region...)
async function fetchTiktokInfo(url) {
  const r = {
    name: null, tiktok_id: null, avatar: null, bio: null, country: null,
    followers: 0, likes: 0, video_count: 0,
  };
  // Ưu tiên API tikwm (miễn phí, chạy được cả trên cloud)
  const handleM = String(url).match(/@([^/?#]+)/);
  if (handleM) {
    try {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch('https://www.tikwm.com/api/user/info?unique_id=' + encodeURIComponent(handleM[1]), { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(tm);
      const j = await res.json();
      if (j && j.code === 0 && j.data && j.data.stats) {
        const u = j.data.user || {}, s = j.data.stats;
        r.tiktok_id = u.uniqueId || handleM[1];
        r.name = decodeText(u.nickname || handleM[1]);
        r.avatar = u.avatarLarger || u.avatarMedium || u.avatarThumb || null;
        r.bio = decodeText(u.signature || '');
        r.followers = Number(s.followerCount) || 0;
        r.likes = Number(s.heartCount) || 0;
        r.video_count = Number(s.videoCount) || 0;
        return r;
      }
    } catch (e) { console.warn('tikwm lỗi:', e.message); }
  }
  // Dự phòng: tự cào trang (cũ)
  try {
    const html = await getHtml(url);
    const pick = (re) => { const m = html.match(re); return m ? m[1] : null; };
    const num = (re) => { const m = html.match(re); return m ? parseInt(m[1], 10) : 0; };
    r.tiktok_id = pick(/"uniqueId":"([^"]+)"/);
    r.name = decodeText(pick(/"nickname":"([^"]*)"/) || r.tiktok_id || '');
    const av = pick(/"avatarLarger":"([^"]+)"/) || pick(/"avatarMedium":"([^"]+)"/) || pick(/"avatarThumb":"([^"]+)"/);
    r.avatar = av ? decodeText(av) : null;
    r.bio = decodeText(pick(/"signature":"([^"]*)"/) || '');
    // Lưu ý: "region" trong trang là khu vực người XEM (máy chủ), không phải của kênh
    // => không tự lấy quốc gia, để người dùng tự chọn từ danh sách Creator Rewards
    r.country = null;
    r.followers = num(/"followerCount":(\d+)/);
    r.likes = num(/"heartCount":(\d+)/) || num(/"heart":(\d+)/);
    r.video_count = num(/"videoCount":(\d+)/);
  } catch (e) {
    console.warn('fetchTiktokInfo lỗi:', e.message);
  }
  // Dự phòng: nếu trang bị chặn (server cloud), thử oEmbed để lấy ít nhất tên + ảnh
  if (!r.name) {
    try {
      const o = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url), { headers: { 'User-Agent': UA } });
      if (o.ok) {
        const j = await o.json();
        r.name = j.author_name || j.title || r.name;
        r.avatar = r.avatar || j.thumbnail_url || null;
        if (!r.tiktok_id && j.author_url) { const m = j.author_url.match(/@([^/?#]+)/); if (m) r.tiktok_id = m[1]; }
      }
    } catch (_) {}
  }
  return r;
}

// ============ XÁC THỰC ============
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const tok = header.replace(/^Bearer /, '');
  if (!tok) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(tok);
  if (!row || !row.active)
    return res.status(401).json({ error: 'Phiên hết hạn, đăng nhập lại' });
  req.user = row;
  req.token = tok;
  // Cập nhật "hoạt động lần cuối" (tối đa 1 lần/phút để khỏi ghi liên tục)
  const now = Date.now();
  const lastMs = row.last_active ? new Date(row.last_active.replace(' ', 'T') + 'Z').getTime() : 0;
  if (!lastMs || now - lastMs > 60000) {
    try { db.prepare("UPDATE users SET last_active = datetime('now') WHERE id = ?").run(row.id); } catch (_) {}
  }
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Chỉ admin được phép' });
  next();
}

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  active: u.active,
  created_at: u.created_at,
  last_login: u.last_login,
  last_active: u.last_active,
});

// ============ AUTH API ============
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    recordLoginFail(req.ip);
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  if (!u.active) return res.status(403).json({ error: 'Tài khoản đã bị khóa' });
  const tok = token();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(tok, u.id);
  db.prepare("UPDATE users SET last_login = datetime('now'), last_active = datetime('now') WHERE id = ?").run(u.id);
  res.json({ token: tok, user: publicUser(u) });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/me/password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4)
    return res.status(400).json({ error: 'Mật khẩu mới tối thiểu 4 ký tự' });
  if (!bcrypt.compareSync(oldPassword || '', req.user.password_hash))
    return res.status(400).json({ error: 'Mật khẩu cũ không đúng' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(newPassword, 10),
    req.user.id
  );
  res.json({ ok: true });
});

// ============ NHÂN SỰ (admin) ============
app.get('/api/users', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY role, name').all();
  res.json(rows.map(publicUser));
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name)
    return res.status(400).json({ error: 'Thiếu thông tin' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)'
    )
    .run(username, bcrypt.hashSync(password, 10), name, role === 'admin' ? 'admin' : 'staff');
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)));
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const { name, role, active, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy' });
  db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(
    name ?? u.name,
    role === 'admin' ? 'admin' : 'staff',
    active != null ? (active ? 1 : 0) : u.active,
    u.id
  );
  if (password)
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(password, 10),
      u.id
    );
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Không thể xóa chính mình' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ KEY / KÊNH YOUTUBE ============
// Xem trước thông tin kênh từ link (không lưu)
app.post('/api/keys/preview', auth, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Thiếu link' });
  const info = await fetchChannelInfo(url);
  res.json(info);
});

const keyWithNames = `
  SELECT k.*,
         b.name AS added_name,
         (SELECT GROUP_CONCAT(u.name, ', ') FROM key_workers kw JOIN users u ON u.id = kw.user_id WHERE kw.key_id = k.id) AS worker_names,
         (SELECT GROUP_CONCAT(kw.user_id) FROM key_workers kw WHERE kw.key_id = k.id) AS worker_ids,
         (SELECT COUNT(*) FROM key_workers kw WHERE kw.key_id = k.id) AS worker_count
  FROM keys k
  LEFT JOIN users b ON b.id = k.added_by
`;

app.get('/api/keys', auth, (req, res) => {
  const rows = db.prepare(keyWithNames + ' ORDER BY k.created_at DESC').all();
  res.json(rows);
});

app.post('/api/keys', auth, async (req, res) => {
  let {
    url, channel_name, category, country, status, quality, assigned_to, note,
    thumbnail, channel_id, description, subscribers, video_count, recent_videos,
  } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Thiếu link kênh' });
  if (!category || !String(category).trim()) return res.status(400).json({ error: 'Vui lòng nhập chủ đề key' });
  // CHỐNG TRÙNG: so link đã chuẩn hóa với các key hiện có
  const norm = normalizeUrl(url);
  const allKeys = db.prepare(keyWithNames).all();
  let dup = allKeys.find((k) => normalizeUrl(k.url) === norm);
  if (!dup && channel_id) dup = allKeys.find((k) => k.channel_id && k.channel_id === channel_id);
  if (dup) return res.status(409).json({ error: 'duplicate', key: dup });
  // Nếu thiếu thông tin (chưa bấm "Lấy thông tin") thì tự lấy từ link
  if (!channel_name || description == null) {
    const info = await fetchChannelInfo(url);
    channel_name = channel_name || info.channel_name || url;
    thumbnail = thumbnail || info.thumbnail;
    channel_id = channel_id || info.channel_id;
    description = description || info.description;
    subscribers = subscribers || info.subscribers;
    video_count = video_count || info.video_count;
    recent_videos = recent_videos || info.recent_videos;
  }
  // Kiểm tra lại theo channel_id sau khi đã lấy thông tin
  if (channel_id) {
    const dup2 = allKeys.find((k) => k.channel_id && k.channel_id === channel_id);
    if (dup2) return res.status(409).json({ error: 'duplicate', key: dup2 });
  }
  const rv = Array.isArray(recent_videos) ? JSON.stringify(recent_videos) : (recent_videos || null);
  const info = db
    .prepare(
      `INSERT INTO keys (category, country, channel_name, url, channel_id, thumbnail, description, subscribers, video_count, recent_videos, status, quality, assigned_to, added_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(category).trim(),
      country || null,
      channel_name,
      url,
      channel_id || null,
      thumbnail || null,
      description || null,
      subscribers || null,
      video_count || null,
      rv,
      ['todo', 'doing'].includes(status) ? status : 'todo',
      quality || null,
      assigned_to || null,
      req.user.id,
      note || null
    );
  res.json(db.prepare(keyWithNames + ' WHERE k.id = ?').get(info.lastInsertRowid));
});

app.put('/api/keys/:id', auth, (req, res) => {
  const k = db.prepare('SELECT * FROM keys WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Không tìm thấy key' });
  const { channel_name, url, category, country, status, quality, assigned_to, note } = req.body || {};
  db.prepare(
    `UPDATE keys SET category = ?, country = ?, channel_name = ?, url = ?, status = ?, quality = ?, assigned_to = ?, note = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    category !== undefined && String(category).trim() ? String(category).trim() : k.category,
    country !== undefined ? country : k.country,
    channel_name ?? k.channel_name,
    url ?? k.url,
    ['todo', 'doing'].includes(status) ? status : k.status,
    quality !== undefined ? quality : k.quality,
    assigned_to !== undefined ? assigned_to || null : k.assigned_to,
    note !== undefined ? note : k.note,
    k.id
  );
  res.json(db.prepare(keyWithNames + ' WHERE k.id = ?').get(k.id));
});

app.delete('/api/keys/:id', auth, (req, res) => {
  db.prepare('DELETE FROM keys WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Nhân viên tự nhận / bỏ nhận key
app.post('/api/keys/:id/claim', auth, (req, res) => {
  const k = db.prepare('SELECT * FROM keys WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Không tìm thấy key' });
  const release = req.body && req.body.release;
  if (release) {
    db.prepare('DELETE FROM key_workers WHERE key_id=? AND user_id=?').run(k.id, req.user.id);
    const cnt = db.prepare('SELECT COUNT(*) c FROM key_workers WHERE key_id=?').get(k.id).c;
    if (cnt === 0 && k.status === 'doing') db.prepare("UPDATE keys SET status='todo', updated_at=datetime('now') WHERE id=?").run(k.id);
  } else {
    // Nhiều người cùng làm 1 key được — ai thích thì nhận
    db.prepare('INSERT OR IGNORE INTO key_workers (key_id, user_id) VALUES (?, ?)').run(k.id, req.user.id);
    if (k.status === 'todo') db.prepare("UPDATE keys SET status='doing', updated_at=datetime('now') WHERE id=?").run(k.id);
  }
  res.json(db.prepare(keyWithNames + ' WHERE k.id = ?').get(k.id));
});

// ============ KÊNH TIKTOK ============
const TT_STATUS = ['active', 'building', 'banned', 'paused'];
const tiktokWithNames = `
  SELECT t.*, a.name AS assigned_name, b.name AS added_name, k.channel_name AS source_key_name
  FROM tiktok_channels t
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN users b ON b.id = t.added_by
  LEFT JOIN keys k ON k.id = t.source_key_id
`;

// Lưu mốc tăng trưởng (1 mốc/ngày/kênh)
function saveSnapshot(channelId, followers, likes, video_count) {
  const today = new Date().toISOString().slice(0, 10);
  const ex = db.prepare('SELECT id FROM tiktok_snapshots WHERE channel_id=? AND snap_date=?').get(channelId, today);
  if (ex) db.prepare('UPDATE tiktok_snapshots SET followers=?, likes=?, video_count=? WHERE id=?').run(followers, likes, video_count, ex.id);
  else db.prepare('INSERT INTO tiktok_snapshots (channel_id, snap_date, followers, likes, video_count) VALUES (?,?,?,?,?)').run(channelId, today, followers, likes, video_count);
}

app.get('/api/tiktok', auth, (req, res) => {
  // Nhân viên chỉ thấy kênh của mình (assigned_to hoặc added_by là mình)
  if (req.user.role !== 'admin') {
    return res.json(db.prepare(tiktokWithNames + ' WHERE t.assigned_to = ? OR t.added_by = ? ORDER BY t.created_at DESC').all(req.user.id, req.user.id));
  }
  res.json(db.prepare(tiktokWithNames + ' ORDER BY t.created_at DESC').all());
});

// Dữ liệu biểu đồ tăng trưởng của 1 kênh
app.get('/api/tiktok/:id/growth', auth, (req, res) => {
  const rows = db.prepare('SELECT snap_date, followers, likes, video_count FROM tiktok_snapshots WHERE channel_id=? ORDER BY snap_date ASC').all(req.params.id);
  res.json(rows);
});

app.post('/api/tiktok/preview', auth, async (req, res) => {
  let { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Thiếu link/ID TikTok' });
  url = toTiktokUrl(url);
  const info = await fetchTiktokInfo(url);
  info.url = url;
  const norm = normalizeUrl(url);
  const dup = db.prepare(tiktokWithNames).all()
    .find((t) => normalizeUrl(t.url) === norm || (info.tiktok_id && t.tiktok_id === info.tiktok_id));
  res.json({ ...info, duplicate: dup || null });
});

app.post('/api/tiktok', auth, async (req, res) => {
  let { url, name, tiktok_id, country, status, source_key_id, assigned_to, note, total_views,
        avatar, bio, followers, likes, video_count, monetized, paypal_added, verified } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Thiếu link/ID TikTok' });
  url = toTiktokUrl(url);
  const norm = normalizeUrl(url);
  const all = db.prepare(tiktokWithNames).all();
  const dup = all.find((t) => normalizeUrl(t.url) === norm || (tiktok_id && t.tiktok_id === tiktok_id));
  if (dup) return res.status(409).json({ error: 'duplicate', channel: dup });
  if (!name || followers == null) {
    const info = await fetchTiktokInfo(url);
    name = name || info.name || url;
    tiktok_id = tiktok_id || info.tiktok_id;
    avatar = avatar || info.avatar;
    bio = bio || info.bio;
    country = country || info.country;
    followers = followers != null ? followers : info.followers;
    likes = likes != null ? likes : info.likes;
    video_count = video_count != null ? video_count : info.video_count;
  }
  // Nhân viên tự thêm thì mặc định kênh thuộc về mình; admin có thể giao cho ai đó
  const owner = req.user.role === 'admin' ? (assigned_to || req.user.id) : req.user.id;
  const out = db.prepare(
    `INSERT INTO tiktok_channels (name, tiktok_id, url, url_norm, country, avatar, bio, followers, likes, video_count, total_views, monetized, paypal_added, verified, status, source_key_id, assigned_to, added_by, note, last_synced)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  ).run(
    name, tiktok_id || null, url, norm, country || null, avatar || null, bio || null,
    Number(followers) || 0, Number(likes) || 0, Number(video_count) || 0,
    total_views ? Number(total_views) : null,
    monetized ? 1 : 0, paypal_added ? 1 : 0, verified ? 1 : 0,
    TT_STATUS.includes(status) ? status : 'active',
    source_key_id || null, owner, req.user.id, note || null
  );
  saveSnapshot(out.lastInsertRowid, Number(followers) || 0, Number(likes) || 0, Number(video_count) || 0);
  res.json(db.prepare(tiktokWithNames + ' WHERE t.id = ?').get(out.lastInsertRowid));
});

app.put('/api/tiktok/:id', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tiktok_channels WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy' });
  const { name, url, country, status, source_key_id, assigned_to, note, total_views, monetized, paypal_added, verified, followers, likes, video_count } = req.body || {};
  db.prepare(
    `UPDATE tiktok_channels SET name=?, url=?, url_norm=?, country=?, status=?, source_key_id=?, assigned_to=?, note=?, total_views=?, monetized=?, paypal_added=?, verified=?, followers=?, likes=?, video_count=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    name ?? t.name, url ?? t.url, normalizeUrl(url ?? t.url),
    country !== undefined ? country : t.country,
    TT_STATUS.includes(status) ? status : t.status,
    source_key_id !== undefined ? (source_key_id || null) : t.source_key_id,
    assigned_to !== undefined ? (assigned_to || null) : t.assigned_to,
    note !== undefined ? note : t.note,
    total_views !== undefined ? (total_views === '' || total_views == null ? null : Number(total_views)) : t.total_views,
    monetized !== undefined ? (monetized ? 1 : 0) : t.monetized,
    paypal_added !== undefined ? (paypal_added ? 1 : 0) : t.paypal_added,
    verified !== undefined ? (verified ? 1 : 0) : t.verified,
    followers !== undefined && followers !== '' ? Number(followers) : t.followers,
    likes !== undefined && likes !== '' ? Number(likes) : t.likes,
    video_count !== undefined && video_count !== '' ? Number(video_count) : t.video_count,
    t.id
  );
  res.json(db.prepare(tiktokWithNames + ' WHERE t.id = ?').get(t.id));
});

app.post('/api/tiktok/:id/sync', auth, async (req, res) => {
  const t = db.prepare('SELECT * FROM tiktok_channels WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy' });
  if (req.user.role !== 'admin' && t.assigned_to !== req.user.id && t.added_by !== req.user.id)
    return res.status(403).json({ error: 'Không có quyền' });
  const info = await fetchTiktokInfo(t.url);
  const nf = info.followers || t.followers, nl = info.likes || t.likes, nv = info.video_count || t.video_count;
  db.prepare(
    `UPDATE tiktok_channels SET name=?, tiktok_id=?, avatar=?, bio=?, country=?, followers=?, likes=?, video_count=?, last_synced=datetime('now'), updated_at=datetime('now') WHERE id=?`
  ).run(
    info.name || t.name, info.tiktok_id || t.tiktok_id, info.avatar || t.avatar, info.bio || t.bio,
    info.country || t.country, nf, nl, nv, t.id
  );
  saveSnapshot(t.id, nf, nl, nv);
  res.json(db.prepare(tiktokWithNames + ' WHERE t.id = ?').get(t.id));
});

app.delete('/api/tiktok/:id', auth, (req, res) => {
  db.prepare('DELETE FROM tiktok_channels WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ĐỒNG BỘ TẤT CẢ kênh (chạy ngầm) — gọi bởi admin (nút) hoặc cron (SYNC_TOKEN)
let syncing = false;
let lastSync = { at: null, total: 0, ok: 0, running: false };
async function syncAllTiktok() {
  if (syncing) return;
  syncing = true;
  const chans = db.prepare('SELECT id, url FROM tiktok_channels').all();
  lastSync = { at: new Date().toISOString(), total: chans.length, ok: 0, running: true };
  try {
    for (const c of chans) {
      try {
        const info = await fetchTiktokInfo(c.url);
        if (info.followers || info.likes || info.video_count) {
          db.prepare(
            `UPDATE tiktok_channels SET followers=?, likes=?, video_count=?, avatar=COALESCE(?,avatar), last_synced=datetime('now'), updated_at=datetime('now') WHERE id=?`
          ).run(info.followers, info.likes, info.video_count, info.avatar, c.id);
          saveSnapshot(c.id, info.followers, info.likes, info.video_count);
          lastSync.ok++;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 700)); // throttle nhẹ tránh bị giới hạn
    }
  } finally {
    syncing = false;
    lastSync.running = false;
    lastSync.at = new Date().toISOString();
  }
}

app.post('/api/tiktok/sync-all', (req, res) => {
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  const isCron = process.env.SYNC_TOKEN && tok === process.env.SYNC_TOKEN;
  let isAdmin = false;
  if (!isCron && tok) {
    const u = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(tok);
    isAdmin = u && u.role === 'admin';
  }
  if (!isCron && !isAdmin) return res.status(401).json({ error: 'Không có quyền' });
  if (syncing) return res.json({ ok: true, message: 'Đang đồng bộ rồi', lastSync });
  syncAllTiktok(); // chạy ngầm, không chặn
  res.json({ ok: true, message: 'Đã bắt đầu đồng bộ ngầm' });
});

app.get('/api/tiktok/sync-status', auth, (req, res) => res.json(lastSync));

// ============ NHẬT KÝ VIDEO ============
app.get('/api/videologs', auth, (req, res) => {
  const { from, to, user_id } = req.query;
  let sql = `
    SELECT v.*, u.name AS user_name, k.channel_name AS key_name
    FROM video_logs v
    JOIN users u ON u.id = v.user_id
    LEFT JOIN keys k ON k.id = v.key_id
    WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND v.log_date >= ?'; params.push(from); }
  if (to) { sql += ' AND v.log_date <= ?'; params.push(to); }
  if (user_id) { sql += ' AND v.user_id = ?'; params.push(user_id); }
  // Nhân sự chỉ xem được log của mình
  if (req.user.role !== 'admin') { sql += ' AND v.user_id = ?'; params.push(req.user.id); }
  sql += ' ORDER BY v.log_date DESC, v.id DESC';
  res.json(db.prepare(sql).all(...params));
});

// Báo cáo: trong khoảng ngày, mỗi người làm bao nhiêu video, bao nhiêu key
app.get('/api/report/videos', auth, (req, res) => {
  const { from, to } = req.query;
  const params = [];
  let where = 'WHERE 1=1';
  if (from) { where += ' AND v.log_date >= ?'; params.push(from); }
  if (to) { where += ' AND v.log_date <= ?'; params.push(to); }
  if (req.user.role !== 'admin') { where += ' AND v.user_id = ?'; params.push(req.user.id); }
  const rows = db.prepare(`
    SELECT u.id, u.name,
      COALESCE(SUM(v.count),0) AS total_videos,
      COUNT(DISTINCT v.key_id) AS keys_count,
      COUNT(v.id) AS log_count,
      MAX(v.log_date) AS last_day
    FROM video_logs v JOIN users u ON u.id = v.user_id
    ${where}
    GROUP BY u.id ORDER BY total_videos DESC`).all(...params);
  const totalVideos = rows.reduce((a, b) => a + b.total_videos, 0);
  res.json({ rows, totalVideos });
});

app.post('/api/videologs', auth, (req, res) => {
  let { key_id, user_id, log_date, count, note } = req.body || {};
  if (!log_date) log_date = new Date().toISOString().slice(0, 10);
  // Nhân sự chỉ ghi cho chính mình
  const targetUser = req.user.role === 'admin' && user_id ? user_id : req.user.id;
  const info = db
    .prepare(
      'INSERT INTO video_logs (key_id, user_id, log_date, count, note) VALUES (?, ?, ?, ?, ?)'
    )
    .run(key_id || null, targetUser, log_date, Number(count) || 0, note || null);
  res.json(db.prepare('SELECT * FROM video_logs WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/videologs/:id', auth, (req, res) => {
  const v = db.prepare('SELECT * FROM video_logs WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Không tìm thấy' });
  if (req.user.role !== 'admin' && v.user_id !== req.user.id)
    return res.status(403).json({ error: 'Không có quyền' });
  const { key_id, log_date, count, note } = req.body || {};
  db.prepare('UPDATE video_logs SET key_id = ?, log_date = ?, count = ?, note = ? WHERE id = ?').run(
    key_id !== undefined ? key_id || null : v.key_id,
    log_date ?? v.log_date,
    count != null ? Number(count) : v.count,
    note !== undefined ? note : v.note,
    v.id
  );
  res.json(db.prepare('SELECT * FROM video_logs WHERE id = ?').get(v.id));
});

app.delete('/api/videologs/:id', auth, (req, res) => {
  const v = db.prepare('SELECT * FROM video_logs WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Không tìm thấy' });
  if (req.user.role !== 'admin' && v.user_id !== req.user.id)
    return res.status(403).json({ error: 'Không có quyền' });
  db.prepare('DELETE FROM video_logs WHERE id = ?').run(v.id);
  res.json({ ok: true });
});

// ============ TÀI CHÍNH / LỢI NHUẬN (admin) ============
app.get('/api/finance', auth, adminOnly, (req, res) => {
  const rows = db
    .prepare(
      `SELECT f.*, k.channel_name AS key_name
       FROM finance f LEFT JOIN keys k ON k.id = f.key_id
       ORDER BY f.log_date DESC, f.id DESC`
    )
    .all();
  res.json(rows);
});

app.post('/api/finance', auth, adminOnly, (req, res) => {
  let { key_id, type, amount, note, log_date } = req.body || {};
  if (!['revenue', 'cost'].includes(type))
    return res.status(400).json({ error: 'Loại không hợp lệ' });
  if (!log_date) log_date = new Date().toISOString().slice(0, 10);
  const info = db
    .prepare('INSERT INTO finance (key_id, type, amount, note, log_date) VALUES (?, ?, ?, ?, ?)')
    .run(key_id || null, type, Number(amount) || 0, note || null, log_date);
  res.json(db.prepare('SELECT * FROM finance WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/finance/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM finance WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ============ THỐNG KÊ DASHBOARD ============
app.get('/api/stats', auth, (req, res) => {
  const monthStart = new Date().toISOString().slice(0, 7) + '-01';
  const isAdmin = req.user.role === 'admin';
  const me = req.user.id;

  // Key theo trạng thái
  const keyStatus = { todo: 0, doing: 0 };
  db.prepare('SELECT status, COUNT(*) c FROM keys GROUP BY status').all()
    .forEach((r) => { if (keyStatus[r.status] != null) keyStatus[r.status] = r.c; });
  const totalKeys = Object.values(keyStatus).reduce((a, b) => a + b, 0);
  const keysAssigned = db.prepare('SELECT COUNT(*) c FROM keys WHERE id IN (SELECT DISTINCT key_id FROM key_workers)').get().c;
  const keysUnassigned = totalKeys - keysAssigned;
  const myKeys = db.prepare('SELECT COUNT(DISTINCT key_id) c FROM key_workers WHERE user_id = ?').get(me).c;

  // TikTok — admin xem tất cả, nhân viên chỉ của mình
  const ttScope = isAdmin ? '' : ` WHERE assigned_to = ${me} OR added_by = ${me}`;
  const tt = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(followers),0) f, COALESCE(SUM(likes),0) l, COALESCE(SUM(video_count),0) v, COALESCE(SUM(total_views),0) views FROM tiktok_channels${ttScope}`).get();
  const tiktok = { channels: tt.c, followers: tt.f, likes: tt.l, videos: tt.v, views: tt.views };

  // Kênh TikTok gom theo từng nhân viên (theo thứ tự thêm)
  const chans = db.prepare(`
    SELECT t.id, t.name, t.followers, t.likes, t.video_count, t.total_views, t.country, t.status,
           COALESCE(u.name,'(chưa giao)') AS owner
    FROM tiktok_channels t LEFT JOIN users u ON u.id = t.assigned_to
    ${isAdmin ? '' : `WHERE t.assigned_to = ${me} OR t.added_by = ${me}`}
    ORDER BY t.created_at ASC`).all();
  const map = {};
  chans.forEach((c) => {
    if (!map[c.owner]) map[c.owner] = { owner: c.owner, channelCount: 0, followers: 0, likes: 0, channels: [] };
    map[c.owner].channelCount++;
    map[c.owner].followers += c.followers;
    map[c.owner].likes += c.likes;
    map[c.owner].channels.push(c);
  });
  const tiktokByUser = Object.values(map).sort((a, b) => b.followers - a.followers);

  // Tài chính (chỉ admin)
  let finance = null;
  if (isAdmin) {
    const rev = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM finance WHERE type='revenue' AND log_date >= ?`).get(monthStart).s;
    const cost = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM finance WHERE type='cost' AND log_date >= ?`).get(monthStart).s;
    const revAll = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM finance WHERE type='revenue'`).get().s;
    const costAll = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM finance WHERE type='cost'`).get().s;
    finance = { revenueMonth: rev, costMonth: cost, profitMonth: rev - cost, profitAll: revAll - costAll };
  }

  res.json({ isAdmin, totalKeys, keyStatus, keysUnassigned, keysAssigned, myKeys, tiktok, tiktokByUser, finance });
});

// SPA fallback
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎬 ReupManager đang chạy tại: http://localhost:${PORT}`);
  console.log(`   Trong mạng nội bộ, máy khác vào bằng IP của máy này:${PORT}\n`);
});
