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
  const b = form.querySelector('button[type="submit"]');
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
const QUALITY = { ngon: 'Ngon 🔥', tot: 'Tốt', thuong: 'Thường' };

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
    { id: 'keys', icon: '🔑', label: 'Key YouTube' },
    { id: 'tiktok', icon: '📱', label: 'Kênh TikTok' },
    { id: 'videos', icon: '🎞️', label: 'Nhật ký video' },
  ];
  if (isAdmin) {
    items.push({ id: 'staff', icon: '👥', label: 'Nhân sự' });
    items.push({ id: 'finance', icon: '💰', label: 'Lợi nhuận' });
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

const PAGE_TITLES = { dashboard: 'Tổng quan', keys: 'Key YouTube', tiktok: 'Kênh TikTok', videos: 'Nhật ký video', staff: 'Nhân sự', finance: 'Lợi nhuận', settings: 'Cài đặt' };

// Điều hướng có lưu lịch sử (để nút "quay lại" của chuột/trình duyệt hoạt động)
function navigate(page) {
  if (location.hash === '#' + page) renderPage(page);
  else location.hash = '#' + page; // đổi hash -> sự kiện hashchange -> renderPage
}

function renderPage(page) {
  if (!PAGE_TITLES[page]) page = 'dashboard';
  State.page = page;
  $('#page-title').textContent = PAGE_TITLES[page] || '';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  $('#topbar-right').innerHTML = '';
  closeMenu();
  const renderers = { dashboard: renderDashboard, keys: renderKeys, tiktok: renderTiktok, videos: renderVideos, staff: renderStaff, finance: renderFinance, settings: renderSettings };
  (renderers[page] || renderDashboard)();
}

window.addEventListener('hashchange', () => {
  if (State.user) renderPage(location.hash.replace(/^#/, '') || 'dashboard');
});

// ============ DASHBOARD ============
async function renderDashboard() {
  const view = $('#view');
  view.innerHTML = '<div class="loading">Đang tải dữ liệu…</div>';
  let s, keys;
  try {
    s = await api('/stats');
    keys = await api('/keys');
  } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  keysCache = keys;
  const unassigned = keys.filter((k) => !k.worker_count);

  let kpis = `
    <div class="kpi clickable" data-go="keys-all"><div class="kpi-icon">🔑</div><div class="kpi-label">Tổng số Key</div><div class="kpi-value">${fmtNum(s.totalKeys)}</div><div class="kpi-sub">chưa ai làm: ${fmtNum(s.keysUnassigned)} →</div></div>
    <div class="kpi info clickable" data-go="keys-mine"><div class="kpi-icon">⭐</div><div class="kpi-label">Key của tôi đang làm</div><div class="kpi-value">${fmtNum(s.myKeys)}</div><div class="kpi-sub">xem key của tôi →</div></div>
    <div class="kpi primary clickable" data-go="tiktok"><div class="kpi-icon">📱</div><div class="kpi-label">${s.isAdmin ? 'Tổng kênh TikTok' : 'Kênh TikTok của tôi'}</div><div class="kpi-value">${fmtNum(s.tiktok.channels)}</div><div class="kpi-sub">mở danh sách →</div></div>`;
  if (s.finance) kpis += `
    <div class="kpi accent clickable" data-go="finance"><div class="kpi-icon">💵</div><div class="kpi-label">Doanh thu tháng</div><div class="kpi-value">${fmtMoney(s.finance.revenueMonth)}</div><div class="kpi-sub">xem chi tiết →</div></div>
    <div class="kpi ${s.finance.profitMonth >= 0 ? 'primary' : 'danger'} clickable" data-go="finance"><div class="kpi-icon">📈</div><div class="kpi-label">Lợi nhuận tháng</div><div class="kpi-value">${fmtMoney(s.finance.profitMonth)}</div><div class="kpi-sub">tổng: ${fmtMoney(s.finance.profitAll)} →</div></div>`;

  // Key đã có người làm — gom theo từng người (ai cũng thấy để khỏi trùng)
  const me = State.user.name;
  const keysByPerson = {};
  keys.forEach((k) => {
    if (!k.worker_count) return;
    (k.worker_names || '').split(', ').filter(Boolean).forEach((n) => { (keysByPerson[n] = keysByPerson[n] || []).push(k); });
  });
  // Đưa nhóm của mình lên đầu
  const personNames = Object.keys(keysByPerson).sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
  const claimedHtml = personNames.length ? personNames.map((name) => `
    <div class="user-channels">
      <div class="uc-head"><span class="uc-name">👤 ${esc(name)}${name === me ? ' <span class="me-tag">bạn</span>' : ''}</span><span class="uc-meta">${keysByPerson[name].length} key</span></div>
      ${keysByPerson[name].map((k, i) => `
        <div class="uc-item" data-keygo="${k.id}" title="Xem chi tiết">
          <span class="uc-num">${i + 1}</span>
          <span class="uc-cn">${esc(k.channel_name)}</span>
          <span class="badge ${k.status}">${(STATUS[k.status] || STATUS.todo).label}</span>
        </div>`).join('')}
    </div>`).join('') : '<div class="empty" style="padding:30px 10px">Chưa ai nhận key nào.</div>';

  const unassignedHtml = unassigned.length ? unassigned.slice(0, 20).map((k) => `
    <div class="ua-item">
      <span class="uc-cn">${esc(k.channel_name)}${k.quality ? ' <span class="quality-tag">' + esc(QUALITY[k.quality] || k.quality) + '</span>' : ''}</span>
      <button class="btn btn-sm btn-primary" data-claim="${k.id}">✋ Nhận làm</button>
    </div>`).join('') + (unassigned.length > 20 ? `<div class="hint">…và ${unassigned.length - 20} key khác (xem ở mục Key YouTube)</div>` : '')
    : '<div class="empty" style="padding:30px 10px">Mọi key đều đã có người làm 👍</div>';

  const byUser = s.tiktokByUser || [];
  const byUserHtml = byUser.length ? byUser.map((u) => `
    <div class="user-channels">
      <div class="uc-head"><span class="uc-name">👤 ${esc(u.owner)}</span><span class="uc-meta">${u.channelCount} kênh • ${fmtCompact(u.followers)} 👥 • ${fmtCompact(u.likes)} ❤️</span></div>
      ${u.channels.map((c, i) => `
        <div class="uc-item" data-ttgo="${c.id}" title="Xem chi tiết">
          <span class="uc-num">${i + 1}</span>
          <span class="uc-cn">${esc(c.name)} ${flag(c.country)}</span>
          <span class="uc-stat">${fmtCompact(c.followers)} 👥</span>
          <span class="badge ${(TT_STATUS[c.status] || TT_STATUS.active).cls}">${(TT_STATUS[c.status] || TT_STATUS.active).label}</span>
        </div>`).join('')}
    </div>`).join('') : '<div class="empty">Chưa có kênh TikTok nào.</div>';

  view.innerHTML = `
    <div class="kpi-grid">${kpis}</div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">✅ Key đã có người làm</div>
        ${claimedHtml}
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
    if (go === 'keys-all') { keysOwner = 'all'; keysFilter = 'all'; navigate('keys'); }
    else if (go === 'keys-mine') { keysOwner = 'mine'; keysFilter = 'all'; navigate('keys'); }
    else if (go === 'tiktok') navigate('tiktok');
    else if (go === 'finance') navigate('finance');
  });
  view.querySelectorAll('[data-keygo]').forEach((b) => b.onclick = () => { const k = keys.find((x) => x.id == b.dataset.keygo); if (k) keyDetail(k); });
  view.querySelectorAll('[data-ttgo]').forEach((b) => b.onclick = async () => {
    try { if (!tiktokCache.length) tiktokCache = await api('/tiktok'); const t = tiktokCache.find((x) => x.id == b.dataset.ttgo); if (t) tiktokDetail(t); } catch (_) {}
  });
  view.querySelectorAll('[data-claim]').forEach((b) => b.onclick = () => claimKey(b.dataset.claim));
}

async function claimKey(id) {
  try { await api('/keys/' + id + '/claim', { method: 'POST', body: {} }); toast('✋ Đã nhận key — đánh dấu bạn đang làm'); tiktokCache = []; renderDashboard(); }
  catch (e) { toast(e.message, 'err'); }
}

// ============ KEYS ============
let keysCache = [];
let keysFilter = 'all';
let keysSearch = '';
let keysOwner = 'all'; // all | mine | unassigned | <userId>
let keysCountry = 'all';

async function renderKeys() {
  $('#topbar-right').innerHTML = '';
  const expBtn = el('<button class="btn btn-ghost">⬇️ Xuất CSV</button>');
  expBtn.onclick = () => exportCsv('key-youtube.csv',
    ['Chủ đề', 'Nước', 'Tên kênh', 'Link', 'Trạng thái', 'Chất lượng', 'Sub', 'Số video', 'Người làm', 'Người thêm', 'Ngày thêm'],
    keysCache.map((k) => [k.category || '', k.country || '', k.channel_name, k.url, (STATUS[k.status] || {}).label || k.status, QUALITY[k.quality] || k.quality || '', k.subscribers || '', k.video_count || '', k.worker_names || '', k.added_name || '', fmtDate(k.created_at)]));
  const addBtn = el('<button class="btn btn-primary">➕ Thêm Key</button>');
  addBtn.onclick = () => keyForm();
  $('#topbar-right').appendChild(expBtn);
  $('#topbar-right').appendChild(addBtn);

  const view = $('#view');
  view.innerHTML = '<div class="loading">Đang tải danh sách key…</div>';
  try { keysCache = await api('/keys'); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  drawKeys();
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

  const rows = list.map((k) => {
    const st = STATUS[k.status] || STATUS.todo;
    const thumb = k.thumbnail ? `<img class="cell-thumb" src="${esc(k.thumbnail)}" onerror="this.style.visibility='hidden'">` : `<div class="cell-thumb"></div>`;
    const subInfo = [];
    if (k.country) subInfo.push(`<span class="country-tag" style="${chipStyle(k.country)}">${flag(k.country)} ${esc(countryName(k.country) || k.country)}</span>`);
    if (k.quality) subInfo.push(`<span class="quality-tag ${QUALITY_CLS[k.quality] || ''}">${esc(QUALITY[k.quality] || k.quality)}</span>`);
    if (k.subscribers) subInfo.push(`<span class="ch-sub-tag">👥 ${esc(k.subscribers)}</span>`);
    return `<tr>
      <td>${k.category ? `<span class="cat-tag" style="${chipStyle(k.category)}">${esc(k.category)}</span>` : '<span class="muted">—</span>'}</td>
      <td><div class="cell-channel">${thumb}<div>
        <a href="${esc(k.url)}" target="_blank" rel="noopener" title="Mở kênh">${esc(k.channel_name)}</a>
        <div class="cell-sub">${subInfo.join(' ')}</div>
        <a href="${esc(k.url)}" target="_blank" rel="noopener" class="cell-link" title="Bấm để mở trình duyệt">🔗 ${esc((k.url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').slice(0, 42))}</a>
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
      <thead><tr><th>Chủ đề</th><th>Kênh / Key</th><th>Trạng thái</th><th>Người làm</th><th>Người thêm</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`
      : '<div class="empty"><div class="empty-icon">🔑</div>Chưa có key nào. Bấm "Thêm Key" để bắt đầu.</div>'}`;

  view.querySelectorAll('.filter-tab').forEach((t) => t.onclick = () => { keysFilter = t.dataset.f; drawKeys(); });
  $('#key-owner').onchange = (e) => { keysOwner = e.target.value; drawKeys(); };
  $('#key-country').onchange = (e) => { keysCountry = e.target.value; drawKeys(); };
  const search = $('#key-search');
  search.oninput = () => { keysSearch = search.value; const pos = search.selectionStart; drawKeys(); const ns = $('#key-search'); ns.focus(); ns.setSelectionRange(pos, pos); };
  view.querySelectorAll('[data-info]').forEach((b) => b.onclick = () => { const k = keysCache.find((x) => x.id == b.dataset.info); keyDetail(k); });
  view.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { const k = keysCache.find((x) => x.id == b.dataset.edit); keyForm(k); });
  view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => delKey(b.dataset.del));
  view.querySelectorAll('[data-claim]').forEach((b) => b.onclick = async () => {
    try { await api('/keys/' + b.dataset.claim + '/claim', { method: 'POST', body: {} }); toast('✋ Đã nhận key — đánh dấu bạn đang làm'); renderKeys(); } catch (e) { toast(e.message, 'err'); }
  });
  view.querySelectorAll('[data-release]').forEach((b) => b.onclick = async () => {
    try { await api('/keys/' + b.dataset.release + '/claim', { method: 'POST', body: { release: true } }); toast('Đã bỏ nhận key'); renderKeys(); } catch (e) { toast(e.message, 'err'); }
  });
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
        <label>Quốc gia (nước kiếm tiền)</label>
        <select id="k-country">
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

// ============ TIKTOK ============
let tiktokCache = [];
let ttSearch = '';
let ttSort = 'recent';
let ttPerson = '';

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
    ['Tên', 'TikTok ID', 'Link', 'Quốc gia', 'Follow', 'Tym', 'Video', 'Kiếm tiền', 'Paypal', 'XMDT', 'Trạng thái', 'Key nguồn', 'Giao cho'],
    tiktokCache.map((t) => [t.name, t.tiktok_id || '', t.url, t.country || '', t.followers, t.likes, t.video_count, t.monetized ? 'Có' : 'Chưa', t.paypal_added ? 'Có' : 'Chưa', t.verified ? 'Có' : 'Chưa', (TT_STATUS[t.status] || {}).label || t.status, t.source_key_name || '', t.assigned_name || '']));
  const addBtn = el('<button class="btn btn-primary">➕ Thêm kênh TikTok</button>');
  addBtn.onclick = () => tiktokForm();
  if (State.user.role === 'admin') {
    const syncBtn = el('<button class="btn btn-ghost">🔄 Cập nhật tất cả</button>');
    syncBtn.onclick = async () => {
      try {
        await api('/tiktok/sync-all', { method: 'POST', body: {} });
        toast('Đang cập nhật số liệu tất cả kênh ở hậu trường… vài phút nữa làm mới trang để xem');
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#topbar-right').appendChild(syncBtn);
  }
  $('#topbar-right').appendChild(expBtn);
  $('#topbar-right').appendChild(addBtn);

  const view = $('#view');
  view.innerHTML = '<div class="loading">Đang tải kênh TikTok…</div>';
  try {
    tiktokCache = await api('/tiktok');
    if (!keysCache.length) keysCache = await api('/keys');
  } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  drawTiktok();
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
  if (ttSort === 'follow') list.sort((a, b) => b.followers - a.followers);
  else if (ttSort === 'likes') list.sort((a, b) => b.likes - a.likes);
  else if (ttSort === 'video') list.sort((a, b) => b.video_count - a.video_count);

  const personOptions = State.users.map((u) => `<option value="${u.id}" ${String(ttPerson) === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  const countryName = (cc) => { const f = REWARD_COUNTRIES.find(([c]) => c === cc); return f ? f[1] : (cc || 'Chưa đặt nước'); };

  const rowHtml = (t, idx) => {
    const st = TT_STATUS[t.status] || TT_STATUS.active;
    const av = t.avatar ? `<img class="cell-thumb" src="${esc(t.avatar)}" onerror="this.style.visibility='hidden'">` : '<div class="cell-thumb"></div>';
    return `<tr>
      <td class="stt">${idx + 1}</td>
      <td><div class="cell-channel">${av}<div>
        <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>
        <div class="cell-sub">${t.tiktok_id ? '@' + esc(t.tiktok_id) : ''}</div>
        <a href="${esc(t.url)}" target="_blank" rel="noopener" class="cell-link">🔗 ${esc((t.url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').slice(0, 38))}</a>
        ${t.note ? `<div class="cell-note">📝 ${esc(t.note)}</div>` : ''}
        ${monetizeChips(t)}
      </div></div></td>
      <td><b class="text-accent">${fmtCompact(t.followers)}</b></td>
      <td><b class="text-danger">${fmtCompact(t.likes)}</b></td>
      <td>${fmtNum(t.video_count)}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td class="nowrap cell-sub">${t.source_key_name ? esc(t.source_key_name) : '<span class="muted">—</span>'}</td>
      <td class="nowrap">${t.assigned_name ? esc(t.assigned_name) : '<span class="muted">—</span>'}</td>
      <td><div class="row-actions">
        <button class="btn-icon" data-ttsync="${t.id}" title="Cập nhật số liệu">🔄</button>
        <button class="btn-icon" data-ttinfo="${t.id}" title="Chi tiết">👁️</button>
        <button class="btn-icon" data-ttedit="${t.id}" title="Sửa">✏️</button>
        <button class="btn-icon" data-ttdel="${t.id}" title="Xóa">🗑️</button>
      </div></td>
    </tr>`;
  };
  const thead = `<thead><tr><th>#</th><th>Kênh TikTok</th><th>Follow</th><th>Tym</th><th>Video</th><th>Trạng thái</th><th>Key nguồn</th><th>Giao cho</th><th></th></tr></thead>`;

  // Gom kênh theo quốc gia
  const groups = {};
  list.forEach((t) => { const k = t.country || ''; (groups[k] = groups[k] || []).push(t); });
  const groupKeys = Object.keys(groups).sort((a, b) => (!a ? 1 : !b ? -1 : groups[b].length - groups[a].length));

  const groupedHtml = groupKeys.map((cc) => {
    const items = groups[cc];
    const gf = items.reduce((a, b) => a + b.followers, 0);
    const gl = items.reduce((a, b) => a + b.likes, 0);
    return `<div class="country-group">
      <div class="country-head">
        <span class="country-flag">${flag(cc)}</span>
        <span class="country-name">${esc(countryName(cc))}</span>
        <span class="country-count">${items.length} kênh</span>
        <span class="spacer"></span>
        <span class="country-stat">👥 ${fmtCompact(gf)}</span>
        <span class="country-stat">❤️ ${fmtCompact(gl)}</span>
      </div>
      <div class="table-wrap country-table"><table>${thead}<tbody>${items.map((t, i) => rowHtml(t, i)).join('')}</tbody></table></div>
    </div>`;
  }).join('');

  view.innerHTML = `
    <div class="toolbar">
      <input class="search" id="tt-search" placeholder="🔍 Tìm kênh TikTok…" value="${esc(ttSearch)}">
      <select id="tt-sort">
        <option value="recent" ${ttSort === 'recent' ? 'selected' : ''}>↕ Mới thêm</option>
        <option value="follow" ${ttSort === 'follow' ? 'selected' : ''}>👥 Follow cao nhất</option>
        <option value="video" ${ttSort === 'video' ? 'selected' : ''}>🎬 Video nhiều nhất</option>
        <option value="likes" ${ttSort === 'likes' ? 'selected' : ''}>❤️ Tym cao nhất</option>
      </select>
      ${isAdmin ? `<select id="tt-person"><option value="">👥 Tất cả người</option>${personOptions}</select>` : ''}
    </div>
    ${list.length ? groupedHtml
      : '<div class="empty"><div class="empty-icon">📱</div>Chưa có kênh TikTok nào. Bấm "Thêm kênh TikTok" để bắt đầu.</div>'}`;

  const search = $('#tt-search');
  search.oninput = () => { ttSearch = search.value; const p = search.selectionStart; drawTiktok(); const ns = $('#tt-search'); ns.focus(); ns.setSelectionRange(p, p); };
  $('#tt-sort').onchange = (e) => { ttSort = e.target.value; drawTiktok(); };
  if ($('#tt-person')) $('#tt-person').onchange = (e) => { ttPerson = e.target.value; drawTiktok(); };
  view.querySelectorAll('[data-ttsync]').forEach((b) => b.onclick = () => syncTiktok(b.dataset.ttsync));
  view.querySelectorAll('[data-ttinfo]').forEach((b) => b.onclick = () => { const t = tiktokCache.find((x) => x.id == b.dataset.ttinfo); tiktokDetail(t); });
  view.querySelectorAll('[data-ttedit]').forEach((b) => b.onclick = () => { const t = tiktokCache.find((x) => x.id == b.dataset.ttedit); tiktokForm(t); });
  view.querySelectorAll('[data-ttdel]').forEach((b) => b.onclick = () => delTiktok(b.dataset.ttdel));
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
      <div class="form-row"><label>Quốc gia (Creator Rewards)</label><select id="tt-country">${countryOpts}</select></div>
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

// ============ VIDEO LOGS ============
let videoFrom = '', videoTo = '';

async function renderVideos() {
  $('#topbar-right').innerHTML = '';
  const expBtn = el('<button class="btn btn-ghost">⬇️ Xuất CSV</button>');
  const addBtn = el('<button class="btn btn-primary">➕ Ghi video</button>');
  addBtn.onclick = () => videoForm();
  $('#topbar-right').appendChild(expBtn);
  $('#topbar-right').appendChild(addBtn);

  if (!videoFrom) { const d = new Date(); d.setDate(d.getDate() - 29); videoFrom = d.toISOString().slice(0, 10); videoTo = todayStr(); }

  const view = $('#view');
  view.innerHTML = '<div class="loading">Đang tải báo cáo…</div>';
  let report, logs;
  try {
    report = await api(`/report/videos?from=${videoFrom}&to=${videoTo}`);
    logs = await api(`/videologs?from=${videoFrom}&to=${videoTo}`);
  } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const isAdmin = State.user.role === 'admin';

  expBtn.onclick = () => exportCsv('bao-cao-video.csv',
    ['Nhân viên', 'Tổng video', 'Số key đã làm', 'Số lần ghi', 'Ngày gần nhất'],
    report.rows.map((r) => [r.name, r.total_videos, r.keys_count, r.log_count, r.last_day ? fmtDate(r.last_day) : '']));

  const repRows = report.rows.length ? report.rows.map((r, i) => `<tr>
    <td class="stt">${i + 1}</td>
    <td><b>${esc(r.name)}</b></td>
    <td><b class="text-accent" style="font-size:16px">${fmtNum(r.total_videos)}</b></td>
    <td><b>${fmtNum(r.keys_count)}</b> key</td>
    <td class="cell-sub">${fmtNum(r.log_count)} lần ghi</td>
    <td class="cell-sub nowrap">${r.last_day ? fmtDate(r.last_day) : '—'}</td>
  </tr>`).join('') : `<tr><td colspan="6"><div class="empty" style="padding:24px">Chưa có dữ liệu trong kỳ này.</div></td></tr>`;

  const logRows = logs.map((v) => `<tr>
    <td class="nowrap">${fmtDate(v.log_date)}</td>
    ${isAdmin ? `<td>${esc(v.user_name)}</td>` : ''}
    <td><b class="text-accent">${fmtNum(v.count)}</b></td>
    <td>${v.key_name ? esc(v.key_name) : '<span class="muted">—</span>'}</td>
    <td class="cell-sub">${esc(v.note || '')}</td>
    <td><div class="row-actions">
      <button class="btn-icon" data-vedit="${v.id}">✏️</button>
      <button class="btn-icon" data-vdel="${v.id}">🗑️</button>
    </div></td>
  </tr>`).join('');

  view.innerHTML = `
    <div class="toolbar">
      <div><label class="cell-sub">Từ ngày</label><input type="date" id="v-from" value="${videoFrom}"></div>
      <div><label class="cell-sub">Đến ngày</label><input type="date" id="v-to" value="${videoTo}"></div>
      <div class="spacer"></div>
      <div class="kpi" style="padding:10px 18px;margin:0"><div class="kpi-label">Tổng video kỳ này</div><div class="kpi-value text-accent" style="font-size:22px">${fmtNum(report.totalVideos)}</div></div>
    </div>
    <div class="panel">
      <div class="panel-title">📊 Báo cáo theo nhân viên &nbsp;<span class="muted" style="font-weight:400;font-size:13px">${fmtDate(videoFrom)} → ${fmtDate(videoTo)}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Nhân viên</th><th>Tổng video</th><th>Số key đã làm</th><th>Số lần ghi</th><th>Ngày gần nhất</th></tr></thead>
        <tbody>${repRows}</tbody></table></div>
    </div>
    <div class="panel">
      <div class="panel-title">📝 Chi tiết nhật ký</div>
      ${logs.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Ngày</th>${isAdmin ? '<th>Nhân sự</th>' : ''}<th>Số video</th><th>Key</th><th>Ghi chú</th><th></th></tr></thead>
        <tbody>${logRows}</tbody></table></div>`
        : '<div class="empty" style="padding:24px">Chưa có nhật ký nào trong kỳ này.</div>'}
    </div>`;

  $('#v-from').onchange = (e) => { videoFrom = e.target.value; renderVideos(); };
  $('#v-to').onchange = (e) => { videoTo = e.target.value; renderVideos(); };
  view.querySelectorAll('[data-vedit]').forEach((b) => b.onclick = () => { const v = logs.find((x) => x.id == b.dataset.vedit); videoForm(v); });
  view.querySelectorAll('[data-vdel]').forEach((b) => b.onclick = () => delVideo(b.dataset.vdel));
}

function videoForm(log = null) {
  const isEdit = !!log;
  const isAdmin = State.user.role === 'admin';
  const userOptions = State.users.map((u) => `<option value="${u.id}" ${log && log.user_id == u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  const keyOptions = keysCache.length ? keysCache.map((k) => `<option value="${k.id}" ${log && log.key_id == k.id ? 'selected' : ''}>${esc(k.channel_name)}</option>`).join('') : '';

  const form = el(`<form>
    <div class="form-grid">
      <div class="form-row"><label>Ngày</label><input type="date" id="v-date" value="${log?.log_date?.slice(0,10) || todayStr()}"></div>
      <div class="form-row"><label>Số video</label><input type="number" id="v-count" min="0" value="${log?.count ?? 1}"></div>
    </div>
    ${isAdmin ? `<div class="form-row"><label>Nhân sự</label><select id="v-user">${userOptions}</select></div>` : ''}
    <div class="form-row"><label>Key liên quan (tùy chọn)</label><select id="v-key"><option value="">— không gắn key —</option>${keyOptions}</select></div>
    <div class="form-row"><label>Ghi chú</label><textarea id="v-note" placeholder="Ghi chú…">${esc(log?.note || '')}</textarea></div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">${isEdit ? 'Lưu' : 'Ghi nhận'}</button></div>
  </form>`);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      log_date: form.querySelector('#v-date').value,
      count: form.querySelector('#v-count').value,
      key_id: form.querySelector('#v-key').value || null,
      note: form.querySelector('#v-note').value.trim(),
    };
    if (isAdmin) body.user_id = form.querySelector('#v-user').value;
    const unlock = lockBtn(form);
    try {
      if (isEdit) { await api('/videologs/' + log.id, { method: 'PUT', body }); toast('Đã cập nhật'); }
      else { await api('/videologs', { method: 'POST', body }); toast('Đã ghi nhận video'); }
      closeModal(); renderVideos();
    } catch (err) { toast(err.message, 'err'); } finally { unlock(); }
  };
  openModal(isEdit ? 'Sửa nhật ký' : 'Ghi nhận video', form);
}

async function delVideo(id) {
  if (!confirm('Xóa dòng nhật ký này?')) return;
  try { await api('/videologs/' + id, { method: 'DELETE' }); toast('Đã xóa'); renderVideos(); }
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
    </div>`;
  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const unlock = lockBtn($('#pw-form'));
    try {
      await api('/me/password', { method: 'POST', body: { oldPassword: $('#pw-old').value, newPassword: $('#pw-new').value } });
      toast('Đã đổi mật khẩu'); $('#pw-form').reset();
    } catch (err) { toast(err.message, 'err'); } finally { unlock(); }
  };
}

// ============ MENU MOBILE ============
function closeMenu() { $('#sidebar').classList.remove('open'); $('#app').classList.remove('menu-open'); }
function toggleMenu() { $('#sidebar').classList.toggle('open'); $('#app').classList.toggle('menu-open'); }

// ============ INIT ============
$('#login-form').onsubmit = doLogin;
$('#logout-btn').onclick = logout;
$('#modal-close').onclick = closeModal;
$('#modal-overlay').onclick = (e) => { if (e.target.id === 'modal-overlay') closeModal(); };
$('#menu-toggle').onclick = toggleMenu;
$('#backdrop').onclick = closeMenu;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

if (State.token) enterApp(); else { $('#login-screen').classList.remove('hidden'); }
