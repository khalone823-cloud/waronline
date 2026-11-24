'use strict';
// 문명 전쟁 온라인 - 클라이언트
const R = RULES, IC = ICONS, $ = s => document.querySelector(s);
const ic = (n, s, c) => IC.svg(n, s || 16, c);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STOCK_KEYS = Object.keys(R.STOCK);
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
function hpCol(hp) { return hp > 60 ? '#4ade80' : hp > 30 ? '#facc15' : '#ef5350'; }

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
    case 'map': MAP = m; FOG = ''; OWNER = []; IMP = ''; S = null; deadShown = false; buildTerrain(); show('game'); wantRejoin = false; break;
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
function buildTerrain() {
  worldW = MAP.W * SQ3 * HS + SQ3 * HS / 2; worldH = MAP.H * 1.5 * HS + HS / 2;
  kScale = Math.min(1.6, 3800 / worldW, 3800 / worldH);
  terrCv = document.createElement('canvas'); terrCv.width = Math.ceil(worldW * kScale); terrCv.height = Math.ceil(worldH * kScale);
  overCv = document.createElement('canvas'); overCv.width = terrCv.width; overCv.height = terrCv.height;
  const c = terrCv.getContext('2d'); c.scale(kScale, kScale);
  c.fillStyle = '#05070d'; c.fillRect(0, 0, worldW, worldH);
  for (let i = 0; i < MAP.W * MAP.H; i++) {
    const t = MAP.terr[i], T = R.TERRAIN[t], [cx, cy] = center(i);
    hexPath(c, cx, cy, HS + 0.6); c.fillStyle = shade(T.color, 0.92 + hash(i, 1) * 0.16); c.fill();
    c.save(); hexPath(c, cx, cy, HS); c.clip();
    if (t === 'ocean') {
      const coast = [0, 1, 2, 3, 4, 5].some(d => { const n = nbDir(i, d); return n >= 0 && MAP.terr[n] !== 'ocean'; });
      if (coast) { hexPath(c, cx, cy, HS); c.fillStyle = '#2f6aa8'; c.fill(); }
      c.strokeStyle = '#ffffff22'; c.lineWidth = 1.2;
      for (let k = 0; k < 2; k++) { const ox = cx + (hash(i, 10 + k) - 0.5) * 30, oy = cy + (hash(i, 20 + k) - 0.5) * 26; c.beginPath(); c.arc(ox, oy, 5, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
    } else if (t === 'forest') {
      for (let k = 0; k < 5; k++) { const ox = cx + (hash(i, 10 + k) - 0.5) * 34, oy = cy + (hash(i, 20 + k) - 0.5) * 30; c.fillStyle = k % 2 ? '#1f4d1d' : '#245a22'; c.beginPath(); c.moveTo(ox, oy - 9); c.lineTo(ox - 6, oy + 5); c.lineTo(ox + 6, oy + 5); c.fill(); c.fillStyle = '#4a3220'; c.fillRect(ox - 1, oy + 5, 2, 3); }
    } else if (t === 'hills') {
      c.strokeStyle = '#5e4d2b'; c.lineWidth = 2.2;
      for (let k = 0; k < 3; k++) { const ox = cx + (k - 1) * 13 + (hash(i, k) - 0.5) * 6, oy = cy + (hash(i, 5 + k) - 0.5) * 14; c.beginPath(); c.arc(ox, oy + 6, 9, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
    } else if (t === 'mountain') {
      for (let k = 0; k < 2; k++) { const ox = cx + (k ? 9 : -7), oy = cy + (k ? 6 : 0), h = k ? 16 : 22; c.fillStyle = '#5b5b62'; c.beginPath(); c.moveTo(ox, oy - h); c.lineTo(ox - 13, oy + 10); c.lineTo(ox + 13, oy + 10); c.fill(); c.fillStyle = '#eef2f7'; c.beginPath(); c.moveTo(ox, oy - h); c.lineTo(ox - 5, oy - h + 8); c.lineTo(ox + 5, oy - h + 8); c.fill(); }
    } else if (t === 'desert') {
      c.fillStyle = '#b89c55'; for (let k = 0; k < 8; k++) c.fillRect(cx + (hash(i, 10 + k) - 0.5) * 36, cy + (hash(i, 20 + k) - 0.5) * 32, 2, 2);
    } else if (t === 'grass' || t === 'plains') {
      c.strokeStyle = t === 'grass' ? '#3f7a2a' : '#878c38'; c.lineWidth = 1;
      for (let k = 0; k < 6; k++) { const ox = cx + (hash(i, 10 + k) - 0.5) * 36, oy = cy + (hash(i, 20 + k) - 0.5) * 32; c.beginPath(); c.moveTo(ox, oy); c.lineTo(ox - 2, oy - 5); c.moveTo(ox, oy); c.lineTo(ox + 2, oy - 5); c.stroke(); }
    } else if (t === 'tundra') {
      c.fillStyle = '#e8eef0aa'; for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(cx + (hash(i, 10 + k) - 0.5) * 32, cy + (hash(i, 20 + k) - 0.5) * 28, 4, 0, 7); c.fill(); }
    }
    c.restore();
    hexPath(c, cx, cy, HS); c.strokeStyle = '#00000022'; c.lineWidth = 1; c.stroke();
  }
  miniBase = document.createElement('canvas'); miniBase.width = MAP.W * 2 + 1; miniBase.height = MAP.H * 2;
}
function badgeIcon(c, name, x, y, col, size) {
  c.beginPath(); c.arc(x, y, size * 0.72, 0, 7); c.fillStyle = '#0a0e18cc'; c.fill(); c.strokeStyle = '#ffffff30'; c.lineWidth = 1; c.stroke();
  IC.draw(c, name, x, y, size, col, 2.4);
}
function buildOverlay() {
  const c = overCv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, overCv.width, overCv.height); c.scale(kScale, kScale);
  const N = MAP.W * MAP.H, fog = FOG, own = OWNER;
  for (let i = 0; i < N; i++) {
    if (fog.charCodeAt(i) === 48) continue;
    const [cx, cy] = center(i);
    if (own[i] >= 0) { hexPath(c, cx, cy, HS); c.fillStyle = pcolor(own[i]) + '24'; c.fill(); }
    const im = IMP[i];
    if (im && im !== '.') badgeIcon(c, R.IMP_BY_CODE[im], cx - 13, cy + 13, '#f5f0e0', 11);
    const r = MAP.res[i];
    if (r) badgeIcon(c, r, cx + 13, cy + 13, RES_COLOR[r] || '#fff', 11);
  }
  for (let i = 0; i < N; i++) {
    const o = own[i]; if (o < 0 || fog.charCodeAt(i) === 48) continue;
    const [cx, cy] = center(i);
    for (let d = 0; d < 6; d++) {
      const n = nbDir(i, d);
      if (n >= 0 && own[n] === o) continue;
      const k = DIR_CORNER[d], [x1, y1] = corner(cx, cy, k, HS - 2.5), [x2, y2] = corner(cx, cy, (k + 1) % 6, HS - 2.5);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = pcolor(o); c.lineWidth = 3.2; c.stroke();
    }
  }
  for (let i = 0; i < N; i++) {
    const f = fog.charCodeAt(i) - 48; if (f === 2) continue;
    const [cx, cy] = center(i);
    hexPath(c, cx, cy, HS + 0.8); c.fillStyle = f === 0 ? '#05070d' : '#05070d88'; c.fill();
  }
  const m = miniBase.getContext('2d'), img = m.createImageData(miniBase.width, miniBase.height);
  for (let i = 0; i < N; i++) {
    const x = i % MAP.W, y = (i / MAP.W) | 0, f = fog.charCodeAt(i) - 48;
    let col = [5, 7, 13];
    if (f > 0) {
      const hex = own[i] >= 0 ? pcolor(own[i]) : R.TERRAIN[MAP.terr[i]].color;
      const n = parseInt(hex.slice(1), 16); col = [n >> 16, (n >> 8) & 255, n & 255];
      if (f === 1) col = col.map(v => v * 0.55);
    }
    const ox = x * 2 + (y & 1);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = ((y * 2 + dy) * miniBase.width + ox + dx) * 4; img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255; }
  }
  m.putImageData(img, 0, 0);
}
function unitToken(c, type, owner, x, y, r, opts) {
  const U = R.UNITS[type], col = pcolor(owner), o = opts || {};
  c.beginPath();
  if (U.civ) { if (c.roundRect) c.roundRect(x - r, y - r, r * 2, r * 2, r * 0.35); else c.rect(x - r, y - r, r * 2, r * 2); }
  else c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = col; c.fill();
  c.lineWidth = o.sel ? 3.5 : 2; c.strokeStyle = o.sel ? '#ffe14a' : o.war ? '#ff4d4d' : '#0b0f1a'; c.stroke();
  IC.draw(c, type, x, y, r * 1.25, lum(col) > 0.6 ? '#141414' : '#ffffff', 2.4);
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
    const r = inCity ? HS * 0.34 : HS * 0.48;
    const x = cx + ox + (inCity ? HS * 0.3 : 0), y = cy + (inCity ? HS * 0.42 : 0);
    const selected = sel && sel.kind === 'stack' && sel.tile === i && o === me;
    const war = o !== me && P(o) && P(o).d === 'war';
    if (list.length > 1) unitToken(ctx, main.t, o, x + 3, y - 3, r, { war });
    unitToken(ctx, main.t, o, x, y, r, { sel: selected, war });
    if (mil.length && civ.length) unitToken(ctx, civ[0].t, o, x - r * 0.95, y + r * 0.55, r * 0.5, {});
    const avgHp = list.reduce((s, u) => s + u.hp, 0) / list.length;
    if (avgHp < 100) { ctx.fillStyle = '#000a'; ctx.fillRect(x - r, y + r + 2, r * 2, 4); ctx.fillStyle = hpCol(avgHp); ctx.fillRect(x - r, y + r + 2, r * 2 * avgHp / 100, 4); }
    if (list.length > 1) {
      const t = String(list.length); ctx.font = 'bold 11px system-ui'; const w = Math.max(16, ctx.measureText(t).width + 8);
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x + r * 0.45, y - r - 4, w, 15, 7); else ctx.rect(x + r * 0.45, y - r - 4, w, 15);
      ctx.fillStyle = '#0a0e18'; ctx.fill(); ctx.strokeStyle = '#f0c35a'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = '#f0c35a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + r * 0.45 + w / 2, y - r + 3.5);
    }
    if (o === me) {
      const idle = list.some(u => u.mv > 0 && !u.f && !u.s && !u.w);
      if (idle) { ctx.beginPath(); ctx.arc(x - r * 0.8, y - r * 0.8, 3.8, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
      else if (list.every(u => u.f || !R.UNITS[u.t].str)) IC.draw(ctx, 'shield', x - r * 0.8, y - r * 0.8, 10, '#93c5fd', 2.6);
      if (list.some(u => u.w)) IC.draw(ctx, 'hammer', x + r * 0.9, y + r * 0.6, 10, '#facc15', 2.6);
    }
    if (list.some(u => u.b)) IC.draw(ctx, 'swords', x, y - r - 12, 14, '#ff6b6b', 2.6);
  });
}
function drawCity(c) {
  const [cx, cy] = center(c.p), col = pcolor(c.o), war = c.o !== me && P(c.o) && P(c.o).d === 'war';
  const s = HS * 0.62;
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(cx - s, cy - s - 2, s * 2, s * 2, 8); else ctx.rect(cx - s, cy - s - 2, s * 2, s * 2);
  ctx.fillStyle = '#0d1322e8'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.stroke();
  IC.draw(ctx, 'city', cx, cy - 2, s * 1.35, col, 2.4);
  if (c.cap) IC.draw(ctx, 'star', cx + s - 2, cy - s, 11, '#f0c35a', 2.6);
  const label = `${c.pop}  ${c.name}`;
  ctx.font = '600 12px system-ui,sans-serif';
  const w = ctx.measureText(label).width + 16, by = cy - HS * 1.12;
  ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(cx - w / 2, by - 9, w, 18, 9); else ctx.rect(cx - w / 2, by - 9, w, 18);
  ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = war ? '#ff3b3b' : '#000b'; ctx.lineWidth = war ? 2 : 1.2; ctx.stroke();
  ctx.fillStyle = lum(col) > 0.6 ? '#111' : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, cx, by + 1);
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
      const r = R.reach(MAP.W, MAP.H, MAP.terr, u.p, u.mv, canStand, canStand);
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
function waiting() { return S && S.my.alive ? S.units.filter(u => u.o === me && u.mv > 0 && !u.f && !u.s && !u.w && !u.b) : []; }
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
  if ($('#mMarket').classList.contains('on')) renderMarket();
  if ($('#mRank').classList.contains('on')) renderRank();
  if (!S.my.alive && !deadShown) { deadShown = true; $('#mDead').classList.add('on'); }
  if (S.my.alive) { deadShown = false; $('#mDead').classList.remove('on'); }
  dirty = true;
}

// ───────── 상단 바 ─────────
function renderNav() {
  const inc = S ? (S.props || []).filter(p => p.to === me).length : 0;
  const nav = [['bTech', 'tech', '기술'], ['bDip', 'handshake', '외교', inc], ['bMarket', 'scale', '시장'], ['bRank', 'crown', '순위'], ['bChat', 'chat', '채팅', chatUnread], ['bMenu', 'menu', '']];
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
      const status = u.b ? '전투 중' : u.w ? `${R.IMPS[u.w.imp].name} 건설 ${u.w.left}턴` : u.f ? '요새화' : u.s ? '대기' : u.mv > 0 ? `이동 ${u.mv}/${u.mm}` : '행동 완료';
      return `<div class="urow ${u.id === f.id ? 'focus' : ''}" data-focus="${u.id}"><input type="checkbox" data-pick="${u.id}" ${sel.picked.has(u.id) ? 'checked' : ''}>
        <span class="tk ${U.civ ? 'civ' : ''}" style="background:${col};color:${lum(col) > 0.6 ? '#111' : '#fff'}">${ic(u.t, 16)}</span>
        <span class="nm"><b>${U.name}${u.v ? ' ' + ic('star', 11) : ''}</b><small>${status}${U.str ? ` · 공 ${st.atk} 방 ${st.def}` : ''}</small>${bar(u.hp, 100, hpCol(u.hp))}</span></div>`;
    }).join('') + '</div><div class="sec">선택한 유닛</div>';
  }
  h += unitDetail(f);
  h += '</div>';
  return h;
}
function unitDetail(u) {
  const st = unitStats(u), U = st.U;
  let h = `<div class="kv"><div>${ic('heart', 14)}<b>${u.hp}</b></div><div>${ic('boot', 14)}<b>${u.mv}/${u.mm}</b></div>${U.str ? `<div>${ic(U.rstr ? 'archer' : 'atk', 14)}<b>${st.atk}</b></div><div>${ic('shield', 14)}<b>${st.def}</b></div>` : `<div class="dim">민간</div><div class="dim">—</div>`}</div>`;
  if (U.desc) h += `<div class="mut" style="font-size:12px;margin-top:6px">${U.desc}${U.range ? ` · 사거리 ${U.range}` : ''}</div>`;
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
    return `<div class="urow" style="cursor:default"><span class="tk ${st.U.civ ? 'civ' : ''}" style="background:${col};color:${lum(col) > 0.6 ? '#111' : '#fff'}">${ic(u.t, 16)}</span><span class="nm"><b>${st.U.name}</b><small>${st.U.str ? `공 ${st.atk} 방 ${st.def}` : '민간'}${u.f ? ' · 요새화' : ''}${u.eq && Object.keys(u.eq).length ? ' · 장비 ' + Object.values(u.eq).map(k => R.EQUIP[k].name).join(', ') : ''}</small>${bar(u.hp, 100, hpCol(u.hp))}</span></div>`;
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
  h += `<div class="pb" style="padding-bottom:4px"><div class="kv"><div style="color:#bef264">${ic('food', 14)}<b>${surplus >= 0 ? '+' : ''}${surplus}</b></div><div style="color:#fdba74">${ic('prod', 14)}<b>${y.prod}</b></div><div style="color:var(--gold)">${ic('coin', 14)}<b>${y.gold}</b></div><div style="color:var(--blue)">${ic('flask', 14)}<b>${y.sci}</b></div></div>
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
      return `<button class="pitem ${isCur('unit', k)}" data-prod="unit" data-type="${k}">${ic(k, 20)}<span class="nm"><b>${U.name}</b><small>${U.str ? `공 ${U.rstr || U.str} · 방 ${U.str} · 이동 ${U.moves}` : U.desc}${U.res ? ' ' + resChips(U.res) : ''}</small></span><span class="cost">${ic('prod', 12)} ${cost(U.cost)}<br>${turns(U.cost)}턴</span></button>`;
    }).join('') + '</div>';
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
    h += '<div class="tcol">';
    for (const k of Object.keys(R.TECHS).filter(k => depth[k] === d)) {
      const T = R.TECHS[k];
      const cls = techs[k] ? 'known' : S.my.res === k ? 'res' : avail.has(k) ? 'avail' : 'locked';
      const ul = [...Object.keys(R.UNITS).filter(u => R.UNITS[u].tech === k).map(u => `<span class="chip">${ic(u, 12)}${R.UNITS[u].name}</span>`),
        ...Object.keys(R.BUILDINGS).filter(b => R.BUILDINGS[b].tech === k).map(b => `<span class="chip">${ic(b, 12)}${R.BUILDINGS[b].name}</span>`),
        ...Object.keys(R.EQUIP).filter(b => R.EQUIP[b].tech === k).map(b => `<span class="chip">${ic(b, 12)}${R.EQUIP[b].name}</span>`)];
      const c = S.my.tcosts[k] || Math.round(T.cost * S.speed * 1.9);
      const turns = S.my.spt > 0 ? Math.max(1, Math.ceil((c - (S.my.res === k ? S.my.sci : 0)) / S.my.spt)) : '∞';
      h += `<div class="tc ${cls}" data-tech="${k}"><b>${techs[k] ? ic('check', 14, 'pos') : ''}${T.name}</b>
        ${techs[k] ? '' : `<div class="mut">${ic('flask', 12)} ${c}${cls !== 'locked' ? ` · ${turns}턴` : ''}</div>`}
        ${!techs[k] && T.res ? `<div style="margin-top:4px">${paid.has(k) ? '<span class="chip">자원 투입됨</span>' : resChips(T.res)}</div>` : ''}
        ${T.desc ? `<div class="mut" style="font-size:11px;margin-top:3px">${T.desc}</div>` : ''}
        ${T.req.length ? `<div class="dim" style="font-size:11px;margin-top:3px">선행: ${T.req.map(r => R.TECHS[r].name).join(', ')}</div>` : ''}
        ${ul.length ? `<div class="ul">${ul.join('')}</div>` : ''}</div>`;
    }
    h += '</div>';
  }
  $('#techTree').innerHTML = h;
  $('#techInfo').innerHTML = `턴당 과학 <b class="pos">+${S.my.spt}</b> · 모아둔 과학 ${S.my.sci} · ${S.my.res ? `연구 중: <b>${R.TECHS[S.my.res].name}</b>` : '<span class="neg">연구할 기술을 고르세요</span>'} · 일부 기술은 시작할 때 자원이 필요합니다`;
}
$('#techTree').onclick = e => { const t = e.target.closest('.tc.avail,.tc.res'); if (!t) return; act('research', { tech: t.dataset.tech }); };

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
        <div class="meta"><span>태도: <b style="color:${q.op >= 15 ? 'var(--green)' : q.op <= -15 ? 'var(--red)' : 'var(--text)'}">${q.op >= 50 ? '우호적' : q.op >= 15 ? '호의적' : q.op > -15 ? '중립' : q.op > -50 ? '경계' : '적대적'}</b> (${q.op})</span><span class="opbar" style="display:inline-block"><i style="left:${opPos}%"></i></span><span>군사력 ${milTxt}</span><span>신뢰 ${q.trust}</span><span>도시 ${q.cities} · 점수 ${q.score}</span>${treaty ? `<span>${treaty}</span>` : ''}</div></div>
        <div class="btns"><button class="sm pri" data-deal="${q.id}">${ic('swap', 13)} ${q.d === 'war' ? '평화 협상' : '거래 제안'}</button>${warBtn}</div></div>`;
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
    c.fillStyle = '#000a'; c.fillRect(pos[0] - 18, pos[1] + 21, 36, 5); c.fillStyle = hpCol(hp); c.fillRect(pos[0] - 18, pos[1] + 21, 36 * Math.max(0, hp) / 100, 5);
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
