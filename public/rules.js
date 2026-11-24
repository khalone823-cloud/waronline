// 공유 규칙 (서버와 브라우저가 같이 사용)
(function (root) {
  const TERRAIN = {
    ocean:    { name: '바다',   food: 1, prod: 0, gold: 1, move: 1, pass: false, def: 0,   color: '#1f4f86' },
    grass:    { name: '초원',   food: 2, prod: 0, gold: 0, move: 1, pass: true,  def: 0,   color: '#5d9c3c' },
    plains:   { name: '평원',   food: 1, prod: 1, gold: 0, move: 1, pass: true,  def: 0,   color: '#a7ad4c' },
    forest:   { name: '숲',     food: 1, prod: 2, gold: 0, move: 2, pass: true,  def: 25,  color: '#2f6a2c' },
    hills:    { name: '언덕',   food: 0, prod: 2, gold: 0, move: 2, pass: true,  def: 25,  color: '#8e7a4b' },
    mountain: { name: '산',     food: 0, prod: 0, gold: 0, move: 9, pass: false, def: 0,   color: '#7a7a80' },
    desert:   { name: '사막',   food: 0, prod: 1, gold: 0, move: 1, pass: true,  def: -10, color: '#d8c27c' },
    tundra:   { name: '툰드라', food: 1, prod: 0, gold: 0, move: 1, pass: true,  def: 0,   color: '#98a597' },
  };

  // 비축 자원 (창고에 쌓이고 거래·생산에 쓰임)
  const STOCK = {
    wood:      { name: '목재', price: 4,  color: '#b07a45' },
    stone:     { name: '석재', price: 5,  color: '#a8a29e' },
    copper:    { name: '구리', price: 8,  color: '#e0894a' },
    horse:     { name: '말',   price: 10, color: '#c9a27a' },
    iron:      { name: '철',   price: 12, color: '#9fb3c8' },
    coal:      { name: '석탄', price: 14, color: '#55555f' },
    saltpeter: { name: '초석', price: 16, color: '#e8e4d8' },
  };

  // 지도 위 매장 자원
  const RES = {
    wheat:     { name: '밀',     food: 2, prod: 0, gold: 0, imp: 'farm' },
    fish:      { name: '물고기', food: 2, prod: 0, gold: 0 },
    horse:     { name: '말',     food: 1, prod: 0, gold: 0, imp: 'pasture', stock: 'horse', tech: 'animal' },
    copper:    { name: '구리',   food: 0, prod: 1, gold: 1, imp: 'mine', stock: 'copper', tech: 'mining' },
    stone:     { name: '석재',   food: 0, prod: 1, gold: 0, imp: 'mine', stock: 'stone', tech: 'mining' },
    gold:      { name: '금',     food: 0, prod: 0, gold: 2, imp: 'mine', coin: 3, tech: 'mining' },
    iron:      { name: '철',     food: 0, prod: 1, gold: 0, imp: 'mine', stock: 'iron', tech: 'bronze' },
    saltpeter: { name: '초석',   food: 0, prod: 1, gold: 0, imp: 'mine', stock: 'saltpeter', tech: 'machinery' },
    coal:      { name: '석탄',   food: 0, prod: 2, gold: 0, imp: 'mine', stock: 'coal', tech: 'gunpowder' },
  };

  // 일꾼이 짓는 시설
  const IMPS = {
    mine:    { name: '광산',   code: 'm', turns: 3, prod: 1 },
    pasture: { name: '목장',   code: 'p', turns: 3, food: 1 },
    lumber:  { name: '벌목장', code: 'l', turns: 3, prod: 1 },
    farm:    { name: '농장',   code: 'f', turns: 3, food: 1 },
  };
  const IMP_BY_CODE = { m: 'mine', p: 'pasture', l: 'lumber', f: 'farm' };

  // str: 근접, rstr: 원거리, res: 생산 시 필요 자원, obs: 이 기술이 있으면 목록에서 사라짐
  const UNITS = {
    settler:   { name: '개척자',   cost: 55,  str: 0,  moves: 2, civ: true, desc: '새 도시를 건설합니다' },
    worker:    { name: '일꾼',     cost: 35,  str: 0,  moves: 2, civ: true, worker: true, desc: '시설을 짓고 자원을 채집합니다' },
    scout:     { name: '정찰병',   cost: 22,  str: 4,  moves: 3, sight: 3, desc: '빠르고 멀리 봅니다' },
    warrior:   { name: '전사',     cost: 30,  str: 8,  moves: 2, obs: 'iron' },
    archer:    { name: '궁수',     cost: 40,  str: 5,  rstr: 8,  range: 2, moves: 2, tech: 'archery', obs: 'machinery', res: { wood: 1 } },
    spearman:  { name: '창병',     cost: 45,  str: 11, moves: 2, tech: 'bronze', anti: true, obs: 'gunpowder', res: { copper: 1 }, desc: '기마 상대 +50%' },
    horseman:  { name: '기마병',   cost: 60,  str: 12, moves: 4, mounted: true, tech: 'horseback', obs: 'chivalry', res: { horse: 1 } },
    swordsman: { name: '검사',     cost: 70,  str: 15, moves: 2, tech: 'iron', obs: 'gunpowder', res: { iron: 1 } },
    catapult:  { name: '투석기',   cost: 85,  str: 6,  rstr: 14, range: 2, moves: 2, siege: true, tech: 'math', obs: 'metallurgy', res: { wood: 2, stone: 1 }, desc: '도시 공격 2배' },
    knight:    { name: '기사',     cost: 110, str: 20, moves: 4, mounted: true, tech: 'chivalry', obs: 'military', res: { horse: 1, iron: 1 } },
    crossbow:  { name: '석궁병',   cost: 110, str: 10, rstr: 18, range: 2, moves: 2, tech: 'machinery', obs: 'rifling', res: { wood: 1, iron: 1 } },
    musketman: { name: '머스킷병', cost: 140, str: 26, moves: 2, tech: 'gunpowder', obs: 'rifling', res: { saltpeter: 1, iron: 1 } },
    cannon:    { name: '대포',     cost: 160, str: 10, rstr: 26, range: 2, moves: 2, siege: true, tech: 'metallurgy', obs: 'dynamite', res: { iron: 2, coal: 1, saltpeter: 1 }, desc: '도시 공격 2배' },
    cavalry:   { name: '기병대',   cost: 170, str: 30, moves: 4, mounted: true, tech: 'military', res: { horse: 1, saltpeter: 1 } },
    rifleman:  { name: '소총병',   cost: 200, str: 36, moves: 2, tech: 'rifling', res: { iron: 1, saltpeter: 1, coal: 1 } },
    artillery: { name: '야포',     cost: 240, str: 14, rstr: 36, range: 3, moves: 2, siege: true, tech: 'dynamite', res: { iron: 2, coal: 2, saltpeter: 1 }, desc: '사거리 3, 도시 공격 2배' },
  };

  // 제작 장비 (도시에서 만들어 무기고에 보관 → 유닛에 장착)
  const EQUIP = {
    bronze_w: { name: '청동 무기', slot: 'weapon', atk: 2, cost: 20, res: { copper: 2 }, tech: 'bronze' },
    iron_w:   { name: '철제 무기', slot: 'weapon', atk: 4, cost: 30, res: { iron: 2 }, tech: 'iron' },
    steel_w:  { name: '강철 무기', slot: 'weapon', atk: 7, cost: 45, res: { iron: 2, coal: 2 }, tech: 'metallurgy' },
    leather_a:{ name: '가죽 갑옷', slot: 'armor', def: 2, cost: 20, res: { horse: 1, wood: 1 }, tech: 'animal' },
    chain_a:  { name: '사슬 갑옷', slot: 'armor', def: 4, cost: 35, res: { iron: 2 }, tech: 'iron' },
    plate_a:  { name: '판금 갑옷', slot: 'armor', def: 7, cost: 50, res: { iron: 3, coal: 1 }, tech: 'metallurgy' },
    warhorse: { name: '군마',      slot: 'mount', mv: 1, cost: 30, res: { horse: 2 }, tech: 'horseback' },
  };
  const SLOTS = { weapon: '무기', armor: '갑옷', mount: '탈것' };

  const TECHS = {
    agriculture:  { name: '농업',       cost: 0,   req: [] },
    pottery:      { name: '도기',       cost: 30,  req: ['agriculture'] },
    animal:       { name: '목축',       cost: 30,  req: ['agriculture'], desc: '말 목장' },
    archery:      { name: '궁술',       cost: 30,  req: ['agriculture'] },
    mining:       { name: '채광',       cost: 30,  req: ['agriculture'], desc: '구리·석재·금 광산' },
    bronze:       { name: '청동기',     cost: 55,  req: ['mining'], res: { copper: 3 }, desc: '철 광산' },
    horseback:    { name: '기마술',     cost: 55,  req: ['animal'], res: { horse: 2 } },
    writing:      { name: '문자',       cost: 55,  req: ['pottery'] },
    masonry:      { name: '석공술',     cost: 55,  req: ['mining'], res: { stone: 2 } },
    currency:     { name: '화폐',       cost: 90,  req: ['bronze'] },
    iron:         { name: '철기',       cost: 100, req: ['bronze'], res: { iron: 3 } },
    math:         { name: '수학',       cost: 100, req: ['writing', 'archery'] },
    construction: { name: '건축',       cost: 120, req: ['masonry', 'math'], res: { stone: 5, wood: 5 } },
    chivalry:     { name: '기사도',     cost: 160, req: ['horseback', 'iron'], res: { horse: 3, iron: 2 } },
    machinery:    { name: '기계',       cost: 160, req: ['math', 'iron'], res: { wood: 4, iron: 2 }, desc: '초석 광산' },
    education:    { name: '교육',       cost: 180, req: ['writing', 'currency'] },
    banking:      { name: '은행업',     cost: 220, req: ['currency', 'education'] },
    gunpowder:    { name: '화약',       cost: 250, req: ['machinery', 'education'], res: { saltpeter: 4 }, desc: '석탄 광산' },
    metallurgy:   { name: '야금술',     cost: 300, req: ['gunpowder'], res: { coal: 4, iron: 4 } },
    military:     { name: '군사학',     cost: 330, req: ['chivalry', 'metallurgy'], res: { horse: 4 } },
    rifling:      { name: '강선',       cost: 380, req: ['metallurgy'], res: { iron: 4, saltpeter: 4 } },
    industry:     { name: '산업화',     cost: 420, req: ['banking', 'metallurgy'], res: { coal: 8, iron: 8 } },
    dynamite:     { name: '다이너마이트', cost: 460, req: ['rifling', 'industry'], res: { saltpeter: 6, coal: 6 } },
  };

  const BUILDINGS = {
    monument:   { name: '기념비',   cost: 40,  res: { stone: 2 }, desc: '영토 반경 +1, 금 +1', gold: 1 },
    granary:    { name: '곡물창고', cost: 55,  res: { wood: 2 }, tech: 'pottery', desc: '식량 +2', food: 2 },
    barracks:   { name: '병영',     cost: 60,  res: { wood: 3 }, tech: 'bronze', desc: '생산 유닛 전투력 +15%' },
    library:    { name: '도서관',   cost: 70,  res: { wood: 2 }, tech: 'writing', desc: '과학 +3', sci: 3 },
    walls:      { name: '성벽',     cost: 70,  res: { stone: 4 }, tech: 'masonry', desc: '방어 +8, 체력 +50', def: 8, hp: 50 },
    market:     { name: '시장',     cost: 90,  res: { wood: 2 }, tech: 'currency', desc: '금 +3', gold: 3 },
    workshop:   { name: '작업장',   cost: 100, res: { wood: 3, stone: 2 }, tech: 'construction', desc: '생산 +3', prod: 3 },
    castle:     { name: '성',       cost: 150, res: { stone: 8 }, tech: 'chivalry', req: 'walls', desc: '방어 +10, 체력 +50', def: 10, hp: 50 },
    university: { name: '대학',     cost: 150, res: { stone: 4 }, tech: 'education', req: 'library', desc: '과학 +5', sci: 5 },
    bank:       { name: '은행',     cost: 180, res: { stone: 4 }, tech: 'banking', req: 'market', desc: '금 +5', gold: 5 },
    factory:    { name: '공장',     cost: 250, res: { iron: 6, coal: 4 }, tech: 'industry', req: 'workshop', desc: '생산 +6', prod: 6 },
  };

  const PROCESSES = {
    wealth:   { name: '부 축적',   desc: '생산력 절반을 금으로' },
    research: { name: '연구 지원', desc: '생산력 절반을 과학으로' },
  };

  // 전투 전술 (가위바위보: 돌격 > 사격 > 방진 > 돌격)
  const TACTICS = {
    charge: { name: '돌격', beats: 'volley', desc: '근접·기마 피해 증가. 사격에 강하고 방진에 약함' },
    volley: { name: '사격', beats: 'shield', desc: '원거리 피해 크게 증가. 방진에 강하고 돌격에 약함' },
    shield: { name: '방진', beats: 'charge', desc: '받는 피해 감소. 돌격에 강하고 사격에 약함' },
  };

  const CIVS = [
    { name: '고려',   leader: '왕건',       color: '#e23b3b', cities: ['개경', '서경', '동경', '남경', '한양', '전주', '상주', '청주', '나주', '강릉', '경주', '철원'] },
    { name: '로마',   leader: '카이사르',   color: '#8b5cf6', cities: ['로마', '안티움', '쿠마이', '네아폴리스', '라벤나', '아퀼레이아', '밀라노', '베로나', '피사', '제노바'] },
    { name: '몽골',   leader: '칭기즈 칸',  color: '#0ea5e9', cities: ['카라코룸', '베쉬발릭', '코브도', '울리아스타이', '다르한', '바얀홍고르', '하라호린', '초이발산'] },
    { name: '이집트', leader: '람세스',     color: '#eab308', cities: ['테베', '멤피스', '헬리오폴리스', '기자', '아비도스', '알렉산드리아', '아스완', '룩소르'] },
    { name: '잉글랜드', leader: '엘리자베스', color: '#f97316', cities: ['런던', '요크', '노팅엄', '햄프턴', '캔터베리', '코번트리', '옥스퍼드', '리버풀'] },
    { name: '일본',   leader: '오다 노부나가', color: '#f1f5f9', cities: ['교토', '오사카', '에도', '나라', '가마쿠라', '나고야', '사카이', '히로시마'] },
    { name: '아즈텍', leader: '몬테수마',   color: '#22c55e', cities: ['테노치티틀란', '텍스코코', '틀라코판', '틀락스칼라', '촐룰라', '쿠에르나바카', '톨루카'] },
    { name: '그리스', leader: '페리클레스', color: '#ec4899', cities: ['아테네', '스파르타', '코린트', '아르고스', '테베', '델포이', '올림피아', '로도스'] },
  ];

  const SPEEDS = { fast: { name: '빠름', mult: 0.55 }, normal: { name: '보통', mult: 0.85 }, slow: { name: '느림', mult: 1.25 } };
  const TREATY = { PEACE: 10, NAP: 20, OPEN: 20, DEAL: 10 };

  // ── 육각 좌표 (pointy-top, odd-r offset) ──
  const DIR_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  const DIR_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
  function neighbors(i, W, H) {
    const x = i % W, y = (i / W) | 0, dirs = (y & 1) ? DIR_ODD : DIR_EVEN, out = [];
    for (const [dx, dy] of dirs) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(ny * W + nx); }
    return out;
  }
  function cube(x, y) { const q = x - (y - (y & 1)) / 2; return [q, y, -q - y]; }
  function dist(a, b, W) {
    const [aq, ar, as] = cube(a % W, (a / W) | 0), [bq, br, bs] = cube(b % W, (b / W) | 0);
    return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
  }
  function inRadius(i, r, W, H) {
    const x = i % W, y = (i / W) | 0, out = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (dist(i, j, W) <= r) out.push(j);
    }
    return out;
  }
  // 남은 이동력이 조금이라도 있으면 비용이 커도 진입 가능 (문명 방식)
  function reach(W, H, terr, start, moves, canEnter, canEnd) {
    const best = new Map([[start, moves]]), open = [[moves, start]];
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] > open[bi][0]) bi = k;
      const [rem, i] = open.splice(bi, 1)[0];
      if (rem < best.get(i) || rem <= 0) continue;
      for (const n of neighbors(i, W, H)) {
        const t = TERRAIN[terr[n]];
        if (!t.pass || !canEnter(n)) continue;
        const nr = Math.max(0, rem - t.move);
        if (!best.has(n) || best.get(n) < nr) { best.set(n, nr); open.push([nr, n]); }
      }
    }
    const out = new Map();
    for (const [i, r] of best) if (i !== start && canEnd(i)) out.set(i, r);
    return out;
  }
  // 이 칸에 지을 수 있는 시설 (기술 무시)
  function impFor(terr, res) {
    if (res && RES[res].imp) return RES[res].imp;
    if (res) return null;
    if (terr === 'forest') return 'lumber';
    if (terr === 'grass' || terr === 'plains') return 'farm';
    if (terr === 'hills') return 'mine';
    return null;
  }
  function impTechOk(terr, res, techs) {
    if (res && RES[res].tech) return !!techs[RES[res].tech];
    if (!res && terr === 'hills') return !!techs.mining;
    return true;
  }
  function hasRes(stock, need) { if (!need) return true; for (const k in need) if ((stock[k] || 0) < need[k]) return false; return true; }
  function availUnits(techs) { return Object.keys(UNITS).filter(k => { const u = UNITS[k]; return (!u.tech || techs[u.tech]) && !(u.obs && techs[u.obs]); }); }
  function availBuildings(techs, built) { return Object.keys(BUILDINGS).filter(k => { const b = BUILDINGS[k]; return !built.includes(k) && (!b.tech || techs[b.tech]) && (!b.req || built.includes(b.req)); }); }
  function availEquip(techs) { return Object.keys(EQUIP).filter(k => !EQUIP[k].tech || techs[EQUIP[k].tech]); }
  function availTechs(techs) { return Object.keys(TECHS).filter(k => !techs[k] && TECHS[k].req.every(r => techs[r])); }
  function canEquip(unitType, item) {
    const U = UNITS[unitType], E = EQUIP[item];
    if (!U || !E || U.civ) return false;
    if (E.slot === 'mount') return !U.mounted && !U.siege;
    return true;
  }

  const R = { TERRAIN, STOCK, RES, IMPS, IMP_BY_CODE, UNITS, EQUIP, SLOTS, TECHS, BUILDINGS, PROCESSES, TACTICS, CIVS, SPEEDS, TREATY,
    neighbors, dist, inRadius, reach, impFor, impTechOk, hasRes, availUnits, availBuildings, availEquip, availTechs, canEquip };
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
  else root.RULES = R;
})(this);
