import test from 'node:test';
import assert from 'node:assert/strict';

import {
  arrivalCalendar,
  arrivalWeekday,
  createSession,
  createRng,
  eventIndexForRoll,
  mealCost,
  mountainProbability,
  riderChance,
  shotResult,
  travelMiles,
} from '../js/engine.js';

/** RNG stub that hands out scripted draws, then a default. */
function scripted(values, fallback = 0.99) {
  const queue = values.slice();
  const fn = () => (queue.length ? queue.shift() : fallback);
  fn.remaining = () => queue.length;
  return fn;
}

function baseState(overrides = {}) {
  return {
    turn: 1,
    mileage: 300,
    mileageAtTurnStart: 300,
    date: 'APRIL 12',
    cash: 100,
    oxen: 250,
    food: 200,
    bullets: 300,
    clothing: 40,
    supplies: 40,
    eating: 2,
    marksmanship: 2,
    ...overrides,
  };
}

test('travel follows 200 + (oxen-220)/5 + 10*RND', () => {
  assert.equal(travelMiles(250, 0.5), 211);
  assert.equal(travelMiles(200, 0), 196);
  assert.equal(travelMiles(300, 1), 226);
});

test('meal costs are 13, 18 and 23 food', () => {
  assert.equal(mealCost(1), 13);
  assert.equal(mealCost(2), 18);
  assert.equal(mealCost(3), 23);
});

test('event roll boundaries match the published DATA table', () => {
  assert.equal(eventIndexForRoll(0), 1);
  assert.equal(eventIndexForRoll(6), 1);
  assert.equal(eventIndexForRoll(6.01), 2);
  assert.equal(eventIndexForRoll(11), 2);
  assert.equal(eventIndexForRoll(44), 11);
  assert.equal(eventIndexForRoll(95), 15);
  assert.equal(eventIndexForRoll(95.01), 16);
  assert.equal(eventIndexForRoll(100), 16);
});

test('rider and mountain probabilities match the published curves', () => {
  assert.ok(riderChance(400) > riderChance(1500));
  assert.equal(riderChance(400), 5);
  assert.ok(mountainProbability(1500) > mountainProbability(1000));
  assert.equal(Math.round(mountainProbability(1500) * 100) / 100, 6);
});

test('shot result rewards fast taps and penalises shaky knees', () => {
  assert.equal(shotResult(0.4, 1), 0.4);
  assert.equal(Math.round(shotResult(0.4, 5) * 100) / 100, 1.8);
  assert.equal(shotResult(4, 1), 9);
  assert.equal(shotResult(0, 2), 0.35);
});

test('arrival calendar keeps the published month mapping', () => {
  assert.deepEqual(arrivalCalendar(124), { month: 'JULY', day: 31 });
  assert.deepEqual(arrivalCalendar(125), { month: 'AUGUST', day: 1 });
  assert.deepEqual(arrivalCalendar(247), { month: 'DECEMBER', day: 1 });
});

test('arrival weekdays wrap after seven days', () => {
  assert.equal(arrivalWeekday(0), 'MONDAY');
  assert.equal(arrivalWeekday(6), 'SUNDAY');
  assert.equal(arrivalWeekday(7), 'MONDAY');
  assert.equal(arrivalWeekday(13), 'SUNDAY');
});

test('setup validates oxen price, overspending and lands on the action menu', () => {
  const session = createSession({ seed: 1, rng: scripted([]) });

  session.submit('NO');
  session.submit(1);                                   // marksmanship
  assert.equal(session.prompt.type, 'purchases');

  session.submit({ oxen: 150, food: 0, ammo: 0, clothing: 0, supplies: 0 });
  assert.equal(session.prompt.type, 'purchases');
  assert.match(session.prompt.error, /OXEN/);

  session.submit({ oxen: 300, food: 700, ammo: 0, clothing: 0, supplies: 0 });
  assert.equal(session.prompt.type, 'purchases');
  assert.match(session.prompt.error, /OVERSPENT/);

  session.submit({ oxen: 250, food: 100, ammo: 2, clothing: 20, supplies: 20 });
  assert.equal(session.prompt.type, 'action');
  assert.equal(session.prompt.state.cash, 308);
  assert.equal(session.prompt.state.bullets, 100);
  assert.equal(session.prompt.state.food, 100);
});

test('hunting a big animal adds food and spends bullets', () => {
  const session = createSession({ start: baseState(), rng: scripted([0, 0.5, 0.5]) });
  assert.equal(session.prompt.type, 'action');
  session.submit(2);                                   // hunt
  assert.equal(session.prompt.type, 'shooting');
  assert.equal(session.prompt.word, 'BANG');
  session.submit({ elapsed: 0.1 });                    // marksmanship 2 -> b1 0.45
  assert.equal(session.prompt.type, 'eating');
  assert.equal(session.prompt.state.food, 255);
  assert.equal(session.prompt.state.bullets, 288);
  assert.equal(session.prompt.state.mileage, 255);
});

test('a slow shot misses and gains nothing', () => {
  const session = createSession({ start: baseState(), rng: scripted([0, 0.05]) });
  session.submit(2);
  assert.equal(session.prompt.type, 'shooting');
  session.submit({ elapsed: 3 });
  assert.equal(session.prompt.type, 'eating');
  assert.equal(session.prompt.state.food, 200);
  assert.equal(session.prompt.state.bullets, 300);
});

test('fort purchases use the 2/3 factor and cost 45 miles', () => {
  const session = createSession({
    start: baseState(),
    rng: scripted([0.5, 0.9, 0.98]),
  });

  session.submit(3);                                   // continue
  session.submit(2);                                   // moderate meal
  // travel + event 16, no riders, no mountains
  assert.equal(session.prompt.type, 'action');
  assert.equal(session.prompt.menu, 'fort');

  session.submit(1);                                   // stop at fort
  assert.equal(session.prompt.type, 'fort');
  session.submit({ food: 30, ammo: 3, clothing: 0, supplies: 0 });

  assert.equal(session.prompt.state.food, 216);
  assert.equal(session.prompt.state.bullets, 400);
  assert.equal(session.prompt.state.cash, 67);
  assert.equal(session.prompt.state.mileage, 466);
});

test('fort items you cannot afford are skipped, not negative', () => {
  const session = createSession({ start: baseState({ cash: 10 }), rng: scripted([0.99, 0.9, 0.98]) });
  session.submit(3);
  session.submit(2);
  session.submit(1);
  session.submit({ food: 50, ammo: 0, clothing: 0, supplies: 0 });
  assert.equal(session.prompt.state.cash, 10);
  assert.equal(session.prompt.state.food, 196);
});

test('a journey started on the last dated turn ends in the winter blizzard', () => {
  const session = createSession({
    start: baseState({ turn: 19, mileage: 1200, date: 'DECEMBER 20' }),
    rng: scripted([]),
  });
  assert.equal(session.prompt.type, 'funeral');
  assert.equal(session.prompt.deathCause, 'winter');
  session.submit({ minister: false, fancyFuneral: false, notifyNextOfKin: false });
  const result = session.result;
  assert.equal(result.outcome, 'dead');
  assert.equal(result.deathCause, 'winter');
});

test('crossing 2040 miles reaches Oregon City with a final inventory', () => {
  const session = createSession({
    start: baseState({ turn: 10, mileage: 1990, mileageAtTurnStart: 1990, food: 60 }),
    rng: scripted([0.5, 0.9, 0.98, 0.99, 0.9, 0.9]),
  });

  session.submit(3);
  session.submit(2);
  const result = session.result;
  assert.ok(session.done, 'journey should be complete');
  assert.equal(result.outcome, 'win');
  assert.equal(result.final.inventory.food >= 0, true);
  assert.ok(['JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'].includes(result.final.month));
});

test('saved answer transcripts replay to the same prompt', () => {
  const first = createSession({ seed: 42 });
  first.submit('NO');
  first.submit(3);
  first.submit({ oxen: 250, food: 150, ammo: 4, clothing: 20, supplies: 20 });
  first.submit(3);
  const promptBefore = first.prompt.type;

  const replay = createSession({ seed: 42 });
  replay.replay(first.answers);
  assert.equal(replay.prompt.type, promptBefore);
  assert.equal(replay.prompt.state.mileage, first.prompt.state.mileage);
});

test('a full journey runs to an ending without stalling', () => {
  const session = createSession({ seed: 20261029, rng: createRng(20261029) });
  let guard = 0;

  while (!session.done && guard < 800) {
    guard += 1;
    const prompt = session.prompt;
    const state = prompt.state;
    if (prompt.type === 'instructions') session.submit('NO');
    else if (prompt.type === 'marksmanship') session.submit(2);
    else if (prompt.type === 'purchases') {
      session.submit({ oxen: 250, food: 300, ammo: 6, clothing: 30, supplies: 20 });
    } else if (prompt.type === 'action') {
      if (state.bullets > 60 && state.food < 60) session.submit(prompt.menu === 'fort' ? 2 : 1);
      else session.submit(3);
    } else if (prompt.type === 'fort') {
      session.submit({ food: 0, ammo: 0, clothing: 0, supplies: 0 });
    } else if (prompt.type === 'eating') {
      const level = state.food >= 23 ? 3 : state.food >= 18 ? 2 : 1;
      session.submit(level);
    } else if (prompt.type === 'shooting') {
      session.submit({ elapsed: 0.3 });
    } else if (prompt.type === 'riders') {
      session.submit(3);
    } else if (prompt.type === 'funeral') {
      session.submit({ minister: true, fancyFuneral: false, notifyNextOfKin: true });
    } else {
      throw new Error(`Unexpected prompt ${prompt.type}`);
    }
  }

  assert.ok(session.done, `journey should end (guard ${guard})`);
  assert.ok(['win', 'dead'].includes(session.result.outcome));
  assert.ok(session.result.state.mileage >= 0);
});
