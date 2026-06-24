// app.js — Logic giao diện ReupManager
'use strict';

// ============ STATE & API ============
const State = {
  token: localStorage.getItem('rm_token') || null,
  user: null,
  users: [],
  page: 'dashboard',
};

async function api(path, options = {}) {
  const opts = { cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...options };
  if (State.token) opts.headers.Authorization = 'Bearer ' + State.token;
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch('/api' + path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    if (res.status === 401) { logout(); }
    const err = new Error((data && data.error) || 'Lỗi máy chủ');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ============ HELPERS ============
const $ = (sel) => document.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString('vi-VN');
const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => { if (!d) return ''; const p = d.slice(0, 10).split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
// Thời gian dạng "x phút trước" từ chuỗi UTC của SQLite ('YYYY-MM-DD HH:MM:SS')
const parseUtc = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);
const timeAgo = (s) => {
  const d = parseUtc(s); if (!d || isNaN(d)) return 'chưa bao giờ';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'vừa xong';
  if (sec < 3600) return Math.floor(sec / 60) + ' phút trước';
  if (sec < 86400) return Math.floor(sec / 3600) + ' giờ trước';
  return Math.floor(sec / 86400) + ' ngày trước';
};
const fmtDateTime = (s) => {
  const d = parseUtc(s); if (!d || isNaN(d)) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
// Số gọn: 94500000 -> 94.5M
const fmtCompact = (n) => {
  n = Number(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};
// Tính mức tăng/giảm so với mốc hôm trước (prev). Trả về số chênh lệch hoặc null nếu chưa có mốc.
const deltaOf = (cur, prev) => (prev == null ? null : Number(cur || 0) - Number(prev || 0));
// Huy hiệu tăng/giảm: ▲ xanh / ▼ đỏ / – không đổi. compact=true để rút gọn (1.2K)
function deltaBadge(d, compact) {
  if (d == null) return ''; // chưa có dữ liệu hôm trước để so
  if (d === 0) return '<span class="delta flat">–</span>';
  const fmt = compact ? fmtCompact(Math.abs(d)) : fmtNum(Math.abs(d));
  return d > 0
    ? `<span class="delta up" title="Tăng so với hôm trước">▲ ${fmt}</span>`
    : `<span class="delta down" title="Giảm so với hôm trước">▼ ${fmt}</span>`;
}
// Cờ quốc gia từ mã 2 chữ (VN -> 🇻🇳)
const flag = (cc) => {
  if (!cc || cc.length !== 2) return '🌐';
  return cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
};
// Chuẩn hóa link phía client (khớp với server) để cảnh báo trùng sớm
const normUrl = (u) => String(u || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '')
  .split('?')[0].split('#')[0].replace(/\/+$/, '')
  .replace(/\/(videos|featured|shorts|streams|about|community|playlists)$/, '');
// Xuất CSV và tải về
function exportCsv(filename, headers, rows) {
  const escCsv = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = [headers.map(escCsv).join(','), ...rows.map((r) => r.map(escCsv).join(','))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
const TT_STATUS = {
  active: { label: 'Đang chạy', cls: 'done' },
  building: { label: 'Đang nuôi', cls: 'doing' },
  paused: { label: 'Tạm dừng', cls: 'review' },
  banned: { label: 'Bị band', cls: 'banned' },
};
// Các nước trong chương trình TikTok Creator Rewards
const REWARD_COUNTRIES = [
  ['US', 'Hoa Kỳ'], ['GB', 'Anh'], ['DE', 'Đức'], ['FR', 'Pháp'],
  ['IT', 'Ý'], ['ES', 'Tây Ban Nha'], ['JP', 'Nhật Bản'], ['KR', 'Hàn Quốc'], ['BR', 'Brazil'],
];

let toastTimer;
function toast(msg, type = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

function openModal(title, bodyEl) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  body.appendChild(bodyEl);
  $('#modal-overlay').classList.remove('hidden');
}
function closeModal() { $('#modal-overlay').classList.add('hidden'); }

// Khóa nút "submit" khi đang xử lý (chống bấm nhiều lần -> thêm trùng)
function lockBtn(form) {
  // chấp nhận cả <form> (khóa nút submit) lẫn 1 <button> truyền thẳng vào
  const b = (form && form.tagName === 'BUTTON') ? form : (form && form.querySelector ? form.querySelector('button[type="submit"]') : null);
  if (!b) return () => {};
  b.disabled = true;
  const orig = b.innerHTML;
  b.innerHTML = '⏳ Đang xử lý…';
  return () => { b.disabled = false; b.innerHTML = orig; };
}

const STATUS = {
  todo: { label: 'Chưa làm', icon: '⚪' },
  doing: { label: 'Đang làm', icon: '🔵' },
};
const countryName = (cc) => { const f = REWARD_COUNTRIES.find(([c]) => c === cc); return f ? f[1] : (cc || ''); };
// Sinh màu ổn định theo chuỗi (để phân loại theo màu: chủ đề, nước...)
const hashHue = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const chipStyle = (s) => { const h = hashHue(s); return `background:hsl(${h} 42% 19%);color:hsl(${h} 88% 74%);border:1px solid hsl(${h} 45% 30%)`; };
const QUALITY_CLS = { ngon: 'q-ngon', tot: 'q-tot', thuong: 'q-thuong' };
const QUALITY = { ngon: '🔥 Ngon', tot: '👍 Tốt', thuong: '◽ Thường' };

// ============ AUTH ============
async function doLogin(e) {
  e.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  $('#login-error').textContent = '';
  try {
    const data = await api('/login', { method: 'POST', body: { username, password } });
    State.token = data.token;
    State.user = data.user;
    localStorage.setItem('rm_token', data.token);
    enterApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
}

function logout() {
  if (State.token) { api('/logout', { method: 'POST' }).catch(() => {}); }
  State.token = null; State.user = null;
  localStorage.removeItem('rm_token');
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}

async function enterApp() {
  try {
    const me = await api('/me');
    State.user = me.user;
  } catch (_) { return logout(); }
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  // Thông tin user
  $('#user-name').textContent = State.user.name;
  $('#user-role').textContent = State.user.role === 'admin' ? 'Quản trị viên' : 'Nhân sự';
  $('#user-avatar').textContent = (State.user.name || 'U').charAt(0).toUpperCase();
  buildNav();
  try { State.users = await api('/users'); } catch (_) { State.users = []; }
  const initial = location.hash.replace(/^#/, '');
  if (initial && PAGE_TITLES[initial]) renderPage(initial);
  else navigate('dashboard');
}

// ============ NAVIGATION ============
function buildNav() {
  const isAdmin = State.user.role === 'admin';
  const items = [
    { id: 'dashboard', icon: '📊', label: 'Tổng quan' },
    { id: 'board', icon: '📢', label: 'Sảnh chính' },
    { id: 'keys', icon: '🔑', label: 'Key YouTube' },
    { id: 'tiktok', icon: '📱', label: 'Kênh TikTok' },
    { id: 'growth', icon: '📈', label: 'Tăng trưởng' },
    { id: 'videos', icon: '📊', label: 'Báo cáo' },
  ];
  if (isAdmin) {
    items.push({ id: 'staff', icon: '👥', label: 'Nhân sự' });
    items.push({ id: 'finance', icon: '💰', label: 'Lợi nhuận' });
    items.push({ id: 'activity', icon: '📜', label: 'Lịch sử' });
    items.push({ id: 'trash', icon: '🗑️', label: 'Thùng rác' });
  }
  items.push({ id: 'settings', icon: '⚙️', label: 'Cài đặt' });

  const nav = $('#nav');
  nav.innerHTML = '';
  items.forEach((it) => {
    const a = el(`<a data-page="${it.id}"><span class="nav-icon">${it.icon}</span><span>${it.label}</span></a>`);
    a.onclick = () => navigate(it.id);
    nav.appendChild(a);
  });
}

const PAGE_TITLES = { dashboard: 'Tổng quan', board: 'Sảnh chính', keys: 'Key YouTube', tiktok: 'Kênh TikTok', videos: 'Báo cáo công việc', growth: 'Tăng trưởng kênh', staff: 'Nhân sự', finance: 'Lợi nhuận', activity: 'Lịch sử thao tác', trash: 'Thùng rác', settings: 'Cài đặt' };

// Điều hướng có lưu lịch sử (để nút "quay lại" của chuột/trình duyệt hoạt động)
function navigate(page) {
  if (location.hash === '#' + page) renderPage(page);
  else location.hash = '#' + page; // đổi hash -> sự kiện hashchange -> renderPage
}

const ADMIN_PAGES = ['staff', 'finance', 'activity', 'trash'];
function renderPage(page) {
  if (!PAGE_TITLES[page]) page = 'dashboard';
  // CHẶN nhân viên vào trang dành riêng admin (kể cả khi gõ tay #staff)
  if (ADMIN_PAGES.includes(page) && (!State.user || State.user.role !== 'admin')) {
    page = 'dashboard';
    if (location.hash !== '#dashboard') history.replaceState(null, '', '#dashboard');
  }
  State.page = page;
  $('#page-title').textContent = PAGE_TITLES[page] || '';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  $('#topbar-right').innerHTML = '';
  closeMenu();
  const renderers = { dashboard: renderDashboard, board: renderBoard, keys: renderKeys, tiktok: renderTiktok, growth: renderGrowth, videos: renderVideos, staff: renderStaff, finance: renderFinance, activity: renderActivity, trash: renderTrash, settings: renderSettings };
  (renderers[page] || renderDashboard)();
}

window.addEventListener('hashchange', () => {
  if (State.user) renderPage(location.hash.replace(/^#/, '') || 'dashboard');
});

// ============ DASHBOARD ============
let dashStats = null; // cache số liệu TikTok + tài chính (số liệu key tính trực tiếp từ keysCache)

async function renderDashboard() {
  const view = $('#view');
  // Có cache thì VẼ NGAY (không chớp "đang tải"), rồi mới làm mới ở nền
  if (dashStats && keysCache.length) drawDashboard();
  else view.innerHTML = '<div class="loading">Đang tải dữ liệu…</div>';
  try {
    const [s, keys] = await Promise.all([api('/stats'), api('/keys')]);
    dashStats = s; keysCache = keys;
    if (State.page === 'dashboard') drawDashboard();
  } catch (e) {
    if (!dashStats) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function drawDashboard() {
  const s = dashStats; if (!s) return;
  const view = $('#view');
  const me = State.user.name, meId = String(State.user.id);
  const isWorker = (k) => (k.worker_ids ? String(k.worker_ids).split(',') : []).includes(meId);

  // Số liệu key tính TRỰC TIẾP từ keysCache -> nhận/bỏ làm là đổi số ngay lập tức
  const totalKeys = keysCache.length;
  const unassigned = keysCache.filter((k) => !k.worker_count);
  const qRankD = { ngon: 0, tot: 1, thuong: 2 };
  unassigned.sort((a, b) => (qRankD[a.quality] ?? 3) - (qRankD[b.quality] ?? 3));
  const keysUnassigned = unassigned.length;
  const myKeys = keysCache.filter(isWorker).length;

  let kpis = `
    <div class="kpi clickable" data-go="keys-all"><div class="kpi-icon">🔑</div><div class="kpi-label">Tổng số Key</div><div class="kpi-value">${fmtNum(totalKeys)}</div><div class="kpi-sub">chưa ai làm: ${fmtNum(keysUnassigned)} →</div></div>
    <div class="kpi info clickable" data-go="keys-mine"><div class="kpi-icon">⭐</div><div class="kpi-label">Key của tôi đang làm</div><div class="kpi-value">${fmtNum(myKeys)}</div><div class="kpi-sub">xem key của tôi →</div></div>
    <div class="kpi primary clickable" data-go="tiktok"><div class="kpi-icon">📱</div><div class="kpi-label">${s.isAdmin ? 'Tổng kênh TikTok' : 'Kênh TikTok của tôi'}</div><div class="kpi-value">${fmtNum(s.tiktok.channels)}</div><div class="kpi-sub">mở danh sách →</div></div>`;
  if (s.finance) kpis += `
    <div class="kpi accent clickable" data-go="finance"><div class="kpi-icon">💵</div><div class="kpi-label">Doanh thu tháng</div><div class="kpi-value">${fmtMoney(s.finance.revenueMonth)}</div><div class="kpi-sub">xem chi tiết →</div></div>
    <div class="kpi ${s.finance.profitMonth >= 0 ? 'primary' : 'danger'} clickable" data-go="finance"><div class="kpi-icon">📈</div><div class="kpi-label">Lợi nhuận tháng</div><div class="kpi-value">${fmtMoney(s.finance.profitMonth)}</div><div class="kpi-sub">tổng: ${fmtMoney(s.finance.profitAll)} →</div></div>`;

  // Key đã có người làm — gom theo từng người (ai cũng thấy để khỏi trùng)
  const keysByPerson = {};
  keysCache.forEach((k) => {
    if (!k.worker_count) return;
    (k.worker_names || '').split(', ').filter(Boolean).forEach((n) => { (keysByPerson[n] = keysByPerson[n] || []).push(k); });
  });
  const personNames = Object.keys(keysByPerson).sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
  const claimedHtml = personNames.length ? personNames.map((name) => `
    <div class="user-channels">
      <div class="uc-head"><span class="uc-name">👤 ${esc(name)}${name === me ? ' <span class="me-tag">bạn</span>' : ''}</span><span class="uc-meta">${keysByPerson[name].length} key</span></div>
      ${keysByPerson[name].map((k, i) => `
        <div class="uc-item">
          <span class="uc-num">${i + 1}</span>
          <span class="uc-cn" data-keygo="${k.id}" title="Xem chi tiết" style="cursor:pointer">${esc(k.channel_name)}</span>
          <span class="badge ${k.status}">${(STATUS[k.status] || STATUS.todo).label}</span>
          ${name === me ? `<button class="btn-link" data-dashrelease="${k.id}" title="Bỏ làm key này">↩ bỏ</button>` : ''}
        </div>`).join('')}
    </div>`).join('') : '<div class="empty" style="padding:30px 10px">Chưa ai nhận key nào.</div>';

  const UA_CAP = 80;
  const unassignedHtml = unassigned.length ? `
    ${unassigned.length > 8 ? '<input class="search ua-search" id="ua-search" placeholder="🔍 Tìm nhanh key chưa làm…">' : ''}
    <div class="scroll-list" id="ua-list">
      ${unassigned.slice(0, UA_CAP).map((k) => `
        <div class="ua-item" data-name="${esc((k.channel_name || '').toLowerCase())}">
          <span class="uc-cn">${esc(k.channel_name)}${k.quality ? ' <span class="quality-tag ' + (QUALITY_CLS[k.quality] || '') + '">' + esc(QUALITY[k.quality] || k.quality) + '</span>' : ''}${k.country ? ' <span class="country-tag" style="' + chipStyle(k.country) + '">' + flag(k.country) + '</span>' : ''}</span>
          <button class="btn btn-sm btn-primary" data-claim="${k.id}">✋ Nhận làm</button>
        </div>`).join('')}
    </div>
    ${unassigned.length > UA_CAP ? `<div class="hint">Hiển thị ${UA_CAP} key đầu. <a class="btn-link" data-go="keys-unassigned">Xem tất cả ${unassigned.length} key chưa làm →</a></div>` : ''}`
    : '<div class="empty" style="padding:30px 10px">Mọi key đều đã có người làm 👍</div>';

  // Tóm tắt mỗi nhân viên: số kênh + tổng số liệu + 3 kênh nổi bật + nút mở danh sách đầy đủ
  const byUser = s.tiktokByUser || [];
  const byUserHtml = byUser.length ? `<div class="user-grid">${byUser.map((u) => `
    <div class="user-card">
      <div class="uc-head">
        <span class="uc-name">👤 ${esc(u.owner)}</span>
        <span class="uc-count">${u.channelCount} kênh</span>
      </div>
      <div class="uc-stats">👥 ${fmtCompact(u.followers)} &nbsp;•&nbsp; ❤️ ${fmtCompact(u.likes)} &nbsp;•&nbsp; 🎬 ${fmtCompact(u.videos)}</div>
      <div class="uc-top">
        ${(u.top || []).map((c) => `<div class="uc-item" data-ttgo="${c.id}" title="Xem chi tiết">
          <span class="uc-cn">${esc(c.name)} ${flag(c.country)}</span>
          <span class="uc-stat">${fmtCompact(c.followers)} 👥</span>
        </div>`).join('')}
      </div>
      ${u.channelCount > (u.top || []).length ? `<a class="btn-link uc-more" data-ttuser="${u.ownerId ?? ''}">Xem tất cả ${u.channelCount} kênh →</a>` : ''}
    </div>`).join('')}</div>` : '<div class="empty">Chưa có kênh TikTok nào.</div>';

  view.innerHTML = `
    <div class="kpi-grid">${kpis}</div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">✅ Key đã có người làm</div>
        <div class="scroll-list">${claimedHtml}</div>
      </div>
      <div class="panel">
        <div class="panel-title">⚪ Key chưa ai làm ${unassigned.length ? `<span class="count">${unassigned.length}</span>` : ''}</div>
        ${unassignedHtml}
      </div>
    </div>
    ${s.isAdmin ? `<div class="panel">
      <div class="panel-title">📱 Kênh TikTok theo nhân viên</div>
      ${byUserHtml}
    </div>` : ''}`;

  view.querySelectorAll('[data-go]').forEach((c) => c.onclick = () => {
    const go = c.dataset.go;
    if (go === 'keys-all') { keysOwner = 'all'; keysFilter = 'all'; keysPage = 1; navigate('keys'); }
    else if (go === 'keys-mine') { keysOwner = 'mine'; keysFilter = 'all'; keysPage = 1; navigate('keys'); }
    else if (go === 'keys-unassigned') { keysOwner = 'unassigned'; keysFilter = 'all'; keysPage = 1; navigate('keys'); }
    else if (go === 'tiktok') navigate('tiktok');
    else if (go === 'finance') navigate('finance');
  });
  const uaSearch = $('#ua-search');
  if (uaSearch) uaSearch.oninput = () => {
    const q = uaSearch.value.trim().toLowerCase();
    $('#ua-list').querySelectorAll('.ua-item').forEach((it) => {
      it.style.display = !q || it.dataset.name.includes(q) ? '' : 'none';
    });
  };
  view.querySelectorAll('[data-keygo]').forEach((b) => b.onclick = () => { const k = keysCache.find((x) => x.id == b.dataset.keygo); if (k) keyDetail(k); });
  view.querySelectorAll('[data-ttgo]').forEach((b) => b.onclick = async () => {
    try { if (!tiktokCache.length) tiktokCache = await api('/tiktok'); const t = tiktokCache.find((x) => x.id == b.dataset.ttgo); if (t) tiktokDetail(t); } catch (_) {}
  });
  // Mở trang Kênh TikTok đã lọc sẵn theo nhân viên
  view.querySelectorAll('[data-ttuser]').forEach((b) => b.onclick = () => {
    ttPerson = b.dataset.ttuser || ''; ttSearch = ''; ttCountry = 'all'; navigate('tiktok');
  });
  view.querySelectorAll('[data-claim]').forEach((b) => b.onclick = () => dashClaim(b.dataset.claim, false));
  view.querySelectorAll('[data-dashrelease]').forEach((b) => b.onclick = () => dashClaim(b.dataset.dashrelease, true));
}

// Cập nhật worker của 1 key ngay tại chỗ (dùng chung cho mọi trang)
function mutateClaim(k, release) {
  const meId = String(State.user.id), meName = State.user.name;
  let ids = k.worker_ids ? String(k.worker_ids).split(',').filter(Boolean) : [];
  let names = k.worker_names ? k.worker_names.split(', ').filter(Boolean) : [];
  if (release) {
    const i = ids.indexOf(meId);
    if (i >= 0) { ids.splice(i, 1); const j = names.indexOf(meName); if (j >= 0) names.splice(j, 1); }
    if (ids.length === 0 && k.status === 'doing') k.status = 'todo';
  } else {
    if (!ids.includes(meId)) { ids.push(meId); names.push(meName); }
    if (k.status === 'todo') k.status = 'doing';
  }
  k.worker_ids = ids.join(','); k.worker_names = names.join(', '); k.worker_count = ids.length;
}

// Nhận / bỏ làm TỨC THÌ ở trang Tổng quan
function dashClaim(id, release) {
  const k = keysCache.find((x) => x.id == id); if (!k) return;
  mutateClaim(k, release);
  drawDashboard(); // vẽ lại ngay, không chờ server
  api('/keys/' + id + '/claim', { method: 'POST', body: release ? { release: true } : {} })
    .then((u) => { const i = keysCache.findIndex((x) => x.id == id); if (i >= 0 && u && u.id) keysCache[i] = u; })
    .catch((e) => { toast(e.message, 'err'); renderDashboard(); });
}

// Nhận / bỏ làm TỨC THÌ ở trang Key
function optimisticClaim(id, release) {
  const k = keysCache.find((x) => x.id == id); if (!k) return;
  mutateClaim(k, release);
  drawKeys(); // hiện ngay
  api('/keys/' + id + '/claim', { method: 'POST', body: release ? { release: true } : {} })
    .then((updated) => { const idx = keysCache.findIndex((x) => x.id == id); if (idx >= 0 && updated && updated.id) keysCache[idx] = updated; })
    .catch((e) => { toast(e.message, 'err'); renderKeys(); });
}

// ============ SẢNH CHÍNH (thông báo + hỏi đáp + cảm xúc) ============
let boardLast = null;
const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😎','😘','🤔','😅','😆','😉','🙂','😴','😭','😢','😡','🥳','😮','😱','👍','👎','👌','👏','🙏','💪','🤝','✌️','❤️','🔥','🎉','✨','⭐','💯','🚀','⚡','💡','✅','❌','📌','🎯','💰','📈','🎬','📱','🔑'];
const QUICK_REACTS = ['👍','❤️','😂','🔥','🎉','🙏','😮','💯'];

// Bảng emoji nổi (dùng chung): đặt con trỏ ở field nào thì chèn vào đó
let _emojiAction = null, _emojiOwner = null;
function ensureEmojiPanel() {
  let p = document.getElementById('emoji-panel');
  if (p) return p;
  p = document.createElement('div');
  p.id = 'emoji-panel'; p.className = 'emoji-panel'; p.style.display = 'none';
  p.innerHTML = EMOJIS.map((e) => `<button type="button" class="emoji-pick">${e}</button>`).join('');
  document.body.appendChild(p);
  p.addEventListener('mousedown', (ev) => ev.preventDefault()); // giữ con trỏ ở ô nhập
  p.addEventListener('click', (ev) => { const b = ev.target.closest('.emoji-pick'); if (b && _emojiAction) _emojiAction(b.textContent); });
  document.addEventListener('click', (ev) => {
    if (p.style.display === 'none') return;
    if (ev.target.closest('#emoji-panel') || ev.target.closest('[data-emoji]') || ev.target.closest('[data-reactadd]')) return;
    p.style.display = 'none';
  });
  window.addEventListener('hashchange', () => { p.style.display = 'none'; });
  return p;
}
function insertAtCursor(field, text) {
  const s = field.selectionStart ?? field.value.length, e = field.selectionEnd ?? field.value.length;
  field.value = field.value.slice(0, s) + text + field.value.slice(e);
  const pos = s + text.length; field.focus(); field.setSelectionRange(pos, pos);
}
function openEmoji(btn, action) {
  const p = ensureEmojiPanel();
  if (p.style.display !== 'none' && _emojiOwner === btn) { p.style.display = 'none'; return; }
  _emojiAction = action; _emojiOwner = btn;
  const r = btn.getBoundingClientRect();
  p.style.display = 'grid';
  const w = 280;
  p.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  p.style.top = (r.bottom + 6 + p.offsetHeight > window.innerHeight ? r.top - p.offsetHeight - 6 : r.bottom + 6) + 'px';
}

async function renderBoard() {
  $('#topbar-right').innerHTML = '';
  const view = $('#view');
  if (boardLast) drawBoard(boardLast);
  else view.innerHTML = '<div class="loading">Đang tải sảnh chính…</div>';
  try { const data = await api('/messages'); boardLast = data; if (State.page === 'board') drawBoard(boardLast); }
  catch (e) { if (!boardLast) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function drawBoard(posts) {
  const view = $('#view');
  const isAdmin = State.user.role === 'admin';
  const meId = State.user.id;
  const avatar = (n) => { const h = hashHue(n || '?'); return `<div class="msg-avatar" style="background:linear-gradient(135deg,hsl(${h} 65% 55%),hsl(${(h + 45) % 360} 65% 45%))">${esc((n || '?').charAt(0).toUpperCase())}</div>`; };
  const roleBadge = (role) => role === 'admin' ? '<span class="msg-role admin">📢 Quản trị</span>' : '<span class="msg-role">Nhân sự</span>';

  const reactBar = (m) => {
    const chips = Object.entries(m.reactions || {}).filter(([, c]) => c > 0)
      .map(([emo, c]) => `<button class="react-chip ${(m.myReactions || []).includes(emo) ? 'mine' : ''}" data-react="${m.id}" data-emoji="${emo}">${emo} ${c}</button>`).join('');
    return `<div class="react-bar">${chips}<button class="react-add" data-reactadd="${m.id}" title="Thả cảm xúc">😊<span>+</span></button></div>`;
  };

  const replyHtml = (r) => `<div class="msg-reply">
    ${avatar(r.user_name)}
    <div class="msg-body">
      <div class="msg-head"><b>${esc(r.user_name || '?')}</b> ${roleBadge(r.role)} <span class="msg-time">${timeAgo(r.created_at)}</span>
        ${(isAdmin || r.user_id === meId) ? `<button class="btn-link" data-msgdel="${r.id}">xóa</button>` : ''}</div>
      <div class="msg-content">${esc(r.content)}</div>
      ${reactBar(r)}
    </div></div>`;

  const postHtml = (p) => `<div class="msg-card${p.pinned ? ' pinned' : ''}${p.role === 'admin' ? ' admin' : ''}">
    ${p.pinned ? '<div class="msg-pin">📌 Thông báo đã ghim</div>' : ''}
    <div class="msg-top">${avatar(p.user_name)}
      <div class="msg-body">
        <div class="msg-head"><b>${esc(p.user_name || '?')}</b> ${roleBadge(p.role)} <span class="msg-time">${fmtDateTime(p.created_at)}</span></div>
        <div class="msg-content">${esc(p.content)}</div>
        ${reactBar(p)}
      </div>
    </div>
    <div class="msg-actions">
      <button class="btn-link" data-msgreply="${p.id}">💬 Trả lời${p.replies.length ? ' (' + p.replies.length + ')' : ''}</button>
      ${isAdmin ? `<button class="btn-link" data-msgpin="${p.id}">${p.pinned ? '📌 Bỏ ghim' : '📌 Ghim'}</button>` : ''}
      ${(isAdmin || p.user_id === meId) ? `<button class="btn-link danger" data-msgdel="${p.id}">🗑️ Xóa</button>` : ''}
    </div>
    ${p.replies.length ? `<div class="msg-replies">${p.replies.map(replyHtml).join('')}</div>` : ''}
    <div class="msg-replybox" id="rb-${p.id}" style="display:none">
      <input class="msg-input" id="ri-${p.id}" placeholder="Viết trả lời…" autocomplete="off">
      <button class="emoji-btn" data-emoji="ri-${p.id}" title="Chèn emoji">😊</button>
      <button class="btn btn-sm btn-primary" data-msgsend="${p.id}">Gửi</button>
    </div>
  </div>`;

  view.innerHTML = `
    <div class="panel msg-new">
      <div class="msg-new-head">${isAdmin ? '📢 Đăng thông báo cho cả team' : '✍️ Gửi câu hỏi / thắc mắc cho admin'}</div>
      <div class="msg-compose">
        <textarea id="msg-new" rows="3" placeholder="${isAdmin ? 'Viết thông báo cho cả team…' : 'Viết câu hỏi hoặc thắc mắc của bạn… admin sẽ trả lời ngay tại đây.'}"></textarea>
        <button class="emoji-btn" data-emoji="msg-new" title="Chèn emoji">😊</button>
      </div>
      <div class="form-actions"><button class="btn btn-primary" id="msg-post">📨 Đăng lên sảnh</button></div>
    </div>
    ${posts.length ? `<div class="msg-feed">${posts.map(postHtml).join('')}</div>`
      : '<div class="empty"><div class="empty-icon">📢</div>Chưa có bài nào. Hãy đăng bài đầu tiên!</div>'}`;

  // Nút emoji cho ô soạn + ô trả lời
  view.querySelectorAll('[data-emoji]').forEach((b) => b.onclick = (e) => { e.preventDefault(); const f = $('#' + b.dataset.emoji); if (f) openEmoji(b, (emo) => insertAtCursor(f, emo)); });

  const postBtn = $('#msg-post');
  postBtn.onclick = async () => {
    const content = $('#msg-new').value.trim(); if (!content) return toast('Chưa nhập nội dung', 'err');
    const unlock = lockBtn(postBtn);
    try { await api('/messages', { method: 'POST', body: { content } }); $('#msg-new').value = ''; boardLast = null; renderBoard(); }
    catch (e) { toast(e.message, 'err'); } finally { unlock(); }
  };
  view.querySelectorAll('[data-msgreply]').forEach((b) => b.onclick = () => {
    const box = $('#rb-' + b.dataset.msgreply); if (!box) return;
    box.style.display = box.style.display === 'none' ? 'flex' : 'none';
    if (box.style.display !== 'none') $('#ri-' + b.dataset.msgreply)?.focus();
  });
  const sendReply = async (id, btn) => {
    const inp = $('#ri-' + id); const content = (inp && inp.value.trim()) || ''; if (!content) return;
    const unlock = lockBtn(btn);
    try { await api('/messages', { method: 'POST', body: { content, parent_id: id } }); boardLast = null; renderBoard(); }
    catch (e) { toast(e.message, 'err'); } finally { unlock(); }
  };
  view.querySelectorAll('[data-msgsend]').forEach((b) => b.onclick = () => sendReply(b.dataset.msgsend, b));
  view.querySelectorAll('.msg-input').forEach((inp) => inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sendReply(inp.id.replace('ri-', ''), view.querySelector(`[data-msgsend="${inp.id.replace('ri-', '')}"]`)); } });
  view.querySelectorAll('[data-msgdel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Xóa bài này?')) return;
    try { await api('/messages/' + b.dataset.msgdel, { method: 'DELETE' }); boardLast = null; renderBoard(); } catch (e) { toast(e.message, 'err'); }
  });
  view.querySelectorAll('[data-msgpin]').forEach((b) => b.onclick = async () => {
    try { await api('/messages/' + b.dataset.msgpin + '/pin', { method: 'POST', body: {} }); boardLast = null; renderBoard(); } catch (e) { toast(e.message, 'err'); }
  });
  // Thả cảm xúc: bấm chip để bỏ/thêm, nút 😊+ mở bảng chọn nhanh
  view.querySelectorAll('[data-react]').forEach((b) => b.onclick = () => doReact(b.dataset.react, b.dataset.emoji));
  view.querySelectorAll('[data-reactadd]').forEach((b) => b.onclick = (e) => { e.preventDefault(); openEmoji(b, (emo) => { ensureEmojiPanel().style.display = 'none'; doReact(b.dataset.reactadd, emo); }); });
}

async function doReact(id, emoji) {
  // cập nhật ngay tại chỗ rồi gửi server (mượt)
  const apply = (list) => list && list.forEach((m) => {
    if (m.id == id) toggleReactLocal(m, emoji);
    if (m.replies) m.replies.forEach((r) => { if (r.id == id) toggleReactLocal(r, emoji); });
  });
  apply(boardLast); drawBoard(boardLast);
  try { await api('/messages/' + id + '/react', { method: 'POST', body: { emoji } }); }
  catch (e) { toast(e.message, 'err'); boardLast = null; renderBoard(); }
}
function toggleReactLocal(m, emoji) {
  m.reactions = m.reactions || {}; m.myReactions = m.myReactions || [];
  if (m.myReactions.includes(emoji)) {
    m.myReactions = m.myReactions.filter((x) => x !== emoji);
    m.reactions[emoji] = Math.max(0, (m.reactions[emoji] || 1) - 1);
    if (!m.reactions[emoji]) delete m.reactions[emoji];
  } else {
    m.myReactions.push(emoji);
    m.reactions[emoji] = (m.reactions[emoji] || 0) + 1;
  }
}

// ============ KEYS ============
let keysCache = [];
let keysFilter = 'all';
let keysSearch = '';
let keysOwner = 'all'; // all | mine | unassigned | <userId>
let keysCountry = 'all';
let keysSelected = new Set();
let keysPage = 1;
const PAGE_SIZE = 30;

// Tạo thanh phân trang dùng chung (trả về HTML + hàm gắn sự kiện)
function pagerHtml(page, totalItems, pageSize) {
  const pages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return { html: '', pages: 1 };
  const from = (page - 1) * pageSize + 1, to = Math.min(page * pageSize, totalItems);
  return {
    pages,
    html: `<div class="pager">
      <span class="pager-info">Hiển thị <b>${from}–${to}</b> trong <b>${totalItems}</b></span>
      <div class="pager-btns">
        <button class="btn btn-sm btn-ghost" data-pg="first" ${page <= 1 ? 'disabled' : ''}>« Đầu</button>
        <button class="btn btn-sm btn-ghost" data-pg="prev" ${page <= 1 ? 'disabled' : ''}>‹ Trước</button>
        <span class="pager-cur">Trang ${page}/${pages}</span>
        <button class="btn btn-sm btn-ghost" data-pg="next" ${page >= pages ? 'disabled' : ''}>Sau ›</button>
        <button class="btn btn-sm btn-ghost" data-pg="last" ${page >= pages ? 'disabled' : ''}>Cuối »</button>
      </div>
    </div>`,
  };
}

async function renderKeys() {
  $('#topbar-right').innerHTML = '';
  const expBtn = el('<button class="btn btn-ghost">⬇️ Xuất CSV</button>');
  expBtn.onclick = () => exportCsv('key-youtube.csv',
    ['Chủ đề', 'Nước', 'Tên kênh', 'Link', 'Trạng thái', 'Chất lượng', 'Sub', 'Số video', 'Người làm', 'Người thêm', 'Ngày thêm'],
    keysCache.map((k) => [k.category || '', k.country || '', k.channel_name, k.url, (STATUS[k.status] || {}).label || k.status, QUALITY[k.quality] || k.quality || '', k.subscribers || '', k.video_count || '', k.worker_names || '', k.added_name || '', fmtDate(k.created_at)]));
  const delSelBtn = el('<button id="key-del-sel" class="btn btn-danger" style="display:none">🗑️ Xóa đã chọn (0)</button>');
  delSelBtn.onclick = () => deleteSelectedKeys();
  const bulkBtn = el('<button class="btn btn-ghost">📥 Thêm hàng loạt</button>');
  bulkBtn.onclick = () => bulkKeyForm();
  const addBtn = el('<button class="btn btn-primary">➕ Thêm Key</button>');
  addBtn.onclick = () => keyForm();
  $('#topbar-right').appendChild(delSelBtn);
  $('#topbar-right').appendChild(bulkBtn);
  $('#topbar-right').appendChild(expBtn);
  $('#topbar-right').appendChild(addBtn);

  keysSelected = new Set();
  const view = $('#view');
  // Có cache thì vẽ NGAY rồi làm mới ở nền -> chuyển tab là thấy liền
  if (keysCache.length) drawKeys();
  else view.innerHTML = '<div class="loading">Đang tải danh sách key…</div>';
  try {
    const fresh = await api('/keys');
    keysCache = fresh;
    if (State.page === 'keys') drawKeys();
  } catch (e) { if (!keysCache.length) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function drawKeys() {
  const view = $('#view');
  const counts = { all: keysCache.length, todo: 0, doing: 0 };
  keysCache.forEach((k) => { if (counts[k.status] != null) counts[k.status]++; });

  const tabs = [['all', 'Tất cả'], ['todo', STATUS.todo.label], ['doing', STATUS.doing.label]];
  const tabsHtml = tabs.map(([id, label]) =>
    `<div class="filter-tab ${keysFilter === id ? 'active' : ''}" data-f="${id}">${label}<span class="count">${counts[id]}</span></div>`).join('');

  const keyPersonOptions = State.users.map((u) => `<option value="${u.id}" ${keysOwner === String(u.id) ? 'selected' : ''}>🙋 ${esc(u.name)}</option>`).join('');
  // Danh sách nước có trong key + các nước Rewards
  const usedCountries = [...new Set(keysCache.map((k) => k.country).filter(Boolean))];
  const allCountries = [...new Set([...REWARD_COUNTRIES.map(([c]) => c), ...usedCountries])];
  const countryOptions = allCountries.map((c) => `<option value="${c}" ${keysCountry === c ? 'selected' : ''}>${flag(c)} ${esc(countryName(c) || c)}</option>`).join('');
  const workerIdList = (k) => (k.worker_ids ? String(k.worker_ids).split(',') : []);
  const amWorker = (k) => workerIdList(k).includes(String(State.user.id));
  let list = keysCache.filter((k) => keysFilter === 'all' || k.status === keysFilter);
  if (keysCountry !== 'all') list = list.filter((k) => (k.country || '') === keysCountry);
  if (keysOwner === 'mine') list = list.filter(amWorker);
  else if (keysOwner === 'unassigned') list = list.filter((k) => !k.worker_count);
  else if (/^\d+$/.test(keysOwner)) list = list.filter((k) => workerIdList(k).includes(keysOwner));
  if (keysSearch) {
    const q = keysSearch.toLowerCase();
    list = list.filter((k) => (k.channel_name || '').toLowerCase().includes(q) || (k.url || '').toLowerCase().includes(q));
  }
  // Sắp xếp: key Ngon lên đầu, rồi Tốt, rồi còn lại — để key ngon luôn dễ thấy
  const qRank = { ngon: 0, tot: 1, thuong: 2 };
  list.sort((a, b) => (qRank[a.quality] ?? 3) - (qRank[b.quality] ?? 3));

  // Phân trang (kẹp số trang trước khi dựng thanh điều hướng)
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (keysPage > totalPages) keysPage = totalPages;
  if (keysPage < 1) keysPage = 1;
  const pg = pagerHtml(keysPage, list.length, PAGE_SIZE);
  const pageList = list.slice((keysPage - 1) * PAGE_SIZE, keysPage * PAGE_SIZE);

  const rows = pageList.map((k) => {
    const st = STATUS[k.status] || STATUS.todo;
    const thumb = k.thumbnail ? `<img class="cell-thumb" src="${esc(k.thumbnail)}" onerror="this.style.visibility='hidden'">` : `<div class="cell-thumb"></div>`;
    const subInfo = [];
    if (k.country) subInfo.push(`<span class="country-tag" style="${chipStyle(k.country)}">${flag(k.country)} ${esc(countryName(k.country) || k.country)}</span>`);
    if (k.quality) subInfo.push(`<span class="quality-tag ${QUALITY_CLS[k.quality] || ''}">${esc(QUALITY[k.quality] || k.quality)}</span>`);
    if (k.subscribers) subInfo.push(`<span class="ch-sub-tag">👥 ${esc(k.subscribers)}</span>`);
    return `<tr class="${k.quality === 'ngon' ? 'row-ngon' : ''}">
      <td class="chk-col"><input type="checkbox" class="k-row-chk" value="${k.id}" ${keysSelected.has(k.id) ? 'checked' : ''}></td>
      <td class="cat-cell">${k.category ? `<span class="cat-tag" style="${chipStyle(k.category)}">${esc(k.category)}</span>` : '<span class="muted">—</span>'}</td>
      <td><div class="cell-channel">${thumb}<div>
        <a href="${esc(k.url)}" target="_blank" rel="noopener" title="Bấm mở kênh">${esc(k.channel_name)}</a>
        <div class="cell-sub">${subInfo.join(' ')}</div>
        <div class="cell-url">${esc((k.url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').slice(0, 46))}</div>
      </div></div></td>
      <td><span class="badge ${k.status}">${st.icon} ${st.label}</span></td>
      <td>${amWorker(k)
        ? `<button class="btn-link" data-release="${k.id}">↩ tôi bỏ làm</button>`
        : `<button class="btn btn-sm btn-primary" data-claim="${k.id}">✋ Nhận làm</button>`}${k.worker_count > 0 ? `<div class="workers">👥 ${esc(k.worker_names || '')}</div>` : ''}</td>
      <td class="nowrap cell-sub">${esc(k.added_name || '')}<br>${fmtDate(k.created_at)}</td>
      <td><div class="row-actions">
        <button class="btn-icon" data-info="${k.id}" title="Xem nội dung kênh">👁️</button>
        <button class="btn-icon" data-edit="${k.id}" title="Sửa">✏️</button>
        <button class="btn-icon" data-del="${k.id}" title="Xóa">🗑️</button>
      </div></td>
    </tr>`;
  }).join('');

  view.innerHTML = `
    <div class="toolbar">
      <input class="search" id="key-search" placeholder="🔍 Tìm theo tên kênh hoặc link…" value="${esc(keysSearch)}">
      <select id="key-country">
        <option value="all" ${keysCountry === 'all' ? 'selected' : ''}>🌍 Tất cả nước</option>
        ${countryOptions}
      </select>
      <select id="key-owner">
        <option value="all" ${keysOwner === 'all' ? 'selected' : ''}>👥 Tất cả người</option>
        <option value="mine" ${keysOwner === 'mine' ? 'selected' : ''}>⭐ Key của tôi</option>
        <option value="unassigned" ${keysOwner === 'unassigned' ? 'selected' : ''}>⚪ Chưa ai nhận</option>
        ${keyPersonOptions}
      </select>
    </div>
    <div class="filter-tabs">${tabsHtml}</div>
    ${list.length ? `<div class="table-wrap"><table>
      <thead><tr><th class="chk-col"><input type="checkbox" id="k-checkall" title="Chọn tất cả (trang này)"></th><th class="cat-cell">Chủ đề</th><th>Kênh / Key</th><th>Trạng thái</th><th>Người làm</th><th>Người thêm</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>${pg.html}`
      : '<div class="empty"><div class="empty-icon">🔑</div>Không có key nào khớp bộ lọc.</div>'}`;

  view.querySelectorAll('.filter-tab').forEach((t) => t.onclick = () => { keysFilter = t.dataset.f; keysPage = 1; drawKeys(); });
  $('#key-owner').onchange = (e) => { keysOwner = e.target.value; keysPage = 1; drawKeys(); };
  $('#key-country').onchange = (e) => { keysCountry = e.target.value; keysPage = 1; drawKeys(); };
  const search = $('#key-search');
  search.oninput = () => { keysSearch = search.value; keysPage = 1; const pos = search.selectionStart; drawKeys(); const ns = $('#key-search'); ns.focus(); ns.setSelectionRange(pos, pos); };
  view.querySelectorAll('[data-pg]').forEach((b) => b.onclick = () => {
    const a = b.dataset.pg;
    if (a === 'first') keysPage = 1; else if (a === 'prev') keysPage--; else if (a === 'next') keysPage++; else if (a === 'last') keysPage = pg.pages;
    drawKeys(); window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  view.querySelectorAll('[data-info]').forEach((b) => b.onclick = () => { const k = keysCache.find((x) => x.id == b.dataset.info); keyDetail(k); });
  view.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { const k = keysCache.find((x) => x.id == b.dataset.edit); keyForm(k); });
  view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => delKey(b.dataset.del));
  view.querySelectorAll('[data-claim]').forEach((b) => b.onclick = () => optimisticClaim(b.dataset.claim, false));
  view.querySelectorAll('[data-release]').forEach((b) => b.onclick = () => optimisticClaim(b.dataset.release, true));
  // Checkbox chọn xóa hàng loạt
  view.querySelectorAll('.k-row-chk').forEach((cb) => cb.onchange = () => {
    if (cb.checked) keysSelected.add(+cb.value); else keysSelected.delete(+cb.value);
    updateKeyDelBtn();
  });
  const chkAll = $('#k-checkall');
  if (chkAll) chkAll.onchange = (e) => {
    view.querySelectorAll('.k-row-chk').forEach((cb) => { cb.checked = e.target.checked; if (e.target.checked) keysSelected.add(+cb.value); else keysSelected.delete(+cb.value); });
    updateKeyDelBtn();
  };
  enableRowSelect(view, 'k-row-chk');
  updateKeyDelBtn();
}

function updateKeyDelBtn() {
  const b = $('#key-del-sel'); if (!b) return;
  const n = keysSelected.size;
  b.style.display = n ? '' : 'none';
  b.textContent = `🗑️ Xóa đã chọn (${n})`;
}

async function deleteSelectedKeys() {
  const ids = [...keysSelected];
  if (!ids.length) return;
  if (!confirm(`Xóa ${ids.length} key đã chọn? Hành động không thể hoàn tác.`)) return;
  try { const r = await api('/keys/delete-many', { method: 'POST', body: { ids } }); toast(`Đã xóa ${r.deleted} key`); renderKeys(); }
  catch (e) { toast(e.message, 'err'); }
}

// HTML tóm tắt nội dung kênh (mô tả + sub + video gần đây)
function channelSummaryHtml(d) {
  let rv = d.recent_videos;
  if (typeof rv === 'string') { try { rv = JSON.parse(rv); } catch (_) { rv = []; } }
  rv = Array.isArray(rv) ? rv : [];
  const meta = [];
  if (d.subscribers) meta.push(`👥 ${esc(d.subscribers)} sub`);
  if (d.video_count) meta.push(`🎬 ${esc(d.video_count)} video`);
  const metaHtml = meta.length ? `<div class="ch-meta">${meta.join(' &nbsp;•&nbsp; ')}</div>` : '';
  const descHtml = d.description ? `<div class="ch-desc">${esc(d.description)}</div>` : '';
  const vidHtml = rv.length
    ? `<div class="ch-vids-title">🎞️ Video gần đây:</div><ul class="ch-vids">${rv.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '';
  return metaHtml + descHtml + vidHtml;
}

// Cửa sổ chi tiết 1 key
function keyDetail(k) {
  const st = STATUS[k.status] || STATUS.todo;
  const box = el(`<div>
    <div class="ch-head">
      ${k.thumbnail ? `<img src="${esc(k.thumbnail)}" class="ch-avatar" onerror="this.style.display='none'">` : ''}
      <div>
        <div class="ch-name">${esc(k.channel_name)}</div>
        <div class="cell-sub">${k.category ? `<span class="cat-tag" style="${chipStyle(k.category)}">${esc(k.category)}</span> ` : ''}${k.country ? `<span class="country-tag" style="${chipStyle(k.country)}">${flag(k.country)} ${esc(countryName(k.country) || k.country)}</span> ` : ''}<span class="badge ${k.status}">${st.icon} ${st.label}</span> ${k.quality ? `<span class="quality-tag ${QUALITY_CLS[k.quality] || ''}">${esc(QUALITY[k.quality] || k.quality)}</span>` : ''}</div>
      </div>
    </div>
    ${channelSummaryHtml(k)}
    ${k.note ? `<div class="ch-note"><b>Ghi chú:</b> ${esc(k.note)}</div>` : ''}
    <a href="${esc(k.url)}" target="_blank" rel="noopener" class="btn btn-primary btn-block" style="margin-top:16px">🔗 Mở kênh trên trình duyệt</a>
  </div>`);
  openModal('Thông tin kênh', box);
}

function keyForm(key = null) {
  const isEdit = !!key;
  const form = el(`<form>
    <div class="form-row">
      <label>Chủ đề / Thể loại <span class="req">* bắt buộc</span></label>
      <input id="k-category" placeholder="vd: rap, gym, nấu ăn, gaming…" value="${esc(key?.category || '')}" required>
    </div>
    <div class="form-row">
      <label>Link kênh YouTube ${isEdit ? '' : '(dán link, hệ thống tự lấy tên)'}</label>
      <input id="k-url" placeholder="https://www.youtube.com/@tenkenh" value="${esc(key?.url || '')}" required>
      ${isEdit ? '' : '<div class="hint">Sau khi dán link, bấm "Lấy thông tin" để tự điền tên kênh.</div>'}
      <div id="k-preview"></div>
    </div>
    ${isEdit ? `<div class="form-row"><label>Tên kênh</label><input id="k-name" value="${esc(key.channel_name)}"></div>` : '<input type="hidden" id="k-name">'}
    <div class="form-grid">
      <div class="form-row">
        <label>Trạng thái</label>
        <select id="k-status">
          ${Object.entries(STATUS).map(([v, o]) => `<option value="${v}" ${key && key.status === v ? 'selected' : ''}>${o.icon} ${o.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Quốc gia (nước kiếm tiền) <span class="req">* bắt buộc</span></label>
        <select id="k-country" required>
          <option value="">— chọn nước —</option>
          ${REWARD_COUNTRIES.map(([c, n]) => `<option value="${c}" ${key && key.country === c ? 'selected' : ''}>${flag(c)} ${n} (${c})</option>`).join('')}
          ${key && key.country && !REWARD_COUNTRIES.some(([c]) => c === key.country) ? `<option value="${esc(key.country)}" selected>${flag(key.country)} ${esc(key.country)}</option>` : ''}
        </select>
      </div>
    </div>
    <div class="form-row">
      <label>Chất lượng key</label>
      <select id="k-quality">
        <option value="">— không chọn —</option>
        ${Object.entries(QUALITY).map(([v, l]) => `<option value="${v}" ${key && key.quality === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="form-row">
      <label>Ghi chú (sẽ hiện ngoài danh sách)</label>
      <textarea id="k-note" placeholder="Ghi chú thêm về key này…">${esc(key?.note || '')}</textarea>
    </div>
    <div class="form-actions">
      ${isEdit ? '' : '<button type="button" class="btn btn-ghost" id="k-fetch">🔄 Lấy thông tin</button>'}
      <button type="submit" class="btn btn-primary">${isEdit ? 'Lưu thay đổi' : 'Thêm Key'}</button>
    </div>
  </form>`);

  let previewData = { thumbnail: key?.thumbnail, channel_id: key?.channel_id };

  if (!isEdit) {
    form.querySelector('#k-fetch').onclick = async (ev) => {
      const fb = ev.currentTarget; if (fb.disabled) return;
      const url = form.querySelector('#k-url').value.trim();
      if (!url) return toast('Hãy dán link kênh trước', 'err');
      const pv = form.querySelector('#k-preview');
      fb.disabled = true;
      pv.innerHTML = '<div class="hint">Đang lấy thông tin kênh…</div>';
      try {
        const info = await api('/keys/preview', { method: 'POST', body: { url } });
        if (info.channel_name) {
          form.querySelector('#k-name').value = info.channel_name;
          previewData = info;
          const dupKey = keysCache.find((k) => normUrl(k.url) === normUrl(url) || (info.channel_id && k.channel_id && k.channel_id === info.channel_id));
          const dupWarn = dupKey ? `<div class="dup-warn">⚠️ <b>Key này đã có trong hệ thống!</b><br>"${esc(dupKey.channel_name)}" do <b>${esc(dupKey.added_name || '?')}</b> thêm ngày ${fmtDate(dupKey.created_at)} — trạng thái: ${(STATUS[dupKey.status] || STATUS.todo).label}.<br>Không nên thêm trùng.</div>` : '';
          pv.innerHTML = dupWarn + `<div class="preview-box" style="flex-direction:column;align-items:stretch">
            <div style="display:flex;align-items:center;gap:12px">
              ${info.thumbnail ? `<img src="${esc(info.thumbnail)}">` : ''}
              <div><div class="pv-name">${esc(info.channel_name)}</div><div class="pv-sub text-accent">✓ Đã lấy được thông tin kênh</div></div>
            </div>
            ${channelSummaryHtml(info)}
          </div>`;
        } else {
          pv.innerHTML = '<div class="hint text-danger">Không tự lấy được tên. Bạn vẫn có thể thêm, tên sẽ là link.</div>';
        }
      } catch (e) { pv.innerHTML = `<div class="hint text-danger">${esc(e.message)}</div>`; }
      finally { fb.disabled = false; }
    };
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      url: form.querySelector('#k-url').value.trim(),
      category: form.querySelector('#k-category').value.trim(),
      country: form.querySelector('#k-country').value,
      channel_name: form.querySelector('#k-name').value.trim() || undefined,
      status: form.querySelector('#k-status').value,
      quality: form.querySelector('#k-quality').value,
      note: form.querySelector('#k-note').value.trim(),
    };
    if (!body.category) return toast('Vui lòng nhập chủ đề key', 'err');
    if (!body.url) return toast('Thiếu link kênh', 'err');
    if (!body.country) return toast('Vui lòng chọn quốc gia (nước kiếm tiền)', 'err');
    const unlock = lockBtn(form);
    try {
      if (isEdit) { await api('/keys/' + key.id, { method: 'PUT', body }); toast('Đã cập nhật key'); }
      else {
        body.thumbnail = previewData.thumbnail; body.channel_id = previewData.channel_id;
        body.description = previewData.description; body.subscribers = previewData.subscribers;
        body.video_count = previewData.video_count; body.recent_videos = previewData.recent_videos;
        await api('/keys', { method: 'POST', body }); toast('Đã thêm key mới');
      }
      closeModal();
      renderKeys();
      if (!isEdit) setTimeout(() => { if (State.page === 'keys') renderKeys(); }, 3000);
    } catch (err) {
      if (err.status === 409 && err.data && err.data.key) {
        const k = err.data.key;
        toast(`⚠️ Trùng! "${k.channel_name}" đã được ${k.added_name || 'ai đó'} thêm rồi.`, 'err');
      } else toast(err.message, 'err');
    } finally { unlock(); }
  };

  openModal(isEdit ? 'Sửa Key' : 'Thêm Key mới', form);
}

async function delKey(id) {
  if (!confirm('Xóa key này? Hành động không thể hoàn tác.')) return;
  try { await api('/keys/' + id, { method: 'DELETE' }); toast('Đã xóa key'); renderKeys(); }
  catch (e) { toast(e.message, 'err'); }
}

// Thêm HÀNG LOẠT key YouTube
function bulkKeyForm() {
  const form = el(`<form>
    <div class="form-row">
      <label>Chủ đề / Thể loại chung <span class="req">* bắt buộc</span></label>
      <input id="bk-category" placeholder="vd: nhạc, gym… (áp cho tất cả link)" required>
    </div>
    <div class="form-row">
      <label>Quốc gia chung (áp cho tất cả link) <span class="req">* bắt buộc</span></label>
      <select id="bk-country" required><option value="">— chọn nước —</option>${REWARD_COUNTRIES.map(([c, n]) => `<option value="${c}">${flag(c)} ${n} (${c})</option>`).join('')}</select>
    </div>
    <div class="form-row">
      <label>Dán link kênh YouTube — mỗi dòng 1 link</label>
      <textarea id="bk-urls" rows="8" placeholder="https://youtube.com/@kenh1&#10;https://youtube.com/@kenh2&#10;https://youtube.com/@kenh3"></textarea>
      <div class="hint">Tự bỏ qua link trùng. Tên + thông tin kênh sẽ tự lấy ở nền sau khi thêm.</div>
    </div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">Thêm tất cả</button></div>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = { category: form.querySelector('#bk-category').value.trim(), country: form.querySelector('#bk-country').value, urls: form.querySelector('#bk-urls').value };
    if (!body.category) return toast('Nhập chủ đề chung', 'err');
    if (!body.country) return toast('Vui lòng chọn quốc gia chung', 'err');
    if (!body.urls.trim()) return toast('Dán ít nhất 1 link', 'err');
    const unlock = lockBtn(form);
    try {
      const r = await api('/keys/bulk', { method: 'POST', body });
      toast(`✓ Đã thêm ${r.added} key${r.skipped ? ', bỏ qua ' + r.skipped + ' trùng' : ''}`);
      closeModal(); renderKeys();
      setTimeout(() => { if (State.page === 'keys') renderKeys(); }, 3500);
    } catch (err) { toast(err.message, 'err'); } finally { unlock(); }
  };
  openModal('📥 Thêm hàng loạt Key YouTube', form);
}

// ============ TIKTOK ============
let tiktokCache = [];
let ttSearch = '';
let ttSort = 'recent';
let ttPerson = '';
let ttCountry = 'all';
let ttSelected = new Set();
let ttCollapsed = null;        // Set mã nước đang thu gọn (null = chưa khởi tạo)
let ttFullGroups = new Set();  // nhóm đã bấm "xem thêm" để hiện hết
const TT_GROUP_CAP = 50;       // mỗi nhóm nước hiện tối đa bao nhiêu kênh trước khi "xem thêm"

// Huy hiệu tình trạng kiếm tiền
function monetizeChips(t) {
  const items = [[t.monetized, '💰', 'Kiếm tiền'], [t.paypal_added, '💳', 'Paypal'], [t.verified, '🪪', 'XMDT']];
  return '<div class="mz-chips">' + items.map(([on, ic, label]) =>
    `<span class="mz ${on ? 'on' : 'off'}" title="${label}">${ic} ${label}${on ? ' ✓' : ' ✕'}</span>`).join('') + '</div>';
}

async function renderTiktok() {
  $('#topbar-right').innerHTML = '';
  const expBtn = el('<button class="btn btn-ghost">⬇️ Xuất CSV</button>');
  expBtn.onclick = () => exportCsv('kenh-tiktok.csv',
    ['Tên', 'TikTok ID', 'Link', 'Quốc gia', 'Follow', 'Follow +/- hôm nay', 'Tym', 'Video', 'Video mới hôm nay', 'Kiếm tiền', 'Paypal', 'XMDT', 'Trạng thái', 'Key nguồn', 'Giao cho'],
    tiktokCache.map((t) => { const df = deltaOf(t.followers, t.prev_followers), dv = deltaOf(t.video_count, t.prev_videos);
      return [t.name, t.tiktok_id || '', t.url, t.country || '', t.followers, df == null ? '' : df, t.likes, t.video_count, dv == null ? '' : dv, t.monetized ? 'Có' : 'Chưa', t.paypal_added ? 'Có' : 'Chưa', t.verified ? 'Có' : 'Chưa', (TT_STATUS[t.status] || {}).label || t.status, t.source_key_name || '', t.assigned_name || '']; }));
  const addBtn = el('<button class="btn btn-primary">➕ Thêm kênh</button>');
  addBtn.onclick = () => tiktokForm();
  const delSelBtn = el('<button id="tt-del-sel" class="btn btn-danger" style="display:none">🗑️ Xóa đã chọn (0)</button>');
  delSelBtn.onclick = () => deleteSelectedTiktok();
  $('#topbar-right').appendChild(delSelBtn);
  const bulkBtn = el('<button class="btn btn-ghost">📥 Thêm hàng loạt</button>');
  bulkBtn.onclick = () => bulkTiktokForm();
  const syncBtn = el(`<button class="btn btn-ghost">🔄 ${State.user.role === 'admin' ? 'Cập nhật tất cả' : 'Cập nhật kênh của tôi'}</button>`);
  syncBtn.onclick = async () => {
    if (syncBtn.disabled) return;
    syncBtn.disabled = true;
    try {
      await api('/tiktok/sync-all', { method: 'POST', body: {} });
      toast('⏳ Đang cập nhật số liệu…');
      pollSyncAndRefresh(syncBtn);
    } catch (e) { toast(e.message, 'err'); syncBtn.disabled = false; }
  };
  $('#topbar-right').appendChild(syncBtn);
  $('#topbar-right').appendChild(bulkBtn);
  $('#topbar-right').appendChild(expBtn);
  $('#topbar-right').appendChild(addBtn);

  const view = $('#view');
  ttSelected = new Set();
  // Có cache thì vẽ NGAY rồi làm mới ở nền
  if (tiktokCache.length) drawTiktok();
  else view.innerHTML = '<div class="loading">Đang tải kênh TikTok…</div>';
  try {
    const fresh = await api('/tiktok');
    tiktokCache = fresh;
    if (State.page === 'tiktok') drawTiktok();
    if (!keysCache.length) { keysCache = await api('/keys'); } // cho ô chọn key nguồn
  } catch (e) { if (!tiktokCache.length) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function drawTiktok() {
  const view = $('#view');
  const isAdmin = State.user.role === 'admin';
  let list = [...tiktokCache];
  if (ttSearch) {
    const q = ttSearch.toLowerCase();
    list = list.filter((t) => (t.name || '').toLowerCase().includes(q) || (t.tiktok_id || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q));
  }
  if (ttPerson) list = list.filter((t) => String(t.assigned_to) === String(ttPerson));
  if (ttCountry !== 'all') list = list.filter((t) => (t.country || '') === (ttCountry === '__none' ? '' : ttCountry));
  if (ttSort === 'follow') list.sort((a, b) => b.followers - a.followers);
  else if (ttSort === 'likes') list.sort((a, b) => b.likes - a.likes);
  else if (ttSort === 'video') list.sort((a, b) => b.video_count - a.video_count);

  const personOptions = State.users.map((u) => `<option value="${u.id}" ${String(ttPerson) === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  const ttCountryName = (cc) => { const f = REWARD_COUNTRIES.find(([c]) => c === cc); return f ? f[1] : (cc || 'Chưa đặt nước'); };
  const usedTtCountries = [...new Set(tiktokCache.map((t) => t.country).filter(Boolean))];
  const ttCountryOpts = [...new Set([...REWARD_COUNTRIES.map(([c]) => c), ...usedTtCountries])]
    .map((c) => `<option value="${c}" ${ttCountry === c ? 'selected' : ''}>${flag(c)} ${esc(ttCountryName(c))}</option>`).join('');
  const countryName = ttCountryName;

  const rowHtml = (t, idx) => {
    const st = TT_STATUS[t.status] || TT_STATUS.active;
    const av = t.avatar ? `<img class="cell-thumb" src="${esc(t.avatar)}" onerror="this.style.visibility='hidden'">` : '<div class="cell-thumb"></div>';
    return `<tr>
      <td class="chk-col"><input type="checkbox" class="tt-row-chk" value="${t.id}" ${ttSelected.has(t.id) ? 'checked' : ''}></td>
      <td class="stt">${idx + 1}</td>
      <td><div class="cell-channel">${av}<div>
        <a href="${esc(t.url)}" target="_blank" rel="noopener" title="Bấm mở kênh">${esc(t.name)}</a>
        <div class="cell-sub">${t.tiktok_id ? '@' + esc(t.tiktok_id) : ''}</div>
        <div class="cell-url">${esc((t.url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').slice(0, 42))}</div>
        ${t.note ? `<div class="cell-note">📝 ${esc(t.note)}</div>` : ''}
        ${monetizeChips(t)}
      </div></div></td>
      <td><b class="text-accent">${fmtCompact(t.followers)}</b>${deltaBadge(deltaOf(t.followers, t.prev_followers), true)}</td>
      <td><b class="text-danger">${fmtCompact(t.likes)}</b>${deltaBadge(deltaOf(t.likes, t.prev_likes), true)}</td>
      <td>${fmtNum(t.video_count)}${deltaBadge(deltaOf(t.video_count, t.prev_videos), false)}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td class="nowrap cell-sub">${t.source_key_name ? esc(t.source_key_name) : '<span class="muted">—</span>'}</td>
      <td class="nowrap">${t.assigned_name ? esc(t.assigned_name) : '<span class="muted">—</span>'}</td>
      <td class="nowrap cell-sub">${fmtDateTime(t.created_at)}</td>
      <td><div class="row-actions">
        <button class="btn-icon" data-ttsync="${t.id}" title="Cập nhật số liệu">🔄</button>
        <button class="btn-icon" data-ttinfo="${t.id}" title="Chi tiết">👁️</button>
        <button class="btn-icon" data-ttedit="${t.id}" title="Sửa">✏️</button>
        <button class="btn-icon" data-ttdel="${t.id}" title="Xóa">🗑️</button>
      </div></td>
    </tr>`;
  };
  const thead = `<thead><tr><th class="chk-col"></th><th>#</th><th>Kênh TikTok</th><th>Follow</th><th>Tym</th><th>Video</th><th>Trạng thái</th><th>Key nguồn</th><th>Giao cho</th><th>Ngày thêm</th><th></th></tr></thead>`;

  // Gom kênh theo quốc gia
  const groups = {};
  list.forEach((t) => { const k = t.country || ''; (groups[k] = groups[k] || []).push(t); });
  const groupKeys = Object.keys(groups).sort((a, b) => (!a ? 1 : !b ? -1 : groups[b].length - groups[a].length));

  // Lần đầu: nếu nhiều kênh thì thu gọn sẵn các nhóm cho gọn gàng
  if (ttCollapsed === null) ttCollapsed = new Set(list.length > 80 ? groupKeys : []);
  // Khi đang tìm kiếm / lọc 1 nước cụ thể thì luôn mở để thấy kết quả
  const forceExpand = ttCountry !== 'all' || !!ttSearch;

  const groupedHtml = groupKeys.map((cc) => {
    const items = groups[cc];
    const gf = items.reduce((a, b) => a + b.followers, 0);
    const gl = items.reduce((a, b) => a + b.likes, 0);
    const collapsed = !forceExpand && ttCollapsed.has(cc);
    const showAll = forceExpand || ttFullGroups.has(cc) || items.length <= TT_GROUP_CAP;
    const shown = showAll ? items : items.slice(0, TT_GROUP_CAP);
    const moreBtn = (!collapsed && !showAll)
      ? `<div class="grp-more"><button class="btn btn-sm btn-ghost" data-grpmore="${esc(cc)}">▾ Xem thêm ${items.length - TT_GROUP_CAP} kênh</button></div>` : '';
    return `<div class="country-group${collapsed ? ' is-collapsed' : ''}">
      <div class="country-head" data-grptoggle="${esc(cc)}">
        <span class="grp-caret">${collapsed ? '▸' : '▾'}</span>
        <input type="checkbox" class="tt-grp-check" title="Chọn cả nhóm này">
        <span class="country-flag">${flag(cc)}</span>
        <span class="country-name">${esc(countryName(cc))}</span>
        <span class="country-count">${items.length} kênh</span>
        <span class="spacer"></span>
        <span class="country-stat">👥 ${fmtCompact(gf)}</span>
        <span class="country-stat">❤️ ${fmtCompact(gl)}</span>
      </div>
      ${collapsed ? '' : `<div class="table-wrap country-table"><table>${thead}<tbody>${shown.map((t, i) => rowHtml(t, i)).join('')}</tbody></table></div>${moreBtn}`}
    </div>`;
  }).join('');

  // Nút gập/mở tất cả (chỉ hữu ích khi có nhiều nhóm)
  const allCollapsed = groupKeys.length > 0 && groupKeys.every((cc) => ttCollapsed.has(cc));
  const collapseBar = (!forceExpand && groupKeys.length > 1)
    ? `<div class="collapse-bar"><button class="btn btn-sm btn-ghost" id="tt-toggle-all">${allCollapsed ? '▾ Mở tất cả nhóm' : '▸ Thu gọn tất cả nhóm'}</button><span class="muted">${list.length} kênh • ${groupKeys.length} nước</span></div>`
    : '';

  // Thanh nhắc: cột ▲/▼ là tăng/giảm của TỪNG kênh so với hôm trước; xem chi tiết ở trang Tăng trưởng
  const growthBar = `<div class="growth-bar">
    <span class="gb-title">📈 Cột "Follow/Video" có ▲/▼ là mức tăng/giảm <b>từng kênh</b> so với hôm trước.</span>
    <a class="btn btn-sm btn-ghost" data-gogrowth2="1">Xem tốc độ phát triển từng kênh →</a>
  </div>`;

  view.innerHTML = `
    <div class="toolbar">
      <input class="search" id="tt-search" placeholder="🔍 Tìm kênh TikTok…" value="${esc(ttSearch)}">
      <select id="tt-country">
        <option value="all" ${ttCountry === 'all' ? 'selected' : ''}>🌍 Tất cả nước</option>
        ${ttCountryOpts}
        <option value="__none" ${ttCountry === '__none' ? 'selected' : ''}>❓ Chưa đặt nước</option>
      </select>
      <select id="tt-sort">
        <option value="recent" ${ttSort === 'recent' ? 'selected' : ''}>↕ Mới thêm</option>
        <option value="follow" ${ttSort === 'follow' ? 'selected' : ''}>👥 Follow cao nhất</option>
        <option value="video" ${ttSort === 'video' ? 'selected' : ''}>🎬 Video nhiều nhất</option>
        <option value="likes" ${ttSort === 'likes' ? 'selected' : ''}>❤️ Tym cao nhất</option>
      </select>
      ${isAdmin ? `<select id="tt-person"><option value="">👥 Tất cả người</option>${personOptions}</select>` : ''}
    </div>
    ${list.length ? growthBar + collapseBar + groupedHtml
      : '<div class="empty"><div class="empty-icon">📱</div>Chưa có kênh nào khớp bộ lọc.</div>'}`;

  const search = $('#tt-search');
  search.oninput = () => { ttSearch = search.value; const p = search.selectionStart; drawTiktok(); const ns = $('#tt-search'); ns.focus(); ns.setSelectionRange(p, p); };
  $('#tt-sort').onchange = (e) => { ttSort = e.target.value; drawTiktok(); };
  $('#tt-country').onchange = (e) => { ttCountry = e.target.value; drawTiktok(); };
  if ($('#tt-person')) $('#tt-person').onchange = (e) => { ttPerson = e.target.value; drawTiktok(); };
  // Gập / mở từng nhóm nước
  view.querySelectorAll('[data-grptoggle]').forEach((h) => h.onclick = (e) => {
    if (e.target.closest('input, .tt-grp-check')) return; // bấm ô tick thì không gập
    const cc = h.dataset.grptoggle;
    if (ttCollapsed.has(cc)) ttCollapsed.delete(cc); else ttCollapsed.add(cc);
    drawTiktok();
  });
  view.querySelectorAll('[data-grpmore]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); ttFullGroups.add(b.dataset.grpmore); drawTiktok(); });
  const goG2 = view.querySelector('[data-gogrowth2]'); if (goG2) goG2.onclick = () => navigate('growth');
  const togAll = $('#tt-toggle-all');
  if (togAll) togAll.onclick = () => {
    const everyCollapsed = groupKeys.every((cc) => ttCollapsed.has(cc));
    if (everyCollapsed) ttCollapsed.clear(); else groupKeys.forEach((cc) => ttCollapsed.add(cc));
    drawTiktok();
  };
  view.querySelectorAll('[data-ttsync]').forEach((b) => b.onclick = () => syncTiktok(b.dataset.ttsync));
  view.querySelectorAll('[data-ttinfo]').forEach((b) => b.onclick = () => { const t = tiktokCache.find((x) => x.id == b.dataset.ttinfo); tiktokDetail(t); });
  view.querySelectorAll('[data-ttedit]').forEach((b) => b.onclick = () => { const t = tiktokCache.find((x) => x.id == b.dataset.ttedit); tiktokForm(t); });
  view.querySelectorAll('[data-ttdel]').forEach((b) => b.onclick = () => delTiktok(b.dataset.ttdel));
  // Checkbox chọn xóa hàng loạt
  view.querySelectorAll('.tt-row-chk').forEach((cb) => cb.onchange = () => {
    if (cb.checked) ttSelected.add(+cb.value); else ttSelected.delete(+cb.value);
    updateTtDelBtn();
  });
  view.querySelectorAll('.tt-grp-check').forEach((cb) => cb.onchange = () => {
    const grp = cb.closest('.country-group');
    grp.querySelectorAll('.tt-row-chk').forEach((rc) => { rc.checked = cb.checked; if (cb.checked) ttSelected.add(+rc.value); else ttSelected.delete(+rc.value); });
    updateTtDelBtn();
  });
  view.querySelectorAll('.country-group').forEach((g) => enableRowSelect(g, 'tt-row-chk'));
  updateTtDelBtn();
}

function updateTtDelBtn() {
  const b = $('#tt-del-sel'); if (!b) return;
  const n = ttSelected.size;
  b.style.display = n ? '' : 'none';
  b.textContent = `🗑️ Xóa đã chọn (${n})`;
}

async function deleteSelectedTiktok() {
  const ids = [...ttSelected];
  if (!ids.length) return;
  if (!confirm(`Xóa ${ids.length} kênh TikTok đã chọn? Hành động không thể hoàn tác.`)) return;
  try { const r = await api('/tiktok/delete-many', { method: 'POST', body: { ids } }); toast(`Đã xóa ${r.deleted} kênh`); renderTiktok(); }
  catch (e) { toast(e.message, 'err'); }
}

// Theo dõi tiến trình "Cập nhật tất cả" và tự làm mới khi xong
let syncPollTimer = null;
function pollSyncAndRefresh(btn) {
  clearInterval(syncPollTimer);
  let everRan = false, ticks = 0;
  syncPollTimer = setInterval(async () => {
    ticks++;
    let s;
    try { s = await api('/tiktok/sync-status'); } catch (_) { return; }
    if (s.running) { everRan = true; if (btn) btn.textContent = `⏳ Đang cập nhật ${s.ok}/${s.total}…`; }
    if ((!s.running && (everRan || ticks >= 2)) || ticks > 80) {
      clearInterval(syncPollTimer);
      if (State.page === 'tiktok') { toast('✓ Đã cập nhật xong số liệu'); renderTiktok(); }
    }
  }, 2500);
}

// Chọn dòng để xóa: bấm vào dòng để chọn, GIỮ SHIFT bấm để chọn cả dải
function enableRowSelect(scope, chkClass) {
  const rows = [...scope.querySelectorAll('tbody tr')];
  let anchor = null;
  rows.forEach((tr, idx) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input, label, .row-actions')) return;
      const cb = tr.querySelector('.' + chkClass); if (!cb) return;
      if (e.shiftKey && anchor != null) {
        const [lo, hi] = anchor < idx ? [anchor, idx] : [idx, anchor];
        for (let i = lo; i <= hi; i++) { const c = rows[i].querySelector('.' + chkClass); if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change')); } }
        if (window.getSelection) window.getSelection().removeAllRanges();
      } else {
        cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); anchor = idx;
      }
    });
    tr.classList.add('selectable-row');
  });
}

function tiktokForm(ch = null) {
  const isEdit = !!ch;
  const isAdmin = State.user.role === 'admin';
  const curCountry = ch?.country || '';
  let countryOpts = '<option value="">— chọn nước —</option>' +
    REWARD_COUNTRIES.map(([c, n]) => `<option value="${c}" ${curCountry === c ? 'selected' : ''}>${flag(c)} ${n} (${c})</option>`).join('');
  if (curCountry && !REWARD_COUNTRIES.some(([c]) => c === curCountry))
    countryOpts += `<option value="${esc(curCountry)}" selected>${flag(curCountry)} ${esc(curCountry)} (ngoài Rewards)</option>`;
  const keyDatalist = keysCache.map((k) => `<option value="${esc(k.channel_name)}"></option>`).join('');
  const statusOptions = Object.entries(TT_STATUS).map(([v, o]) => `<option value="${v}" ${ch && ch.status === v ? 'selected' : ''}>${o.label}</option>`).join('');
  const staffOptions = State.users.map((u) => `<option value="${u.id}" ${ch && ch.assigned_to == u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  const form = el(`<form>
    <div class="form-row">
      <label>Link kênh TikTok ${isEdit ? '' : 'hoặc ID kênh'}</label>
      <input id="tt-url" placeholder="dán link, hoặc gõ ID: @tenkenh" value="${esc(ch?.url || '')}" required>
      ${isEdit ? '' : '<div class="hint">Dán link đầy đủ, hoặc chỉ cần gõ ID kênh (vd: <b>@tenkenh</b>) rồi bấm "Lấy thông tin".</div>'}
      <div id="tt-preview"></div>
    </div>
    ${isEdit ? `<div class="form-row"><label>Tên kênh</label><input id="tt-name" value="${esc(ch.name || '')}"></div>` : ''}
    <div class="form-grid">
      <div class="form-row"><label>Quốc gia (Creator Rewards) <span class="req">* bắt buộc</span></label><select id="tt-country" required>${countryOpts}</select></div>
      <div class="form-row"><label>Trạng thái</label><select id="tt-status">${statusOptions}</select></div>
    </div>
    <div class="form-row">
      <label>Key YouTube nguồn (gõ vài chữ để tìm)</label>
      <input id="tt-key-input" list="tt-key-list" placeholder="— gõ tên key để tìm —" value="${esc(ch?.source_key_name || '')}" autocomplete="off">
      <datalist id="tt-key-list">${keyDatalist}</datalist>
      <input type="hidden" id="tt-key" value="${ch?.source_key_id || ''}">
      <div class="hint">1 key YouTube gắn được cho nhiều kênh TikTok (reup nhiều kênh cùng nội dung).</div>
    </div>
    ${isAdmin ? `<div class="form-row"><label>Giao cho nhân viên</label><select id="tt-assign"><option value="">— của tôi —</option>${staffOptions}</select></div>` : ''}
    <div class="form-row">
      <label>Tình trạng kiếm tiền</label>
      <div class="check-group">
        <label class="check"><input type="checkbox" id="tt-monetized" ${ch?.monetized ? 'checked' : ''}> 💰 Đã bật kiếm tiền</label>
        <label class="check"><input type="checkbox" id="tt-paypal" ${ch?.paypal_added ? 'checked' : ''}> 💳 Đã thêm Paypal</label>
        <label class="check"><input type="checkbox" id="tt-verified" ${ch?.verified ? 'checked' : ''}> 🪪 Đã xác minh danh tính (XMDT)</label>
      </div>
    </div>
    <div class="form-row"><label>Ghi chú (sẽ hiện ngoài danh sách)</label><textarea id="tt-note">${esc(ch?.note || '')}</textarea></div>
    <div class="form-actions">
      ${isEdit ? '' : '<button type="button" class="btn btn-ghost" id="tt-fetch">🔄 Lấy thông tin</button>'}
      <button type="submit" class="btn btn-primary">${isEdit ? 'Lưu thay đổi' : 'Thêm kênh'}</button>
    </div>
  </form>`);

  // Gõ tên key -> map sang id
  const keyInput = form.querySelector('#tt-key-input');
  keyInput.oninput = () => {
    const k = keysCache.find((x) => x.channel_name === keyInput.value);
    form.querySelector('#tt-key').value = k ? k.id : '';
  };

  let pdata = {};
  if (!isEdit) {
    form.querySelector('#tt-fetch').onclick = async (ev) => {
      const fb = ev.currentTarget; if (fb.disabled) return;
      const url = form.querySelector('#tt-url').value.trim();
      if (!url) return toast('Dán link TikTok trước', 'err');
      const pv = form.querySelector('#tt-preview');
      fb.disabled = true;
      pv.innerHTML = '<div class="hint">Đang lấy thông tin kênh…</div>';
      try {
        const info = await api('/tiktok/preview', { method: 'POST', body: { url } });
        pdata = info;
        if (info.url) form.querySelector('#tt-url').value = info.url;
        if (info.name) { const ne = form.querySelector('#tt-name'); if (ne) ne.value = info.name; }
        if (info.country) {
          const sel = form.querySelector('#tt-country');
          if (![...sel.options].some((o) => o.value === info.country))
            sel.insertAdjacentHTML('beforeend', `<option value="${esc(info.country)}">${flag(info.country)} ${esc(info.country)} (ngoài Rewards)</option>`);
          sel.value = info.country;
        }
        const dupWarn = info.duplicate ? `<div class="dup-warn">⚠️ <b>Kênh này đã có!</b> "${esc(info.duplicate.name)}" do ${esc(info.duplicate.added_name || '?')} thêm. Không nên thêm trùng.</div>` : '';
        const gotStats = info.followers || info.likes || info.video_count;
        if (info.name || gotStats) {
          pv.innerHTML = dupWarn + `<div class="preview-box" style="flex-direction:column;align-items:stretch">
            <div style="display:flex;align-items:center;gap:12px">
              ${info.avatar ? `<img src="${esc(info.avatar)}">` : ''}
              <div><div class="pv-name">${esc(info.name || '')} ${flag(info.country)}</div><div class="pv-sub text-accent">✓ Đã lấy được thông tin</div></div>
            </div>
            <div class="ch-meta">👥 ${fmtCompact(info.followers)} follow &nbsp;•&nbsp; ❤️ ${fmtCompact(info.likes)} tym &nbsp;•&nbsp; 🎬 ${fmtNum(info.video_count)} video</div>
            ${!gotStats ? '<div class="hint text-danger">Lấy được tên nhưng chưa lấy được số (TikTok chặn tạm). Cứ bấm "Thêm kênh", hệ thống sẽ tự lấy lại sau.</div>' : ''}
            ${info.bio ? `<div class="ch-desc">${esc(info.bio)}</div>` : ''}
          </div>`;
        } else {
          pv.innerHTML = dupWarn + '<div class="dup-warn">⚠️ Chưa lấy được dữ liệu (TikTok chặn tạm). Bạn cứ điền Tên + chọn nước rồi bấm "Thêm kênh" — hệ thống sẽ tự lấy số liệu lại sau.</div>';
        }
      } catch (e) { pv.innerHTML = `<div class="hint text-danger">${esc(e.message)}</div>`; }
      finally { fb.disabled = false; }
    };
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const assignEl = form.querySelector('#tt-assign');
    const nameEl = form.querySelector('#tt-name');
    const body = {
      url: form.querySelector('#tt-url').value.trim(),
      name: (nameEl ? nameEl.value.trim() : pdata.name) || undefined,
      country: form.querySelector('#tt-country').value,
      status: form.querySelector('#tt-status').value,
      source_key_id: form.querySelector('#tt-key').value || null,
      assigned_to: assignEl ? (assignEl.value || null) : null,
      monetized: form.querySelector('#tt-monetized').checked,
      paypal_added: form.querySelector('#tt-paypal').checked,
      verified: form.querySelector('#tt-verified').checked,
      note: form.querySelector('#tt-note').value.trim(),
    };
    if (!body.url) return toast('Thiếu link/ID kênh', 'err');
    if (!body.country) return toast('Vui lòng chọn quốc gia (Creator Rewards)', 'err');
    const unlock = lockBtn(form);
    try {
      if (isEdit) { await api('/tiktok/' + ch.id, { method: 'PUT', body }); toast('Đã cập nhật'); }
      else {
        // Số liệu lấy tự động từ tikwm (qua preview hoặc server tự lấy khi thêm)
        body.avatar = pdata.avatar; body.bio = pdata.bio; body.tiktok_id = pdata.tiktok_id;
        body.followers = pdata.followers; body.likes = pdata.likes; body.video_count = pdata.video_count;
        await api('/tiktok', { method: 'POST', body }); toast('Đã thêm kênh TikTok');
      }
      closeModal(); renderTiktok();
      if (!isEdit) setTimeout(() => { if (State.page === 'tiktok') renderTiktok(); }, 3500);
    } catch (err) {
      if (err.status === 409 && err.data && err.data.channel) {
        const c = err.data.channel;
        toast(`⚠️ Trùng! "${c.name}" đã được ${c.added_name || 'ai đó'} thêm rồi.`, 'err');
      } else toast(err.message, 'err');
    } finally { unlock(); }
  };
  openModal(isEdit ? 'Sửa kênh TikTok' : 'Thêm kênh TikTok', form);
}

function tiktokDetail(t) {
  const st = TT_STATUS[t.status] || TT_STATUS.active;
  const box = el(`<div>
    <div class="ch-head">
      ${t.avatar ? `<img src="${esc(t.avatar)}" class="ch-avatar" onerror="this.style.display='none'">` : ''}
      <div>
        <div class="ch-name">${esc(t.name)} ${flag(t.country)}</div>
        <div class="cell-sub">${t.tiktok_id ? '@' + esc(t.tiktok_id) + ' ' : ''}<span class="badge ${st.cls}">${st.label}</span></div>
      </div>
    </div>
    <div class="tt-stats">
      <div class="tt-stat"><div class="tt-stat-val text-accent">${fmtCompact(t.followers)}</div><div class="tt-stat-lbl">Follow</div></div>
      <div class="tt-stat"><div class="tt-stat-val text-danger">${fmtCompact(t.likes)}</div><div class="tt-stat-lbl">Tym</div></div>
      <div class="tt-stat"><div class="tt-stat-val">${fmtNum(t.video_count)}</div><div class="tt-stat-lbl">Video</div></div>
    </div>
    ${t.bio ? `<div class="ch-desc">${esc(t.bio)}</div>` : ''}
    <div style="margin-top:12px">${monetizeChips(t)}</div>
    <div class="ch-note">
      ${t.source_key_name ? `<div>🔑 Key nguồn: <b>${esc(t.source_key_name)}</b></div>` : ''}
      ${t.assigned_name ? `<div>👤 Giao cho: <b>${esc(t.assigned_name)}</b></div>` : ''}
      <div class="cell-sub">🕒 Thêm lúc: ${fmtDateTime(t.created_at)}</div>
      ${t.last_synced ? `<div class="cell-sub">Cập nhật số liệu lần cuối: ${fmtDate(t.last_synced)}</div>` : ''}
    </div>
    ${t.note ? `<div class="ch-note">📝 ${esc(t.note)}</div>` : ''}
    <div id="tt-growth" class="growth-box"><div class="hint">Đang tải biểu đồ tăng trưởng…</div></div>
    <a href="${esc(t.url)}" target="_blank" rel="noopener" class="btn btn-primary btn-block" style="margin-top:14px">📱 Mở kênh TikTok</a>
  </div>`);
  openModal('Thông tin kênh TikTok', box);
  loadGrowth(t.id);
}

async function loadGrowth(id) {
  const box = document.getElementById('tt-growth');
  if (!box) return;
  try {
    const data = await api('/tiktok/' + id + '/growth');
    if (!data || data.length < 2) {
      box.innerHTML = '<div class="hint">📈 <b>Tăng trưởng:</b> bấm nút 🔄 cập nhật vào các ngày khác nhau để hệ thống vẽ biểu đồ kênh lớn lên theo thời gian.</div>';
      return;
    }
    const recent = data.slice(-10);
    const max = Math.max(1, ...recent.map((d) => d.followers));
    const diff = data[data.length - 1].followers - data[0].followers;
    const bars = recent.map((d) => {
      const h = Math.round((d.followers / max) * 100);
      return `<div class="bar-col"><div class="bar-val">${fmtCompact(d.followers)}</div><div class="bar" style="height:${h}%"></div><div class="bar-label">${d.snap_date.slice(5)}</div></div>`;
    }).join('');
    box.innerHTML = `<div class="growth-head">📈 Tăng trưởng follow ${diff >= 0 ? `<span class="text-accent">▲ +${fmtCompact(diff)}</span>` : `<span class="text-danger">▼ ${fmtCompact(diff)}</span>`}</div><div class="barchart" style="height:130px">${bars}</div>`;
  } catch (_) { box.innerHTML = ''; }
}

async function syncTiktok(id) {
  toast('Đang cập nhật số liệu…');
  try { await api('/tiktok/' + id + '/sync', { method: 'POST' }); toast('Đã cập nhật số liệu mới nhất'); renderTiktok(); }
  catch (e) { toast(e.message, 'err'); }
}

async function delTiktok(id) {
  if (!confirm('Xóa kênh TikTok này khỏi hệ thống?')) return;
  try { await api('/tiktok/' + id, { method: 'DELETE' }); toast('Đã xóa'); renderTiktok(); }
  catch (e) { toast(e.message, 'err'); }
}

// Thêm HÀNG LOẠT kênh TikTok
function bulkTiktokForm() {
  const statusOptions = Object.entries(TT_STATUS).map(([v, o]) => `<option value="${v}">${o.label}</option>`).join('');
  const form = el(`<form>
    <div class="form-grid">
      <div class="form-row"><label>Quốc gia chung <span class="req">* bắt buộc</span></label><select id="btt-country" required><option value="">— chọn nước —</option>${REWARD_COUNTRIES.map(([c, n]) => `<option value="${c}">${flag(c)} ${n}</option>`).join('')}</select></div>
      <div class="form-row"><label>Trạng thái chung</label><select id="btt-status">${statusOptions}</select></div>
    </div>
    <div class="form-row">
      <label>Dán link/ID kênh TikTok — mỗi dòng 1 cái</label>
      <textarea id="btt-urls" rows="8" placeholder="@kenh1&#10;https://www.tiktok.com/@kenh2&#10;@kenh3"></textarea>
      <div class="hint">Tự bỏ qua trùng. Số follow/tym sẽ tự lấy ở nền sau khi thêm (kênh hiện ngay).</div>
    </div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">Thêm tất cả</button></div>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = { country: form.querySelector('#btt-country').value, status: form.querySelector('#btt-status').value, urls: form.querySelector('#btt-urls').value };
    if (!body.country) return toast('Vui lòng chọn quốc gia chung', 'err');
    if (!body.urls.trim()) return toast('Dán ít nhất 1 link', 'err');
    const unlock = lockBtn(form);
    try {
      const r = await api('/tiktok/bulk', { method: 'POST', body });
      toast(`✓ Đã thêm ${r.added} kênh${r.skipped ? ', bỏ qua ' + r.skipped + ' trùng' : ''}`);
      closeModal(); renderTiktok();
      setTimeout(() => { if (State.page === 'tiktok') renderTiktok(); }, 4500);
    } catch (err) { toast(err.message, 'err'); } finally { unlock(); }
  };
  openModal('📥 Thêm hàng loạt kênh TikTok', form);
}

// ============ TĂNG TRƯỞNG TỪNG KÊNH ============
let growthDays = 7;
let growthLast = null;

async function renderGrowth() {
  $('#topbar-right').innerHTML = '';
  const expBtn = el('<button class="btn btn-ghost">⬇️ Xuất CSV</button>');
  $('#topbar-right').appendChild(expBtn);
  const view = $('#view');
  if (growthLast) drawGrowth(growthLast, expBtn);
  else view.innerHTML = '<div class="loading">Đang tải tăng trưởng…</div>';
  try {
    const data = await api('/report/growth?days=' + growthDays);
    growthLast = data;
    if (State.page === 'growth') drawGrowth(growthLast, expBtn);
  } catch (e) { if (!growthLast) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function drawGrowth(data, expBtn) {
  const view = $('#view');
  const days = data.days;
  const isAdmin = State.user.role === 'admin';
  const chans = data.channels || [];

  if (expBtn) expBtn.onclick = () => exportCsv(`tang-truong-${days}ngay.csv`,
    ['Nhân viên', 'Kênh', 'TikTok ID', 'Nước', 'Follow hiện tại', `Tăng ${days} ngày`, '% tăng', 'Follow/ngày', 'Video mới'],
    chans.map((c) => [c.owner, c.name, c.tiktok_id || '', c.country || '', c.followers, c.growth ?? '', c.pct ?? '', c.perDay ?? '', c.videoGrowth ?? '']));

  const periods = [[1, '📅 Hôm nay'], [7, '🗓️ 7 ngày'], [30, '📆 30 ngày']];
  const tabs = periods.map(([d, l]) => `<div class="filter-tab ${growthDays === d ? 'active' : ''}" data-days="${d}">${l}</div>`).join('');

  const hasAnyData = chans.some((c) => c.growth != null);

  // Gom theo nhân viên, mỗi nhóm sắp xếp kênh tăng nhiều nhất lên đầu
  const groups = {};
  chans.forEach((c) => { (groups[c.owner] = groups[c.owner] || { owner: c.owner, ownerId: c.owner_id, items: [] }).items.push(c); });
  const groupList = Object.values(groups).map((g) => {
    g.items.sort((a, b) => (b.growth ?? -Infinity) - (a.growth ?? -Infinity));
    g.total = g.items.reduce((a, c) => a + (c.growth || 0), 0);
    return g;
  }).sort((a, b) => b.total - a.total);

  const rowHtml = (c, i) => {
    const g = c.growth;
    const badge = g == null ? '<span class="delta flat">chưa có</span>' : deltaBadge(g, true);
    const pct = c.pct != null ? ` <span class="muted">(${c.pct >= 0 ? '+' : ''}${c.pct}%)</span>` : '';
    const rate = (c.perDay != null && days > 1) ? `${c.perDay >= 0 ? '+' : '−'}${fmtCompact(Math.abs(c.perDay))}/ngày` : '—';
    const fire = (i === 0 && g > 0) ? ' <span title="Tăng nhanh nhất nhóm">🚀</span>' : '';
    const stalled = (g === 0) ? ' <span class="muted" title="Chưa tăng">⚠️</span>' : '';
    return `<tr data-ttgo3="${c.id}" class="selectable-row">
      <td class="stt">${i + 1}</td>
      <td><b>${esc(c.name)}</b> ${flag(c.country)}${fire}${stalled}<div class="cell-sub">${c.tiktok_id ? '@' + esc(c.tiktok_id) : ''}</div></td>
      <td><b class="text-accent">${fmtCompact(c.followers)}</b></td>
      <td>${badge}${pct}</td>
      <td class="cell-sub nowrap">${rate}</td>
      <td>${c.videoGrowth != null ? deltaBadge(c.videoGrowth, false) : '<span class="muted">—</span>'}</td>
    </tr>`;
  };

  const thead = `<thead><tr><th>#</th><th>Kênh</th><th>Follow</th><th>Tăng ${days === 1 ? 'hôm nay' : days + ' ngày'}</th><th>Tốc độ</th><th>Video mới</th></tr></thead>`;
  const groupsHtml = groupList.map((g) => `
    <div class="panel">
      <div class="panel-title">👤 ${esc(g.owner)} <span class="muted" style="font-weight:400;font-size:13px">· ${g.items.length} kênh · tổng ${g.total >= 0 ? '+' : '−'}${fmtCompact(Math.abs(g.total))} follow</span>
        ${g.ownerId != null ? `<a class="btn-link" data-ttuser="${g.ownerId}" style="float:right;font-weight:400">mở danh sách →</a>` : ''}</div>
      <div class="table-wrap"><table>${thead}<tbody>${g.items.map(rowHtml).join('')}</tbody></table></div>
    </div>`).join('');

  view.innerHTML = `
    <div class="filter-tabs">${tabs}</div>
    <div class="hint" style="margin-bottom:14px">📈 Sắp xếp kênh tăng follow nhiều nhất lên đầu. 🚀 = tăng nhanh nhất nhóm, ⚠️ = chưa tăng. Số liệu tự cập nhật mỗi 6 tiếng.</div>
    ${!chans.length ? '<div class="empty"><div class="empty-icon">📈</div>Chưa có kênh nào.</div>'
      : !hasAnyData ? '<div class="empty"><div class="empty-icon">⏳</div>Cần ít nhất 2 ngày dữ liệu để tính tốc độ phát triển.<br>Hệ thống tự cập nhật mỗi 6 tiếng — quay lại sau 1–2 ngày sẽ thấy đầy đủ.</div>' + groupsHtml
      : groupsHtml}`;

  view.querySelectorAll('[data-days]').forEach((t) => t.onclick = () => { growthDays = +t.dataset.days; growthLast = null; renderGrowth(); });
  view.querySelectorAll('[data-ttgo3]').forEach((r) => r.onclick = async (e) => {
    if (e.target.closest('a')) return;
    try { if (!tiktokCache.length) tiktokCache = await api('/tiktok'); const t = tiktokCache.find((x) => x.id == r.dataset.ttgo3); if (t) tiktokDetail(t); } catch (_) {}
  });
  view.querySelectorAll('[data-ttuser]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); ttPerson = b.dataset.ttuser || ''; ttSearch = ''; ttCountry = 'all'; navigate('tiktok'); });
}

// ============ BÁO CÁO CÔNG VIỆC (ngày / tuần / tháng) ============
let reportPeriod = 'today'; // today | week | month | custom
let videoFrom = '', videoTo = '';
let reportLast = null; // cache để vẽ ngay, không chớp "đang tải"

// Ngày theo giờ máy người dùng (VN) — tránh lệch ngày do UTC
const localDate = (d = new Date()) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const weekStartStr = () => { const d = new Date(); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return localDate(d); };
const monthStartStr = () => { const d = new Date(); return localDate(new Date(d.getFullYear(), d.getMonth(), 1)); };

function reportRange() {
  if (reportPeriod === 'today') return [localDate(), localDate()];
  if (reportPeriod === 'week') return [weekStartStr(), localDate()];
  if (reportPeriod === 'month') return [monthStartStr(), localDate()];
  if (!videoFrom) { const d = new Date(); d.setDate(d.getDate() - 29); videoFrom = localDate(d); videoTo = localDate(); }
  return [videoFrom, videoTo];
}

async function renderVideos() {
  $('#topbar-right').innerHTML = '';
  const expBtn = el('<button class="btn btn-ghost">⬇️ Xuất CSV</button>');
  $('#topbar-right').appendChild(expBtn);

  const [from, to] = reportRange();
  const today = localDate();
  const view = $('#view');
  // Có cache thì vẽ ngay
  if (reportLast) drawReport(reportLast, expBtn);
  else view.innerHTML = '<div class="loading">Đang tải báo cáo…</div>';
  try {
    const [work, list, my] = await Promise.all([
      api(`/report/work?from=${from}&to=${to}`),
      api(`/report/list?from=${from}&to=${to}`),
      api(`/report/today?date=${today}`),
    ]);
    reportLast = { work, list, from, to, today, my };
    if (State.page === 'videos') drawReport(reportLast, expBtn);
  } catch (e) { if (!reportLast) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function drawReport(data, expBtn) {
  const { work, list, from, to } = data;
  const today = data.today || localDate();
  const my = data.my || { videos: 0, channels: 0, keys: 0, note: '' };
  const view = $('#view');
  const isAdmin = State.user.role === 'admin';
  const t = work.totals || { videos: 0, channels: 0, keys: 0 };
  const g = work.growth || { followers: 0, videos: 0, hasData: false };

  if (expBtn) expBtn.onclick = () => exportCsv('bao-cao-cong-viec.csv',
    ['Nhân viên', 'Video', 'Kênh', 'Key đã test'],
    work.perUser.map((r) => [r.name, r.videos, r.channels, r.keys]));

  const periods = [['today', '📅 Hôm nay'], ['week', '🗓️ Tuần này'], ['month', '📆 Tháng này'], ['custom', '⚙️ Tùy chọn']];
  const tabsHtml = periods.map(([id, label]) =>
    `<div class="filter-tab ${reportPeriod === id ? 'active' : ''}" data-period="${id}">${label}</div>`).join('');

  const repRows = work.perUser.length ? work.perUser.map((r, i) => `<tr>
    <td class="stt">${i + 1}</td>
    <td><b>${esc(r.name)}</b></td>
    <td><b class="text-accent" style="font-size:16px">${fmtNum(r.videos)}</b></td>
    <td><b>${fmtNum(r.channels)}</b></td>
    <td><b>${fmtNum(r.keys)}</b></td>
  </tr>`).join('') : `<tr><td colspan="5"><div class="empty" style="padding:24px">Chưa ai báo cáo trong kỳ này.</div></td></tr>`;

  const detailRows = list.map((d) => `<tr>
    <td class="nowrap">${fmtDate(d.report_date)}</td>
    ${isAdmin ? `<td><b>${esc(d.user_name)}</b></td>` : ''}
    <td><b class="text-accent">${fmtNum(d.videos)}</b></td>
    <td>${fmtNum(d.channels)}</td>
    <td>${fmtNum(d.keys)}</td>
    <td class="cell-sub" style="max-width:280px;white-space:normal">${d.note ? esc(d.note) : '<span class="muted">—</span>'}</td>
    <td><div class="row-actions">
      <button class="btn-icon" data-redit="${d.id}">✏️</button>
      <button class="btn-icon" data-rdel="${d.id}">🗑️</button>
    </div></td>
  </tr>`).join('');

  const rangeLabel = from === to ? fmtDate(from) : `${fmtDate(from)} → ${fmtDate(to)}`;
  const hasMy = my.videos || my.channels || my.keys;

  view.innerHTML = `
    <div class="panel quick-report">
      <div class="qr-title">📝 Báo cáo nhanh hôm nay <span class="qr-date">${fmtDate(today)}</span></div>
      <div class="qr-grid">
        <label class="qr-field"><span>🎬 Video đã làm</span><input type="number" id="qr-videos" min="0" value="${my.videos}" inputmode="numeric"></label>
        <label class="qr-field"><span>📱 Kênh đã làm</span><input type="number" id="qr-channels" min="0" value="${my.channels}" inputmode="numeric"></label>
        <label class="qr-field"><span>🔑 Key đã test</span><input type="number" id="qr-keys" min="0" value="${my.keys}" inputmode="numeric"></label>
      </div>
      <textarea id="qr-note" class="qr-note" rows="2" placeholder="Ghi chú gửi admin (không bắt buộc) — ví dụ: hôm nay kênh X bị lỗi, cần thêm key…">${esc(my.note || '')}</textarea>
      <div class="qr-actions">
        <button class="btn btn-primary" id="qr-save">💾 Lưu báo cáo</button>
        ${hasMy ? `<span class="qr-saved">✓ đã ghi hôm nay: ${fmtNum(my.videos)} video · ${fmtNum(my.channels)} kênh · ${fmtNum(my.keys)} key</span>` : ''}
      </div>
      <div class="hint">Cuối ngày gõ 3 số (và ghi chú nếu cần) rồi bấm Lưu. Muốn sửa thì gõ lại rồi Lưu (không bị cộng dồn).</div>
    </div>
    <div class="filter-tabs">${tabsHtml}</div>
    ${reportPeriod === 'custom' ? `<div class="toolbar">
      <div><label class="cell-sub">Từ ngày</label><input type="date" id="v-from" value="${from}"></div>
      <div><label class="cell-sub">Đến ngày</label><input type="date" id="v-to" value="${to}"></div>
    </div>` : ''}
    <div class="kpi-grid" style="margin-bottom:18px">
      <div class="kpi accent"><div class="kpi-icon">🎬</div><div class="kpi-label">Tổng video đã làm</div><div class="kpi-value">${fmtNum(t.videos)}</div><div class="kpi-sub">${rangeLabel}</div></div>
      <div class="kpi info"><div class="kpi-icon">📱</div><div class="kpi-label">Tổng kênh đã làm</div><div class="kpi-value">${fmtNum(t.channels)}</div><div class="kpi-sub">${rangeLabel}</div></div>
      <div class="kpi"><div class="kpi-icon">🔑</div><div class="kpi-label">Tổng key đã test</div><div class="kpi-value">${fmtNum(t.keys)}</div><div class="kpi-sub">${rangeLabel}</div></div>
      <div class="kpi primary clickable" data-gogrowth="1"><div class="kpi-icon">📈</div><div class="kpi-label">Tốc độ phát triển kênh</div><div class="kpi-value" style="font-size:18px">Xem từng kênh</div><div class="kpi-sub">mở trang Tăng trưởng →</div></div>
    </div>
    ${isAdmin ? `<div class="panel">
      <div class="panel-title">📊 Báo cáo theo nhân viên &nbsp;<span class="muted" style="font-weight:400;font-size:13px">${rangeLabel}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Nhân viên</th><th>🎬 Video</th><th>📱 Kênh</th><th>🔑 Key test</th></tr></thead>
        <tbody>${repRows}</tbody></table></div>
    </div>` : ''}
    <div class="panel">
      <div class="panel-title">📅 Chi tiết theo ngày${isAdmin ? '' : ' của tôi'}</div>
      ${list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Ngày</th>${isAdmin ? '<th>Nhân sự</th>' : ''}<th>🎬 Video</th><th>📱 Kênh</th><th>🔑 Key test</th><th>Ghi chú</th><th></th></tr></thead>
        <tbody>${detailRows}</tbody></table></div>`
        : '<div class="empty" style="padding:24px">Chưa có báo cáo nào trong kỳ này.</div>'}
    </div>`;

  // Lưu báo cáo nhanh hôm nay (3 số)
  const qrSave = $('#qr-save');
  if (qrSave) {
    const doSave = async () => {
      const unlock = lockBtn(qrSave);
      try {
        const body = {
          date: today,
          videos: Number($('#qr-videos').value) || 0,
          channels: Number($('#qr-channels').value) || 0,
          keys: Number($('#qr-keys').value) || 0,
          note: $('#qr-note') ? $('#qr-note').value : '',
        };
        const r = await api('/report/today', { method: 'POST', body });
        if (reportLast) reportLast.my = { videos: r.videos, channels: r.channels, keys: r.keys, note: r.note };
        toast(`✓ Đã lưu báo cáo hôm nay: ${fmtNum(r.videos)} video · ${fmtNum(r.channels)} kênh · ${fmtNum(r.keys)} key`);
        renderVideos();
      } catch (e) { toast(e.message, 'err'); } finally { unlock(); }
    };
    qrSave.onclick = doSave;
    ['#qr-videos', '#qr-channels', '#qr-keys'].forEach((s) => { const el2 = $(s); if (el2) el2.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } }; });
  }
  view.querySelectorAll('[data-period]').forEach((tb) => tb.onclick = () => { reportPeriod = tb.dataset.period; renderVideos(); });
  const goG = view.querySelector('[data-gogrowth]'); if (goG) goG.onclick = () => navigate('growth');
  if ($('#v-from')) $('#v-from').onchange = (e) => { videoFrom = e.target.value; renderVideos(); };
  if ($('#v-to')) $('#v-to').onchange = (e) => { videoTo = e.target.value; renderVideos(); };
  view.querySelectorAll('[data-redit]').forEach((b) => b.onclick = () => { const d = list.find((x) => x.id == b.dataset.redit); reportEditForm(d); });
  view.querySelectorAll('[data-rdel]').forEach((b) => b.onclick = () => delReport(b.dataset.rdel));
}

// Sửa 1 dòng báo cáo ngày
function reportEditForm(d) {
  const form = el(`<form>
    <div class="form-row"><label>Ngày</label><input value="${fmtDate(d.report_date)}${State.user.role === 'admin' ? ' — ' + esc(d.user_name) : ''}" disabled></div>
    <div class="form-grid">
      <div class="form-row"><label>🎬 Video</label><input type="number" id="r-videos" min="0" value="${d.videos}"></div>
      <div class="form-row"><label>📱 Kênh</label><input type="number" id="r-channels" min="0" value="${d.channels}"></div>
    </div>
    <div class="form-row"><label>🔑 Key đã test</label><input type="number" id="r-keys" min="0" value="${d.keys}"></div>
    <div class="form-row"><label>Ghi chú</label><textarea id="r-note" rows="2">${esc(d.note || '')}</textarea></div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">Lưu thay đổi</button></div>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = { videos: Number(form.querySelector('#r-videos').value) || 0, channels: Number(form.querySelector('#r-channels').value) || 0, keys: Number(form.querySelector('#r-keys').value) || 0, note: form.querySelector('#r-note').value };
    const unlock = lockBtn(form);
    try { await api('/report/' + d.id, { method: 'PUT', body }); toast('Đã cập nhật'); closeModal(); renderVideos(); }
    catch (err) { toast(err.message, 'err'); } finally { unlock(); }
  };
  openModal('Sửa báo cáo ngày', form);
}

async function delReport(id) {
  if (!confirm('Xóa dòng báo cáo này?')) return;
  try { await api('/report/' + id, { method: 'DELETE' }); toast('Đã xóa'); renderVideos(); }
  catch (e) { toast(e.message, 'err'); }
}

// ============ STAFF (admin) ============
async function renderStaff() {
  $('#topbar-right').innerHTML = '';
  const addBtn = el('<button class="btn btn-primary">➕ Thêm nhân sự</button>');
  addBtn.onclick = () => staffForm();
  $('#topbar-right').appendChild(addBtn);

  const view = $('#view');
  view.innerHTML = '<div class="loading">Đang tải…</div>';
  let users;
  try { users = await api('/users'); State.users = users; } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const rows = users.map((u) => {
    const lastMs = u.last_active ? new Date(u.last_active.replace(' ', 'T') + 'Z').getTime() : 0;
    const online = lastMs && (Date.now() - lastMs < 3 * 60 * 1000);
    return `<tr>
    <td><div class="cell-channel"><div class="user-avatar ${online ? 'is-online' : ''}" style="width:34px;height:34px;border-radius:9px">${esc((u.name||'U').charAt(0).toUpperCase())}</div><div><b>${esc(u.name)}</b><div class="cell-sub">@${esc(u.username)}</div></div></div></td>
    <td><span class="badge ${u.role}">${u.role === 'admin' ? 'Quản trị' : 'Nhân sự'}</span></td>
    <td>${online ? '<span class="badge done dot">Đang online</span>' : `<span class="cell-sub">⚫ ${u.last_active ? timeAgo(u.last_active) : 'chưa h.động'}</span>`}</td>
    <td class="cell-sub nowrap">${u.last_login ? fmtDateTime(u.last_login) : '<span class="muted">chưa đăng nhập</span>'}</td>
    <td>${u.active ? '<span class="badge done dot">Hoạt động</span>' : '<span class="badge todo dot">Đã khóa</span>'}</td>
    <td><div class="row-actions">
      <button class="btn-icon" data-uedit="${u.id}">✏️</button>
      ${u.id !== State.user.id ? `<button class="btn-icon" data-udel="${u.id}">🗑️</button>` : ''}
    </div></td>
  </tr>`; }).join('');

  view.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Họ tên</th><th>Vai trò</th><th>Tình trạng online</th><th>Đăng nhập gần nhất</th><th>Tài khoản</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;

  view.querySelectorAll('[data-uedit]').forEach((b) => b.onclick = () => { const u = users.find((x) => x.id == b.dataset.uedit); staffForm(u); });
  view.querySelectorAll('[data-udel]').forEach((b) => b.onclick = () => delStaff(b.dataset.udel));
}

function staffForm(user = null) {
  const isEdit = !!user;
  const form = el(`<form>
    <div class="form-row"><label>Họ tên</label><input id="u-name" value="${esc(user?.name || '')}" required></div>
    <div class="form-row"><label>Tên đăng nhập</label><input id="u-username" value="${esc(user?.username || '')}" ${isEdit ? 'disabled' : ''} required></div>
    <div class="form-row"><label>Mật khẩu ${isEdit ? '(để trống nếu không đổi)' : ''}</label><input type="text" id="u-password" placeholder="${isEdit ? '••••••' : 'mật khẩu'}"></div>
    <div class="form-grid">
      <div class="form-row"><label>Vai trò</label><select id="u-role"><option value="staff" ${user?.role==='staff'?'selected':''}>Nhân sự</option><option value="admin" ${user?.role==='admin'?'selected':''}>Quản trị</option></select></div>
      ${isEdit ? `<div class="form-row"><label>Trạng thái</label><select id="u-active"><option value="1" ${user.active?'selected':''}>Hoạt động</option><option value="0" ${!user.active?'selected':''}>Khóa</option></select></div>` : ''}
    </div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">${isEdit ? 'Lưu' : 'Tạo tài khoản'}</button></div>
  </form>`);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = { name: form.querySelector('#u-name').value.trim(), role: form.querySelector('#u-role').value };
    const pw = form.querySelector('#u-password').value;
    if (pw) body.password = pw;
    const unlock = lockBtn(form);
    try {
      if (isEdit) { body.active = Number(form.querySelector('#u-active').value); await api('/users/' + user.id, { method: 'PUT', body }); toast('Đã cập nhật'); }
      else {
        body.username = form.querySelector('#u-username').value.trim();
        if (!body.password) return toast('Nhập mật khẩu', 'err');
        await api('/users', { method: 'POST', body }); toast('Đã tạo nhân sự');
      }
      closeModal(); renderStaff();
    } catch (err) { toast(err.message, 'err'); } finally { unlock(); }
  };
  openModal(isEdit ? 'Sửa nhân sự' : 'Thêm nhân sự', form);
}

async function delStaff(id) {
  if (!confirm('Xóa nhân sự này? Toàn bộ nhật ký video của họ cũng sẽ bị xóa.')) return;
  try { await api('/users/' + id, { method: 'DELETE' }); toast('Đã xóa'); renderStaff(); }
  catch (e) { toast(e.message, 'err'); }
}

// ============ FINANCE (admin) ============
let financeFrom = '', financeTo = '';
async function renderFinance() {
  $('#topbar-right').innerHTML = '';
  const addRev = el('<button class="btn btn-primary">➕ Ghi thu/chi</button>');
  addRev.onclick = () => financeForm();
  $('#topbar-right').appendChild(addRev);

  if (!financeFrom) { const d = new Date(); d.setDate(d.getDate() - 29); financeFrom = d.toISOString().slice(0, 10); financeTo = todayStr(); }

  const view = $('#view');
  view.innerHTML = '<div class="loading">Đang tải…</div>';
  let all;
  try { all = await api('/finance'); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const rows = all.filter((r) => {
    const d = (r.log_date || '').slice(0, 10);
    return d >= financeFrom && d <= financeTo;
  });
  const rev = rows.filter((r) => r.type === 'revenue').reduce((a, b) => a + b.amount, 0);
  const cost = rows.filter((r) => r.type === 'cost').reduce((a, b) => a + b.amount, 0);
  const profit = rev - cost;

  const trs = rows.map((r) => `<tr>
    <td class="nowrap">${fmtDate(r.log_date)}</td>
    <td>${r.type === 'revenue' ? '<span class="badge done">💵 Doanh thu</span>' : '<span class="badge review">💸 Chi phí</span>'}</td>
    <td><b class="${r.type === 'revenue' ? 'text-accent' : 'text-danger'}">${r.type === 'revenue' ? '+' : '-'}${fmtMoney(r.amount)}</b></td>
    <td>${r.key_name ? esc(r.key_name) : '<span class="muted">—</span>'}</td>
    <td class="cell-sub">${esc(r.note || '')}</td>
    <td><button class="btn-icon" data-fdel="${r.id}">🗑️</button></td>
  </tr>`).join('');

  view.innerHTML = `
    <div class="toolbar">
      <div><label class="cell-sub">Từ ngày</label><input type="date" id="f-from" value="${financeFrom}"></div>
      <div><label class="cell-sub">Đến ngày</label><input type="date" id="f-to" value="${financeTo}"></div>
      <div class="muted" style="align-self:flex-end;font-size:12px">Tiền tính bằng USD ($)</div>
    </div>
    <div class="kpi-grid">
      <div class="kpi accent"><div class="kpi-icon">💵</div><div class="kpi-label">Doanh thu (kỳ này)</div><div class="kpi-value">${fmtMoney(rev)}</div></div>
      <div class="kpi warn"><div class="kpi-icon">💸</div><div class="kpi-label">Chi phí (kỳ này)</div><div class="kpi-value">${fmtMoney(cost)}</div></div>
      <div class="kpi ${profit >= 0 ? 'primary' : 'danger'}"><div class="kpi-icon">📈</div><div class="kpi-label">Lợi nhuận (kỳ này)</div><div class="kpi-value">${fmtMoney(profit)}</div></div>
    </div>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Ngày</th><th>Loại</th><th>Số tiền ($)</th><th>Key</th><th>Ghi chú</th><th></th></tr></thead>
      <tbody>${trs}</tbody></table></div>`
      : '<div class="empty"><div class="empty-icon">💰</div>Chưa có khoản thu/chi nào trong kỳ này.</div>'}`;

  $('#f-from').onchange = (e) => { financeFrom = e.target.value; renderFinance(); };
  $('#f-to').onchange = (e) => { financeTo = e.target.value; renderFinance(); };
  view.querySelectorAll('[data-fdel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Xóa khoản này?')) return;
    try { await api('/finance/' + b.dataset.fdel, { method: 'DELETE' }); toast('Đã xóa'); renderFinance(); } catch (e) { toast(e.message, 'err'); }
  });
}

function financeForm() {
  const keyOptions = keysCache.length ? keysCache.map((k) => `<option value="${k.id}">${esc(k.channel_name)}</option>`).join('') : '';
  const form = el(`<form>
    <div class="form-grid">
      <div class="form-row"><label>Loại</label><select id="f-type"><option value="revenue">💵 Doanh thu</option><option value="cost">💸 Chi phí</option></select></div>
      <div class="form-row"><label>Số tiền ($ USD)</label><input type="number" id="f-amount" min="0" step="0.01" value="0"></div>
    </div>
    <div class="form-grid">
      <div class="form-row"><label>Ngày</label><input type="date" id="f-date" value="${todayStr()}"></div>
      <div class="form-row"><label>Key liên quan</label><select id="f-key"><option value="">— không gắn —</option>${keyOptions}</select></div>
    </div>
    <div class="form-row"><label>Ghi chú</label><textarea id="f-note" placeholder="VD: Doanh thu TikTok Creator Rewards tháng 6…"></textarea></div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">Lưu</button></div>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      type: form.querySelector('#f-type').value,
      amount: form.querySelector('#f-amount').value,
      log_date: form.querySelector('#f-date').value,
      key_id: form.querySelector('#f-key').value || null,
      note: form.querySelector('#f-note').value.trim(),
    };
    const unlock = lockBtn(form);
    try { await api('/finance', { method: 'POST', body }); toast('Đã lưu'); closeModal(); renderFinance(); }
    catch (err) { toast(err.message, 'err'); } finally { unlock(); }
  };
  openModal('Ghi khoản thu / chi', form);
}

// ============ ACTIVITY LOG (admin) ============
async function renderActivity() {
  $('#topbar-right').innerHTML = '';
  const clrBtn = el('<button class="btn btn-ghost">🗑️ Xóa lịch sử</button>');
  clrBtn.onclick = async () => {
    if (!confirm('Xóa toàn bộ lịch sử thao tác? Không thể hoàn tác.')) return;
    try { await api('/activity', { method: 'DELETE' }); toast('Đã xóa lịch sử'); renderActivity(); } catch (e) { toast(e.message, 'err'); }
  };
  $('#topbar-right').appendChild(clrBtn);

  const view = $('#view');
  view.innerHTML = '<div class="loading">Đang tải lịch sử…</div>';
  let rows;
  try { rows = await api('/activity'); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const KIND = { add: ['➕ Thêm', 'k-add'], edit: ['✏️ Sửa', 'k-edit'], delete: ['🗑️ Xóa', 'k-del'], claim: ['✋ Nhận/Bỏ', 'k-claim'], other: ['• Khác', 'k-other'] };
  const trs = rows.map((r) => {
    const k = KIND[r.kind] || KIND.other;
    return `<tr>
      <td class="nowrap cell-sub">${fmtDateTime(r.created_at)}</td>
      <td><b>${esc(r.user_name || '—')}</b></td>
      <td><span class="act-badge ${k[1]}">${k[0]}</span></td>
      <td>${esc(r.message)}</td>
    </tr>`;
  }).join('');

  view.innerHTML = rows.length
    ? `<div class="panel-title" style="margin-bottom:12px">📜 ${rows.length} thao tác gần nhất</div>
       <div class="table-wrap"><table>
         <thead><tr><th>Thời gian</th><th>Người làm</th><th>Loại</th><th>Nội dung</th></tr></thead>
         <tbody>${trs}</tbody></table></div>`
    : '<div class="empty"><div class="empty-icon">📜</div>Chưa có thao tác nào được ghi.</div>';
}

// ============ THÙNG RÁC ============
async function renderTrash() {
  $('#topbar-right').innerHTML = '';
  const view = $('#view');
  view.innerHTML = '<div class="loading">Đang tải thùng rác…</div>';
  let data;
  try { data = await api('/trash'); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const keys = data.keys || [], tiktok = data.tiktok || [];
  const total = keys.length + tiktok.length;
  if (!total) {
    view.innerHTML = '<div class="empty"><div class="empty-icon">🗑️</div>Thùng rác trống. Mọi thứ bạn xóa sẽ vào đây và có thể khôi phục trong 30 ngày.</div>';
    return;
  }

  // nút dọn sạch toàn bộ
  const emptyBtn = el('<button class="btn btn-ghost">🧹 Dọn sạch thùng rác</button>');
  emptyBtn.onclick = async () => {
    if (!confirm('XÓA VĨNH VIỄN toàn bộ thùng rác? Không thể khôi phục lại được.')) return;
    try { const r = await api('/trash', { method: 'DELETE' }); toast(`Đã xóa vĩnh viễn ${r.deleted} mục`); renderTrash(); } catch (e) { toast(e.message, 'err'); }
  };
  $('#topbar-right').appendChild(emptyBtn);

  // dựng một khối danh sách cho từng loại (type = 'keys' | 'tiktok')
  const section = (title, icon, type, rows, nameOf, subOf) => {
    if (!rows.length) return '';
    const items = rows.map((r) => `
      <tr>
        <td class="chk-col"><input type="checkbox" class="trash-chk" data-type="${type}" value="${r.id}"></td>
        <td><b>${esc(nameOf(r))}</b><div class="cell-sub">${subOf(r)}</div></td>
        <td class="nowrap cell-sub">🗑️ ${timeAgo(r.deleted_at)}</td>
      </tr>`).join('');
    return `
      <div class="panel">
        <div class="panel-title">${icon} ${title} (${rows.length})</div>
        <div class="trash-actions" style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <button class="btn btn-sm btn-ghost" data-sel="${type}" data-all="1">Chọn tất cả</button>
          <button class="btn btn-sm btn-primary" data-restore="${type}">↩️ Khôi phục đã chọn</button>
          <button class="btn btn-sm btn-ghost" data-purge="${type}" style="color:#ef4444">✖ Xóa vĩnh viễn đã chọn</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th class="chk-col"></th><th>${title}</th><th>Đã xóa</th></tr></thead>
          <tbody>${items}</tbody></table></div>
      </div>`;
  };

  view.innerHTML =
    `<div class="muted" style="margin-bottom:12px">Các mục trong thùng rác sẽ tự động xóa vĩnh viễn sau 30 ngày.</div>` +
    section('Key YouTube', '🔑', 'keys', keys, (r) => r.channel_name || r.url, (r) => esc(r.category || r.country || '')) +
    section('Kênh TikTok', '📱', 'tiktok', tiktok, (r) => r.name || r.url, (r) => esc((r.tiktok_id ? '@' + r.tiktok_id : '') + (r.country ? ' · ' + r.country : '')));

  const idsOf = (type) => Array.from(view.querySelectorAll(`.trash-chk[data-type="${type}"]:checked`)).map((c) => Number(c.value));

  view.querySelectorAll('[data-sel]').forEach((b) => b.onclick = () => {
    const boxes = view.querySelectorAll(`.trash-chk[data-type="${b.dataset.sel}"]`);
    const allChecked = Array.from(boxes).every((c) => c.checked);
    boxes.forEach((c) => { c.checked = !allChecked; });
  });
  view.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => {
    const type = b.dataset.restore, ids = idsOf(type);
    if (!ids.length) return toast('Chưa chọn mục nào', 'err');
    const unlock = lockBtn(b);
    try { const r = await api('/trash/restore', { method: 'POST', body: { type, ids } }); toast(`Đã khôi phục ${r.restored} mục`); keysCache = []; tiktokCache = []; renderTrash(); }
    catch (e) { toast(e.message, 'err'); } finally { unlock(); }
  });
  view.querySelectorAll('[data-purge]').forEach((b) => b.onclick = async () => {
    const type = b.dataset.purge, ids = idsOf(type);
    if (!ids.length) return toast('Chưa chọn mục nào', 'err');
    if (!confirm(`XÓA VĨNH VIỄN ${ids.length} mục đã chọn? Không thể khôi phục.`)) return;
    const unlock = lockBtn(b);
    try { const r = await api('/trash/purge', { method: 'POST', body: { type, ids } }); toast(`Đã xóa vĩnh viễn ${r.purged} mục`); renderTrash(); }
    catch (e) { toast(e.message, 'err'); } finally { unlock(); }
  });
}

// ============ SETTINGS ============
function renderSettings() {
  const view = $('#view');
  view.innerHTML = `
    <div class="panel" style="max-width:520px">
      <div class="panel-title">Đổi mật khẩu</div>
      <form id="pw-form">
        <div class="form-row"><label>Mật khẩu hiện tại</label><input type="password" id="pw-old" required></div>
        <div class="form-row"><label>Mật khẩu mới</label><input type="password" id="pw-new" required></div>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Đổi mật khẩu</button></div>
      </form>
    </div>
    <div class="panel" style="max-width:520px">
      <div class="panel-title">Thông tin tài khoản</div>
      <p><b>${esc(State.user.name)}</b> (@${esc(State.user.username)})</p>
      <p class="muted">Vai trò: ${State.user.role === 'admin' ? 'Quản trị viên' : 'Nhân sự'}</p>
    </div>
    ${State.user.role === 'admin' ? `
    <div class="panel" style="max-width:520px">
      <div class="panel-title">💾 Sao lưu dữ liệu</div>
      <p class="muted" style="margin-bottom:12px">Tải toàn bộ dữ liệu (key, kênh TikTok, nhân sự, lịch sử…) về máy thành 1 file. Giữ kỹ file này để khôi phục khi cần.</p>
      <button id="backup-btn" class="btn btn-primary">⬇️ Tải file sao lưu</button>
    </div>` : ''}`;
  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const unlock = lockBtn($('#pw-form'));
    try {
      await api('/me/password', { method: 'POST', body: { oldPassword: $('#pw-old').value, newPassword: $('#pw-new').value } });
      toast('Đã đổi mật khẩu'); $('#pw-form').reset();
    } catch (err) { toast(err.message, 'err'); } finally { unlock(); }
  };
  const bk = $('#backup-btn');
  if (bk) bk.onclick = async () => {
    const unlock = lockBtn(bk);
    try {
      const res = await fetch('/api/backup', { cache: 'no-store', headers: { Authorization: 'Bearer ' + State.token } });
      if (!res.ok) throw new Error('Không tải được file sao lưu');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `reup-backup-${todayStr()}.db`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Đã tải file sao lưu');
    } catch (e) { toast(e.message, 'err'); } finally { unlock(); }
  };
}

// ============ MENU MOBILE ============
function closeMenu() { $('#sidebar').classList.remove('open'); $('#app').classList.remove('menu-open'); }
function toggleMenu() { $('#sidebar').classList.toggle('open'); $('#app').classList.toggle('menu-open'); }

// ============ CHẾ ĐỘ SÁNG / TỐI ============
function applyTheme() {
  const light = localStorage.getItem('rm_theme') === 'light';
  document.body.classList.toggle('light', light);
  const b = $('#theme-btn');
  if (b) b.textContent = light ? '🌙 Chuyển nền tối' : '☀️ Chuyển nền sáng';
}
function toggleTheme() {
  localStorage.setItem('rm_theme', localStorage.getItem('rm_theme') === 'light' ? 'dark' : 'light');
  applyTheme();
}

// ============ INIT ============
$('#login-form').onsubmit = doLogin;
$('#logout-btn').onclick = logout;
$('#theme-btn').onclick = toggleTheme;
applyTheme();
$('#modal-close').onclick = closeModal;
$('#modal-overlay').onclick = (e) => { if (e.target.id === 'modal-overlay') closeModal(); };
$('#menu-toggle').onclick = toggleMenu;
$('#backdrop').onclick = closeMenu;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

if (State.token) enterApp(); else { $('#login-screen').classList.remove('hidden'); }
