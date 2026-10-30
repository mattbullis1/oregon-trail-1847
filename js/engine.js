/**
 * OREGON TRAIL - 1847
 * Modern engine for the 1978 MECC BASIC game "OREGON" (Bill Heinemann, 1971).
 *
 * This module is pure game logic: no DOM, no timers, no randomness that cannot
 * be seeded. It is a generator state machine. Every `yield` is a prompt for the
 * interface; calling `session.submit(answer)` resumes play.
 *
 * Line references in the comments point at the original 1978 listing so the
 * published rules stay auditable.
 */

export const TOTAL_MILES = 2040;
export const BUDGET = 700;
export const START_DATE = 'MONDAY MARCH 29 1847';
export const DOCTOR_BILL = 20;
export const FORT_MILES = 45;
export const HUNT_MILES = 45;
export const HUNT_MIN_BULLETS = 40;
export const MOUNTAINS_AT = 950;
export const BLUE_MOUNTAINS_AT = 1700;

/** Line 1290-1690: the 19 dated turns, then the winter death. */
export const TURN_DATES = [
  'APRIL 12', 'APRIL 26', 'MAY 10', 'MAY 24', 'JUNE 7', 'JUNE 21', 'JULY 5',
  'JULY 19', 'AUGUST 2', 'AUGUST 16', 'AUGUST 31', 'SEPTEMBER 13',
  'SEPTEMBER 27', 'OCTOBER 11', 'OCTOBER 25', 'NOVEMBER 8', 'NOVEMBER 22',
  'DECEMBER 6', 'DECEMBER 20',
];

/** Line 3620: event thresholds. Roll <= threshold picks that event. */
export const EVENT_THRESHOLDS = [6, 11, 13, 15, 17, 22, 32, 35, 37, 42, 44, 54, 64, 69, 95];

/** Line 6150-6180. */
export const SHOT_WORDS = ['BANG', 'BLAM', 'POW', 'WHAM'];

/** Line 2740-2850. */
export const MEALS = [
  { value: 1, label: 'POORLY', cost: 13, detail: 'Bare minimum' },
  { value: 2, label: 'MODERATELY', cost: 18, detail: 'Steady rations' },
  { value: 3, label: 'WELL', cost: 23, detail: 'Keeps illness away' },
];

/** Line 2960-2970. */
export const TACTICS = [
  { value: 1, label: 'RUN', detail: 'Try to outrun them' },
  { value: 2, label: 'ATTACK', detail: 'Shoot it out' },
  { value: 3, label: 'CONTINUE', detail: 'Keep rolling' },
  { value: 4, label: 'CIRCLE WAGONS', detail: 'Fight from cover' },
];

/** Line 340-510, 2290-2500. Fort goods cost more: $1 buys 2/3 of a unit. */
export const FORT_ITEMS = [
  { key: 'food', label: 'FOOD', unit: 'LBS', factor: 2 / 3 },
  { key: 'ammo', label: 'AMMUNITION', unit: 'BULLETS', factor: (2 / 3) * 50 },
  { key: 'clothing', label: 'CLOTHING', unit: '', factor: 2 / 3 },
  { key: 'supplies', label: 'MISC. SUPPLIES', unit: '', factor: 2 / 3 },
];

export const PURCHASE_ITEMS = [
  { key: 'oxen', label: 'OXEN TEAM', hint: '$200-$300. Better team, faster pace.', min: 200, max: 300 },
  { key: 'food', label: 'FOOD', hint: 'More food means less sickness.' },
  { key: 'ammo', label: 'AMMUNITION', hint: '$1 buys 50 bullets.' },
  { key: 'clothing', label: 'CLOTHING', hint: 'Needed for cold mountain weather.' },
  { key: 'supplies', label: 'MISC. SUPPLIES', hint: 'Medicine and repairs.' },
];

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const MONTHS = ['JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

export const int = (value) => Math.floor(value);
export const clamp0 = (value) => (value < 0 ? 0 : value);

export function createRng(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Line 2860: travel adds 200 + (A-220)/5 + 10*RND. */
export function travelMiles(oxen, draw) {
  return 200 + (oxen - 220) / 5 + 10 * draw;
}

/** Line 2890: ((M/100-4)^2+72)/((M/100-4)^2+12)-1, used as 10*RND <= chance. */
export function riderChance(mileage) {
  const t = (mileage / 100 - 4) ** 2;
  return (t + 72) / (t + 12) - 1;
}

export function riderEncounter(mileage, draw) {
  return draw * 10 <= riderChance(mileage);
}

/** Line 4720: encounter when 10*RND <= 9-probability. */
export function mountainProbability(mileage) {
  const t = (mileage / 100 - 15) ** 2;
  return (t + 72) / (t + 12);
}

export function mountainEncounter(mileage, draw) {
  return draw * 10 <= 9 - mountainProbability(mileage);
}

/** Line 2740-2850: eating costs 8 + 5*E food. */
export function mealCost(level) {
  return 8 + 5 * Number(level);
}

/**
 * Shooting score. The 1978 listing measured typed seconds and subtracted
 * (D9-1), which made "shaky knees" shoot better. The remake keeps the 0-9
 * score but applies the penalty in the correct direction: worse marksmen get
 * a little less time.
 */
export function shotResult(elapsedSeconds, marksmanship) {
  const skill = Math.min(5, Math.max(1, Number(marksmanship) || 2));
  const penalty = (skill - 1) * 0.35;
  let b1 = Number(elapsedSeconds) + penalty;
  if (!Number.isFinite(b1) || b1 < 0) b1 = 0;
  if (b1 > 3.5) return 9;
  return b1;
}

/** Line 5700-5910: arrival calendar. Keeps the published (quirky) mapping. */
export function arrivalCalendar(totalDays) {
  const d3 = int(totalDays);
  if (d3 > 246) return { month: MONTHS[5], day: d3 - 246 };
  if (d3 > 216) return { month: MONTHS[4], day: d3 - 216 };
  if (d3 > 185) return { month: MONTHS[3], day: d3 - 185 };
  if (d3 > 155) return { month: MONTHS[2], day: d3 - 155 };
  if (d3 > 124) return { month: MONTHS[1], day: d3 - 124 };
  return { month: MONTHS[0], day: d3 - 93 };
}

/** Line 5530-5690. */
export function arrivalWeekday(fractionDays) {
  let index = int(fractionDays) + 1;
  if (index >= 8) index -= 7;
  if (index < 1) index = 1;
  if (index > 7) index = 7;
  return WEEKDAYS[index - 1];
}

export function eventIndexForRoll(roll) {
  for (let index = 0; index < EVENT_THRESHOLDS.length; index += 1) {
    if (roll <= EVENT_THRESHOLDS[index]) return index + 1;
  }
  return 16;
}

function normalizePurchases(input) {
  if (!input || typeof input !== 'object') {
    return { error: 'ENTER AN AMOUNT FOR EVERY ITEM.' };
  }
  const values = {};
  for (const item of PURCHASE_ITEMS) {
    const value = Number(input[item.key]);
    if (!Number.isFinite(value)) return { error: `INVALID ${item.label} AMOUNT.` };
    values[item.key] = value;
  }
  if (values.oxen < 200 || values.oxen > 300) {
    return { error: 'OXEN MUST COST BETWEEN $200 AND $300.' };
  }
  for (const item of PURCHASE_ITEMS) {
    if (item.key === 'oxen') continue;
    if (values[item.key] < 0) return { error: 'AMOUNTS CANNOT BE NEGATIVE.' };
  }
  return { values };
}

function snapshot(s) {
  return {
    seed: s.seed,
    turn: s.turn,
    mileage: int(s.mileage),
    mileageAtTurnStart: int(s.mileageAtTurnStart),
    date: s.date,
    cash: int(s.cash),
    oxen: int(s.oxen),
    food: int(s.food),
    bullets: int(s.bullets),
    clothing: int(s.clothing),
    supplies: int(s.supplies),
    marksmanship: s.marksmanship,
    health: s.ill ? 'SERIOUSLY ILL' : s.injured ? 'INJURED' : 'GOOD',
    injured: s.injured,
    ill: s.ill,
    weather: s.weather,
    lastEvent: s.lastEvent,
    outcome: s.outcome,
    deathCause: s.deathCause,
    final: s.final,
    funeral: s.funeral,
    log: s.log.slice(),
  };
}

/**
 * The game. Yields prompts; returns the final result.
 * Config: { seed, rng }
 */
export function* trailGame(config = {}) {
  const seed = config.seed === undefined ? ((Date.now() >>> 0) || 1) : config.seed;
  const rng = typeof config.rng === 'function' ? config.rng : createRng(seed);

  const s = {
    seed,
    turn: 0,
    mileage: 0,
    mileageAtTurnStart: 0,
    date: START_DATE,
    cash: BUDGET,
    oxen: 0,
    food: 0,
    bullets: 0,
    clothing: 0,
    supplies: 0,
    eating: 2,
    marksmanship: 2,
    injured: false,
    ill: false,
    fortToggle: -1,
    southPassCleared: false,
    blueMountainsCleared: false,
    blizzard: false,
    mileageMask: false,
    weather: 'clear',
    lastEvent: null,
    outcome: null,
    deathCause: null,
    deathLabel: null,
    final: null,
    funeral: null,
    log: [],
    nextLogId: 1,
  };

  function say(kind, text, meta) {
    const entry = { id: s.nextLogId, turn: s.turn, kind, text };
    s.nextLogId += 1;
    if (meta) entry.meta = meta;
    s.log.push(entry);
    return entry;
  }

  const emit = (prompt) => ({ ...prompt, state: snapshot(s) });

  function die(cause, label, text) {
    if (s.outcome) return;
    s.outcome = 'dead';
    s.deathCause = cause;
    s.deathLabel = label || null;
    say('death', text);
  }

  function draw() {
    return rng();
  }

  /* ------------------------------------------------------------------ *
   * Setup: lines 160-1210
   * ------------------------------------------------------------------ */

  function* setupPhase() {
    const wants = yield emit({ type: 'instructions', message: 'DO YOU NEED INSTRUCTIONS?' });
    if (String(wants).toUpperCase() !== 'NO') {
      say('setup', 'INSTRUCTIONS PRINTED');
    } else {
      say('setup', 'INSTRUCTIONS DECLINED');
    }

    let marks = Number(yield emit({
      type: 'marksmanship',
      message: 'HOW GOOD A SHOT ARE YOU WITH YOUR RIFLE?',
      options: [
        { value: 1, label: 'ACE MARKSMAN', detail: 'Fastest tap wins' },
        { value: 2, label: 'GOOD SHOT', detail: 'A steady hand' },
        { value: 3, label: 'FAIR TO MIDDLIN', detail: 'Average' },
        { value: 4, label: 'NEED MORE PRACTICE', detail: 'Take your time' },
        { value: 5, label: 'SHAKY KNEES', detail: 'Hardest to aim' },
      ],
    }));
    if (!Number.isFinite(marks)) marks = 2;
    if (marks > 5) marks = 0;             // line 770-790
    if (marks < 1) marks = 2;             // interface only sends 1..5
    s.marksmanship = marks;
    say('setup', `MARKSMANSHIP LEVEL ${s.marksmanship}.`);

    let error = null;
    while (true) {
      const answer = yield emit({ type: 'purchases', budget: BUDGET, items: PURCHASE_ITEMS, error });
      const parsed = normalizePurchases(answer);
      if (parsed.error) {
        error = parsed.error;
        say('warning', error);
        continue;
      }
      const { oxen, food, ammo, clothing, supplies } = parsed.values;
      const left = BUDGET - (oxen + food + ammo + clothing + supplies);
      if (left < 0) {
        error = `YOU OVERSPENT BY $${Math.abs(left).toFixed(0)}. YOU ONLY HAD $${BUDGET} TO SPEND.`;
        say('warning', error);
        continue;
      }
      s.oxen = oxen;
      s.food = food;
      s.bullets = 50 * ammo;              // line 1170
      s.clothing = clothing;
      s.supplies = supplies;
      s.cash = left;
      say('setup', `AFTER ALL YOUR PURCHASES, YOU NOW HAVE $${int(left)} LEFT.`);
      break;
    }
    s.date = START_DATE;
    say('setup', 'MONDAY MARCH 29 1847');
  }

  /* ------------------------------------------------------------------ *
   * Start of turn: lines 1750-2050
   * ------------------------------------------------------------------ */

  function startOfTurn() {
    s.food = clamp0(s.food);
    s.bullets = clamp0(s.bullets);
    s.clothing = clamp0(s.clothing);
    s.supplies = clamp0(s.supplies);

    if (s.food < 13) {
      say('warning', "YOU'D BETTER DO SOME HUNTING OR BUY FOOD AND SOON!");
    }

    s.food = int(s.food);
    s.bullets = int(s.bullets);
    s.clothing = int(s.clothing);
    s.supplies = int(s.supplies);
    s.cash = int(s.cash);
    s.mileage = int(s.mileage);
    s.mileageAtTurnStart = s.mileage;     // line 1910

    if (s.ill || s.injured) {
      s.cash -= DOCTOR_BILL;              // line 1950
      if (s.cash < 0) {
        s.cash = 0;
        say('doctor', "YOU CAN'T AFFORD A DOCTOR.");
        die('doctor', s.injured ? 'INJURIES' : 'PNEUMONIA', 'YOU DIED FOR WANT OF A DOCTOR.');
        return;
      }
      say('doctor', `DOCTOR'S BILL IS $${DOCTOR_BILL}. CASH LEFT $${s.cash}.`);
      s.injured = false;
      s.ill = false;
    }

    const shown = s.mileageMask ? MOUNTAINS_AT : s.mileage;   // line 1990-2030
    say('mileage', `TOTAL MILEAGE IS ${shown}.`);
    s.mileageMask = false;
    s.weather = 'clear';
  }

  /* ------------------------------------------------------------------ *
   * Action menu: lines 2060-2270
   * ------------------------------------------------------------------ */

  function* actionPhase() {
    let action = 3;
    if (s.fortToggle === -1) {
      s.fortToggle = 1;
      while (true) {
        const answer = Number(yield emit({
          type: 'action',
          menu: 'hunt',
          options: [
            { value: 2, label: 'HUNT FOR FOOD', detail: 'Spend 45 miles, use bullets' },
            { value: 3, label: 'CONTINUE ON THE TRAIL', detail: 'Roll west' },
          ],
        }));
        const x = answer === 2 ? 2 : 3;
        if (x === 2 && s.bullets <= HUNT_MIN_BULLETS - 1) {
          say('warning', 'TOUGH - YOU NEED MORE BULLETS TO GO HUNTING.');
          continue;
        }
        action = x;
        break;
      }
    } else {
      s.fortToggle = -1;
      while (true) {
        const answer = Number(yield emit({
          type: 'action',
          menu: 'fort',
          options: [
            { value: 1, label: 'STOP AT THE NEXT FORT', detail: 'Buy goods at higher prices' },
            { value: 2, label: 'HUNT FOR FOOD', detail: 'Spend 45 miles, use bullets' },
            { value: 3, label: 'CONTINUE ON THE TRAIL', detail: 'Roll west' },
          ],
        }));
        let x = 3;
        if (answer === 1 || answer === 2) x = int(answer);
        if (x === 2 && s.bullets <= HUNT_MIN_BULLETS - 1) {
          say('warning', 'TOUGH - YOU NEED MORE BULLETS TO GO HUNTING.');
          continue;
        }
        action = x;
        break;
      }
    }

    if (action === 1) {
      say('action', 'STOP AT FORT');
      yield* fortPhase();
    } else if (action === 2) {
      say('action', 'HUNT FOR FOOD');
      yield* huntPhase();
    } else {
      say('action', 'CONTINUE');
    }
  }

  /* ------------------------------------------------------------------ *
   * Fort: lines 2290-2520
   * ------------------------------------------------------------------ */

  function* fortPhase() {
    const answer = yield emit({
      type: 'fort',
      items: FORT_ITEMS,
      cash: int(s.cash),
    });
    const spends = {};
    for (const item of FORT_ITEMS) {
      const raw = Number(answer ? answer[item.key] : 0);
      spends[item.key] = Number.isFinite(raw) && raw > 0 ? raw : 0;
    }

    say('fort', 'ENTER WHAT YOU WISH TO SPEND ON THE FOLLOWING.');
    for (const item of FORT_ITEMS) {
      let p = spends[item.key];
      if (p > 0) {
        if (s.cash - p < 0) {           // line 2350-2390
          say('fort', `YOU DON'T HAVE THAT MUCH FOR ${item.label}. YOU MISS YOUR CHANCE TO SPEND ON THAT ITEM.`);
          p = 0;
        } else {
          s.cash -= p;
        }
      }
      if (item.key === 'food') s.food += item.factor * p;
      if (item.key === 'ammo') s.bullets = int(s.bullets + item.factor * p);
      if (item.key === 'clothing') s.clothing += item.factor * p;
      if (item.key === 'supplies') s.supplies += item.factor * p;
    }
    s.mileage -= FORT_MILES;            // line 2510
    say('fort', `FORT STOP COSTS ${FORT_MILES} MILES.`);
  }

  /* ------------------------------------------------------------------ *
   * Shooting: lines 6140-6280 (touch version)
   * ------------------------------------------------------------------ */

  function* shootPhase(context, wordOverride) {
    const word = wordOverride || SHOT_WORDS[int(draw() * 4)] || SHOT_WORDS[0];
    const answer = yield emit({ type: 'shooting', context, word });
    const elapsed = answer && Number.isFinite(Number(answer.elapsed)) ? Number(answer.elapsed) : 9;
    const b1 = shotResult(elapsed, s.marksmanship);
    say('shooting', context === 'hunt'
      ? `BANG! RESPONSE ${b1.toFixed(2)}s.`
      : `YOU FIRE AT THE ${context.toUpperCase()}. RESPONSE ${b1.toFixed(2)}s.`, {
      responseTime: b1,
      word,
      context,
    });
    return b1;
  }

  /* ------------------------------------------------------------------ *
   * Hunting: lines 2540-2710
   * ------------------------------------------------------------------ */

  function* huntPhase() {
    s.mileage -= HUNT_MILES;            // line 2570
    const b1 = yield* shootPhase('hunt');

    if (b1 <= 1) {                      // line 2660-2700
      const food = 52 + draw() * 6;
      const bullets = 10 + draw() * 4;
      s.food += food;
      s.bullets -= bullets;
      say('hunt', `RIGHT BETWEEN THE EYES - YOU GOT A BIG ONE! +${int(food)} FOOD, -${int(bullets)} BULLETS.`, {
        foodGained: food,
        bulletsUsed: bullets,
        responseTime: b1,
      });
    } else if (100 * draw() < 13 * b1) { // line 2600-2710
      say('hunt', "YOU MISSED - AND YOUR DINNER GOT AWAY.", { responseTime: b1 });
    } else {                            // line 2610-2630
      const food = 48 - 2 * b1;
      const bullets = 10 + 3 * b1;
      s.food += food;
      s.bullets -= bullets;
      say('hunt', `NICE SHOT - RIGHT ON TARGET! +${int(food)} FOOD, -${int(bullets)} BULLETS.`, {
        foodGained: food,
        bulletsUsed: bullets,
        responseTime: b1,
      });
    }
    say('hunt', `HUNTING COSTS ${HUNT_MILES} MILES.`);
  }

  /* ------------------------------------------------------------------ *
   * Eating: lines 2750-2850
   * ------------------------------------------------------------------ */

  function* eatingPhase() {
    while (true) {
      const answer = Number(yield emit({ type: 'eating', food: int(s.food), meals: MEALS }));
      if (!(answer >= 1 && answer <= 3)) {
        say('warning', 'ENTER 1, 2, OR 3.');
        continue;
      }
      const level = int(answer);
      const cost = mealCost(level);
      if (s.food - cost < 0) {
        say('warning', "YOU CAN'T EAT THAT WELL.");
        continue;
      }
      s.food -= cost;
      s.eating = level;
      say('eating', `YOU EAT ${MEALS[level - 1].label}. -${cost} FOOD.`, { cost });
      return;
    }
  }

  /* ------------------------------------------------------------------ *
   * Riders: lines 2890-3540
   * ------------------------------------------------------------------ */

  function applyFriendlyLosses(t1) {
    if (t1 === 1) { s.mileage += 15; s.oxen -= 10; }
    else if (t1 === 2) { s.mileage -= 5; s.bullets -= 100; }
    else if (t1 === 4) { s.mileage -= 20; }
  }

  function* resolveShootingLosses(b1, multiplier) {
    s.bullets -= b1 * multiplier + 80;
    if (b1 <= 1) {
      say('riders', 'NICE SHOOTING - YOU DROVE THEM OFF.');
    } else if (b1 <= 4) {
      say('riders', "KINDA SLOW WITH YOUR COLT .45.");
    } else {
      s.injured = true;
      say('injury', "LOUSY SHOT - YOU GOT KNIFED. YOU HAVE TO SEE OL' DOC BLANCHARD.");
    }
  }

  function* ridersPhase() {
    const encounterRoll = draw();
    if (!riderEncounter(s.mileage, encounterRoll)) return;

    let hostile = 0;                                  // S5: 1 means friendly
    if (draw() >= 0.8) hostile = 1;                   // line 2920-2940
    const flip = draw() <= 0.2;                       // line 2980
    const shownHostile = hostile === 0;

    const answer = Number(yield emit({
      type: 'riders',
      appearance: shownHostile ? 'hostile' : 'friendly',
      message: shownHostile ? "RIDERS AHEAD. THEY LOOK HOSTILE." : "RIDERS AHEAD. THEY DON'T LOOK HOSTILE.",
      tactics: TACTICS,
    }));
    let t1 = int(answer);
    if (!(t1 >= 1 && t1 <= 4)) t1 = 3;

    if (flip) hostile = 1 - hostile;                  // line 2990

    if (hostile === 1) {
      applyFriendlyLosses(t1);
      say('riders', 'RIDERS WERE FRIENDLY, BUT CHECK FOR POSSIBLE LOSSES.');
      return;
    }

    if (t1 === 1) {                                   // RUN
      s.mileage += 20;
      s.supplies -= 15;
      s.bullets -= 150;
      s.oxen -= 40;
    } else if (t1 === 2) {                            // ATTACK
      const b1 = yield* shootPhase('riders');
      yield* resolveShootingLosses(b1, 40);
    } else if (t1 === 3) {                            // CONTINUE
      if (draw() > 0.8) {
        say('riders', 'THEY DID NOT ATTACK.');
        return;
      }
      s.bullets -= 150;
      s.supplies -= 15;
    } else {                                          // CIRCLE WAGONS
      const b1 = yield* shootPhase('riders');
      yield* resolveShootingLosses(b1, 30);
      s.mileage -= 25;
    }

    if (s.bullets < 0) {                              // line 3510-3530
      die('riders', null, 'YOU RAN OUT OF BULLETS AND GOT MASSACRED BY THE RIDERS.');
      return;
    }
    say('riders', 'RIDERS WERE HOSTILE - CHECK FOR LOSSES.');
  }

  /* ------------------------------------------------------------------ *
   * Illness: lines 6300-6460
   * ------------------------------------------------------------------ */

  function illnessPhase() {
    const level = s.eating || 2;
    if (100 * draw() < 10 + 35 * (level - 1)) {       // line 6300-6400
      say('illness', 'MILD ILLNESS - MEDICINE USED.');
      s.mileage -= 5;
      s.supplies -= 2;
    } else if (100 * draw() < 100 - (40 / 4 ** (level - 1))) {  // line 6410-6430
      say('illness', 'BAD ILLNESS - MEDICINE USED.');
      s.mileage -= 5;
      s.supplies -= 5;
    } else {                                          // line 6320-6360
      say('illness', 'SERIOUS ILLNESS - YOU MUST STOP FOR MEDICAL ATTENTION.');
      s.supplies -= 10;
      s.ill = true;
    }
    if (s.supplies < 0) {                             // line 6440
      die('medical', s.injured ? 'INJURIES' : 'PNEUMONIA', 'YOU RAN OUT OF MEDICAL SUPPLIES.');
    }
  }

  /** Line 4490-4540: cold weather event and blizzard clothing checks. */
  function coldWeatherCheck() {
    if (s.clothing > 22 + 4 * draw()) {
      say('event', 'COLD WEATHER - YOU HAVE ENOUGH CLOTHING TO KEEP WARM.');
      return;
    }
    say('event', "COLD WEATHER - YOU DON'T HAVE ENOUGH CLOTHING TO KEEP YOU WARM.");
    illnessPhase();
  }

  /* ------------------------------------------------------------------ *
   * Events: lines 3550-4690
   * ------------------------------------------------------------------ */

  function* eventsPhase() {
    const roll = 100 * draw();                       // line 3570
    const index = eventIndexForRoll(roll);           // line 3580-3620
    s.lastEvent = index;
    s.weather = 'clear';

    switch (index) {
      case 1:                                        // line 3660
        s.mileage -= 15 + 5 * draw();
        s.supplies -= 8;
        say('event', 'WAGON BREAKS DOWN - LOSE TIME AND SUPPLIES FIXING IT.');
        break;
      case 2:                                        // line 3700
        s.mileage -= 25;
        s.oxen -= 20;
        say('event', 'OX INJURES LEG - SLOWS YOU DOWN REST OF TRIP.');
        break;
      case 3:                                        // line 3740
        s.mileage -= 5 + 4 * draw();
        s.supplies -= 2 + 3 * draw();
        say('event', 'BAD LUCK - YOUR DAUGHTER BROKE HER ARM. YOU USE SUPPLIES TO MAKE A SLING.');
        break;
      case 4:                                        // line 3790
        s.mileage -= 17;
        say('event', 'OX WANDERS OFF - SPEND TIME LOOKING FOR IT.');
        break;
      case 5:                                        // line 3820
        s.mileage -= 10;
        say('event', 'YOUR SON GETS LOST - SPEND HALF THE DAY LOOKING FOR HIM.');
        break;
      case 6:                                        // line 3850
        s.mileage -= 10 * draw() + 2;
        say('event', 'UNSAFE WATER - LOSE TIME LOOKING FOR A CLEAN SPRING.');
        break;
      case 7:                                        // line 3880
        if (s.mileage > MOUNTAINS_AT) {
          coldWeatherCheck();
        } else {
          s.weather = 'rain';
          s.food -= 10;
          s.bullets -= 500;
          s.supplies -= 15;
          s.mileage -= 10 * draw() + 5;
          say('event', 'HEAVY RAINS - TIME AND SUPPLIES LOST.');
        }
        break;
      case 8: {                                      // line 3960
        const b1 = yield* shootPhase('bandits');
        s.bullets -= 20 * b1;
        if (s.bullets < 0) {
          s.cash /= 3;                               // line 4010
          say('event', "YOU RAN OUT OF BULLETS - THE BANDITS GET LOTS OF CASH.");
        } else if (b1 <= 1) {
          say('event', "QUICKEST DRAW OUTSIDE OF DODGE CITY! YOU GOT 'EM!");
          break;
        }
        s.injured = true;                            // line 4040-4080
        s.supplies -= 5;
        s.oxen -= 20;
        say('injury', 'YOU GOT SHOT IN THE LEG AND THEY TOOK ONE OF YOUR OXEN. BETTER HAVE A DOC LOOK AT YOUR WOUND.');
        break;
      }
      case 9:                                        // line 4130
        s.food -= 40;
        s.bullets -= 400;
        s.supplies -= draw() * 8 + 3;
        s.mileage -= 15;
        s.weather = 'fire';
        say('event', 'THERE WAS A FIRE IN YOUR WAGON - FOOD AND SUPPLIES DAMAGED.');
        break;
      case 10:                                       // line 4190
        s.mileage -= 10 + 5 * draw();
        s.weather = 'fog';
        say('event', 'LOSE YOUR WAY IN HEAVY FOG - TIME IS LOST.');
        break;
      case 11:                                       // line 4220
        s.bullets -= 10;
        s.supplies -= 5;
        say('event', 'YOU KILLED A POISONOUS SNAKE AFTER IT BIT YOU.');
        if (s.supplies < 0) {
          die('snakebite', null, 'YOU DIE OF SNAKEBITE SINCE YOU HAVE NO MEDICINE.');
        }
        break;
      case 12:                                       // line 4290
        s.food -= 30;
        s.clothing -= 20;
        s.mileage -= 20 + 20 * draw();
        s.weather = 'river';
        say('event', 'WAGON GETS SWAMPED FORDING THE RIVER - LOSE FOOD AND CLOTHES.');
        break;
      case 13: {                                     // line 4340
        if (s.bullets <= HUNT_MIN_BULLETS - 1) {
          s.injured = true;
          die('wildAnimals', 'INJURIES', 'YOU WERE TOO LOW ON BULLETS - THE WOLVES OVERPOWERED YOU.');
          break;
        }
        const b1 = yield* shootPhase('wild animals');
        if (b1 <= 2) say('event', "NICE SHOOTIN' PARDNER - THEY DIDN'T GET MUCH.");
        else say('event', 'SLOW ON THE DRAW - THEY GOT AT YOUR FOOD AND CLOTHES.');
        s.bullets -= 20 * b1;
        s.clothing -= b1 * 4;
        s.food -= b1 * 8;
        break;
      }
      case 14:                                       // line 4560
        s.mileage -= 5 + draw() * 10;
        s.bullets -= 200;
        s.supplies -= 4 + draw() * 3;
        s.weather = 'hail';
        say('event', 'HAIL STORM - SUPPLIES DAMAGED.');
        break;
      case 15: {                                     // line 4610
        const level = s.eating || 2;
        if (level === 1) {
          illnessPhase();
          break;
        }
        if (level === 3) {
          if (draw() < 0.5) illnessPhase();
          break;
        }
        if (draw() > 0.25) illnessPhase();
        break;
      }
      default:                                       // line 4670
        s.food += 14;
        say('event', 'HELPFUL INDIANS SHOW YOU WHERE TO FIND MORE FOOD. +14 FOOD.');
        break;
    }
  }

  /* ------------------------------------------------------------------ *
   * Mountains: lines 4710-5040
   * ------------------------------------------------------------------ */

  function* blizzardPhase() {
    say('mountains', 'BLIZZARD IN MOUNTAIN PASS - TIME AND SUPPLIES LOST.');   // line 4970
    s.blizzard = true;
    s.weather = 'snow';
    s.food -= 25;
    s.supplies -= 10;
    s.bullets -= 300;
    s.mileage -= 30 + 40 * draw();
    if (s.clothing < 18 + 2 * draw()) {              // line 5030
      illnessPhase();
    }
  }

  function* mountainsPhase() {
    if (s.mileage <= MOUNTAINS_AT) return;           // line 4710

    if (mountainEncounter(s.mileage, draw())) {      // line 4720
      say('mountains', 'RUGGED MOUNTAINS.');
      if (draw() > 0.1) {
        if (draw() > 0.11) {
          const lost = 45 + draw() / 0.02;           // line 4850
          s.mileage -= lost;
          say('mountains', `THE GOING GETS SLOW. -${int(lost)} MILES.`);
        } else {
          s.supplies -= 5;                           // line 4790
          s.bullets -= 200;
          s.mileage -= 20 + 30 * draw();
          say('mountains', 'WAGON DAMAGED - LOSE TIME AND SUPPLIES.');
        }
      } else {
        s.mileage -= 60;                             // line 4760
        say('mountains', 'YOU GOT LOST - LOSE VALUABLE TIME TRYING TO FIND THE TRAIL.');
      }
    }

    if (!s.southPassCleared) {                       // line 4860-4890
      s.southPassCleared = true;
      if (draw() < 0.8) {
        yield* blizzardPhase();
      } else {
        say('mountains', 'YOU MADE IT SAFELY THROUGH SOUTH PASS - NO SNOW.');
      }
    }

    if (s.mileage >= BLUE_MOUNTAINS_AT && !s.blueMountainsCleared) {   // line 4900-4930
      s.blueMountainsCleared = true;
      if (draw() < 0.7) {
        yield* blizzardPhase();
      } else {
        say('mountains', 'THE BLUE MOUNTAINS ARE CLEAR.');
      }
    }

    if (s.mileage <= MOUNTAINS_AT) {                 // line 4940-4960
      s.mileageMask = true;
    }
  }

  /* ------------------------------------------------------------------ *
   * Arrival: lines 5430-6120
   * ------------------------------------------------------------------ */

  function arrive() {
    const m2 = s.mileageAtTurnStart;
    const span = s.mileage - m2;
    const f9 = span !== 0 ? (TOTAL_MILES - m2) / span : 0;
    s.food += (1 - f9) * mealCost(s.eating || 2);    // line 5440
    const fractionDays = int(f9 * 14);               // line 5510
    const totalDays = s.turn * 14 + fractionDays;    // line 5520

    s.bullets = clamp0(s.bullets);
    s.clothing = clamp0(s.clothing);
    s.supplies = clamp0(s.supplies);
    s.cash = clamp0(s.cash);
    s.food = clamp0(s.food);

    const calendar = arrivalCalendar(totalDays);
    const weekday = arrivalWeekday(fractionDays);

    s.outcome = 'win';
    s.final = {
      totalDays,
      weekday,
      month: calendar.month,
      day: calendar.day,
      inventory: {
        food: int(s.food),
        bullets: int(s.bullets),
        clothing: int(s.clothing),
        supplies: int(s.supplies),
        cash: int(s.cash),
      },
    };
    say('arrival', `YOU FINALLY ARRIVED AT OREGON CITY AFTER ${TOTAL_MILES} LONG MILES - HOORAY!`);
    say('arrival', `IT IS ${weekday} ${calendar.month} ${calendar.day} 1847. A REAL PIONEER!`);
  }

  /* ------------------------------------------------------------------ *
   * Funeral: lines 5170-5410
   * ------------------------------------------------------------------ */

  function* funeralPhase() {
    const answer = yield emit({ type: 'funeral', deathCause: s.deathCause, deathLabel: s.deathLabel });
    s.funeral = {
      minister: Boolean(answer && answer.minister),
      fancyFuneral: Boolean(answer && answer.fancyFuneral),
      notifyNextOfKin: Boolean(answer && answer.notifyNextOfKin),
    };
    say('funeral', 'DUE TO YOUR UNFORTUNATE SITUATION, THERE ARE A FEW FORMALITIES WE MUST GO THROUGH.');
    say('funeral', s.funeral.notifyNextOfKin
      ? 'THAT WILL BE $4.50 FOR THE TELEGRAPH CHARGE.'
      : 'BUT YOUR AUNT SADIE IN ST. LOUIS IS REALLY WORRIED ABOUT YOU.');
    say('funeral', "WE ARE SORRY YOU DIDN'T MAKE IT TO THE GREAT TERRITORY OF OREGON. BETTER LUCK NEXT TIME.");
  }

  function finish() {
    return {
      outcome: s.outcome || 'dead',
      deathCause: s.deathCause,
      deathLabel: s.deathLabel,
      final: s.final,
      funeral: s.funeral,
      answers: undefined,
      state: snapshot(s),
    };
  }

  /* ------------------------------------------------------------------ *
   * Main loop: lines 1230-1230, 1750-5040
   * ------------------------------------------------------------------ */

  if (config.start && typeof config.start === 'object') {
    // Test and tooling hook: resume from an explicit state without setup.
    Object.assign(s, config.start);
  } else {
    yield* setupPhase();
  }

  while (!s.outcome) {
    if (s.mileage >= TOTAL_MILES) {                  // line 1230
      arrive();
      break;
    }

    s.turn += 1;                                     // line 1250
    if (s.turn > TURN_DATES.length) {                // line 1690: turn 20 is winter
      die('winter', null, 'YOU HAVE BEEN ON THE TRAIL TOO LONG - YOUR FAMILY DIES IN THE FIRST BLIZZARD OF WINTER.');
      break;
    }
    s.date = TURN_DATES[s.turn - 1];
    say('turn', `MONDAY ${s.date} 1847`);

    startOfTurn();
    if (s.outcome) break;

    yield* actionPhase();
    if (s.outcome) break;

    if (s.food < 13) {                               // line 2720-2730
      die('starvation', null, 'YOU RAN OUT OF FOOD AND STARVED TO DEATH.');
      break;
    }

    yield* eatingPhase();
    if (s.outcome) break;

    s.mileage += travelMiles(s.oxen, draw());        // line 2860
    say('travel', `THE WAGON ROLLS WEST. MILEAGE ${int(s.mileage)} / ${TOTAL_MILES}.`);

    yield* ridersPhase();                            // line 2890
    if (s.outcome) break;

    yield* eventsPhase();                            // line 3550
    if (s.outcome) break;

    yield* mountainsPhase();                         // line 4710
    if (s.outcome) break;
  }

  if (s.outcome === 'dead') {
    yield* funeralPhase();                           // line 5170
  }

  return finish();
}

/**
 * Thin session wrapper used by the interface and by save replay.
 */
export function createSession(config = {}) {
  const seed = config.seed === undefined ? ((Date.now() >>> 0) || 1) : config.seed;
  const generator = trailGame({ ...config, seed });
  let step = generator.next();

  const session = {
    seed,
    answers: [],
    get prompt() {
      return step.done ? null : step.value;
    },
    get state() {
      return step.done ? step.value.state : step.value.state;
    },
    get done() {
      return step.done;
    },
    get result() {
      return step.done ? step.value : null;
    },
    submit(answer) {
      if (step.done) throw new Error('The journey is already over.');
      session.answers.push(answer);
      step = generator.next(answer);
      return session.prompt;
    },
    replay(answers) {
      for (const answer of answers) session.submit(answer);
      return session;
    },
  };
  return session;
}
