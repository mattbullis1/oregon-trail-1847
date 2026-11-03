/* ============================================================================
   OREGON TRAIL — LONE PASSAGE
   app.js — presentation controller. Mouse/touch only. No keyboard anywhere.
   ========================================================================== */

import { OregonTrailGame, GOODS, GOODS_BY_ID, STARTER_LOADOUT, RATIONS, PACE, LANDMARKS, TOTAL_MILES, HUNT_MIN_BULLETS, STARVATION_FOOD_FLOOR } from './engine.js';
import { World } from './world.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------------------------------------------------------------------
   App state
   ------------------------------------------------------------------------- */
const App = {
  game: null,
  world: null,
  running: false,
  lastTime: 0,
  moving: false,
  travelAnimating: false,
  outfit: { ...STARTER_LOADOUT },
  atFort: false,
  hunt: null,
  toastTimer: null,
  seenOutcome: null,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  fastTravel: false,
  quality: 'high',
};

/* ---------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */
function boot() {
  const canvas = $('#gl');
  App.world = new World(canvas);
  App.world.reduceMotion = App.reducedMotion;
  window.__trail = App;

  App.game = new OregonTrailGame({ seed: (Date.now() ^ 0x5f3a) >>> 0 });
  App.outfit = { ...STARTER_LOADOUT };

  wireTitle();
  wireOutfit();
  wireTravel();
  wireModals();
  wireJournal();
  renderOutfit();
  showScreen('title');
  App.running = true;
  // A small debug surface so automated tests can drive the presentation layer
  // the same way the UI does, without reaching into closures.
  App.debug = {
    renderHUD,
    openModal,
    closeModal,
    setWeather: (m) => {
      App.game.weather = m;
      // Keep temperature consistent with the sky, so the HUD never reads
      // "Snow 77F" during a scripted jump.
      const temps = { clear: 66, overcast: 58, rain: 54, storm: 48, snow: 24, heat: 94, fog: 52 };
      App.game.temperature = temps[m] ?? App.game.temperature;
      App.world.setWeather(m);
      renderHUD();
    },
    jumpTo: (miles) => { App.game.miles = miles; App.world.setBand(App.game.snapshot().terrain.id); renderHUD(); },
    nextTurn: beginNextTurn,
    openEvent,
  };
  requestAnimationFrame(loop);
}

/* ---------------------------------------------------------------------------
   Frame loop — drives the 3D world and any ambient UI
   ------------------------------------------------------------------------- */
function loop(t) {
  if (!App.running) return;
  const dt = Math.min(0.05, (t - App.lastTime) / 1000 || 0.016);
  App.lastTime = t;
  try {
    // Weather and terrain are properties of the simulation, so the view reads
    // them from the game alone. Keeping a single source of truth here prevents
    // the two from fighting and reverting each other every frame.
    App.world.update(dt, {
      moving: App.moving,
      health: App.game.healthAverage,
      weather: App.game.weather,
      bandId: App.game.snapshot().terrain.id,
    });
  } catch (err) {
    // Never let a render hiccup kill the loop; log once.
    if (!App._warned) { console.warn('world update:', err); App._warned = true; }
  }
  requestAnimationFrame(loop);
}

/* ---------------------------------------------------------------------------
   Screens: title, outfit, travel
   ------------------------------------------------------------------------- */
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('is-active', s.dataset.screen === name));
  document.body.dataset.screen = name;
}

function wireTitle() {
  $('#btn-begin').addEventListener('click', () => {
    showScreen('outfit');
    renderOutfit();
  });
  $('#btn-about').addEventListener('click', () => openModal('about'));
}

/* ---------------------------------------------------------------------------
   Outfitting — click to add/remove goods; a live budget bar.
   ------------------------------------------------------------------------- */
function wireOutfit() {
  $('#btn-outfit-auto').addEventListener('click', () => {
    App.outfit = { ...STARTER_LOADOUT };
    renderOutfit();
  });
  $('#btn-outfit-clear').addEventListener('click', () => {
    App.outfit = Object.fromEntries(GOODS.map((g) => [g.id, 0]));
    App.outfit.oxen = 200;
    renderOutfit();
  });
  $('#btn-outfit-go').addEventListener('click', () => {
    if (!outfitValid()) return;
    // Correct oxen bounds are enforced by the engine.
    App.game.setOutfit(App.outfit);
    startTravel();
  });
}

function outfitCost() {
  return App.game.loadoutCost(App.outfit);
}

function outfitValid() {
  const c = outfitCost();
  const oxen = App.outfit.oxen || 0;
  if (oxen < 200) { toast('You need at least $200 of oxen — the trail is 2,040 miles.', 'bad'); return false; }
  if (oxen > 340) { toast('That is more team than one wagon can use. $340 is the most a single team is worth.', 'bad'); return false; }
  if (c > 700) { toast(`You have $700. That wagon costs $${Math.round(c)}.`, 'bad'); return false; }
  return true;
}

function renderOutfit() {
  const list = $('#outfit-list');
  list.innerHTML = '';
  for (const g of GOODS) {
    const qty = App.outfit[g.id] || 0;
    const isOxen = g.id === 'oxen';
    const cost = App.game.costOf(g.id, qty);

    const row = el('div', 'good');
    row.dataset.id = g.id;

    const info = el('div', 'good-info');
    info.append(
      el('div', 'good-name', g.label),
      el('div', 'good-blurb', g.blurb),
    );

    const steppers = el('div', 'good-steppers');
    // Oxen are bought in dollars, so the steps are larger and clearly labelled.
    const step = isOxen ? 10 : 1;
    const big = isOxen ? 50 : 5;
    const minusBig = el('button', 'step step-lg', '−' + big);
    minusBig.addEventListener('click', () => bump(g.id, -big));
    steppers.append(minusBig);
    const minus = el('button', 'step', '−' + (isOxen ? step : ''));
    minus.title = `Remove ${step}`;
    minus.addEventListener('click', () => bump(g.id, -step));
    steppers.append(minus);
    const plus = el('button', 'step', '+' + (isOxen ? step : ''));
    plus.title = `Add ${step}`;
    plus.addEventListener('click', () => bump(g.id, step));
    steppers.append(plus);
    const plusBig = el('button', 'step step-lg', '+' + big);
    plusBig.addEventListener('click', () => bump(g.id, big));
    steppers.append(plusBig);

    const qtyBox = el('div', 'good-qty');
    qtyBox.append(
      el('div', 'qty-value', isOxen ? '$' + qty : String(qty)),
      el('div', 'qty-unit', isOxen ? 'of oxen' : g.unit),
    );

    const price = el('div', 'good-price', '$' + cost.toFixed(isOxen ? 0 : 2));
    row.append(info, steppers, qtyBox, price);
    list.append(row);
  }
  updateBudget();
}

function bump(id, delta) {
  const g = GOODS_BY_ID[id];
  const cur = App.outfit[id] || 0;
  let next = cur + delta;
  if (id === 'oxen') {
    next = clamp(next, 0, 340);
  } else {
    next = clamp(next, 0, g.maxQty);
    // Stop growth at the per-item spend cap so no single choice eats the budget.
    if (delta > 0) {
      const capped = Math.floor(g.maxSpend / g.basePrice);
      next = Math.min(next, capped);
    }
    next = Math.floor(next);
  }
  // Never let the running total exceed the budget by clicking up.
  const trial = { ...App.outfit, [id]: next };
  if (App.game.loadoutCost(trial) > 700 && delta > 0) {
    toast('That would put you past your $700.', 'bad');
    return;
  }
  App.outfit = trial;
  renderOutfit();
}

function updateBudget() {
  const spent = outfitCost();
  const left = 700 - spent;
  $('#budget-spent').textContent = '$' + spent.toFixed(0);
  $('#budget-left').textContent = '$' + left.toFixed(0);
  const pct = clamp(spent / 700, 0, 1) * 100;
  $('#budget-bar').style.width = pct + '%';
  $('#budget-bar').classList.toggle('is-over', left < 0);
  $('#btn-outfit-go').disabled = !(left >= 0 && (App.outfit.oxen || 0) >= 200);
}

/* ---------------------------------------------------------------------------
   Travel screen
   ------------------------------------------------------------------------- */
function startTravel() {
  showScreen('travel');
  App.moving = false;
  App.world.setWeather(App.game.weather);
  App.world.setPaceFraction(0);
  App.world.setBand(App.game.snapshot().terrain.id);
  renderHUD(true);
  pushLog([{ text: 'Independence, Missouri. March 29, 1847.', tone: 'good' }]);
  beginNextTurn();
}

/* Opens the next turn at its first decision: the action menu. */
function beginNextTurn() {
  if (App.game.outcome) { openOutcome(); return; }
  App.game.beginTurn();
  App.moving = false;
  App.world.setPaceFraction(0);
  App.travelAnimating = false;
  setPaceEnabled(true);
  renderHUD();
  renderTurnPanel();
}

function wireTravel() {
  $('#pace-choices').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pace]');
    if (!b || App.travelAnimating) return;
    App.game.pace = b.dataset.pace;
    App.world.setPaceFraction(PACE[b.dataset.pace].miles);
    refreshActions();
    renderHUD();
  });
  $('#btn-journal').addEventListener('click', () => openJournal());
  $('#btn-help').addEventListener('click', () => openModal('howto'));
}

function refreshActions() {
  $$('#pace-choices [data-pace]').forEach((b) => b.classList.toggle('is-on', b.dataset.pace === App.game.pace));
  renderTurnPanel();
}

/* The action menu and the meal menu are driven from the same panel, in the
   same order as the 1978 program: action first, then eating, then travel. */
function renderTurnPanel() {
  const panel = $('#turn-panel');
  const options = $('#turn-options');
  const s = App.game.snapshot();
  options.innerHTML = '';
  panel.classList.remove('is-action', 'is-meal');

  if (s.outcome || (s.turnStage !== 'action' && s.turnStage !== 'meal')) {
    panel.classList.add('is-hidden');
    return;
  }

  panel.classList.remove('is-hidden');
  $('#turn-step').textContent = `Turn ${Math.max(1, s.turn)}`;

  if (s.turnStage === 'action') {
    panel.classList.add('is-action');
    $('#turn-title').textContent = 'What will you do?';
    const fort = nextFort();
    const starving = s.goods.food < STARVATION_FOOD_FLOOR;
    const note = $('#turn-note');
    note.textContent = `${starving ? 'The larder is nearly empty. ' : ''}${s.fortAvailable
      ? `${fort.name} is within reach this turn.`
      : 'No fort within reach this turn.'}`;
    note.classList.toggle('is-warning', starving);

    if (s.fortAvailable) {
      options.append(turnOption('Stop at the fort', `${fort.name} · trade at high prices`, () => handleTurnAction('fort'), { action: 'fort' }));
    }
    const canHunt = s.goods.bullets >= HUNT_MIN_BULLETS;
    options.append(turnOption(
      'Hunt',
      canHunt ? `${Math.round(s.goods.bullets)} rounds · six shots` : `${HUNT_MIN_BULLETS} rounds needed`,
      () => handleTurnAction('hunt'),
      { action: 'hunt', disabled: !canHunt },
    ));
    options.append(turnOption('Continue on', 'Take the trail as you are', () => handleTurnAction('continue'), { action: 'continue', primary: true }));
    return;
  }

  panel.classList.add('is-meal');
  $('#turn-title').textContent = 'The evening meal';
  const lowFood = s.goods.food < STARVATION_FOOD_FLOOR;
  const mealNote = $('#turn-note');
  mealNote.textContent = `Food: ${Math.round(s.goods.food)} lb · ${s.alive} at the table${lowFood ? ' · the larder is nearly empty' : ''}`;
  mealNote.classList.toggle('is-warning', lowFood);
  const meals = [
    ['basic', 'Poorly', 'Thin fare · morale falls'],
    ['moderate', 'Moderately', 'Steady fare · morale holds'],
    ['hearty', 'Well', 'Full fare · morale rises'],
  ];
  for (const [id, label, sub] of meals) {
    options.append(turnOption(label, sub, () => handleMeal(id), { meal: id, primary: id === 'moderate' }));
  }
}

function turnOption(label, sub, onClick, opts = {}) {
  const b = el('button', 'turn-opt' + (opts.primary ? ' is-primary' : ''));
  b.type = 'button';
  b.disabled = !!opts.disabled;
  if (opts.action) b.dataset.action = opts.action;
  if (opts.meal) b.dataset.meal = opts.meal;
  b.append(el('span', 'turn-opt-label', label), el('span', 'turn-opt-sub', sub));
  b.addEventListener('click', onClick);
  return b;
}

function nextFort() {
  const s = App.game.snapshot();
  const forts = LANDMARKS.filter((l) => l.kind === 'fort');
  return forts.find((f) => f.miles >= s.miles) || forts[forts.length - 1];
}

function handleTurnAction(action) {
  if (App.travelAnimating) return;
  if (!App.game.chooseAction(action)) {
    toast(action === 'fort' ? 'No fort is within reach this turn.' : `You need ${HUNT_MIN_BULLETS} rounds to hunt.`, 'bad');
    renderTurnPanel();
    return;
  }
  renderTurnPanel();
}

function handleMeal(level) {
  if (App.travelAnimating) return;
  if (!App.game.chooseMeal(level)) {
    toast('That meal is not possible tonight.', 'bad');
    return;
  }
  startTravelPhase();
}

/* Resolves the action, opens a fort or hunt if one was chosen, then travels. */
async function startTravelPhase() {
  if (App.travelAnimating || App.game.outcome) return;
  App.travelAnimating = true;
  hideTurnPanel();
  setPaceEnabled(false);

  const action = App.game.resolveTurn();
  if (action && action.atFort) {
    App.travelAnimating = false;
    openFort(() => continueAfterAction('fort'));
    return;
  }
  if (action && action.huntPending) {
    App.travelAnimating = false;
    openHunt(() => continueAfterAction('hunt'));
    return;
  }
  await runTravelNow();
}

async function continueAfterAction(kind) {
  if (App.travelAnimating) return;
  App.travelAnimating = true;
  hideTurnPanel();
  setPaceEnabled(false);
  const before = App.game.snapshot();
  if (kind === 'fort') App.game.resumeAfterFort();
  else App.game.resumeAfterHunt();
  const after = App.game.snapshot();
  await finishTurnAfterTravel(before, after);
}

async function runTravelNow() {
  const before = App.game.snapshot();
  App.game.travelTurn();
  const after = App.game.snapshot();
  await finishTurnAfterTravel(before, after);
}

function hideTurnPanel() {
  $('#turn-panel').classList.add('is-hidden');
}

function setPaceEnabled(on) {
  $$('#pace-choices .chip').forEach((b) => { b.disabled = !on; });
}

function renderHUD(initial = false) {
  const s = App.game.snapshot();

  $('#hud-date').textContent = s.date;
  $('#hud-daycount').textContent = `${s.totalDays} day${s.totalDays === 1 ? '' : 's'} on the trail`;
  $('#hud-terrain').textContent = s.terrain.label;
  $('#hud-weather').textContent = weatherLabel(s.weather) + ' · ' + Math.round(s.temperature) + '°F';

  const mi = $('#hud-miles');
  mi.textContent = s.miles.toLocaleString();
  const pct = clamp(s.progress, 0, 1) * 100;
  $('#hud-progress-fill').style.width = pct + '%';
  $('#hud-remaining').textContent = s.milesRemaining.toLocaleString() + ' mi to Oregon City';

  // Landmark rulers
  renderRulers(s);

  // Resources
  renderResources(s);

  // Party
  renderParty(s);

  // Morale meter
  $('#morale-fill').style.width = clamp(s.morale, 0, 100) + '%';
  $('#morale-value').textContent = s.morale;

  $('#hud-season').textContent = s.season;
  $('#hud-season').classList.toggle('is-warning', s.date.includes('October') || s.date.includes('November') || s.date.includes('December'));
}

function weatherLabel(w) {
  return { clear: 'Clear', overcast: 'Overcast', rain: 'Rain', storm: 'Storm', snow: 'Snow', heat: 'Heat', fog: 'Fog' }[w] || w;
}

function renderRulers(s) {
  const host = $('#ruler');
  host.innerHTML = '';
  for (const l of LANDMARKS) {
    const pos = clamp(l.miles / TOTAL_MILES, 0, 1) * 100;
    const dot = el('div', 'ruler-dot');
    dot.style.left = pos + '%';
    dot.classList.toggle('is-past', l.miles <= s.miles);
    dot.classList.toggle('is-here', s.currentLandmark && s.currentLandmark.name === l.name);
    dot.title = `${l.name} — mile ${l.miles}`;
    host.append(dot);
    // Only the most significant landmarks get a caption, and they alternate
    // above/below the ruler so neighbouring names cannot overlap.
    const NAMED = ['Fort Kearney', 'Fort Laramie', 'South Pass', 'Fort Hall', 'Blue Mountains', 'Oregon City'];
    if (NAMED.includes(l.name)) {
      const lab = el('div', 'ruler-label', l.name);
      lab.style.left = pos + '%';
      if (NAMED.indexOf(l.name) % 2 === 1) lab.classList.add('is-alt');
      host.append(lab);
    }
  }
  const me = el('div', 'ruler-wagon');
  me.style.left = clamp(s.progress, 0, 1) * 100 + '%';
  host.append(me);
}

const RES_SHOW = [
  ['food', 'Food', 'lb'],
  ['bullets', 'Ammo', 'rds'],
  ['water', 'Water', 'kegs'],
  ['medicine', 'Meds', 'doses'],
  ['clothing', 'Clothes', 'sets'],
  ['blankets', 'Blankets', ''],
  ['feed', 'Feed', 'bales'],
  ['tools', 'Tools', ''],
];

function renderResources(s) {
  const host = $('#resources');
  host.innerHTML = '';
  for (const [id, label, unit] of RES_SHOW) {
    const v = Math.round(s.goods[id] ?? 0);
    const card = el('div', 'res');
    card.classList.toggle('is-empty', v <= 0);
    card.classList.toggle('is-low', v > 0 && v < 15);
    card.append(
      el('div', 'res-label', label),
      el('div', 'res-value', String(v)),
      el('div', 'res-unit', unit),
    );
    host.append(card);
  }
  const cash = el('div', 'res res-cash');
  cash.append(el('div', 'res-label', 'Cash'), el('div', 'res-value', '$' + s.cash), el('div', 'res-unit', 'dollars'));
  host.append(cash);
}

function renderParty(s) {
  const host = $('#party');
  host.innerHTML = '';
  for (const p of s.party) {
    const card = el('div', 'member');
    card.classList.toggle('is-dead', !p.alive);
    const hp = Math.round(clamp(p.health, 0, 1) * 100);
    card.append(
      el('div', 'member-name', p.name),
      el('div', 'member-role', p.alive ? p.role : 'Lost'),
    );
    const bar = el('div', 'member-bar');
    const fill = el('div', 'member-fill');
    fill.style.width = hp + '%';
    fill.classList.toggle('is-warn', hp < 55);
    fill.classList.toggle('is-bad', hp < 30);
    bar.append(fill);
    card.append(bar);
    host.append(card);
  }
}

function pushLog(entries) {
  const host = $('#log');
  for (const e of entries) {
    if (!e || !e.text) continue;
    const line = el('div', 'log-line tone-' + (e.tone || 'plain'), e.text);
    host.append(line);
  }
  while (host.children.length > 60) host.removeChild(host.firstChild);
  host.scrollTop = host.scrollHeight;
}

/* ---------------------------------------------------------------------------
   The travel sequence.

   A turn's journey is a real cinematic: the world rolls for several seconds
   while the mileage, date and odometer advance on screen, day counters tick
   over, and the hazards of the turn are revealed one at a time as they happen.
   `TRAVEL_SECONDS` is the floor, and it is deliberately generous — the journey
   should feel like a journey, not a button press.
   ------------------------------------------------------------------------- */
const TRAVEL_SECONDS = 5.4;

async function playTravelSequence(from, to, turnLog) {
  App.moving = true;
  App.world.setPaceFraction(PACE[App.game.pace].miles);
  $('#travel-status').textContent = 'On the trail…';
  hideTurnPanel();
  setPaceEnabled(false);

  // Every player gets the full journey. Reduced-motion users get a steadier
  // camera (world.js suppresses the bob), not a shortened turn. `fastTravel`
  // is a test-only hook so automated suites do not spend five seconds per turn.
  const duration = App.fastTravel ? 900 : TRAVEL_SECONDS * 1000;
  const start = performance.now();
  const startMiles = from.miles;
  const dMiles = to.miles - startMiles;
  const startDays = from.totalDays;
  const dDays = to.totalDays - startDays;

  // Reveal the turn's events progressively across the journey, so the log
  // fills in as the wagon rolls rather than appearing all at once.
  const beats = (turnLog || []).filter((e) => e && e.text);
  const revealed = new Set();
  const perBeat = beats.length ? duration / (beats.length + 0.6) : duration;

  await new Promise((resolve) => {
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;

      // Odometer and calendar advance with the wagon.
      const shownMiles = Math.round(startMiles + dMiles * eased);
      $('#hud-miles').textContent = Math.max(0, shownMiles).toLocaleString();
      $('#hud-remaining').textContent = Math.max(0, TOTAL_MILES - shownMiles).toLocaleString() + ' mi to Oregon City';
      $('#hud-progress-fill').style.width = clamp(shownMiles / TOTAL_MILES, 0, 1) * 100 + '%';
      const shownDays = Math.round(startDays + dDays * eased);
      $('#hud-daycount').textContent = `${shownDays} day${shownDays === 1 ? '' : 's'} on the trail`;

      // Reveal each event as the journey passes its beat.
      const due = Math.min(beats.length, Math.floor((now - start) / perBeat));
      while (revealed.size < due && revealed.size < beats.length) {
        const i = revealed.size;
        revealed.add(i);
        pushLog([beats[i]]);
      }

      if (t < 1) { requestAnimationFrame(tick); return; }
      resolve();
    };
    requestAnimationFrame(tick);
  });

  // Flush any beats not yet shown (e.g. if a frame was dropped).
  for (let i = revealed.size; i < beats.length; i += 1) pushLog([beats[i]]);

  App.moving = false;
  App.world.setPaceFraction(0);
  $('#travel-status').textContent = 'Camp';
  renderHUD();
}

/* Plays the journey, then opens whatever the turn produced: a hazard, a
   landmark card, the ending, or the next turn's action menu. */
async function finishTurnAfterTravel(before, after) {
  // A wagon that starves at camp never rolls: no journey to animate, so show
  // the ending (and its log) at once instead of a five-second false start.
  if (after.outcome && after.miles <= before.miles) {
    App.travelAnimating = false;
    pushLog(after.log);
    renderHUD();
    openOutcome();
    return;
  }

  App.travelAnimating = true;
  await playTravelSequence(before, after, after.log);
  App.travelAnimating = false;

  if (after.outcome) { openOutcome(); return; }
  if (after.pendingEvent) { openEvent(after.pendingEvent); return; }
  if (App.game.hasLandmarkPending) {
    openLandmark(after.arrivedAt || App.game.arrivedAt);
    return;
  }
  beginNextTurn();
}

/* ---------------------------------------------------------------------------
   Landmark arrival card
   ------------------------------------------------------------------------- */
function openLandmark(lm) {
  if (!lm) { App.game.continueFromLandmark(); beginNextTurn(); return; }
  const kind = lm.kind;

  // Bring the set piece into view.
  if (kind !== 'town') App.world.spawnLandmark(kind);

  const body = $('#modal-body');
  body.innerHTML = '';
  body.append(
    el('div', 'modal-eyebrow', `Mile ${lm.miles.toLocaleString()}`),
    el('h2', 'modal-title', lm.name),
    el('p', 'modal-lead', lm.note),
  );

  if (kind === 'river') {
    body.append(el('p', 'modal-text', 'The crossing is your choice to make.'));
    const actions = el('div', 'modal-actions');
    const bFord = el('button', 'btn btn-ghost', 'Ford the river');
    bFord.addEventListener('click', () => { App.game.fordRiver(lm); afterLandmark(); });
    const bFerry = el('button', 'btn btn-ghost', 'Take the ferry');
    bFerry.addEventListener('click', () => { App.game.ferryRiver(lm); afterLandmark(); });
    const bCaulk = el('button', 'btn btn-ghost', 'Caulk and float');
    bCaulk.addEventListener('click', () => { App.game.caulkWagon(lm); afterLandmark(); });
    actions.append(bFord, bFerry, bCaulk);
    body.append(el('h3', 'modal-sub', 'How will you cross?'), actions);
  } else {
    const actions = el('div', 'modal-actions');
    const bOn = el('button', 'btn btn-primary', 'Onward');
    bOn.addEventListener('click', afterLandmark);
    actions.append(bOn);
    body.append(actions);
  }

  openModal(null, { keepBody: true });

  function afterLandmark() {
    // Log any messages the crossing produced.
    pushLog(App.game.log);
    App.game.continueFromLandmark();
    renderHUD();
    closeModal();
    if (App.game.outcome) { openOutcome(); return; }
    beginNextTurn();
  }
}

/* ---------------------------------------------------------------------------
   Event card
   ------------------------------------------------------------------------- */
function openEvent(ev) {
  const body = $('#modal-body');
  body.innerHTML = '';
  body.append(
    el('div', 'modal-eyebrow', 'Encounter'),
    el('h2', 'modal-title', ev.title),
    el('p', 'modal-lead', ev.body),
  );
  const actions = el('div', 'modal-actions');
  for (const c of ev.choices) {
    const b = el('button', 'btn ' + (c.id === 'run' ? 'btn-primary' : 'btn-ghost'), c.label);
    b.dataset.choice = c.id;
    b.addEventListener('click', () => {
      App.game.resolveRiders(c.id);
      pushLog(App.game.log);
      renderHUD();
      closeModal();
      if (App.game.outcome) { openOutcome(); return; }
      if (App.game.hasLandmarkPending) { openLandmark(App.game.arrivedAt); return; }
      beginNextTurn();
    });
    actions.append(b);
  }
  body.append(el('h3', 'modal-sub', 'Tactics'), actions);
  openModal(null, { keepBody: true });
}

/* ---------------------------------------------------------------------------
   Hunting minigame — aim with the mouse, click to fire. No keyboard.
   ------------------------------------------------------------------------- */
function openHunt(onComplete) {
  if (App.game.goods.bullets < HUNT_MIN_BULLETS) {
    toast(`You need at least ${HUNT_MIN_BULLETS} rounds to hunt.`, 'bad');
    return;
  }
  // Hunting is a modal activity of its own; never let a card sit behind it.
  closeModal();
  const overlay = $('#hunt');
  const field = $('#hunt-field');
  field.innerHTML = '';
  overlay.classList.add('is-active');

  const animals = [];
  const kinds = [
    { id: 'deer',     label: 'Deer',     points: 1.0, speed: 1.0, size: 1.0 },
    { id: 'antelope', label: 'Antelope', points: 0.8, speed: 1.5, size: 0.85 },
    { id: 'bison',    label: 'Bison',    points: 1.4, speed: 0.6, size: 1.5 },
    { id: 'rabbit',   label: 'Rabbit',   points: 0.4, speed: 2.0, size: 0.5 },
  ];

  const shots = 6;
  App.hunt = {
    shots, spent: 0, hits: [], started: performance.now(),
    onComplete: typeof onComplete === 'function' ? onComplete : null,
  };

  $('#hunt-shots').textContent = shots;

  for (let i = 0; i < 7; i += 1) {
    const k = kinds[i % kinds.length];
    const node = el('button', 'animal animal-' + k.id);
    node.style.left = (6 + Math.random() * 84) + '%';
    node.style.top = (12 + Math.random() * 66) + '%';
    node.style.setProperty('--sz', (44 * k.size) + 'px');
    node.dataset.points = k.points;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const speed = 8 * k.speed * dir;
    node.dataset.speed = speed;
    node.dataset.phase = Math.random() * 6.28;
    node.dataset.baseTop = node.style.top;
    node.setAttribute('aria-label', k.name);
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      onHit(node);
    });
    field.append(node);
    animals.push(node);
  }
  App.hunt.animals = animals;
  App.hunt.field = field;

  // Animate animals across the field.
  cancelAnimationFrame(App.hunt.raf);
  const t0 = performance.now();
  const step = (t) => {
    if (!App.hunt) return;
    const dt = (t - t0) / 1000;
    for (const a of animals) {
      if (a.classList.contains('is-hit')) continue;
      const speed = parseFloat(a.dataset.speed);
      const phase = parseFloat(a.dataset.phase);
      const baseX = parseFloat(a.style.left);
      let x = baseX + Math.sin(dt * 0.5 * Math.abs(speed) / 8 + phase) * 14;
      x = ((x % 96) + 96) % 96 + 2;
      a.style.left = x + '%';
      const baseTop = parseFloat(a.dataset.baseTop);
      a.style.top = (baseTop + Math.sin(dt * 2 + phase) * 4) + '%';
    }
    App.hunt.raf = requestAnimationFrame(step);
  };
  App.hunt.raf = requestAnimationFrame(step);
}

function onHit(node) {
  if (!App.hunt || node.classList.contains('is-hit')) return;
  if (App.hunt.shots <= 0) return;
  App.hunt.shots -= 1;
  App.hunt.spent += 1;
  node.classList.add('is-hit');
  const pts = parseFloat(node.dataset.points);
  App.hunt.hits.push(pts);
  $('#hunt-shots').textContent = App.hunt.shots;
  spawnPop(node);
  if (App.hunt.shots <= 0) setTimeout(resolveHunt, 420);
}

function spawnPop(node) {
  const pop = el('div', 'hunt-pop', '+');
  pop.style.left = node.style.left;
  pop.style.top = node.style.top;
  $('#hunt-field').append(pop);
  setTimeout(() => pop.remove(), 700);
}

function wireModals() {
  $('#hunt-done').addEventListener('click', resolveHunt);
  $('#modal-close').addEventListener('click', () => {
    // Closing the how-to/about modal only.
    if ($('#modal').dataset.kind === 'info') closeModal();
  });
  document.addEventListener('click', (e) => {
    if (e.target.id === 'modal-scrim' && $('#modal').dataset.kind === 'info') closeModal();
  });
}

function resolveHunt() {
  if (!App.hunt) return;
  cancelAnimationFrame(App.hunt.raf);
  const done = App.hunt.onComplete;
  const hits = App.hunt.hits;
  const accuracy = clamp(hits.reduce((a, b) => a + b, 0) / Math.max(2, App.hunt.spent), 0, 1.2);
  const result = App.game.huntOutcome(accuracy);
  App.hunt = null;
  $('#hunt').classList.remove('is-active');
  renderHUD();
  pushLog([{ text: result.text + (result.meat ? ` (${result.meat} lb)` : ''), tone: result.meat > 20 ? 'good' : result.meat ? 'plain' : 'bad' }]);
  toast(result.text + (result.meat ? ` +${result.meat} lb` : ''), result.meat ? 'good' : 'bad');
  if (done) done();
  else renderTurnPanel();
}

/* ---------------------------------------------------------------------------
   Fort trading post — prices are punitive, so the choice of what to buy is
   the decision. Purchases happen immediately; the player leaves when ready.
   ------------------------------------------------------------------------- */
const FORT_STEPS = {
  oxen: [10, 50], food: [25, 100], bullets: [50, 200], clothing: [5, 20],
  medicine: [2, 5], tools: [1, 3], spareParts: [1, 2], water: [2, 8],
  feed: [5, 20], blankets: [5, 20], coffee: [5, 20], books: [2, 6],
};

function openFort(onComplete) {
  closeModal();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    closeModal();
    if (typeof onComplete === 'function') onComplete();
  };

  const draw = () => {
    const s = App.game.snapshot();
    const fort = nextFort();
    const body = $('#modal-body');
    body.innerHTML = '';
    body.append(
      el('div', 'modal-eyebrow', `Mile ${s.miles.toLocaleString()} · trading post`),
      el('h2', 'modal-title', fort.name),
      el('p', 'modal-lead', `${fort.note} Prices here run about ${Math.round((App.game.priceMultiplier(true) - 1) * 100)} percent over Independence.`),
    );

    const purse = el('div', 'fort-purse');
    purse.append(
      el('span', 'fort-purse-k', 'Cash on hand'),
      el('span', 'fort-purse-v', '$' + s.cash.toLocaleString()),
    );
    body.append(purse);

    const list = el('div', 'fort-list');
    for (const g of GOODS) {
      const unitPrice = App.game.priceOf(g.id, true);
      const have = g.id === 'oxen' ? s.oxenStrength : Math.round(s.goods[g.id] || 0);
      const row = el('div', 'fort-good');
      const info = el('div', 'fort-good-info');
      info.append(
        el('div', 'fort-good-name', g.label),
        el('div', 'fort-good-meta', `$${unitPrice.toFixed(2)} each · you have ${have} ${g.unit}`),
      );
      const actions = el('div', 'fort-good-actions');
      for (const qty of (FORT_STEPS[g.id] || [1, 5])) {
        const cost = unitPrice * qty;
        const b = el('button', 'step step-lg', '+' + qty);
        b.type = 'button';
        b.title = `Buy ${qty} ${g.unit} for $${cost.toFixed(2)}`;
        b.disabled = cost > s.cash + 1e-9;
        b.addEventListener('click', () => {
          if (!App.game.buy(g.id, qty, true)) {
            toast('Not enough cash for that purchase.', 'bad');
            return;
          }
          renderHUD();
          draw();
        });
        actions.append(b);
      }
      row.append(info, actions);
      list.append(row);
    }
    body.append(list);

    const actions = el('div', 'modal-actions');
    const back = el('button', 'btn btn-primary', 'Back to the trail →');
    back.addEventListener('click', finish);
    actions.append(back);
    body.append(actions);
  };

  draw();
  openModal(null, { keepBody: true });
}

/* ---------------------------------------------------------------------------
   Journal, info modals, toasts, outcome
   ------------------------------------------------------------------------- */
function wireJournal() {
  $('#journal-close').addEventListener('click', () => $('#journal').classList.remove('is-active'));
}

function openJournal() {
  const host = $('#journal-body');
  const s = App.game.snapshot();
  host.innerHTML = '';
  const head = el('div', 'journal-head');
  head.append(
    el('div', 'journal-date', s.date),
    el('div', 'journal-where', `${s.terrain.label} · Mile ${s.miles.toLocaleString()}`),
  );
  host.append(head);

  const grid = el('div', 'journal-grid');
  const stats = [
    ['Days on trail', s.totalDays],
    ['Miles walked', Math.round(s.stats.milesWalked).toLocaleString()],
    ['Landmarks passed', App.game.landmarks.filter((l) => l.visited).length + ' / ' + LANDMARKS.length],
    ['Times hunted', s.stats.hunted],
    ['Meat taken', Math.round(s.stats.meatTaken) + ' lb'],
    ['Rivers forded', s.stats.riversFords],
    ['Rivers ferried', s.stats.riversFerried],
    ['Hardships', s.stats.eventsSuffered],
    ['Friendly meetings', s.stats.friendlyEncounters],
    ['Hostile meetings', s.stats.hostileEncounters],
    ['Wagon load', s.wagonWeight + ' lb'],
    ['Survivors', s.alive + ' of 5'],
  ];
  for (const [k, v] of stats) {
    const row = el('div', 'journal-stat');
    row.append(el('div', 'js-k', k), el('div', 'js-v', String(v)));
    grid.append(row);
  }
  host.append(grid);

  if (App.game.dead.length) {
    host.append(el('h3', 'journal-sub', 'In Memoriam'));
    for (const d of App.game.dead) host.append(el('div', 'journal-mem', `${d.name} — died ${d.cause}`));
  }
  host.append(el('h3', 'journal-sub', 'Trail Log'));
  const logHost = el('div', 'journal-log');
  for (const l of App.game.log.slice(-60)) logHost.append(el('div', 'log-line tone-' + l.tone, l.text));
  host.append(logHost);

  $('#journal').classList.add('is-active');
}

/* `kind` is 'about' | 'howto' for informational overlays (dismissable any way)
   or null for a blocking game card (landmark / event / outcome), which must be
   resolved by choosing an action. */
function openModal(kind, opts = {}) {
  const modal = $('#modal');
  const info = kind === 'about' || kind === 'howto';
  modal.dataset.kind = info ? 'info' : 'card';
  if (!opts.keepBody) {
    const body = $('#modal-body');
    body.innerHTML = '';
    if (kind === 'about') {
      // About copy follows.
      body.append(
        el('div', 'modal-eyebrow', 'About'),
        el('h2', 'modal-title', 'Lone Passage'),
        el('p', 'modal-lead', 'A remake of the 1978 MECC classic, rebuilt for the browser with no keyboard.'),
        el('p', 'modal-text', 'Every rule of the original simulation survives inside this game: the travel-rate formula, the sixteen-event hazard table, the illness severity roll, the rider encounter curve, and the South Pass and Blue Mountains crossings. Around that skeleton sits a modern trail: twelve resources to balance, a named family with individual health, weather and terrain, and eighteen real landmarks at their true mileposts.'),
        el('p', 'modal-text', 'The original programmed by Bill Heinemann (1971) and Don Rawitsch, with material from the Minnesota Educational Computing Consortium.'),
      );
    } else {
      body.append(
        el('div', 'modal-eyebrow', 'How to play'),
        el('h2', 'modal-title', 'The Trail Ahead'),
        el('p', 'modal-lead', 'Everything is a click. There is no keyboard input anywhere in this game.'),
        el('p', 'modal-text', 'Outfit your wagon against a $700 budget. Oxen set your pace; food and medicine keep your family alive; clothing and blankets see you through the mountains.'),
        el('p', 'modal-text', 'Every turn asks two decisions: an action — stop at a fort, hunt, or continue — and the family’s meal. Then the wagon rolls. Brisk or gruelling paces cover more ground but wear down your family and their animals. Watch the season: the passes close in November.'),
        el('p', 'modal-text', 'Click animals to hunt. Click a landmark to move on. Open your journal any time to see the full history of the run.'),
      );
    }
  }
  $('#modal').classList.add('is-active');
}

function closeModal() {
  $('#modal').classList.remove('is-active');
}

function toast(text, tone = 'plain') {
  const host = $('#toast');
  host.textContent = text;
  host.className = 'toast is-visible tone-' + tone;
  clearTimeout(App.toastTimer);
  App.toastTimer = setTimeout(() => { host.className = 'toast'; }, 3600);
}

function openOutcome() {
  const s = App.game.snapshot();
  const score = App.game.score();
  const body = $('#modal-body');
  body.innerHTML = '';
  const won = s.outcome === 'arrived';
  body.append(
    el('div', 'modal-eyebrow', won ? 'Journey Complete' : 'The Trail Ends'),
    el('h2', 'modal-title outcome-' + (won ? 'win' : 'loss'), won ? 'Oregon City at Last' : score.rank),
  );

  const summary = el('div', 'outcome-grid');
  const rows = [
    ['Miles covered', s.miles.toLocaleString()],
    ['Days on the trail', s.totalDays],
    ['Survivors', s.alive + ' of 5'],
    ['Final morale', s.morale],
    ['Cash remaining', '$' + s.cash],
    ['Score', score.score.toLocaleString()],
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'outcome-row');
    r.append(el('div', 'or-k', k), el('div', 'or-v', String(v)));
    summary.append(r);
  }
  body.append(summary);

  if (won) {
    body.append(el('p', 'modal-lead', `Rank: ${score.rank}. You have done what half the wagons on this trail never did.`));
  } else {
    body.append(el('p', 'modal-lead', `Your party perished ${s.miles.toLocaleString()} miles out. The trail is long, and it does not forgive a thin outfit.`));
  }
  if (App.game.dead.length) {
    body.append(el('h3', 'modal-sub', 'Those who did not arrive'));
    for (const d of App.game.dead) body.append(el('div', 'journal-mem', `${d.name} — died ${d.cause}`));
  }

  const actions = el('div', 'modal-actions');
  const again = el('button', 'btn btn-primary', 'Take the trail again');
  again.addEventListener('click', () => {
    closeModal();
    App.game = new OregonTrailGame({ seed: (Date.now() ^ 0x77a1) >>> 0 });
    App.outfit = { ...STARTER_LOADOUT };
    App.travelAnimating = false;
    App.moving = false;
    App.world.setPaceFraction(0);
    hideTurnPanel();
    setPaceEnabled(true);
    $('#travel-status').textContent = 'Camp';
    renderOutfit();
    showScreen('title');
  });
  actions.append(again);
  body.append(actions);
  openModal(null, { keepBody: true });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------------------
   Go
   ------------------------------------------------------------------------- */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
