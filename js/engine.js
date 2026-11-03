/* ============================================================================
   OREGON TRAIL — LONE PASSAGE
   engine.js — deterministic simulation core (no DOM, no rendering)

   The mathematical skeleton is the published 1978 MECC listing:
     travel rate, event table, illness severity, rider curve, mountain curve,
     South Pass / Blue Mountains gates, arrival calendar arithmetic.

   It has been remade for this decade: a named party with individual health and
   morale, a 12-resource outfitting economy, weather and terrain systems,
   named landmarks on the real trail, a morale/dysentery model, and scoring.
   Every rule lives here so the presentation layer can stay purely visual.
   ========================================================================== */

export const TOTAL_MILES = 2040;
export const DAYS_PER_TURN = 14;
export const INITIAL_SAVINGS = 900;
export const WAGON_COST = 200;
export const STARTING_CASH = INITIAL_SAVINGS - WAGON_COST;
export const DOCTOR_BILL = 20;
export const FORT_PRICE_FACTOR = 2 / 3;
export const BULLETS_PER_DOLLAR = 50;
export const MAX_TURNS = 19;
export const FORT_TRAVEL_MILES = 45;   // a fort stop or a hunt costs this much ground
export const HUNT_MIN_BULLETS = 20;
/* The 1978 listing checked F < 13 after the action and before eating: with
   less than that the party starves where it stands. Repeat here so the rule
   survives fort prices, modern rations and the per-day consumption model. */
export const STARVATION_FOOD_FLOOR = 13;
export const WATER_KEG_CAP = 20;        // what a wagon can carry out of a full cask

/* ----------------------------------------------------------------------------
   Deterministic RNG — mulberry32. Seedable so runs are reproducible and
   testable, unlike the original's unseeded RND().
   -------------------------------------------------------------------------- */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------------------
   Trail geography. Real landmarks at their real mileposts from Independence.
   -------------------------------------------------------------------------- */
export const LANDMARKS = Object.freeze([
  { name: 'Independence', miles: 0, kind: 'town', note: 'Missouri. The last of the States.' },
  { name: 'Kansas River Crossing', miles: 102, kind: 'river', note: 'A ferry, or a hard ford.' },
  { name: 'Big Blue River', miles: 185, kind: 'river', note: 'Shallow and treacherous.' },
  { name: "Alcove Spring", miles: 234, kind: 'spring', note: 'Sweet water and shade.' },
  { name: 'Fort Kearney', miles: 304, kind: 'fort', note: 'Army post. Prices climb.' },
  { name: 'Chimney Rock', miles: 454, kind: 'landmark', note: 'A spire visible for a day.' },
  { name: 'Scotts Bluff', miles: 554, kind: 'landmark', note: 'The trail turns south here.' },
  { name: 'Fort Laramie', miles: 640, kind: 'fort', note: 'Trading post and blacksmith.' },
  { name: 'Independence Rock', miles: 800, kind: 'landmark', note: 'Names carved in granite.' },
  { name: 'South Pass', miles: 950, kind: 'pass', note: 'The Continental Divide. Gentle, but deadly in snow.' },
  { name: 'Green River Crossing', miles: 1150, kind: 'river', note: 'Wide, cold, and deep.' },
  { name: 'Soda Springs', miles: 1260, kind: 'spring', note: 'Water that fizzes from the ground.' },
  { name: 'Fort Hall', miles: 1330, kind: 'fort', note: 'The last real fort before the desert.' },
  { name: 'Snake River Plain', miles: 1520, kind: 'desert', note: 'Dust, sage, and no water.' },
  { name: 'Fort Boise', miles: 1620, kind: 'fort', note: 'A dry and hungry post.' },
  { name: 'Blue Mountains', miles: 1700, kind: 'pass', note: 'Timbered ridges. Snow comes early.' },
  { name: 'The Dalles', miles: 1880, kind: 'river', note: 'The Columbia. Raft it, or walk it.' },
  { name: 'Oregon City', miles: 2040, kind: 'town', note: 'The end of the trail.' },
]);

/* `maxQty` is an inventory ceiling; `maxSpend` is a per-item dollar cap that
   keeps a single outfitting choice from swallowing the whole budget. */
export const GOODS = Object.freeze([
  /* Oxen are bought with dollars, exactly as in 1978: spend $200–$300 and the
     team's strength is the money you put into it. basePrice 1 = $1 per point. */
  { id: 'oxen',      label: 'Oxen Team',       unit: 'dollars',  basePrice: 1,    maxQty: 400,  maxSpend: 340,  blurb: 'Spend $200–$300. Better animals set a faster pace.' },
  { id: 'food',      label: 'Food',            unit: 'lb',       basePrice: 0.12, maxQty: 2000, maxSpend: 140,  blurb: 'Flour, bacon, coffee. Hungry families sicken.' },
  { id: 'bullets',   label: 'Ammunition',      unit: 'rounds',   basePrice: 0.02, maxQty: 2000, maxSpend: 40,   blurb: 'For the hunt, and for the riders.' },
  { id: 'clothing',  label: 'Clothing',        unit: 'sets',     basePrice: 1,    maxQty: 120,  maxSpend: 90,   blurb: 'Wool and oilskin. Mountains kill the ill-dressed.' },
  { id: 'medicine',  label: 'Medicine',        unit: 'doses',    basePrice: 2,    maxQty: 60,   maxSpend: 80,   blurb: 'Quinine and laudanum. Dysentery respects none.' },
  { id: 'tools',     label: 'Wagon Tools',     unit: 'kits',     basePrice: 6,    maxQty: 20,   maxSpend: 66,   blurb: 'Axles, spokes, tar. Breakdowns are cheaper with them.' },
  { id: 'spareParts',label: 'Spare Parts',     unit: 'sets',     basePrice: 12,   maxQty: 12,   maxSpend: 72,   blurb: 'Whole assemblies. The fastest repair there is.' },
  { id: 'water',     label: 'Water Kegs',      unit: 'kegs',     basePrice: 2,    maxQty: 30,   maxSpend: 40,   blurb: 'The desert takes the unprepared.' },
  { id: 'feed',      label: 'Animal Feed',     unit: 'bales',    basePrice: 1.5,  maxQty: 60,   maxSpend: 54,   blurb: 'Grazing thins past Fort Laramie. Feed keeps oxen strong.' },
  { id: 'blankets',  label: 'Blankets',        unit: 'bales',    basePrice: 1.5,  maxQty: 80,   maxSpend: 48,   blurb: 'Warmth for the cold camps.' },
  { id: 'coffee',    label: 'Coffee & Sugar',  unit: 'lbs',      basePrice: 1,    maxQty: 80,   maxSpend: 30,   blurb: 'Small comforts. Morale is a resource too.' },
  { id: 'books',     label: 'Books & Sundries',unit: 'boxes',    basePrice: 2,    maxQty: 60,   maxSpend: 24,   blurb: 'Bible, guidebook, letters home. Spirits matter.' },
]);

export const GOODS_BY_ID = Object.freeze(
  Object.fromEntries(GOODS.map((g) => [g.id, g])),
);

/* A sensible, affordable opening wagon. Costs well under the $700 budget. */
export const STARTER_LOADOUT = Object.freeze({
  oxen: 250, food: 900, bullets: 800, clothing: 50, medicine: 15,
  tools: 6, spareParts: 2, water: 18, feed: 24, blankets: 16,
  coffee: 20, books: 6,
});

/* ----------------------------------------------------------------------------
   Party — named members with health, and morale at party level.
   -------------------------------------------------------------------------- */
export const DEFAULT_PARTY = Object.freeze([
  { name: 'Elias',  role: 'Father',   age: 38 },
  { name: 'Martha', role: 'Mother',   age: 36 },
  { name: 'Caleb',  role: 'Son',      age: 14 },
  { name: 'Susannah', role: 'Daughter', age: 11 },
  { name: 'Tobias', role: 'Infant',   age: 2 },
]);

export const RATIONS = Object.freeze({
  basic:    { id: 'basic',    label: 'Basic',    consumption: 8,  morale: -3, sickness: 1.00 },
  moderate: { id: 'moderate', label: 'Moderate', consumption: 13, morale: 0,  sickness: 0.62 },
  hearty:   { id: 'hearty',   label: 'Hearty',   consumption: 18, morale: 4,  sickness: 0.40 },
});

/* Pace is the core risk/reward dial. Faster paces cover far more ground but
   wear the animals down, sicken the family, and strain the wagon. Over a long
   run the wear compounds, so a gruelling sprint is only worth it if you are
   already short of season. */
export const PACE = Object.freeze({
  gentle:    { id: 'gentle',    label: 'Gentle',    miles: 0.74, morale: 5,  illness: 0.45, missChance: 0.00, strain: 0.00, wear: 0.00 },
  steady:    { id: 'steady',    label: 'Steady',    miles: 1.00, morale: 0,  illness: 1.00, missChance: 0.00, strain: 0.05, wear: 0.035 },
  brisk:     { id: 'brisk',     label: 'Brisk',     miles: 1.24, morale: -4, illness: 1.55, missChance: 0.06, strain: 0.16, wear: 0.095 },
  gruelling: { id: 'gruelling', label: 'Gruelling', miles: 1.44, morale: -10, illness: 2.20, missChance: 0.15, strain: 0.42, wear: 0.20 },
});

export const WEATHER = Object.freeze(['clear', 'overcast', 'rain', 'storm', 'snow', 'heat', 'fog']);

/* Terrain bands by mileage. Drives weather risk, speed, and visuals. */
export const TERRAIN_BANDS = Object.freeze([
  { to: 300,          id: 'prairie',  label: 'Tallgrass Prairie', miles: 1.00 },
  { to: 700,          id: 'plains',   label: 'High Plains',       miles: 0.97 },
  { to: 1000,         id: 'rockies',  label: 'Rocky Foothills',   miles: 0.90 },
  { to: 1250,         id: 'divide',   label: 'Continental Divide', miles: 0.86 },
  { to: 1550,         id: 'basin',    label: 'Great Basin Desert', miles: 0.92 },
  { to: 1750,         id: 'snake',    label: 'Snake River Country', miles: 0.94 },
  { to: 1900,         id: 'blues',    label: 'Blue Mountains',    miles: 0.78 },
  { to: Infinity,     id: 'gorge',    label: 'Columbia Gorge',    miles: 0.88 },
]);

export function terrainFor(miles) {
  for (const band of TERRAIN_BANDS) if (miles < band.to) return band;
  return TERRAIN_BANDS[TERRAIN_BANDS.length - 1];
}

/* Classic 16-event table, thresholds preserved exactly. */
const EVENT_THRESHOLDS = [6, 11, 13, 15, 17, 22, 32, 35, 37, 42, 44, 54, 64, 69, 95];

export const EVENT_IDS = Object.freeze([
  'wagon_breaks_down', 'ox_injures_leg', 'child_breaks_arm', 'ox_wanders_off',
  'child_gets_lost', 'unsafe_water', 'weather_event', 'bandits_attack',
  'fire_in_wagon', 'lose_way_in_fog', 'poisonous_snake', 'wagon_swamped',
  'wild_animals', 'hail_storm', 'illness_check', 'helpful_friends',
]);

export function eventIndexForRoll(roll) {
  for (let i = 0; i < EVENT_THRESHOLDS.length; i += 1) {
    if (roll <= EVENT_THRESHOLDS[i]) return i;
  }
  return 15;
}

/* ----------------------------------------------------------------------------
   Classic curves, preserved.
   -------------------------------------------------------------------------- */
/* 1978: riders occur when 10*RND() > (q-1). RND() is in [0,1), so the event
   probability is P(RND <= (q-1)/10) — a peak of 0.5 exactly at 400 miles,
   tapering off on both sides. */
export function riderProbability(mileage) {
  const x = mileage / 100 - 4;
  const q = (x * x + 72) / (x * x + 12);
  return Math.max(0, Math.min(1, (q - 1) / 10));
}

/* Mountains: incident when 10*RND() <= 9-q, i.e. P = (9-q)/10. Peaks at 1500. */
export function mountainProbability(mileage) {
  const x = mileage / 100 - 15;
  const q = (x * x + 72) / (x * x + 12);
  return Math.max(0, Math.min(1, (9 - q) / 10));
}

export function baseTravelMiles(oxenValue, draw) {
  return 200 + (oxenValue - 220) / 5 + 10 * draw;
}

/* ----------------------------------------------------------------------------
   Date helpers — real Gregorian arithmetic, no leap assumptions.
   -------------------------------------------------------------------------- */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MONTH_DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];

function isLeap(y) { return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0); }
function daysInMonth(y, m) { return m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1]; }

export function addDays(year, month, day, delta) {
  let y = year, m = month, d = day + delta;
  while (d > daysInMonth(y, m)) { d -= daysInMonth(y, m); m += 1; if (m > 12) { m = 1; y += 1; } }
  while (d < 1) { m -= 1; if (m < 1) { m = 12; y -= 1; } d += daysInMonth(y, m); }
  return { year: y, month: m, day: d };
}

export function weekdayIndex(year, month, day) {
  // Zeller's congruence, 1-based month/day, index 0 = Monday.
  let m = month, y = year;
  if (m < 3) { m += 12; y -= 1; }
  const k = y % 100, j = Math.floor(y / 100);
  const h = (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  // Zeller: 0=Saturday. Convert to Monday=0.
  return (h + 5) % 7;
}

export function formatDate(year, month, day) {
  return `${WEEKDAYS[weekdayIndex(year, month, day)]}, ${MONTHS[month - 1]} ${day}, ${year}`;
}

export function formatDateShort(year, month, day) {
  return `${MONTHS[month - 1].slice(0, 3)} ${day}`;
}

/* ============================================================================
   GAME
   ========================================================================== */

export class OregonTrailGame {
  constructor({ seed = Date.now(), party = DEFAULT_PARTY } = {}) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.partyTemplate = party;
    this.reset();
  }

  /* -- state ------------------------------------------------------------- */
  reset() {
    this.rng = mulberry32(this.seed);
    this.phase = 'outfit';           // outfit | travel | landmark | event | hunt | river | end
    this.outcome = null;             // null | 'arrived' | 'died' | 'winter'

    this.miles = 0;
    this.turn = 0;
    this.totalDays = 0;

    // Per-turn decision state, walked by the presentation layer.
    this.turnStage = 'idle';     // idle | action | meal | travel | resolved
    this.turnAction = 'continue'; // continue | fort | hunt
    this.fortAvailable = false;
    this.atFort = false;
    this.huntPending = false;
    this.turnResolved = false;

    this.cash = STARTING_CASH;
    this.oxen = 0;
    // Oxen strength starts as the money sunk into the team and degrades with
    // hard driving and poor feed. It must never be undefined: the first turn's
    // wear calculation would poison the whole run with NaN.
    this.oxenStrength = 0;
    this.goods = {};
    for (const g of GOODS) this.goods[g.id] = 0;

    this.pace = 'steady';
    this.ration = 'moderate';

    this.party = this.partyTemplate.map((p) => ({ ...p, health: 1, alive: true }));
    this.morale = 70;
    this.dead = [];

    this.southPassCleared = false;
    this.blueMountainsCleared = false;
    this.showSouthPassMileage = false;
    this.blizzardThisTurn = false;
    this.s5 = 0;                     // rider hostility

    this.weather = 'clear';
    this.temperature = 62;           // Fahrenheit

    this.flags = { injured: false, doctorBillDue: false };

    this.log = [];
    this.dayLog = [];                // per-turn history for the journal
    this.landmarks = LANDMARKS.map((l) => ({ ...l, visited: false }));
    this.stats = {
      milesWalked: 0, hunted: 0, meatTaken: 0, riversFords: 0, riversFerried: 0,
      eventsSuffered: 0, friendlyEncounters: 0, hostileEncounters: 0,
    };
  }

  /* -- helpers ----------------------------------------------------------- */
  draw() { return this.rng(); }
  drawInt(n) { return Math.floor(this.rng() * n); }

  /* Setbacks are a *fraction of the ground covered this turn*, not a flat
     subtraction. The 1978 numbers assumed a ~200-mile turn; a flat -95 on a
     60-mile mountain turn erased the whole fortnight and made the trail
     impossible. Scaling keeps a bad turn painful but still forward-moving.
     `Reference` is the flat 1978 value; 200 miles is the classic turn. */
  loseMiles(flat, { maxFraction = 0.55 } = {}) {
    const gain = Math.max(40, this.turnGain || 60);
    const asFraction = Math.max(0, flat) / 200;
    // Cap the loss so that stacking several hazards in one turn cannot reverse
    // a fortnight of travel. A disastrous turn still costs more than half.
    this.miles -= gain * Math.min(maxFraction, asFraction);
  }

  say(text, tone = 'plain') {
    this.log.push({ text, tone });
    if (this.log.length > 400) this.log.shift();
  }

  alive() { return this.party.filter((p) => p.alive); }

  get wagonWeight() {
    let w = 0;
    for (const g of GOODS) {
      if (g.id === 'oxen') continue;
      w += (this.goods[g.id] || 0) * 0.9;
    }
    return w;
  }

  get healthAverage() {
    const a = this.alive();
    if (!a.length) return 0;
    return a.reduce((s, p) => s + p.health, 0) / a.length;
  }

  get date() {
    return addDays(1847, 3, 29, this.totalDays);
  }

  get dateLabel() { const d = this.date; return formatDate(d.year, d.month, d.day); }

  get nextLandmark() {
    return this.landmarks.find((l) => l.miles > this.miles + 1) || null;
  }

  get currentLandmark() {
    for (let i = this.landmarks.length - 1; i >= 0; i -= 1) {
      if (this.landmarks[i].miles <= this.miles + 1) return this.landmarks[i];
    }
    return this.landmarks[0];
  }

  /* -- outfitting -------------------------------------------------------- */
  costOf(id, qty) {
    const g = GOODS_BY_ID[id];
    return g ? g.basePrice * qty : 0;
  }

  loadoutCost(loadout) {
    let total = 0;
    for (const g of GOODS) total += this.costOf(g.id, loadout[g.id] || 0);
    return total;
  }

  setOutfit(next) {
    const { oxen, ...rest } = next;
    const l = { oxen, ...rest };
    this.oxen = l.oxen;
    this.oxenStrength = l.oxen;
    for (const g of GOODS) this.goods[g.id] = Math.max(0, Math.round(l[g.id] || 0));
    this.cash = Math.max(0, Math.round(this.cash));
    this.phase = 'travel';
    this.weather = 'clear';
    this.temperature = 64;
    this.say('You roll out of Independence on a bright, dusty morning.', 'good');
    return true;
  }

  /* -- price at a given place -------------------------------------------- */
  priceMultiplier(atFort = false) {
    if (!atFort) return 1;
    // Forts gouge: classic 2/3 goods-per-dollar ratio inverts to 1.5x price.
    const late = Math.min(0.35, this.miles / TOTAL_MILES * 0.35);
    return (1 / FORT_PRICE_FACTOR) + late;
  }

  priceOf(id, atFort = false) {
    return GOODS_BY_ID[id].basePrice * this.priceMultiplier(atFort);
  }

  affordable(id, atFort = false) {
    return this.cash >= this.priceOf(id, atFort);
  }

  buy(id, qty, atFort = false) {
    const g = GOODS_BY_ID[id];
    if (!g) return false;
    const q = Math.max(0, Math.floor(qty));
    if (q <= 0) return false;
    const cost = this.priceOf(id, atFort) * q;
    if (cost > this.cash + 1e-9) return false;
    this.cash -= cost;
    if (id === 'oxen') {
      this.oxen = Math.min(g.maxQty, this.oxen + q);
      // A fresh team at a fort has to improve the travel formula, not just
      // the bookkeeping. Without this, buying oxen was money for nothing.
      this.oxenStrength = Math.min(400, (this.oxenStrength || 0) + q);
    } else {
      this.goods[id] = Math.min(g.maxQty, (this.goods[id] || 0) + q);
    }
    return true;
  }

  sell(id, qty, atFort = false) {
    const g = GOODS_BY_ID[id];
    if (!g || id === 'oxen') return false;
    const have = this.goods[id] || 0;
    const q = Math.min(have, Math.max(0, Math.floor(qty)));
    if (q <= 0) return false;
    this.goods[id] = have - q;
    this.cash += this.priceOf(id, atFort) * q * 0.5;
    return true;
  }

  /* -- consumption ------------------------------------------------------- */
  consumeDaily(horizonDays) {
    const days = Math.max(1, Math.round(horizonDays));
    const aliveCount = Math.max(1, this.alive().length);
    const rationRate = RATIONS[this.ration].consumption;

    // Food: ration rate is per adult-equivalent; children and infants eat less.
    // A 900 lb wagon should carry a family most of the way, with hunting and
    // fort resupply making up the difference — as it did on the real trail.
    let perDay = 0;
    for (const p of this.alive()) perDay += (p.age < 6 ? 0.40 : p.age < 13 ? 0.68 : 1) * (rationRate / 5) * 0.92;
    const needed = perDay * days;
    const eaten = Math.min(this.goods.food, needed);
    const shortfall = Math.max(0, needed - eaten);
    this.goods.food = Math.max(0, this.goods.food - eaten);

    // Water: a keg is a large cask. Hot weather and dry country raise the need,
    // but a full complement of kegs should carry a family across the desert,
    // not evaporate in a single fortnight.
    const terrain = terrainFor(this.miles);
    const hot = this.temperature > 78 ? 1.35 : 1;
    const dry = terrain.id === 'basin' || terrain.id === 'plains' ? 1.3 : 1;
    const waterPerDay = aliveCount * 0.028 * hot * dry;
    this.goods.water = Math.max(0, this.goods.water - waterPerDay * days);

    // Animal feed: grazing severity climbs with mileage.
    const grazing = this.miles < 300 ? 0.35 : this.miles < 1000 ? 0.7 : 1.0;
    const feedPerDay = 0.42 * grazing * days;
    const fromFeed = Math.min(this.goods.feed, feedPerDay);
    this.goods.feed -= fromFeed;
    const unfed = feedPerDay - fromFeed;
  if (unfed > 0) this.oxenStrength -= unfed * 6;

    // Coffee and sundries lift morale, then run out.
    if (this.goods.coffee > 0) { this.goods.coffee = Math.max(0, this.goods.coffee - 0.24 * days); this.morale += 1; }
    if (this.goods.books > 0) { this.goods.books = Math.max(0, this.goods.books - 0.05 * days); this.morale += 0.5; }
    if (this.goods.blankets > 0) this.goods.blankets = Math.max(0, this.goods.blankets - 0.05 * days);

    // A meal only counts when the wagon can actually cover it. With a short
    // barrel the family eats what there is, gets no ration benefit, and the
    // shortfall is charged against health and morale for the unfed days.
    if (shortfall > 0.001) {
      const unfedDays = Math.max(1, Math.round(days * (shortfall / Math.max(needed, 0.001))));
      const bands = Math.ceil(unfedDays / 5);
      // Hunger is slower than thirst: it wears health down rather than
      // dropping a family where it stands. The hard starvation floor is what
      // ends an empty wagon; this is the grind in between.
      this.morale -= 12 * bands;
      for (const p of this.alive()) p.health -= 0.055 * bands;
      this.say(
        this.goods.food <= 0
          ? 'There is nothing left in the flour barrel.'
          : 'There is not enough in the barrel to feed everyone.',
        'bad',
      );
    } else {
      this.morale += RATIONS[this.ration].morale;
      // Rest and decent rations heal a little, so a bad turn is recoverable.
      // Only a fully fed family gets the benefit.
      if (this.ration !== 'basic') {
        const heal = this.ration === 'hearty' ? 0.055 : 0.03;
        for (const p of this.alive()) p.health = Math.min(1, p.health + heal);
      }
    }

    // Thirst is the sharper killer: an empty cask costs health faster than an
    // empty barrel, and unlike food it takes no hard floor to finish a party.
    if (this.goods.water <= 0) {
      this.morale -= 10;
      for (const p of this.alive()) p.health -= 0.13 * Math.ceil(days / 5);
    }

    this.clampState();
  }

  clampState() {
    this.morale = Math.max(0, Math.min(100, this.morale));
    for (const p of this.party) p.health = Math.max(0, Math.min(1, p.health));
    this.miles = Math.max(0, this.miles);
    const os = Number.isFinite(this.oxenStrength) ? this.oxenStrength : this.oxen;
    this.oxenStrength = Math.max(10, Math.min(400, os));
    // Guard the exit condition too: a non-finite mileage would stall the run.
    if (!Number.isFinite(this.miles)) this.miles = 0;
    if (!Number.isFinite(this.cash)) this.cash = 0;
  }

  /* -- one travel turn --------------------------------------------------- */
  /* --------------------------------------------------------------------------
     The turn state machine.

     The 1978 game demanded a decision every single turn, in this order:
       1. an ACTION  — stop at a fort, go hunting, or push on
       2. a MEAL     — eat poorly, moderately, or well
       3. then the hazards resolve

     This remake models that explicitly. `turnStage` walks the UI through the
     decisions, so a turn is never just "click travel".
     ------------------------------------------------------------------------ */
  beginTurn() {
    if (this.outcome) return;
    this.turn += 1;
    this.turnStage = 'action';
    this.blizzardThisTurn = false;
    // The fort option alternates on and off by turn, exactly as the original
    // toggled it with the X1 flag, so a fort is only reachable every other turn.
    this.fortAvailable = this.turn % 2 === 0;
    this.turnResolved = false;
  }

  /* Player's chosen action for this turn. */
  chooseAction(action) {
    if (this.turnStage !== 'action') return false;
    if (action === 'fort' && !this.fortAvailable) return false;
    if (action === 'hunt' && this.goods.bullets < 20) return false;
    this.turnAction = action;
    this.turnStage = 'meal';
    return true;
  }

  /* Player's meal choice for this turn. */
  chooseMeal(level) {
    if (this.turnStage !== 'meal') return false;
    if (!RATIONS[level]) return false;
    this.ration = level;
    // Food is consumed from stores across the turn rather than subtracted at
    // the table, so there is no per-meal cost to reject here. Starvation is
    // handled in consumeDaily; an empty larder must never dead-lock the turn.
    this.turnStage = 'travel';
    return true;
  }

  /* Runs the turn once all decisions are made. */
  resolveTurn() {
    if (this.outcome) return;
    if (this.turnResolved) return;
    this.turnResolved = true;
    this.log = [];

    // Action first: fort or hunt both cost the same 45 miles of progress.
    if (this.turnAction === 'fort') {
      this.miles -= FORT_TRAVEL_MILES;
      this.atFort = true;
    } else if (this.turnAction === 'hunt') {
      this.miles -= FORT_TRAVEL_MILES;
      this.huntPending = true;
    } else {
      this.atFort = false;
    }
    this.turnStage = 'resolved';
    return { huntPending: !!this.huntPending, atFort: !!this.atFort };
  }

  /* Called after a hunt resolves, to continue the turn. */
  resumeAfterHunt() {
    this.huntPending = false;
    this.travelTurn();
  }

  /* Called after fort trading closes, to continue the turn. */
  resumeAfterFort() {
    this.atFort = false;
    this.travelTurn();
  }

  /* Resolves a full travel turn. The presentation layer drives this through
     beginTurn -> chooseAction -> chooseMeal -> resolveTurn, but calling it
     directly is also valid (and is how the test suite exercises the sim): it
     auto-opens a turn and defaults the action and meal. */
  travelTurn() {
    if (this.outcome) return;
    if (this.turnStage !== 'resolved') {
      if (this.turnStage !== 'action') this.beginTurn();
      if (this.turnStage === 'action') { this.turnAction = this.turnAction || 'continue'; this.turnStage = 'meal'; }
      if (this.turnStage === 'meal') this.turnStage = 'travel';
    }
    if (!this.log.length) this.log = [];
    this.blizzardThisTurn = false;

    // The original rule, placed after the action has resolved: a wagon that
    // cannot muster a meal's worth of food starves where it stands. A fort
    // purchase or a good hunt earlier this turn can still rescue the party.
    if (this.goods.food < STARVATION_FOOD_FLOOR) {
      this.starveToDeath();
      return;
    }

    const startMiles = this.miles;
    const pace = PACE[this.pace];
    const terrain = terrainFor(this.miles);

    this.rollWeather();
    this.morale -= pace.morale;

    // Classic rate, then modern modifiers. The classic formula returns ~200
    // miles for a $250 team; a 1.15 remaster factor compensates for the modern
    // terrain, weather and health multipliers that would otherwise drag a
    // healthy wagon well under the original pace.
    const oxenFactor = this.oxenStrength ?? this.oxen;
    const raw = baseTravelMiles(oxenFactor, this.draw()) * 1.15;
    let gain = raw * pace.miles * terrain.miles;

    // Weight and weather penalties.
    const overload = Math.max(0, this.wagonWeight - 1400) / 1400;
    gain *= (1 - Math.min(0.22, overload));
    gain *= this.weatherSpeedFactor();
    gain *= 0.82 + 0.18 * this.healthAverage;

    // Washouts and lost trail.
    if (this.draw() < pace.missChance) { gain *= 0.55; this.say('You lose the ruts in the grass and burn an afternoon finding them again.', 'bad'); }
    if (this.weather === 'storm') { gain *= 0.6; }
    if (this.goods.water <= 0) gain *= 0.75;

    this.miles += gain;
    this.stats.milesWalked += gain;
    this.turnGain = gain;

    // Hard driving wears the team and the family. This is what makes a fast
    // pace a gamble rather than a free upgrade.
    if (pace.wear > 0) {
      this.oxenStrength -= pace.wear * (4 + this.draw() * 6);
      // Exhaustion wears every member, and a family already sick recovers
      // least. The frailty term is mild — it should matter over a whole run,
      // not doom a party in three turns.
      for (const p of this.alive()) {
        const frailty = 1 + (1 - p.health) * 0.9;
        p.health -= pace.wear * (0.014 + this.draw() * 0.018) * frailty;
      }
      this.goods.feed = Math.max(0, this.goods.feed - pace.wear * 3);
    }
    // Calendar time tracks the ground covered, but never falls below a
    // fortnight: camps, storms, fords and Sundays east the clock even on a
    // short hop. This restores the original's central tension, that a slow
    // wagon runs out of season before it runs out of trail.
    const covered = Math.max(0.22, Math.min(1.9, gain / 190));
    const segmentDays = DAYS_PER_TURN * covered * (0.82 + 0.36 * this.draw());
    this.totalDays += Math.max(6, Math.round(segmentDays));
    this.consumeDaily(segmentDays);

    // Only genuine collapse is fatal; illness handles its own mortality. The
    // check runs after eating so the starving family — who get no ration heal
    // — actually die, rather than being revived at the next cold meal.
    if (this.checkCollapse()) return;

    // Rider encounter (classic curve).
    if (!this.outcome && this.draw() <= riderProbability(this.miles)) {
      this.beginRiders();
      return;
    }

    if (!this.outcome) this.resolveRandomEvent();
    if (!this.outcome) this.mountainPhase();
    if (!this.outcome) this.finishTurn(startMiles);
  }

  /* Shared tail of every travel turn: landmark cards, then arrival / winter. */
  finishTurn(startMiles) {
    this.checkLandmarks(startMiles);
    if (this.hasLandmarkPending) {
      this.arrivedAt = this.pendingLandmarks[this.pendingLandmarks.length - 1];
      this.phase = 'landmark';
      return;
    }
    this.phase = 'travel';
    this.checkArrival();
  }

  weatherSpeedFactor() {
    switch (this.weather) {
      case 'storm': return 0.55;
      case 'rain': return 0.78;
      case 'snow': return 0.62;
      case 'heat': return 0.86;
      case 'fog': return 0.84;
      case 'overcast': return 0.95;
      default: return 1;
    }
  }

  rollWeather() {
    const t = terrainFor(this.miles);
    const r = this.draw();
    const d = this.date;
    const late = d.month >= 10 || (d.month === 9 && d.day > 15);
    const early = d.month <= 5;

    if (t.id === 'basin') {
      this.weather = r < 0.55 ? 'heat' : r < 0.8 ? 'clear' : 'overcast';
      this.temperature = 88 + this.drawInt(16);
    } else if (t.id === 'rockies' || t.id === 'divide' || t.id === 'blues' || t.id === 'gorge') {
      if (late) { this.weather = r < 0.5 ? 'snow' : r < 0.75 ? 'storm' : 'overcast'; this.temperature = 18 + this.drawInt(20); }
      else { this.weather = r < 0.3 ? 'rain' : r < 0.6 ? 'clear' : r < 0.8 ? 'overcast' : 'storm'; this.temperature = 44 + this.drawInt(20); }
    } else if (early && r > 0.72) {
      this.weather = r > 0.9 ? 'storm' : 'rain';
      this.temperature = 52 + this.drawInt(16);
    } else {
      this.weather = r < 0.42 ? 'clear' : r < 0.62 ? 'overcast' : r < 0.78 ? 'rain' : r < 0.9 ? 'heat' : 'fog';
      this.temperature = 58 + this.drawInt(24) - (late ? 14 : 0);
    }
  }

  /* -- riders (classic curve + modern tactics) --------------------------- */
  beginRiders() {
    this.s5 = this.draw() < 0.8 ? 0 : 1;
    this.phase = 'event';
    this.pendingEvent = {
      key: 'riders',
      title: 'Riders on the Horizon',
      body: this.s5 ? 'A band of riders watches your wagon without moving. They do not look friendly.'
                       : 'A band of riders approaches, hailing you. They look friendly enough.',
      choices: [
        { id: 'run',    label: 'Run for it' },
        { id: 'attack', label: 'Stand and fire' },
        { id: 'parley', label: 'Continue ahead' },
        { id: 'circle', label: 'Circle the wagons' },
      ],
    };
  }

  resolveRiders(choice) {
    const hostiles = this.s5 === 0;
    let title = 'The Riders Ride On';
    let body = '';
    let tone = 'plain';

    if (!hostiles) {
      this.stats.friendlyEncounters += 1;
      if (choice === 'run') { this.miles += 15; this.oxenStrength -= 10; body = 'You outrun them, but your team is blown for hours.'; }
      else if (choice === 'attack') { this.loseMiles(5); this.goods.bullets -= 100; body = 'You fire on friendly people. Word travels. You lose a day and good will.'; tone = 'bad'; this.morale -= 8; }
      else if (choice === 'circle') { this.loseMiles(20); body = 'You waste the day circling wagons against friends. They ride on, puzzled.'; tone = 'bad'; }
      else { body = 'You share coffee and news of the trail ahead. Both parties are richer for it.'; this.morale += 6; }
    } else {
      this.stats.hostileEncounters += 1;
      if (choice === 'run') {
        this.miles += 20; this.goods.medicine = Math.max(0, this.goods.medicine - 3);
        this.goods.bullets = Math.max(0, this.goods.bullets - 150); this.oxenStrength -= 40;
        body = 'You whip the team flat out. They take shots at your dust.'; tone = 'bad';
      } else if (choice === 'attack') {
        const roll = this.draw();
        this.goods.bullets = Math.max(0, this.goods.bullets - (roll * 40 + 80));
        if (roll < 0.22) { body = 'Cool under fire — you drive them off with the first volley.'; tone = 'good'; this.morale += 8; }
        else {
          body = 'A close fight. You are knifed in the shoulder before they break off.';
          this.flags.injured = true; tone = 'bad';
        }
      } else if (choice === 'circle') {
        const roll = this.draw();
        this.goods.bullets = Math.max(0, this.goods.bullets - (roll * 30 + 80));
        this.loseMiles(25);
        if (roll < 0.3) { body = 'Behind the wagon boxes, you hold them off. They lose heart.'; tone = 'good'; }
        else { body = 'They press hard all afternoon. You lose ground and ammunition.'; tone = 'bad'; }
      } else {
        if (this.draw() > 0.8) { body = 'They let you pass. Perhaps they only wanted toll.'; }
        else { this.goods.bullets = Math.max(0, this.goods.bullets - 150); this.goods.medicine = Math.max(0, this.goods.medicine - 15); body = 'They take ammunition and medicine as tribute and ride away.'; tone = 'bad'; }
      }
    }

    this.pendingEvent = null;
    this.phase = 'travel';
    this.say(title, tone);
    this.say(body, tone);
    if (this.goods.bullets <= 0 && hostiles && choice !== 'parley') {
      this.kill(0, 'shot through by riders with no powder left to answer them');
      return this.finishDeath();
    }
    this.clampState();
    this.resolveRandomEvent();
    if (!this.outcome) this.mountainPhase();
    if (!this.outcome) this.finishTurn(this.miles);
  }

  /* -- random event table ------------------------------------------------ */
  resolveRandomEvent() {
    const roll = 100 * this.draw();
    const idx = eventIndexForRoll(roll);
    const key = EVENT_IDS[idx];
    this.stats.eventsSuffered += 1;
    this.applyEvent(key);
  }

  applyEvent(key) {
    const g = this.goods;
    switch (key) {
      case 'wagon_breaks_down': {
        this.say('A wheel gives way in a dry creek bed.', 'bad');
        this.loseMiles(15 + 5 * this.draw());
        if (g.spareParts > 0) { g.spareParts -= 1; this.say('Your spare assembly makes short work of it.', 'good'); }
        else if (g.tools > 0) { g.tools -= 1; this.morale -= 4; this.say('You cut and fit a new spoke by firelight.', 'plain'); }
        else { this.morale -= 10; this.say('With no tools you improvise badly. Tempers fray.', 'bad'); }
        break;
      }
      case 'ox_injures_leg':
        this.say('An ox steps in a prairie-dog hole and lames itself.', 'bad');
        this.loseMiles(25); this.oxenStrength -= 20; break;
      case 'child_breaks_arm': {
        const kid = this.alive().filter((p) => p.age < 18)[0];
        this.say(`${kid ? kid.name : 'One of the children'} falls from the wagon and breaks an arm.`, 'bad');
        this.loseMiles(5 + 4 * this.draw());
        if (g.medicine > 0) g.medicine -= 1;
        if (kid) kid.health -= 0.2;
        this.morale -= 6;
        break;
      }
      case 'ox_wanders_off':
        this.say('An ox wanders off in the night.', 'bad');
        this.loseMiles(17); break;
      case 'child_gets_lost': {
        const kid = this.alive().filter((p) => p.age < 18)[0];
        this.say(`${kid ? kid.name : 'A child'} is missing. You spend half a day searching.`, 'bad');
        this.loseMiles(10); this.morale -= 5; break;
      }
      case 'unsafe_water':
        this.say('The water is foul. You strike out for a clean spring.', 'bad');
        this.loseMiles(10 * this.draw() + 2);
        this.illnessCheck(false); break;
      case 'weather_event':
        this.weatherIncident(); break;
      case 'bandits_attack': {
        this.say('Bandits come out of the willows.', 'bad');
        this.goods.bullets = Math.max(0, this.goods.bullets - (20 * this.drawInt(4) + 20));
        if (this.goods.bullets <= 0) { this.say('Out of powder, they take your cash.', 'bad'); this.cash = Math.floor(this.cash / 3); }
        else if (this.draw() < 0.4) { this.say('You are shot in the leg. They take an ox.', 'bad'); this.flags.injured = true; this.oxenStrength -= 20; }
        else { this.say('A quick and lucky draw sends them running.', 'good'); this.morale += 5; }
        break;
      }
      case 'fire_in_wagon':
        this.say('A campfire catches the wagon canvas.', 'bad');
        g.food = Math.max(0, g.food - 40); g.bullets = Math.max(0, g.bullets - 200);
        g.tools = Math.max(0, g.tools - 1); this.loseMiles(15); break;
      case 'lose_way_in_fog':
        this.say('Heavy fog. You wander until the sun burns through.', 'bad');
        this.loseMiles(10 + 5 * this.draw()); break;
      case 'poisonous_snake': {
        const victim = this.alive()[this.drawInt(this.alive().length)];
        this.say(`A rattler strikes ${victim ? victim.name : 'a child'} at the woodpile.`, 'bad');
        if (g.medicine > 0) { g.medicine -= 2; this.say('Laudanum and a steady hand save the day.', 'good'); victim && (victim.health -= 0.15); }
        else { this.say('With no medicine, the poison runs its course.', 'bad'); victim && (victim.health -= 0.55); this.morale -= 8; }
        break;
      }
      case 'wagon_swamped':
        this.say('The wagon swamps at a bad ford.', 'bad');
        g.food = Math.max(0, g.food - 30); g.clothing = Math.max(0, g.clothing - 20);
        this.loseMiles(20 + 20 * this.draw()); break;
      case 'wild_animals':
        this.wildAnimals(); break;
      case 'hail_storm':
        this.say('Hail like musket balls. The canvas is shredded.', 'bad');
        this.loseMiles(5 + 10 * this.draw());
        g.bullets = Math.max(0, g.bullets - 200);
        g.glassware = 0;
        this.morale -= 4; break;
      case 'illness_check':
        this.illnessCheck(true); break;
      case 'helpful_friends':
        this.say('A band of friendly people shows you where the game is thick.', 'good');
        g.food += 14; this.morale += 5; break;
    }
    this.clampState();
  }

  weatherIncident() {
    this.say('The weather turns hard against you.', 'bad');
    if (this.miles > 950) {
      if (this.goods.clothing + this.goods.blankets * 4 < 22 + 4 * this.draw()) {
        this.say('Cold enough to freeze the water in the barrel. You have not enough wool.', 'bad');
        this.illnessCheck(true);
      }
    } else {
      this.goods.food = Math.max(0, this.goods.food - 10);
      this.goods.bullets = Math.max(0, this.goods.bullets - 50);
      this.loseMiles(10 * this.draw() + 5);
    }
  }

  wildAnimals() {
    this.say('Wolves come for the oxen in the dark.', 'bad');
    if (this.goods.bullets < 40) {
      this.say('Too few bullets to hold them off.', 'bad');
      this.flags.injured = true;
      this.oxenStrength -= 60;
      const victim = this.alive()[this.drawInt(this.alive().length)];
      if (victim) victim.health -= 0.3;
      this.morale -= 10;
      return;
    }
    const skill = this.drawInt(5);
    this.goods.bullets = Math.max(0, this.goods.bullets - (20 * skill + 30));
    if (skill <= 1) { this.say('You drop two in the firelight. The pack scatters.', 'good'); this.goods.food += 20; this.morale += 5; }
    else { this.say('They get at the food and clothing before you drive them off.', 'bad'); this.goods.food = Math.max(0, this.goods.food - 8 * skill); this.goods.clothing = Math.max(0, this.goods.clothing - 4 * skill); }
  }

  /* -- illness ----------------------------------------------------------- */
  illnessCheck(force = false) {
    const level = { basic: 1, moderate: 2, hearty: 3 }[this.ration];
    const paceMod = PACE[this.pace].illness;
    const medicineHelps = this.goods.medicine > 0;
    // A party already worn down resists illness less than a rested one, but
    // this must not spiral: 40% extra risk at half health is plenty.
    const fatigue = 1 + (1 - this.healthAverage) * 0.8;

    const mildCut = (10 + 35 * (level - 1)) * paceMod * fatigue;
    const badCut = 100 - 40 / 4 ** (level - 1);

    const r1 = 100 * this.draw();
    if (r1 < mildCut) {
      this.goods.medicine = Math.max(0, this.goods.medicine - (medicineHelps ? 1 : 0));
      this.miles -= 5;
      const p = this.alive()[this.drawInt(this.alive().length)];
      if (p) p.health -= 0.10;
      this.say('Mild illness passes through the camp. Medicine is used.', 'plain');
      return;
    }
    if (100 * this.draw() < badCut) {
      const p = this.alive()[this.drawInt(this.alive().length)];
      if (p) p.health -= 0.28;
      this.goods.medicine = Math.max(0, this.goods.medicine - 4);
      this.miles -= 5;
      this.say('A hard fever. You stop a day and dose the sick.', 'bad');
      if (p && p.health <= 0) this.kill(this.party.indexOf(p), 'of fever');
      return;
    }
    if (medicineHelps) {
      const p = this.alive()[this.drawInt(this.alive().length)];
      if (p) p.health -= 0.45;
      this.goods.medicine = Math.max(0, this.goods.medicine - 8);
      this.flags.injured = true;
      this.say('Serious illness. You halt for medical attention.', 'bad');
      if (p && p.health <= 0) this.kill(this.party.indexOf(p), 'of a wasting sickness');
      return;
    }
    this.say('Dysentery. Without medicine there is nothing to be done.', 'bad');
    const p = this.alive()[this.drawInt(this.alive().length)];
    if (p) { p.health -= 0.6; this.morale -= 10; if (p.health <= 0) this.kill(this.party.indexOf(p), 'of dysentery'); }
  }

  kill(index, cause) {
    const p = this.party[index];
    if (!p || !p.alive) return;
    p.alive = false; p.health = 0;
    this.dead.push({ name: p.name, cause });
    this.morale -= 26;
    this.say(`${p.name} dies ${cause}. You bury them beside the trail.`, 'death');
    if (this.alive().length === 0) { this.morale = 0; this.finishDeath(); }
    this.clampState();
  }

  /* The classic ending: no food, no travel, no survivors. */
  starveToDeath() {
    if (this.outcome) return true;
    this.say('You ran out of food and starved to death.', 'death');
    for (const p of this.party) {
      if (!p.alive) continue;
      p.alive = false;
      p.health = 0;
      this.dead.push({ name: p.name, cause: 'of starvation' });
    }
    this.morale = 0;
    this.finishDeath();
    return true;
  }

  /* Deaths from starvation, thirst or exhaustion, checked after the meal. */
  checkCollapse() {
    for (const p of this.alive()) {
      if (p.health <= 0.001) this.kill(this.party.indexOf(p), 'of exhaustion and fever');
    }
    return !!this.outcome;
  }

  finishDeath() {
    if (this.outcome) return;
    this.outcome = 'died';
    this.phase = 'end';
  }

  /* -- mountains --------------------------------------------------------- */
  /* The 1978 check fires often in the final third of the trail, so its result
     must be a genuine roll, not a standing tax. Each outcome here is a real
     setback, but the common branch is a *delay* rather than a reversal. */
  mountainPhase() {
    if (this.miles <= 950) return;
    if (10 * this.draw() <= 9 - ((this.miles / 100 - 15) ** 2 + 72) / ((this.miles / 100 - 15) ** 2 + 12)) {
      const r = this.draw();
      if (r <= 0.1) { this.say('You lose the trail entirely among the ridges.', 'bad'); this.loseMiles(60); }
      else if (r <= 0.21) { this.say('A wagon axle snaps on a granite shelf.', 'bad'); this.goods.tools = Math.max(0, this.goods.tools - 1); this.goods.bullets = Math.max(0, this.goods.bullets - 200); this.loseMiles(20 + 30 * this.draw()); }
      else { this.say('Rugged mountains. The going is slow and cruel.', 'plain'); this.loseMiles(12 + this.draw() * 20); }
    }

    if (!this.southPassCleared) {
      this.southPassCleared = true;
      if (this.draw() < 0.8) this.blizzard('South Pass');
      else this.say('You cross South Pass under clear skies. The Divide is behind you.', 'good');
    }
    if (this.miles >= 1700 && !this.blueMountainsCleared) {
      this.blueMountainsCleared = true;
      if (this.draw() < 0.7) this.blizzard('the Blue Mountains');
      else this.say('You get through the Blue Mountains before the snows close in.', 'good');
    }
  }

  blizzard(where) {
    this.say(`A blizzard takes you in ${where}.`, 'bad');
    this.blizzardThisTurn = true;
    this.goods.food = Math.max(0, this.goods.food - 25);
    this.goods.medicine = Math.max(0, this.goods.medicine - 10);
    this.goods.bullets = Math.max(0, this.goods.bullets - 300);
    this.loseMiles(30 + 40 * this.draw());
    // Cold is proportional to clothing, blankets and — crucially — how worn the
    // party already is. A family that has been driven hard cannot take the cold.
    const warmth = this.goods.clothing + this.goods.blankets * 3.5;
    const exhaustion = (1 - this.healthAverage) * 12;
    if (warmth < 18 + 2 * this.draw() + exhaustion) this.illnessCheck(true);
  }

  /* -- landmarks --------------------------------------------------------- */
  /* Marks every landmark newly reached this turn. Records only the furthest so
     the journal surfaces the most significant arrival. Never mutates phase, so
     it is safe to call from the middle of a hazard chain. */
  checkLandmarks(previousMiles) {
    for (const l of this.landmarks) {
      if (!l.visited && l.miles <= this.miles && l.miles > previousMiles) {
        l.visited = true;
        this.arrivedAt = l;
        // Reaching a landmark is an achievement; it lifts the party.
        const lift = l.kind === 'fort' ? 7 : l.kind === 'town' ? 10 : 5;
        this.morale = Math.min(100, this.morale + lift);
        this.pendingLandmarks = (this.pendingLandmarks || []);
        this.pendingLandmarks.push(l);
      }
    }
  }

  /* A spring is a real halt: the family drinks its fill and refills every keg.
     Forts and towns top up from their wells and barrels. Without this the
     party began the journey with the only water it would ever see and died of
     thirst on the high desert no matter how it played. */
  refillWater(lm) {
    if (!lm) return;
    if (lm.kind !== 'spring' && lm.kind !== 'fort' && lm.kind !== 'town') return;
    const target = lm.kind === 'spring' ? WATER_KEG_CAP : Math.max(this.goods.water, WATER_KEG_CAP * 0.6);
    if (this.goods.water >= target) return;
    const before = this.goods.water;
    this.goods.water = target;
    if (target - before > 0.5) this.say('You fill every keg from the cask and water the team.', 'good');
  }

  /* Called by the view layer once a landmark card has been dismissed. */
  continueFromLandmark() {
    this.refillWater(this.arrivedAt);
    this.arrivedAt = null;
    this.pendingLandmarks = [];
    if (this.phase === 'landmark') {
      this.phase = 'travel';
      this.checkArrival();
    }
  }

  /* True when a landmark card is waiting to be shown. */
  get hasLandmarkPending() {
    return !!(this.pendingLandmarks && this.pendingLandmarks.length);
  }

  /* -- arrival ----------------------------------------------------------- */
  checkArrival() {
    if (this.outcome) return;
    // A landmark card outranks a normal travel phase, but never a death.
    if (this.miles >= TOTAL_MILES) {
      this.outcome = 'arrived';
      this.phase = 'end';
      // Reaching Oregon is a triumph, not a grind to the finish line: the end
      // of the trail lifts the party's spirits and their health a little.
      this.morale = Math.min(100, this.morale + 35);
      for (const p of this.alive()) p.health = Math.min(1, p.health + 0.2);
      this.say('You have come to Oregon City. 2,040 miles behind you.', 'good');
      return;
    }
    // Authentic rule: the trail closes with the first hard winter snows. The
    // 1978 program used a fixed 20-fortnight counter ending in December; here
    // the calendar governs. Early November is the historical cutoff — wagons
    // still on the trail when the Blue Mountains snowed in did not get through.
    const d = this.date;
    const closed = d.month > 11 || (d.month === 11 && d.day >= 5) || this.turn > MAX_TURNS + 3;
    if (closed) {
      this.outcome = 'winter';
      this.phase = 'end';
      this.say('Winter closes the passes. The first great blizzard finds your family on the trail.', 'death');
    }
  }

  /* -- hunting ----------------------------------------------------------- */
  huntOutcome(accuracy) {
    // accuracy: 0..1 from the aim minigame.
    this.stats.hunted += 1;
    this.miles -= 12;
    this.goods.bullets = Math.max(0, this.goods.bullets - Math.round(15 * (1 - accuracy)));
    if (accuracy > 0.82) {
      const meat = Math.round(74 + this.draw() * 22);
      this.goods.food += meat;
      this.stats.meatTaken += meat;
      return { hit: 'killing', meat, text: 'A clean heart shot. You have meat for days.' };
    }
    if (accuracy > 0.5) {
      const meat = Math.round(44 + this.draw() * 24);
      this.goods.food += meat;
      this.stats.meatTaken += meat;
      return { hit: 'solid', meat, text: 'A good hit. You dress it out before dusk.' };
    }
    if (accuracy > 0.25) {
      const meat = Math.round(18 + this.draw() * 16);
      this.goods.food += meat;
      this.stats.meatTaken += meat;
      return { hit: 'grazing', meat, text: 'A glancing shot. You take what you can carry.' };
    }
    return { hit: 'miss', meat: 0, text: 'The shot goes wide. Your dinner is running for the hills.' };
  }

  /* -- river crossings --------------------------------------------------- */
  fordRiver(landmark) {
    const depth = 0.4 + this.draw() * 0.7;
    const risk = depth * (this.wagonWeight / 2000 + 0.4);
    this.stats.riversFords += 1;
    if (this.draw() < risk) {
      this.goods.food = Math.max(0, this.goods.food - 30);
      this.goods.clothing = Math.max(0, this.goods.clothing - 10);
      this.miles -= 10;
      this.morale -= 8;
      this.say(`You ford ${landmark.name} and nearly lose the wagon.`, 'bad');
    } else {
      this.say(`You ford ${landmark.name} safely, water to the axles.`, 'good');
    }
  }

  ferryRiver(landmark) {
    const cost = 12 + Math.round(this.draw() * 18);
    if (this.cash >= cost) {
      this.cash -= cost; this.stats.riversFerried += 1;
      this.say(`You pay $${cost} for the ferry at ${landmark.name}.`, 'plain');
    } else {
      this.say('You cannot afford the ferry. You must ford.', 'bad');
      this.fordRiver(landmark);
    }
  }

  caulkWagon(landmark) {
    if (this.goods.tools <= 0) { this.say('With no tools you cannot caulk the wagon.', 'bad'); return; }
    this.goods.tools -= 1;
    this.stats.riversFords += 1;
    this.miles -= 15;
    if (this.draw() < 0.3) { this.goods.food = Math.max(0, this.goods.food - 15); this.say('The caulking fails and you take on water.', 'bad'); }
    else this.say('You caulk the seams with tar and float across.', 'good');
  }

  /* -- fort rest --------------------------------------------------------- */
  restAtFort(days = 3) {
    const cost = days * 3;
    if (this.cash < cost) { this.say('You cannot afford to rest here.', 'bad'); return; }
    this.cash -= cost;
    this.morale += days * 5;
    for (const p of this.alive()) p.health += days * 0.08;
    this.totalDays += days;
    this.miles -= days * 2;
    this.say(`You rest ${days} days at camp. Everyone mends a little.`, 'good');
    this.clampState();
  }

  /* -- scoring ----------------------------------------------------------- */
  score() {
    if (this.outcome === 'arrived') {
      const survivors = this.alive().length;
      const health = this.healthAverage * 100;
      const milesPart = 400;
      const healthPart = health * 1.4;
      const moralePart = this.morale * 1.2;
      const cashPart = Math.min(200, this.cash * 0.5);
      const timePart = Math.max(0, (300 - this.totalDays)) * 1.5;
      const base = milesPart + healthPart + moralePart + cashPart + timePart;
      return {
        rank: survivors === 5 ? 'Pioneer of the First Rank' : survivors >= 3 ? 'Pioneer' : 'Survivor',
        survivors, score: Math.round(base + survivors * 120),
        parts: { milesPart, healthPart, moralePart, cashPart, timePart, survivors },
      };
    }
    const progress = Math.min(1, this.miles / TOTAL_MILES);
    return {
      rank: this.outcome === 'winter' ? 'Lost to Winter' : 'Lost on the Trail',
      survivors: this.alive().length,
      score: Math.round(progress * 500 + this.alive().length * 60),
      parts: { progress, survivors: this.alive().length },
    };
  }

  /* -- snapshots for the view layer -------------------------------------- */
  snapshot() {
    const late = this.date.month >= 9;
    return {
      phase: this.phase,
      outcome: this.outcome,
      miles: Math.round(this.miles),
      milesRemaining: Math.max(0, TOTAL_MILES - Math.round(this.miles)),
      progress: Math.min(1, this.miles / TOTAL_MILES),
      turn: this.turn,
      date: this.dateLabel,
      dateShort: formatDateShort(this.date.year, this.date.month, this.date.day),
      totalDays: this.totalDays,
      cash: Math.round(this.cash),
      goods: { ...this.goods },
      oxenStrength: Math.round(this.oxenStrength ?? this.oxen),
      oxen: this.oxen,
      party: this.party.map((p) => ({ ...p })),
      alive: this.alive().length,
      morale: Math.round(this.morale),
      weather: this.weather,
      temperature: this.temperature,
      terrain: terrainFor(this.miles),
      pace: this.pace,
      ration: this.ration,
      currentLandmark: this.currentLandmark,
      nextLandmark: this.nextLandmark,
      arrivedAt: this.arrivedAt || null,
      pendingEvent: this.pendingEvent || null,
      turnStage: this.turnStage,
      turnAction: this.turnAction,
      fortAvailable: this.fortAvailable,
      atFort: this.atFort,
      huntPending: this.huntPending,
      log: this.log.slice(-40),
      season: late ? 'Late Season — passes may close' : 'Open Season',
      wagonWeight: Math.round(this.wagonWeight),
      stats: { ...this.stats },
    };
  }
}
