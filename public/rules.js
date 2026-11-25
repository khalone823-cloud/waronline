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
    spearman:  { name: '창병',     cost: 45,  str: 11, moves: 2, tech: 'bronze', anti: true, obs: 'feudalism', res: { copper: 1 }, desc: '기마 상대 +50%' },
    chariot:   { name: '전차',     cost: 55,  str: 10, moves: 3, mounted: true, tech: 'wheel', obs: 'chivalry', res: { horse: 1, wood: 1 } },
    horseman:  { name: '기마병',   cost: 60,  str: 12, moves: 4, mounted: true, tech: 'horseback', obs: 'chivalry', res: { horse: 1 } },
    swordsman: { name: '검사',     cost: 70,  str: 15, moves: 2, tech: 'iron', obs: 'gunpowder', res: { iron: 1 } },
    catapult:  { name: '투석기',   cost: 85,  str: 6,  rstr: 14, range: 2, moves: 2, siege: true, tech: 'math', obs: 'metallurgy', res: { wood: 2, stone: 1 }, desc: '도시 공격 2배' },
    pikeman:   { name: '장창병',   cost: 90,  str: 18, moves: 2, tech: 'feudalism', anti: true, obs: 'rifling', res: { iron: 1, wood: 1 }, desc: '기마 상대 +50%' },
    knight:    { name: '기사',     cost: 110, str: 20, moves: 4, mounted: true, tech: 'chivalry', obs: 'military', res: { horse: 1, iron: 1 } },
    crossbow:  { name: '석궁병',   cost: 110, str: 10, rstr: 18, range: 2, moves: 2, tech: 'machinery', obs: 'rifling', res: { wood: 1, iron: 1 } },
    musketman: { name: '머스킷병', cost: 140, str: 26, moves: 2, tech: 'gunpowder', obs: 'rifling', res: { saltpeter: 1, iron: 1 } },
    cannon:    { name: '대포',     cost: 160, str: 10, rstr: 26, range: 2, moves: 2, siege: true, tech: 'metallurgy', obs: 'dynamite', res: { iron: 2, coal: 1, saltpeter: 1 }, desc: '도시 공격 2배' },
    cavalry:   { name: '기병대',   cost: 170, str: 30, moves: 4, mounted: true, tech: 'military', obs: 'combustion', res: { horse: 1, saltpeter: 1 } },
    rifleman:  { name: '소총병',   cost: 200, str: 36, moves: 2, tech: 'rifling', obs: 'replaceable', res: { iron: 1, saltpeter: 1, coal: 1 } },
    artillery: { name: '야포',     cost: 240, str: 14, rstr: 36, range: 3, moves: 2, siege: true, tech: 'dynamite', obs: 'rocketry', res: { iron: 2, coal: 2, saltpeter: 1 }, desc: '사거리 3, 도시 공격 2배' },
    infantry:  { name: '보병',     cost: 280, str: 50, moves: 2, tech: 'replaceable', obs: 'plastics', res: { iron: 1, coal: 1 } },
    tank:      { name: '전차대',   cost: 360, str: 70, moves: 4, tech: 'combustion', res: { iron: 3, coal: 2 }, desc: '현대 기갑 부대' },
    mech_inf:  { name: '기계화 보병', cost: 340, str: 62, moves: 3, tech: 'plastics', res: { iron: 2, coal: 1 } },
    giant_robot:{ name: '거대 전투 로봇', cost: 480, str: 110, moves: 3, tech: 'robotics', res: { iron: 4, copper: 4 }, desc: '미래 병기' },
    rocket_art:{ name: '로켓 포병', cost: 320, str: 22, rstr: 60, range: 3, moves: 2, siege: true, tech: 'rocketry', res: { iron: 2, coal: 2, saltpeter: 1 }, desc: '사거리 3, 도시 공격 2배' },
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

  const ERAS = ['고대', '고전', '중세', '르네상스', '산업', '현대', '우주'];
  // bonus: 연구 완료 시 영구 효과 (MOD_TEXT 참고)
  const TECHS = {
    agriculture:     { name: '농업',       era: 0, cost: 0,   req: [] },
    pottery:         { name: '도기',       era: 0, cost: 30,  req: ['agriculture'] },
    animal:          { name: '목축',       era: 0, cost: 30,  req: ['agriculture'], desc: '말 목장' },
    archery:         { name: '궁술',       era: 0, cost: 30,  req: ['agriculture'] },
    mining:          { name: '채광',       era: 0, cost: 30,  req: ['agriculture'], desc: '구리·석재·금 광산' },
    calendar:        { name: '역법',       era: 0, cost: 50,  req: ['pottery'], bonus: { growthPct: 5 } },
    trapping:        { name: '덫 사냥',    era: 0, cost: 45,  req: ['animal'], bonus: { goldPct: 3 } },
    mysticism:       { name: '신비주의',   era: 0, cost: 45,  req: ['pottery'], bonus: { cityCul: 1 } },
    wheel:           { name: '바퀴',       era: 0, cost: 50,  req: ['animal'] },
    writing:         { name: '문자',       era: 0, cost: 55,  req: ['pottery'] },
    bronze:          { name: '청동기',     era: 0, cost: 55,  req: ['mining'], res: { copper: 3 }, desc: '철 광산' },
    horseback:       { name: '기마술',     era: 0, cost: 55,  req: ['animal'], res: { horse: 2 } },
    masonry:         { name: '석공술',     era: 0, cost: 55,  req: ['mining'], res: { stone: 2 } },
    code_of_laws:    { name: '법전',       era: 0, cost: 60,  req: ['writing'], bonus: { upkeepFree: 1 } },
    currency:        { name: '화폐',       era: 1, cost: 90,  req: ['bronze'] },
    iron:            { name: '철기',       era: 1, cost: 100, req: ['bronze'], res: { iron: 3 } },
    math:            { name: '수학',       era: 1, cost: 100, req: ['writing', 'archery'] },
    drama:           { name: '연극',       era: 1, cost: 100, req: ['mysticism', 'writing'] },
    philosophy:      { name: '철학',       era: 1, cost: 120, req: ['code_of_laws', 'mysticism'], bonus: { culPct: 10 } },
    optics:          { name: '광학',       era: 1, cost: 110, req: ['math'], bonus: { vetPct: 5 } },
    construction:    { name: '건축',       era: 1, cost: 120, req: ['masonry', 'math'], res: { stone: 5, wood: 5 } },
    engineering:     { name: '공학',       era: 1, cost: 130, req: ['construction', 'wheel'], bonus: { improveSpeed: 1 } },
    chivalry:        { name: '기사도',     era: 2, cost: 160, req: ['horseback', 'iron'], res: { horse: 3, iron: 2 } },
    machinery:       { name: '기계',       era: 2, cost: 160, req: ['math', 'iron'], res: { wood: 4, iron: 2 }, desc: '초석 광산' },
    theology:        { name: '신학',       era: 2, cost: 170, req: ['philosophy', 'drama'] },
    feudalism:       { name: '봉건제',     era: 2, cost: 170, req: ['code_of_laws', 'iron'] },
    education:       { name: '교육',       era: 2, cost: 180, req: ['philosophy', 'currency'], bonus: { sciPct: 5 } },
    civil:           { name: '행정학',     era: 2, cost: 190, req: ['education', 'feudalism'], bonus: { upkeepFree: 2, goldPct: 5 } },
    astronomy:       { name: '천문학',     era: 2, cost: 200, req: ['education', 'math'] },
    guilds:          { name: '길드',       era: 2, cost: 190, req: ['currency', 'construction'] },
    banking:         { name: '은행업',     era: 2, cost: 220, req: ['currency', 'education'] },
    printing:        { name: '인쇄술',     era: 3, cost: 230, req: ['machinery', 'theology'], bonus: { sciPct: 5, culPct: 5 } },
    gunpowder:       { name: '화약',       era: 3, cost: 250, req: ['machinery', 'education'], res: { saltpeter: 4 }, desc: '석탄 광산' },
    architecture:    { name: '건축학',     era: 3, cost: 260, req: ['engineering', 'printing'] },
    economics:       { name: '경제학',     era: 3, cost: 280, req: ['banking', 'printing'], bonus: { marketCut: 5 } },
    physics:         { name: '물리학',     era: 3, cost: 280, req: ['astronomy', 'printing'], bonus: { sciPct: 5 } },
    acoustics:       { name: '음향학',     era: 3, cost: 260, req: ['printing', 'drama'], bonus: { culPct: 10 } },
    navigation:      { name: '항해술',     era: 3, cost: 270, req: ['astronomy', 'optics'], bonus: { marketCut: 5, tradeOp: 3 } },
    chemistry:       { name: '화학',       era: 3, cost: 290, req: ['gunpowder', 'physics'], bonus: { foodPct: 5 } },
    metallurgy:      { name: '야금술',     era: 3, cost: 300, req: ['gunpowder'], res: { coal: 4, iron: 4 } },
    social_contract: { name: '사회계약론', era: 3, cost: 300, req: ['economics', 'civil'] },
    military:        { name: '군사학',     era: 4, cost: 330, req: ['chivalry', 'metallurgy'], res: { horse: 4 } },
    rifling:         { name: '강선',       era: 4, cost: 380, req: ['metallurgy'], res: { iron: 4, saltpeter: 4 } },
    steam:           { name: '증기기관',   era: 4, cost: 400, req: ['physics', 'metallurgy'], res: { coal: 5, iron: 5 }, bonus: { stockCap: 1 } },
    industry:        { name: '산업화',     era: 4, cost: 420, req: ['economics', 'steam'], res: { coal: 8, iron: 8 } },
    nationalism:     { name: '민족주의',   era: 4, cost: 430, req: ['social_contract', 'military'], bonus: { defPct: 5 } },
    medicine:        { name: '의학',       era: 4, cost: 450, req: ['physics', 'economics'], bonus: { growthPct: 10, heal: 5 } },
    archaeology:     { name: '고고학',     era: 4, cost: 420, req: ['acoustics', 'nationalism'] },
    biology:         { name: '생물학',     era: 4, cost: 440, req: ['chemistry', 'medicine'], bonus: { growthPct: 10 } },
    dynamite:        { name: '다이너마이트', era: 4, cost: 460, req: ['rifling', 'industry'], res: { saltpeter: 6, coal: 6 } },
    electricity:     { name: '전기',       era: 5, cost: 520, req: ['steam', 'physics'], res: { copper: 6 }, bonus: { prodPct: 5 } },
    ideology:        { name: '이념',       era: 5, cost: 540, req: ['nationalism', 'industry'] },
    replaceable:     { name: '대량 징병',  era: 5, cost: 560, req: ['dynamite', 'electricity'], res: { iron: 6, coal: 4 } },
    radio:           { name: '무선통신',   era: 5, cost: 600, req: ['electricity'], res: { copper: 6 } },
    combustion:      { name: '내연기관',   era: 5, cost: 640, req: ['replaceable', 'steam'], res: { coal: 10, iron: 10 } },
    computers:       { name: '컴퓨터',     era: 5, cost: 760, req: ['radio', 'medicine'], res: { copper: 10 }, bonus: { sciPct: 10 } },
    refrigeration:   { name: '냉장 기술',  era: 5, cost: 600, req: ['electricity', 'biology'] },
    electronics:     { name: '전자공학',   era: 5, cost: 620, req: ['electricity'], bonus: { sciPct: 5, prodPct: 5 } },
    plastics:        { name: '플라스틱',   era: 5, cost: 700, req: ['refrigeration', 'combustion'] },
    corporation:     { name: '기업 경영',  era: 4, cost: 440, req: ['economics', 'industry'], bonus: { goldPct: 5 }, desc: '기업 설립' },
    globalization:   { name: '세계화',     era: 5, cost: 850, req: ['computers', 'ideology'], bonus: { tradeOp: 10, marketCut: 10, goldPct: 10 } },
    rocketry:        { name: '로켓 공학',  era: 6, cost: 760, req: ['combustion', 'electricity'], res: { iron: 8, coal: 6 }, desc: '발사대 건설' },
    satellites:      { name: '인공위성',   era: 6, cost: 900, req: ['rocketry', 'computers'], res: { copper: 10 }, bonus: { sciPct: 5 } },
    space_flight:    { name: '우주 비행',  era: 6, cost: 1050, req: ['satellites', 'globalization'], res: { iron: 10, copper: 10 }, desc: '우주선 부품' },
    robotics:        { name: '로봇 공학',  era: 6, cost: 1100, req: ['computers', 'plastics', 'rocketry'], res: { iron: 10, copper: 10 }, bonus: { prodPct: 10 } },
    nanotech:        { name: '나노기술',   era: 6, cost: 1300, req: ['robotics', 'satellites'], bonus: { sciPct: 10, defPct: 10 } },
    ai_tech:         { name: '인공지능',   era: 6, cost: 1500, req: ['nanotech', 'space_flight'], bonus: { sciPct: 15, goldPct: 10, stability: 5 } },
    fusion:          { name: '핵융합',     era: 6, cost: 1250, req: ['space_flight'], res: { copper: 12, coal: 10 }, bonus: { prodPct: 10 }, desc: '핵융합 엔진' },
  };

  const BUILDINGS = {
    monument:       { name: '기념비',         cost: 40,  res: { stone: 2 }, desc: '영토 반경 +1, 문화 +2', cul: 2 },
    granary:        { name: '곡물창고',       cost: 55,  res: { wood: 2 }, tech: 'pottery', desc: '식량 +2', food: 2 },
    temple:         { name: '사원',           cost: 50,  res: { wood: 2, stone: 1 }, tech: 'mysticism', desc: '문화 +2', cul: 2 },
    barracks:       { name: '병영',           cost: 60,  res: { wood: 3 }, tech: 'bronze', desc: '생산 유닛 전투력 +15%' },
    forge:          { name: '대장간',         cost: 90,  res: { stone: 3, iron: 2 }, tech: 'guilds', desc: '생산 +2', prod: 2 },
    library:        { name: '도서관',         cost: 70,  res: { wood: 2 }, tech: 'writing', desc: '과학 +3', sci: 3 },
    walls:          { name: '성벽',           cost: 70,  res: { stone: 4 }, tech: 'masonry', desc: '방어 +8, 체력 +30', def: 8, hp: 30 },
    market:         { name: '시장',           cost: 90,  res: { wood: 2 }, tech: 'currency', desc: '금 +3', gold: 3 },
    amphitheater:   { name: '원형극장',       cost: 90,  res: { stone: 4 }, tech: 'drama', desc: '문화 +3', cul: 3 },
    workshop:       { name: '작업장',         cost: 100, res: { wood: 3, stone: 2 }, tech: 'construction', desc: '생산 +3', prod: 3 },
    aqueduct:       { name: '수도교',         cost: 110, res: { stone: 5 }, tech: 'engineering', desc: '식량 +3', food: 3 },
    observatory:    { name: '천문대',         cost: 140, res: { stone: 4, wood: 2 }, tech: 'astronomy', desc: '과학 +4', sci: 4 },
    castle:         { name: '성',             cost: 150, res: { stone: 8 }, tech: 'chivalry', req: 'walls', desc: '방어 +10, 체력 +30', def: 10, hp: 30 },
    university:     { name: '대학',           cost: 150, res: { stone: 4 }, tech: 'education', req: 'library', desc: '과학 +5', sci: 5 },
    printing_house: { name: '인쇄소',         cost: 150, res: { wood: 4 }, tech: 'printing', desc: '과학 +3, 문화 +1', sci: 3, cul: 1 },
    cathedral:      { name: '대성당',         cost: 160, res: { stone: 8 }, tech: 'theology', req: 'temple', desc: '문화 +5', cul: 5 },
    bank:           { name: '은행',           cost: 180, res: { stone: 4 }, tech: 'banking', req: 'market', desc: '금 +5', gold: 5 },
    opera:          { name: '오페라 하우스', cost: 200, res: { stone: 6, wood: 4 }, tech: 'architecture', req: 'amphitheater', desc: '문화 +6', cul: 6 },
    stock_exchange: { name: '증권거래소',     cost: 240, res: { stone: 6 }, tech: 'economics', req: 'bank', desc: '금 +6', gold: 6 },
    factory:        { name: '공장',           cost: 250, res: { iron: 6, coal: 4 }, tech: 'industry', req: 'workshop', desc: '생산 +6', prod: 6 },
    museum:         { name: '박물관',         cost: 240, res: { stone: 6 }, tech: 'archaeology', desc: '문화 +5', cul: 5 },
    supermarket:    { name: '슈퍼마켓',       cost: 280, res: { iron: 2, copper: 2 }, tech: 'refrigeration', desc: '식량 +4', food: 4 },
    hospital:       { name: '병원',           cost: 260, res: { stone: 4, iron: 2 }, tech: 'medicine', desc: '식량 +4', food: 4 },
    power_plant:    { name: '발전소',         cost: 320, res: { iron: 6, coal: 6, copper: 4 }, tech: 'electricity', req: 'factory', desc: '생산 +8', prod: 8 },
    broadcast:      { name: '방송국',         cost: 340, res: { copper: 6, iron: 4 }, tech: 'radio', desc: '문화 +8', cul: 8 },
    launchpad:      { name: '발사대',         cost: 300, res: { iron: 8, copper: 6, coal: 4 }, tech: 'rocketry', desc: '우주 프로젝트 가능' },
    research_lab:   { name: '연구소',         cost: 400, res: { copper: 8, iron: 4 }, tech: 'computers', req: 'university', desc: '과학 +10', sci: 10 },
  };

  // ── 정부 체제와 사상 ──
  const MOD_TEXT = {
    foodPct: ['식량', '%'], prodPct: ['생산', '%'], goldPct: ['금', '%'], sciPct: ['과학', '%'], culPct: ['문화', '%'],
    capFood: ['수도 식량', ''], capProd: ['수도 생산', ''], capGold: ['수도 금', ''], capSci: ['수도 과학', ''], capCul: ['수도 문화', ''],
    cityFood: ['모든 도시 식량', ''], cityProd: ['모든 도시 생산', ''], cityGold: ['모든 도시 금', ''], citySci: ['모든 도시 과학', ''], cityCul: ['모든 도시 문화', ''],
    growthPct: ['도시 성장 속도', '%'], settlerPct: ['개척자·일꾼 생산', '%'], milProdPct: ['군사 유닛 생산', '%'], bldProdPct: ['건물 생산', '%'],
    atkPct: ['공격력', '%'], defPct: ['방어력', '%'], cityDefPct: ['도시 방어력', '%'], heal: ['유닛 회복', ''], upkeepFree: ['무료 유지 유닛', ''],
    buyCut: ['구매 비용 할인', '%'], marketCut: ['시장 거래 이득', '%'], tradeOp: ['다른 문명의 태도', ''], trustRegen: ['신뢰 회복', ''],
    vetPct: ['정예 유닛 확률', '%'], stability: ['안정도', ''], improveSpeed: ['시설 건설 단축(턴)', ''], stockCap: ['도시당 채굴 시설', ''],
  };
  const GOVS = {
    tribal:     { name: '부족 연맹', era: 0, bloc: 'old',  mods: { upkeepFree: 1 }, desc: '시작 체제. 특별한 장단점이 없습니다' },
    monarchy:   { name: '군주정',   era: 1, bloc: 'old',  tech: 'code_of_laws', mods: { capProd: 2, capGold: 3, cityDefPct: 15, stability: 5 }, desc: '강한 수도와 튼튼한 도시' },
    republic:   { name: '공화정',   era: 2, bloc: 'free', tech: 'philosophy', mods: { goldPct: 15, sciPct: 10, culPct: 5, upkeepFree: -1 }, desc: '번영과 학문, 대신 군대 유지비가 늘어남' },
    theocracy:  { name: '신정',     era: 2, bloc: 'old',  tech: 'theology', mods: { culPct: 30, defPct: 10, sciPct: -10, stability: 8 }, desc: '문화와 수비가 강하지만 과학이 느림' },
    feudal:     { name: '봉건제',   era: 2, bloc: 'old',  tech: 'feudalism', mods: { upkeepFree: 4, defPct: 10, cityFood: 1, goldPct: -10 }, desc: '많은 군대를 싸게 유지' },
    democracy:  { name: '민주주의', era: 5, bloc: 'free', tech: 'social_contract', mods: { goldPct: 20, sciPct: 15, growthPct: 10, tradeOp: 10, atkPct: -10, upkeepFree: -2, stability: 4 }, desc: '경제·과학·외교 강세, 전쟁에는 불리' },
    autocracy:  { name: '전제정',   era: 5, bloc: 'auto', tech: 'nationalism', mods: { atkPct: 15, milProdPct: 30, upkeepFree: 3, tradeOp: -10, goldPct: -10, stability: 6 }, desc: '강력한 군국주의, 외교 평판 하락' },
    communism:  { name: '공산주의', era: 6, bloc: 'red',  tech: 'ideology', mods: { prodPct: 20, cityProd: 1, goldPct: -15, marketCut: -10, stability: 3 }, desc: '압도적 생산력, 상업 약화' },
  };
  const POLICY_TREES = {
    tradition: { name: '전통', icon: 'crown', desc: '수도 중심의 안정된 성장', policies: [
      { id: 'aristocracy', name: '귀족정', mods: { capProd: 2, capCul: 1 } },
      { id: 'heritage', name: '전통 계승', mods: { growthPct: 10, stability: 5 } },
      { id: 'royal_grace', name: '군주의 은총', mods: { capFood: 3, capGold: 2 } },
      { id: 'lords', name: '지방 영주', mods: { cityProd: 1 } },
      { id: 'ceremony', name: '왕실 의례', mods: { culPct: 15, capSci: 3 } } ] },
    liberty: { name: '자유', icon: 'flag', desc: '넓은 확장과 시민의 힘', policies: [
      { id: 'self_rule', name: '시민 자치', mods: { cityCul: 1 } },
      { id: 'pioneer', name: '개척 정신', mods: { settlerPct: 50 } },
      { id: 'citizenry', name: '시민 의식', mods: { cityProd: 1 } },
      { id: 'merit', name: '능력주의', mods: { cityGold: 1, upkeepFree: 2 } },
      { id: 'representation', name: '대의 정치', mods: { growthPct: 15, culPct: 10, stability: 4 } } ] },
    honor: { name: '명예', icon: 'swords', desc: '전사의 길과 군사력', policies: [
      { id: 'discipline', name: '전사 규율', mods: { atkPct: 10 } },
      { id: 'mil_tradition', name: '군사 전통', mods: { milProdPct: 25 } },
      { id: 'defense', name: '방어 전술', mods: { defPct: 15, cityDefPct: 20 } },
      { id: 'warrior_caste', name: '전사 계급', mods: { upkeepFree: 3, heal: 10, stability: 3 } },
      { id: 'conquest', name: '정복 정신', mods: { atkPct: 10, vetPct: 25 } } ] },
    piety: { name: '신앙', icon: 'temple', tech: 'mysticism', desc: '종교와 문화, 평화로운 관계', policies: [
      { id: 'org_religion', name: '조직 종교', mods: { cityCul: 1, cityFood: 1, stability: 5 } },
      { id: 'clergy', name: '성직자 계급', mods: { culPct: 20 } },
      { id: 'tolerance', name: '관용', mods: { tradeOp: 10, trustRegen: 0.5, stability: 5 } },
      { id: 'reformation', name: '종교 개혁', mods: { cityGold: 2 } },
      { id: 'divine', name: '신의 가호', mods: { defPct: 10, heal: 10 } } ] },
    commerce: { name: '상업', icon: 'coin', tech: 'currency', desc: '교역과 부의 축적', policies: [
      { id: 'free_market', name: '자유 시장', mods: { goldPct: 15 } },
      { id: 'guilds', name: '상인 길드', mods: { marketCut: 15 } },
      { id: 'trade_routes', name: '교역로', mods: { tradeOp: 10, cityGold: 1 } },
      { id: 'banking_sys', name: '금융 제도', mods: { buyCut: 20 } },
      { id: 'mercantilism', name: '중상주의', mods: { goldPct: 15, stockCap: 1 } } ] },
    rationalism: { name: '합리주의', icon: 'flask', tech: 'education', desc: '과학과 이성', policies: [
      { id: 'scholarship', name: '학문 장려', mods: { sciPct: 15 } },
      { id: 'secularism', name: '세속주의', mods: { citySci: 2 } },
      { id: 'empiricism', name: '실험 정신', mods: { sciPct: 10, bldProdPct: 15 } },
      { id: 'enlightenment', name: '계몽 사상', mods: { culPct: 15, trustRegen: 0.5, stability: 5 } },
      { id: 'sci_revolution', name: '과학 혁명', mods: { sciPct: 20 } } ] },
    industrialism: { name: '산업주의', icon: 'factory', tech: 'industry', desc: '대량 생산과 기계의 시대', policies: [
      { id: 'mechanization', name: '기계화', mods: { prodPct: 15 } },
      { id: 'unions', name: '노동 조합', mods: { cityProd: 2, stability: 4 } },
      { id: 'railways', name: '철도 국가', mods: { improveSpeed: 1, stockCap: 1 } },
      { id: 'mass_prod', name: '대량 생산', mods: { milProdPct: 25, bldProdPct: 15 } },
      { id: 'capital', name: '자본 축적', mods: { goldPct: 20 } } ] },
  };
  // 우주 프로젝트 (발사대가 있는 도시에서 생산)
  const PROJECTS = {
    satellite: { name: '정찰 위성',        cost: 400, res: { copper: 6, iron: 4 }, tech: 'satellites', max: 1, desc: '세계 지도 전체 공개 + 과학 +10%' },
    booster:   { name: '우주선 추진체',    cost: 500, res: { iron: 8, coal: 6 }, tech: 'space_flight', max: 3, desc: '우주선 부품 (3개 필요)' },
    habitat:   { name: '우주선 거주 모듈', cost: 600, res: { copper: 6, iron: 6 }, tech: 'space_flight', max: 1, desc: '우주선 부품 (1개 필요)' },
    engine:    { name: '핵융합 엔진',      cost: 800, res: { iron: 8, copper: 8 }, tech: 'fusion', max: 1, desc: '우주선 부품 (1개 필요)' },
  };
  const SPACE_NEED = { booster: 3, habitat: 1, engine: 1 };
  const SPACE_BONUS = { sciPct: 20, culPct: 20, stability: 10 };
  // 기업: 본사 도시에서 설립, 지사를 늘릴수록 수익. 매 턴 원료 소비
  const CORPS = {
    lumber:  { name: '그린우드 건설',   icon: 'lumber', tech: 'corporation', input: { wood: 2 }, found: { wood: 12, stone: 8 }, eff: { prod: 2, gold: 1 }, desc: '건설·목재' },
    trade:   { name: '동방 무역회사',   icon: 'scale', tech: 'corporation', input: { horse: 1 }, found: { horse: 8, copper: 6 }, eff: { gold: 3 }, desc: '해상·육상 교역' },
    steel:   { name: '대륙 철강',       icon: 'factory', tech: 'corporation', input: { iron: 1, coal: 1 }, found: { iron: 10, coal: 10 }, eff: { prod: 3 }, desc: '제철·중공업' },
    chem:    { name: '신세기 화학',     icon: 'flask', tech: 'dynamite', input: { saltpeter: 1, coal: 1 }, found: { saltpeter: 10, coal: 8 }, eff: { food: 3 }, desc: '비료·화학' },
    telecom: { name: '전파 통신',       icon: 'broadcast', tech: 'radio', input: { copper: 1 }, found: { copper: 12 }, eff: { cul: 3, sci: 2 }, desc: '방송·통신' },
    silicon: { name: '실리콘 전자',     icon: 'research_lab', tech: 'computers', input: { copper: 2 }, found: { copper: 14, iron: 6 }, eff: { sci: 5 }, desc: '반도체·전자' },
    aero:    { name: '스타 항공우주',   icon: 'rocket', tech: 'rocketry', input: { iron: 1, copper: 1 }, found: { iron: 12, copper: 12 }, eff: { prod: 2, sci: 2 }, space: 25, desc: '항공·우주 (우주 프로젝트 생산 +25%)' },
  };
  const CORP_COST = { found: 250, branch: 60, foreign: 120 };
  Object.assign(POLICY_TREES, {
    patronage: { name: '후원', icon: 'handshake', tech: 'philosophy', desc: '외교와 국제 관계', policies: [
      { id: 'exchange', name: '문화 교류', mods: { tradeOp: 8 } },
      { id: 'tribute', name: '조공 체제', mods: { cityGold: 1 } },
      { id: 'envoys', name: '외교 사절단', mods: { trustRegen: 0.5, tradeOp: 5 } },
      { id: 'pact_spirit', name: '맹약 정신', mods: { defPct: 5, stability: 3 } },
      { id: 'cosmopolitan', name: '세계 시민', mods: { tradeOp: 10, culPct: 10 } } ] },
    aesthetics: { name: '미학', icon: 'culture', tech: 'drama', desc: '예술과 걸작', policies: [
      { id: 'arts', name: '예술 후원', mods: { culPct: 15 } },
      { id: 'arch_beauty', name: '건축 미학', mods: { bldProdPct: 15 } },
      { id: 'renaissance', name: '문예 부흥', mods: { cityCul: 2 } },
      { id: 'national_culture', name: '국민 문화', mods: { stability: 5, culPct: 10 } },
      { id: 'masterpiece', name: '불멸의 걸작', mods: { capCul: 5, sciPct: 5 } } ] },
    exploration: { name: '탐험', icon: 'map', tech: 'astronomy', desc: '미지의 땅과 식민지', policies: [
      { id: 'expedition', name: '원정대', mods: { settlerPct: 25 } },
      { id: 'colonial', name: '식민지 경영', mods: { cityGold: 1, cityFood: 1 } },
      { id: 'overseas', name: '해외 무역', mods: { marketCut: 10 } },
      { id: 'geography', name: '지리학', mods: { sciPct: 5, improveSpeed: 1 } },
      { id: 'frontier', name: '개척 제국', mods: { stockCap: 1, growthPct: 10 } } ] },
    freedom: { name: '자유주의', icon: 'peace', tech: 'electricity', ideo: true, desc: '근대 이념 · 하나만 선택', policies: [
      { id: 'civil_rights', name: '시민권', mods: { stability: 5, goldPct: 10 } },
      { id: 'free_press', name: '언론의 자유', mods: { culPct: 20 } },
      { id: 'free_trade', name: '자유 무역', mods: { marketCut: 15, tradeOp: 10 } },
      { id: 'welfare', name: '복지 국가', mods: { growthPct: 15, stability: 5 } },
      { id: 'space_spirit', name: '우주 개척 정신', mods: { sciPct: 15 } } ] },
    order: { name: '질서', icon: 'factory', tech: 'electricity', ideo: true, desc: '근대 이념 · 하나만 선택', policies: [
      { id: 'five_year', name: '5개년 계획', mods: { prodPct: 15 } },
      { id: 'collective', name: '집단 농장', mods: { cityFood: 2 } },
      { id: 'central_plan', name: '중앙 계획', mods: { bldProdPct: 25 } },
      { id: 'hero_labor', name: '노동 영웅', mods: { cityProd: 2, stability: 5 } },
      { id: 'academy', name: '과학 아카데미', mods: { sciPct: 15 } } ] },
    totalitarian: { name: '전체주의', icon: 'fist', tech: 'electricity', ideo: true, desc: '근대 이념 · 하나만 선택', policies: [
      { id: 'mobilization', name: '총동원령', mods: { milProdPct: 40 } },
      { id: 'secret_police', name: '비밀 경찰', mods: { stability: 15 } },
      { id: 'militarism', name: '군국주의', mods: { atkPct: 15 } },
      { id: 'propaganda', name: '선전부', mods: { culPct: 15, stability: 5 } },
      { id: 'superpower', name: '초강대국', mods: { atkPct: 10, defPct: 10, upkeepFree: 5 } } ] },
  });
  const HPMAX = 60, DMG = 1.2, CITY_HP = 120;
  const POLICY = {};
  for (const [tk, t] of Object.entries(POLICY_TREES)) t.policies.forEach((p, i) => { POLICY[p.id] = Object.assign({ tree: tk, idx: i }, p); });
  function policyCost(n, cities, speed) { return Math.max(5, Math.round((20 + 12 * n + 1.6 * n * n) * speed * (1 + 0.08 * Math.max(0, cities - 1)))); }
  // 기술 보너스 + 정부 + 사상 효과 합산
  function sumMods(techs, gov, policies) {
    const m = {};
    const add = o => { for (const k in o || {}) m[k] = (m[k] || 0) + o[k]; };
    for (const k in techs) if (TECHS[k] && TECHS[k].bonus) add(TECHS[k].bonus);
    if (GOVS[gov]) add(GOVS[gov].mods);
    for (const id of policies || []) if (POLICY[id]) add(POLICY[id].mods);
    return m;
  }
  function modText(mods) { return Object.entries(mods || {}).map(([k, v]) => { const t = MOD_TEXT[k]; if (!t) return ''; return `${t[0]} ${v > 0 ? '+' : ''}${v}${t[1]}`; }).filter(Boolean).join(', '); }

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

  const R = { TERRAIN, STOCK, RES, IMPS, IMP_BY_CODE, UNITS, EQUIP, SLOTS, ERAS, TECHS, BUILDINGS, PROCESSES, TACTICS, CIVS, SPEEDS, TREATY,
    HPMAX, DMG, CITY_HP, MOD_TEXT, GOVS, POLICY_TREES, POLICY, PROJECTS, SPACE_NEED, SPACE_BONUS, CORPS, CORP_COST, policyCost, sumMods, modText,
    neighbors, dist, inRadius, reach, impFor, impTechOk, hasRes, availUnits, availBuildings, availEquip, availTechs, canEquip };
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
  else root.RULES = R;
})(this);
