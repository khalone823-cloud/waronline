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

  const RES = {
    wheat: { name: '밀',   icon: '🌾', food: 2, prod: 0, gold: 0 },
    horse: { name: '말',   icon: '🐎', food: 1, prod: 1, gold: 0 },
    iron:  { name: '철',   icon: '⛏️', food: 0, prod: 2, gold: 0 },
    gold:  { name: '금',   icon: '💰', food: 0, prod: 0, gold: 3 },
    fish:  { name: '물고기', icon: '🐟', food: 2, prod: 0, gold: 0 },
  };

  // str: 근접 전투력, rstr: 원거리 전투력, obs: 이 기술을 알면 생산 목록에서 사라짐
  const UNITS = {
    settler:   { name: '개척자',   cost: 55,  str: 0,  moves: 2, civ: true, icon: '🏕️', desc: '새 도시를 건설합니다' },
    scout:     { name: '정찰병',   cost: 22,  str: 4,  moves: 3, sight: 3, icon: '🔭', desc: '빠르고 멀리 봅니다' },
    warrior:   { name: '전사',     cost: 30,  str: 8,  moves: 2, obs: 'iron', icon: '🪓' },
    archer:    { name: '궁수',     cost: 40,  str: 5,  rstr: 8,  range: 2, moves: 2, tech: 'archery', obs: 'machinery', icon: '🏹' },
    spearman:  { name: '창병',     cost: 45,  str: 11, moves: 2, tech: 'bronze', anti: true, obs: 'gunpowder', icon: '🔱', desc: '기마 유닛 상대 +50%' },
    horseman:  { name: '기마병',   cost: 60,  str: 12, moves: 4, mounted: true, tech: 'horseback', obs: 'chivalry', icon: '🐴' },
    swordsman: { name: '검사',     cost: 70,  str: 15, moves: 2, tech: 'iron', obs: 'gunpowder', icon: '⚔️' },
    catapult:  { name: '투석기',   cost: 85,  str: 6,  rstr: 14, range: 2, moves: 2, siege: true, tech: 'math', obs: 'metallurgy', icon: '☄️', desc: '도시 공격 +100%' },
    knight:    { name: '기사',     cost: 110, str: 20, moves: 4, mounted: true, tech: 'chivalry', obs: 'military', icon: '🛡️' },
    crossbow:  { name: '석궁병',   cost: 110, str: 10, rstr: 18, range: 2, moves: 2, tech: 'machinery', obs: 'rifling', icon: '🎯' },
    musketman: { name: '머스킷병', cost: 140, str: 26, moves: 2, tech: 'gunpowder', obs: 'rifling', icon: '💂' },
    cannon:    { name: '대포',     cost: 160, str: 10, rstr: 26, range: 2, moves: 2, siege: true, tech: 'metallurgy', obs: 'dynamite', icon: '💣', desc: '도시 공격 +100%' },
    cavalry:   { name: '기병대',   cost: 170, str: 30, moves: 4, mounted: true, tech: 'military', icon: '🏇' },
    rifleman:  { name: '소총병',   cost: 200, str: 36, moves: 2, tech: 'rifling', icon: '🎖️' },
    artillery: { name: '야포',     cost: 240, str: 14, rstr: 36, range: 3, moves: 2, siege: true, tech: 'dynamite', icon: '🧨', desc: '사거리 3, 도시 공격 +100%' },
  };

  const TECHS = {
    agriculture:  { name: '농업',       cost: 0,   req: [] },
    pottery:      { name: '도기',       cost: 30,  req: ['agriculture'] },
    animal:       { name: '목축',       cost: 30,  req: ['agriculture'] },
    archery:      { name: '궁술',       cost: 30,  req: ['agriculture'] },
    mining:       { name: '채광',       cost: 30,  req: ['agriculture'] },
    bronze:       { name: '청동기',     cost: 55,  req: ['mining'] },
    horseback:    { name: '기마술',     cost: 55,  req: ['animal'] },
    writing:      { name: '문자',       cost: 55,  req: ['pottery'] },
    masonry:      { name: '석공술',     cost: 55,  req: ['mining'] },
    currency:     { name: '화폐',       cost: 90,  req: ['bronze'] },
    iron:         { name: '철기',       cost: 100, req: ['bronze'] },
    math:         { name: '수학',       cost: 100, req: ['writing', 'archery'] },
    construction: { name: '건축',       cost: 120, req: ['masonry', 'math'] },
    chivalry:     { name: '기사도',     cost: 160, req: ['horseback', 'iron'] },
    machinery:    { name: '기계',       cost: 160, req: ['math', 'iron'] },
    education:    { name: '교육',       cost: 180, req: ['writing', 'currency'] },
    banking:      { name: '은행업',     cost: 220, req: ['currency', 'education'] },
    gunpowder:    { name: '화약',       cost: 250, req: ['machinery', 'education'] },
    metallurgy:   { name: '야금술',     cost: 300, req: ['gunpowder'] },
    military:     { name: '군사학',     cost: 330, req: ['chivalry', 'metallurgy'] },
    rifling:      { name: '강선',       cost: 380, req: ['metallurgy'] },
    industry:     { name: '산업화',     cost: 420, req: ['banking', 'metallurgy'] },
    dynamite:     { name: '다이너마이트', cost: 460, req: ['rifling', 'industry'] },
  };

  const BUILDINGS = {
    monument:   { name: '기념비',   cost: 40,  icon: '🗿', desc: '영토 반경 +1, 금 +1', gold: 1 },
    granary:    { name: '곡물창고', cost: 55,  icon: '🏚️', tech: 'pottery', desc: '식량 +2', food: 2 },
    barracks:   { name: '병영',     cost: 60,  icon: '🏕', tech: 'bronze', desc: '이 도시 유닛 전투력 +15%' },
    library:    { name: '도서관',   cost: 70,  icon: '📚', tech: 'writing', desc: '과학 +3', sci: 3 },
    walls:      { name: '성벽',     cost: 70,  icon: '🧱', tech: 'masonry', desc: '도시 방어 +8, 체력 +50', def: 8, hp: 50 },
    market:     { name: '시장',     cost: 90,  icon: '🏪', tech: 'currency', desc: '금 +3', gold: 3 },
    workshop:   { name: '작업장',   cost: 100, icon: '🔨', tech: 'construction', desc: '생산 +3', prod: 3 },
    castle:     { name: '성',       cost: 150, icon: '🏰', tech: 'chivalry', req: 'walls', desc: '도시 방어 +10, 체력 +50', def: 10, hp: 50 },
    university: { name: '대학',     cost: 150, icon: '🎓', tech: 'education', req: 'library', desc: '과학 +5', sci: 5 },
    bank:       { name: '은행',     cost: 180, icon: '🏦', tech: 'banking', req: 'market', desc: '금 +5', gold: 5 },
    factory:    { name: '공장',     cost: 250, icon: '🏭', tech: 'industry', req: 'workshop', desc: '생산 +6', prod: 6 },
  };

  const PROCESSES = {
    wealth:   { name: '부 축적', icon: '🪙', desc: '생산력의 절반을 금으로' },
    research: { name: '연구 지원', icon: '🔬', desc: '생산력의 절반을 과학으로' },
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

  const SPEEDS = {
    fast:   { name: '빠름', mult: 0.55 },
    normal: { name: '보통', mult: 0.85 },
    slow:   { name: '느림', mult: 1.25 },
  };

  const MAPSIZES = {
    small:  { name: '작음 (2~3명)', w: 30, h: 20 },
    medium: { name: '보통 (4~5명)', w: 40, h: 26 },
    large:  { name: '큼 (6~8명)',   w: 50, h: 32 },
  };

  // ── 육각 좌표 (pointy-top, odd-r offset) ──
  const DIR_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  const DIR_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
  function neighbors(i, W, H) {
    const x = i % W, y = (i / W) | 0;
    const dirs = (y & 1) ? DIR_ODD : DIR_EVEN;
    const out = [];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(ny * W + nx);
    }
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

  // 이동 가능 범위 계산: 남은 이동력이 조금이라도 있으면 비용이 커도 진입 가능 (문명 방식)
  function reach(W, H, terr, start, moves, canEnter, canEnd) {
    const best = new Map([[start, moves]]);
    const open = [[moves, start]];
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

  function availUnits(techs) {
    return Object.keys(UNITS).filter(k => {
      const u = UNITS[k];
      return (!u.tech || techs[u.tech]) && !(u.obs && techs[u.obs]);
    });
  }
  function availBuildings(techs, built) {
    return Object.keys(BUILDINGS).filter(k => {
      const b = BUILDINGS[k];
      return !built.includes(k) && (!b.tech || techs[b.tech]) && (!b.req || built.includes(b.req));
    });
  }
  function availTechs(techs) {
    return Object.keys(TECHS).filter(k => !techs[k] && TECHS[k].req.every(r => techs[r]));
  }

  const R = { TERRAIN, RES, UNITS, TECHS, BUILDINGS, PROCESSES, CIVS, SPEEDS, MAPSIZES,
    neighbors, dist, inRadius, reach, availUnits, availBuildings, availTechs };
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
  else root.RULES = R;
})(this);
