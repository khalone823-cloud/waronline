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
  const pick = arr => { let r = rnd() * arr.reduce((s, a) => s + a[1], 0); for (const [k, w] of arr) { r -= w; if (r <= 0) return k; } return arr[0][0]; };
  for (let i = 0; i < N; i++) {
    const t = terr[i], r = rnd();
    if (t === 'ocean') { if (r < 0.1 && R.neighbors(i, W, H).some(n => terr[n] !== 'ocean')) res[i] = 'fish'; continue; }
    if (t === 'mountain') continue;
    const chance = t === 'hills' ? 0.32 : t === 'desert' || t === 'tundra' ? 0.18 : 0.13;
    if (r >= chance) continue;
    if (t === 'grass') res[i] = pick([['wheat', 4], ['horse', 3], ['copper', 1.5], ['stone', 1.5]]);
    else if (t === 'plains') res[i] = pick([['wheat', 3], ['horse', 3], ['stone', 2], ['saltpeter', 1.5], ['copper', 1.5]]);
    else if (t === 'hills') res[i] = pick([['iron', 3], ['copper', 2.5], ['coal', 2], ['stone', 2], ['gold', 1]]);
    else if (t === 'forest') res[i] = pick([['iron', 1], ['coal', 1], ['copper', 1]]);
    else if (t === 'desert') res[i] = pick([['saltpeter', 5], ['gold', 3], ['stone', 2]]);
    else if (t === 'tundra') res[i] = pick([['iron', 3], ['coal', 3], ['horse', 3]]);
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
const STOCK_KEYS = Object.keys(R.STOCK);
const MOD_DECAY = { war: 0.5, betrayal: 0.3, trade: 0.25, gift: 0.8, refused: 0.6, helped: 0.4, broken: 0.5, denied: 1 };
const MOD_CAP = { war: -60, betrayal: -60, trade: 25, gift: 35, refused: -40, helped: 40, broken: -40, denied: -20 };
const MARKET_TARGET = 50;
const BATTLE_ROUND_MS = 25000;
const emptyStock = () => Object.fromEntries(STOCK_KEYS.map(k => [k, 0]));
const resText = r => Object.entries(r || {}).filter(([, v]) => v > 0).map(([k, v]) => `${R.STOCK[k].name} ${v}`).join(', ');

class World {
  constructor(saved) {
    this.speedKey = R.SPEEDS[CFG.SPEED] ? CFG.SPEED : 'normal';
    this.speed = R.SPEEDS[this.speedKey].mult;
    this.units = new Map(); this.cities = new Map(); this.cityAt = new Map(); this.claimTiles = new Map();
    this.battles = new Map(); this.nextBattle = 1;
    this.rnd = mulberry32((Math.random() * 1e9) | 0);
    this.touched = new Set(); this.claimsDirty = false; this.border = {};
    if (saved) this.load(saved);
    else {
      this.W = CFG.W; this.H = CFG.H; this.N = this.W * this.H;
      this.seed = (Math.random() * 1e9) | 0;
      const map = genMap(this.W, this.H, this.seed);
      this.terr = map.terr; this.res = map.res; this.imp = new Array(this.N).fill('');
      this.nextId = 1; this.turn = 1; this.players = []; this.created = Date.now();
      this.rels = {}; this.deals = []; this.props = [];
      this.market = { stock: Object.fromEntries(STOCK_KEYS.map(k => [k, MARKET_TARGET])) };
    }
    this.claim = new Int32Array(this.N).fill(-1);
    this.turnStart = Date.now();
    this.dirty = new Set();
    this.refresh();
    this.computeBorders();
    if (!saved) for (let k = 0; k < CFG.AI_COUNT; k++) this.addAI();
  }

  // ── 저장/불러오기 ──
  serialize() {
    return JSON.stringify({
      v: 2, W: this.W, H: this.H, seed: this.seed, terr: this.terr, res: this.res, imp: this.imp, turn: this.turn, nextId: this.nextId, created: this.created,
      rels: this.rels, deals: this.deals, props: this.props, market: this.market,
      players: this.players.map(p => {
        const o = {}; for (const k of Object.keys(p)) if (!['ws', 'visible', 'baseVis', 'explored', 'sentFog', 'sentOwner', 'sentImp'].includes(k)) o[k] = p[k];
        o.explored = Buffer.from(p.explored || new Uint8Array(this.N)).toString('base64'); return o;
      }),
      units: [...this.units.values()].map(u => Object.assign({}, u, { inBattle: null })), cities: [...this.cities.values()],
    });
  }
  load(s) {
    this.W = s.W; this.H = s.H; this.N = s.W * s.H; this.seed = s.seed; this.terr = s.terr; this.res = s.res; this.imp = s.imp;
    this.turn = s.turn; this.nextId = s.nextId; this.created = s.created || Date.now();
    this.rels = s.rels || {}; this.deals = s.deals || []; this.props = s.props || []; this.market = s.market;
    this.players = s.players.map(p => Object.assign(p, { explored: new Uint8Array(Buffer.from(p.explored, 'base64')), visible: new Uint8Array(this.N), baseVis: new Uint8Array(this.N), ws: null, ready: false }));
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
  isMil(u) { return !R.UNITS[u.type].civ; }
  maxMoves(u) { return R.UNITS[u.type].moves + (u.eq && u.eq.mount ? R.EQUIP[u.eq.mount].mv : 0); }
  protectedP(pid) { const p = this.players[pid]; return p && !p.isAI && p.protectUntil > this.turn; }

  // ── 관계 ──
  rel(a, b) {
    const k = a < b ? a + '_' + b : b + '_' + a;
    return this.rels[k] || (this.rels[k] = { state: 'peace', warTurn: -99, peaceTurn: -99, peaceUntil: 0, napUntil: 0, openUntil: 0, alliance: false });
  }
  atWar(a, b) { return a !== b && a >= 0 && b >= 0 && this.rel(a, b).state === 'war'; }
  allied(a, b) { return a !== b && this.rel(a, b).alliance; }
  friendly(a, b) { return a === b || this.allied(a, b); }
  canEnterLand(pid, owner) {
    if (owner < 0 || owner === pid) return true;
    const r = this.rel(pid, owner);
    return r.state === 'war' || r.alliance || r.openUntil > this.turn;
  }
  addMod(p, qid, k, v) {
    if (!p || p.removed) return;
    p.mods = p.mods || {}; const m = p.mods[qid] = p.mods[qid] || {};
    const cap = MOD_CAP[k] || 50;
    m[k] = (m[k] || 0) + v;
    if (cap < 0) m[k] = Math.max(cap, m[k]); else m[k] = Math.min(cap, m[k]);
  }
  opinion(pid, qid) {
    const p = this.players[pid]; if (!p) return 0;
    let o = 0; const m = (p.mods || {})[qid] || {};
    for (const k in m) o += m[k];
    if (this.allied(pid, qid)) o += 25;
    if (this.atWar(pid, qid)) o -= 30;
    if (this.border[pid + '_' + qid]) o -= 8;
    for (const x of this.alivePlayers()) if (x.id !== pid && x.id !== qid && this.atWar(pid, x.id) && this.atWar(qid, x.id)) { o += 15; break; }
    const q = this.players[qid]; if (q) o += Math.round(((q.trust == null ? 60 : q.trust) - 60) / 4);
    return clamp(Math.round(o), -100, 100);
  }
  opinionText(o) { return o >= 50 ? '우호적' : o >= 15 ? '호의적' : o > -15 ? '중립' : o > -50 ? '경계' : '적대적'; }
  computeBorders() {
    this.border = {};
    const cs = [...this.cities.values()];
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (a.owner === b.owner) continue;
      if (R.dist(a.pos, b.pos, this.W) <= 7) { this.border[a.owner + '_' + b.owner] = 1; this.border[b.owner + '_' + a.owner] = 1; }
    }
  }

  addUnit(owner, type, pos, vet) {
    const u = { id: this.nextId++, owner, type, pos, hp: 100, moves: R.UNITS[type].moves, fort: false, attacked: false, acted: false, vet: !!vet, eq: {} };
    this.units.set(u.id, u); return u;
  }
  killUnit(u) { this.units.delete(u.id); }
  msgTo(pids, text) {
    for (const pid of new Set(pids)) {
      const p = this.players[pid]; if (!p || p.removed || p.isAI) continue;
      p.log.push({ turn: this.turn, text }); if (p.log.length > 40) p.log.shift();
      send(p.ws, { t: 'log', turn: this.turn, text });
    }
  }
  msg(pid, text) { this.msgTo([pid], text); }
  msgMet(pids, text) { this.msgTo(this.players.filter(p => !p.removed && (pids.includes(p.id) || pids.some(x => p.met && p.met[x]))).map(p => p.id), text); }
  msgAll(text) { this.msgTo(this.players.filter(p => !p.removed).map(p => p.id), text); }
  fx(pos, items) { for (const p of this.players) if (p.ws && p.visible[pos]) send(p.ws, { t: 'fx', pos, items }); }

  // ── 플레이어 ──
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
      const i = Math.floor(this.rnd() * this.N), t = this.terr[i];
      if (t !== 'grass' && t !== 'plains') continue;
      const x = i % W, y = (i / W) | 0;
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2 || this.claim[i] >= 0) continue;
      if (R.neighbors(i, W, H).filter(n => R.TERRAIN[this.terr[n]].pass).length < 4) continue;
      let md = 30;
      for (const b of blockers) { const d = R.dist(i, b, W); if (d < md) md = d; }
      let fert = 0, deps = 0;
      for (const j of R.inRadius(i, 3, W, H)) { const y2 = this.tileYield(j); fert += y2.food * 1.2 + y2.prod + y2.gold * 0.5; if (this.res[j] && R.RES[this.res[j]].stock) deps++; }
      const s = Math.min(md, 14) * 3 + fert * 0.12 + deps * 1.5 + this.rnd() * 2;
      if (s > bs) { bs = s; best = i; }
    }
    if (best < 0) for (let i = 0; i < this.N; i++) if (R.TERRAIN[this.terr[i]].pass && !this.cityAt.has(i)) { best = i; break; }
    return best;
  }
  resetPlayer(p) {
    const others = this.alivePlayers().filter(q => q !== p);
    const techs = { agriculture: 1 };
    if (others.length >= 2) for (const k of Object.keys(R.TECHS)) if (others.filter(q => q.techs[k]).length >= others.length / 2) techs[k] = 1;
    const stock = emptyStock(); stock.wood = 6; stock.stone = 4; stock.copper = 2;
    if (this.turn > 60) for (const k of STOCK_KEYS) stock[k] += Math.min(10, Math.floor(this.turn / 30));
    Object.assign(p, {
      gold: 25 + Math.min(300, Math.floor(this.turn * 0.4)), techs, paid: {}, researching: null, sciStore: 0,
      stock, armory: {}, sgain: emptyStock(),
      explored: new Uint8Array(this.N), visible: new Uint8Array(this.N), baseVis: new Uint8Array(this.N), alive: true, removed: false,
      nameIdx: 0, gpt: 0, spt: 0, score: 0, log: [], met: {}, mods: {}, trust: p.trust == null ? 60 : Math.max(40, p.trust),
      joinTurn: this.turn, protectUntil: this.turn + CFG.PROTECT_TURNS, foundedCapital: false, ready: false, color: this.pickColor(),
    });
    for (const k of Object.keys(this.rels)) { const [a, b] = k.split('_').map(Number); if (a === p.id || b === p.id) delete this.rels[k]; }
    this.deals = this.deals.filter(d => d.a !== p.id && d.b !== p.id);
    this.props = this.props.filter(d => d.from !== p.id && d.to !== p.id);
    for (const q of this.players) if (q !== p) { if (q.met) delete q.met[p.id]; if (q.mods) delete q.mods[p.id]; }
    const s = this.findSpawn();
    this.addUnit(p.id, 'settler', s);
    const nb = R.neighbors(s, this.W, this.H).filter(n => R.TERRAIN[this.terr[n]].pass);
    this.addUnit(p.id, 'warrior', nb[0] != null ? nb[0] : s);
    this.addUnit(p.id, 'worker', s);
    if (nb[1] != null) this.addUnit(p.id, 'scout', nb[1]);
    if (this.turn > 120 && nb[2] != null) this.addUnit(p.id, 'settler', nb[2]);
    return s;
  }
  addPlayer(name, civ, isAI) {
    const p = { id: this.players.length, token: (isAI ? 'ai' : '') + crypto.randomBytes(12).toString('hex'), name, civ: R.CIVS[civ] ? civ : 0, isAI: !!isAI, lastSeen: Date.now(), ws: null };
    this.players.push(p);
    this.resetPlayer(p);
    this.refresh();
    this.msgAll(`새 문명 [${p.name}](${R.CIVS[p.civ].name})이(가) 세계에 등장했습니다`);
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
    this.deals = this.deals.filter(d => d.a !== p.id && d.b !== p.id);
    this.props = this.props.filter(d => d.from !== p.id && d.to !== p.id);
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
  computeBase(p) {
    p.baseVis = p.baseVis || new Uint8Array(this.N);
    const v = p.baseVis; v.fill(0);
    if (p.removed || !p.alive) return;
    for (const u of this.units.values()) if (u.owner === p.id) {
      const s = (R.UNITS[u.type].sight || 2) + (this.terr[u.pos] === 'hills' ? 1 : 0);
      for (const j of R.inRadius(u.pos, s, this.W, this.H)) v[j] = 1;
    }
    for (const c of this.cities.values()) if (c.owner === p.id) {
      for (const j of R.inRadius(c.pos, 2, this.W, this.H)) v[j] = 1;
      for (const j of this.claimTiles.get(c.id) || []) v[j] = 1;
    }
  }
  combineVis(p) {
    const v = p.visible; v.set(p.baseVis || v.fill(0));
    if (p.removed || !p.alive) { v.fill(0); return; }
    for (const q of this.players) if (q !== p && q.alive && !q.removed && this.allied(p.id, q.id) && q.baseVis) { const b = q.baseVis; for (let i = 0; i < this.N; i++) if (b[i]) v[i] = 1; }
    for (let i = 0; i < this.N; i++) if (v[i]) p.explored[i] = 1;
    for (const u of this.units.values()) if (u.owner !== p.id && v[u.pos]) p.met[u.owner] = 1;
    for (const c of this.cities.values()) if (c.owner !== p.id && v[c.pos]) p.met[c.owner] = 1;
  }
  refresh(pids) {
    if (!pids) { this.computeClaims(); for (const p of this.players) this.computeBase(p); for (const p of this.players) this.combineVis(p); return; }
    const set = new Set();
    for (const id of pids) { const p = this.players[id]; if (!p) continue; this.computeBase(p); set.add(id); for (const q of this.players) if (this.allied(id, q.id)) set.add(q.id); }
    for (const id of set) this.combineVis(this.players[id]);
  }

  // ── 도시 ──
  cityStrength(c, occ) {
    const p = this.players[c.owner];
    let best = 8;
    for (const k of Object.keys(R.UNITS)) { const u = R.UNITS[k]; if (!u.civ && (!u.tech || p.techs[u.tech])) best = Math.max(best, u.str); }
    let s = 6 + c.pop * 1.2 + best * 0.45;
    for (const b of c.buildings) s += R.BUILDINGS[b].def || 0;
    const here = occ ? (occ.get(c.pos) || []) : this.unitsAt(c.pos);
    const g = here.filter(u => u.owner === c.owner && this.isMil(u)).sort((a, b) => R.UNITS[b.type].str - R.UNITS[a.type].str)[0];
    if (g) s += R.UNITS[g.type].str * 0.3;
    if (this.terr[c.pos] === 'hills') s *= 1.25;
    return Math.round(s);
  }
  cityMaxHp(c) { let h = 200; for (const b of c.buildings) h += R.BUILDINGS[b].hp || 0; return h; }
  foodNeed(pop) { return Math.round((14 + 8 * (pop - 1) + Math.pow(pop - 1, 1.6)) * this.speed); }
  tileYield(i) {
    const t = R.TERRAIN[this.terr[i]], r = this.res[i] ? R.RES[this.res[i]] : null;
    const y = { food: t.food + (r ? r.food : 0), prod: t.prod + (r ? r.prod : 0), gold: t.gold + (r ? r.gold : 0) };
    const im = this.imp && this.imp[i] ? R.IMPS[R.IMP_BY_CODE[this.imp[i]]] : null;
    if (im) { y.food += im.food || 0; y.prod += im.prod || 0; }
    return y;
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
      tiles.push({ ...y, s: y.food * 1.6 + y.prod * 1.3 + y.gold * 0.8 });
    }
    tiles.sort((a, b) => b.s - a.s);
    for (const t of tiles.slice(0, c.pop)) { food += t.food; prod += t.prod; gold += t.gold; }
    prod += Math.floor(c.pop / 3);
    for (const b of c.buildings) { const B = R.BUILDINGS[b]; food += B.food || 0; prod += B.prod || 0; gold += B.gold || 0; sci += B.sci || 0; }
    if (c.capital) { gold += 3; sci += 2; prod += 1; }
    if (c.queue && c.queue.kind === 'process') { const half = Math.floor(prod / 2); if (c.queue.type === 'wealth') gold += half; else sci += half; }
    return { food, prod, gold, sci, upkeep: c.pop * 2 };
  }
  itemDef(q) {
    if (!q) return null;
    if (q.kind === 'unit') return R.UNITS[q.type];
    if (q.kind === 'building') return R.BUILDINGS[q.type];
    if (q.kind === 'equip') return R.EQUIP[q.type];
    return null;
  }
  itemCost(q) { const d = this.itemDef(q); return d ? this.cost(d.cost) : 0; }
  itemRes(q) { const d = this.itemDef(q); return d ? d.res || null : null; }
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
    this.imp[pos] = '';
    return c;
  }
  ensureCapital(pid) {
    const cs = this.citiesOf(pid);
    if (!cs.length || cs.some(c => c.capital)) return;
    cs.sort((a, b) => b.pop - a.pop); cs[0].capital = true;
    this.msg(pid, `${cs[0].name}이(가) 새 수도가 되었습니다`);
  }

  // ── 이동 ──
  canStand(pid, i, occ) {
    const c = this.cityAt.get(i); if (c && c.owner !== pid) return false;
    const us = occ.get(i); if (us && !us.every(x => this.friendly(pid, x.owner))) return false;
    return this.canEnterLand(pid, this.tileOwner(i));
  }
  reachFor(u, occ) {
    occ = occ || this.occMap();
    const ok = i => this.canStand(u.owner, i, occ);
    return R.reach(this.W, this.H, this.terr, u.pos, u.moves, ok, ok);
  }
  // 근접 공격 가능 칸 (전투 시작)
  battleTargets(pid, from) {
    const out = [];
    for (const j of R.neighbors(from, this.W, this.H)) {
      if (!R.TERRAIN[this.terr[j]].pass) continue;
      if (this.battleBlock(pid, j) === null) out.push(j);
    }
    return out;
  }
  // 공격 불가 이유 (null이면 가능)
  battleBlock(pid, j) {
    const c = this.cityAt.get(j);
    const us = this.unitsAt(j).filter(x => x.owner !== pid);
    if (!us.length && !(c && c.owner !== pid)) return '공격할 대상이 없습니다';
    if (c && c.owner !== pid && !this.atWar(pid, c.owner)) return '전쟁 중이 아닌 나라의 도시입니다';
    for (const x of us) if (!this.atWar(pid, x.owner)) return '전쟁 중이 아닌 나라의 유닛이 함께 있습니다';
    for (const b of this.battles.values()) if (b.to === j || b.from === j) return '이미 전투가 벌어지고 있는 칸입니다';
    return null;
  }
  bombardTargets(u) {
    const U = R.UNITS[u.type], out = [];
    if (!U.rstr || u.moves <= 0 || u.attacked || u.inBattle) return out;
    for (const j of R.inRadius(u.pos, U.range, this.W, this.H)) {
      if (j === u.pos) continue;
      const c = this.cityAt.get(j);
      if ((c && c.owner !== u.owner && this.atWar(u.owner, c.owner)) || this.unitsAt(j).some(x => this.atWar(u.owner, x.owner))) out.push(j);
    }
    return out;
  }
  expel(a, b) {
    // a의 유닛 중 b 영토 안에 있는 것들을 밖으로
    const occ = this.occMap();
    for (const u of this.unitsOf(a)) {
      if (this.tileOwner(u.pos) !== b || this.canEnterLand(a, b)) continue;
      const seen = new Set([u.pos]); const q = [u.pos]; let dest = -1;
      while (q.length && dest < 0) {
        const c = q.shift();
        for (const n of R.neighbors(c, this.W, this.H)) {
          if (seen.has(n) || !R.TERRAIN[this.terr[n]].pass) continue; seen.add(n);
          if (this.canStand(a, n, occ)) { dest = n; break; }
          q.push(n);
        }
        if (seen.size > 400) break;
      }
      if (dest >= 0) { u.pos = dest; u.work = null; }
    }
  }

  // ── 전투 ──
  eqAtk(u) { return u.eq && u.eq.weapon ? R.EQUIP[u.eq.weapon].atk : 0; }
  eqDef(u) { return u.eq && u.eq.armor ? R.EQUIP[u.eq.armor].def : 0; }
  hpF(u) { return 0.5 + 0.5 * Math.max(0, u.hp) / 100; }
  atkPow(u) { const U = R.UNITS[u.type]; return ((U.rstr || U.str) + this.eqAtk(u)) * (u.vet ? 1.15 : 1) * this.hpF(u); }
  defPow(u, onHome) {
    const U = R.UNITS[u.type];
    let s = (U.str + this.eqDef(u)) * (u.vet ? 1.15 : 1) * this.hpF(u);
    if (onHome) { s *= 1 + (R.TERRAIN[this.terr[u.pos]].def || 0) / 100; if (u.fort) s *= 1.25; }
    return Math.max(1, s);
  }
  defWeights(b) {
    const ds = b.dIds.map(id => this.units.get(id)).filter(Boolean);
    const n = Math.max(1, ds.length);
    const rr = ds.filter(u => R.UNITS[u.type].rstr).length / n, mm = ds.filter(u => R.UNITS[u.type].mounted).length / n;
    const w = { charge: 1 + 2 * mm, volley: 1 + 2.2 * rr, shield: 1 + (b.cityId ? 1 : 0) + (ds.some(u => u.fort) ? 0.6 : 0) };
    return w;
  }
  pickWeighted(w) { let r = this.rnd() * (w.charge + w.volley + w.shield); for (const k of ['charge', 'volley', 'shield']) { r -= w[k]; if (r <= 0) return k; } return 'shield'; }
  counterOf(t) { return Object.keys(R.TACTICS).find(k => R.TACTICS[k].beats === t); }
  startBattle(pid, ids, to) {
    const p = this.players[pid];
    const us = ids.map(id => this.units.get(id)).filter(u => u && u.owner === pid && this.isMil(u) && u.moves > 0 && !u.attacked && !u.inBattle);
    if (!us.length) return '공격할 수 있는 유닛이 없습니다 (이동력/이미 공격함)';
    const from = us[0].pos;
    const att = us.filter(u => u.pos === from);
    if (R.dist(from, to, this.W) !== 1) return '붙어 있는 칸만 공격할 수 있습니다';
    if (!R.TERRAIN[this.terr[to]].pass) return '공격할 수 없는 지형입니다';
    const why = this.battleBlock(pid, to); if (why) return why;
    const city = this.cityAt.get(to);
    const defs = this.unitsAt(to).filter(x => x.owner !== pid && this.isMil(x));
    const b = { id: this.nextBattle++, att: pid, from, to, aIds: att.map(u => u.id), dIds: defs.map(u => u.id), cityId: city && city.owner !== pid ? city.id : null,
      dOwners: [...new Set([...defs.map(u => u.owner), ...(city && city.owner !== pid ? [city.owner] : [])])], round: 0, max: 3, deadline: Date.now() + BATTLE_ROUND_MS,
      last: null, over: false, result: null, loss: { a: 0, d: 0 } };
    for (const u of att) u.inBattle = b.id;
    for (const u of defs) u.inBattle = b.id;
    const w = this.defWeights(b);
    b.hint = Object.keys(w).sort((x, y) => w[y] - w[x])[0];
    this.battles.set(b.id, b);
    for (const o of b.dOwners) this.msg(o, `[${p.name}]의 군대(${att.length})가 ${city ? city.name : '우리 부대'}을(를) 공격해 옵니다!`);
    if (p.isAI || !p.ws) this.autoBattle(b);
    else this.sendBattle(b);
    return null;
  }
  battleRound(b, tac) {
    if (b.over) return;
    const city = b.cityId ? this.cities.get(b.cityId) : null;
    const A = b.aIds.map(id => this.units.get(id)).filter(u => u && u.hp > 0);
    const D = b.dIds.map(id => this.units.get(id)).filter(u => u && u.hp > 0);
    const hits = [];
    if (tac === 'retreat') {
      for (const d of D) { const t = A[Math.floor(this.rnd() * A.length)]; if (!t) break; const dmg = clamp(Math.round(10 * Math.pow(this.atkPow(d) / this.defPow(t), 1.1) * (0.8 + this.rnd() * 0.4)), 1, 40); t.hp -= dmg; hits.push({ s: 'd', f: d.id, t: t.id, d: dmg }); }
      b.last = { aTac: 'retreat', dTac: null, adv: null, hits };
      this.cleanupDead(b);
      return this.finishBattle(b, 'retreat');
    }
    if (!R.TACTICS[tac]) tac = this.counterOf(b.hint);
    const dTac = this.pickWeighted(this.defWeights(b));
    const adv = R.TACTICS[tac].beats === dTac ? 'a' : R.TACTICS[dTac].beats === tac ? 'd' : null;
    const cityStr = city ? this.cityStrength(city) : 0;
    const tacMod = (t, U) => t === 'charge' ? (U.mounted ? 1.5 : U.rstr ? 0.5 : 1.2) : t === 'volley' ? (U.rstr ? 1.6 : 0.6) : 0.75;
    const takenMod = t => t === 'shield' ? 0.6 : t === 'charge' ? 1.1 : 1;
    const strike = (side, f, U, aPow, foes, foeCity, myTac, foeTac) => {
      const melee = foes.filter(x => !R.UNITS[x.type].rstr);
      let target = null, isCity = false;
      if (U.rstr) { if (foeCity && foeCity.hp > 0 && (this.rnd() < 0.35 || !foes.length)) isCity = true; else target = foes[Math.floor(this.rnd() * foes.length)]; }
      else if (melee.length) target = melee[Math.floor(this.rnd() * melee.length)];
      else if (foeCity && foeCity.hp > 0) isCity = true;
      else target = foes[Math.floor(this.rnd() * foes.length)];
      if (!target && !isCity) return;
      const Dp = isCity ? cityStr : this.defPow(target, side === 'a');
      let mod = tacMod(myTac, U) * takenMod(foeTac) * (adv === side ? 1.3 : adv ? 0.8 : 1);
      if (!isCity && U.anti && R.UNITS[target.type].mounted) mod *= 1.5;
      if (isCity && U.siege) mod *= 2;
      const dmg = clamp(Math.round(16 * Math.pow(aPow / Dp, 1.1) * (0.8 + this.rnd() * 0.4) * mod), 1, 70);
      hits.push({ s: side, f, t: isCity ? 'city' : target.id, d: dmg });
    };
    for (const u of A) strike('a', u.id, R.UNITS[u.type], this.atkPow(u), D, city, tac, dTac);
    for (const u of D) strike('d', u.id, R.UNITS[u.type], this.atkPow(u), A, null, dTac, tac);
    if (city && city.hp > 0) strike('d', 'city', { rstr: 1 }, cityStr * 0.6, A, null, dTac, tac);
    for (const h of hits) {
      if (h.t === 'city') { city.hp = Math.max(0, city.hp - h.d); city.attackedTurn = this.turn; }
      else { const u = this.units.get(h.t); if (u) u.hp -= h.d; }
    }
    b.round++;
    b.last = { aTac: tac, dTac, adv, hits };
    this.cleanupDead(b);
    const aAlive = b.aIds.length, dAlive = b.dIds.length, cityUp = city && this.cities.has(city.id) && city.hp > 0;
    if (!aAlive) return this.finishBattle(b, 'lose');
    if (!dAlive && !cityUp) return this.finishBattle(b, 'win');
    if (b.round >= b.max) return this.finishBattle(b, dAlive ? 'draw' : 'siege');
    b.deadline = Date.now() + BATTLE_ROUND_MS;
    const w = this.defWeights(b); b.hint = Object.keys(w).sort((x, y) => w[y] - w[x])[0];
    this.sendBattle(b);
  }
  cleanupDead(b) {
    const dead = [];
    for (const id of [...b.aIds, ...b.dIds]) { const u = this.units.get(id); if (u && u.hp <= 0) { dead.push(u); this.killUnit(u); } }
    b.loss.a += b.aIds.filter(id => !this.units.has(id)).length;
    b.loss.d += b.dIds.filter(id => !this.units.has(id)).length;
    b.aIds = b.aIds.filter(id => this.units.has(id)); b.dIds = b.dIds.filter(id => this.units.has(id));
    b.dead = (b.dead || []).concat(dead.map(u => ({ id: u.id, t: u.type, o: u.owner })));
  }
  finishBattle(b, result) {
    if (b.over) return;
    b.over = true; b.result = result;
    const p = this.players[b.att];
    let city = b.cityId ? this.cities.get(b.cityId) : null;
    if (city && city.owner === b.att) city = null;
    for (const id of b.aIds) { const u = this.units.get(id); if (u) { u.moves = 0; u.attacked = true; u.acted = true; u.fort = false; u.inBattle = null; u.work = null; } }
    for (const id of b.dIds) { const u = this.units.get(id); if (u) u.inBattle = null; }
    const melee = b.aIds.map(id => this.units.get(id)).filter(u => u && !R.UNITS[u.type].rstr);
    let captured = false;
    if ((result === 'win' || result === 'siege') && melee.length) {
      if (city && city.hp <= 0 && !b.dIds.length) { for (const u of melee) u.pos = b.to; this.captureCity(city, melee[0]); captured = true; b.result = result = 'win'; }
      else if (!city && !b.dIds.length) {
        for (const u of melee) u.pos = b.to;
        for (const c of this.unitsAt(b.to)) if (c.owner !== b.att && !this.isMil(c)) { this.msg(c.owner, `${R.UNITS[c.type].name}이(가) [${p.name}]에게 포획되었습니다`); c.owner = b.att; c.moves = 0; c.work = null; }
        b.result = result = 'win';
      }
    }
    const txt = { win: captured ? '승리 · 도시 점령!' : '승리', lose: '패배', draw: '무승부 (전선 유지)', siege: '공성 계속 (도시 체력 남음)', retreat: '후퇴' }[result];
    this.msg(b.att, `전투 결과: ${txt} — 아군 손실 ${b.loss.a}, 적 손실 ${b.loss.d}`);
    for (const o of b.dOwners) this.msg(o, `[${p.name}]의 공격 ${result === 'win' ? '을 막지 못했습니다' : result === 'lose' ? '을 격퇴했습니다' : '을 버텨냈습니다'} — 아군 손실 ${b.loss.d}, 적 손실 ${b.loss.a}`);
    if (b.last) this.fx(b.to, b.last.hits.slice(0, 6).filter(h => h.s === 'a').map(h => ({ pos: b.to, dmg: h.d })));
    for (const o of b.dOwners) this.checkElimination(o);
    this.checkElimination(b.att);
    this.sendBattle(b);
    this.battles.delete(b.id);
    this.refresh(); this.markAll();
  }
  autoBattle(b) {
    let guard = 0;
    while (!b.over && guard++ < 10) {
      const t = this.rnd() < 0.6 ? this.counterOf(b.hint) : ['charge', 'volley', 'shield'][Math.floor(this.rnd() * 3)];
      this.battleRound(b, t);
    }
  }
  battleView(b, pid) {
    const city = b.cityId ? this.cities.get(b.cityId) : null;
    const uv = id => { const u = this.units.get(id); return u ? { id: u.id, t: u.type, o: u.owner, hp: u.hp, eq: u.eq, v: u.vet ? 1 : 0 } : null; };
    return { t: 'battle', id: b.id, att: b.att, attName: this.nm(b.att), defName: b.dOwners.map(o => this.nm(o)).join(', '), from: b.from, to: b.to, round: b.round, max: b.max,
      over: b.over, result: b.result, hint: pid === b.att ? b.hint : null, mine: pid === b.att, loss: b.loss, dead: b.dead || [],
      a: b.aIds.map(uv).filter(Boolean), d: b.dIds.map(uv).filter(Boolean),
      city: city ? { name: city.name, hp: city.hp, mhp: this.cityMaxHp(city), str: this.cityStrength(city), o: city.owner } : null,
      last: b.last, left: Math.max(0, b.deadline - Date.now()) };
  }
  sendBattle(b) {
    for (const pid of [b.att, ...b.dOwners]) { const p = this.players[pid]; if (p && p.ws) send(p.ws, this.battleView(b, pid)); }
  }
  bombard(u, target) {
    const U = R.UNITS[u.type];
    const city = this.cityAt.get(target);
    u.attacked = true; u.acted = true; u.moves = 0; u.fort = false; u.work = null;
    this.touched.add(u.owner);
    if (city && city.owner !== u.owner && this.atWar(u.owner, city.owner)) {
      const A = this.atkPow(u) * (U.siege ? 2 : 1), D = this.cityStrength(city);
      const dmg = clamp(Math.round(24 * Math.pow(A / D, 1.1) * (0.85 + this.rnd() * 0.3)), 1, 90);
      city.hp = Math.max(1, city.hp - dmg); city.attackedTurn = this.turn; this.touched.add(city.owner);
      this.fx(target, [{ pos: target, dmg }]);
      this.msg(city.owner, `${city.name}이(가) [${this.nm(u.owner)}]의 ${U.name}에게 포격당했습니다 (-${dmg})`);
      return;
    }
    const foes = this.unitsAt(target).filter(x => this.atWar(u.owner, x.owner));
    const mil = foes.filter(x => this.isMil(x));
    const d = mil.length ? mil[Math.floor(this.rnd() * mil.length)] : foes[0];
    if (!d) return;
    this.touched.add(d.owner);
    const dmg = this.isMil(d) ? clamp(Math.round(26 * Math.pow(this.atkPow(u) / this.defPow(d, true), 1.1) * (0.85 + this.rnd() * 0.3)), 1, 90) : 100;
    d.hp -= dmg;
    this.fx(target, [{ pos: target, dmg }]);
    if (d.hp <= 0) { this.killUnit(d); this.msg(d.owner, `${R.UNITS[d.type].name}이(가) [${this.nm(u.owner)}]의 포격으로 전멸했습니다`); this.msg(u.owner, `포격으로 적 ${R.UNITS[d.type].name}을(를) 격파했습니다`); this.checkElimination(d.owner); }
    else this.msg(d.owner, `${R.UNITS[d.type].name}이(가) 포격을 받았습니다 (-${dmg})`);
  }
  cityShoot(c, target) {
    const foes = this.unitsAt(target).filter(x => this.atWar(c.owner, x.owner));
    const d = foes.find(x => this.isMil(x)) || foes[0];
    if (!d) return;
    this.touched.add(d.owner);
    const dmg = this.isMil(d) ? clamp(Math.round(24 * Math.pow(this.cityStrength(c) * 0.75 / this.defPow(d, true), 1.1) * (0.85 + this.rnd() * 0.3)), 1, 90) : 100;
    d.hp -= dmg; c.shotTurn = this.turn;
    this.fx(target, [{ pos: target, dmg }]);
    if (d.hp <= 0) { this.killUnit(d); this.msg(d.owner, `${R.UNITS[d.type].name}이(가) ${c.name}의 포격으로 전멸했습니다`); this.checkElimination(d.owner); }
    else this.msg(d.owner, `${R.UNITS[d.type].name}이(가) ${c.name}의 포격을 받았습니다 (-${dmg})`);
  }
  checkElimination(pid) {
    const p = this.players[pid];
    if (!p || !p.alive) return;
    const hasCity = this.citiesOf(pid).length > 0;
    const hasSettler = this.unitsOf(pid).some(u => u.type === 'settler');
    if (!hasCity && (!hasSettler || p.foundedCapital)) {
      p.alive = false; p.diedTurn = this.turn;
      for (const u of this.unitsOf(pid)) this.units.delete(u.id);
      this.deals = this.deals.filter(d => d.a !== pid && d.b !== pid);
      this.props = this.props.filter(d => d.from !== pid && d.to !== pid);
      for (const k of Object.keys(this.rels)) { const [a, b] = k.split('_').map(Number); if (a === pid || b === pid) this.rels[k].alliance = false; }
      this.msgAll(`[${p.name}] 문명이 멸망했습니다!`);
      this.claimsDirty = true;
    }
  }
  captureCity(c, attacker) {
    const oldOwner = c.owner;
    for (const u of this.unitsAt(c.pos)) {
      if (u.owner === attacker.owner) continue;
      if (this.isMil(u)) this.killUnit(u); else { u.owner = attacker.owner; u.work = null; }
    }
    c.owner = attacker.owner; c.pop = Math.max(1, Math.ceil(c.pop / 2)); c.hp = 60; c.queue = null; c.prod = 0; c.food = 0;
    c.buildings = c.buildings.filter(b => (b !== 'walls' && b !== 'castle') || this.rnd() < 0.5);
    const wasCap = c.capital; c.capital = false;
    this.msgMet([attacker.owner, oldOwner], `[${this.nm(attacker.owner)}]이(가) [${this.nm(oldOwner)}]의 도시 ${c.name}을(를) 점령했습니다!${wasCap ? ' (수도 함락)' : ''}`);
    this.claimsDirty = true;
    this.computeClaims();
    this.ensureCapital(oldOwner);
    this.checkElimination(oldOwner);
  }

  // ── 외교 ──
  declareWar(a, b, depth) {
    const A = this.players[a], B = this.players[b], r = this.rel(a, b);
    const treachery = r.peaceUntil > this.turn || r.napUntil > this.turn;
    r.state = 'war'; r.warTurn = this.turn; r.openUntil = 0; r.napUntil = 0; r.peaceUntil = 0; r.alliance = false;
    this.deals = this.deals.filter(d => !((d.a === a && d.b === b) || (d.a === b && d.b === a)));
    this.props = this.props.filter(d => !((d.from === a && d.to === b) || (d.from === b && d.to === a)));
    this.addMod(B, a, 'war', -50);
    if (treachery) {
      A.trust = Math.max(0, (A.trust == null ? 60 : A.trust) - 30);
      for (const q of this.players) if (q.id !== a && q.met && q.met[a]) this.addMod(q, a, 'betrayal', -20);
      this.msgMet([a, b], `[${A.name}]이(가) 조약을 깨고 [${B.name}]에게 선전포고했습니다! (배신)`);
    } else this.msgMet([a, b], `[${A.name}]이(가) [${B.name}]에게 선전포고했습니다!`);
    this.mark(a); this.mark(b);
    // 방어 동맹 발동
    if ((depth || 0) > 2) return;
    for (const c of this.alivePlayers()) {
      if (c.id === a || c.id === b || !this.allied(c.id, b) || this.atWar(c.id, a)) continue;
      if (this.allied(c.id, a)) continue;
      if (c.isAI) {
        if (this.opinion(c.id, b) >= 10 && this.rel(c.id, a).napUntil <= this.turn) { this.addMod(B, c.id, 'helped', 20); this.declareWar(c.id, a, (depth || 0) + 1); }
        else { this.addMod(B, c.id, 'refused', -25); this.msg(b, `동맹 [${c.name}]이(가) 참전 요청을 거절했습니다`); }
      } else {
        this.props.push({ id: this.nextId++, kind: 'call', from: b, to: c.id, target: a, turn: this.turn });
        this.msg(c.id, `동맹 [${B.name}]이(가) [${A.name}]의 침공을 받아 참전을 요청합니다. [외교]에서 응답하세요`);
        this.mark(c.id);
      }
    }
  }
  makePeace(a, b) {
    const r = this.rel(a, b);
    r.state = 'peace'; r.peaceTurn = this.turn; r.peaceUntil = this.turn + R.TREATY.PEACE;
    this.msgMet([a, b], `[${this.nm(a)}]과(와) [${this.nm(b)}]이(가) 평화 조약을 맺었습니다 (${R.TREATY.PEACE}턴)`);
    this.expel(a, b); this.expel(b, a);
    this.mark(a); this.mark(b);
  }
  cancelAlliance(a, b) {
    const r = this.rel(a, b); r.alliance = false;
    this.addMod(this.players[b], a, 'broken', -15);
    this.msgMet([a, b], `[${this.nm(a)}]이(가) [${this.nm(b)}]와(과)의 동맹을 파기했습니다`);
    this.expel(a, b); this.expel(b, a);
    this.claimsDirty = true;
  }
  cleanOffer(o) {
    const n = (v, max) => clamp(Math.floor(+v || 0), 0, max);
    const side = s => {
      s = s || {};
      const res = {}, lump = {};
      for (const k of STOCK_KEYS) { const a = n((s.res || {})[k], 50), b = n((s.lump || {})[k], 999); if (a) res[k] = a; if (b) lump[k] = b; }
      return { gold: n(s.gold, 100000), gpt: n(s.gpt, 500), res, lump };
    };
    const clauses = [...new Set((o.clauses || []).filter(c => ['peace', 'alliance', 'open', 'nap'].includes(c)))];
    return { fg: side(o.fg), tg: side(o.tg), clauses };
  }
  offerEmpty(o) {
    const e = s => !s.gold && !s.gpt && !Object.keys(s.res).length && !Object.keys(s.lump).length;
    return e(o.fg) && e(o.tg) && !o.clauses.length;
  }
  checkOffer(from, to, o) {
    const r = this.rel(from, to), F = this.players[from], T = this.players[to];
    if (!T || !T.alive || T.removed || from === to) return '대상이 없습니다';
    if (!F.met[to]) return '아직 만나지 못한 문명입니다';
    if (this.offerEmpty(o)) return '제안 내용이 비어 있습니다';
    for (const c of o.clauses) {
      if (c === 'peace' && r.state !== 'war') return '전쟁 중이 아닙니다';
      if (c === 'peace' && r.warTurn + 3 > this.turn) return '선전포고 후 3턴이 지나야 평화 협상이 가능합니다';
      if (c !== 'peace' && r.state === 'war' && !o.clauses.includes('peace')) return '전쟁 중에는 평화 조항이 먼저 필요합니다';
      if (c === 'alliance' && r.alliance) return '이미 동맹입니다';
    }
    if (r.state === 'war' && !o.clauses.includes('peace') && (o.fg.gpt || o.tg.gpt || Object.keys(o.fg.res).length || Object.keys(o.tg.res).length)) return '전쟁 중에는 지속 교역을 할 수 없습니다';
    const can = (P, s) => P.gold >= s.gold && R.hasRes(P.stock, s.lump);
    if (!can(F, o.fg)) return '내가 줄 금이나 자원이 부족합니다';
    if (!can(T, o.tg)) return '상대가 가진 것보다 많이 요구했습니다';
    return null;
  }
  valueSide(s) {
    let v = s.gold + s.gpt * R.TREATY.DEAL * 0.8;
    for (const k in s.res) v += s.res[k] * R.TREATY.DEAL * this.mprice(k) * 0.8;
    for (const k in s.lump) v += s.lump[k] * this.mprice(k);
    return v;
  }
  aiEvaluate(ai, other, o) {
    // ai가 받는 쪽: o.fg = 상대가 주는 것, o.tg = ai가 주는 것
    const op = this.opinion(ai.id, other.id), trust = other.trust == null ? 60 : other.trust;
    let v = this.valueSide(o.fg) - this.valueSide(o.tg) * 1.1;
    const r = this.rel(ai.id, other.id);
    for (const c of o.clauses) {
      if (c === 'peace') {
        const ratio = this.milPower(ai.id) / Math.max(1, this.milPower(other.id));
        v += ratio < 0.8 ? 80 : ratio < 1.3 ? (this.turn - r.warTurn >= 8 ? 30 : -20) : -70;
      } else if (c === 'alliance') {
        const common = this.alivePlayers().some(x => x.id !== ai.id && x.id !== other.id && this.atWar(ai.id, x.id) && this.atWar(other.id, x.id));
        if (op < 35 && !(common && op >= 15)) return { ok: false, why: '아직 동맹을 맺을 만큼 신뢰하지 않습니다' };
        v += common ? 40 : 10;
      } else if (c === 'open') { if (op < 5) return { ok: false, why: '국경을 열 만큼 가깝지 않습니다' }; v += 5; }
      else if (c === 'nap') { if (op < -15) return { ok: false, why: '당신을 믿지 않습니다' }; v += 8; }
    }
    if (trust < 25 && (o.fg.gpt || Object.keys(o.fg.res).length)) v -= 40;
    v += op * 0.3 + (trust - 60) * 0.3;
    return v >= 3 ? { ok: true } : { ok: false, why: '조건이 마음에 들지 않습니다' };
  }
  propose(from, to, raw) {
    const o = this.cleanOffer(raw);
    const why = this.checkOffer(from, to, o); if (why) return why;
    const T = this.players[to];
    if (T.isAI) {
      const ev = this.aiEvaluate(T, this.players[from], o);
      if (ev.ok) { this.executeOffer(from, to, o); }
      else { this.msg(from, `[${T.name}]이(가) 제안을 거절했습니다: ${ev.why}`); this.addMod(T, from, 'denied', -2); }
      return null;
    }
    if (this.props.filter(p => p.from === from && p.to === to).length >= 3) return '같은 상대에게 보낸 제안이 너무 많습니다';
    this.props.push({ id: this.nextId++, kind: 'deal', from, to, o, turn: this.turn });
    this.msg(to, `[${this.nm(from)}]이(가) 외교 제안을 보냈습니다. [외교 → 받은 제안]에서 확인하세요`);
    this.msg(from, `[${T.name}]에게 제안을 보냈습니다`);
    this.mark(to);
    return null;
  }
  executeOffer(from, to, o) {
    const F = this.players[from], T = this.players[to];
    F.gold -= o.fg.gold; T.gold += o.fg.gold; T.gold -= o.tg.gold; F.gold += o.tg.gold;
    for (const k in o.fg.lump) { F.stock[k] -= o.fg.lump[k]; T.stock[k] += o.fg.lump[k]; }
    for (const k in o.tg.lump) { T.stock[k] -= o.tg.lump[k]; F.stock[k] += o.tg.lump[k]; }
    const per = s => s.gpt || Object.keys(s.res).length;
    if (o.clauses.includes('peace')) this.makePeace(from, to);
    const r = this.rel(from, to);
    if (o.clauses.includes('alliance')) { r.alliance = true; this.claimsDirty = true; }
    if (o.clauses.includes('open')) r.openUntil = this.turn + R.TREATY.OPEN;
    if (o.clauses.includes('nap')) r.napUntil = this.turn + R.TREATY.NAP;
    if (per(o.fg) || per(o.tg)) this.deals.push({ id: this.nextId++, a: from, b: to, ag: { gpt: o.fg.gpt, res: o.fg.res }, bg: { gpt: o.tg.gpt, res: o.tg.res }, until: this.turn + R.TREATY.DEAL });
    const gv = this.valueSide(o.fg) - this.valueSide(o.tg);
    if (gv > 0) this.addMod(T, from, 'gift', Math.min(25, gv / 15)); else if (gv < 0) this.addMod(F, to, 'gift', Math.min(25, -gv / 15));
    this.addMod(T, from, 'trade', 3); this.addMod(F, to, 'trade', 3);
    const parts = [];
    if (o.clauses.includes('alliance')) parts.push('동맹');
    if (o.clauses.includes('open')) parts.push('국경 개방');
    if (o.clauses.includes('nap')) parts.push('불가침');
    if (per(o.fg) || per(o.tg)) parts.push('교역 협정');
    if (!parts.length && (o.fg.gold || o.tg.gold || Object.keys(o.fg.lump).length || Object.keys(o.tg.lump).length)) parts.push('거래');
    if (parts.length) this.msgMet([from, to], `[${F.name}]과(와) [${T.name}]이(가) ${parts.join(', ')}에 합의했습니다`);
    this.mark(from); this.mark(to);
  }
  respond(pid, propId, accept) {
    const pr = this.props.find(x => x.id === propId && x.to === pid);
    if (!pr) return '제안을 찾을 수 없습니다';
    this.props = this.props.filter(x => x !== pr);
    if (pr.kind === 'call') {
      if (accept) {
        if (this.allied(pid, pr.target)) return '참전 대상과 동맹 중입니다';
        if (!this.atWar(pid, pr.target)) { this.addMod(this.players[pr.from], pid, 'helped', 25); this.declareWar(pid, pr.target, 1); }
      } else { this.addMod(this.players[pr.from], pid, 'refused', -25); this.msg(pr.from, `동맹 [${this.nm(pid)}]이(가) 참전을 거절했습니다`); }
      this.mark(pr.from);
      return null;
    }
    if (!accept) { this.msg(pr.from, `[${this.nm(pid)}]이(가) 제안을 거절했습니다`); this.mark(pr.from); return null; }
    const why = this.checkOffer(pr.from, pid, pr.o); if (why) return '제안을 실행할 수 없습니다: ' + why;
    this.executeOffer(pr.from, pid, pr.o);
    return null;
  }

  // ── 세계 시장 ──
  mprice(k) { return R.STOCK[k].price * clamp(Math.sqrt(MARKET_TARGET / (this.market.stock[k] + 5)), 0.35, 3); }
  buyPrice1(k) { return Math.max(1, Math.ceil(this.mprice(k) * 1.15)); }
  sellPrice1(k) { return Math.max(1, Math.floor(this.mprice(k) * 0.85)); }
  trade(p, k, n, side) {
    if (!R.STOCK[k]) return '잘못된 자원';
    n = clamp(n | 0, 1, 20); let done = 0, money = 0;
    for (let i = 0; i < n; i++) {
      if (side === 'buy') { const pr = this.buyPrice1(k); if (p.gold < pr || this.market.stock[k] < 1) break; p.gold -= pr; this.market.stock[k]--; p.stock[k]++; money += pr; }
      else { if (p.stock[k] < 1) break; const pr = this.sellPrice1(k); p.gold += pr; this.market.stock[k]++; p.stock[k]--; money += pr; }
      done++;
    }
    if (!done) return side === 'buy' ? '금이 부족하거나 시장 재고가 없습니다' : '팔 자원이 없습니다';
    if (!p.isAI) this.msg(p.id, `세계 시장: ${R.STOCK[k].name} ${done}개 ${side === 'buy' ? '수입' : '수출'} (${side === 'buy' ? '-' : '+'}${money}금)`);
    return null;
  }

  // ── 플레이어 행동 ──
  act(pid, m) {
    const p = this.players[pid];
    if (!p || p.removed) return '플레이어 없음';
    if (m.a === 'respawn') {
      if (p.alive) return '아직 살아있습니다';
      this.resetPlayer(p); this.refresh(); this.msgAll(`[${p.name}]이(가) 새 땅에서 다시 시작했습니다`); this.markAll(); return null;
    }
    if (!p.alive) return '멸망한 상태입니다. 다시 시작하세요';
    const U = m.unit != null ? this.units.get(m.unit) : null;
    if (m.unit != null && (!U || U.owner !== pid)) return '유닛을 찾을 수 없습니다';
    if (U && U.inBattle) return '전투 중인 유닛입니다';
    const C = m.city != null ? this.cities.get(m.city) : null;
    if (m.city != null && (!C || C.owner !== pid)) return '도시를 찾을 수 없습니다';
    const list = Array.isArray(m.units) ? m.units.map(id => this.units.get(id)).filter(u => u && u.owner === pid && !u.inBattle) : null;
    this.touched = new Set([pid]); this.claimsDirty = false;
    let near = [];
    switch (m.a) {
      case 'move': {
        if (!list || !list.length) return '유닛을 선택하세요';
        const occ = this.occMap(); let moved = 0;
        const from = list[0].pos;
        for (const u of list) {
          if (u.pos !== from || u.moves <= 0) continue;
          const rr = this.reachFor(u, occ);
          if (!rr.has(m.to)) continue;
          u.pos = m.to; u.moves = rr.get(m.to); u.fort = false; u.acted = true; u.skip = false; u.work = null; moved++;
        }
        if (!moved) return '이동할 수 없는 곳입니다';
        near = [from, m.to];
        break;
      }
      case 'battle': {
        if (!list || !list.length) return '유닛을 선택하세요';
        const err = this.startBattle(pid, list.map(u => u.id), m.to);
        if (err) return err;
        near = [m.to];
        break;
      }
      case 'bombard': {
        if (!list || !list.length) return '유닛을 선택하세요';
        let n = 0;
        for (const u of list) { if (!this.bombardTargets(u).includes(m.to)) continue; this.bombard(u, m.to); n++; }
        if (!n) return '포격할 수 있는 유닛이 없습니다';
        near = [m.to];
        break;
      }
      case 'btac': {
        const b = this.battles.get(m.battle);
        if (!b || b.att !== pid || b.over) return '진행 중인 전투가 없습니다';
        if (m.tac === 'auto') this.autoBattle(b); else this.battleRound(b, m.tac);
        return null;
      }
      case 'found': {
        if (!U || U.type !== 'settler') return '개척자만 도시를 세울 수 있습니다';
        const why = this.canFound(pid, U.pos); if (why) return why;
        const c = this.foundCity(pid, U.pos); this.killUnit(U); this.claimsDirty = true;
        this.msg(pid, `새 도시 ${c.name}을(를) 건설했습니다`);
        break;
      }
      case 'improve': {
        if (!U || !R.UNITS[U.type].worker) return '일꾼만 시설을 지을 수 있습니다';
        if (this.tileOwner(U.pos) !== pid) return '내 영토 안에서만 시설을 지을 수 있습니다';
        if (this.cityAt.has(U.pos)) return '도시 칸에는 지을 수 없습니다';
        const imp = R.impFor(this.terr[U.pos], this.res[U.pos]);
        if (!imp) return '이 칸에는 지을 시설이 없습니다';
        if (this.imp[U.pos] === R.IMPS[imp].code) return '이미 시설이 있습니다';
        if (!R.impTechOk(this.terr[U.pos], this.res[U.pos], p.techs)) return `기술이 필요합니다: ${R.TECHS[R.RES[this.res[U.pos]] ? R.RES[this.res[U.pos]].tech : 'mining'].name}`;
        if (this.unitsAt(U.pos).some(x => x.id !== U.id && x.work)) return '다른 일꾼이 이미 작업 중입니다';
        U.work = { imp, left: R.IMPS[imp].turns }; U.moves = 0; U.acted = true;
        break;
      }
      case 'harvest': {
        if (!U || !R.UNITS[U.type].worker) return '일꾼만 채집할 수 있습니다';
        const o = this.tileOwner(U.pos);
        if (o >= 0 && o !== pid) return '다른 나라 영토에서는 채집할 수 없습니다';
        if (U.harv === this.turn) return '이번 턴에 이미 채집했습니다';
        if (U.moves <= 0) return '이동력이 없습니다';
        const r = this.res[U.pos], t = this.terr[U.pos];
        let got = null;
        if (r && R.RES[r].stock) { if (!R.impTechOk(t, r, p.techs)) return `기술이 필요합니다: ${R.TECHS[R.RES[r].tech].name}`; got = R.RES[r].stock; }
        else if (r === 'gold') { p.gold += 4; got = 'coin'; }
        else if (t === 'forest') got = 'wood';
        else if (t === 'hills' && p.techs.mining) got = 'stone';
        else return '이 칸에서는 캘 자원이 없습니다';
        if (got !== 'coin') p.stock[got] = (p.stock[got] || 0) + 1;
        U.harv = this.turn; U.moves = 0; U.acted = true; U.work = null;
        this.fx(U.pos, [{ pos: U.pos, dmg: 0, txt: got === 'coin' ? '+4금' : `+1 ${R.STOCK[got].name}` }]);
        break;
      }
      case 'pillage': {
        if (!U || !this.isMil(U)) return '군사 유닛만 약탈할 수 있습니다';
        const o = this.tileOwner(U.pos);
        if (!this.imp[U.pos]) return '약탈할 시설이 없습니다';
        if (o < 0 || !this.atWar(pid, o)) return '전쟁 중인 나라의 영토에서만 약탈할 수 있습니다';
        if (U.moves <= 0) return '이동력이 없습니다';
        this.imp[U.pos] = ''; p.gold += 15; U.moves = 0; U.acted = true;
        this.msg(o, `[${p.name}]이(가) 우리 시설을 약탈했습니다`); this.touched.add(o);
        this.claimsDirty = true;
        break;
      }
      case 'equip': {
        if (!U || !this.isMil(U)) return '군사 유닛만 장착할 수 있습니다';
        const it = R.EQUIP[m.item]; if (!it) return '잘못된 장비';
        if (!(p.armory[m.item] > 0)) return '무기고에 장비가 없습니다';
        if (!R.canEquip(U.type, m.item)) return '이 유닛은 장착할 수 없습니다';
        if (this.tileOwner(U.pos) !== pid) return '내 영토 안에서만 장비를 바꿀 수 있습니다';
        U.eq = U.eq || {};
        const old = U.eq[it.slot];
        if (old) p.armory[old] = (p.armory[old] || 0) + 1;
        p.armory[m.item]--; U.eq[it.slot] = m.item;
        if (it.slot === 'mount' && !old) U.moves = Math.min(this.maxMoves(U), U.moves + it.mv);
        break;
      }
      case 'unequip': {
        if (!U || !U.eq || !U.eq[m.slot]) return '장착한 장비가 없습니다';
        if (this.tileOwner(U.pos) !== pid) return '내 영토 안에서만 장비를 바꿀 수 있습니다';
        p.armory[U.eq[m.slot]] = (p.armory[U.eq[m.slot]] || 0) + 1; delete U.eq[m.slot];
        U.moves = Math.min(U.moves, this.maxMoves(U));
        break;
      }
      case 'fortify': {
        const us = list && list.length ? list : U ? [U] : [];
        if (!us.length) return '유닛 없음';
        const val = !us.every(u => u.fort);
        for (const u of us) if (this.isMil(u)) { u.fort = val; u.skip = false; }
        break;
      }
      case 'skip': { const us = list && list.length ? list : U ? [U] : []; for (const u of us) u.skip = true; break; }
      case 'disband': if (!U) return '유닛 없음'; this.killUnit(U); this.checkElimination(pid); break;
      case 'prod': {
        if (!C) return '도시 없음';
        const k = m.kind, t = m.type;
        if (!['unit', 'building', 'process', 'equip'].includes(k)) return '잘못된 항목';
        if (k === 'unit' && !R.availUnits(p.techs).includes(t)) return '생산할 수 없는 유닛';
        if (k === 'building' && !R.availBuildings(p.techs, C.buildings).includes(t)) return '지을 수 없는 건물';
        if (k === 'equip' && !R.availEquip(p.techs).includes(t)) return '제작할 수 없는 장비';
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
        if (!R.hasRes(p.stock, this.itemRes(C.queue))) return `자원이 부족합니다: ${resText(this.itemRes(C.queue))}`;
        p.gold -= price; C.prod = this.itemCost(C.queue); C.boughtTurn = this.turn;
        this.completeProduction(C, p);
        break;
      }
      case 'research': {
        if (!R.availTechs(p.techs).includes(m.tech)) return '연구할 수 없는 기술';
        const need = R.TECHS[m.tech].res;
        if (need && !p.paid[m.tech]) {
          if (!R.hasRes(p.stock, need)) return `연구에 자원이 필요합니다: ${resText(need)}`;
          for (const k in need) p.stock[k] -= need[k];
          p.paid[m.tech] = 1;
          this.msg(pid, `[${R.TECHS[m.tech].name}] 연구에 ${resText(need)}을(를) 투입했습니다`);
        }
        p.researching = m.tech; break;
      }
      case 'cityShoot': {
        if (!C) return '도시 없음';
        if (C.shotTurn === this.turn) return '이번 턴에 이미 포격했습니다';
        if (R.dist(C.pos, m.to, this.W) > 2) return '사거리 밖입니다';
        if (!this.unitsAt(m.to).some(x => this.atWar(pid, x.owner))) return '포격할 적이 없습니다';
        this.cityShoot(C, m.to); near = [m.to]; break;
      }
      case 'market': { const e = this.trade(p, m.res, m.n, m.side === 'buy' ? 'buy' : 'sell'); if (e) return e; break; }
      case 'war': {
        const t = this.players[m.target];
        if (!t || t.id === pid || !t.alive || t.removed) return '대상 없음';
        if (!p.met[t.id]) return '아직 만나지 못한 문명입니다';
        if (this.atWar(pid, t.id)) return '이미 전쟁 중입니다';
        if (this.allied(pid, t.id)) return '동맹을 먼저 파기해야 합니다';
        if (this.protectedP(t.id)) return `상대는 신규 보호 중입니다 (${t.protectUntil}턴까지)`;
        if (this.protectedP(pid)) { p.protectUntil = this.turn; this.msg(pid, '선전포고로 신규 보호가 해제되었습니다'); }
        this.declareWar(pid, t.id); this.claimsDirty = true; break;
      }
      case 'cancelAlliance': {
        if (!this.allied(pid, m.target)) return '동맹이 아닙니다';
        this.cancelAlliance(pid, m.target); break;
      }
      case 'propose': { const e = this.propose(pid, m.to, m.offer || {}); if (e) return e; break; }
      case 'respond': { const e = this.respond(pid, m.prop, !!m.accept); if (e) return e; this.claimsDirty = true; break; }
      case 'cancelProp': { this.props = this.props.filter(x => !(x.id === m.prop && x.from === pid)); break; }
      case 'ready': p.ready = true; this.markAll(); this.checkEarlyTurn(); return null;
      case 'unready': p.ready = false; this.markAll(); return null;
      default: return '알 수 없는 행동';
    }
    if (this.claimsDirty) { this.refresh(); this.computeBorders(); this.markAll(); }
    else {
      this.refresh([...this.touched]);
      for (const id of this.touched) this.mark(id);
      for (const pos of near) this.markNear(pos);
    }
    return null;
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
    const need = this.itemRes(q);
    if (!R.hasRes(p.stock, need)) {
      if (c.stallTurn !== this.turn && (this.turn - (c.stallMsg || -99)) >= 5) { c.stallMsg = this.turn; this.msg(c.owner, `${c.name}: 자원 부족으로 생산이 멈췄습니다 (${resText(need)} 필요)`); }
      c.stallTurn = this.turn; return;
    }
    if (q.kind === 'unit') {
      if (q.type === 'settler' && c.pop < 2) return;
      for (const k in need || {}) p.stock[k] -= need[k];
      this.addUnit(c.owner, q.type, c.pos, c.buildings.includes('barracks'));
      this.msg(c.owner, `${c.name}: ${R.UNITS[q.type].name} 생산 완료`);
      c.prod -= cost;
      if (q.type === 'settler') { c.pop -= 1; c.queue = null; }
    } else if (q.kind === 'equip') {
      for (const k in need || {}) p.stock[k] -= need[k];
      p.armory[q.type] = (p.armory[q.type] || 0) + 1;
      this.msg(c.owner, `${c.name}: ${R.EQUIP[q.type].name} 제작 완료 (무기고 보관)`);
      c.prod -= cost; c.queue = null;
    } else {
      for (const k in need || {}) p.stock[k] -= need[k];
      c.buildings.push(q.type);
      if (R.BUILDINGS[q.type].hp) c.hp += R.BUILDINGS[q.type].hp;
      this.msg(c.owner, `${c.name}: ${R.BUILDINGS[q.type].name} 완공`);
      c.prod -= cost; c.queue = null;
    }
  }
  // 도시마다 시설 몇 곳만 가동 (인구에 비례): 1 + ceil(인구/2)
  stockIncome() {
    for (const p of this.players) { p.sgain = emptyStock(); p.coinGain = 0; }
    for (const c of this.cities.values()) {
      const p = this.players[c.owner]; if (!p || !p.alive) continue;
      const outs = [];
      for (const i of this.claimTiles.get(c.id) || []) {
        const code = this.imp[i]; if (!code) continue;
        const imp = R.IMP_BY_CODE[code], r = this.res[i];
        if (imp === 'lumber') outs.push({ k: 'wood', v: R.STOCK.wood.price });
        else if ((imp === 'mine' || imp === 'pasture') && r && R.impTechOk(this.terr[i], r, p.techs)) {
          if (R.RES[r].stock) outs.push({ k: R.RES[r].stock, v: R.STOCK[R.RES[r].stock].price });
          else if (R.RES[r].coin) outs.push({ k: 'coin', v: 9 });
        }
      }
      outs.sort((a, b) => b.v - a.v);
      for (const o of outs.slice(0, 1 + Math.ceil(c.pop / 2))) { if (o.k === 'coin') p.coinGain += 3; else p.sgain[o.k]++; }
    }
  }
  economy(p, occ) {
    let gpt = 0, spt = 0;
    for (const c of this.citiesOf(p.id)) {
      const y = this.cityYields(c, occ);
      gpt += y.gold; spt += y.sci;
      c.food += y.food - y.upkeep;
      const need = this.foodNeed(c.pop);
      if (c.food >= need) { c.food -= need; c.pop++; this.msg(p.id, `${c.name}의 인구가 ${c.pop}(으)로 늘었습니다`); }
      else if (c.food < 0) { if (c.pop > 1) { c.pop--; this.msg(p.id, `${c.name}이(가) 굶주려 인구가 줄었습니다`); } c.food = 0; }
      if (c.queue && c.queue.kind !== 'process') { c.prod += y.prod; this.completeProduction(c, p); }
      else if (!c.queue) c.prod += Math.floor(y.prod / 2);
      if (c.attackedTurn !== this.turn) c.hp = Math.min(this.cityMaxHp(c), c.hp + 20);
    }
    for (const k of STOCK_KEYS) p.stock[k] += p.sgain[k];
    gpt += p.coinGain || 0;
    const n = this.unitsOf(p.id).length, free = 3 + Math.floor(this.citiesOf(p.id).length * 1.5);
    gpt -= Math.max(0, n - free);
    for (const d of this.deals) { if (d.a === p.id) gpt += (d.bg.gpt || 0) - (d.ag.gpt || 0); if (d.b === p.id) gpt += (d.ag.gpt || 0) - (d.bg.gpt || 0); }
    p.gpt = gpt; p.spt = spt;
    p.gold += gpt;
    if (p.gold < 0) {
      const us = this.unitsOf(p.id).filter(u => this.isMil(u) && !u.inBattle);
      if (us.length) { const u = us[Math.floor(this.rnd() * us.length)]; this.killUnit(u); this.msg(p.id, `금이 부족해 ${R.UNITS[u.type].name}이(가) 해산되었습니다`); }
      p.gold = 0;
    }
    p.sciStore += spt;
    if (!p.researching && p.isAI) this.aiResearch(p);
    while (p.researching && p.sciStore >= this.techCost(p.researching)) {
      p.sciStore -= this.techCost(p.researching);
      p.techs[p.researching] = 1;
      this.msg(p.id, `기술 [${R.TECHS[p.researching].name}] 연구 완료!`);
      p.researching = null;
      if (p.isAI) this.aiResearch(p);
    }
  }
  dealGpt(pid) { let g = 0; for (const d of this.deals) { if (d.a === pid) g += (d.bg.gpt || 0) - (d.ag.gpt || 0); if (d.b === pid) g += (d.ag.gpt || 0) - (d.bg.gpt || 0); } return g; }
  processDeals() {
    // 금 이동은 economy의 gpt에 이미 반영. 여기서는 자원 이동과 만료 처리
    for (const d of [...this.deals]) {
      const A = this.players[d.a], B = this.players[d.b];
      if (!A || !B || !A.alive || !B.alive) { this.deals = this.deals.filter(x => x !== d); continue; }
      let broke = null;
      if (!R.hasRes(A.stock, d.ag.res) || A.gold < 0) broke = A; else if (!R.hasRes(B.stock, d.bg.res) || B.gold < 0) broke = B;
      if (broke) {
        const other = broke === A ? B : A;
        this.deals = this.deals.filter(x => x !== d);
        broke.trust = Math.max(0, (broke.trust == null ? 60 : broke.trust) - 8);
        this.addMod(other, broke.id, 'broken', -15);
        this.msgTo([A.id, B.id], `[${broke.name}]이(가) 교역 협정을 지키지 못해 협정이 파기되었습니다`);
        continue;
      }
      for (const k in d.ag.res) { A.stock[k] -= d.ag.res[k]; B.stock[k] += d.ag.res[k]; }
      for (const k in d.bg.res) { B.stock[k] -= d.bg.res[k]; A.stock[k] += d.bg.res[k]; }
      this.addMod(A, B.id, 'trade', 1); this.addMod(B, A.id, 'trade', 1);
      if (this.turn >= d.until) { this.deals = this.deals.filter(x => x !== d); this.msgTo([A.id, B.id], `[${A.name}]-[${B.name}] 교역 협정이 만료되었습니다`); }
    }
  }
  endTurn() {
    const t0 = Date.now();
    for (const b of [...this.battles.values()]) this.autoBattle(b);
    const occ = this.occMap();
    this.stockIncome();
    for (const p of this.alivePlayers()) this.economy(p, occ);
    this.processDeals();
    for (const u of this.units.values()) {
      if (u.work) {
        if (this.tileOwner(u.pos) !== u.owner) u.work = null;
        else if (--u.work.left <= 0) { this.imp[u.pos] = R.IMPS[u.work.imp].code; this.msg(u.owner, `${R.IMPS[u.work.imp].name} 완공`); u.work = null; }
      }
      if (!u.acted && u.hp < 100) {
        const inCity = this.cityAt.has(u.pos) && this.cityAt.get(u.pos).owner === u.owner;
        u.hp = Math.min(100, u.hp + (inCity ? 25 : this.tileOwner(u.pos) === u.owner ? 15 : 10));
      }
      u.moves = u.work ? 0 : this.maxMoves(u); u.attacked = false; u.acted = !!u.work; u.skip = false;
    }
    this.turn++;
    // 시장 회복, 호감도 감쇠, 신뢰 회복, 조약 만료
    for (const k of STOCK_KEYS) this.market.stock[k] += (MARKET_TARGET - this.market.stock[k]) * 0.06;
    for (const p of this.alivePlayers()) {
      for (const q in p.mods || {}) for (const k in p.mods[q]) {
        const v = p.mods[q][k], d = MOD_DECAY[k] || 0.5;
        p.mods[q][k] = Math.abs(v) <= d ? 0 : v - Math.sign(v) * d;
        if (!p.mods[q][k]) delete p.mods[q][k];
      }
      if ((p.trust == null ? 60 : p.trust) < 70) p.trust = (p.trust == null ? 60 : p.trust) + 0.25;
    }
    for (const [k, r] of Object.entries(this.rels)) {
      if (r.openUntil && r.openUntil === this.turn) { const [a, b] = k.split('_').map(Number); if (this.players[a] && this.players[b]) { this.expel(a, b); this.expel(b, a); this.msgTo([a, b], `[${this.nm(a)}]-[${this.nm(b)}] 국경 개방 조약이 만료되었습니다`); } }
    }
    this.props = this.props.filter(x => this.turn - x.turn <= 5);
    for (const p of this.alivePlayers()) { this.ensureCapital(p.id); p.ready = false; }
    this.refresh();
    this.computeBorders();
    this.touched = new Set(); this.claimsDirty = false;
    for (const p of this.alivePlayers()) if (p.isAI) { try { this.aiTurn(p); } catch (e) { console.error('AI error', e); } }
    for (const p of this.players) if (p.isAI && !p.alive && !p.removed && this.turn - (p.diedTurn || 0) > 3) p.removed = true;
    if (this.alivePlayers().filter(p => p.isAI).length < CFG.AI_COUNT && this.turn % 15 === 0) this.addAI();
    this.refresh();
    for (const p of this.players) p.score = this.score(p);
    this.turnStart = Date.now();
    this.markAll();
    this.lastTurnMs = Date.now() - t0;
    if (this.lastTurnMs > 400) console.log(`턴 ${this.turn} 처리 ${this.lastTurnMs}ms`);
  }
  score(p) {
    if (!p.alive || p.removed) return 0;
    const cs = this.citiesOf(p.id);
    return cs.length * 10 + cs.reduce((s, c) => s + c.pop * 4 + c.buildings.length * 2, 0) + Object.keys(p.techs).length * 6 +
      this.unitsOf(p.id).filter(u => this.isMil(u)).length;
  }
  tick() {
    for (const b of [...this.battles.values()]) if (!b.over && Date.now() > b.deadline) this.battleRound(b, 'auto');
    if (!this.online().length) { this.turnStart = Date.now(); return; }
    if (Date.now() - this.turnStart >= CFG.TURN_SECONDS * 1000) this.endTurn();
  }
  cleanupInactive() {
    const lim = CFG.INACTIVE_HOURS * 3600 * 1000;
    for (const p of this.players) {
      if (p.isAI || p.removed || p.ws) continue;
      if (Date.now() - (p.lastSeen || 0) > lim) { this.removeEmpire(p, '오랫동안 접속하지 않아 제국이 사라졌습니다'); this.msgAll(`[${p.name}] 제국이 역사 속으로 사라졌습니다 (장기 미접속)`); this.markAll(); }
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
    const p = this.players[pid], N = this.N;
    const fa = new Array(N), ia = new Array(N), ownerArr = new Array(N);
    for (let i = 0; i < N; i++) {
      fa[i] = p.visible[i] ? 2 : p.explored[i] ? 1 : 0;
      ownerArr[i] = p.explored[i] ? this.tileOwner(i) : -1;
      ia[i] = p.explored[i] && this.imp[i] ? this.imp[i] : '.';
    }
    const fog = fa.join(''), impStr = ia.join(''), ownerStr = ownerArr.join(',');
    const occ = this.occMap();
    const units = [];
    for (const u of this.units.values()) {
      if (u.owner !== pid && !p.visible[u.pos]) continue;
      const o = { id: u.id, o: u.owner, t: u.type, p: u.pos, hp: u.hp, mv: u.moves, mm: this.maxMoves(u), f: u.fort ? 1 : 0, a: u.attacked ? 1 : 0, v: u.vet ? 1 : 0, eq: u.eq || {}, b: u.inBattle ? 1 : 0 };
      if (u.owner === pid) { o.s = u.skip ? 1 : 0; if (u.work) o.w = u.work; if (u.harv === this.turn) o.h = 1; }
      units.push(o);
    }
    const cities = []; let spt = 0;
    for (const c of this.cities.values()) {
      if (c.owner !== pid && !p.explored[c.pos]) continue;
      const o = { id: c.id, o: c.owner, name: c.name, p: c.pos, pop: c.pop, hp: c.hp, mhp: this.cityMaxHp(c), str: this.cityStrength(c, occ), cap: c.capital ? 1 : 0 };
      if (c.owner === pid) {
        const y = this.cityYields(c, occ); spt += y.sci;
        Object.assign(o, { food: c.food, need: this.foodNeed(c.pop), prod: c.prod, q: c.queue, qc: this.itemCost(c.queue), y, b: c.buildings, shot: c.shotTurn === this.turn ? 1 : 0, buy: this.buyPrice(c), bought: c.boughtTurn === this.turn ? 1 : 0, stall: c.stallTurn === this.turn - 1 || c.stallTurn === this.turn ? 1 : 0 });
      }
      cities.push(o);
    }
    const myDeals = this.deals.filter(d => d.a === pid || d.b === pid);
    const st = {
      t: 'state', turn: this.turn, me: pid, speed: this.speed, left: Math.max(0, CFG.TURN_SECONDS * 1000 - (Date.now() - this.turnStart)), turnSec: CFG.TURN_SECONDS,
      players: this.players.map(q => {
        if (q.removed) return { id: q.id, removed: 1 };
        const o = { id: q.id, name: q.name, civ: q.civ, color: q.color, ai: q.isAI ? 1 : 0, alive: q.alive, ready: q.ready ? 1 : 0, score: q.score || 0,
          online: q.isAI || !!q.ws, cities: q.alive ? this.citiesOf(q.id).length : 0, techs: Object.keys(q.techs).length, met: p.met[q.id] ? 1 : 0,
          prot: !q.isAI && q.protectUntil > this.turn ? q.protectUntil : 0, trust: Math.round(q.trust == null ? 60 : q.trust) };
        if (q.id !== pid) {
          const r = this.rel(pid, q.id);
          Object.assign(o, { d: r.state, al: r.alliance ? 1 : 0, ob: r.openUntil > this.turn ? r.openUntil : 0, nap: r.napUntil > this.turn ? r.napUntil : 0,
            pu: r.peaceUntil > this.turn ? r.peaceUntil : 0, wt: r.warTurn, op: p.met[q.id] ? this.opinion(q.id, pid) : 0, mil: p.met[q.id] ? this.milPower(q.id) : 0 });
        }
        return o;
      }),
      my: { gold: p.gold, gpt: p.gpt, spt, sci: p.sciStore, techs: Object.keys(p.techs), paid: Object.keys(p.paid || {}), res: p.researching, rcost: p.researching ? this.techCost(p.researching) : 0,
        units: this.unitsOf(pid).length, free: 3 + Math.floor(this.citiesOf(pid).length * 1.5), alive: p.alive, mil: this.milPower(pid),
        stock: p.stock, sgain: p.sgain, armory: p.armory, trust: Math.round(p.trust == null ? 60 : p.trust),
        prot: p.protectUntil > this.turn ? p.protectUntil : 0, tcosts: Object.fromEntries(R.availTechs(p.techs).map(k => [k, this.techCost(k)])) },
      props: this.props.filter(x => x.to === pid || x.from === pid),
      deals: myDeals,
      market: Object.fromEntries(STOCK_KEYS.map(k => [k, { buy: this.buyPrice1(k), sell: this.sellPrice1(k), stock: Math.round(this.market.stock[k]) }])),
      battles: [...this.battles.values()].filter(b => b.att === pid || b.dOwners.includes(pid)).map(b => b.id),
      units, cities,
    };
    if (fog !== p.sentFog) { st.fog = fog; p.sentFog = fog; }
    if (ownerStr !== p.sentOwner) { st.owner = ownerArr; p.sentOwner = ownerStr; }
    if (impStr !== p.sentImp) { st.imp = impStr; p.sentImp = impStr; }
    return st;
  }
  mapMsg() { return { t: 'map', W: this.W, H: this.H, terr: this.terr, res: this.res }; }

  // ───────────────────────── AI ─────────────────────────
  milPower(id) { let s = 0; for (const u of this.units.values()) if (u.owner === id && this.isMil(u)) { const U = R.UNITS[u.type]; s += U.str + (U.rstr || 0) + this.eqAtk(u) + this.eqDef(u); } return s; }
  aiResearch(p) {
    const av = R.availTechs(p.techs);
    const prio = { bronze: -20, archery: -15, writing: -10, iron: -15, math: -10, pottery: -5, currency: -5, gunpowder: -30, education: -10, mining: -25, animal: -8 };
    av.sort((a, b) => (R.TECHS[a].cost + (prio[a] || 0)) - (R.TECHS[b].cost + (prio[b] || 0)));
    for (const k of av) {
      const need = R.TECHS[k].res;
      if (!need || p.paid[k]) { p.researching = k; return; }
      if (R.hasRes(p.stock, need)) { for (const r in need) p.stock[r] -= need[r]; p.paid[k] = 1; p.researching = k; return; }
    }
    // 필요한 자원을 시장에서 사 보기
    for (const k of av) {
      const need = R.TECHS[k].res; if (!need) continue;
      let ok = true;
      for (const r in need) { const lack = need[r] - p.stock[r]; if (lack > 0) { if (p.gold < this.buyPrice1(r) * lack + 40) { ok = false; break; } this.trade(p, r, lack, 'buy'); } }
      if (ok && R.hasRes(p.stock, need)) { for (const r in need) p.stock[r] -= need[r]; p.paid[k] = 1; p.researching = k; return; }
    }
  }
  aiAcceptPeace(ai, other) {
    if (this.rel(ai.id, other.id).warTurn + 8 > this.turn) return false;
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
  aiStepToward(u, field, occ) {
    const rr = this.reachFor(u, occ);
    let best = u.pos, bv = field[u.pos], bm = -1;
    for (const [i, rem] of rr) if (field[i] < bv - 0.01 || (Math.abs(field[i] - bv) < 0.01 && rem > bm && i !== u.pos)) { best = i; bv = field[i]; bm = rem; }
    if (best !== u.pos && bv < 1e8) {
      const from = u.pos; u.pos = best; u.moves = rr.get(best); u.acted = true; u.fort = false; u.work = null;
      if (occ) { const a = occ.get(from); if (a) occ.set(from, a.filter(x => x !== u)); if (!occ.get(best)) occ.set(best, []); occ.get(best).push(u); }
      return true;
    }
    return false;
  }
  aiSettleScore(pid, i) {
    if (this.canFound(pid, i)) return -1;
    let s = 0;
    for (const j of R.inRadius(i, 2, this.W, this.H)) {
      if (this.claim[j] >= 0) { s -= 1; continue; }
      const y = this.tileYield(j); s += y.food * 1.3 + y.prod + y.gold * 0.6;
      if (this.res[j] && R.RES[this.res[j]].stock) s += 2;
    }
    if (this.terr[i] === 'hills') s += 3;
    if (R.neighbors(i, this.W, this.H).some(n => this.terr[n] === 'ocean')) s += 2;
    return s;
  }
  aiDiplomacy(p, myCities) {
    const others = this.alivePlayers().filter(q => q.id !== p.id && p.met[q.id]);
    const atWarWith = others.filter(q => this.atWar(p.id, q.id));
    // 선전포고
    if (this.turn - p.joinTurn >= 25 && atWarWith.length === 0 && this.turn % 3 === 0 && myCities.length) {
      let tgt = null, td = 1e9;
      for (const c of this.cities.values()) {
        if (c.owner === p.id || !p.met[c.owner] || this.protectedP(c.owner) || this.allied(p.id, c.owner)) continue;
        const r = this.rel(p.id, c.owner);
        if (r.peaceTurn + 8 > this.turn) continue;
        const bound = r.peaceUntil > this.turn || r.napUntil > this.turn;
        const op = this.opinion(p.id, c.owner);
        if (bound && op > -40) continue;
        if (op > 20) continue;
        let d = 1e9; for (const m of myCities) d = Math.min(d, R.dist(m.pos, c.pos, this.W));
        if (d < td) { td = d; tgt = c.owner; }
      }
      if (tgt != null && td < 16 && this.milPower(p.id) > this.milPower(tgt) * 1.1 && this.rnd() < 0.35) this.declareWar(p.id, tgt);
    }
    // 평화 제안 / 동맹 / 국경 / 불가침
    for (const q of others) {
      const r = this.rel(p.id, q.id), op = this.opinion(p.id, q.id);
      const hasProp = this.props.some(x => x.from === p.id && x.to === q.id);
      if (r.state === 'war') {
        if (r.warTurn + 12 < this.turn && this.milPower(p.id) < this.milPower(q.id) * 0.75 && this.rnd() < 0.2) {
          if (q.isAI) { if (this.aiAcceptPeace(q, p)) this.makePeace(p.id, q.id); }
          else if (!hasProp) { this.props.push({ id: this.nextId++, kind: 'deal', from: p.id, to: q.id, o: { fg: { gold: Math.min(p.gold, 30), gpt: 0, res: {}, lump: {} }, tg: { gold: 0, gpt: 0, res: {}, lump: {} }, clauses: ['peace'] }, turn: this.turn }); this.msg(q.id, `[${p.name}](AI)이(가) 평화 협상을 제안했습니다`); this.mark(q.id); }
        }
        continue;
      }
      if (this.rnd() > 0.08) continue;
      if (q.isAI) {
        if (!r.alliance && op >= 40 && this.opinion(q.id, p.id) >= 40) { r.alliance = true; this.claimsDirty = true; this.msgMet([p.id, q.id], `[${p.name}]과(와) [${q.name}]이(가) 동맹을 맺었습니다`); }
        else if (r.openUntil <= this.turn && op >= 10 && this.opinion(q.id, p.id) >= 10) r.openUntil = this.turn + R.TREATY.OPEN;
        else if (r.napUntil <= this.turn && op >= 20 && this.opinion(q.id, p.id) >= 20) r.napUntil = this.turn + R.TREATY.NAP;
      } else if (!hasProp) {
        let clauses = null;
        if (!r.alliance && op >= 45) clauses = ['alliance'];
        else if (r.openUntil <= this.turn && op >= 15) clauses = ['open'];
        else if (r.napUntil <= this.turn && op >= 5) clauses = ['nap'];
        if (clauses) { this.props.push({ id: this.nextId++, kind: 'deal', from: p.id, to: q.id, o: { fg: { gold: 0, gpt: 0, res: {}, lump: {} }, tg: { gold: 0, gpt: 0, res: {}, lump: {} }, clauses }, turn: this.turn }); this.msg(q.id, `[${p.name}](AI)이(가) 외교 제안을 보냈습니다`); this.mark(q.id); }
        else {
          // 남는 자원 수출 제안
          const sur = STOCK_KEYS.find(k => p.stock[k] > 25);
          if (sur && op > -10) { this.props.push({ id: this.nextId++, kind: 'deal', from: p.id, to: q.id, o: { fg: { gold: 0, gpt: 0, res: { [sur]: 1 }, lump: {} }, tg: { gold: 0, gpt: Math.max(1, Math.round(this.mprice(sur) * 0.8)), res: {}, lump: {} }, clauses: [] }, turn: this.turn }); this.msg(q.id, `[${p.name}](AI)이(가) ${R.STOCK[sur].name} 수출을 제안했습니다`); this.mark(q.id); }
        }
      }
    }
  }
  aiTurn(p) {
    if (!p.researching) this.aiResearch(p);
    const myCities = this.citiesOf(p.id);
    this.aiDiplomacy(p, myCities);
    // 시장: 남는 것 수출
    for (const k of STOCK_KEYS) if (p.stock[k] > 30) this.trade(p, k, Math.min(10, p.stock[k] - 20), 'sell');
    const enemies = this.alivePlayers().filter(q => q.id !== p.id && this.atWar(p.id, q.id)).map(q => q.id);
    const myUnits = this.unitsOf(p.id);
    const settlers = myUnits.filter(u => u.type === 'settler').length + myCities.filter(c => c.queue && c.queue.type === 'settler').length;
    const workers = myUnits.filter(u => u.type === 'worker').length + myCities.filter(c => c.queue && c.queue.type === 'worker').length;
    const canU = k => R.hasRes(p.stock, R.UNITS[k].res);
    const avU = R.availUnits(p.techs).filter(k => !R.UNITS[k].civ && k !== 'scout');
    const avOk = avU.filter(canU);
    const bestMelee = avOk.filter(k => !R.UNITS[k].rstr).sort((a, b) => R.UNITS[b].str - R.UNITS[a].str)[0] || 'warrior';
    const bestRanged = avOk.filter(k => R.UNITS[k].rstr).sort((a, b) => R.UNITS[b].rstr - R.UNITS[a].rstr)[0];
    const mils = myUnits.filter(u => this.isMil(u) && u.type !== 'scout');
    const wantMil = myCities.length * (enemies.length ? 3 : 1.5) + 1;
    for (const c of myCities) {
      if (c.queue && c.queue.kind !== 'process' && c.stallTurn !== this.turn && !(c.queue.kind === 'unit' && c.queue.type !== 'settler' && mils.length >= wantMil + 2)) continue;
      let q;
      const hasGarrison = this.unitsAt(c.pos).some(u => u.owner === p.id && this.isMil(u));
      if (!hasGarrison && mils.length < wantMil + 2) q = { kind: 'unit', type: bestMelee };
      else if (workers < Math.min(myCities.length + 1, 5) && this.turn > 2) q = { kind: 'unit', type: 'worker' };
      else if (myCities.length + settlers < 5 && c.pop >= 2 && !enemies.length) q = { kind: 'unit', type: 'settler' };
      else if (mils.length < wantMil) {
        const nR = mils.filter(u => R.UNITS[u.type].rstr).length;
        let pick = bestRanged && nR < mils.length / 3 ? bestRanged : bestMelee;
        if (enemies.length && this.rnd() < 0.3) { const sg = avOk.filter(k => R.UNITS[k].siege).sort((a, b) => R.UNITS[b].rstr - R.UNITS[a].rstr)[0]; if (sg) pick = sg; }
        q = { kind: 'unit', type: pick };
      } else {
        const eq = R.availEquip(p.techs).filter(k => R.hasRes(p.stock, R.EQUIP[k].res));
        const armoryN = Object.values(p.armory).reduce((s, v) => s + v, 0);
        const avB = R.availBuildings(p.techs, c.buildings).filter(k => R.hasRes(p.stock, R.BUILDINGS[k].res)).sort((a, b) => R.BUILDINGS[a].cost - R.BUILDINGS[b].cost);
        if (eq.length && armoryN < 2 && mils.length > 3 && this.rnd() < 0.35) q = { kind: 'equip', type: eq.sort((a, b) => R.EQUIP[b].cost - R.EQUIP[a].cost)[0] };
        else if (avB.length) q = { kind: 'building', type: avB[0] };
        else q = { kind: 'process', type: this.rnd() < 0.5 ? 'wealth' : 'research' };
      }
      if (!c.queue || c.queue.kind !== q.kind) c.prod = Math.floor(c.prod * (c.queue ? 0.5 : 1));
      c.queue = q;
    }
    for (const c of myCities) {
      if (!c.queue || c.queue.kind === 'process' || !R.hasRes(p.stock, this.itemRes(c.queue))) continue;
      const price = this.buyPrice(c);
      if (p.gold > price + 80 && c.boughtTurn !== this.turn) { p.gold -= price; c.prod = this.itemCost(c.queue); c.boughtTurn = this.turn; this.completeProduction(c, p); }
    }
    // 장비 장착
    for (const u of myUnits) {
      if (!this.isMil(u) || !this.units.has(u.id) || this.tileOwner(u.pos) !== p.id) continue;
      for (const k of Object.keys(p.armory)) {
        if (!(p.armory[k] > 0) || !R.canEquip(u.type, k)) continue;
        const E = R.EQUIP[k], cur = u.eq && u.eq[E.slot] ? R.EQUIP[u.eq[E.slot]] : null;
        if (cur && (cur.atk || cur.def || cur.mv || 0) >= (E.atk || E.def || E.mv || 0)) continue;
        u.eq = u.eq || {}; if (u.eq[E.slot]) p.armory[u.eq[E.slot]] = (p.armory[u.eq[E.slot]] || 0) + 1;
        u.eq[E.slot] = k; p.armory[k]--;
      }
    }
    // 유닛
    const occ = this.occMap();
    const enemyCityPos = [...this.cities.values()].filter(c => enemies.includes(c.owner)).map(c => c.pos);
    const warField = enemyCityPos.length ? this.distField(enemyCityPos) : null;
    const homeField = myCities.length ? this.distField(myCities.map(c => c.pos)) : null;
    const unguarded = myCities.filter(c => !this.unitsAt(c.pos).some(x => x.owner === p.id && this.isMil(x)));
    const guardField = unguarded.length ? this.distField(unguarded.map(c => c.pos)) : null;
    let exploreField = null;
    const guardTaken = new Set();
    for (const u of myUnits) {
      if (!this.units.has(u.id) || u.inBattle) continue;
      const U = R.UNITS[u.type];
      if (u.type === 'settler') { this.aiSettler(p, u, occ); continue; }
      if (u.type === 'worker') { this.aiWorker(p, u, occ); continue; }
      const city = this.cityAt.get(u.pos);
      const isGuard = city && city.owner === p.id && !guardTaken.has(city.id);
      if (isGuard) guardTaken.add(city.id);
      for (let step = 0; step < 4 && this.units.has(u.id) && u.moves > 0 && !u.inBattle; step++) {
        // 포격
        if (U.rstr) { const bt = this.bombardTargets(u); if (bt.length) { this.bombard(u, bt[0]); break; } }
        // 근접 전투
        if (!U.rstr && !u.attacked) {
          const tg = this.battleTargets(p.id, u.pos);
          let best = null, bs = 0;
          const stack = (occ.get(u.pos) || []).filter(x => x.owner === p.id && this.isMil(x) && x.moves > 0 && !x.attacked && !x.inBattle && this.units.has(x.id));
          const myPow = stack.reduce((s, x) => s + this.atkPow(x), 0);
          for (const t of tg) {
            const c = this.cityAt.get(t);
            const ds = this.unitsAt(t).filter(x => x.owner !== p.id && this.isMil(x));
            let dPow = ds.reduce((s, x) => s + this.defPow(x, true), 0);
            if (c && c.owner !== p.id) dPow += this.cityStrength(c) * (c.hp / this.cityMaxHp(c)) * 1.5;
            if (!ds.length && !(c && c.owner !== p.id)) dPow = 1;
            const ratio = myPow / Math.max(1, dPow);
            if (ratio > bs) { bs = ratio; best = t; }
          }
          if (best != null && bs > 1.15) { this.startBattle(p.id, stack.map(x => x.id), best); break; }
        }
        if (isGuard && (enemies.length || this.turn < 60)) { u.fort = true; break; }
        if (u.hp < 45 && homeField) { if (!this.aiStepToward(u, homeField, occ)) { u.fort = true; break; } continue; }
        if (u.type === 'scout' || (!enemies.length && mils.length > myCities.length * 2 && u.id % 4 === 0)) {
          if (!exploreField) {
            const unk = []; for (let i = 0; i < this.N; i++) if (!p.explored[i] && R.TERRAIN[this.terr[i]].pass && i % 3 === 0) unk.push(i);
            exploreField = unk.length ? this.distField(unk, 25) : null;
          }
          if (exploreField && this.aiStepToward(u, exploreField, occ)) continue;
          if (u.type === 'scout') break;
        }
        if (warField && enemies.length && warField[u.pos] < 30) {
          if (U.rstr && warField[u.pos] <= U.range) break;
          if (this.aiStepToward(u, warField, occ)) continue;
          break;
        }
        if (guardField && !city && this.aiStepToward(u, guardField, occ)) continue;
        if (homeField && homeField[u.pos] > 3 && this.aiStepToward(u, homeField, occ)) continue;
        u.fort = true; break;
      }
    }
  }
  aiWorker(p, u, occ) {
    if (u.work) return;
    const ok = i => this.tileOwner(i) === p.id && !this.cityAt.has(i) && R.impFor(this.terr[i], this.res[i]) && !this.imp[i] && R.impTechOk(this.terr[i], this.res[i], p.techs)
      && !this.unitsOf(p.id).some(x => x !== u && x.type === 'worker' && (x.pos === i && x.work || x.aiT === i));
    if (ok(u.pos)) { const imp = R.impFor(this.terr[u.pos], this.res[u.pos]); u.work = { imp, left: R.IMPS[imp].turns }; u.moves = 0; u.aiT = null; return; }
    let target = u.aiT != null && ok(u.aiT) ? u.aiT : null;
    if (target == null) {
      let bd = 1e9;
      for (const c of this.citiesOf(p.id)) for (const i of this.claimTiles.get(c.id) || []) {
        if (!ok(i)) continue;
        const pri = this.res[i] && R.RES[this.res[i]].stock ? 0 : 3;
        const d = R.dist(u.pos, i, this.W) + pri;
        if (d < bd) { bd = d; target = i; }
      }
    }
    if (target == null) { if (this.res[u.pos] && R.RES[this.res[u.pos]].stock && R.impTechOk(this.terr[u.pos], this.res[u.pos], p.techs) && this.tileOwner(u.pos) === p.id && u.harv !== this.turn) { p.stock[R.RES[this.res[u.pos]].stock]++; u.harv = this.turn; u.moves = 0; } return; }
    u.aiT = target;
    this.aiStepToward(u, this.distField([target], 20), occ);
    if (u.pos === target && ok(u.pos)) { const imp = R.impFor(this.terr[u.pos], this.res[u.pos]); u.work = { imp, left: R.IMPS[imp].turns }; u.moves = 0; u.aiT = null; }
  }
  aiSettler(p, u, occ) {
    for (let step = 0; step < 4 && u.moves > 0; step++) {
      const here = this.aiSettleScore(p.id, u.pos);
      let best = u.pos, bs = here;
      for (const j of R.inRadius(u.pos, 6, this.W, this.H)) {
        const s = this.aiSettleScore(p.id, j); if (s < 0) continue;
        const v = s - R.dist(u.pos, j, this.W) * 1.5;
        if (v > bs + 0.5) { bs = v; best = j; }
      }
      if (best === u.pos) {
        if (here >= 0) { this.foundCity(p.id, u.pos); this.killUnit(u); this.claimsDirty = true; this.computeClaims(); return; }
        const rr = this.reachFor(u, occ), keys = [...rr.keys()];
        if (!keys.length) return;
        const t = keys[Math.floor(this.rnd() * keys.length)]; u.moves = rr.get(t); u.pos = t; continue;
      }
      if (!this.aiStepToward(u, this.distField([best], 15), occ)) { if (here >= 0) { this.foundCity(p.id, u.pos); this.killUnit(u); this.computeClaims(); } return; }
      if (u.pos === best && this.aiSettleScore(p.id, u.pos) >= 0) { this.foundCity(p.id, u.pos); this.killUnit(u); this.computeClaims(); return; }
    }
  }
}

// ───────────────────────── 서버 ─────────────────────────
let world = null;
function loadWorld() {
  try {
    if (fs.existsSync(SAVE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
      if (data.v !== 2) { console.log('이전 버전 저장 파일이라 새 세계를 만듭니다'); return new World(null); }
      const w = new World(data);
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
      chatMsg('공지', `${p.name}님이 새 문명으로 입장했습니다`);
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

function boot(w) {
  world = w || loadWorld();
  setInterval(() => { try { world.tick(); world.flush(); } catch (e) { console.error(e); } }, 150);
  setInterval(() => { for (const p of world.players) if (p.ws) p.ws.ping(); }, 25000);
  setInterval(saveWorld, 60000);
  setInterval(() => world.cleanupInactive(), 10 * 60 * 1000);
  const bye = () => { saveWorld(); process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
  server.listen(PORT, () => console.log(`문명 전쟁 월드 서버: http://localhost:${PORT} (턴 ${CFG.TURN_SECONDS}초, 맵 ${world.W}x${world.H})`));
  return world;
}
if (require.main === module) boot();
module.exports = { World, genMap, CFG, boot };
