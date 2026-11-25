'use strict';
// 문명 전쟁 온라인 - 클라이언트
const R = RULES, IC = ICONS, $ = s => document.querySelector(s);
const ic = (n, s, c) => IC.svg(n, s || 16, c);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STOCK_KEYS = Object.keys(R.STOCK);
const CLIENT_VER = 4;
const RES_COLOR = { wheat: '#f2d16b', fish: '#7dd3fc', horse: '#d9b38c', copper: '#e0894a', stone: '#c4beb8', gold: '#f0c35a', iron: '#a9c1d9', saltpeter: '#f3efe2', coal: '#9ca3af' };

let ws = null, token = localStorage.getItem('civwar_token') || null, savedName = localStorage.getItem('civwar_myname') || '';
let myCiv = +(localStorage.getItem('civwar_civ') || 0);
let MAP = null, S = null, me = -1, FOG = '', OWNER = [], IMP = '', inGame = false, wantRejoin = false;
let unitById = new Map(), unitsAt = new Map(), cityAt = new Map(), cityById = new Map();
let sel = null, reachMap = new Map(), battleT = new Set(), bombT = new Set(), shootMode = false, shootT = new Set();
let autoNext = false, lastTurn = 0, chatUnread = 0, fxList = [], turnEndAt = 0, hoverTile = -1, deadShown = false, cityTab = 'prod', dipTab = 'civs';
const cam = { x: 0, y: 0, z: 1 };
const HS = 30, SQ3 = Math.sqrt(3);
let worldW = 0, worldH = 0, terrCv = null, overCv = null, kScale = 1, miniBase = null, miniOn = innerWidth > 500;

// ───────── 공통 ─────────
function toast(text, err) { const box = $('#toast'); while (box.children.length >= 3) box.firstChild.remove(); const d = document.createElement('div'); d.textContent = text; if (err) d.className = 'err'; box.appendChild(d); setTimeout(() => d.remove(), 3300); }
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); $('#homeBg').style.display = id === 'game' ? 'none' : ''; inGame = id === 'game'; if (inGame) resize(); }
function sendMsg(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); else toast('서버에 연결되어 있지 않습니다', true); }
function act(a, extra) { sendMsg(Object.assign({ t: 'act', a }, extra || {})); }
function lum(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
function P(id) { return S && S.players[id] && !S.players[id].removed ? S.players[id] : null; }
function pname(id) { const p = P(id); return p ? p.name : '사라진 문명'; }
function pcolor(id) { const p = P(id); return p ? p.color : '#666'; }
function cost(base) { return Math.max(1, Math.round(base * S.speed)); }
function techsObj() { return Object.fromEntries(S.my.techs.map(t => [t, 1])); }
function resChips(res, mult) {
  if (!res) return '';
  return Object.entries(res).map(([k, v]) => { const n = v * (mult || 1); const lack = S && (S.my.stock[k] || 0) < n; return `<span class="chip ${lack ? 'lack' : ''}" title="${R.STOCK[k].name}"><span style="color:${R.STOCK[k].color}">${ic(k, 13)}</span>${n}</span>`; }).join(' ');
}
function resText(res) { return Object.entries(res || {}).filter(([, v]) => v > 0).map(([k, v]) => `${R.STOCK[k].name} ${v}`).join(', '); }
function bar(v, max, col) { return `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v / Math.max(1, max) * 100))}%;background:${col}"></i></div>`; }
function hpCol(hp) { const p = hp / R.HPMAX * 100; return p > 60 ? '#4ade80' : p > 30 ? '#facc15' : '#ef5350'; }

// ───────── 연결 ─────────
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { $('#conn').classList.remove('on'); if ((inGame || wantRejoin) && token) sendMsg({ t: 'rejoin', token }); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
  ws.onclose = () => { if (inGame || wantRejoin) $('#conn').classList.add('on'); setTimeout(connect, 1500); };
}
setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"t":"ping"}'); }, 20000);
function onMsg(m) {
  switch (m.t) {
    case 'joined': token = m.token; localStorage.setItem('civwar_token', token); localStorage.setItem('civwar_myname', m.name); savedName = m.name; me = m.pid; break;
    case 'map':
      if (m.ver !== CLIENT_VER) { if (!sessionStorage.getItem('civwar_reloaded')) { sessionStorage.setItem('civwar_reloaded', '1'); location.reload(); return; } toast('서버와 화면 파일 버전이 다릅니다. 모든 파일을 같은 버전으로 올려 주세요', true); }
      else sessionStorage.removeItem('civwar_reloaded');
      MAP = m; FOG = ''; OWNER = []; IMP = ''; S = null; deadShown = false; buildTerrain(); show('game'); wantRejoin = false; break;
    case 'state': onState(m); break;
    case 'log': if (m.text) addFeed(m.text, m.turn); break;
    case 'fx': for (const it of m.items) fxList.push({ i: it.pos, txt: it.txt || (it.dmg ? '-' + it.dmg : ''), t0: performance.now(), good: !!it.txt }); dirty = true; break;
    case 'chat': addChat(m); break;
    case 'chatlog': $('#gChat').innerHTML = ''; m.chat.forEach(c => addChat(c, true)); feedItems = (m.log || []).map(l => ({ text: l.text, turn: l.turn, at: 0 })); renderFeed(); break;
    case 'battle': onBattle(m); break;
    case 'error': toast(m.msg, true); break;
    case 'kicked': toast(m.msg, true); goHome(); break;
    case 'left': goHome(); break;
    case 'rejoinFail': token = null; localStorage.removeItem('civwar_token'); wantRejoin = false; $('#conn').classList.remove('on'); goHome(); toast('이전 제국을 찾을 수 없어 새로 시작해야 합니다', true); break;
  }
}
function goHome() { inGame = false; wantRejoin = false; show('home'); refreshHome(); }

// ───────── 홈 ─────────
$('#logo').innerHTML = ic('swords', 26);
$('#howto').innerHTML = `<b>영구 월드</b> — 접속하면 거대한 세계의 빈 땅에 개척자·일꾼과 함께 떨어집니다. 다른 플레이어와 AI 문명이 같은 세계에서 함께 살아가요.<br>
<b>자원</b> — 일꾼으로 광산·목장·벌목장을 짓거나 직접 채집해 철·구리·말·석탄·초석을 모으세요. 강한 유닛·건물·기술·장비에 필요합니다.<br>
<b>외교</b> — 평화·불가침·국경 개방·동맹 조약, 교역 협정(수출·수입), 세계 시장 거래. 조약을 깨면 신뢰를 잃어요.<br>
<b>부대</b> — 한 칸에 병력을 무제한으로 모을 수 있고, 적 칸을 공격하면 전술을 고르는 <b>전투 미니게임</b>이 열립니다.<br>
<b>시간</b> — 세계는 일정 시간마다 자동으로 턴이 넘어가요. 신규 문명은 한동안 선전포고를 받지 않습니다.`;
function renderCivPick() {
  $('#civPick').innerHTML = R.CIVS.map((c, i) => `<button class="civbtn ${i === myCiv ? 'on' : ''}" data-civ="${i}"><span class="dot" style="background:${c.color}"></span>${c.name}<span class="dim" style="font-size:11px">${c.leader}</span></button>`).join('');
}
$('#civPick').onclick = e => { const b = e.target.closest('[data-civ]'); if (!b) return; myCiv = +b.dataset.civ; localStorage.setItem('civwar_civ', myCiv); renderCivPick(); };
$('#nameIn').value = localStorage.getItem('civwar_name') || '';
function refreshHome() {
  $('#contBox').style.display = token ? '' : 'none';
  if (token) $('#contBtn').innerHTML = `${ic('play', 16)} 내 제국으로 돌아가기${savedName ? ' · ' + esc(savedName) : ''}`;
  $('#enterBtn').innerHTML = token ? `${ic('flag', 16)} 새 문명으로 시작 (기존 제국은 남음)` : `${ic('map', 16)} 세계에 입장하기`;
  fetch('/status').then(r => r.json()).then(s => {
    $('#wstat').innerHTML = `<span>${ic('hourglass', 14)} 세계 <b>${s.turn}</b>턴</span><span>${ic('users', 14)} 접속 <b>${s.online}</b>명</span><span>${ic('flag', 14)} 문명 <b>${s.empires}</b>개 (AI ${s.ai})</span><span>${ic('map', 14)} ${s.W}×${s.H}</span><span>턴 간격 ${s.turnSec}초</span>`;
  }).catch(() => { $('#wstat').textContent = '세계 정보를 불러오지 못했습니다'; });
}
$('#enterBtn').onclick = () => {
  if (token && !confirm('새 문명으로 시작할까요? 지금 제국은 세계에 남지만 이 기기에서는 이어할 수 없게 됩니다.')) return;
  const n = $('#nameIn').value.trim() || '지도자' + Math.floor(Math.random() * 900 + 100);
  localStorage.setItem('civwar_name', n);
  sendMsg({ t: 'enter', name: n, civ: myCiv });
};
$('#contBtn').onclick = () => { wantRejoin = true; sendMsg({ t: 'rejoin', token }); };
renderCivPick(); refreshHome(); setInterval(() => { if (!inGame) refreshHome(); }, 15000);

// ───────── 채팅 ─────────
function addChat(c, silent) {
  const box = $('#gChat'); const d = document.createElement('div'); d.innerHTML = `<b style="color:${c.color || 'var(--gold)'}">${esc(c.from)}</b> ${esc(c.text)}`; box.appendChild(d); box.scrollTop = 1e9;
  while (box.children.length > 80) box.firstChild.remove();
  if (!silent && inGame && !$('#chatPanel').classList.contains('on')) { chatUnread++; renderNav(); if (c.from !== '공지') toast(`${c.from}: ${c.text}`); }
}
const sendChat = inp => { const t = inp.value.trim(); if (!t) return; sendMsg({ t: 'chat', text: t }); inp.value = ''; };

// ───────── 지도 렌더링 ─────────
const cv = $('#cv'), ctx = cv.getContext('2d');
const mini = $('#mini'), mctx = mini.getContext('2d');
let dpr = 1, dirty = true;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
  if (MAP) {
    const mw = innerWidth < 760 ? 120 : 200, mh = Math.round(mw * worldH / worldW);
    mini.style.width = mw + 'px'; mini.style.height = mh + 'px'; mini.width = mw * dpr; mini.height = mh * dpr;
    mini.style.display = miniOn ? '' : 'none';
    $('#feed').style.bottom = (miniOn ? mh + 18 : 10) + 'px';
  }
  clampCam(); dirty = true;
}
window.addEventListener('resize', resize);
function center(i) { const x = i % MAP.W, y = (i / MAP.W) | 0; return [(x + 0.5 * (y & 1)) * SQ3 * HS + SQ3 * HS / 2, y * 1.5 * HS + HS]; }
function hexPath(c, cx, cy, s) { c.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); const px = cx + s * Math.cos(a), py = cy + s * Math.sin(a); k ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath(); }
function corner(cx, cy, k, s) { const a = Math.PI / 180 * (60 * k - 30); return [cx + s * Math.cos(a), cy + s * Math.sin(a)]; }
const DIRS_E = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]], DIRS_O = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
const DIR_CORNER = [0, 5, 4, 3, 2, 1];
function nbDir(i, d) { const x = i % MAP.W, y = (i / MAP.W) | 0; const [dx, dy] = ((y & 1) ? DIRS_O : DIRS_E)[d]; const nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= MAP.W || ny >= MAP.H ? -1 : ny * MAP.W + nx; }
function hash(i, k) { let h = (i * 374761393 + k * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); const r = Math.min(255, (n >> 16) * f), g = Math.min(255, ((n >> 8) & 255) * f), b = Math.min(255, (n & 255) * f); return `rgb(${r | 0},${g | 0},${b | 0})`; }
// ───────── 지형·자원·시설 그래픽 ─────────
function lighten(hex, f) { return shade(hex, f); }
function edgeSeg(cx, cy, d, inset) { const k = DIR_CORNER[d]; return [corner(cx, cy, k, HS - inset), corner(cx, cy, (k + 1) % 6, HS - inset)]; }
function tree(c, x, y, s, dark, light) {
  c.fillStyle = '#00000033'; c.beginPath(); c.ellipse(x + 2, y + s * 0.9, s * 0.9, s * 0.35, 0, 0, 7); c.fill();
  c.fillStyle = '#4a3220'; c.fillRect(x - 1, y + s * 0.2, 2, s * 0.7);
  c.fillStyle = dark; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill();
  c.fillStyle = light; c.beginPath(); c.arc(x - s * 0.3, y - s * 0.3, s * 0.55, 0, 7); c.fill();
}
function pine(c, x, y, s) {
  c.fillStyle = '#00000030'; c.beginPath(); c.ellipse(x + 2, y + s * 0.6, s * 0.7, s * 0.25, 0, 0, 7); c.fill();
  for (let k = 0; k < 3; k++) { const w = s * (1 - k * 0.25), yy = y - k * s * 0.45; c.fillStyle = k % 2 ? '#2a5a34' : '#22492b'; c.beginPath(); c.moveTo(x, yy - s * 0.7); c.lineTo(x - w * 0.7, yy + s * 0.4); c.lineTo(x + w * 0.7, yy + s * 0.4); c.fill(); }
}
function buildTerrain() {
  worldW = MAP.W * SQ3 * HS + SQ3 * HS / 2; worldH = MAP.H * 1.5 * HS + HS / 2;
  kScale = Math.min(1.6, 3800 / worldW, 3800 / worldH);
  terrCv = document.createElement('canvas'); terrCv.width = Math.ceil(worldW * kScale); terrCv.height = Math.ceil(worldH * kScale);
  overCv = document.createElement('canvas'); overCv.width = terrCv.width; overCv.height = terrCv.height;
  const c = terrCv.getContext('2d'); c.scale(kScale, kScale);
  c.fillStyle = '#05070d'; c.fillRect(0, 0, worldW, worldH);
  const N = MAP.W * MAP.H, isOcean = i => MAP.terr[i] === 'ocean';
  // 바다 깊이
  const depth = new Array(N).fill(9);
  let frontier = []; for (let i = 0; i < N; i++) if (!isOcean(i)) { depth[i] = 0; frontier.push(i); }
  for (let d = 1; d < 5 && frontier.length; d++) { const nf = []; for (const i of frontier) for (let k = 0; k < 6; k++) { const n = nbDir(i, k); if (n >= 0 && depth[n] > d) { depth[n] = d; nf.push(n); } } frontier = nf; }
  for (let i = 0; i < N; i++) {
    const t = MAP.terr[i], T = R.TERRAIN[t], [cx, cy] = center(i), v = 0.94 + hash(i, 1) * 0.12;
    let base = T.color;
    if (t === 'ocean') base = ['#3b86b8', '#2f73a8', '#265f94', '#1f4f86', '#1b4579'][Math.min(4, depth[i] - 1)] || '#183e70';
    const g = c.createRadialGradient(cx - 7, cy - 9, 3, cx, cy, HS * 1.1);
    g.addColorStop(0, shade(base, 1.12 * v)); g.addColorStop(1, shade(base, 0.8 * v));
    hexPath(c, cx, cy, HS + 0.7); c.fillStyle = g; c.fill();
    c.save(); hexPath(c, cx, cy, HS); c.clip();
    if (t === 'ocean') {
      c.strokeStyle = depth[i] <= 1 ? '#ffffff38' : '#ffffff1c'; c.lineWidth = 1.3;
      for (let k = 0; k < 3; k++) { const ox = cx + (hash(i, 10 + k) - 0.5) * 34, oy = cy + (hash(i, 20 + k) - 0.5) * 30; c.beginPath(); c.arc(ox, oy, 4 + hash(i, 30 + k) * 3, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
      for (let d = 0; d < 6; d++) { const n = nbDir(i, d); if (n >= 0 && !isOcean(n)) { const [[x1, y1], [x2, y2]] = edgeSeg(cx, cy, d, 1); c.strokeStyle = '#e8f6ffaa'; c.lineWidth = 3; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); const [[a1, b1], [a2, b2]] = edgeSeg(cx, cy, d, 5); c.strokeStyle = '#d7f0ff44'; c.lineWidth = 2; c.beginPath(); c.moveTo(a1, b1); c.lineTo(a2, b2); c.stroke(); } }
    } else if (t === 'grass' || t === 'plains') {
      const dark = t === 'grass' ? '#3c7428' : '#7f8436', lite = t === 'grass' ? '#86c25a' : '#cfd06b';
      for (let k = 0; k < 14; k++) { const ox = cx + (hash(i, 10 + k) - 0.5) * 44, oy = cy + (hash(i, 40 + k) - 0.5) * 40; c.strokeStyle = k % 3 ? dark : lite; c.lineWidth = 1; c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox - 1.5, oy - 4); c.moveTo(ox, oy); c.lineTo(ox + 1.5, oy - 4); c.stroke(); }
      if (t === 'grass') for (let k = 0; k < 3; k++) if (hash(i, 70 + k) < 0.5) { c.fillStyle = ['#f4e36b', '#f6f6f6', '#e88bd0'][k]; c.beginPath(); c.arc(cx + (hash(i, 80 + k) - 0.5) * 36, cy + (hash(i, 90 + k) - 0.5) * 32, 1.4, 0, 7); c.fill(); }
      if (t === 'plains') { c.fillStyle = '#b9a15a40'; c.beginPath(); c.ellipse(cx + (hash(i, 5) - 0.5) * 20, cy + (hash(i, 6) - 0.5) * 16, 12, 6, hash(i, 7), 0, 7); c.fill(); }
    } else if (t === 'forest') {
      const pts = []; for (let k = 0; k < 7; k++) pts.push([cx + (hash(i, 10 + k) - 0.5) * 38, cy + (hash(i, 20 + k) - 0.5) * 34]);
      pts.sort((a, b) => a[1] - b[1]);
      for (const [x, y] of pts) tree(c, x, y, 6 + hash(i, x | 0) * 2, '#1f5220', '#3d7f32');
    } else if (t === 'hills') {
      for (let k = 0; k < 3; k++) {
        const ox = cx + (k - 1) * 14 + (hash(i, k) - 0.5) * 6, oy = cy + 6 + (hash(i, 5 + k) - 0.5) * 10, w = 13 + hash(i, 9 + k) * 4;
        const hg = c.createLinearGradient(ox - w, oy - w, ox + w, oy); hg.addColorStop(0, '#b9a26a'); hg.addColorStop(1, '#6b5832');
        c.fillStyle = hg; c.beginPath(); c.ellipse(ox, oy, w, w * 0.62, 0, Math.PI, 0); c.fill();
        c.strokeStyle = '#5a4a2a'; c.lineWidth = 1; c.stroke();
      }
    } else if (t === 'mountain') {
      const peaks = [[-8, 4, 22], [9, 8, 17], [0, 12, 12]];
      for (const [dx, dy, h] of peaks) {
        const x = cx + dx, y = cy + dy;
        c.fillStyle = '#6d6d76'; c.beginPath(); c.moveTo(x, y - h); c.lineTo(x - h * 0.75, y + 8); c.lineTo(x, y + 8); c.fill();
        c.fillStyle = '#4c4c55'; c.beginPath(); c.moveTo(x, y - h); c.lineTo(x + h * 0.75, y + 8); c.lineTo(x, y + 8); c.fill();
        c.fillStyle = '#f4f7fb'; c.beginPath(); c.moveTo(x, y - h); c.lineTo(x - h * 0.28, y - h * 0.58); c.lineTo(x - h * 0.05, y - h * 0.66); c.lineTo(x + h * 0.25, y - h * 0.56); c.fill();
      }
    } else if (t === 'desert') {
      for (let k = 0; k < 3; k++) { const oy = cy - 12 + k * 11 + (hash(i, k) - 0.5) * 4; c.strokeStyle = k % 2 ? '#c9ad66' : '#f0dc9a'; c.lineWidth = 2; c.beginPath(); c.moveTo(cx - 26, oy); c.quadraticCurveTo(cx, oy - 6 + hash(i, 3 + k) * 4, cx + 26, oy + 2); c.stroke(); }
      if (hash(i, 50) < 0.35) { const x = cx + (hash(i, 51) - 0.5) * 24, y = cy + (hash(i, 52) - 0.5) * 18; c.strokeStyle = '#4f7a3a'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y + 6); c.lineTo(x, y - 6); c.moveTo(x, y); c.lineTo(x - 4, y - 2); c.lineTo(x - 4, y - 5); c.moveTo(x, y - 2); c.lineTo(x + 4, y - 4); c.lineTo(x + 4, y - 7); c.stroke(); c.lineCap = 'butt'; }
    } else if (t === 'tundra') {
      for (let k = 0; k < 4; k++) { c.fillStyle = '#eef3f5b0'; c.beginPath(); c.ellipse(cx + (hash(i, 10 + k) - 0.5) * 34, cy + (hash(i, 20 + k) - 0.5) * 30, 6, 3, 0, 0, 7); c.fill(); }
      if (hash(i, 60) < 0.5) pine(c, cx + (hash(i, 61) - 0.5) * 20, cy + (hash(i, 62) - 0.5) * 16, 7);
    }
    if (t !== 'ocean') for (let d = 0; d < 6; d++) { const n = nbDir(i, d); if (n >= 0 && isOcean(n)) { const [[x1, y1], [x2, y2]] = edgeSeg(cx, cy, d, 2.5); c.strokeStyle = '#e6d59ccc'; c.lineWidth = 5; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); } }
    c.restore();
    hexPath(c, cx, cy, HS); c.strokeStyle = '#00000026'; c.lineWidth = 1; c.stroke();
  }
  miniBase = document.createElement('canvas'); miniBase.width = MAP.W * 2 + 1; miniBase.height = MAP.H * 2;
}
// 광물·자원을 실제 모양으로
function rocks(c, x, y, s, rock, fleck, seed) {
  const pts = [[-5, 2, 5], [3, 3, 4.5], [-1, -2, 4], [6, -1, 3]];
  for (const [dx, dy, r] of pts) {
    const rx = x + dx * s, ry = y + dy * s, rr = r * s;
    c.fillStyle = '#00000040'; c.beginPath(); c.ellipse(rx + 1.5, ry + rr * 0.7, rr, rr * 0.4, 0, 0, 7); c.fill();
    const g = c.createLinearGradient(rx - rr, ry - rr, rx + rr, ry + rr); g.addColorStop(0, shade(rock, 1.25)); g.addColorStop(1, shade(rock, 0.7));
    c.fillStyle = g; c.beginPath(); c.moveTo(rx - rr, ry + rr * 0.5); c.lineTo(rx - rr * 0.6, ry - rr * 0.7); c.lineTo(rx + rr * 0.4, ry - rr); c.lineTo(rx + rr, ry - rr * 0.1); c.lineTo(rx + rr * 0.7, ry + rr * 0.6); c.closePath(); c.fill();
    if (fleck) { c.fillStyle = fleck; for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(rx + (hash(seed, k + dx) - 0.5) * rr * 1.2, ry + (hash(seed, k + dy + 9) - 0.5) * rr, Math.max(0.9, rr * 0.22), 0, 7); c.fill(); } }
  }
}
function drawResource(c, r, x, y, i) {
  const s = 1;
  if (r === 'wheat') {
    for (let k = 0; k < 4; k++) { const sx = x - 6 + k * 4, sy = y + 6; c.strokeStyle = '#b8892a'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + 1, sy - 12); c.stroke(); c.fillStyle = '#f2cf5b'; for (let j = 0; j < 4; j++) { c.beginPath(); c.ellipse(sx + 1 + (j % 2 ? 1.6 : -1.6), sy - 12 + j * 2.4, 1.6, 1, j % 2 ? 0.6 : -0.6, 0, 7); c.fill(); } }
  } else if (r === 'fish') {
    for (const [dx, dy, f] of [[-4, -2, 1], [5, 4, -1]]) { const fx = x + dx, fy = y + dy; c.fillStyle = '#cfe8f5'; c.beginPath(); c.ellipse(fx, fy, 5, 2.4, 0, 0, 7); c.fill(); c.beginPath(); c.moveTo(fx - 5 * f, fy); c.lineTo(fx - 8 * f, fy - 3); c.lineTo(fx - 8 * f, fy + 3); c.fill(); c.fillStyle = '#123'; c.beginPath(); c.arc(fx + 3 * f, fy - 0.5, 0.7, 0, 7); c.fill(); }
  } else if (r === 'horse') {
    c.save(); c.translate(x, y); c.scale(0.9, 0.9);
    c.fillStyle = '#00000035'; c.beginPath(); c.ellipse(1, 8, 9, 2.5, 0, 0, 7); c.fill();
    c.fillStyle = '#8a5a32'; c.beginPath(); c.ellipse(0, 0, 7, 3.6, 0, 0, 7); c.fill();
    c.beginPath(); c.moveTo(5, -1); c.lineTo(8, -7); c.lineTo(11, -6); c.lineTo(8, 0); c.fill();
    c.strokeStyle = '#8a5a32'; c.lineWidth = 1.6; c.beginPath(); for (const lx of [-5, -2, 3, 5]) { c.moveTo(lx, 2); c.lineTo(lx, 8); } c.stroke();
    c.strokeStyle = '#3b2412'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(6, -4); c.lineTo(8.5, -8); c.moveTo(-7, -1); c.lineTo(-10, 3); c.stroke();
    c.restore();
  } else if (r === 'iron') rocks(c, x, y, s, '#6f7480', '#c9d6e6', i);
  else if (r === 'copper') rocks(c, x, y, s, '#8a6a52', '#e0894a', i), rocks(c, x + 1, y + 1, 0.0001, '#000', null, i);
  else if (r === 'coal') rocks(c, x, y, s, '#2b2b31', '#5d5d6a', i);
  else if (r === 'gold') { rocks(c, x, y, s, '#7c6a4c', '#ffd54a', i); c.strokeStyle = '#fff6b0'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 6, y - 9); c.lineTo(x + 6, y - 5); c.moveTo(x + 4, y - 7); c.lineTo(x + 8, y - 7); c.stroke(); }
  else if (r === 'stone') { for (const [dx, dy, w] of [[-6, 2, 7], [1, 2, 7], [-3, -3, 7]]) { c.fillStyle = '#9b958c'; c.fillRect(x + dx, y + dy, w, 4.5); c.fillStyle = '#c9c3b9'; c.fillRect(x + dx, y + dy, w, 1.4); c.strokeStyle = '#5f5a52'; c.lineWidth = 0.8; c.strokeRect(x + dx, y + dy, w, 4.5); } }
  else if (r === 'saltpeter') { for (const [dx, dy, h] of [[-4, 4, 9], [0, 4, 12], [4, 4, 8], [-1.5, 6, 6]]) { c.fillStyle = '#f5f2e8'; c.beginPath(); c.moveTo(x + dx, y + dy - h); c.lineTo(x + dx + 2.2, y + dy); c.lineTo(x + dx - 2.2, y + dy); c.fill(); c.fillStyle = '#c9c2ad'; c.beginPath(); c.moveTo(x + dx, y + dy - h); c.lineTo(x + dx + 2.2, y + dy); c.lineTo(x + dx, y + dy); c.fill(); } }
}
const ORE_COL = { iron: '#a9b8cc', copper: '#e0894a', coal: '#2b2b31', gold: '#ffd54a', stone: '#b5aea3', saltpeter: '#f3efe2' };
function drawImprovement(c, imp, cx, cy, i, r) {
  if (imp === 'farm') {
    c.save(); hexPath(c, cx, cy, HS - 3); c.clip();
    const cols = ['#c9b045', '#8fae3e', '#d8c35c', '#9fbd4a'];
    for (let k = 0; k < 4; k++) {
      const ox = cx - 22 + (k % 2) * 22, oy = cy - 6 + Math.floor(k / 2) * 14, w = 20, h = 12;
      c.fillStyle = cols[(k + (i % 3)) % 4]; c.save(); c.translate(ox + w / 2, oy + h / 2); c.rotate(-0.12); c.fillRect(-w / 2, -h / 2, w, h);
      c.strokeStyle = '#00000025'; c.lineWidth = 1; for (let j = -h / 2 + 2; j < h / 2; j += 3) { c.beginPath(); c.moveTo(-w / 2, j); c.lineTo(w / 2, j); c.stroke(); }
      c.strokeStyle = '#6b5a2e'; c.strokeRect(-w / 2, -h / 2, w, h); c.restore();
    }
    c.restore();
  } else if (imp === 'pasture') {
    c.strokeStyle = '#7a5530'; c.lineWidth = 1.6;
    c.beginPath(); c.ellipse(cx - 2, cy + 4, 20, 12, 0, 0.15, Math.PI * 1.85); c.stroke();
    c.beginPath(); c.ellipse(cx - 2, cy + 1, 20, 12, 0, 0.15, Math.PI * 1.85); c.stroke();
    c.fillStyle = '#5c3e22'; for (let a = 0.2; a < Math.PI * 1.85; a += 0.55) c.fillRect(cx - 2 + Math.cos(a) * 20 - 1, cy + 1 + Math.sin(a) * 12 - 3, 2, 7);
    c.fillStyle = '#8b3a2b'; c.beginPath(); c.moveTo(cx - 20, cy - 8); c.lineTo(cx - 14, cy - 14); c.lineTo(cx - 8, cy - 8); c.fill(); c.fillStyle = '#b07a4a'; c.fillRect(cx - 19, cy - 8, 10, 7);
  } else if (imp === 'lumber') {
    for (const [dx, dy] of [[-14, 6], [-6, 12], [10, 10]]) { c.fillStyle = '#6b4a2a'; c.beginPath(); c.ellipse(cx + dx, cy + dy, 3.5, 2, 0, 0, 7); c.fill(); c.fillStyle = '#d9b07a'; c.beginPath(); c.ellipse(cx + dx, cy + dy - 1.2, 3.5, 1.6, 0, 0, 7); c.fill(); }
    for (let k = 0; k < 3; k++) { c.fillStyle = '#8a5a32'; c.fillRect(cx - 4, cy - 2 - k * 3.5 + (k === 2 ? 0 : 0), 16 - k * 2, 3.2); c.fillStyle = '#e0bb85'; c.beginPath(); c.arc(cx - 4, cy - 0.4 - k * 3.5, 1.6, 0, 7); c.fill(); }
    c.fillStyle = '#5c3e22'; c.fillRect(cx - 18, cy - 12, 10, 7); c.fillStyle = '#7d3a28'; c.beginPath(); c.moveTo(cx - 20, cy - 12); c.lineTo(cx - 13, cy - 17); c.lineTo(cx - 6, cy - 12); c.fill();
  } else if (imp === 'mine') {
    const x = cx - 10, y = cy + 2;
    c.fillStyle = '#5b4a36'; c.beginPath(); c.moveTo(x - 11, y + 8); c.quadraticCurveTo(x, y - 14, x + 11, y + 8); c.fill();
    c.fillStyle = '#120d08'; c.beginPath(); c.moveTo(x - 6, y + 8); c.lineTo(x - 6, y - 1); c.quadraticCurveTo(x, y - 7, x + 6, y - 1); c.lineTo(x + 6, y + 8); c.fill();
    c.strokeStyle = '#a77a45'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 6, y + 8); c.lineTo(x - 6, y - 2); c.lineTo(x + 6, y - 2); c.lineTo(x + 6, y + 8); c.stroke();
    c.strokeStyle = '#6b6b6b'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 6, y + 9); c.lineTo(x + 22, y + 9); c.moveTo(x + 6, y + 11); c.lineTo(x + 22, y + 11); c.stroke();
    const ore = ORE_COL[r] || '#8e8676';
    c.fillStyle = '#3a3a40'; c.fillRect(x + 12, y + 3, 9, 5); c.fillStyle = ore; c.beginPath(); c.arc(x + 14, y + 3, 2, 0, 7); c.arc(x + 17.5, y + 2.5, 2.2, 0, 7); c.arc(x + 19, y + 3.5, 1.6, 0, 7); c.fill();
    c.fillStyle = '#222'; c.beginPath(); c.arc(x + 14, y + 8.5, 1.4, 0, 7); c.arc(x + 19, y + 8.5, 1.4, 0, 7); c.fill();
  }
}
function buildOverlay() {
  const c = overCv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, overCv.width, overCv.height); c.scale(kScale, kScale);
  const N = MAP.W * MAP.H, fog = FOG, own = OWNER;
  for (let i = 0; i < N; i++) {
    if (fog.charCodeAt(i) === 48) continue;
    const [cx, cy] = center(i);
    if (own[i] >= 0) { hexPath(c, cx, cy, HS); c.fillStyle = pcolor(own[i]) + '1f'; c.fill(); }
    if (cityAt.has(i)) continue;
    const im = IMP[i] && IMP[i] !== '.' ? R.IMP_BY_CODE[IMP[i]] : null;
    const r = MAP.res[i];
    if (im === 'farm') drawImprovement(c, im, cx, cy, i, r);
    if (r && !(im === 'mine' && r !== 'gold' && r !== 'stone' && false)) drawResource(c, r, cx + 11, cy + (im === 'mine' ? -8 : 6), i);
    if (im && im !== 'farm') drawImprovement(c, im, cx, cy, i, r);
  }
  for (let i = 0; i < N; i++) {
    const o = own[i]; if (o < 0 || fog.charCodeAt(i) === 48) continue;
    const [cx, cy] = center(i);
    for (let d = 0; d < 6; d++) {
      const n = nbDir(i, d);
      if (n >= 0 && own[n] === o) continue;
      const [[x1, y1], [x2, y2]] = edgeSeg(cx, cy, d, 2.5);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = '#000000a0'; c.lineWidth = 5; c.stroke();
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = pcolor(o); c.lineWidth = 3; c.stroke();
    }
  }
  for (let i = 0; i < N; i++) {
    const f = fog.charCodeAt(i) - 48; if (f === 2) continue;
    const [cx, cy] = center(i);
    hexPath(c, cx, cy, HS + 1.6); c.fillStyle = f === 0 ? '#05070d' : '#05070d80'; c.fill();
  }
  const m = miniBase.getContext('2d'), img = m.createImageData(miniBase.width, miniBase.height);
  for (let i = 0; i < N; i++) {
    const x = i % MAP.W, y = (i / MAP.W) | 0, f = fog.charCodeAt(i) - 48;
    let col = [5, 7, 13];
    if (f > 0) { const hex = own[i] >= 0 ? pcolor(own[i]) : R.TERRAIN[MAP.terr[i]].color; const n = parseInt(hex.slice(1), 16); col = [n >> 16, (n >> 8) & 255, n & 255]; if (f === 1) col = col.map(v => v * 0.55); }
    const ox = x * 2 + (y & 1);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = ((y * 2 + dy) * miniBase.width + ox + dx) * 4; img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255; }
  }
  m.putImageData(img, 0, 0);
}
function unitToken(c, type, owner, x, y, r, opts) {
  const U = R.UNITS[type], col = pcolor(owner), o = opts || {};
  c.save();
  c.shadowColor = '#000000a0'; c.shadowBlur = 6; c.shadowOffsetY = 2;
  const g = c.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.1, x, y, r * 1.1); g.addColorStop(0, shade(col, 1.25)); g.addColorStop(1, shade(col, 0.72));
  c.beginPath();
  if (U.civ) { if (c.roundRect) c.roundRect(x - r, y - r, r * 2, r * 2, r * 0.35); else c.rect(x - r, y - r, r * 2, r * 2); }
  else c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = g; c.fill(); c.restore();
  c.beginPath();
  if (U.civ) { if (c.roundRect) c.roundRect(x - r, y - r, r * 2, r * 2, r * 0.35); else c.rect(x - r, y - r, r * 2, r * 2); } else c.arc(x, y, r, 0, Math.PI * 2);
  c.lineWidth = o.sel ? 3.5 : 2; c.strokeStyle = o.sel ? '#ffe14a' : o.war ? '#ff4d4d' : '#0b0f1acc'; c.stroke();
  c.beginPath(); if (!U.civ) c.arc(x, y, r - 2.5, 0, 7); else if (c.roundRect) c.roundRect(x - r + 2.5, y - r + 2.5, r * 2 - 5, r * 2 - 5, r * 0.3); c.strokeStyle = '#ffffff40'; c.lineWidth = 1; c.stroke();
  IC.draw(c, type, x, y, r * 1.2, lum(col) > 0.6 ? '#141414' : '#ffffff', 2.4);
}
function drawStack(i, us) {
  const [cx, cy] = center(i), inCity = cityAt.has(i);
  const byOwner = new Map();
  for (const u of us) { if (!byOwner.has(u.o)) byOwner.set(u.o, []); byOwner.get(u.o).push(u); }
  const owners = [...byOwner.keys()];
  owners.forEach((o, k) => {
    const list = byOwner.get(o);
    const mil = list.filter(u => !R.UNITS[u.t].civ).sort((a, b) => (R.UNITS[b.t].str + (R.UNITS[b.t].rstr || 0)) - (R.UNITS[a.t].str + (R.UNITS[a.t].rstr || 0)));
    const civ = list.filter(u => R.UNITS[u.t].civ);
    const main = mil[0] || civ[0];
    const ox = owners.length > 1 ? (k ? 12 : -12) : 0;
    const r = inCity ? HS * 0.32 : HS * 0.46;
    const x = cx + ox + (inCity ? HS * 0.42 : 0), y = cy + (inCity ? HS * 0.5 : -2);
    const selected = sel && sel.kind === 'stack' && sel.tile === i && o === me;
    const war = o !== me && P(o) && P(o).d === 'war';
    if (list.length > 1) unitToken(ctx, main.t, o, x + 3, y - 3, r, { war });
    unitToken(ctx, main.t, o, x, y, r, { sel: selected, war });
    if (mil.length && civ.length) unitToken(ctx, civ[0].t, o, x - r * 0.95, y + r * 0.55, r * 0.5, {});
    const avgHp = list.reduce((s, u) => s + u.hp, 0) / list.length;
    if (avgHp < R.HPMAX) { ctx.fillStyle = '#000a'; ctx.fillRect(x - r, y + r + 2, r * 2, 4); ctx.fillStyle = hpCol(avgHp); ctx.fillRect(x - r, y + r + 2, r * 2 * avgHp / R.HPMAX, 4); }
    if (list.length > 1) {
      const t = String(list.length); ctx.font = 'bold 11px system-ui'; const w = Math.max(16, ctx.measureText(t).width + 8);
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x + r * 0.45, y - r - 4, w, 15, 7); else ctx.rect(x + r * 0.45, y - r - 4, w, 15);
      ctx.fillStyle = '#0a0e18'; ctx.fill(); ctx.strokeStyle = '#f0c35a'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#f0c35a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + r * 0.45 + w / 2, y - r + 3.5);
    }
    if (o === me) {
      const idle = list.some(u => u.mv > 0 && !u.f && !u.s && !u.w && !u.mi);
      if (idle) { ctx.beginPath(); ctx.arc(x - r * 0.8, y - r * 0.8, 3.8, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
      else if (list.every(u => u.f || !R.UNITS[u.t].str)) IC.draw(ctx, 'shield', x - r * 0.8, y - r * 0.8, 10, '#93c5fd', 2.6);
    }
    if (list.some(u => u.w)) IC.draw(ctx, 'hammer', x + r * 0.9, y + r * 0.6, 10, '#facc15', 2.6);
    if (list.some(u => u.mi)) IC.draw(ctx, 'mine', x + r * 0.9, y + r * 0.6, 10, '#fdba74', 2.6);
    if (list.some(u => u.b)) IC.draw(ctx, 'swords', x, y - r - 12, 14, '#ff6b6b', 2.6);
  });
}
// 도시: 인구에 따라 집이 늘어나고, 성벽·궁전·건물이 보임
function house(c, x, y, s, roof, wall) {
  c.fillStyle = '#00000040'; c.fillRect(x - s * 0.5 + 1.5, y + 1.5, s, s * 0.6);
  c.fillStyle = wall; c.fillRect(x - s * 0.5, y - s * 0.1, s, s * 0.65);
  c.fillStyle = roof; c.beginPath(); c.moveTo(x - s * 0.62, y - s * 0.05); c.lineTo(x, y - s * 0.6); c.lineTo(x + s * 0.62, y - s * 0.05); c.fill();
  c.fillStyle = '#3a2a1a'; c.fillRect(x - s * 0.1, y + s * 0.22, s * 0.2, s * 0.33);
}
function drawCity(c) {
  const [cx, cy] = center(c.p), col = pcolor(c.o), war = c.o !== me && P(c.o) && P(c.o).d === 'war';
  const b = c.b || [], has = k => b.includes(k);
  const era = b.some(k => ['factory', 'power_plant', 'research_lab', 'broadcast', 'launchpad'].includes(k)) ? 2 : b.some(k => ['university', 'bank', 'opera', 'stock_exchange', 'printing_house'].includes(k)) ? 1 : 0;
  const R0 = HS * 0.82;
  const gg = ctx.createRadialGradient(cx, cy, 2, cx, cy, R0); gg.addColorStop(0, era === 2 ? '#8d8a85' : '#a8916b'); gg.addColorStop(1, era === 2 ? '#5d5b58' : '#6e5a3e');
  ctx.beginPath(); ctx.ellipse(cx, cy + 2, R0, R0 * 0.78, 0, 0, 7); ctx.fillStyle = gg; ctx.fill();
  if (has('walls') || has('castle')) {
    ctx.beginPath(); ctx.ellipse(cx, cy + 2, R0, R0 * 0.78, 0, 0, 7); ctx.strokeStyle = '#8c857a'; ctx.lineWidth = has('castle') ? 5 : 3.5; ctx.stroke();
    ctx.strokeStyle = '#5c564d'; ctx.lineWidth = 1; ctx.stroke();
    if (has('castle')) for (let a = 0; a < 4; a++) { const tx = cx + Math.cos(a * Math.PI / 2 + 0.78) * R0, ty = cy + 2 + Math.sin(a * Math.PI / 2 + 0.78) * R0 * 0.78; ctx.fillStyle = '#9b948a'; ctx.fillRect(tx - 3.5, ty - 7, 7, 9); ctx.fillStyle = shade(col, 0.8); ctx.fillRect(tx - 4, ty - 9, 8, 2.5); }
  }
  const n = Math.min(4 + c.pop, 16), roof = shade(col, 0.78), wall = era === 2 ? '#d7d9dc' : '#eadcc0';
  const spots = [];
  for (let k = 0; k < n; k++) { const a = k * 2.399 + c.id, rr = 6 + 3.1 * Math.sqrt(k + 1); spots.push([cx + Math.cos(a) * rr * 0.95, cy + 3 + Math.sin(a) * rr * 0.68]); }
  spots.sort((a, b2) => a[1] - b2[1]);
  for (const [x, y] of spots) { if (Math.hypot(x - cx, (y - cy) * 1.3) < 7) continue; if (era === 2 && hash(x | 0, y | 0) < 0.4) { ctx.fillStyle = '#00000040'; ctx.fillRect(x - 2, y - 7, 6, 12); ctx.fillStyle = '#b8bec8'; ctx.fillRect(x - 3, y - 9, 6, 12); ctx.fillStyle = '#6b7f99'; for (let j = 0; j < 3; j++) ctx.fillRect(x - 2, y - 7 + j * 3.5, 4, 1.5); } else house(ctx, x, y, 6.5, roof, wall); }
  // 중심 건물
  if (c.cap) { ctx.fillStyle = '#efe3c8'; ctx.fillRect(cx - 7, cy - 4, 14, 9); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy - 4, 5.5, Math.PI, 0); ctx.fill(); ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy - 9.5); ctx.lineTo(cx, cy - 16); ctx.stroke(); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx, cy - 16); ctx.lineTo(cx + 6, cy - 14); ctx.lineTo(cx, cy - 12); ctx.fill(); }
  else house(ctx, cx, cy, 9, shade(col, 0.6), '#f1e6cf');
  // 대표 건물
  const marks = [];
  if (has('temple') || has('cathedral')) marks.push(x => { ctx.fillStyle = '#f3f0e6'; ctx.fillRect(x - 5, cy - 1 - 14, 10, 7); ctx.fillStyle = '#d9d2c0'; ctx.beginPath(); ctx.moveTo(x - 6, cy - 15); ctx.lineTo(x, cy - 20); ctx.lineTo(x + 6, cy - 15); ctx.fill(); });
  if (has('university') || has('observatory')) marks.push(x => { ctx.fillStyle = '#e6e8ee'; ctx.fillRect(x - 4, cy - 13, 8, 6); ctx.fillStyle = '#7fa6d9'; ctx.beginPath(); ctx.arc(x, cy - 13, 4, Math.PI, 0); ctx.fill(); });
  if (has('factory') || has('power_plant')) marks.push(x => { ctx.fillStyle = '#6b6f78'; ctx.fillRect(x - 5, cy - 12, 10, 6); ctx.fillStyle = '#4b4f57'; ctx.fillRect(x + 1, cy - 20, 3, 8); ctx.fillStyle = '#cfd4dc88'; ctx.beginPath(); ctx.arc(x + 3, cy - 23, 3, 0, 7); ctx.arc(x + 6, cy - 26, 2.4, 0, 7); ctx.fill(); });
  if (has('launchpad')) marks.push(x => { ctx.fillStyle = '#f2f4f7'; ctx.beginPath(); ctx.moveTo(x, cy - 24); ctx.lineTo(x + 3, cy - 18); ctx.lineTo(x + 3, cy - 8); ctx.lineTo(x - 3, cy - 8); ctx.lineTo(x - 3, cy - 18); ctx.fill(); ctx.fillStyle = '#ef5350'; ctx.fillRect(x - 3, cy - 10, 6, 2); });
  marks.slice(0, 3).forEach((fn, k) => fn(cx + (k - (Math.min(3, marks.length) - 1) / 2) * 13));
  const label = `${c.pop}  ${c.name}`;
  ctx.font = '600 12px system-ui,sans-serif';
  const w = ctx.measureText(label).width + 16, by = cy - HS * 1.12;
  ctx.save(); ctx.shadowColor = '#0009'; ctx.shadowBlur = 4;
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(cx - w / 2, by - 9, w, 18, 9); else ctx.rect(cx - w / 2, by - 9, w, 18);
  ctx.fillStyle = col; ctx.fill(); ctx.restore();
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(cx - w / 2, by - 9, w, 18, 9); else ctx.rect(cx - w / 2, by - 9, w, 18);
  ctx.strokeStyle = war ? '#ff3b3b' : '#000b'; ctx.lineWidth = war ? 2 : 1.2; ctx.stroke();
  ctx.fillStyle = lum(col) > 0.6 ? '#111' : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, cx, by + 1);
  if (c.cap) IC.draw(ctx, 'star', cx - w / 2 - 6, by, 11, '#f0c35a', 2.6);
  if (c.o !== me && cam.z > 0.6) { ctx.font = '10.5px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; const t = pname(c.o); ctx.strokeText(t, cx, by - 15); ctx.fillStyle = '#fff'; ctx.fillText(t, cx, by - 15); }
  if (c.hp < c.mhp) { const bw = 44; ctx.fillStyle = '#000b'; ctx.fillRect(cx - bw / 2, by + 11, bw, 5); ctx.fillStyle = '#ef5350'; ctx.fillRect(cx - bw / 2, by + 11, bw * c.hp / c.mhp, 5); }
  if (sel && sel.kind === 'city' && sel.id === c.id) { hexPath(ctx, cx, cy, HS - 2); ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 3; ctx.stroke(); }
}
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!MAP || !S) return;
  const z = cam.z * dpr;
  ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
  ctx.drawImage(terrCv, 0, 0, worldW, worldH);
  ctx.drawImage(overCv, 0, 0, worldW, worldH);
  const vx0 = cam.x - HS * 2, vy0 = cam.y - HS * 2, vx1 = cam.x + cv.clientWidth / cam.z + HS * 2, vy1 = cam.y + cv.clientHeight / cam.z + HS * 2;
  const vis = i => { const [x, y] = center(i); return x > vx0 && x < vx1 && y > vy0 && y < vy1; };
  for (const [i] of reachMap) { const [cx, cy] = center(i); hexPath(ctx, cx, cy, HS - 3); ctx.fillStyle = '#ffffff2e'; ctx.fill(); ctx.strokeStyle = '#ffffffa0'; ctx.lineWidth = 1.5; ctx.stroke(); }
  const drawT = (set, fill, stroke) => { for (const i of set) { const [cx, cy] = center(i); hexPath(ctx, cx, cy, HS - 3); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); } };
  if (shootMode) drawT(shootT, '#fb923c40', '#fb923c');
  else { drawT(bombT, '#fb923c33', '#fb923c'); drawT(battleT, '#ef535045', '#ff5a5a'); }
  if (sel && sel.kind === 'tile') { const [cx, cy] = center(sel.i); hexPath(ctx, cx, cy, HS - 2); ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 2.5; ctx.stroke(); }
  if (hoverTile >= 0) { const [cx, cy] = center(hoverTile); hexPath(ctx, cx, cy, HS - 1); ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 1.5; ctx.stroke(); }
  for (const c of S.cities) if (vis(c.p)) drawCity(c);
  for (const [i, us] of unitsAt) if (vis(i)) drawStack(i, us);
  const now = performance.now();
  fxList = fxList.filter(f => now - f.t0 < 1300);
  for (const f of fxList) {
    const [cx, cy] = center(f.i), t = (now - f.t0) / 1300;
    ctx.globalAlpha = 1 - t; ctx.font = 'bold 17px system-ui'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(f.txt, cx, cy - 12 - t * 30); ctx.fillStyle = f.good ? '#86efac' : '#ff6b6b'; ctx.fillText(f.txt, cx, cy - 12 - t * 30);
    ctx.globalAlpha = 1;
  }
  drawMini();
}
function drawMini() {
  if (!miniOn || !miniBase) return;
  const w = mini.width, h = mini.height;
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.imageSmoothingEnabled = false;
  mctx.drawImage(miniBase, 0, 0, w, h);
  const sx = w / worldW, sy = h / worldH;
  for (const c of S.cities) { const [x, y] = center(c.p); mctx.fillStyle = c.o === me ? '#fff' : pcolor(c.o); mctx.fillRect(x * sx - 2 * dpr, y * sy - 2 * dpr, 4 * dpr, 4 * dpr); }
  mctx.strokeStyle = '#ffe14a'; mctx.lineWidth = 1.5 * dpr;
  mctx.strokeRect(cam.x * sx, cam.y * sy, cv.clientWidth / cam.z * sx, cv.clientHeight / cam.z * sy);
}
function loop() { if (dirty || fxList.length) { draw(); dirty = false; } if (btlAnim) drawBattle(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

// ───────── 카메라·입력 ─────────
function clampCam() {
  if (!MAP) return;
  const vw = cv.clientWidth / cam.z, vh = cv.clientHeight / cam.z, m = 150;
  if (vw > worldW + 2 * m) cam.x = (worldW - vw) / 2; else cam.x = Math.max(-m, Math.min(worldW - vw + m, cam.x));
  if (vh > worldH + 2 * m) cam.y = (worldH - vh) / 2; else cam.y = Math.max(-m - 40, Math.min(worldH - vh + m, cam.y));
}
function centerOn(i) { const [cx, cy] = center(i); cam.x = cx - cv.clientWidth / cam.z / 2; cam.y = cy - cv.clientHeight / cam.z * (innerWidth < 760 ? 0.3 : 0.5); clampCam(); dirty = true; }
function minZoom() { return MAP ? Math.max(0.15, Math.min(cv.clientWidth / worldW, cv.clientHeight / worldH) * 0.9) : 0.3; }
function zoomAt(sx, sy, f) { const wx = sx / cam.z + cam.x, wy = sy / cam.z + cam.y; cam.z = Math.max(minZoom(), Math.min(2.6, cam.z * f)); cam.x = wx - sx / cam.z; cam.y = wy - sy / cam.z; clampCam(); dirty = true; }
function pickTile(sx, sy) {
  if (!MAP) return -1;
  const wx = sx / cam.z + cam.x, wy = sy / cam.z + cam.y;
  const ry = Math.round((wy - HS) / (1.5 * HS));
  let best = -1, bd = 1e9;
  for (let y = ry - 1; y <= ry + 1; y++) {
    if (y < 0 || y >= MAP.H) continue;
    const rx = Math.round((wx - SQ3 * HS / 2) / (SQ3 * HS) - 0.5 * (y & 1));
    for (let x = rx - 1; x <= rx + 1; x++) {
      if (x < 0 || x >= MAP.W) continue;
      const i = y * MAP.W + x, [cx, cy] = center(i), d = (cx - wx) ** 2 + (cy - wy) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  }
  return bd < HS * HS * 1.2 ? best : -1;
}
const ptrs = new Map(); let dragMoved = false, pinchD = 0, downAt = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 1) { dragMoved = false; downAt = { x: e.clientX, y: e.clientY }; } if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); dragMoved = true; } });
cv.addEventListener('pointermove', e => {
  const rect = cv.getBoundingClientRect();
  if (!ptrs.has(e.pointerId)) { if (e.pointerType === 'mouse') { const t = pickTile(e.clientX - rect.left, e.clientY - rect.top); if (t !== hoverTile) { hoverTile = t; dirty = true; showTip(t, e.clientX - rect.left, e.clientY - rect.top); } else moveTip(e.clientX - rect.left, e.clientY - rect.top); } return; }
  const prev = ptrs.get(e.pointerId), cur = { x: e.clientX, y: e.clientY };
  if (ptrs.size === 1) {
    if (!dragMoved && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) > 7) dragMoved = true;
    if (dragMoved) { cam.x -= (cur.x - prev.x) / cam.z; cam.y -= (cur.y - prev.y) / cam.z; clampCam(); dirty = true; }
  }
  ptrs.set(e.pointerId, cur);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinchD) zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, d / pinchD); pinchD = d; }
});
const endPtr = e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size === 0 && !dragMoved && e.type === 'pointerup') { const rect = cv.getBoundingClientRect(); const t = pickTile(e.clientX - rect.left, e.clientY - rect.top); if (t >= 0) tapTile(t, e.button === 2); }
  if (ptrs.size < 2) pinchD = 0;
};
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('pointerleave', () => { hoverTile = -1; $('#tileTip').style.display = 'none'; dirty = true; });
cv.addEventListener('wheel', e => { e.preventDefault(); const rect = cv.getBoundingClientRect(); zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());
let miniDrag = false;
const miniJump = e => { const r = mini.getBoundingClientRect(); const wx = (e.clientX - r.left) / r.width * worldW, wy = (e.clientY - r.top) / r.height * worldH; cam.x = wx - cv.clientWidth / cam.z / 2; cam.y = wy - cv.clientHeight / cam.z / 2; clampCam(); dirty = true; };
mini.addEventListener('pointerdown', e => { miniDrag = true; mini.setPointerCapture(e.pointerId); miniJump(e); });
mini.addEventListener('pointermove', e => { if (miniDrag) miniJump(e); });
mini.addEventListener('pointerup', () => miniDrag = false);
function tileYield(i) {
  const t = R.TERRAIN[MAP.terr[i]], r = MAP.res[i] ? R.RES[MAP.res[i]] : null;
  const y = { f: t.food + (r ? r.food : 0), p: t.prod + (r ? r.prod : 0), g: t.gold + (r ? r.gold : 0) };
  const im = IMP[i] && IMP[i] !== '.' ? R.IMPS[R.IMP_BY_CODE[IMP[i]]] : null;
  if (im) { y.f += im.food || 0; y.p += im.prod || 0; }
  return y;
}
function tileDesc(i, html) {
  const t = R.TERRAIN[MAP.terr[i]], r = MAP.res[i] ? R.RES[MAP.res[i]] : null, y = tileYield(i);
  const im = IMP[i] && IMP[i] !== '.' ? R.IMPS[R.IMP_BY_CODE[IMP[i]]].name : null;
  if (!html) return `${t.name}${r ? ' · ' + r.name : ''}${im ? ' · ' + im : ''}  식량${y.f} 생산${y.p} 금${y.g}${t.def ? ` 방어${t.def > 0 ? '+' : ''}${t.def}%` : ''}${!t.pass ? ' (통행 불가)' : t.move > 1 ? ' (이동 2)' : ''}`;
  return `<span class="row" style="gap:6px"><b>${t.name}</b>${r ? `<span class="chip"><span style="color:${RES_COLOR[MAP.res[i]]}">${ic(MAP.res[i], 13)}</span>${r.name}</span>` : ''}${im ? `<span class="chip">${ic(R.IMP_BY_CODE[IMP[i]], 13)}${im}</span>` : ''}</span>
    <span class="row mut" style="gap:10px;font-size:12px;margin-top:4px"><span>${ic('food', 13)} ${y.f}</span><span>${ic('prod', 13)} ${y.p}</span><span>${ic('coin', 13)} ${y.g}</span>${t.def ? `<span>${ic('shield', 13)} ${t.def > 0 ? '+' : ''}${t.def}%</span>` : ''}${t.move > 1 && t.pass ? `<span>${ic('boot', 13)} 2</span>` : ''}</span>`;
}
function showTip(i, x, y) {
  const tip = $('#tileTip');
  if (i < 0 || !S || FOG[i] === '0') { tip.style.display = 'none'; return; }
  let s = tileDesc(i);
  if (OWNER[i] >= 0) s += ` · ${pname(OWNER[i])} 영토`;
  if (reachMap.has(i)) s += ` · 남은 이동력 ${reachMap.get(i)}`;
  if (battleT.has(i)) s += ' · 공격(전투)'; else if (bombT.has(i)) s += ' · 포격';
  tip.textContent = s; tip.style.display = 'block'; moveTip(x, y);
}
function moveTip(x, y) { const tip = $('#tileTip'); tip.style.left = (x + 16) + 'px'; tip.style.top = (y + 16) + 'px'; }

// ───────── 선택·행동 ─────────
function rel(o) { return P(o) || {}; }
function isWar(o) { return o !== me && rel(o).d === 'war'; }
function friendly(o) { return o === me || rel(o).al; }
function canEnterLand(owner) { if (owner < 0 || owner === me) return true; const r = rel(owner); return r.d === 'war' || r.al || r.ob; }
function canStand(i) {
  const c = cityAt.get(i); if (c && c.o !== me) return false;
  const us = unitsAt.get(i); if (us && !us.every(x => friendly(x.o))) return false;
  return canEnterLand(OWNER[i] == null ? -1 : OWNER[i]);
}
function workerSlotOk(i, self) {
  if (!MAP.res[i] && !(IMP[i] && IMP[i] !== '.')) return true;
  if (cityAt.has(i)) return true;
  return (unitsAt.get(i) || []).filter(x => x !== self && R.UNITS[x.t].worker).length < 3;
}
function myUnitsAt(i) { return (unitsAt.get(i) || []).filter(u => u.o === me).sort((a, b) => (R.UNITS[a.t].civ ? 1 : 0) - (R.UNITS[b.t].civ ? 1 : 0) || (R.UNITS[b.t].str + (R.UNITS[b.t].rstr || 0)) - (R.UNITS[a.t].str + (R.UNITS[a.t].rstr || 0))); }
function pickedUnits() { if (!sel || sel.kind !== 'stack') return []; return [...sel.picked].map(id => unitById.get(id)).filter(u => u && u.o === me && u.p === sel.tile); }
function computeSel() {
  reachMap = new Map(); battleT = new Set(); bombT = new Set(); shootT = new Set();
  if (!sel || !S) return;
  if (sel.kind === 'stack') {
    const mine = myUnitsAt(sel.tile);
    if (!mine.length) { sel = null; return; }
    sel.picked = new Set([...sel.picked].filter(id => mine.some(u => u.id === id)));
    if (!unitById.get(sel.focus) || unitById.get(sel.focus).p !== sel.tile) sel.focus = mine[0].id;
    const movers = pickedUnits().filter(u => u.mv > 0 && !u.b && !u.w);
    let first = true;
    for (const u of movers) {
      const end = R.UNITS[u.t].worker ? (i => canStand(i) && workerSlotOk(i, u)) : canStand;
      const r = R.reach(MAP.W, MAP.H, MAP.terr, u.p, u.mv, canStand, end);
      if (first) { reachMap = r; first = false; }
      else { const nm = new Map(); for (const [k, v] of reachMap) if (r.has(k)) nm.set(k, Math.min(v, r.get(k))); reachMap = nm; }
    }
    const fighters = pickedUnits().filter(u => !R.UNITS[u.t].civ && u.mv > 0 && !u.a && !u.b);
    if (fighters.length) {
      for (const j of R.neighbors(sel.tile, MAP.W, MAP.H)) {
        if (!R.TERRAIN[MAP.terr[j]].pass) continue;
        const c = cityAt.get(j), us = (unitsAt.get(j) || []).filter(x => x.o !== me);
        if (!us.length && !(c && c.o !== me)) continue;
        if (c && c.o !== me && !isWar(c.o)) continue;
        if (us.some(x => !isWar(x.o))) continue;
        battleT.add(j);
      }
      for (const u of fighters) {
        const U = R.UNITS[u.t]; if (!U.rstr) continue;
        for (const j of R.inRadius(u.p, U.range, MAP.W, MAP.H)) {
          if (j === u.p) continue;
          const c = cityAt.get(j);
          if ((c && c.o !== me && isWar(c.o)) || (unitsAt.get(j) || []).some(x => isWar(x.o))) bombT.add(j);
        }
      }
    }
  } else if (sel.kind === 'city') {
    const c = cityById.get(sel.id);
    if (!c) { sel = null; return; }
    if (c.o === me && !c.shot) for (const j of R.inRadius(c.p, 2, MAP.W, MAP.H)) if ((unitsAt.get(j) || []).some(x => isWar(x.o))) shootT.add(j);
  }
}
function selectStack(tile, focusId, ctr) {
  const mine = myUnitsAt(tile);
  if (!mine.length) return;
  const idle = mine.filter(u => u.mv > 0 && !u.w && !u.b);
  sel = { kind: 'stack', tile, focus: focusId || (idle[0] || mine[0]).id, picked: new Set((idle.length ? idle : mine).filter(u => !u.w).map(u => u.id)) };
  shootMode = false; computeSel(); renderPanel(); dirty = true;
  if (ctr) centerOn(tile);
}
function select(s, ctr) { sel = s; shootMode = false; computeSel(); renderPanel(); dirty = true; if (ctr && s) { const p = s.kind === 'city' ? cityById.get(s.id)?.p : s.tile != null ? s.tile : s.i; if (p != null) centerOn(p); } }
function tapTile(i, right) {
  if (!S) return;
  if (sel && sel.kind === 'stack') {
    const picked = pickedUnits();
    const melee = picked.filter(u => !R.UNITS[u.t].civ && !R.UNITS[u.t].rstr && u.mv > 0 && !u.a);
    if (battleT.has(i) && (melee.length || !bombT.has(i))) { act('battle', { units: picked.filter(u => !R.UNITS[u.t].civ).map(u => u.id), to: i }); autoNext = true; return; }
    if (bombT.has(i)) { act('bombard', { units: picked.filter(u => R.UNITS[u.t].rstr).map(u => u.id), to: i }); autoNext = true; return; }
    if (reachMap.has(i)) { act('move', { units: picked.map(u => u.id), to: i }); sel.tile = i; autoNext = true; return; }
  }
  if (sel && sel.kind === 'city' && shootMode && shootT.has(i)) { act('cityShoot', { city: sel.id, to: i }); shootMode = false; return; }
  if (right) { select(null); return; }
  const mine = myUnitsAt(i), c = cityAt.get(i), foreign = (unitsAt.get(i) || []).filter(u => u.o !== me);
  const opts = [];
  if (mine.length) opts.push('stack');
  if (c) opts.push('city');
  if (foreign.length) opts.push('foreign');
  if (!opts.length) { select({ kind: 'tile', i }); return; }
  let cur = sel ? (sel.kind === 'stack' && sel.tile === i ? 'stack' : sel.kind === 'city' && c && sel.id === c.id ? 'city' : sel.kind === 'foreign' && sel.tile === i ? 'foreign' : null) : null;
  let next;
  if (cur) next = opts[(opts.indexOf(cur) + 1) % opts.length];
  else if (c && c.o === me && !mine.some(u => u.mv > 0 && !u.f && !u.s && !u.w)) next = 'city';
  else next = opts[0];
  if (next === 'stack') selectStack(i);
  else if (next === 'city') select({ kind: 'city', id: c.id });
  else select({ kind: 'foreign', tile: i });
}
function waiting() { return S && S.my.alive ? S.units.filter(u => u.o === me && u.mv > 0 && !u.f && !u.s && !u.w && !u.b && !u.mi) : []; }
function selectNext() {
  const w = waiting(); if (!w.length) { select(null); return false; }
  let k = 0;
  if (sel && sel.kind === 'stack') { const cur = w.findIndex(u => u.p === sel.tile); if (cur >= 0) { k = w.findIndex((u, j) => j > cur && u.p !== sel.tile); if (k < 0) k = w.findIndex(u => u.p !== sel.tile); if (k < 0) k = cur; } }
  selectStack(w[k].p, w[k].id, true); return true;
}

// ───────── 상태 ─────────
function onState(m) {
  const first = !S;
  S = m; me = m.me;
  let mapChanged = first;
  if (m.fog != null) { FOG = m.fog; mapChanged = true; }
  if (m.owner != null) { OWNER = m.owner; mapChanged = true; }
  if (m.imp != null) { IMP = m.imp; mapChanged = true; }
  unitById = new Map(); unitsAt = new Map(); cityAt = new Map(); cityById = new Map();
  for (const u of S.units) { unitById.set(u.id, u); if (!unitsAt.has(u.p)) unitsAt.set(u.p, []); unitsAt.get(u.p).push(u); }
  for (const c of S.cities) { cityAt.set(c.p, c); cityById.set(c.id, c); }
  turnEndAt = Date.now() + S.left;
  if (mapChanged && FOG) buildOverlay();
  if (first) {
    cam.z = innerWidth < 760 ? 0.85 : 1.05;
    const cap = S.cities.find(c => c.o === me && c.cap) || S.cities.find(c => c.o === me);
    const u = S.units.find(x => x.o === me && x.t === 'settler') || S.units.find(x => x.o === me);
    if (cap) centerOn(cap.p); else if (u) { centerOn(u.p); selectStack(u.p, u.id); }
    lastTurn = S.turn;
    if (!S.cities.some(c => c.o === me) && u) toast('개척자를 선택하고 [도시 건설]을 누르세요');
  }
  if (S.turn !== lastTurn) {
    lastTurn = S.turn; autoNext = false;
    if (!sel || (sel.kind !== 'city' && !$('#mBattle').classList.contains('on'))) { const w = waiting(); if (w.length && !(sel && sel.kind === 'stack' && pickedUnits().some(u => u.mv > 0))) selectStack(w[0].p, w[0].id); }
  }
  if (sel && sel.kind === 'stack' && autoNext) {
    autoNext = false;
    const left = myUnitsAt(sel.tile).filter(u => u.mv > 0 && !u.f && !u.s && !u.w);
    if (!left.length) { if (!selectNext()) select(null); }
    else { sel.picked = new Set(left.map(u => u.id)); if (!left.some(u => u.id === sel.focus)) sel.focus = left[0].id; }
  }
  if (sel && sel.kind === 'foreign' && !(unitsAt.get(sel.tile) || []).some(u => u.o !== me)) sel = null;
  computeSel();
  if (sel) renderPanel(); else $('#panel').classList.remove('on');
  renderHud(); renderFeed();
  if ($('#mTech').classList.contains('on')) renderTech();
  if ($('#mDip').classList.contains('on')) renderDip();
  if ($('#mIdeo').classList.contains('on')) renderIdeo();
  if ($('#mNation').classList.contains('on')) renderNation();
  if ($('#mMarket').classList.contains('on')) renderMarket();
  if ($('#mRank').classList.contains('on')) renderRank();
  if (!S.my.alive && !deadShown) { deadShown = true; $('#mDead').classList.add('on'); }
  if (S.my.alive) { deadShown = false; $('#mDead').classList.remove('on'); }
  dirty = true;
}

// ───────── 상단 바 ─────────
function renderNav() {
  const inc = S ? (S.props || []).filter(p => p.to === me).length : 0;
  const canPol = S && S.my.alive && !S.my.anarchy && S.my.culture >= S.my.pcost && Object.values(R.POLICY_TREES).some(t => (!t.tech || S.my.techs.includes(t.tech)) && t.policies.some(x => !S.my.policies.includes(x.id))) ? '!' : 0;
  const nav = [['bTech', 'tech', '기술'], ['bIdeo', 'ideology', '사상', canPol], ['bNation', 'stab', '국정', S && S.my.stab < 40 ? '!' : 0], ['bDip', 'handshake', '외교', inc], ['bMarket', 'scale', '시장'], ['bRank', 'crown', '순위'], ['bChat', 'chat', '채팅', chatUnread], ['bMenu', 'menu', '']];
  for (const [id, icon, label, badge] of nav) $('#' + id).innerHTML = `${ic(icon, 18)}${label ? `<span class="lbl">${label}</span>` : ''}${badge ? `<span class="badge">${badge}</span>` : ''}`;
  $('#bStock').innerHTML = `${ic('box', 18)}`;
  $('#bStock').style.display = innerWidth < 760 ? '' : 'none';
}
function renderHud() {
  const p = S.players[me], my = S.my;
  $('#hEmp').innerHTML = `<span class="sw" style="background:${p.color}"></span>${esc(p.name)}${my.prot ? ` <span title="신규 보호 ${my.prot}턴까지" style="color:var(--blue)">${ic('shield', 14)}</span>` : ''}`;
  $('#hTurn').innerHTML = `${ic('hourglass', 15)} ${S.turn}턴 <small id="timer"></small>`;
  $('#hGold').innerHTML = `<span style="color:var(--gold)">${ic('coin', 15)}</span> ${my.gold} <small class="${my.gpt >= 0 ? 'pos' : 'neg'}">${my.gpt >= 0 ? '+' : ''}${my.gpt}</small>`;
  $('#hSci').innerHTML = `<span style="color:var(--blue)">${ic('flask', 15)}</span> <small class="pos">+${my.spt}</small>`;
  $('#hRes').innerHTML = my.res ? `${ic('tech', 15)} ${R.TECHS[my.res].name} <small>${Math.min(my.sci, my.rcost)}/${my.rcost}</small>` : `<span class="neg">${ic('tech', 15)} 연구 선택</span>`;
  const st = my.stab == null ? 70 : my.stab, stCol = st >= 60 ? 'var(--green)' : st >= 40 ? 'var(--gold)' : 'var(--red)';
  $('#hStab').innerHTML = `<span style="color:${stCol}">${ic(st < 40 ? 'unrest' : 'stab', 15)}</span> ${st}<small>${my.stabT > st ? ' ↑' : my.stabT < st ? ' ↓' : ''}</small>`;
  $('#hCul').innerHTML = my.anarchy ? `<span class="neg">${ic('gov', 15)} 무정부 ~${my.anarchy}턴</span>` : `<span style="color:#f0abfc">${ic('culture', 15)}</span> ${my.culture}/${my.pcost} <small class="pos">+${my.cpt}</small>`;
  const humansOn = S.players.filter(q => !q.removed && !q.ai && q.online);
  $('#hOnline').innerHTML = `${ic('users', 15)} ${humansOn.length} <small>준비 ${humansOn.filter(q => q.ready).length}</small>`;
  $('#stockbar').innerHTML = STOCK_KEYS.map(k => `<span class="chip" title="${R.STOCK[k].name}" data-mkt="1"><span style="color:${R.STOCK[k].color}">${ic(k, 14)}</span>${my.stock[k] || 0}${my.sgain[k] ? `<small>+${my.sgain[k]}</small>` : ''}</span>`).join('') +
    `<span class="chip" title="무기고" data-arm="1">${ic('box', 14)} 장비 ${Object.values(my.armory || {}).reduce((s, v) => s + v, 0)}</span>`;
  const pb = $('#protBanner');
  if (my.prot) { pb.style.display = 'inline-flex'; pb.innerHTML = `${ic('shield', 13)} 신규 보호 ${my.prot}턴까지`; } else pb.style.display = 'none';
  renderNav();
  const eb = $('#endBtn'), small = $('#endSmall');
  eb.className = 'pri'; small.style.display = ''; small.innerHTML = `${ic('check', 13)} 바로 준비`;
  if (!my.alive) { eb.innerHTML = `${ic('flag', 18)} 다시 시작`; eb.dataset.mode = 'respawn'; small.style.display = 'none'; }
  else if (p.ready) { eb.innerHTML = `${ic('hourglass', 18)} 준비 완료 · 취소`; eb.className = 'wait'; eb.dataset.mode = 'unready'; small.style.display = 'none'; }
  else {
    const w = waiting(), noQ = S.cities.find(c => c.o === me && !c.q);
    if (w.length) { eb.innerHTML = `${ic('next', 18)} 다음 부대 (${new Set(w.map(u => u.p)).size})`; eb.dataset.mode = 'next'; }
    else if (!my.res && R.availTechs(techsObj()).length) { eb.innerHTML = `${ic('tech', 18)} 연구 선택`; eb.dataset.mode = 'tech'; }
    else if (noQ) { eb.innerHTML = `${ic('hammer', 18)} 생산 선택`; eb.dataset.mode = 'prod'; eb.dataset.city = noQ.id; }
    else { eb.innerHTML = `${ic('check', 18)} 준비 완료`; eb.dataset.mode = 'ready'; small.style.display = 'none'; }
  }
}
$('#stockbar').onclick = e => { if (e.target.closest('[data-mkt]')) openMarket(); else if (e.target.closest('[data-arm]')) openMarket(); };
setInterval(() => {
  const t = $('#timer'); if (!t || !S) return;
  const s = Math.max(0, Math.ceil((turnEndAt - Date.now()) / 1000));
  t.textContent = `· ${s}초`; t.style.color = s <= 5 ? 'var(--gold)' : '';
}, 250);
$('#endBtn').onclick = () => {
  const mode = $('#endBtn').dataset.mode;
  if (mode === 'next') selectNext();
  else if (mode === 'tech') openTech();
  else if (mode === 'prod') select({ kind: 'city', id: +$('#endBtn').dataset.city }, true);
  else if (mode === 'ready') act('ready');
  else if (mode === 'unready') act('unready');
  else if (mode === 'respawn') act('respawn');
};
$('#endSmall').onclick = () => act('ready');
let feedItems = [];
function addFeed(text, turn) { feedItems.push({ text, turn: turn || (S ? S.turn : 0), at: Date.now() }); if (feedItems.length > 100) feedItems.shift(); renderFeed(); }
function renderFeed() { const now = Date.now(); $('#feed').innerHTML = feedItems.slice(-6).map(f => `<div class="${now - f.at > 15000 ? 'old' : ''}">${esc(f.text)}</div>`).join(''); }
setInterval(renderFeed, 5000);
$('#feed').onclick = () => openLog();
function openLog() { $('#logTitle').innerHTML = `${ic('scroll', 18)} 기록`; $('#logList').innerHTML = feedItems.slice().reverse().map(f => `<div><span class="dim">[${f.turn}턴]</span> ${esc(f.text)}</div>`).join('') || '<span class="mut">아직 기록이 없습니다</span>'; $('#mLog').classList.add('on'); }

// ───────── 패널 ─────────
function panelHead(iconName, color, title, sub, civ) {
  const c = color || '#444';
  return `<div class="ph"><div class="big" style="background:${c};color:${lum(c) > 0.6 ? '#111' : '#fff'};border-radius:${civ ? 10 : 50}%">${ic(iconName, 22)}</div><div style="flex:1;min-width:0"><h3>${title}</h3><div class="sub">${sub}</div></div><button class="ghost sm" data-act="close">${ic('close', 16)}</button></div>`;
}
function relTags(o) {
  const q = P(o); if (!q) return '';
  let s = q.d === 'war' ? `<span class="tag war">${ic('swords', 11)} 전쟁</span>` : `<span class="tag peace">${ic('peace', 11)} 평화</span>`;
  if (q.al) s += ` <span class="tag ally">${ic('alliance', 11)} 동맹</span>`;
  if (q.ob) s += ` <span class="tag open">${ic('border', 11)} 국경 개방</span>`;
  if (q.nap) s += ` <span class="tag nap">${ic('nap', 11)} 불가침</span>`;
  if (q.prot) s += ` <span class="tag prot">${ic('shield', 11)} 보호</span>`;
  return s;
}
function renderPanel() {
  const panel = $('#panel');
  if (!sel || !S) { panel.classList.remove('on'); return; }
  panel.classList.add('on');
  if (sel.kind === 'stack') panel.innerHTML = stackPanel();
  else if (sel.kind === 'city') panel.innerHTML = cityPanel();
  else if (sel.kind === 'foreign') panel.innerHTML = foreignPanel();
  else if (sel.kind === 'tile') {
    const i = sel.i;
    if (FOG[i] === '0') panel.innerHTML = panelHead('help', '#333', '미탐험 지역', '유닛을 보내 탐험하세요');
    else panel.innerHTML = panelHead('map', '#2a3556', R.TERRAIN[MAP.terr[i]].name, OWNER[i] >= 0 ? esc(pname(OWNER[i])) + ' 영토' : '주인 없는 땅') + `<div class="pb">${tileDesc(i, true)}${OWNER[i] >= 0 && OWNER[i] !== me ? `<div class="row" style="margin-top:8px">${relTags(OWNER[i])}</div>` : ''}</div>`;
  }
}
function unitStats(u) {
  const U = R.UNITS[u.t], wa = u.eq && u.eq.weapon ? R.EQUIP[u.eq.weapon].atk : 0, ar = u.eq && u.eq.armor ? R.EQUIP[u.eq.armor].def : 0;
  return { atk: (U.rstr || U.str) + wa, def: U.str + ar, U };
}
function stackPanel() {
  const mine = myUnitsAt(sel.tile), f = unitById.get(sel.focus) || mine[0];
  const owner = OWNER[sel.tile], c = cityAt.get(sel.tile);
  let h = panelHead(f.t, pcolor(me), mine.length > 1 ? `부대 · ${mine.length}개 유닛` : R.UNITS[f.t].name, `${c ? esc(c.name) + ' · ' : ''}${R.TERRAIN[MAP.terr[sel.tile]].name}${owner >= 0 && owner !== me ? ' · ' + esc(pname(owner)) + ' 영토' : ''}`, R.UNITS[f.t].civ);
  h += '<div class="pb">';
  if (mine.length > 1) {
    const allPicked = mine.every(u => sel.picked.has(u.id));
    h += `<div class="row" style="margin-bottom:6px"><span class="mut" style="font-size:12px">체크한 유닛이 함께 이동·공격합니다</span><div class="sp"></div><button class="sm" data-act="pickall">${allPicked ? '전체 해제' : '전체 선택'}</button><button class="sm" data-act="gfort">${ic('shield', 13)} 부대 요새화</button></div>`;
    h += '<div class="ulist">' + mine.map(u => {
      const st = unitStats(u), U = st.U, col = pcolor(me);
      const status = u.b ? '전투 중' : u.mi ? '상주 채굴 중' : u.w ? `${R.IMPS[u.w.imp].name} 건설 ${u.w.left}턴` : u.f ? '요새화' : u.s ? '대기' : u.mv > 0 ? `이동 ${u.mv}/${u.mm}` : '행동 완료';
      return `<div class="urow ${u.id === f.id ? 'focus' : ''}" data-focus="${u.id}"><input type="checkbox" data-pick="${u.id}" ${sel.picked.has(u.id) ? 'checked' : ''}>
        <span class="tk ${U.civ ? 'civ' : ''}" style="background:${col};color:${lum(col) > 0.6 ? '#111' : '#fff'}">${ic(u.t, 16)}</span>
        <span class="nm"><b>${U.name}${u.v ? ' ' + ic('star', 11) : ''}</b><small>${status}${U.str ? ` · 공 ${st.atk} 방 ${st.def}` : ''}</small>${bar(u.hp, R.HPMAX, hpCol(u.hp))}</span></div>`;
    }).join('') + '</div><div class="sec">선택한 유닛</div>';
  }
  h += unitDetail(f);
  h += '</div>';
  return h;
}
function unitDetail(u) {
  const st = unitStats(u), U = st.U;
  let h = `<div class="kv"><div>${ic('heart', 14)}<b>${u.hp}/${R.HPMAX}</b></div><div>${ic('boot', 14)}<b>${u.mv}/${u.mm}</b></div>${U.str ? `<div>${ic(U.rstr ? 'archer' : 'atk', 14)}<b>${st.atk}</b></div><div>${ic('shield', 14)}<b>${st.def}</b></div>` : `<div class="dim">민간</div><div class="dim">—</div>`}</div>`;
  if (U.desc) h += `<div class="mut" style="font-size:12px;margin-top:6px">${U.desc}${U.range ? ` · 사거리 ${U.range}` : ''}${U.worker ? ' · 자원·시설 칸에는 일꾼이 최대 3명까지 들어갈 수 있고, 여럿이 함께 지으면 빨리 완성돼요' : ''}</div>`;
  h += `<div style="margin-top:8px;font-size:13px">${tileDesc(u.p, true)}</div>`;
  const acts = [];
  const owner = OWNER[u.p];
  if (u.t === 'settler') acts.push(`<button class="pri wide" data-act="found">${ic('city', 15)} 도시 건설</button>`);
  if (U.worker) {
    const imp = R.impFor(MAP.terr[u.p], MAP.res[u.p]);
    const has = IMP[u.p] && IMP[u.p] !== '.' && imp && R.IMPS[imp].code === IMP[u.p];
    if (u.w) acts.push(`<button class="wide" disabled>${ic('hammer', 15)} ${R.IMPS[u.w.imp].name} 건설 중 (${u.w.left}턴)</button>`);
    else if (imp && !has) {
      const ok = owner === me && !cityAt.has(u.p) && R.impTechOk(MAP.terr[u.p], MAP.res[u.p], techsObj());
      const why = owner !== me ? '내 영토 밖' : cityAt.has(u.p) ? '도시 칸' : !R.impTechOk(MAP.terr[u.p], MAP.res[u.p], techsObj()) ? `${R.TECHS[(MAP.res[u.p] && R.RES[MAP.res[u.p]].tech) || 'mining'].name} 필요` : `${R.IMPS[imp].turns}턴`;
      acts.push(`<button class="wide ${ok ? 'pri' : ''}" data-act="improve" ${ok && u.mv > 0 ? '' : 'disabled'}>${ic(imp, 15)} ${R.IMPS[imp].name} 짓기 <span class="mut" style="font-size:11px">${why}</span></button>`);
    }
    const r = MAP.res[u.p], t = MAP.terr[u.p];
    const hv = r && R.RES[r].stock ? R.STOCK[R.RES[r].stock].name : r === 'gold' ? '금 4' : t === 'forest' ? '목재' : t === 'hills' ? '석재' : null;
    const imC = IMP[u.p] && IMP[u.p] !== '.' ? R.IMP_BY_CODE[IMP[u.p]] : null;
    if (imC && imC !== 'farm' && owner === me) { const crew = (unitsAt.get(u.p) || []).filter(x => R.UNITS[x.t].worker && x.mi).length; acts.push(`<button class="wide ${u.mi ? 'on' : ''}" data-act="mine">${ic('mine', 15)} ${u.mi ? '상주 채굴 중단' : '상주 채굴 (매 턴 +1)'} <span class="mut" style="font-size:11px">이 칸 일꾼 ${(unitsAt.get(u.p) || []).filter(x => R.UNITS[x.t].worker).length}/3 · 채굴 ${crew}</span></button>`); }
    if (hv) acts.push(`<button data-act="harvest" ${u.mv > 0 && !u.h && (owner < 0 || owner === me) ? '' : 'disabled'}>${ic('harvest', 15)} 채집: ${hv}</button>`);
  }
  if (!U.civ) {
    acts.push(`<button data-act="fortify">${ic('shield', 15)} ${u.f ? '요새화 해제' : '요새화'}</button>`);
    if (IMP[u.p] && IMP[u.p] !== '.' && owner >= 0 && isWar(owner)) acts.push(`<button data-act="pillage" ${u.mv > 0 ? '' : 'disabled'}>${ic('pillage', 15)} 약탈</button>`);
  }
  acts.push(`<button data-act="skip">${ic('pause', 15)} 이번 턴 대기</button>`);
  acts.push(`<button data-act="next">${ic('next', 15)} 다음 부대</button>`);
  acts.push(`<button class="danger" data-act="disband">${ic('trash', 15)} 해산</button>`);
  h += `<div class="acts">${acts.join('')}</div>`;
  if (!U.civ) {
    h += `<div class="sec">장비 ${owner === me ? '' : '<span class="dim" style="text-transform:none">(내 영토에서만 교체)</span>'}</div><div class="slots">`;
    for (const slot of Object.keys(R.SLOTS)) {
      if (slot === 'mount' && (U.mounted || U.siege)) continue;
      const cur = u.eq && u.eq[slot];
      const avail = Object.keys(S.my.armory || {}).filter(k => S.my.armory[k] > 0 && R.EQUIP[k].slot === slot && R.canEquip(u.t, k));
      const E = cur ? R.EQUIP[cur] : null;
      h += `<div class="slot ${cur ? 'full' : ''}">${ic(cur || (slot === 'weapon' ? 'iron_w' : slot === 'armor' ? 'leather_a' : 'warhorse'), 16, cur ? 'goldc' : 'dim')}
        <span style="flex:none;width:34px" class="mut">${R.SLOTS[slot]}</span>
        ${E ? `<span style="flex:1">${E.name} <span class="pos">${E.atk ? '+' + E.atk + ' 공' : E.def ? '+' + E.def + ' 방' : '+' + E.mv + ' 이동'}</span></span>${owner === me ? `<button class="sm ghost" data-unequip="${slot}">해제</button>` : ''}`
        : avail.length && owner === me ? `<select data-equip="1"><option value="">무기고에서 장착…</option>${avail.map(k => `<option value="${k}">${R.EQUIP[k].name} (${S.my.armory[k]}) ${R.EQUIP[k].atk ? '+' + R.EQUIP[k].atk + '공' : R.EQUIP[k].def ? '+' + R.EQUIP[k].def + '방' : '+' + R.EQUIP[k].mv + '이동'}</option>`).join('')}</select>`
        : `<span class="dim" style="flex:1;font-size:12px">비어 있음${avail.length ? '' : ' · 도시의 [제작] 탭에서 만들 수 있어요'}</span>`}</div>`;
    }
    h += '</div>';
  }
  const tips = [];
  if (reachMap.size) tips.push('흰 칸: 이동');
  if (battleT.size) tips.push('<span style="color:#ff7b7b">빨간 칸: 공격(전투)</span>');
  if (bombT.size) tips.push('<span style="color:#fdba74">주황 칸: 포격</span>');
  if (tips.length) h += `<div class="mut" style="font-size:12px;margin-top:10px">${tips.join(' · ')}</div>`;
  return h;
}
function foreignPanel() {
  const us = (unitsAt.get(sel.tile) || []).filter(u => u.o !== me);
  const o = us[0].o;
  let h = panelHead(us[0].t, pcolor(o), `${esc(pname(o))}의 부대`, `${us.length}개 유닛 · ${R.TERRAIN[MAP.terr[sel.tile]].name}`);
  h += `<div class="pb"><div class="row">${relTags(o)}</div><div class="ulist" style="margin-top:8px">` + us.map(u => {
    const st = unitStats(u), col = pcolor(u.o);
    return `<div class="urow" style="cursor:default"><span class="tk ${st.U.civ ? 'civ' : ''}" style="background:${col};color:${lum(col) > 0.6 ? '#111' : '#fff'}">${ic(u.t, 16)}</span><span class="nm"><b>${st.U.name}</b><small>${st.U.str ? `공 ${st.atk} 방 ${st.def}` : '민간'}${u.f ? ' · 요새화' : ''}${u.eq && Object.keys(u.eq).length ? ' · 장비 ' + Object.values(u.eq).map(k => R.EQUIP[k].name).join(', ') : ''}</small>${bar(u.hp, R.HPMAX, hpCol(u.hp))}</span></div>`;
  }).join('') + `</div>${!isWar(o) ? `<div class="mut" style="font-size:12px;margin-top:8px">공격하려면 [외교]에서 선전포고가 필요합니다</div>` : ''}</div>`;
  return h;
}
function cityPanel() {
  const c = cityById.get(sel.id);
  if (!c) return '';
  let h = panelHead('city', pcolor(c.o), `${esc(c.name)}${c.cap ? ' ' + ic('star', 13, 'goldc') : ''}`, `인구 ${c.pop} · ${esc(pname(c.o))}${c.cap ? ' · 수도' : ''}`, true);
  if (c.o !== me) {
    return h + `<div class="pb"><div class="row">${relTags(c.o)}</div><div class="kv" style="margin-top:8px;grid-template-columns:repeat(2,1fr)"><div>${ic('shield', 14)}<b>${c.str}</b>방어력</div><div>${ic('heart', 14)}<b>${c.hp}/${c.mhp}</b>체력</div></div>
      <div class="mut" style="font-size:12px;margin-top:8px">${isWar(c.o) ? '부대로 공격해 체력을 0으로 만들면 근접 유닛이 점령합니다' : '공격하려면 [외교]에서 선전포고가 필요합니다'}</div></div>`;
  }
  const y = c.y, surplus = y.food - y.upkeep;
  h += `<div class="pb" style="padding-bottom:4px"><div class="kv"><div style="color:#bef264">${ic('food', 14)}<b>${surplus >= 0 ? '+' : ''}${surplus}</b></div><div style="color:#fdba74">${ic('prod', 14)}<b>${y.prod}</b></div><div style="color:var(--gold)">${ic('coin', 14)}<b>${y.gold}</b></div><div style="color:var(--blue)">${ic('flask', 14)}<b>${y.sci}</b></div><div style="color:#f0abfc">${ic('culture', 14)}<b>${y.cul}</b></div></div>
    <div class="row mut" style="font-size:12px;margin-top:8px"><span>성장 ${c.food}/${c.need} · ${surplus <= 0 ? '<span class="neg">정체</span>' : Math.ceil((c.need - c.food) / surplus) + '턴'}</span><div class="sp"></div><span>${ic('shield', 12)} ${c.str} · ${ic('heart', 12)} ${c.hp}/${c.mhp}</span></div>${bar(c.food, c.need, '#86efac')}`;
  if (c.q) {
    const d = c.q.kind === 'unit' ? R.UNITS[c.q.type] : c.q.kind === 'building' ? R.BUILDINGS[c.q.type] : c.q.kind === 'equip' ? R.EQUIP[c.q.type] : R.PROCESSES[c.q.type];
    h += `<div class="pitem cur" style="margin-top:10px;cursor:default">${ic(c.q.kind === 'process' ? (c.q.type === 'wealth' ? 'coin' : 'flask') : c.q.type, 20)}<span class="nm"><b>${d.name}</b>`;
    if (c.q.kind !== 'process') {
      const t = Math.max(1, Math.ceil((c.qc - c.prod) / Math.max(1, y.prod)));
      h += `<small>${c.prod}/${c.qc} · ${t}턴 ${resChips(d.res)}</small>${bar(c.prod, c.qc, '#f0c35a')}</span><button class="sm" data-act="buy" ${S.my.gold < c.buy || c.bought ? 'disabled' : ''}>${ic('coin', 13)} ${c.buy}</button></div>`;
      if (c.stall) h += `<div class="neg" style="font-size:12px;margin-top:4px">자원이 부족해 생산이 멈췄습니다 — 채집·시장·교역으로 구하세요</div>`;
      if (c.q.type === 'settler' && c.pop < 2) h += `<div class="neg" style="font-size:12px;margin-top:4px">개척자는 인구 2 이상일 때 완성됩니다</div>`;
    } else h += `<small>${d.desc}</small></span></div>`;
  } else h += `<div class="neg" style="margin-top:10px;font-size:13px">생산 중인 항목이 없습니다 — 아래에서 고르세요</div>`;
  if (shootT.size) h += `<button class="${shootMode ? 'on' : 'pri'}" style="width:100%;margin-top:8px" data-act="shoot">${ic('target', 15)} ${shootMode ? '포격 취소' : `도시 포격 (대상 ${shootT.size})`}</button>`;
  h += '</div>';
  h += `<div class="tabs">${[['prod', '생산'], ['equip', '제작'], ['build', '건물'], ['info', '정보']].map(([k, n]) => `<button class="${cityTab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div><div class="pb">`;
  const T = techsObj(), turns = base => Math.max(1, Math.ceil(cost(base) / Math.max(1, y.prod)));
  const isCur = (k, t) => c.q && c.q.kind === k && c.q.type === t ? 'cur' : '';
  if (cityTab === 'prod') {
    h += '<div class="plist">' + R.availUnits(T).map(k => {
      const U = R.UNITS[k];
      return `<button class="pitem ${isCur('unit', k)}" data-prod="unit" data-type="${k}">${ic(k, 20)}<span class="nm"><b>${U.name}</b><small>${U.str ? `공 ${U.rstr || U.str} · 방 ${U.str} · 이동 ${U.moves}` : U.desc}${U.res ? ' ' + resChips(U.res) : ''}</small></span><span class="cost">${ic('prod', 12)} ${cost(U.cost * 0.5)}<br>${turns(U.cost * 0.5)}턴</span></button>`;
    }).join('') + '</div>';
    if (c.b.includes('launchpad')) {
      h += `<div class="sec">우주 프로젝트</div><div class="plist">` + Object.entries(R.PROJECTS).map(([k, Pj]) => {
        const done = (S.my.space || {})[k] || 0, locked = !T[Pj.tech], full = done >= Pj.max || S.my.launched;
        return `<button class="pitem ${isCur('project', k)}" data-prod="project" data-type="${k}" ${locked || full ? 'disabled' : ''}>${ic(k, 20)}<span class="nm"><b>${Pj.name} <span class="mut" style="font-weight:400">${done}/${Pj.max}</span></b><small>${locked ? R.TECHS[Pj.tech].name + ' 필요' : Pj.desc} ${resChips(Pj.res)}</small></span><span class="cost">${ic('prod', 12)} ${cost(Pj.cost)}<br>${turns(Pj.cost)}턴</span></button>`;
      }).join('') + '</div>';
    }
    h += `<div class="sec">기타</div><div class="plist">` + Object.entries(R.PROCESSES).map(([k, Pp]) => `<button class="pitem ${isCur('process', k)}" data-prod="process" data-type="${k}">${ic(k === 'wealth' ? 'coin' : 'flask', 20)}<span class="nm"><b>${Pp.name}</b><small>${Pp.desc}</small></span></button>`).join('') + '</div>';
  } else if (cityTab === 'equip') {
    const eq = R.availEquip(T);
    h += `<div class="mut" style="font-size:12px;margin-bottom:6px">제작한 장비는 무기고에 보관되고, 내 영토 안의 유닛에 장착할 수 있어요.</div>`;
    h += eq.length ? '<div class="plist">' + eq.map(k => { const E = R.EQUIP[k]; return `<button class="pitem ${isCur('equip', k)}" data-prod="equip" data-type="${k}">${ic(k, 20)}<span class="nm"><b>${E.name} <span class="pos" style="font-weight:400">${E.atk ? '+' + E.atk + ' 공격' : E.def ? '+' + E.def + ' 방어' : '+' + E.mv + ' 이동'}</span></b><small>무기고 ${S.my.armory[k] || 0}개 ${resChips(E.res)}</small></span><span class="cost">${ic('prod', 12)} ${cost(E.cost)}<br>${turns(E.cost)}턴</span></button>`; }).join('') + '</div>'
      : `<div class="mut">제작 가능한 장비가 없습니다. [목축]·[청동기] 기술을 연구하세요.</div>`;
    const locked = Object.keys(R.EQUIP).filter(k => !eq.includes(k));
    if (locked.length) h += `<div class="sec">잠김</div><div class="mut" style="font-size:12px">${locked.map(k => `${R.EQUIP[k].name}(${R.TECHS[R.EQUIP[k].tech].name})`).join(' · ')}</div>`;
  } else if (cityTab === 'build') {
    const bs = R.availBuildings(T, c.b);
    h += bs.length ? '<div class="plist">' + bs.map(k => { const B = R.BUILDINGS[k]; return `<button class="pitem ${isCur('building', k)}" data-prod="building" data-type="${k}">${ic(k, 20)}<span class="nm"><b>${B.name}</b><small>${B.desc} ${resChips(B.res)}</small></span><span class="cost">${ic('prod', 12)} ${cost(B.cost)}<br>${turns(B.cost)}턴</span></button>`; }).join('') + '</div>' : '<div class="mut">지금 지을 수 있는 건물이 없습니다</div>';
    if (c.b.length) h += `<div class="sec">건설됨</div><div class="row" style="gap:5px">${c.b.map(b => `<span class="chip" title="${R.BUILDINGS[b].desc}">${ic(b, 13)} ${R.BUILDINGS[b].name}</span>`).join('')}</div>`;
  } else {
    h += `<div class="mut" style="font-size:13px;line-height:1.8">식량 ${y.food} (인구 유지 -${y.upkeep})<br>생산 ${y.prod} · 금 ${y.gold} · 과학 ${y.sci}<br>방어력 ${c.str} · 체력 ${c.hp}/${c.mhp}<br>도시 안 유닛은 매 턴 체력 +25 회복</div>`;
    const cc = Object.entries(S.corps || {}).filter(([, x]) => x.branches.some(br => br.id === c.id));
    if (cc.length) h += `<div class="sec">기업</div>` + cc.map(([id, x]) => `<div class="chip" style="margin:2px 0">${ic(R.CORPS[id].icon, 13)} ${R.CORPS[id].name} ${x.hq === c.id ? '본사' : '지사'} · ${esc(pname(x.owner))} ${x.active ? '' : '<span class="neg">(중단)</span>'}</div>`).join('');
    const here = myUnitsAt(c.p);
    if (here.length) h += `<button style="width:100%;margin-top:8px" data-act="tostack">${ic('users', 15)} 주둔 부대 보기 (${here.length})</button>`;
  }
  return h + '</div>';
}
$('#panel').addEventListener('click', e => {
  const b = e.target.closest('[data-act],[data-prod],[data-tab],[data-focus],[data-unequip]');
  if (!b || !sel) return;
  if (e.target.matches('input[data-pick]')) return;
  if (b.dataset.act === 'close') { select(null); return; }
  if (b.dataset.tab) { cityTab = b.dataset.tab; renderPanel(); return; }
  if (b.dataset.prod) { act('prod', { city: sel.id, kind: b.dataset.prod, type: b.dataset.type }); return; }
  if (b.dataset.unequip) { act('unequip', { unit: sel.focus, slot: b.dataset.unequip }); return; }
  if (b.dataset.focus && !b.dataset.act) { sel.focus = +b.dataset.focus; renderPanel(); return; }
  const a = b.dataset.act;
  if (sel.kind === 'stack') {
    const id = sel.focus, picked = pickedUnits();
    if (a === 'found') { act('found', { unit: id }); autoNext = true; }
    else if (a === 'improve') { act('improve', { unit: id }); autoNext = true; }
    else if (a === 'harvest') { act('harvest', { unit: id }); autoNext = true; }
    else if (a === 'mine') { act('mine', { unit: id }); autoNext = true; }
    else if (a === 'pillage') act('pillage', { unit: id });
    else if (a === 'fortify') { act('fortify', { unit: id }); autoNext = true; }
    else if (a === 'gfort') { act('fortify', { units: picked.map(u => u.id) }); autoNext = true; }
    else if (a === 'skip') { act('skip', { unit: id }); autoNext = true; }
    else if (a === 'next') selectNext();
    else if (a === 'pickall') { const mine = myUnitsAt(sel.tile); const all = mine.every(u => sel.picked.has(u.id)); sel.picked = new Set(all ? [] : mine.map(u => u.id)); computeSel(); renderPanel(); dirty = true; }
    else if (a === 'disband') { if (b.dataset.sure) { act('disband', { unit: id }); } else { b.dataset.sure = 1; b.innerHTML = `${ic('trash', 15)} 정말 해산?`; } }
  } else if (sel.kind === 'city') {
    if (a === 'buy') act('buy', { city: sel.id });
    else if (a === 'shoot') { shootMode = !shootMode; renderPanel(); dirty = true; if (shootMode) toast('주황색 칸의 적을 눌러 포격하세요'); }
    else if (a === 'tostack') { const c = cityById.get(sel.id); selectStack(c.p); }
  }
});
$('#panel').addEventListener('change', e => {
  if (e.target.matches('input[data-pick]')) { const id = +e.target.dataset.pick; if (e.target.checked) sel.picked.add(id); else sel.picked.delete(id); computeSel(); dirty = true; renderPanel(); }
  if (e.target.matches('select[data-equip]') && e.target.value) act('equip', { unit: sel.focus, item: e.target.value });
});

// ───────── 기술 ─────────
function openTech() { renderTech(); $('#mTech').classList.add('on'); }
function renderTech() {
  $('#techTitle').innerHTML = `${ic('tech', 18)} 기술 연구`;
  const techs = techsObj(), paid = new Set(S.my.paid || []);
  const depth = {}; const dep = k => depth[k] != null ? depth[k] : (depth[k] = R.TECHS[k].req.length ? 1 + Math.max(...R.TECHS[k].req.map(dep)) : 0);
  Object.keys(R.TECHS).forEach(dep);
  const maxD = Math.max(...Object.values(depth)), avail = new Set(R.availTechs(techs));
  let h = '';
  for (let d = 0; d <= maxD; d++) {
    const colT = Object.keys(R.TECHS).filter(k => depth[k] === d);
    const eras = [...new Set(colT.map(k => R.ERAS[R.TECHS[k].era]))];
    h += `<div class="tcol"><div class="tcolh">${eras.join(' · ')}</div>`;
    for (const k of colT) {
      const T = R.TECHS[k];
      const cls = techs[k] ? 'known' : S.my.res === k ? 'res' : avail.has(k) ? 'avail' : 'locked';
      const ul = [...Object.keys(R.UNITS).filter(u => R.UNITS[u].tech === k).map(u => `<span class="chip">${ic(u, 12)}${R.UNITS[u].name}</span>`),
        ...Object.keys(R.BUILDINGS).filter(b => R.BUILDINGS[b].tech === k).map(b => `<span class="chip">${ic(b, 12)}${R.BUILDINGS[b].name}</span>`),
        ...Object.keys(R.EQUIP).filter(b => R.EQUIP[b].tech === k).map(b => `<span class="chip">${ic(b, 12)}${R.EQUIP[b].name}</span>`),
        ...Object.keys(R.GOVS).filter(g => R.GOVS[g].tech === k).map(g => `<span class="chip" style="color:#fcd34d">${ic('gov', 12)}${R.GOVS[g].name}</span>`),
        ...Object.keys(R.POLICY_TREES).filter(g => R.POLICY_TREES[g].tech === k).map(g => `<span class="chip" style="color:#f0abfc">${ic(R.POLICY_TREES[g].icon, 12)}${R.POLICY_TREES[g].name} 사상</span>`)];
      const c = S.my.tcosts[k] || Math.round(T.cost * S.speed * 1.9);
      const turns = S.my.spt > 0 ? Math.max(1, Math.ceil((c - (S.my.res === k ? S.my.sci : 0)) / S.my.spt)) : '∞';
      h += `<div class="tc ${cls}" data-tech="${k}"><b>${techs[k] ? ic('check', 14, 'pos') : ''}${T.name} <span class="era">${R.ERAS[T.era]}</span></b>
        ${techs[k] ? '' : `<div class="mut">${ic('flask', 12)} ${c}${cls !== 'locked' ? ` · ${turns}턴` : ''}</div>`}
        ${!techs[k] && T.res ? `<div style="margin-top:4px">${paid.has(k) ? '<span class="chip">자원 투입됨</span>' : resChips(T.res)}</div>` : ''}
        ${T.desc ? `<div class="mut" style="font-size:11px;margin-top:3px">${T.desc}</div>` : ''}${T.bonus ? `<div class="pos" style="font-size:11px;margin-top:3px">${R.modText(T.bonus)}</div>` : ''}
        ${T.req.length ? `<div class="dim" style="font-size:11px;margin-top:3px">선행: ${T.req.map(r => R.TECHS[r].name).join(', ')}</div>` : ''}
        ${ul.length ? `<div class="ul">${ul.join('')}</div>` : ''}</div>`;
    }
    h += '</div>';
  }
  $('#techTree').innerHTML = h;
  $('#techInfo').innerHTML = `연구한 기술 ${S.my.techs.length}/${Object.keys(R.TECHS).length} · 턴당 과학 <b class="pos">+${S.my.spt}</b> · 모아둔 과학 ${S.my.sci} · ${S.my.res ? `연구 중: <b>${R.TECHS[S.my.res].name}</b>` : '<span class="neg">연구할 기술을 고르세요</span>'} · 일부 기술은 시작할 때 자원이 필요합니다`;
}
$('#techTree').onclick = e => { const t = e.target.closest('.tc.avail,.tc.res'); if (!t) return; act('research', { tech: t.dataset.tech }); };

// ───────── 사상·정부 ─────────
let ideoTab = 'policy';
function openIdeo(tab) { if (tab) ideoTab = tab; renderIdeo(); $('#mIdeo').classList.add('on'); }
function renderIdeo() {
  const my = S.my, T = techsObj();
  $('#ideoTitle').innerHTML = `${ic('ideology', 18)} 사상과 정부 <span class="mut" style="font-size:12px;font-weight:400">문화 ${my.culture} (+${my.cpt}/턴) · 다음 사상 ${my.pcost}</span>`;
  $('#ideoTabs').innerHTML = [['policy', '사상 정책'], ['gov', '정부 체제'], ['sum', '효과 합계']].map(([k, n]) => `<button class="${ideoTab === k ? 'on' : ''}" data-itab="${k}">${n}</button>`).join('');
  let h = '';
  if (ideoTab === 'policy') {
    h += `<div class="mut" style="font-size:12px;margin-bottom:10px">문화를 모아 사상을 채택합니다. 계열마다 위에서부터 차례대로 채택하며, 채택할수록 다음 비용이 오릅니다. ${my.anarchy ? '<span class="neg">무정부 상태에서는 채택할 수 없습니다.</span>' : ''}</div><div class="ptrees">`;
    for (const [tk, t] of Object.entries(R.POLICY_TREES)) {
      const locked = t.tech && !T[t.tech];
      const got = t.policies.filter(x => my.policies.includes(x.id)).length;
      const ideoBlocked = t.ideo && my.policies.some(id => R.POLICY_TREES[R.POLICY[id].tree].ideo && R.POLICY[id].tree !== tk);
      h += `<div class="ptree ${locked ? 'locked' : ''}"><h4>${ic(t.icon, 17)} ${t.name} <span class="mut" style="font-size:12px;font-weight:400">${got}/${t.policies.length}</span></h4><div class="mut" style="font-size:12px">${t.desc}${locked ? ` · ${ic('lock', 11)} ${R.TECHS[t.tech].name} 필요` : ''}${ideoBlocked ? ' · <span class="neg">다른 이념을 선택함</span>' : ''}</div>`;
      t.policies.forEach((x, i) => {
        const has = my.policies.includes(x.id), isNext = !has && !locked && !ideoBlocked && (i === 0 || my.policies.includes(t.policies[i - 1].id));
        const afford = isNext && my.culture >= my.pcost && !my.anarchy;
        h += `<button class="pol ${has ? 'got' : isNext ? 'next' : ''}" ${isNext ? `data-pol="${x.id}"` : 'disabled'} style="${isNext && !afford ? 'opacity:.75' : ''}">${has ? ic('check', 15, 'pos') : isNext ? ic('plus', 15, 'goldc') : ic('lock', 15, 'dim')}<span><span class="n">${x.name}</span><small>${R.modText(x.mods)}</small></span></button>`;
      });
      h += '</div>';
    }
    h += '</div>';
  } else if (ideoTab === 'gov') {
    h += `<div class="mut" style="font-size:12px;margin-bottom:10px">정부를 바꾸면 무정부 기간(1~2턴) 동안 금·과학이 크게 줄고 문화가 멈춥니다. 바꾼 뒤 10턴 동안은 다시 바꿀 수 없어요. 같은 계열(자유·전제·공산) 정부끼리는 사이가 좋아지고, 다른 계열과는 나빠집니다.</div><div class="govs">`;
    const bloc = { old: '전통', free: '자유 진영', auto: '전제 진영', red: '공산 진영' };
    for (const [gk, g] of Object.entries(R.GOVS)) {
      const cur = my.gov === gk, locked = g.tech && !T[g.tech];
      const wait = my.govTurn != null && S.turn - my.govTurn < 10;
      h += `<div class="govc ${cur ? 'cur' : ''} ${locked ? 'locked' : ''}"><b style="display:flex;align-items:center;gap:6px">${ic('gov', 16)} ${g.name} <span class="era">${bloc[g.bloc]}</span></b><small>${g.desc}</small><div class="pos" style="font-size:12px">${R.modText(g.mods)}</div>
        ${cur ? `<span class="tag" style="align-self:flex-start;color:var(--gold)">현재 체제${my.anarchy ? ' (전환 중)' : ''}</span>` : locked ? `<span class="dim" style="font-size:12px">${ic('lock', 12)} ${R.TECHS[g.tech].name} 필요</span>` : `<button class="sm pri" data-gov="${gk}" ${my.anarchy || wait ? 'disabled' : ''}>${wait ? `${my.govTurn + 10 - S.turn}턴 후 변경 가능` : '이 체제로 변경'}</button>`}</div>`;
    }
    h += '</div>';
  } else {
    const mods = my.mods || {};
    const rows = Object.entries(mods).filter(([, v]) => v);
    h += `<div class="mut" style="font-size:12px;margin-bottom:8px">기술 보너스 + 정부 체제 + 채택한 사상 효과를 모두 더한 값입니다.</div>`;
    h += rows.length ? `<table class="mtable">${rows.map(([k, v]) => `<tr><td>${R.MOD_TEXT[k] ? R.MOD_TEXT[k][0] : k}</td><td class="n ${v > 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}${R.MOD_TEXT[k] ? R.MOD_TEXT[k][1] : ''}</td></tr>`).join('')}</table>` : '<div class="mut">아직 적용된 효과가 없습니다</div>';
    h += `<div class="sec">채택한 사상 (${my.policies.length})</div><div class="row" style="gap:5px">${my.policies.map(id => `<span class="chip">${ic(R.POLICY_TREES[R.POLICY[id].tree].icon, 12)} ${R.POLICY[id].name}</span>`).join('') || '<span class="mut">없음</span>'}</div>`;
  }
  $('#ideoBody').innerHTML = h;
}
$('#ideoTabs').onclick = e => { const b = e.target.closest('[data-itab]'); if (b) { ideoTab = b.dataset.itab; renderIdeo(); } };
$('#ideoBody').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.pol) act('policy', { id: b.dataset.pol });
  if (b.dataset.gov) { if (b.dataset.sure) act('gov', { id: b.dataset.gov }); else { b.dataset.sure = 1; b.textContent = '무정부 기간을 감수하고 변경'; } }
};
$('#bIdeo').onclick = () => openIdeo();
$('#hCul').onclick = () => openIdeo();

// ───────── 국정 (안정도·기업·우주·역사) ─────────
let natTab = 'stab';
function openNation(tab) { if (tab) natTab = tab; renderNation(); $('#mNation').classList.add('on'); }
function renderNation() {
  const my = S.my, T = techsObj();
  $('#natTitle').innerHTML = `${ic('stab', 18)} 국정`;
  $('#natTabs').innerHTML = [['stab', '안정도'], ['corp', '기업'], ['space', '우주'], ['hist', '세계 역사']].map(([k, n]) => `<button class="${natTab === k ? 'on' : ''}" data-ntab="${k}">${n}</button>`).join('');
  let h = '';
  if (natTab === 'stab') {
    const st = my.stab, col = st >= 60 ? 'var(--green)' : st >= 40 ? 'var(--gold)' : 'var(--red)';
    const risk = st >= 60 ? '안정 — 사건이 일어나지 않습니다' : st >= 40 ? '불안 — 정치 체제가 시대에 뒤처지면 혁명이 일어날 수 있습니다' : st >= 25 ? '위험 — 폭동·혁명·쿠데타가 일어날 수 있습니다' : '붕괴 직전 — 도시가 반란을 일으켜 독립할 수 있습니다';
    const fest = S.turn - (my.festTurn || -99) >= 8;
    h += `<div class="row" style="gap:16px;align-items:center"><div style="font-size:42px;font-weight:800;color:${col}">${st}</div><div style="flex:1"><div>목표 안정도 <b>${my.stabT}</b> <span class="mut">(매 턴 최대 4씩 변화)</span></div>${bar(st, 100, col)}<div class="mut" style="font-size:12px;margin-top:4px">${risk}</div></div></div>`;
    h += `<div class="sec">구성 요소</div><table class="mtable">${(my.stabParts || []).map(([t, v]) => `<tr><td>${t}</td><td class="n ${v >= 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : ''}${v}</td></tr>`).join('')}</table>`;
    h += `<div class="row" style="margin-top:12px"><button class="pri" data-fest="1" ${fest && my.gold >= my.festCost ? '' : 'disabled'}>${ic('festival', 15)} 국가 축제 열기 (금 ${my.festCost})</button><span class="mut" style="font-size:12px">${fest ? '안정도가 일시적으로 +12 오릅니다' : `${my.festTurn + 8 - S.turn}턴 후 다시 열 수 있습니다`}</span></div>`;
    h += `<div class="sec">사건 안내</div><div class="mut" style="font-size:12.5px;line-height:1.75">
      ${ic('fist', 13)} <b>혁명</b> — 기술은 앞서 가는데 정부가 낡으면 민중이 새 체제(민주주의·공산주의 등)를 세웁니다. 무정부 3턴, 금 40% 손실<br>
      ${ic('swords', 13)} <b>쿠데타</b> — 군부가 정권을 잡고 전제정·군주정으로 바꿉니다. 군대 20% 숙청, 금 30% 손실<br>
      ${ic('flag', 13)} <b>반역(분리 독립)</b> — 수도에서 멀고 방어가 약한 도시가 새 나라로 독립해 전쟁을 겁니다<br>
      ${ic('unrest', 13)} <b>폭동</b> — 도시 인구 감소, 생산 초기화<br>
      안정도를 높이려면: 평화 유지, 문화 건물, 안정도 사상(전통·신앙·미학 등), 시대에 맞는 정부, 도시 주둔군, 기업 운영, 축제</div>`;
  } else if (natTab === 'corp') {
    h += `<div class="mut" style="font-size:12px;margin-bottom:10px">기업은 세계에 하나씩만 세울 수 있습니다. 본사를 세우면 매 턴 원료를 쓰고, 지사가 있는 도시에 효과를 주며, 지사 1곳당 금 +2(해외 지사는 +4)를 벌어요. 해외 진출에는 상대와 국경 개방·동맹·교역 협정 중 하나가 필요하고, 상대는 지사를 국유화할 수 있어요. 본사 도시를 점령하면 기업도 넘어갑니다.</div><div class="dl">`;
    const myCities = S.cities.filter(c => c.o === me);
    for (const [id, def] of Object.entries(R.CORPS)) {
      const c = (S.corps || {})[id];
      h += `<div class="prop"><div class="row"><b style="display:flex;align-items:center;gap:6px">${ic(def.icon, 17)} ${def.name}</b><span class="mut" style="font-size:12px">${def.desc}</span><div class="sp"></div>${c ? `<span class="tag ${c.owner === me ? 'on' : ''}">${esc(pname(c.owner))}${c.active ? '' : ' · 중단'}</span>` : `<span class="tag">${T[def.tech] ? '설립 가능' : R.TECHS[def.tech].name + ' 필요'}</span>`}</div>
        <div class="row mut" style="font-size:12px;margin-top:4px;gap:10px"><span>지사 효과: <span class="pos">${Object.entries(def.eff).map(([k, v]) => ({ food: '식량', prod: '생산', gold: '금', sci: '과학', cul: '문화' })[k] + ' +' + v).join(', ')}</span></span><span>매 턴 원료: ${resChips(def.input)}</span></div>`;
      if (!c && T[def.tech]) {
        h += `<div class="row" style="margin-top:6px;gap:6px"><span class="mut" style="font-size:12px">설립 비용: 금 ${R.CORP_COST.found} ${resChips(def.found)}</span><div class="sp"></div><select data-corpcity="${id}">${myCities.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button class="sm pri" data-found="${id}" ${my.gold >= R.CORP_COST.found ? '' : 'disabled'}>본사 설립</button></div>`;
      } else if (c) {
        h += `<div class="mut" style="font-size:12px;margin-top:4px">본사 ${esc(c.hqName)} · 지사 ${c.branches.length}곳${c.owner === me ? ` · 수익 +${c.income}/턴` : ''}</div><div class="row" style="gap:4px;margin-top:4px">${c.branches.map(br => `<span class="chip">${esc(br.name)}${br.o !== c.owner ? ' (해외)' : ''}${br.o === me && c.owner !== me && br.id !== c.hq ? ` <button class="sm ghost" data-nat="${id}:${br.id}" style="padding:0 4px">국유화</button>` : ''}</span>`).join('')}</div>`;
        if (c.owner === me) {
          const cand = S.cities.filter(x => !c.branches.some(br => br.id === x.id));
          if (cand.length) h += `<div class="row" style="margin-top:6px;gap:6px"><select data-brcity="${id}">${cand.map(x => `<option value="${x.id}">${esc(x.name)}${x.o !== me ? ' · ' + esc(pname(x.o)) + ' (해외 ' + R.CORP_COST.foreign + '금)' : ' (' + R.CORP_COST.branch + '금)'}</option>`).join('')}</select><button class="sm" data-branch="${id}">지사 개설</button></div>`;
        }
      }
      h += '</div>';
    }
    h += '</div>';
  } else if (natTab === 'space') {
    const sp = my.space || {};
    const need = Object.assign({ satellite: 1 }, R.SPACE_NEED);
    h += `<div class="mut" style="font-size:12px;margin-bottom:10px">로켓 공학 → 발사대를 지은 도시에서 우주 프로젝트를 생산하세요. 추진체 3개, 거주 모듈 1개, 핵융합 엔진 1개를 모두 만들면 우주선이 발사되어 영구 보너스(${R.modText(R.SPACE_BONUS)})와 점수 +300을 얻습니다. 정찰 위성은 세계 지도 전체를 보여줍니다.</div>`;
    h += `<div class="govs">${Object.entries(R.PROJECTS).map(([k, Pj]) => `<div class="govc ${(sp[k] || 0) >= need[k] ? 'cur' : ''}"><b style="display:flex;gap:6px;align-items:center">${ic(k, 18)} ${Pj.name}</b><small>${Pj.desc}</small><div>${sp[k] || 0} / ${need[k]}</div>${bar(sp[k] || 0, need[k], '#a5b4fc')}<small>${T[Pj.tech] ? '' : ic('lock', 11) + ' ' + R.TECHS[Pj.tech].name + ' 필요'}</small></div>`).join('')}</div>`;
    h += `<div class="hint" style="margin-top:12px">${ic('rocket', 18)} ${my.launched ? `<b>${my.launched}턴에 우주선을 발사했습니다!</b>` : '아직 우주선을 발사하지 않았습니다'}</div>`;
    const race = (S.space || []).sort((a, b) => (b.launched ? 1 : 0) - (a.launched ? 1 : 0));
    if (race.length) h += `<div class="sec">세계 우주 경쟁</div><table class="mtable">${race.map(q => `<tr><td><span style="color:${pcolor(q.id)}">●</span> ${esc(pname(q.id))}</td><td>위성 ${q.satellite || 0}</td><td>추진체 ${q.booster || 0}/3</td><td>모듈 ${q.habitat || 0}/1</td><td>엔진 ${q.engine || 0}/1</td><td>${q.launched ? `<b style="color:#a5b4fc">${q.launched}턴 발사</b>` : ''}</td></tr>`).join('')}</table>`;
  } else {
    h += `<div style="font-size:13px;line-height:1.8">${(S.history || []).slice().reverse().map(x => `<div><span class="dim">[${x.turn}턴]</span> ${esc(x.text)}</div>`).join('') || '<span class="mut">아직 큰 사건이 없습니다</span>'}</div>`;
  }
  $('#natBody').innerHTML = h;
}
$('#natTabs').onclick = e => { const b = e.target.closest('[data-ntab]'); if (b) { natTab = b.dataset.ntab; renderNation(); } };
$('#natBody').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.fest) act('festival');
  if (b.dataset.found) { const sel2 = $('#natBody').querySelector(`select[data-corpcity="${b.dataset.found}"]`); if (sel2) act('corpFound', { corp: b.dataset.found, city: +sel2.value }); }
  if (b.dataset.branch) { const sel2 = $('#natBody').querySelector(`select[data-brcity="${b.dataset.branch}"]`); if (sel2) act('corpBranch', { corp: b.dataset.branch, city: +sel2.value }); }
  if (b.dataset.nat) { const [cid, city] = b.dataset.nat.split(':'); if (b.dataset.sure) act('nationalize', { corp: cid, city: +city }); else { b.dataset.sure = 1; b.textContent = '정말?'; } }
};
$('#bNation').onclick = () => openNation();
$('#hStab').onclick = () => openNation('stab');

// ───────── 외교 ─────────
function openDip(tab) { if (tab) dipTab = tab; renderDip(); $('#mDip').classList.add('on'); }
function renderDip() {
  $('#dipTitle').innerHTML = `${ic('handshake', 18)} 외교 <span class="mut" style="font-size:12px;font-weight:400">내 신뢰도 ${S.my.trust}</span>`;
  const inc = (S.props || []).filter(p => p.to === me).length;
  $('#dipTabs').innerHTML = [['civs', '문명'], ['props', `받은 제안${inc ? ` (${inc})` : ''}`], ['deals', '협정']].map(([k, n]) => `<button class="${dipTab === k ? 'on' : ''}" data-dtab="${k}">${n}</button>`).join('');
  let h = '';
  if (dipTab === 'civs') {
    const list = S.players.filter(q => !q.removed && q.id !== me && q.alive && q.met);
    list.sort((a, b) => (b.d === 'war') - (a.d === 'war') || b.al - a.al || b.score - a.score);
    h = list.map(q => {
      const opPos = Math.round((q.op + 100) / 2);
      const myMil = S.my.mil || 0;
      const milTxt = q.mil > myMil * 1.3 ? '<span class="neg">우리보다 강함</span>' : q.mil < myMil * 0.7 ? '<span class="pos">우리보다 약함</span>' : '비슷함';
      const treaty = [q.pu ? `평화조약 ${q.pu - S.turn}턴` : '', q.nap ? `불가침 ${q.nap - S.turn}턴` : '', q.ob ? `국경 개방 ${q.ob - S.turn}턴` : ''].filter(Boolean).join(' · ');
      const warBtn = q.al ? `<button class="sm danger" data-cancel="${q.id}">${ic('alliance', 13)} 동맹 파기</button>`
        : q.d === 'war' ? '' : q.prot ? `<span class="tag prot">${ic('shield', 11)} ${q.prot}턴까지 보호</span>`
        : `<button class="sm danger" data-war="${q.id}">${ic('swords', 13)} 선전포고${q.pu || q.nap ? ' (배신)' : ''}</button>`;
      return `<div class="civrow"><span class="sw" style="background:${q.color}"></span><div style="min-width:0"><b>${esc(q.name)}</b> <span class="mut">${R.CIVS[q.civ].name}</span> ${q.ai ? '<span class="tag ai">AI</span>' : q.online ? '<span class="tag on">접속</span>' : '<span class="tag off">오프라인</span>'}
        <div class="tags">${relTags(q.id)}</div>
        <div class="meta">${q.rebel ? '<span class="neg">반군 국가</span>' : ''}${q.gov ? `<span>${ic('gov', 12)} ${R.GOVS[q.gov].name}</span>` : ''}${q.stab != null ? `<span>안정도 ${q.stab}</span>` : ''}${q.launched ? `<span style="color:#a5b4fc">${ic('rocket', 12)} 우주 진출</span>` : ''}<span>태도: <b style="color:${q.op >= 15 ? 'var(--green)' : q.op <= -15 ? 'var(--red)' : 'var(--text)'}">${q.op >= 50 ? '우호적' : q.op >= 15 ? '호의적' : q.op > -15 ? '중립' : q.op > -50 ? '경계' : '적대적'}</b> (${q.op})</span><span class="opbar" style="display:inline-block"><i style="left:${opPos}%"></i></span><span>군사력 ${milTxt}</span><span>신뢰 ${q.trust}</span><span>도시 ${q.cities} · 점수 ${q.score}</span>${treaty ? `<span>${treaty}</span>` : ''}</div></div>
        <div class="btns"><button class="sm pri" data-deal="${q.id}">${ic('swap', 13)} ${q.d === 'war' ? '평화 협상' : '거래 제안'}</button>${warBtn}${q.al ? '' : `<button class="sm ghost" data-incite="${q.id}" title="금 150 · 상대 안정도 하락, 40% 확률로 발각">${ic('spy', 13)} 반군 지원</button>`}</div></div>`;
    }).join('') || '<div class="mut">아직 만난 문명이 없습니다. 정찰병으로 세계를 탐험해 보세요.</div>';
  } else if (dipTab === 'props') {
    const mineIn = (S.props || []).filter(p => p.to === me), mineOut = (S.props || []).filter(p => p.from === me);
    h = '<div class="dl">' + (mineIn.map(p => `<div class="prop"><div class="row"><span class="sw" style="width:14px;height:14px;border-radius:4px;background:${pcolor(p.from)}"></span><b>${esc(pname(p.from))}</b><span class="mut">· ${p.turn}턴</span></div>
      <div style="margin:6px 0">${p.kind === 'call' ? `동맹으로서 <b>${esc(pname(p.target))}</b>와(과)의 전쟁에 참전해 달라고 요청합니다. 거절하면 관계가 나빠집니다.` : offerText(p.o, p.from, me)}</div>
      <div class="row"><button class="sm pri" data-acc="${p.id}">${ic('check', 13)} 수락</button><button class="sm" data-rej="${p.id}">거절</button></div></div>`).join('') || '<div class="mut">받은 제안이 없습니다</div>');
    if (mineOut.length) h += '<div class="sec">보낸 제안</div>' + mineOut.map(p => `<div class="prop"><b>${esc(pname(p.to))}</b>에게 · ${offerText(p.o, me, p.to)}<div style="margin-top:6px"><button class="sm" data-cprop="${p.id}">취소</button></div></div>`).join('');
    h += '</div>';
  } else {
    const ds = S.deals || [];
    h = '<div class="dl">' + (ds.map(d => {
      const other = d.a === me ? d.b : d.a, give = d.a === me ? d.ag : d.bg, get = d.a === me ? d.bg : d.ag;
      return `<div class="prop"><b>${esc(pname(other))}</b>와(과) 교역 협정 · ${d.until - S.turn}턴 남음<div class="row" style="margin-top:6px;font-size:13px"><span class="neg">보냄:</span> ${sideText(give, true) || '없음'}<span class="pos" style="margin-left:10px">받음:</span> ${sideText(get, true) || '없음'}</div></div>`;
    }).join('') || '<div class="mut">진행 중인 교역 협정이 없습니다</div>');
    const treaties = S.players.filter(q => !q.removed && q.id !== me && (q.al || q.ob || q.nap || q.pu));
    if (treaties.length) h += '<div class="sec">조약</div>' + treaties.map(q => `<div class="prop row"><span class="sw" style="width:14px;height:14px;border-radius:4px;background:${q.color}"></span><b>${esc(q.name)}</b>${relTags(q.id)}</div>`).join('');
    h += '</div>';
  }
  $('#dipBody').innerHTML = h;
}
function sideText(s, perTurn) {
  if (!s) return '';
  const parts = [];
  if (s.gold) parts.push(`금 ${s.gold}`);
  if (s.gpt) parts.push(`턴당 금 ${s.gpt}`);
  for (const k in s.res || {}) parts.push(`턴당 ${R.STOCK[k].name} ${s.res[k]}`);
  for (const k in s.lump || {}) parts.push(`${R.STOCK[k].name} ${s.lump[k]}`);
  return parts.join(', ');
}
function offerText(o, from, to) {
  const cl = { peace: '평화 조약', alliance: '동맹', open: '국경 개방', nap: '불가침 조약' };
  const parts = [];
  if (o.clauses.length) parts.push(`<b>${o.clauses.map(c => cl[c]).join(' + ')}</b>`);
  const a = sideText(o.fg), b = sideText(o.tg);
  if (a) parts.push(`${from === me ? '내가' : esc(pname(from)) + '이(가)'} 줌: ${a}`);
  if (b) parts.push(`${to === me ? '내가' : esc(pname(to)) + '이(가)'} 줌: ${b}`);
  return parts.join(' · ') + ((o.fg.gpt || o.tg.gpt || Object.keys(o.fg.res || {}).length || Object.keys(o.tg.res || {}).length) ? ` <span class="dim">(턴당 항목 ${R.TREATY.DEAL}턴)</span>` : '');
}
$('#dipTabs').onclick = e => { const b = e.target.closest('[data-dtab]'); if (b) { dipTab = b.dataset.dtab; renderDip(); } };
$('#dipBody').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.deal) openDeal(+b.dataset.deal);
  if (b.dataset.war) { if (b.dataset.sure) act('war', { target: +b.dataset.war }); else { b.dataset.sure = 1; b.innerHTML = `${ic('swords', 13)} 정말 전쟁?`; } }
  if (b.dataset.cancel) { if (b.dataset.sure) act('cancelAlliance', { target: +b.dataset.cancel }); else { b.dataset.sure = 1; b.textContent = '정말 파기?'; } }
  if (b.dataset.incite) { if (b.dataset.sure) act('incite', { target: +b.dataset.incite }); else { b.dataset.sure = 1; b.innerHTML = `${ic('spy', 13)} 금 150 · 진행?`; } }
  if (b.dataset.acc) act('respond', { prop: +b.dataset.acc, accept: true });
  if (b.dataset.rej) act('respond', { prop: +b.dataset.rej, accept: false });
  if (b.dataset.cprop) act('cancelProp', { prop: +b.dataset.cprop });
};
let dealTo = -1;
function openDeal(to) {
  dealTo = to; const q = P(to);
  $('#dealTitle').innerHTML = `${ic('swap', 18)} ${esc(q.name)}에게 제안`;
  const side = (key, who, src) => `<div class="dealcol"><h4>${who}</h4>
    <div class="drow"><span>${ic('coin', 13)} 금 (일시불)</span><input type="number" min="0" data-f="${key}.gold" value="0"><span class="dim" style="font-size:11px">보유 ${src === 'me' ? S.my.gold : '?'}</span></div>
    <div class="drow"><span>${ic('coin', 13)} 턴당 금</span><input type="number" min="0" data-f="${key}.gpt" value="0"><span class="dim" style="font-size:11px">${R.TREATY.DEAL}턴</span></div>
    <div class="drow" style="margin-top:6px"><span class="h" style="text-align:left">자원</span><span class="h">턴당</span><span class="h">일시</span></div>
    ${STOCK_KEYS.map(k => `<div class="drow"><span><span style="color:${R.STOCK[k].color}">${ic(k, 13)}</span> ${R.STOCK[k].name}${src === 'me' ? ` <span class="dim">(${S.my.stock[k]})</span>` : ''}</span><input type="number" min="0" data-f="${key}.res.${k}" value="0"><input type="number" min="0" data-f="${key}.lump.${k}" value="0"></div>`).join('')}</div>`;
  const cl = q.d === 'war' ? [['peace', '평화 조약', 'peace', `${R.TREATY.PEACE}턴 동안 전쟁 금지`]] : [];
  if (!q.al) cl.push(['alliance', '동맹', 'alliance', '시야 공유, 영토 통행, 공격받으면 참전']);
  cl.push(['open', '국경 개방', 'border', `${R.TREATY.OPEN}턴 동안 서로 영토 통행`]);
  cl.push(['nap', '불가침', 'nap', `${R.TREATY.NAP}턴, 깨면 배신`]);
  $('#dealBody').innerHTML = `<div class="sec" style="margin-top:0">조약</div><div class="clauses">${cl.map(([k, n, i, d]) => `<label title="${d}"><input type="checkbox" data-cl="${k}" ${q.d === 'war' && k === 'peace' ? 'checked' : ''}>${ic(i, 14)} ${n}<span class="dim" style="font-size:11px">${d}</span></label>`).join('')}</div>
    <div class="sec">거래 (수출·수입)</div><div class="dealgrid">${side('fg', '내가 주는 것', 'me')}${side('tg', '상대가 주는 것', 'them')}</div>
    <div class="mut" style="font-size:12px;margin-top:10px">${q.ai ? `AI는 시장 가격 기준으로 손해가 없고, 태도(${q.op})와 신뢰가 충분하면 수락합니다. 선물은 태도를 높입니다.` : '상대 플레이어가 [외교 → 받은 제안]에서 수락하면 바로 실행됩니다.'}</div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button data-close-deal>취소</button><button class="pri" id="dealSend">${ic('check', 15)} 제안 보내기</button></div>`;
  $('#mDeal').classList.add('on');
}
$('#dealBody').addEventListener('click', e => {
  if (e.target.closest('[data-close-deal]')) { $('#mDeal').classList.remove('on'); return; }
  if (!e.target.closest('#dealSend')) return;
  const o = { fg: { res: {}, lump: {} }, tg: { res: {}, lump: {} }, clauses: [] };
  for (const inp of $('#dealBody').querySelectorAll('input[data-f]')) {
    const v = Math.max(0, Math.floor(+inp.value || 0)); if (!v) continue;
    const parts = inp.dataset.f.split('.');
    if (parts.length === 2) o[parts[0]][parts[1]] = v; else o[parts[0]][parts[1]][parts[2]] = v;
  }
  for (const c of $('#dealBody').querySelectorAll('input[data-cl]')) if (c.checked) o.clauses.push(c.dataset.cl);
  act('propose', { to: dealTo, offer: o });
  $('#mDeal').classList.remove('on');
});

// ───────── 시장 ─────────
function openMarket() { renderMarket(); $('#mMarket').classList.add('on'); }
function renderMarket() {
  $('#mktTitle').innerHTML = `${ic('scale', 18)} 세계 시장 <span class="mut" style="font-size:12px;font-weight:400">보유 금 ${S.my.gold}</span>`;
  const arm = Object.entries(S.my.armory || {}).filter(([, v]) => v > 0);
  $('#mktBody').innerHTML = `<div class="mut" style="font-size:12px;margin-bottom:8px">모든 문명이 함께 쓰는 시장입니다. 많이 팔리면 값이 내려가고, 많이 사면 올라갑니다. 다른 문명과 직접 교역하려면 [외교 → 거래 제안]을 이용하세요.</div>
  <table class="mtable"><tr><th>자원</th><th style="text-align:right">보유</th><th style="text-align:right">시장 재고</th><th style="text-align:right">수입가</th><th style="text-align:right">수출가</th><th></th></tr>
  ${STOCK_KEYS.map(k => { const m = S.market[k]; return `<tr><td><span style="color:${R.STOCK[k].color}">${ic(k, 15)}</span> ${R.STOCK[k].name}</td><td class="n">${S.my.stock[k]}${S.my.sgain[k] ? ` <span class="pos" style="font-size:11px">+${S.my.sgain[k]}</span>` : ''}</td><td class="n">${m.stock}</td><td class="n">${m.buy}</td><td class="n">${m.sell}</td>
    <td style="white-space:nowrap;text-align:right"><button class="sm" data-mk="${k}" data-side="buy" data-n="1">수입 1</button> <button class="sm" data-mk="${k}" data-side="buy" data-n="5">5</button> <button class="sm" data-mk="${k}" data-side="sell" data-n="1">수출 1</button> <button class="sm" data-mk="${k}" data-side="sell" data-n="5">5</button></td></tr>`; }).join('')}</table>
  <div class="sec">무기고</div>${arm.length ? `<div class="row" style="gap:5px">${arm.map(([k, v]) => `<span class="chip">${ic(k, 13)} ${R.EQUIP[k].name} ×${v}</span>`).join('')}</div>` : '<div class="mut" style="font-size:13px">보관 중인 장비가 없습니다. 도시의 [제작] 탭에서 만들 수 있어요.</div>'}`;
}
$('#mktBody').onclick = e => { const b = e.target.closest('[data-mk]'); if (b) act('market', { res: b.dataset.mk, side: b.dataset.side, n: +b.dataset.n }); };

// ───────── 순위·메뉴 ─────────
function renderRank() {
  $('#rankTitle').innerHTML = `${ic('crown', 18)} 세계 순위`;
  const list = S.players.filter(q => !q.removed && q.alive).sort((a, b) => b.score - a.score);
  $('#rankList').innerHTML = list.slice(0, 30).map((q, k) => `<div class="civrow" style="grid-template-columns:28px auto 1fr auto;${q.id === me ? 'border-color:var(--gold)' : ''}"><b style="text-align:center">${k + 1}</b><span class="sw" style="background:${q.color};width:26px;height:26px"></span>
    <div><b>${esc(q.name)}</b> <span class="mut">${R.CIVS[q.civ].name}</span> ${q.ai ? '<span class="tag ai">AI</span>' : q.online ? '<span class="tag on">접속</span>' : ''}<div class="meta">도시 ${q.cities} · 기술 ${q.techs}${q.id !== me && q.met ? ' · ' + (q.d === 'war' ? '<span class="neg">전쟁</span>' : q.al ? '동맹' : '평화') : ''}</div></div><b>${q.score}</b></div>`).join('');
}
$('#bTech').onclick = openTech;
$('#hRes').onclick = openTech;
$('#bDip').onclick = () => openDip();
$('#bMarket').onclick = openMarket;
$('#bStock').onclick = openMarket;
$('#bRank').onclick = () => { renderRank(); $('#mRank').classList.add('on'); };
$('#bChat').onclick = () => { $('#chatPanel').classList.toggle('on'); chatUnread = 0; renderNav(); if ($('#chatPanel').classList.contains('on')) $('#gChatIn').focus(); };
$('#chatX').innerHTML = ic('close', 16);
$('#chatX').onclick = () => $('#chatPanel').classList.remove('on');
$('#gChatSend').onclick = () => sendChat($('#gChatIn'));
$('#gChatIn').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') sendChat($('#gChatIn')); };
$('#bMenu').onclick = () => $('#mMenu').classList.add('on');
$('#mCenter').innerHTML = `${ic('city', 16)} 수도로 이동`;
$('#mLogBtn').innerHTML = `${ic('scroll', 16)} 전체 기록`;
$('#mMiniBtn').innerHTML = `${ic('map', 16)} 미니맵 켜기/끄기`;
$('#mHelp').innerHTML = `${ic('help', 16)} 게임 방법`;
$('#mLeave').innerHTML = `${ic('exit', 16)} 세계에서 나가기 (제국은 남아요)`;
$('#mCenter').onclick = () => { $('#mMenu').classList.remove('on'); const c = S.cities.find(c => c.o === me && c.cap) || S.cities.find(c => c.o === me); if (c) select({ kind: 'city', id: c.id }, true); else { const u = S.units.find(u => u.o === me); if (u) selectStack(u.p, u.id, true); } };
$('#mLogBtn').onclick = () => { $('#mMenu').classList.remove('on'); openLog(); };
$('#mMiniBtn').onclick = () => { miniOn = !miniOn; resize(); $('#mMenu').classList.remove('on'); };
$('#mHelp').onclick = () => {
  $('#mMenu').classList.remove('on');
  $('#helpBody').innerHTML = $('#howto').innerHTML + `<br><br><b>자원과 채굴</b><br>· 일꾼을 영토 안 자원 칸에 두고 [시설 짓기] → 매 턴 자원이 창고에 쌓입니다 (도시마다 1+인구/2곳 가동)<br>· [채집]은 영토 밖 빈 땅에서도 한 턴에 1개씩 직접 캘 수 있어요<br>· 철 광산은 [청동기], 초석은 [기계], 석탄은 [화약]이 있어야 캘 수 있습니다<br>
  <br><b>장비</b><br>· 도시 [제작] 탭에서 무기·갑옷·군마를 만들어 무기고에 보관하고, 내 영토 안 유닛에 장착합니다<br>
  <br><b>전투 미니게임</b><br>· 부대를 선택하고 빨간 칸을 누르면 전투가 열립니다. 라운드마다 <b>돌격 · 사격 · 방진</b> 중 하나를 고르세요<br>· 돌격은 사격을, 사격은 방진을, 방진은 돌격을 이깁니다. 적 지휘관이 즐겨 쓰는 전술 힌트를 참고하세요<br>· 3라운드 안에 적을 모두 쓰러뜨리면 그 칸을 차지하고, 도시 체력이 0이면 점령합니다<br>· 원거리 유닛은 주황 칸을 눌러 반격 없이 포격할 수 있어요<br>
  <br><b>외교</b><br>· 평화 조약·불가침 중에 선전포고하면 <b>배신</b>으로 신뢰가 크게 떨어지고 모든 문명의 태도가 나빠집니다<br>· 동맹은 시야를 공유하고, 한쪽이 공격받으면 참전 요청이 옵니다<br>· 국경 개방이나 동맹 없이는 평화 상태의 다른 나라 영토에 들어갈 수 없습니다<br>· 교역 협정을 지키지 못하면(자원·금 부족) 협정이 깨지고 신뢰가 떨어집니다`;
  $('#mHelpM').classList.add('on');
};
$('#mLeave').onclick = () => { $('#mMenu').classList.remove('on'); sendMsg({ t: 'leave' }); };
$('#respawnBtn').onclick = () => { act('respawn'); $('#mDead').classList.remove('on'); };
$('#deadView').onclick = () => $('#mDead').classList.remove('on');
document.querySelectorAll('[data-close]').forEach(b => { b.innerHTML = ic('close', 18); b.onclick = () => b.closest('.modal').classList.remove('on'); });
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m && m.id !== 'mDead' && m.id !== 'mBattle') m.classList.remove('on'); }));

// ───────── 전투 미니게임 ─────────
const bcv = $('#btlCv'), bctx = bcv.getContext('2d');
let BT = null, btlAnim = null, btlPos = new Map(), btlHp = new Map(), btlDead = new Map();
function onBattle(m) {
  const prev = BT && BT.id === m.id ? BT : null;
  if (!prev) { btlPos = new Map(); btlHp = new Map(); btlDead = new Map(); }
  const prevHp = new Map(btlHp);
  for (const u of [...m.a, ...m.d]) { if (!btlHp.has(u.id)) prevHp.set(u.id, u.hp); btlHp.set(u.id, u.hp); }
  for (const d of m.dead || []) { if (!btlDead.has(d.id)) btlDead.set(d.id, d); btlHp.set(d.id, 0); }
  if (m.city) { if (!btlHp.has('city')) prevHp.set('city', m.city.hp); btlHp.set('city', m.city.hp); }
  BT = m;
  layoutBattle();
  if (m.last && (!prev || prev.round !== m.round || m.over)) btlAnim = { t0: performance.now(), hits: m.last.hits, prevHp, dur: Math.min(2600, 500 + m.last.hits.length * 70) };
  else btlAnim = { t0: performance.now() - 99999, hits: [], prevHp, dur: 1 };
  $('#mBattle').classList.add('on');
  renderBattleUI();
}
function layoutBattle() {
  const W = bcv.clientWidth || 640, H = bcv.clientHeight || 280;
  const place = (list, left) => {
    const n = list.length, cols = Math.max(1, Math.ceil(n / 4)), rows = Math.min(4, n);
    list.forEach((u, k) => {
      if (btlPos.has(u.id)) return;
      const col = Math.floor(k / 4), row = k % 4;
      const x = left ? W * 0.32 - col * Math.min(58, W * 0.25 / cols) : W * 0.68 + col * Math.min(58, W * 0.25 / cols);
      const y = H / 2 + (row - (Math.min(rows, 4) - 1) / 2) * Math.min(56, (H - 50) / 4);
      btlPos.set(u.id, [x, y]);
    });
  };
  const aIds = [...BT.a, ...[...btlDead.values()].filter(d => d.o === BT.att)], dIds = [...BT.d, ...[...btlDead.values()].filter(d => d.o !== BT.att)];
  place(aIds, true); place(dIds, false);
  if (BT.city) btlPos.set('city', [W * 0.9, H / 2]);
}
function drawBattle() {
  if (!BT || !$('#mBattle').classList.contains('on')) { btlAnim = null; return; }
  const dpr2 = Math.min(2, devicePixelRatio || 1), W = bcv.clientWidth, H = bcv.clientHeight;
  if (bcv.width !== W * dpr2) { bcv.width = W * dpr2; bcv.height = H * dpr2; btlPos = new Map(); layoutBattle(); }
  const c = bctx; c.setTransform(dpr2, 0, 0, dpr2, 0, 0); c.clearRect(0, 0, W, H);
  c.strokeStyle = '#ffffff14'; c.setLineDash([6, 6]); c.beginPath(); c.moveTo(W / 2, 14); c.lineTo(W / 2, H - 14); c.stroke(); c.setLineDash([]);
  c.font = '600 12px system-ui'; c.fillStyle = '#8b96b2'; c.textAlign = 'left'; c.fillText(`공격 · ${BT.attName}`, 12, 20); c.textAlign = 'right'; c.fillText(`방어 · ${BT.defName}`, W - 12, 20);
  const now = performance.now(), A = btlAnim || { t0: 0, hits: [], prevHp: new Map(), dur: 1 }, t = Math.min(1, (now - A.t0) / A.dur);
  const hpAt = id => { const a = A.prevHp.has(id) ? A.prevHp.get(id) : btlHp.get(id), b = btlHp.get(id); return a + (b - a) * Math.min(1, t * 1.4); };
  const all = [...BT.a.map(u => ({ ...u, alive: true })), ...BT.d.map(u => ({ ...u, alive: true })), ...[...btlDead.values()].map(d => ({ id: d.id, t: d.t, o: d.o, hp: 0, alive: false }))];
  // 공격 선
  A.hits.forEach((h, k) => {
    const st = k * 70 / A.dur, en = st + 0.35;
    if (t < st || t > en + 0.25) return;
    const from = btlPos.get(h.f), to = btlPos.get(h.t); if (!from || !to) return;
    const p = Math.min(1, (t - st) / 0.35);
    const R2 = R.UNITS[(all.find(u => u.id === h.f) || {}).t] || {};
    c.strokeStyle = h.s === 'a' ? '#f0c35a' : '#ff6b6b'; c.lineWidth = R2.rstr || h.f === 'city' ? 2 : 3.5; c.globalAlpha = 1 - Math.max(0, (t - en) / 0.25);
    c.beginPath(); c.moveTo(from[0], from[1]); c.lineTo(from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p); c.stroke();
    if (p >= 1) { c.font = 'bold 14px system-ui'; c.textAlign = 'center'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText('-' + h.d, to[0] + 14, to[1] - 18 - (t - en) * 40); c.fillStyle = '#ff7b7b'; c.fillText('-' + h.d, to[0] + 14, to[1] - 18 - (t - en) * 40); }
    c.globalAlpha = 1;
  });
  for (const u of all) {
    const pos = btlPos.get(u.id); if (!pos) continue;
    const hp = hpAt(u.id);
    const fade = !u.alive ? Math.max(0.15, 1 - t) : 1;
    c.globalAlpha = fade;
    unitToken(c, u.t, u.o, pos[0], pos[1], 17, {});
    if (u.eq && u.eq.weapon) IC.draw(c, u.eq.weapon, pos[0] + 15, pos[1] - 14, 11, '#f0c35a', 2.6);
    c.fillStyle = '#000a'; c.fillRect(pos[0] - 18, pos[1] + 21, 36, 5); c.fillStyle = hpCol(hp); c.fillRect(pos[0] - 18, pos[1] + 21, 36 * Math.max(0, hp) / R.HPMAX, 5);
    c.globalAlpha = 1;
  }
  if (BT.city) {
    const [x, y] = btlPos.get('city'), hp = hpAt('city');
    c.beginPath(); if (c.roundRect) c.roundRect(x - 26, y - 26, 52, 52, 10); else c.rect(x - 26, y - 26, 52, 52); c.fillStyle = '#0d1322'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = pcolor(BT.city.o); c.stroke();
    IC.draw(c, 'city', x, y, 34, pcolor(BT.city.o), 2.4);
    c.fillStyle = '#000a'; c.fillRect(x - 28, y + 31, 56, 6); c.fillStyle = '#ef5350'; c.fillRect(x - 28, y + 31, 56 * Math.max(0, hp) / BT.city.mhp, 6);
    c.font = '11px system-ui'; c.fillStyle = '#cbd5e1'; c.textAlign = 'center'; c.fillText(`${BT.city.name} ${Math.round(hp)}/${BT.city.mhp}`, x, y + 50);
  }
  if (BT.last && BT.last.dTac && t > 0.05) {
    const tn = k => k ? R.TACTICS[k] ? R.TACTICS[k].name : '후퇴' : '';
    c.font = '700 13px system-ui'; c.textAlign = 'center';
    const msg = `${tn(BT.last.aTac)}  vs  ${tn(BT.last.dTac)}`;
    c.fillStyle = BT.last.adv === 'a' ? '#86efac' : BT.last.adv === 'd' ? '#ff8a8a' : '#e6eaf3';
    c.fillText(msg, W / 2, H - 14);
  }
  if (t >= 1 && !BT.over) btlAnim = null;
}
const TAC_ICON = { charge: 'charge', volley: 'archer', shield: 'shield' };
function renderBattleUI() {
  const b = BT;
  $('#btlTitle').innerHTML = `${ic('swords', 18)} 전투 ${b.over ? '종료' : `· 라운드 ${b.round + 1}/${b.max}`}`;
  let h = '';
  if (b.last && b.last.dTac) {
    const tn = k => R.TACTICS[k] ? R.TACTICS[k].name : '후퇴';
    h += `<div class="rres">지난 라운드: 아군 <b>${tn(b.mine ? b.last.aTac : b.last.dTac)}</b> vs 적 <b>${tn(b.mine ? b.last.dTac : b.last.aTac)}</b> → ${b.last.adv ? ((b.last.adv === 'a') === b.mine ? '<span class="pos">아군 우세!</span>' : '<span class="neg">적 우세</span>') : '대등'}</div>`;
  }
  if (b.over) {
    const res = { win: '승리!', lose: '패배', draw: '무승부 — 양쪽 모두 버텼습니다', siege: '도시가 아직 버티고 있습니다', retreat: '후퇴했습니다' }[b.result] || b.result;
    const good = b.mine ? b.result === 'win' : b.result !== 'win';
    h += `<div class="hint" style="background:${good ? '#14301f' : '#3a1519'};border-color:${good ? '#24543a' : '#6d2630'};font-size:15px"><b>${b.mine ? res : b.result === 'win' ? '방어 실패' : '방어 성공!'}</b><span class="mut">· 아군 손실 ${b.mine ? b.loss.a : b.loss.d} · 적 손실 ${b.mine ? b.loss.d : b.loss.a}</span></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="pri" id="btlClose">${ic('check', 15)} 확인</button></div>`;
  } else if (b.mine) {
    h += `<div class="hint">${ic(TAC_ICON[b.hint] || 'eye', 18)} 정찰 보고: 적 지휘관은 <b>${R.TACTICS[b.hint].name}</b>을(를) 즐겨 씁니다</div>`;
    h += `<div class="tacs">${Object.keys(R.TACTICS).map(k => `<button class="tac" data-tac="${k}"><b>${ic(TAC_ICON[k], 18)} ${R.TACTICS[k].name}</b><small>${R.TACTICS[k].desc}</small></button>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button data-tac="retreat">${ic('retreat', 15)} 후퇴</button><div class="sp"></div><button data-tac="auto">${ic('play', 15)} 자동 전투</button></div>`;
  } else h += `<div class="hint">${ic('shield', 18)} 우리 영토가 공격받고 있습니다. 상대가 전술을 고르는 중…</div><div class="row" style="justify-content:flex-end;margin-top:10px"><button id="btlClose">닫기</button></div>`;
  $('#btlUI').innerHTML = h;
}
$('#btlUI').onclick = e => {
  const b = e.target.closest('[data-tac]');
  if (b && BT && !BT.over) { act('btac', { battle: BT.id, tac: b.dataset.tac }); $('#btlUI').querySelectorAll('button').forEach(x => x.disabled = true); return; }
  if (e.target.closest('#btlClose')) { $('#mBattle').classList.remove('on'); BT = null; }
};
setInterval(() => { $('#btlTimer').style.display = BT && !BT.over ? '' : 'none'; if (!BT || BT.over || !$('#mBattle').classList.contains('on')) return; BT.left = Math.max(0, BT.left - 250); $('#btlTimer').innerHTML = `${ic('hourglass', 14)} ${Math.ceil(BT.left / 1000)}초`; }, 250);

// ───────── 단축키 ─────────
document.addEventListener('keydown', e => {
  if (!inGame || !S || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if ($('#mBattle').classList.contains('on') && BT && BT.mine && !BT.over) { const map = { '1': 'charge', '2': 'volley', '3': 'shield' }; if (map[k]) act('btac', { battle: BT.id, tac: map[k] }); return; }
  if (k === 'enter') { act(S.players[me].ready ? 'unready' : 'ready'); e.preventDefault(); }
  else if (k === ' ' || k === 'n') { selectNext(); e.preventDefault(); }
  else if (k === 'escape') { select(null); document.querySelectorAll('.modal.on').forEach(m => !['mDead', 'mBattle'].includes(m.id) && m.classList.remove('on')); }
  else if (k === 't') openTech();
  else if (k === 'd') openDip();
  else if (k === 'p') openIdeo();
  else if (k === 'g') openNation();
  else if (k === 'm') openMarket();
  else if (sel && sel.kind === 'stack') {
    if (k === 'f') { act('fortify', { units: pickedUnits().map(u => u.id) }); autoNext = true; }
    if (k === 'b') { act('found', { unit: sel.focus }); autoNext = true; }
    if (k === 's') { act('skip', { units: pickedUnits().map(u => u.id) }); autoNext = true; }
    if (k === 'i') { act('improve', { unit: sel.focus }); autoNext = true; }
  }
  const pan = 80 / cam.z;
  if (k === 'arrowleft') { cam.x -= pan; clampCam(); dirty = true; } if (k === 'arrowright') { cam.x += pan; clampCam(); dirty = true; }
  if (k === 'arrowup') { cam.y -= pan; clampCam(); dirty = true; } if (k === 'arrowdown') { cam.y += pan; clampCam(); dirty = true; }
  if (k === '=' || k === '+') zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.15);
  if (k === '-') zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.15);
});

if (token) { wantRejoin = true; $('#conn').classList.add('on'); }
connect();
