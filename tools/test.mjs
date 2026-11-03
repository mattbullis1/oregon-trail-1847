#!/usr/bin/env node
/* tools.test.mjs — engine verification. Run: node tools/test.mjs */
import {
  OregonTrailGame, mulberry32, riderProbability, mountainProbability,
  baseTravelMiles, eventIndexForRoll, addDays, formatDate, weekdayIndex,
  GOODS, STARTER_LOADOUT, TOTAL_MILES, LANDMARKS, terrainFor,
} from '../js/engine.js';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`PASS  ${name}`); pass += 1; }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); fail += 1; }
};
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, tol = 1e-9, m = '') => { if (Math.abs(a - b) > tol) throw new Error(`${m} expected ~${b}, got ${a}`); };

/* ---- RNG ------------------------------------------------------------- */
t('mulberry32 is deterministic for a seed', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 50; i += 1) eq(a(), b());
});
t('mulberry32 stays in [0,1)', () => {
  const r = mulberry32(7);
  for (let i = 0; i < 5000; i += 1) { const v = r(); ok(v >= 0 && v < 1, `out of range: ${v}`); }
});

/* ---- classic curves -------------------------------------------------- */
t('riderProbability peaks at 400 miles and tapers both ways', () => {
  const peak = riderProbability(400);
  near(peak, 0.5, 1e-9, 'peak');
  ok(peak > riderProbability(100), 'peak should exceed early trail');
  ok(peak > riderProbability(1900), 'peak should exceed late trail');
  ok(riderProbability(950) > riderProbability(1600), 'should decline past the divide');
});
t('mountainProbability is gated and severe late in the trail', () => {
  // The 1978 check only runs when M > 950, so only the values past that matter.
  ok(mountainProbability(1900) > mountainProbability(1500), 'should climb again into the Blues');
  ok(mountainProbability(2040) > 0.6, 'the final approach should be dangerous');
  ok(mountainProbability(950) < 0.7, 'South Pass itself should be passable');
});
t('baseTravelMiles matches 1978 formula', () => {
  near(baseTravelMiles(250, 0), 200 + 30 / 5);
  near(baseTravelMiles(220, 1), 210);
});
t('eventIndexForRoll maps the published thresholds', () => {
  eq(eventIndexForRoll(1), 0);
  eq(eventIndexForRoll(6), 0);
  eq(eventIndexForRoll(7), 1);
  eq(eventIndexForRoll(95), 14);
  eq(eventIndexForRoll(99), 15);
});

/* ---- calendar -------------------------------------------------------- */
t('March 29 1847 is a Monday', () => eq(formatDate(1847, 3, 29), 'Monday, March 29, 1847'));
t('addDays handles month and year rollover', () => {
  eq(addDays(1847, 12, 25, 10).year, 1848);
  eq(addDays(1847, 12, 25, 10).month, 1);
  eq(addDays(1847, 12, 25, 10).day, 4);
});
t('weekdayIndex is stable for a known date', () => eq(weekdayIndex(2000, 1, 1), 5)); // Saturday

/* ---- terrain --------------------------------------------------------- */
t('terrainFor covers the whole trail', () => {
  eq(terrainFor(0).id, 'prairie');
  eq(terrainFor(2040).id, 'gorge');
  eq(terrainFor(700).id, 'rockies');
});

/* ---- game construction ----------------------------------------------- */
t('new game starts in outfit phase with full cash', () => {
  const g = new OregonTrailGame({ seed: 1 });
  eq(g.phase, 'outfit'); eq(g.cash, 700); eq(g.miles, 0);
});
t('starter loadout is affordable and valid', () => {
  const g = new OregonTrailGame({ seed: 2 });
  const cost = g.loadoutCost(STARTER_LOADOUT);
  ok(cost <= 700, `starter loadout costs ${cost}, should be <= 700`);
  ok(cost > 400, 'starter loadout should be substantial');
});
t('outfitting assignment works and leaves travel phase', () => {
  const g = new OregonTrailGame({ seed: 3 });
  g.setOutfit(STARTER_LOADOUT);
  eq(g.phase, 'travel');
  eq(g.goods.food, STARTER_LOADOUT.food);
  eq(g.oxen, STARTER_LOADOUT.oxen);
});

/* ---- buying / selling ------------------------------------------------ */
t('buying deducts cash and adds goods', () => {
  const g = new OregonTrailGame({ seed: 4 });
  g.setOutfit({ ...STARTER_LOADOUT, food: 0 });
  const before = g.cash;
  ok(g.buy('food', 100, false), 'buy should succeed');
  eq(g.goods.food, 100);
  ok(g.cash < before, 'cash should drop');
});
t('cannot buy more than cash allows', () => {
  const g = new OregonTrailGame({ seed: 5 });
  g.setOutfit(STARTER_LOADOUT);
  const c0 = g.cash;
  eq(g.buy('food', 100000, false), false, 'a purchase far beyond cash should fail');
  eq(g.cash, c0, 'failed purchase must not change cash');
});
t('fort prices exceed trail prices', () => {
  const g = new OregonTrailGame({ seed: 6 });
  ok(g.priceOf('food', true) > g.priceOf('food', false));
});
t('buying a fresh team at a fort restores oxen strength', () => {
  const g = new OregonTrailGame({ seed: 7 });
  g.setOutfit({ ...STARTER_LOADOUT, oxen: 300 });
  g.oxenStrength -= 80;
  const before = g.oxenStrength;
  ok(g.buy('oxen', 50, true), 'oxen purchase should succeed');
  ok(g.oxenStrength > before, `oxenStrength should rise from ${before}, got ${g.oxenStrength}`);
});
t('selling returns cash at half price', () => {
  const g = new OregonTrailGame({ seed: 7 });
  g.setOutfit({ ...STARTER_LOADOUT, food: 100 });
  const c0 = g.cash;
  ok(g.sell('food', 100, false));
  eq(g.goods.food, 0);
  ok(g.cash > c0);
});

/* ---- a full deterministic run ---------------------------------------- */
/* Auto-play: buy food at every fort while the barrel is light, hunt as a last
   resort, and never let the wagon roll on an empty larder. */
function playFullRun(seed, strategy = {}) {
  const g = new OregonTrailGame({ seed });
  g.setOutfit(strategy.loadout || STARTER_LOADOUT);
  const buyBelow = strategy.buyBelow ?? 900;
  let guard = 0;
  while (!g.outcome && guard < 60) {
    guard += 1;
    if (g.pendingEvent) {
      const key = g.pendingEvent.key;
      if (key === 'riders') g.resolveRiders(strategy.riders || 'parley');
      else { g.pendingEvent = null; g.phase = 'travel'; g.finishTurn(g.miles - 1); }
      continue;
    }
    if (g.hasLandmarkPending) { g.continueFromLandmark(); continue; }
    if (g.phase === 'travel') {
      if (g.turnStage === 'idle' || g.turnStage === 'resolved') g.beginTurn();
      if (g.turnStage === 'action') {
        if (g.fortAvailable && g.goods.food < buyBelow) {
          if (g.chooseAction('fort')) g.buy('food', 400, true);
        } else if (g.goods.food < 60 && g.chooseAction('hunt')) {
          g.huntOutcome(0.9);
          g.huntPending = false;
        } else {
          g.chooseAction('continue');
        }
      }
      if (g.turnStage === 'meal') g.chooseMeal(strategy.meal || 'moderate');
      if (g.turnStage === 'travel') { g.resolveTurn(); g.travelTurn(); continue; }
      break;
    }
    break;
  }
  return g;
}

t('a run always terminates with an outcome', () => {
  for (let s = 1; s <= 40; s += 1) {
    const g = playFullRun(s);
    ok(g.outcome, `seed ${s} produced no outcome (phase=${g.phase}, turn=${g.turn})`);
  }
});
t('deterministic: same seed yields identical outcome', () => {
  for (let s = 1; s <= 12; s += 1) {
    const a = playFullRun(s * 11), b = playFullRun(s * 11);
    eq(a.outcome, b.outcome, `seed ${s}`);
    eq(Math.round(a.miles), Math.round(b.miles), `seed ${s} miles`);
    eq(a.alive().length, b.alive().length, `seed ${s} survivors`);
  }
});
t('a generous, well-supplied run can reach Oregon', () => {
  let arrivals = 0;
  for (let s = 1; s <= 60; s += 1) {
    const g = playFullRun(s * 3, { loadout: { ...STARTER_LOADOUT, oxen: 300, food: 1200 }, riders: 'circle' });
    if (g.outcome === 'arrived') arrivals += 1;
  }
  ok(arrivals > 0, 'no run ever arrived; travel is too punishing');
});
t('mileage never goes negative during a run', () => {
  for (let s = 1; s <= 30; s += 1) {
    const g = new OregonTrailGame({ seed: s });
    g.setOutfit(STARTER_LOADOUT);
    let guard = 0;
    while (!g.outcome && guard < 60) {
      guard += 1;
      if (g.phase === 'event' && g.pendingEvent) { g.resolveRiders('run'); continue; }
      if (g.phase === 'landmark') { g.continueFromLandmark(); continue; }
      if (g.phase === 'travel') { g.travelTurn(); continue; }
      break;
    }
    ok(g.miles >= 0, `seed ${s} ended with ${g.miles} miles`);
  }
});
/* ---- the turn decision loop ------------------------------------------ */
t('a turn walks action -> meal -> travel', () => {
  const g = new OregonTrailGame({ seed: 100 });
  g.setOutfit(STARTER_LOADOUT);
  g.beginTurn();
  eq(g.turnStage, 'action');
  ok(g.chooseAction('continue'), 'continue should be accepted');
  eq(g.turnStage, 'meal');
  ok(g.chooseMeal('moderate'), 'a valid meal should be accepted');
  eq(g.turnStage, 'travel');
  g.resolveTurn();
  eq(g.turnStage, 'resolved');
});
t('the fort option only appears on alternating turns', () => {
  const g = new OregonTrailGame({ seed: 101 });
  g.setOutfit(STARTER_LOADOUT);
  const flags = [];
  for (let i = 0; i < 6; i += 1) { g.beginTurn(); flags.push(g.fortAvailable); g.travelTurn(); }
  eq(flags.join(','), 'false,true,false,true,false,true');
});
t('choosing a fort when unavailable is rejected', () => {
  const g = new OregonTrailGame({ seed: 102 });
  g.setOutfit(STARTER_LOADOUT);
  g.beginTurn();
  if (g.fortAvailable) g.beginTurn();
  eq(g.chooseAction('fort'), false, 'fort should be unavailable on odd turns');
});
t('hunting is refused without ammunition', () => {
  const g = new OregonTrailGame({ seed: 103 });
  g.setOutfit({ ...STARTER_LOADOUT, bullets: 0 });
  g.beginTurn();
  if (!g.fortAvailable) { /* odd turn: fort unavailable, try hunt */ }
  eq(g.chooseAction('hunt'), false, 'hunt needs bullets');
  ok(g.chooseAction('continue'), 'continue always works');
});
t('an action must be chosen before a meal', () => {
  const g = new OregonTrailGame({ seed: 104 });
  g.setOutfit(STARTER_LOADOUT);
  g.beginTurn();
  eq(g.chooseMeal('moderate'), false, 'meal is out of order');
  ok(g.chooseAction('continue'));
  ok(g.chooseMeal('moderate'));
});
t('an empty larder never dead-locks the meal choice', () => {
  const g = new OregonTrailGame({ seed: 107 });
  g.setOutfit({ ...STARTER_LOADOUT, food: 0 });
  g.beginTurn();
  ok(g.chooseAction('continue'));
  ok(g.chooseMeal('moderate'), 'the family must still be able to choose a meal');
  eq(g.turnStage, 'travel');
});
t('a wagon with no food starves instead of reaching Oregon', () => {
  for (let s = 1; s <= 12; s += 1) {
    const g = new OregonTrailGame({ seed: s });
    g.setOutfit({ ...STARTER_LOADOUT, food: 0 });
    let guard = 0;
    while (!g.outcome && guard < 90) {
      guard += 1;
      if (g.pendingEvent) {
        if (g.pendingEvent.key === 'riders') g.resolveRiders('parley');
        else { g.pendingEvent = null; g.phase = 'travel'; g.finishTurn(g.miles - 1); }
        continue;
      }
      if (g.hasLandmarkPending) { g.continueFromLandmark(); continue; }
      if (g.turnStage === 'idle' || g.turnStage === 'resolved') g.beginTurn();
      if (g.turnStage === 'action') g.chooseAction('continue');
      if (g.turnStage === 'meal') g.chooseMeal('hearty');
      if (g.turnStage === 'travel') { g.resolveTurn(); g.travelTurn(); continue; }
      break;
    }
    eq(g.outcome, 'died', `seed ${s} should starve, got ${g.outcome} at ${g.miles} mi`);
    eq(g.alive().length, 0, `seed ${s} should lose the whole party`);
    ok(g.goods.food >= 0, `seed ${s} food must stay non-negative`);
  }
});
t('a meal eaten on an empty larder gives no healing or morale', () => {
  const g = new OregonTrailGame({ seed: 108 });
  g.setOutfit({ ...STARTER_LOADOUT, food: 0 });
  g.ration = 'hearty';
  const h0 = g.healthAverage, m0 = g.morale;
  g.consumeDaily(14);
  ok(g.healthAverage < h0, 'a starving family must lose health');
  ok(g.morale < m0, 'a starving family must lose morale');
});
t('a fully fed hearty meal still heals and lifts morale', () => {
  const g = new OregonTrailGame({ seed: 109 });
  g.setOutfit({ ...STARTER_LOADOUT, food: 2000 });
  g.ration = 'hearty';
  for (const p of g.party) p.health = 0.6;
  const h0 = g.healthAverage, m0 = g.morale;
  g.consumeDaily(7);
  ok(g.healthAverage > h0, 'a fed family should heal');
  ok(g.morale > m0, 'a hearty meal should lift morale');
});
t('a fort stop can still rescue a party below the starvation floor', () => {
  const g = new OregonTrailGame({ seed: 110 });
  g.setOutfit({ ...STARTER_LOADOUT, food: 12 });
  let guard = 0;
  while (!g.fortAvailable && guard < 5) { g.beginTurn(); guard += 1; }
  ok(g.fortAvailable, 'a fort turn must be reachable');
  ok(g.chooseAction('fort'));
  ok(g.chooseMeal('hearty'));
  g.resolveTurn();
  ok(g.buy('food', 200, true), 'the party should be able to buy food at the fort');
  g.resumeAfterFort();
  ok(!g.outcome, 'a fed party must not starve');
  ok(g.miles > 0, 'the wagon should still travel after the fort');
});
t('a fort stop and a hunt each cost 45 miles', () => {
  for (const [action, guardFort] of [['fort', true], ['hunt', false]]) {
    const g = new OregonTrailGame({ seed: 105 });
    g.setOutfit(STARTER_LOADOUT);
    g.miles = 800;
    g.beginTurn();
    if (action === 'fort') {
      if (!g.fortAvailable) g.beginTurn();
      if (!g.chooseAction('fort')) { g.chooseAction('hunt'); }
    } else {
      g.chooseAction('hunt');
    }
    const before = g.miles;
    const r = g.resolveTurn();
    ok(before - g.miles === 45, `${action} should cost exactly 45 miles, lost ${before - g.miles}`);
    if (action === 'hunt') ok(r.huntPending, 'hunt should flag pending');
  }
});
t('resolveTurn is idempotent', () => {
  const g = new OregonTrailGame({ seed: 106 });
  g.setOutfit(STARTER_LOADOUT);
  g.miles = 500;
  g.beginTurn();
  g.chooseAction('continue');
  g.chooseMeal('moderate');
  g.resolveTurn();
  const after = g.miles;
  g.resolveTurn();
  eq(g.miles, after, 'a second resolveTurn must not double-apply');
});

t('a long run never accumulates NaN in any tracked quantity', () => {
  for (const pace of ['gentle', 'steady', 'brisk', 'gruelling']) {
    for (let s = 1; s <= 25; s += 1) {
      const g = new OregonTrailGame({ seed: s * 7 });
      g.setOutfit(STARTER_LOADOUT);
      g.pace = pace;
      let guard = 0;
      while (!g.outcome && guard < 80) {
        guard += 1;
        if (g.pendingEvent) { g.resolveRiders('circle'); continue; }
        if (g.hasLandmarkPending) { g.continueFromLandmark(); continue; }
        if (g.phase === 'travel') { g.travelTurn(); continue; }
        break;
      }
      for (const [k, v] of Object.entries({
        miles: g.miles, cash: g.cash, oxenStrength: g.oxenStrength,
        morale: g.morale, turnGain: g.turnGain, totalDays: g.totalDays,
      })) {
        ok(Number.isFinite(v), `${pace} seed ${s}: ${k} is ${v}`);
      }
      ok(g.goods.food >= 0 && Number.isFinite(g.goods.food), `${pace} seed ${s}: food`);
    }
  }
});
t('party health and morale stay clamped', () => {
  for (let s = 1; s <= 30; s += 1) {
    const g = playFullRun(s);
    ok(g.morale >= 0 && g.morale <= 100, `morale out of range: ${g.morale}`);
    for (const p of g.party) ok(p.health >= 0 && p.health <= 1, `health out of range: ${p.health}`);
  }
});

/* ---- specific mechanics ---------------------------------------------- */
t('consumption depletes food and water', () => {
  const g = new OregonTrailGame({ seed: 10 });
  g.setOutfit(STARTER_LOADOUT);
  const f0 = g.goods.food, w0 = g.goods.water;
  g.consumeDaily(14);
  ok(g.goods.food < f0, 'food should drop');
  ok(g.goods.water < w0, 'water should drop');
});
t('starvation damages health', () => {
  const g = new OregonTrailGame({ seed: 11 });
  g.setOutfit({ ...STARTER_LOADOUT, food: 0 });
  const h0 = g.healthAverage;
  g.consumeDaily(14);
  ok(g.healthAverage < h0, 'health should drop with no food');
});
t('hunting converts accuracy into meat', () => {
  const g = new OregonTrailGame({ seed: 12 });
  g.setOutfit(STARTER_LOADOUT);
  const good = g.huntOutcome(0.95);
  ok(good.meat > 40, `great shot should yield meat, got ${good.meat}`);
  const bad = g.huntOutcome(0.05);
  eq(bad.meat, 0);
});
t('blizzard can trigger illness and costs supplies', () => {
  const g = new OregonTrailGame({ seed: 13 });
  g.setOutfit({ ...STARTER_LOADOUT, clothing: 0 });
  g.miles = 1600;
  const b0 = g.goods.bullets;
  g.blizzard('South Pass');
  ok(g.goods.bullets < b0, 'blizzard should consume bullets');
  ok(g.blizzardThisTurn, 'blizzard flag should be set');
});
t('mountain phase only runs beyond 950 miles', () => {
  const g = new OregonTrailGame({ seed: 14 });
  g.setOutfit(STARTER_LOADOUT);
  g.miles = 500;
  g.mountainPhase();
  eq(g.southPassCleared, false);
  g.miles = 1000;
  g.mountainPhase();
  eq(g.southPassCleared, true);
});
t('South Pass and Blue Mountains are crossed once each', () => {
  const g = new OregonTrailGame({ seed: 15 });
  g.setOutfit(STARTER_LOADOUT);
  g.miles = 1000; g.mountainPhase();
  g.miles = 1800; g.mountainPhase();
  eq(g.southPassCleared, true); eq(g.blueMountainsCleared, true);
});
t('river ford and ferry both resolve', () => {
  const g = new OregonTrailGame({ seed: 16 });
  g.setOutfit(STARTER_LOADOUT);
  g.fordRiver(LANDMARKS[1]);
  eq(g.stats.riversFords, 1);
  const c0 = g.cash;
  g.ferryRiver(LANDMARKS[1]);
  ok(g.cash <= c0);
});
t('death removes all party members from play', () => {
  const g = new OregonTrailGame({ seed: 17 });
  g.setOutfit(STARTER_LOADOUT);
  for (let i = 0; i < 5; i += 1) g.kill(i, 'of testing');
  eq(g.alive().length, 0);
  eq(g.outcome, 'died');
});
t('score is computed for arrival and death', () => {
  const g = new OregonTrailGame({ seed: 18 });
  g.setOutfit(STARTER_LOADOUT);
  g.miles = TOTAL_MILES; g.outcome = 'arrived';
  const s = g.score();
  ok(s.score > 0 && s.rank, 'arrival score should exist');
  g.outcome = 'died'; g.miles = 400;
  ok(g.score().rank, 'death score should exist');
});
t('landmarks are visited in mileage order', () => {
  const g = new OregonTrailGame({ seed: 19 });
  g.setOutfit(STARTER_LOADOUT);
  g.checkLandmarks(-1);                       // Independence at mile 0
  g.miles = 120; g.checkLandmarks(0);         // Kansas River Crossing
  const visited = g.landmarks.filter((l) => l.visited);
  eq(visited.length, 2, 'should have visited two landmarks');
  eq(visited[0].name, 'Independence');
  eq(visited[1].name, 'Kansas River Crossing');
});
t('landmark cards do not clobber a death', () => {
  const g = new OregonTrailGame({ seed: 23 });
  g.setOutfit(STARTER_LOADOUT);
  g.miles = 120;
  g.finishDeath();
  const s = g.snapshot();
  eq(s.phase, 'end');
  eq(s.outcome, 'died');
});
t('riding out a rider event always returns to a playable phase', () => {
  for (let s = 1; s <= 40; s += 1) {
    const g = new OregonTrailGame({ seed: s });
    g.setOutfit(STARTER_LOADOUT);
    let guard = 0;
    while (!g.outcome && g.pendingEvent && guard < 20) {
      guard += 1;
      g.resolveRiders('parley');
    }
    const playable = g.outcome || g.phase === 'travel' || g.phase === 'landmark';
    ok(playable, `seed ${s} stuck in phase ${g.phase}`);
  }
});
t('snapshot exposes a stable view model', () => {
  const g = new OregonTrailGame({ seed: 20 });
  g.setOutfit(STARTER_LOADOUT);
  const s = g.snapshot();
  for (const k of ['phase','miles','cash','goods','party','morale','terrain','weather','date','log']) {
    ok(k in s, `snapshot missing ${k}`);
  }
  ok(Array.isArray(s.party) && s.party.length === 5);
});
t('every good has a positive price and sane bounds', () => {
  for (const good of GOODS) {
    ok(good.basePrice > 0, `${good.id} price`);
    ok(good.maxQty > 0 && good.maxSpend > 0, `${good.id} bounds`);
    ok(good.maxQty * good.basePrice >= good.maxSpend, `${good.id} maxSpend unreachable`);
  }
});
t('full rest restores health and costs cash', () => {
  const g = new OregonTrailGame({ seed: 22 });
  g.setOutfit(STARTER_LOADOUT);
  for (const p of g.party) p.health = 0.3;
  const h0 = g.healthAverage, c0 = g.cash;
  g.restAtFort(3);
  ok(g.healthAverage > h0, 'health should improve');
  ok(g.cash < c0, 'rest should cost cash');
});

console.log(`\n${pass}/${pass + fail} engine tests passed`);
process.exit(fail ? 1 : 0);
