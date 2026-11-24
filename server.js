'use strict';
// 문명 전쟁 온라인 - 영구 월드 서버 (외부 패키지 없이 동작)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const R = require('./public/rules.js');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const CFG = {
  W: +process.env.WORLD_W || 72,                   // 월드 가로 칸 수
  H: +process.env.WORLD_H || 48,                   // 월드 세로 칸 수
  TURN_SECONDS: +process.env.TURN_SECONDS || 30,   // 월드 턴 간격 (초)
  AI_COUNT: process.env.AI_COUNT != null ? +process.env.AI_COUNT : 6, // 항상 유지할 AI 문명 수
  PROTECT_TURNS: +process.env.PROTECT_TURNS || 60, // 신규 보호 턴
  INACTIVE_HOURS: +process.env.INACTIVE_HOURS || 72, // 이 시간 동안 접속 없으면 제국 소멸
  SPEED: process.env.SPEED || 'normal',
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, 'data'),
};
const SAVE_FILE = path.join(CFG.DATA_DIR, 'world.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.svg': 'image/svg+xml' };

// ───────────────────────── 최소 WebSocket 구현 ─────────────────────────
class WS extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket; this.buf = Buffer.alloc(0); this.frags = []; this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._gone());
    socket.on('error', () => this._gone());
  }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (true) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { this.close(); return; }
      const ml = masked ? 4 : 0;
      if (this.buf.length < off + ml + len) return;
      const payload = Buffer.from(this.buf.subarray(off + ml, off + ml + len));
      if (masked) { const m = this.buf.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      this.buf = this.buf.subarray(off + ml + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this._send(0xA, payload); continue; }
      if (op === 0xA) continue;
      this.frags.push(payload);
      if (fin) { const msg = Buffer.concat(this.frags).toString('utf8'); this.frags = []; this.emit('message', msg); }
    }
  }
  _send(op, data) {
    if (this.closed || this.socket.destroyed) return;
    const len = data.length; let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([h, data]));
  }
  send(str) { this._send(0x1, Buffer.from(str, 'utf8')); }
  ping() { this._send(0x9, Buffer.alloc(0)); }
  close() { if (this.closed) return; try { this._send(0x8, Buffer.alloc(0)); } catch (e) {} this._gone(); }
  _gone() { if (this.closed) return; this.closed = true; try { this.socket.destroy(); } catch (e) {} this.emit('close'); }
}

// ───────────────────────── 유틸 ─────────────────────────
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}
function send(ws, obj) { if (ws) try { ws.send(JSON.stringify(obj)); } catch (e) {} }
const COLORS = ['#e23b3b', '#8b5cf6', '#0ea5e9', '#eab308', '#f97316', '#f1f5f9', '#22c55e', '#ec4899', '#14b8a6', '#a3e635', '#f43f5e', '#6366f1',
  '#fb923c', '#38bdf8', '#c084fc', '#facc15', '#4ade80', '#f472b6', '#2dd4bf', '#94a3b8', '#b45309', '#1d4ed8', '#be123c', '#15803d', '#7c3aed', '#0891b2'];

// ───────────────────────── 맵 생성 ─────────────────────────
function genMap(W, H, seed) {
  const rnd = mulberry32(seed);
  const N = W * H;
  function layer(scale) {
    const gw = Math.ceil(W / scale) + 3, gh = Math.ceil(H / scale) + 3, g = [];
    for (let i = 0; i < gw * gh; i++) g.push(rnd());
    const s = t => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = x / scale, fy = y / scale, x0 = Math.floor(fx), y0 = Math.floor(fy);
      const u = s(fx - x0), v = s(fy - y0);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  const e1 = layer(13), e2 = layer(6), e3 = layer(2.6), m1 = layer(8), m2 = layer(3.5);
  const elev = new Float32Array(N), moist = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x + 0.5 * (y & 1), i = y * W + x;
    let e = e1(px, y) * 0.55 + e2(px, y) * 0.3 + e3(px, y) * 0.15;
    const nx = (px / W) * 2 - 1, ny = (y / H) * 2 - 1;
    e -= Math.pow(Math.max(Math.abs(nx), Math.abs(ny)), 3) * 0.5;
    elev[i] = e; moist[i] = m1(px, y) * 0.65 + m2(px, y) * 0.35;
  }
  const sorted = Array.from(elev).sort((a, b) => a - b);
  const sea = sorted[Math.floor(N * 0.38)];
  const land = []; for (let i = 0; i < N; i++) if (elev[i] >= sea) land.push(i);
  const le = land.map(i => elev[i]).sort((a, b) => a - b);
  const mtn = le[Math.floor(le.length * 0.95)], hill = le[Math.floor(le.length * 0.83)];
  const lm = land.map(i => moist[i]).sort((a, b) => a - b);
  const q = p => lm[Math.floor(lm.length * p)];
  const mDes = q(0.12), mPla = q(0.42), mGra = q(0.76);
  const terr = new Array(N).fill('ocean'), res = new Array(N).fill(null);
  for (const i of land) {
    const y = (i / W) | 0, lat = Math.abs((y / H) * 2 - 1);
    let t;
    if (elev[i] >= mtn) t = 'mountain';
    else if (elev[i] >= hill) t = 'hills';
    else if (lat > 0.86) t = 'tundra';
    else if (moist[i] < mDes && lat < 0.6) t = 'desert';
    else if (moist[i] < mPla) t = 'plains';
    else if (moist[i] < mGra) t = 'grass';
    else t = 'forest';
    terr[i] = t;
  }
  for (let i = 0; i < N; i++) {
    const t = terr[i], r = rnd();
    if (t === 'ocean') { if (r < 0.1 && R.neighbors(i, W, H).some(n => terr[n] !== 'ocean')) res[i] = 'fish'; }
    else if (r < 0.11) {
      if (t === 'grass' || t === 'plains') res[i] = rnd() < 0.6 ? 'wheat' : 'horse';
      else if (t === 'hills') res[i] = rnd() < 0.6 ? 'iron' : 'gold';
      else if (t === 'desert') res[i] = 'gold';
      else if (t === 'forest' && rnd() < 0.4) res[i] = 'iron';
      else if (t === 'tundra') res[i] = 'horse';
    }
  }
  // 작은 섬은 바다로 (배가 없으므로)
  const comp = new Int32Array(N).fill(-1); let cid = 0;
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0 || !R.TERRAIN[terr[i]].pass) continue;
    const stack = [i], members = [i]; comp[i] = cid;
    while (stack.length) { const c = stack.pop(); for (const n of R.neighbors(c, W, H)) if (comp[n] < 0 && R.TERRAIN[terr[n]].pass) { comp[n] = cid; stack.push(n); members.push(n); } }
    if (members.length < 25) for (const m of members) { terr[m] = 'ocean'; res[m] = null; }
    cid++;
  }
  return { terr, res };
}

// ───────────────────────── 월드 ─────────────────────────
class World {
  constructor(saved) {
    this.speedKey = R.SPEEDS[CFG.SPEED] ? CFG.SPEED : 'normal';
    this.speed = R.SPEEDS[this.speedKey].mult;
    this.units = new Map(); this.cities = new Map(); this.cityAt = new Map(); this.claimTiles = new Map();
    this.rnd = mulberry32((Math.random() * 1e9) | 0);
    this.touched = new Set(); this.claimsDirty = false;
    if (saved) this.load(saved);
    else {
      this.W = CFG.W; this.H = CFG.H; this.N = this.W * this.H;
      this.seed = (Math.random() * 1e9) | 0;
      const map = genMap(this.W, this.H, this.seed);
      this.terr = map.terr; this.res = map.res;
      this.nextId = 1; this.turn = 1; this.players = []; this.created = Date.now();
    }
    this.claim = new Int32Array(this.N).fill(-1);
    this.turnStart = Date.now();
    this.dirty = new Set();
    this.refresh();
    if (!saved) for (let k = 0; k < CFG.AI_COUNT; k++) this.addAI();
  }

  // ── 저장/불러오기 ──
  serialize() {
    return JSON.stringify({
      v: 1, W: this.W, H: this.H, seed: this.seed, terr: this.terr, res: this.res, turn: this.turn, nextId: this.nextId, created: this.created,
      players: this.players.map(p => {
        const o = {}; for (const k of Object.keys(p)) if (!['ws', 'visible', 'explored', 'sentFog', 'sentOwner'].includes(k)) o[k] = p[k];
        o.explored = Buffer.from(p.explored || new Uint8Array(this.N)).toString('base64'); return o;
      }),
      units: [...this.units.values()], cities: [...this.cities.values()],
    });
  }
  load(s) {
    this.W = s.W; this.H = s.H; this.N = s.W * s.H; this.seed = s.seed; this.terr = s.terr; this.res = s.res;
    this.turn = s.turn; this.nextId = s.nextId; this.created = s.created || Date.now();
    this.players = s.players.map(p => Object.assign(p, { explored: new Uint8Array(Buffer.from(p.explored, 'base64')), visible: new Uint8Array(this.N), ws: null, ready: false }));
    for (const u of s.units) this.units.set(u.id, u);
    for (const c of s.cities) { this.cities.set(c.id, c); this.cityAt.set(c.pos, c); }
  }

  // ── 기본 헬퍼 ──
  cost(base) { return Math.max(1, Math.round(base * this.speed)); }
  techCost(k) { return Math.max(1, Math.round(R.TECHS[k].cost * this.speed * 1.9)); }
  nm(pid) { const p = this.players[pid]; return p ? p.name : '?'; }
  alivePlayers() { return this.players.filter(p => p.alive && !p.removed); }
  online() { return this.players.filter(p => p.ws); }
  citiesOf(pid) { const out = []; for (const c of this.cities.values()) if (c.owner === pid) out.push(c); return out; }
  unitsOf(pid) { const out = []; for (const u of this.units.values()) if (u.owner === pid) out.push(u); return out; }
  unitsAt(i) { const out = []; for (const u of this.units.values()) if (u.pos === i) out.push(u); return out; }
  occMap() { const m = new Map(); for (const u of this.units.values()) { let a = m.get(u.pos); if (!a) m.set(u.pos, a = []); a.push(u); } return m; }
  dip(a, b) { return this.players[a].diplo[b] || 'peace'; }
  atWar(a, b) { return a !== b && this.dip(a, b) === 'war'; }
  isMil(u) { return !R.UNITS[u.type].civ; }
  protectedP(pid) { const p = this.players[pid]; return !p.isAI && p.protectUntil > this.turn; }

  addUnit(owner, type, pos, vet) {
    const u = { id: this.nextId++, owner, type, pos, hp: 100, moves: R.UNITS[type].moves, fort: false, attacked: false, acted: false, vet: !!vet };
    this.units.set(u.id, u); return u;
  }
  killUnit(u) { this.units.delete(u.id); }
  msgTo(pids, text) {
    for (const pid of new Set(pids)) {
      const p = this.players[pid]; if (!p || p.removed || p.isAI) continue;
      p.log.push({ turn: this.turn, text }); if (p.log.length > 30) p.log.shift();
      send(p.ws, { t: 'log', turn: this.turn, text });
    }
  }
  msg(pid, text) { this.msgTo([pid], text); }
  msgMet(pids, text) { this.msgTo(this.players.filter(p => !p.removed && (pids.includes(p.id) || pids.some(x => p.met && p.met[x]))).map(p => p.id), text); }
  msgAll(text) { this.msgTo(this.players.filter(p => !p.removed).map(p => p.id), text); }
  fx(pos, items) { for (const p of this.players) if (p.ws && p.visible[pos]) send(p.ws, { t: 'fx', pos, items }); }

  // ── 플레이어 생성 ──
  pickColor() {
    const used = new Set(this.alivePlayers().map(p => p.color));
    const free = COLORS.filter(c => !used.has(c));
    if (free.length) return free[Math.floor(this.rnd() * free.length)];
    return `#${Math.floor(this.rnd() * 0xffffff).toString(16).padStart(6, '0')}`;
  }
  findSpawn() {
    const W = this.W, H = this.H;
    const blockers = [...[...this.cities.values()].map(c => c.pos), ...[...this.units.values()].map(u => u.pos)];
    let best = -1, bs = -1e9;
    for (let k = 0; k < 900; k++) {
      const i = Math.floor(this.rnd() * this.N);
      const t = this.terr[i];
      if (t !== 'grass' && t !== 'plains') continue;
      const x = i % W, y = (i / W) | 0;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
      if (R.neighbors(i, W, H).filter(n => R.TERRAIN[this.terr[n]].pass).length < 4) continue;
      let md = 30;
      for (const b of blockers) { const d = R.dist(i, b, W); if (d < md) md = d; }
      let fert = 0;
      for (const j of R.inRadius(i, 2, W, H)) { const y2 = this.tileYield(j); fert += y2.food * 1.2 + y2.prod + y2.gold * 0.5; }
      const s = Math.min(md, 14) * 3 + fert * 0.25 + this.rnd() * 2;
      if (s > bs) { bs = s; best = i; }
    }
    if (best < 0) for (let i = 0; i < this.N; i++) if (R.TERRAIN[this.terr[i]].pass && !this.cityAt.has(i)) { best = i; break; }
    return best;
  }
  resetPlayer(p) {
    // 따라잡기: 살아있는 문명 절반 이상이 아는 기술은 자동 획득
    const others = this.alivePlayers().filter(q => q !== p);
    const techs = { agriculture: 1 };
    if (others.length >= 2) for (const k of Object.keys(R.TECHS)) if (others.filter(q => q.techs[k]).length >= others.length / 2) techs[k] = 1;
    Object.assign(p, {
      gold: 20 + Math.min(300, Math.floor(this.turn * 0.4)), techs, researching: null, sciStore: 0,
      explored: new Uint8Array(this.N), visible: new Uint8Array(this.N), alive: true, removed: false,
      diplo: {}, warTurn: {}, peaceTurn: {}, peaceOffers: [], nameIdx: 0, gpt: 0, spt: 0, score: 0, log: [], met: {},
      joinTurn: this.turn, protectUntil: this.turn + CFG.PROTECT_TURNS, foundedCapital: false, ready: false, color: this.pickColor(),
    });
    for (const q of this.players) if (q !== p && q.diplo) { delete q.diplo[p.id]; delete q.warTurn[p.id]; q.peaceOffers = q.peaceOffers.filter(x => x !== p.id); delete q.met[p.id]; }
    const s = this.findSpawn();
    this.addUnit(p.id, 'settler', s);
    const nb = R.neighbors(s, this.W, this.H).filter(n => R.TERRAIN[this.terr[n]].pass && !this.unitsAt(n).length);
    this.addUnit(p.id, 'warrior', nb[0] != null ? nb[0] : s);
    if (nb[1] != null) this.addUnit(p.id, 'scout', nb[1]);
    if (this.turn > 120 && nb[2] != null) this.addUnit(p.id, 'settler', nb[2]);
    return s;
  }
  addPlayer(name, civ, isAI) {
    const p = { id: this.players.length, token: (isAI ? 'ai' : '') + crypto.randomBytes(12).toString('hex'), name, civ: R.CIVS[civ] ? civ : 0, isAI: !!isAI, lastSeen: Date.now(), ws: null };
    this.players.push(p);
    this.resetPlayer(p);
    this.refresh();
    this.msgAll(`🌱 새 문명 [${p.name}](${R.CIVS[p.civ].name})이(가) 세계에 등장했습니다`);
    return p;
  }
  addAI() {
    const civ = Math.floor(this.rnd() * R.CIVS.length);
    const used = new Set(this.alivePlayers().map(p => p.name));
    let name = R.CIVS[civ].leader, n = 2;
    while (used.has(name)) name = R.CIVS[civ].leader + ' ' + (n++);
    return this.addPlayer(name, civ, true);
  }
  removeEmpire(p, reason) {
    for (const c of this.citiesOf(p.id)) { this.cities.delete(c.id); this.cityAt.delete(c.pos); }
    for (const u of this.unitsOf(p.id)) this.units.delete(u.id);
    p.alive = false; p.removed = true;
    if (p.ws) { send(p.ws, { t: 'kicked', msg: reason }); const w = p.ws; p.ws = null; w.pid = null; w.close(); }
    for (const q of this.players) if (q.diplo) { delete q.diplo[p.id]; q.peaceOffers = q.peaceOffers.filter(x => x !== p.id); }
    this.refresh();
  }

  // ── 영토·시야 ──
  cityRadius(c) { return 2 + (c.buildings.includes('monument') ? 1 : 0) + (c.pop >= 9 ? 1 : 0); }
  computeClaims() {
    this.claim.fill(-1); this.claimTiles = new Map();
    const cs = [...this.cities.values()].sort((a, b) => a.id - b.id);
    for (const c of cs) this.claimTiles.set(c.id, []);
    for (let d = 0; d <= 4; d++) for (const c of cs) {
      if (this.cityRadius(c) < d) continue;
      for (const j of R.inRadius(c.pos, d, this.W, this.H)) if (this.claim[j] === -1 && R.dist(c.pos, j, this.W) === d) { this.claim[j] = c.id; this.claimTiles.get(c.id).push(j); }
    }
  }
  tileOwner(i) { const c = this.claim[i]; if (c < 0) return -1; const city = this.cities.get(c); return city ? city.owner : -1; }
  computeVis(p) {
    const v = p.visible; v.fill(0);
    if (p.removed || !p.alive) return;
    for (const u of this.units.values()) if (u.owner === p.id) {
      const s = (R.UNITS[u.type].sight || 2) + (this.terr[u.pos] === 'hills' ? 1 : 0);
      for (const j of R.inRadius(u.pos, s, this.W, this.H)) v[j] = 1;
    }
    for (const c of this.cities.values()) if (c.owner === p.id) {
      for (const j of R.inRadius(c.pos, 2, this.W, this.H)) v[j] = 1;
      for (const j of this.claimTiles.get(c.id) || []) v[j] = 1;
    }
    for (let i = 0; i < this.N; i++) if (v[i]) p.explored[i] = 1;
    for (const u of this.units.values()) if (u.owner !== p.id && v[u.pos]) p.met[u.owner] = 1;
    for (const c of this.cities.values()) if (c.owner !== p.id && v[c.pos]) p.met[c.owner] = 1;
  }
  refresh(pids) {
    if (!pids) { this.computeClaims(); for (const p of this.players) this.computeVis(p); }
    else for (const id of pids) if (this.players[id]) this.computeVis(this.players[id]);
  }

  // ── 도시 ──
  cityStrength(c, occ) {
    const p = this.players[c.owner];
    let best = 8;
    for (const k of Object.keys(R.UNITS)) { const u = R.UNITS[k]; if (!u.civ && (!u.tech || p.techs[u.tech])) best = Math.max(best, u.str); }
    let s = 6 + c.pop * 1.2 + best * 0.45;
    for (const b of c.buildings) s += R.BUILDINGS[b].def || 0;
    const here = occ ? (occ.get(c.pos) || []) : this.unitsAt(c.pos);
    const g = here.find(u => u.owner === c.owner && this.isMil(u));
    if (g) s += R.UNITS[g.type].str * 0.3;
    if (this.terr[c.pos] === 'hills') s *= 1.25;
    return Math.round(s);
  }
  cityMaxHp(c) { let h = 200; for (const b of c.buildings) h += R.BUILDINGS[b].hp || 0; return h; }
  foodNeed(pop) { return Math.round((14 + 8 * (pop - 1) + Math.pow(pop - 1, 1.6)) * this.speed); }
  tileYield(i) {
    const t = R.TERRAIN[this.terr[i]], r = this.res[i] ? R.RES[this.res[i]] : null;
    return { food: t.food + (r ? r.food : 0), prod: t.prod + (r ? r.prod : 0), gold: t.gold + (r ? r.gold : 0) };
  }
  cityYields(c, occ) {
    occ = occ || this.occMap();
    const cy = this.tileYield(c.pos);
    let food = Math.max(2, cy.food), prod = Math.max(1, cy.prod), gold = cy.gold + 1, sci = 1 + Math.ceil(c.pop * 0.7);
    const tiles = [];
    for (const i of this.claimTiles.get(c.id) || []) {
      if (i === c.pos) continue;
      const here = occ.get(i);
      if (here && here.some(u => this.atWar(u.owner, c.owner))) continue;
      const y = this.tileYield(i);
      tiles.push({ i, ...y, s: y.food * 1.6 + y.prod * 1.3 + y.gold * 0.8 });
    }
    tiles.sort((a, b) => b.s - a.s);
    for (const t of tiles.slice(0, c.pop)) { food += t.food; prod += t.prod; gold += t.gold; }
    prod += Math.floor(c.pop / 3);
    for (const b of c.buildings) { const B = R.BUILDINGS[b]; food += B.food || 0; prod += B.prod || 0; gold += B.gold || 0; sci += B.sci || 0; }
    if (c.capital) { gold += 3; sci += 2; prod += 1; }
    if (c.queue && c.queue.kind === 'process') { const half = Math.floor(prod / 2); if (c.queue.type === 'wealth') gold += half; else sci += half; }
    return { food, prod, gold, sci, upkeep: c.pop * 2 };
  }
  itemCost(q) {
    if (!q) return 0;
    if (q.kind === 'unit') return this.cost(R.UNITS[q.type].cost);
    if (q.kind === 'building') return this.cost(R.BUILDINGS[q.type].cost);
    return 0;
  }
  buyPrice(c) { return c.queue && c.queue.kind !== 'process' ? Math.max(1, Math.round((this.itemCost(c.queue) - c.prod) * 2.2 + 10)) : 0; }
  canFound(pid, pos) {
    if (!R.TERRAIN[this.terr[pos]].pass) return '여기에는 도시를 지을 수 없습니다';
    for (const c of this.cities.values()) if (R.dist(c.pos, pos, this.W) < 4) return '다른 도시와 너무 가깝습니다 (최소 4칸)';
    const o = this.tileOwner(pos);
    if (o !== -1 && o !== pid) return '다른 나라 영토입니다';
    return null;
  }
  foundCity(pid, pos) {
    const p = this.players[pid], civ = R.CIVS[p.civ];
    const taken = new Set([...this.cities.values()].map(c => c.name));
    let name = null;
    while (p.nameIdx < civ.cities.length) { const n = civ.cities[p.nameIdx++]; if (!taken.has(n)) { name = n; break; } }
    if (!name) { let k = this.citiesOf(pid).length + 1; do { name = `${p.name}의 도시 ${k++}`; } while (taken.has(name)); }
    const first = !p.foundedCapital;
    const c = { id: this.nextId++, owner: pid, founder: pid, name, pos, pop: 1, food: 0, prod: 0, hp: 200, buildings: [], queue: null,
      capital: first, attackedTurn: 0, shotTurn: 0, founded: this.turn };
    if (first) p.foundedCapital = true;
    this.cities.set(c.id, c); this.cityAt.set(pos, c);
    return c;
  }
  ensureCapital(pid) {
    const cs = this.citiesOf(pid);
    if (!cs.length || cs.some(c => c.capital)) return;
    cs.sort((a, b) => b.pop - a.pop); cs[0].capital = true;
    this.msg(pid, `🏛️ ${cs[0].name}이(가) 새 수도가 되었습니다`);
  }
  spawnSpot(c, type) {
    const civ = !!R.UNITS[type].civ;
    const ok = i => R.TERRAIN[this.terr[i]].pass && (!this.cityAt.has(i) || this.cityAt.get(i).owner === c.owner) &&
      !this.unitsAt(i).some(u => u.owner !== c.owner || (!!R.UNITS[u.type].civ) === civ);
    if (ok(c.pos)) return c.pos;
    for (const n of R.neighbors(c.pos, this.W, this.H)) if (ok(n)) return n;
    return -1;
  }

  // ── 전투 ──
  unitStr(u, ranged) {
    const U = R.UNITS[u.type];
    let s = ranged ? (U.rstr || 0) : U.str;
    if (u.vet) s *= 1.15;
    return s * (0.5 + 0.5 * u.hp / 100);
  }
  defMods(u, attacker) {
    let m = 1 + (R.TERRAIN[this.terr[u.pos]].def || 0) / 100;
    if (u.fort) m += 0.25;
    if (attacker && R.UNITS[u.type].anti && R.UNITS[attacker.type].mounted) m += 0.5;
    return m;
  }
  roll(a, d) { return clamp(Math.round(30 * Math.pow(a / Math.max(0.1, d), 1.15) * (0.85 + this.rnd() * 0.3)), 1, 120); }
  checkElimination(pid) {
    const p = this.players[pid];
    if (!p || !p.alive) return;
    const hasCity = this.citiesOf(pid).length > 0;
    const hasSettler = this.unitsOf(pid).some(u => u.type === 'settler');
    if (!hasCity && (!hasSettler || p.foundedCapital)) {
      p.alive = false; p.diedTurn = this.turn;
      for (const u of this.unitsOf(pid)) this.units.delete(u.id);
      this.msgAll(`☠️ [${p.name}] 문명이 멸망했습니다!`);
      this.claimsDirty = true;
    }
  }
  captureCity(c, attacker) {
    const oldOwner = c.owner;
    for (const u of this.unitsAt(c.pos)) {
      if (u.owner === attacker.owner) continue;
      if (this.isMil(u)) this.killUnit(u); else u.owner = attacker.owner;
    }
    c.owner = attacker.owner; c.pop = Math.max(1, Math.ceil(c.pop / 2)); c.hp = 60; c.queue = null; c.prod = 0; c.food = 0;
    c.buildings = c.buildings.filter(b => (b !== 'walls' && b !== 'castle') || this.rnd() < 0.5);
    const wasCap = c.capital; c.capital = false;
    attacker.pos = c.pos; attacker.moves = 0;
    this.msgMet([attacker.owner, oldOwner], `⚔️ [${this.nm(attacker.owner)}]이(가) [${this.nm(oldOwner)}]의 도시 ${c.name}을(를) 점령했습니다!${wasCap ? ' (수도 함락)' : ''}`);
    this.claimsDirty = true;
    this.ensureCapital(oldOwner);
    this.checkElimination(oldOwner);
  }
  attack(u, target) {
    const U = R.UNITS[u.type];
    const ranged = !!U.rstr;
    const city = this.cityAt.get(target);
    const defs = this.unitsAt(target).filter(x => x.owner !== u.owner);
    const items = [];
    u.attacked = true; u.acted = true; u.fort = false;
    this.touched.add(u.owner);
    if (city && city.owner !== u.owner) {
      this.touched.add(city.owner);
      let A = this.unitStr(u, ranged); if (U.siege) A *= 2;
      const D = this.cityStrength(city);
      const dmg = this.roll(A, D);
      city.hp = Math.max(ranged ? 1 : 0, city.hp - dmg); city.attackedTurn = this.turn;
      items.push({ pos: target, dmg });
      if (!ranged) {
        const back = this.roll(D, A); u.hp -= back; items.push({ pos: u.pos, dmg: back });
        if (u.hp <= 0) { this.killUnit(u); this.msg(u.owner, `💀 ${U.name}이(가) ${city.name} 공격 중 전사했습니다`); }
        else if (city.hp <= 0) this.captureCity(city, u);
      }
      this.fx(target, items);
      if (this.cities.has(city.id) && city.owner !== u.owner) this.msg(city.owner, `🔥 ${city.name}이(가) [${this.nm(u.owner)}]의 ${U.name}에게 공격받았습니다 (-${items[0].dmg})`);
    } else {
      for (const d of defs) this.touched.add(d.owner);
      const mil = defs.filter(x => this.isMil(x));
      if (!mil.length) {
        const owners = new Set(defs.map(c => c.owner));
        for (const c of defs) {
          if (ranged) { this.killUnit(c); this.msg(c.owner, `💀 ${R.UNITS[c.type].name}이(가) 공격으로 사망했습니다`); }
          else { this.msg(c.owner, `🪢 ${R.UNITS[c.type].name}이(가) [${this.nm(u.owner)}]에게 포획되었습니다`); c.owner = u.owner; c.moves = 0; }
        }
        if (!ranged) { u.pos = target; this.msg(u.owner, `🪢 민간 유닛을 포획했습니다`); }
        u.moves = 0;
        this.fx(target, [{ pos: target, dmg: 0, txt: ranged ? '격파' : '포획' }]);
        for (const o of owners) this.checkElimination(o);
        return;
      }
      mil.sort((a, b) => this.unitStr(b) * this.defMods(b, u) - this.unitStr(a) * this.defMods(a, u));
      const d = mil[0], DU = R.UNITS[d.type];
      let A = this.unitStr(u, ranged);
      if (U.anti && DU.mounted) A *= 1.5;
      const D = this.unitStr(d) * this.defMods(d, u);
      const dmg = this.roll(A, D); d.hp -= dmg; items.push({ pos: target, dmg });
      if (!ranged) { const back = this.roll(D, A); u.hp -= back; items.push({ pos: u.pos, dmg: back }); }
      this.fx(target, items);
      const an = `[${this.nm(u.owner)}] ${U.name}`, dn = `[${this.nm(d.owner)}] ${DU.name}`;
      if (d.hp <= 0) {
        this.killUnit(d);
        this.msg(d.owner, `💀 ${dn}이(가) ${an}에게 격파되었습니다`);
        this.msg(u.owner, `🏆 ${dn}을(를) 격파했습니다!`);
      } else this.msg(d.owner, `🛡️ ${dn}이(가) ${an}의 공격을 받았습니다 (-${dmg})`);
      if (u.hp <= 0) { this.killUnit(u); this.msg(u.owner, `💀 ${an}이(가) 공격 중 전사했습니다`); this.msg(d.owner, `🏆 공격해 온 ${an}을(를) 물리쳤습니다`); }
      else if (!ranged && d.hp <= 0) {
        const rest = this.unitsAt(target).filter(x => x.owner !== u.owner);
        if (!rest.some(x => this.isMil(x))) { for (const c of rest) { c.owner = u.owner; c.moves = 0; } u.pos = target; }
      }
      this.checkElimination(d.owner);
    }
    if (this.units.has(u.id)) u.moves = 0;
  }
  cityShoot(c, target) {
    const defs = this.unitsAt(target).filter(x => x.owner !== c.owner);
    const d = defs.find(x => this.isMil(x)) || defs[0];
    if (!d) return;
    this.touched.add(d.owner);
    const A = this.cityStrength(c) * 0.75;
    const D = this.isMil(d) ? this.unitStr(d) * this.defMods(d) : 1;
    const dmg = this.roll(A, D); d.hp -= dmg; c.shotTurn = this.turn;
    this.fx(target, [{ pos: target, dmg }]);
    const dn = R.UNITS[d.type].name;
    if (d.hp <= 0) { this.killUnit(d); this.msg(d.owner, `💀 ${dn}이(가) ${c.name}의 포격으로 격파되었습니다`); this.msg(c.owner, `🏹 ${c.name}이(가) 적 ${dn}을(를) 격파했습니다`); this.checkElimination(d.owner); }
    else this.msg(d.owner, `🏹 ${dn}이(가) ${c.name}의 포격을 받았습니다 (-${dmg})`);
  }

  // ── 이동 ──
  reachFor(u, occ) {
    const civ = !!R.UNITS[u.type].civ;
    occ = occ || this.occMap();
    const canEnter = i => { const c = this.cityAt.get(i); if (c && c.owner !== u.owner) return false; const us = occ.get(i); return !us || us.every(x => x.owner === u.owner); };
    const canEnd = i => { const us = occ.get(i); return !us || !us.some(x => x.id !== u.id && (!!R.UNITS[x.type].civ) === civ); };
    return R.reach(this.W, this.H, this.terr, u.pos, u.moves, canEnter, canEnd);
  }
  targetsFor(u) {
    const U = R.UNITS[u.type], out = [];
    if (U.civ || u.moves <= 0 || u.attacked) return out;
    const range = U.rstr ? U.range : 1;
    for (const j of R.inRadius(u.pos, range, this.W, this.H)) {
      if (j === u.pos) continue;
      if (!U.rstr && !R.TERRAIN[this.terr[j]].pass) continue;
      const c = this.cityAt.get(j);
      if (c && c.owner !== u.owner && this.atWar(u.owner, c.owner)) { out.push(j); continue; }
      if (this.unitsAt(j).some(x => x.owner !== u.owner && this.atWar(u.owner, x.owner))) out.push(j);
    }
    return out;
  }

  // ── 플레이어 행동 ──
  act(pid, m) {
    const p = this.players[pid];
    if (!p || p.removed) return '플레이어 없음';
    if (m.a === 'respawn') {
      if (p.alive) return '아직 살아있습니다';
      this.resetPlayer(p); this.refresh(); this.msgAll(`🌱 [${p.name}]이(가) 새 땅에서 다시 시작했습니다`); this.markAll(); return null;
    }
    if (!p.alive) return '멸망한 상태입니다. 다시 시작하세요';
    const U = m.unit != null ? this.units.get(m.unit) : null;
    if (m.unit != null && (!U || U.owner !== pid)) return '유닛을 찾을 수 없습니다';
    const C = m.city != null ? this.cities.get(m.city) : null;
    if (m.city != null && (!C || C.owner !== pid)) return '도시를 찾을 수 없습니다';
    this.touched = new Set([pid]); this.claimsDirty = false;
    const fromPos = U ? U.pos : -1;
    switch (m.a) {
      case 'move': {
        if (!U) return '유닛 없음';
        const rr = this.reachFor(U);
        if (!rr.has(m.to)) return '이동할 수 없는 곳입니다';
        U.pos = m.to; U.moves = rr.get(m.to); U.fort = false; U.acted = true; U.skip = false;
        break;
      }
      case 'attack': {
        if (!U) return '유닛 없음';
        if (!this.targetsFor(U).includes(m.to)) return '공격할 수 없는 대상입니다';
        this.attack(U, m.to); break;
      }
      case 'found': {
        if (!U || U.type !== 'settler') return '개척자만 도시를 세울 수 있습니다';
        const why = this.canFound(pid, U.pos); if (why) return why;
        const c = this.foundCity(pid, U.pos); this.killUnit(U); this.claimsDirty = true;
        this.msg(pid, `🏙️ 새 도시 ${c.name}을(를) 건설했습니다`);
        break;
      }
      case 'fortify': if (!U || !this.isMil(U)) return '군사 유닛만 가능합니다'; U.fort = !U.fort; U.skip = false; break;
      case 'skip': if (!U) return '유닛 없음'; U.skip = true; break;
      case 'disband': if (!U) return '유닛 없음'; this.killUnit(U); this.checkElimination(pid); break;
      case 'prod': {
        if (!C) return '도시 없음';
        const k = m.kind, t = m.type;
        if (!['unit', 'building', 'process'].includes(k)) return '잘못된 항목';
        if (k === 'unit' && !R.availUnits(p.techs).includes(t)) return '생산할 수 없는 유닛';
        if (k === 'building' && !R.availBuildings(p.techs, C.buildings).includes(t)) return '지을 수 없는 건물';
        if (k === 'process' && !R.PROCESSES[t]) return '잘못된 항목';
        if (!C.queue || C.queue.kind !== k || C.queue.type !== t) {
          if (C.queue && C.queue.kind !== k) C.prod = Math.floor(C.prod * 0.5);
          C.queue = { kind: k, type: t };
        }
        break;
      }
      case 'buy': {
        if (!C || !C.queue || C.queue.kind === 'process') return '구매할 항목이 없습니다';
        const price = this.buyPrice(C);
        if (p.gold < price) return `금이 부족합니다 (${price} 필요)`;
        if (C.boughtTurn === this.turn) return '한 턴에 한 번만 구매할 수 있습니다';
        p.gold -= price; C.prod = this.itemCost(C.queue); C.boughtTurn = this.turn;
        this.completeProduction(C, p);
        break;
      }
      case 'research': if (!R.availTechs(p.techs).includes(m.tech)) return '연구할 수 없는 기술'; p.researching = m.tech; break;
      case 'cityShoot': {
        if (!C) return '도시 없음';
        if (C.shotTurn === this.turn) return '이번 턴에 이미 공격했습니다';
        if (R.dist(C.pos, m.to, this.W) > 2) return '사거리 밖입니다';
        if (!this.unitsAt(m.to).some(x => this.atWar(pid, x.owner))) return '공격할 적이 없습니다';
        this.cityShoot(C, m.to); break;
      }
      case 'war': {
        const t = this.players[m.target];
        if (!t || t.id === pid || !t.alive || t.removed) return '대상 없음';
        if (!p.met[t.id]) return '아직 만나지 못한 문명입니다';
        if (this.dip(pid, t.id) === 'war') return '이미 전쟁 중입니다';
        if (this.protectedP(t.id)) return `상대는 신규 보호 중입니다 (${t.protectUntil}턴까지)`;
        if ((p.peaceTurn[t.id] || -99) + 5 > this.turn) return '평화 조약 직후 5턴 동안은 선전포고할 수 없습니다';
        if (this.protectedP(pid)) { p.protectUntil = this.turn; this.msg(pid, '🛡️ 선전포고로 신규 보호가 해제되었습니다'); }
        this.declareWar(pid, t.id); break;
      }
      case 'peace': {
        const t = this.players[m.target];
        if (!t || t.id === pid || !t.alive || t.removed) return '대상 없음';
        if (this.dip(pid, t.id) !== 'war') return '전쟁 중이 아닙니다';
        if ((p.warTurn[t.id] || 0) + 5 > this.turn) return '선전포고 후 5턴이 지나야 평화를 제안할 수 있습니다';
        if (t.peaceOffers.includes(pid)) return '이미 제안했습니다';
        if (t.isAI) {
          if (this.aiAcceptPeace(t, p)) this.makePeace(pid, t.id);
          else this.msg(pid, `🕊️ [${t.name}]이(가) 평화 제안을 거절했습니다`);
        } else {
          t.peaceOffers.push(pid); this.touched.add(t.id);
          this.msg(t.id, `🕊️ [${p.name}]이(가) 평화를 제안했습니다. [외교]에서 수락할 수 있습니다`);
          this.msg(pid, `🕊️ [${t.name}]에게 평화를 제안했습니다`);
        }
        break;
      }
      case 'acceptPeace': if (!p.peaceOffers.includes(m.target)) return '받은 제안이 없습니다'; this.makePeace(pid, m.target); break;
      case 'rejectPeace': p.peaceOffers = p.peaceOffers.filter(x => x !== m.target); this.touched.add(m.target); this.msg(m.target, `🕊️ [${p.name}]이(가) 평화 제안을 거절했습니다`); break;
      case 'ready': p.ready = true; this.markAll(); this.checkEarlyTurn(); return null;
      case 'unready': p.ready = false; this.markAll(); return null;
      default: return '알 수 없는 행동';
    }
    if (this.claimsDirty) { this.refresh(); this.markAll(); }
    else {
      this.refresh([...this.touched]);
      for (const id of this.touched) this.mark(id);
      this.markNear(fromPos); if (m.to != null) this.markNear(m.to);
    }
    return null;
  }
  declareWar(a, b) {
    const A = this.players[a], B = this.players[b];
    A.diplo[b] = 'war'; B.diplo[a] = 'war'; A.warTurn[b] = this.turn; B.warTurn[a] = this.turn;
    A.peaceOffers = A.peaceOffers.filter(x => x !== b); B.peaceOffers = B.peaceOffers.filter(x => x !== a);
    this.msgMet([a, b], `⚔️ [${A.name}]이(가) [${B.name}]에게 선전포고했습니다!`);
    this.mark(a); this.mark(b);
  }
  makePeace(a, b) {
    const A = this.players[a], B = this.players[b];
    A.diplo[b] = 'peace'; B.diplo[a] = 'peace';
    A.peaceOffers = A.peaceOffers.filter(x => x !== b); B.peaceOffers = B.peaceOffers.filter(x => x !== a);
    A.peaceTurn[b] = this.turn; B.peaceTurn[a] = this.turn;
    this.msgMet([a, b], `🕊️ [${A.name}]과(와) [${B.name}]이(가) 평화 조약을 맺었습니다`);
    this.mark(a); this.mark(b);
  }

  // ── 턴 ──
  checkEarlyTurn() {
    const on = this.online().filter(p => p.alive);
    if (on.length && on.every(p => p.ready) && Date.now() - this.turnStart > 4000) this.endTurn();
  }
  completeProduction(c, p) {
    const q = c.queue; if (!q || q.kind === 'process') return;
    const cost = this.itemCost(q);
    if (c.prod < cost) return;
    if (q.kind === 'unit') {
      if (q.type === 'settler' && c.pop < 2) return;
      const spot = this.spawnSpot(c, q.type);
      if (spot < 0) return;
      this.addUnit(c.owner, q.type, spot, c.buildings.includes('barracks'));
      this.msg(c.owner, `🛠️ ${c.name}: ${R.UNITS[q.type].name} 생산 완료`);
      c.prod -= cost;
      if (q.type === 'settler') { c.pop -= 1; c.queue = null; }
    } else {
      c.buildings.push(q.type);
      if (R.BUILDINGS[q.type].hp) c.hp += R.BUILDINGS[q.type].hp;
      this.msg(c.owner, `🏗️ ${c.name}: ${R.BUILDINGS[q.type].name} 완공`);
      c.prod -= cost; c.queue = null;
    }
  }
  economy(p, occ) {
    let gpt = 0, spt = 0;
    for (const c of this.citiesOf(p.id)) {
      const y = this.cityYields(c, occ);
      gpt += y.gold; spt += y.sci;
      c.food += y.food - y.upkeep;
      const need = this.foodNeed(c.pop);
      if (c.food >= need) { c.food -= need; c.pop++; this.msg(p.id, `👥 ${c.name}의 인구가 ${c.pop}(으)로 늘었습니다`); }
      else if (c.food < 0) { if (c.pop > 1) { c.pop--; this.msg(p.id, `🥀 ${c.name}이(가) 굶주려 인구가 줄었습니다`); } c.food = 0; }
      if (c.queue && c.queue.kind !== 'process') { c.prod += y.prod; this.completeProduction(c, p); }
      else if (!c.queue) c.prod += Math.floor(y.prod / 2);
      if (c.attackedTurn !== this.turn) c.hp = Math.min(this.cityMaxHp(c), c.hp + 20);
    }
    const n = this.unitsOf(p.id).length, free = 3 + Math.floor(this.citiesOf(p.id).length * 1.5);
    gpt -= Math.max(0, n - free);
    p.gold += gpt; p.gpt = gpt; p.spt = spt;
    if (p.gold < 0) {
      const us = this.unitsOf(p.id).filter(u => this.isMil(u));
      if (us.length) { const u = us[Math.floor(this.rnd() * us.length)]; this.killUnit(u); this.msg(p.id, `💸 금이 부족해 ${R.UNITS[u.type].name}이(가) 해산되었습니다`); }
      p.gold = 0;
    }
    p.sciStore += spt;
    if (!p.researching && p.isAI) p.researching = this.aiPickTech(p);
    while (p.researching && p.sciStore >= this.techCost(p.researching)) {
      p.sciStore -= this.techCost(p.researching);
      p.techs[p.researching] = 1;
      this.msg(p.id, `💡 기술 [${R.TECHS[p.researching].name}] 연구 완료!`);
      p.researching = p.isAI ? this.aiPickTech(p) : null;
    }
  }
  endTurn() {
    const t0 = Date.now();
    const occ = this.occMap();
    for (const p of this.alivePlayers()) this.economy(p, occ);
    for (const u of this.units.values()) {
      if (!u.acted && u.hp < 100) {
        const inCity = this.cityAt.has(u.pos) && this.cityAt.get(u.pos).owner === u.owner;
        u.hp = Math.min(100, u.hp + (inCity ? 25 : this.tileOwner(u.pos) === u.owner ? 15 : 10));
      }
      u.moves = R.UNITS[u.type].moves; u.attacked = false; u.acted = false; u.skip = false;
    }
    this.turn++;
    for (const p of this.alivePlayers()) { this.ensureCapital(p.id); p.ready = false; }
    this.refresh();
    this.touched = new Set(); this.claimsDirty = false;
    for (const p of this.alivePlayers()) if (p.isAI) { try { this.aiTurn(p); } catch (e) { console.error('AI error', e); } }
    for (const p of this.players) if (p.isAI && !p.alive && !p.removed && this.turn - (p.diedTurn || 0) > 3) p.removed = true;
    if (this.alivePlayers().filter(p => p.isAI).length < CFG.AI_COUNT && this.turn % 15 === 0) this.addAI();
    this.refresh();
    for (const p of this.players) p.score = this.score(p);
    this.turnStart = Date.now();
    this.markAll();
    const dt = Date.now() - t0; if (dt > 300) console.log(`턴 ${this.turn} 처리 ${dt}ms`);
    this.lastTurnMs = dt;
  }
  score(p) {
    if (!p.alive || p.removed) return 0;
    const cs = this.citiesOf(p.id);
    return cs.length * 10 + cs.reduce((s, c) => s + c.pop * 4 + c.buildings.length * 2, 0) + Object.keys(p.techs).length * 6 +
      this.unitsOf(p.id).filter(u => this.isMil(u)).length;
  }
  tick() {
    if (!this.online().length) { this.turnStart = Date.now(); return; } // 아무도 없으면 월드 정지
    if (Date.now() - this.turnStart >= CFG.TURN_SECONDS * 1000) this.endTurn();
  }
  cleanupInactive() {
    const lim = CFG.INACTIVE_HOURS * 3600 * 1000;
    for (const p of this.players) {
      if (p.isAI || p.removed || p.ws) continue;
      if (Date.now() - (p.lastSeen || 0) > lim) { this.removeEmpire(p, '오랫동안 접속하지 않아 제국이 사라졌습니다'); this.msgAll(`🍂 [${p.name}] 제국이 역사 속으로 사라졌습니다 (장기 미접속)`); this.markAll(); }
    }
  }

  // ── 상태 전송 ──
  mark(pid) { this.dirty.add(pid); }
  markAll() { for (const p of this.players) if (p.ws) this.dirty.add(p.id); }
  markNear(pos) { if (pos == null || pos < 0) return; for (const p of this.players) if (p.ws && p.visible[pos]) this.dirty.add(p.id); }
  flush() {
    if (!this.dirty.size) return;
    const ids = [...this.dirty]; this.dirty.clear();
    for (const id of ids) { const p = this.players[id]; if (p && p.ws) send(p.ws, this.stateFor(id)); }
  }
  stateFor(pid) {
    const p = this.players[pid];
    const fa = new Array(this.N); for (let i = 0; i < this.N; i++) fa[i] = p.visible[i] ? 2 : p.explored[i] ? 1 : 0;
    const fog = fa.join('');
    const ownerArr = new Array(this.N);
    for (let i = 0; i < this.N; i++) ownerArr[i] = p.explored[i] ? this.tileOwner(i) : -1;
    const ownerStr = ownerArr.join(',');
    const occ = this.occMap();
    const units = [];
    for (const u of this.units.values()) {
      if (u.owner !== pid && !p.visible[u.pos]) continue;
      units.push({ id: u.id, o: u.owner, t: u.type, p: u.pos, hp: u.hp, mv: u.moves, f: u.fort ? 1 : 0, a: u.attacked ? 1 : 0, v: u.vet ? 1 : 0, s: u.owner === pid && u.skip ? 1 : 0 });
    }
    const cities = []; let spt = 0;
    for (const c of this.cities.values()) {
      if (c.owner !== pid && !p.explored[c.pos]) continue;
      const o = { id: c.id, o: c.owner, name: c.name, p: c.pos, pop: c.pop, hp: c.hp, mhp: this.cityMaxHp(c), str: this.cityStrength(c, occ), cap: c.capital ? 1 : 0 };
      if (c.owner === pid) {
        const y = this.cityYields(c, occ); spt += y.sci;
        Object.assign(o, { food: c.food, need: this.foodNeed(c.pop), prod: c.prod, q: c.queue, qc: this.itemCost(c.queue), y, b: c.buildings, shot: c.shotTurn === this.turn ? 1 : 0, buy: this.buyPrice(c), bought: c.boughtTurn === this.turn ? 1 : 0 });
      }
      cities.push(o);
    }
    const st = {
      t: 'state', turn: this.turn, me: pid, speed: this.speed, left: Math.max(0, CFG.TURN_SECONDS * 1000 - (Date.now() - this.turnStart)), turnSec: CFG.TURN_SECONDS,
      players: this.players.map(q => q.removed ? { id: q.id, removed: 1 } : ({
        id: q.id, name: q.name, civ: q.civ, color: q.color, ai: q.isAI ? 1 : 0, alive: q.alive, ready: q.ready ? 1 : 0, score: q.score || 0,
        online: q.isAI || !!q.ws, cities: q.alive ? this.citiesOf(q.id).length : 0, techs: Object.keys(q.techs).length,
        d: q.id === pid ? null : this.dip(pid, q.id), met: p.met[q.id] ? 1 : 0, offerFromMe: q.peaceOffers.includes(pid) ? 1 : 0,
        wt: p.warTurn[q.id] || 0, pt: p.peaceTurn[q.id] || -99, prot: !q.isAI && q.protectUntil > this.turn ? q.protectUntil : 0,
      })),
      my: { gold: p.gold, gpt: p.gpt, spt, sci: p.sciStore, techs: Object.keys(p.techs), res: p.researching, rcost: p.researching ? this.techCost(p.researching) : 0,
        offers: p.peaceOffers, units: this.unitsOf(pid).length, free: 3 + Math.floor(this.citiesOf(pid).length * 1.5), alive: p.alive,
        prot: p.protectUntil > this.turn ? p.protectUntil : 0, tcosts: Object.fromEntries(R.availTechs(p.techs).map(k => [k, this.techCost(k)])) },
      units, cities,
    };
    if (fog !== p.sentFog) { st.fog = fog; p.sentFog = fog; }
    if (ownerStr !== p.sentOwner) { st.owner = ownerArr; p.sentOwner = ownerStr; }
    return st;
  }
  mapMsg() { return { t: 'map', W: this.W, H: this.H, terr: this.terr, res: this.res }; }

  // ───────────────────────── AI ─────────────────────────
  aiPickTech(p) {
    const av = R.availTechs(p.techs);
    if (!av.length) return null;
    const prio = { bronze: -20, archery: -15, writing: -10, iron: -15, math: -10, pottery: -5, currency: -5, gunpowder: -30, education: -10 };
    av.sort((a, b) => (R.TECHS[a].cost + (prio[a] || 0)) - (R.TECHS[b].cost + (prio[b] || 0)));
    return av[0];
  }
  milPower(id) { return this.unitsOf(id).filter(u => this.isMil(u)).reduce((s, u) => s + R.UNITS[u.type].str + (R.UNITS[u.type].rstr || 0), 0); }
  aiAcceptPeace(ai, other) {
    if ((ai.warTurn[other.id] || 0) + 8 > this.turn) return false;
    return this.milPower(ai.id) <= this.milPower(other.id) * 1.1 || this.rnd() < 0.25;
  }
  distField(sources, maxD) {
    const W = this.W, H = this.H, f = new Float32Array(this.N).fill(1e9);
    const src = new Set(sources), heap = new MinHeap(), lim = maxD || 40;
    for (const s of sources) { f[s] = 0; heap.push(0, s); }
    while (heap.size) {
      const [d, i] = heap.pop();
      if (d > f[i]) continue;
      if (d > lim) break;
      for (const n of R.neighbors(i, W, H)) {
        const t = R.TERRAIN[this.terr[n]];
        if (!t.pass && !src.has(n)) continue;
        const nd = d + (t.pass ? t.move : 1);
        if (nd < f[n]) { f[n] = nd; heap.push(nd, n); }
      }
    }
    return f;
  }
  aiStepToward(u, field) {
    const rr = this.reachFor(u);
    let best = u.pos, bv = field[u.pos], bm = -1;
    for (const [i, rem] of rr) if (field[i] < bv - 0.01 || (Math.abs(field[i] - bv) < 0.01 && rem > bm && i !== u.pos)) { best = i; bv = field[i]; bm = rem; }
    if (best !== u.pos && bv < 1e8) { u.pos = best; u.moves = rr.get(best); u.acted = true; u.fort = false; return true; }
    return false;
  }
  aiSettleScore(pid, i) {
    if (this.canFound(pid, i)) return -1;
    let s = 0;
    for (const j of R.inRadius(i, 2, this.W, this.H)) {
      if (this.claim[j] >= 0) { s -= 1; continue; }
      const y = this.tileYield(j); s += y.food * 1.3 + y.prod + y.gold * 0.6;
    }
    if (this.terr[i] === 'hills') s += 3;
    if (R.neighbors(i, this.W, this.H).some(n => this.terr[n] === 'ocean')) s += 2;
    return s;
  }
  aiTurn(p) {
    if (!p.researching) p.researching = this.aiPickTech(p);
    const myCities = this.citiesOf(p.id);
    const atWarWith = this.alivePlayers().filter(q => q.id !== p.id && this.atWar(p.id, q.id));
    if (this.turn - p.joinTurn >= 25 && atWarWith.length === 0 && this.turn % 3 === 0 && myCities.length) {
      let tgt = null, td = 1e9;
      for (const c of this.cities.values()) {
        if (c.owner === p.id || !p.met[c.owner] || this.protectedP(c.owner)) continue;
        if ((p.peaceTurn[c.owner] || -99) + 8 > this.turn) continue;
        let d = 1e9; for (const m of myCities) d = Math.min(d, R.dist(m.pos, c.pos, this.W));
        if (d < td) { td = d; tgt = c.owner; }
      }
      if (tgt != null && td < 14 && this.milPower(p.id) > this.milPower(tgt) * 1.25 && this.rnd() < 0.35) this.declareWar(p.id, tgt);
    }
    for (const from of [...p.peaceOffers]) { if (this.aiAcceptPeace(p, this.players[from])) this.makePeace(p.id, from); else p.peaceOffers = p.peaceOffers.filter(x => x !== from); }
    for (const q of atWarWith) {
      if ((p.warTurn[q.id] || 0) + 12 < this.turn && this.milPower(p.id) < this.milPower(q.id) * 0.7 && !q.peaceOffers.includes(p.id) && this.rnd() < 0.2) {
        if (q.isAI) { if (this.aiAcceptPeace(q, p)) this.makePeace(p.id, q.id); }
        else { q.peaceOffers.push(p.id); this.msg(q.id, `🕊️ [${p.name}](AI)이(가) 평화를 제안했습니다`); this.mark(q.id); }
      }
    }
    const enemies = this.alivePlayers().filter(q => q.id !== p.id && this.atWar(p.id, q.id)).map(q => q.id);
    const settlers = this.unitsOf(p.id).filter(u => u.type === 'settler').length + myCities.filter(c => c.queue && c.queue.type === 'settler').length;
    const targetCities = 5;
    const avU = R.availUnits(p.techs).filter(k => !R.UNITS[k].civ && k !== 'scout');
    const bestMelee = avU.filter(k => !R.UNITS[k].rstr).sort((a, b) => R.UNITS[b].str - R.UNITS[a].str)[0] || 'warrior';
    const bestRanged = avU.filter(k => R.UNITS[k].rstr).sort((a, b) => R.UNITS[b].rstr - R.UNITS[a].rstr)[0];
    const mils = this.unitsOf(p.id).filter(u => this.isMil(u) && u.type !== 'scout');
    const wantMil = myCities.length * (enemies.length ? 3 : 1.5) + 1;
    for (const c of myCities) {
      if (c.queue && c.queue.kind !== 'process' && !(c.queue.kind === 'unit' && c.queue.type !== 'settler' && mils.length >= wantMil + 2)) continue;
      let q;
      const hasGarrison = this.unitsAt(c.pos).some(u => u.owner === p.id && this.isMil(u));
      if (!hasGarrison && mils.length < wantMil + 2) q = { kind: 'unit', type: bestMelee };
      else if (myCities.length + settlers < targetCities && c.pop >= 2 && !enemies.length) q = { kind: 'unit', type: 'settler' };
      else if (mils.length < wantMil) {
        const nR = mils.filter(u => R.UNITS[u.type].rstr).length;
        let pick = bestRanged && nR < mils.length / 3 ? bestRanged : bestMelee;
        if (enemies.length && this.rnd() < 0.3) { const sg = avU.filter(k => R.UNITS[k].siege).sort((a, b) => R.UNITS[b].rstr - R.UNITS[a].rstr)[0]; if (sg) pick = sg; }
        q = { kind: 'unit', type: pick };
      } else {
        const avB = R.availBuildings(p.techs, c.buildings).sort((a, b) => R.BUILDINGS[a].cost - R.BUILDINGS[b].cost);
        q = avB.length ? { kind: 'building', type: avB[0] } : { kind: 'process', type: this.rnd() < 0.5 ? 'wealth' : 'research' };
      }
      if (!c.queue || c.queue.kind !== q.kind) c.prod = Math.floor(c.prod * (c.queue ? 0.5 : 1));
      c.queue = q;
    }
    for (const c of myCities) {
      if (!c.queue || c.queue.kind === 'process') continue;
      const price = this.buyPrice(c);
      if (p.gold > price + 60 && c.boughtTurn !== this.turn) { p.gold -= price; c.prod = this.itemCost(c.queue); c.boughtTurn = this.turn; this.completeProduction(c, p); }
    }
    const enemyCityPos = [...this.cities.values()].filter(c => enemies.includes(c.owner)).map(c => c.pos);
    const warField = enemyCityPos.length ? this.distField(enemyCityPos) : null;
    const homeField = myCities.length ? this.distField(myCities.map(c => c.pos)) : null;
    const unguarded = myCities.filter(c => !this.unitsAt(c.pos).some(x => x.owner === p.id && this.isMil(x)));
    const guardField = unguarded.length ? this.distField(unguarded.map(c => c.pos)) : null;
    let exploreField = null;
    for (const u of this.unitsOf(p.id)) {
      if (!this.units.has(u.id)) continue;
      const U = R.UNITS[u.type];
      if (u.type === 'settler') { this.aiSettler(p, u); continue; }
      const city = this.cityAt.get(u.pos);
      const guards = city && city.owner === p.id ? this.unitsAt(u.pos).filter(x => x.owner === p.id && this.isMil(x)) : [];
      const isGuard = guards.length && guards[0].id === u.id;
      for (let step = 0; step < 4 && this.units.has(u.id) && u.moves > 0; step++) {
        const tg = this.targetsFor(u);
        if (tg.length && !u.attacked) {
          let best = null, bs = -1e9;
          for (const t of tg) {
            const c = this.cityAt.get(t);
            let A = this.unitStr(u, !!U.rstr), D, val;
            if (c) { if (U.siege) A *= 2; D = this.cityStrength(c); val = (A / D) * 1.2 + (200 - c.hp) / 200 + (U.rstr ? 0.5 : 0); if (!U.rstr && c.hp > 60 && A / D < 1.2) val -= 2; if (!U.rstr && c.hp <= 30) val += 3; }
            else {
              const d = this.unitsAt(t).filter(x => x.owner !== u.owner).find(x => this.isMil(x));
              if (!d) val = 3;
              else { D = this.unitStr(d) * this.defMods(d, u); val = A / D + (100 - d.hp) / 100; if (!U.rstr && A / D < 0.8 && u.hp < 70) val -= 2; }
            }
            if (val > bs) { bs = val; best = t; }
          }
          if (best != null && bs > 0.6) { this.attack(u, best); break; }
        }
        if (isGuard) { u.fort = true; break; }
        if (u.hp < 45 && homeField) { if (!this.aiStepToward(u, homeField)) { u.fort = true; break; } continue; }
        if (u.type === 'scout' || (!enemies.length && mils.length > myCities.length * 2 && u.id % 4 === 0)) {
          if (!exploreField) {
            const unk = []; for (let i = 0; i < this.N; i++) if (!p.explored[i] && R.TERRAIN[this.terr[i]].pass && i % 3 === 0) unk.push(i);
            exploreField = unk.length ? this.distField(unk, 25) : null;
          }
          if (exploreField && this.aiStepToward(u, exploreField)) continue;
          if (u.type === 'scout') break;
        }
        if (warField && enemies.length && warField[u.pos] < 30) {
          if (U.rstr && warField[u.pos] <= U.range) break;
          if (this.aiStepToward(u, warField)) continue;
          break;
        }
        if (guardField && !city && this.aiStepToward(u, guardField)) continue;
        if (homeField && homeField[u.pos] > 3 && this.aiStepToward(u, homeField)) continue;
        u.fort = true; break;
      }
    }
  }
  aiSettler(p, u) {
    for (let step = 0; step < 4 && u.moves > 0; step++) {
      const here = this.aiSettleScore(p.id, u.pos);
      let best = u.pos, bs = here;
      for (const j of R.inRadius(u.pos, 6, this.W, this.H)) {
        const s = this.aiSettleScore(p.id, j); if (s < 0) continue;
        const v = s - R.dist(u.pos, j, this.W) * 1.5;
        if (v > bs + 0.5) { bs = v; best = j; }
      }
      if (best === u.pos) {
        if (here >= 0) { this.foundCity(p.id, u.pos); this.killUnit(u); return; }
        const rr = this.reachFor(u), keys = [...rr.keys()];
        if (!keys.length) return;
        const t = keys[Math.floor(this.rnd() * keys.length)]; u.moves = rr.get(t); u.pos = t; continue;
      }
      if (!this.aiStepToward(u, this.distField([best], 15))) { if (here >= 0) { this.foundCity(p.id, u.pos); this.killUnit(u); } return; }
      if (u.pos === best && this.aiSettleScore(p.id, u.pos) >= 0) { this.foundCity(p.id, u.pos); this.killUnit(u); return; }
    }
  }
}

// ───────────────────────── 서버 ─────────────────────────
let world = null;
function loadWorld() {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      const w = new World(JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')));
      console.log(`저장된 월드 불러옴: ${w.turn}턴, 플레이어 ${w.players.length}명`);
      return w;
    }
  } catch (e) { console.error('월드 불러오기 실패, 새로 생성합니다', e.message); }
  return new World(null);
}
function saveWorld() {
  if (!world) return;
  try { fs.mkdirSync(CFG.DATA_DIR, { recursive: true }); fs.writeFileSync(SAVE_FILE + '.tmp', world.serialize()); fs.renameSync(SAVE_FILE + '.tmp', SAVE_FILE); }
  catch (e) { console.error('저장 실패', e.message); }
}

const chat = [];
function chatMsg(from, text, color) {
  const m = { t: 'chat', from, text, color, at: Date.now() };
  chat.push(m); if (chat.length > 60) chat.shift();
  for (const p of world.players) if (p.ws) send(p.ws, m);
}
function cleanName(n) { return String(n || '').replace(/[<>&"\[\]]/g, '').trim().slice(0, 12) || '플레이어'; }

const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
  if (u === '/health') { res.end('ok'); return; }
  if (u === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    const alive = world.alivePlayers();
    res.end(JSON.stringify({ turn: world.turn, online: world.online().length, empires: alive.length, ai: alive.filter(p => p.isAI).length, turnSec: CFG.TURN_SECONDS, W: world.W, H: world.H }));
    return;
  }
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(PUB, u));
  if (!f.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  onConnection(new WS(socket));
});

function attach(ws, p) {
  if (p.ws && p.ws !== ws) { const old = p.ws; send(old, { t: 'kicked', msg: '다른 기기(탭)에서 접속했습니다' }); old.pid = null; old.close(); }
  p.ws = ws; ws.pid = p.id; p.lastSeen = Date.now(); p.sentFog = null; p.sentOwner = null;
  send(ws, { t: 'joined', token: p.token, pid: p.id, name: p.name });
  send(ws, world.mapMsg());
  send(ws, { t: 'chatlog', chat: chat.slice(-30), log: p.log.slice(-15) });
  send(ws, world.stateFor(p.id));
  world.markAll();
}
function onConnection(ws) {
  ws.pid = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    try { handle(ws, m); } catch (e) { console.error(e); send(ws, { t: 'error', msg: '서버 오류: ' + e.message }); }
  });
  ws.on('close', () => {
    if (ws.pid == null) return;
    const p = world.players[ws.pid];
    if (p && p.ws === ws) { p.ws = null; p.lastSeen = Date.now(); world.markAll(); world.checkEarlyTurn(); }
  });
}
function handle(ws, m) {
  switch (m.t) {
    case 'ping': send(ws, { t: 'pong' }); return;
    case 'enter': {
      if (world.alivePlayers().filter(p => !p.isAI).length >= 60) return send(ws, { t: 'error', msg: '월드가 가득 찼습니다. 잠시 후 다시 시도하세요' });
      if (ws.pid != null) return;
      const p = world.addPlayer(cleanName(m.name), m.civ | 0, false);
      attach(ws, p);
      chatMsg('📢', `${p.name}님이 새 문명으로 입장했습니다`);
      return;
    }
    case 'rejoin': {
      const p = world.players.find(q => q.token === m.token && !q.isAI);
      if (!p || p.removed) return send(ws, { t: 'rejoinFail' });
      attach(ws, p);
      return;
    }
  }
  if (ws.pid == null) return send(ws, { t: 'error', msg: '먼저 월드에 입장하세요' });
  const me = world.players[ws.pid];
  if (!me || me.ws !== ws) return;
  me.lastSeen = Date.now();
  switch (m.t) {
    case 'chat': { const text = String(m.text || '').slice(0, 200).trim(); if (text) chatMsg(me.name, text, me.color); return; }
    case 'leave': me.ws = null; ws.pid = null; send(ws, { t: 'left' }); world.markAll(); return;
    case 'act': { const err = world.act(ws.pid, m); if (err) send(ws, { t: 'error', msg: err }); return; }
  }
}

if (require.main === module) {
  world = loadWorld();
  setInterval(() => { try { world.tick(); world.flush(); } catch (e) { console.error(e); } }, 150);
  setInterval(() => { for (const p of world.players) if (p.ws) p.ws.ping(); }, 25000);
  setInterval(saveWorld, 60000);
  setInterval(() => world.cleanupInactive(), 10 * 60 * 1000);
  const bye = () => { saveWorld(); process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
  server.listen(PORT, () => console.log(`🌍 문명 전쟁 월드 서버: http://localhost:${PORT} (턴 ${CFG.TURN_SECONDS}초, 맵 ${world.W}x${world.H})`));
}
module.exports = { World, genMap, CFG };
