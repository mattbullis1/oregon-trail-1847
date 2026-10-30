/**
 * OREGON TRAIL - 1847
 * Touch interface. Every decision is a button; no keyboard is required at any
 * point (the shooting game is timed taps instead of typed words).
 */

import {
  BUDGET,
  FORT_ITEMS,
  MEALS,
  PURCHASE_ITEMS,
  START_DATE,
  TACTICS,
  TOTAL_MILES,
  createSession,
  int,
} from './engine.js';
import { TrailScene } from './graphics.js';
import { icon } from './icons.js';

const SAVE_KEY = 'oregonTrail1847.save.v1';
const SETTINGS_KEY = 'oregonTrail1847.settings.v1';
const SAVE_VERSION = 1;

const INSTRUCTIONS = [
  'THIS SIMULATES A TRIP OVER THE OREGON TRAIL FROM INDEPENDENCE, MISSOURI TO OREGON CITY, OREGON IN 1847.',
  "YOUR FAMILY OF FIVE WILL COVER THE 2040 MILE TRAIL IN 5-6 MONTHS - IF YOU MAKE IT ALIVE.",
  "YOU SAVED $900 AND PAID $200 FOR A WAGON. THE REMAINING $700 BUYS YOUR SUPPLIES.",
  'OXEN: $200-$300. A BETTER TEAM MOVES FASTER.',
  'FOOD: MORE FOOD MEANS LESS SICKNESS.',
  'AMMUNITION: $1 BUYS 50 BULLETS. NEEDED FOR HUNTING AND DEFENSE.',
  'CLOTHING: IMPORTANT IN THE COLD MOUNTAIN PASSES.',
  'MISC. SUPPLIES: MEDICINE AND EMERGENCY REPAIRS.',
  'YOU MAY SAVE CASH FOR THE FORTS ALONG THE TRAIL, BUT GOODS COST MORE THERE.',
  'HUNT ALONG THE WAY FOR FRESH MEAT. WHEN THE RIFLE COMES UP, TAP FIRE AS FAST AS YOU CAN.',
  'EATING BETTER COSTS MORE FOOD BUT KEEPS ILLNESS AWAY.',
  'AT EACH FORK IN THE TRAIL YOU CHOOSE: STOP AT A FORT, HUNT, OR CONTINUE.',
];

const ctx = {
  session: null,
  scene: null,
  renderedLog: 0,
  timer: null,
  settings: { muted: false, reducedMotion: false },
  audio: null,
  els: {},
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(className, label, onClick, { disabled = false, iconName = null } = {}) {
  const node = el('button', className);
  node.type = 'button';
  if (iconName) node.innerHTML = icon(iconName, 'btn-icon');
  node.append(el('span', 'btn-label', label));
  if (disabled) node.disabled = true;
  node.addEventListener('click', (event) => {
    event.preventDefault();
    if (node.disabled) return;
    sfx('click');
    onClick();
  });
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function randomSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(ctx.settings, JSON.parse(raw));
  } catch {
    /* storage unavailable; defaults are fine */
  }
  return ctx.settings;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(ctx.settings));
  } catch {
    /* ignore */
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== SAVE_VERSION || !Array.isArray(data.answers)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeSave() {
  if (!ctx.session) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      version: SAVE_VERSION,
      seed: ctx.session.seed,
      answers: ctx.session.answers,
      promptType: ctx.session.prompt ? ctx.session.prompt.type : null,
      done: ctx.session.done,
      savedAt: Date.now(),
    }));
  } catch {
    /* storage full or blocked; play continues */
  }
}

/* ------------------------------------------------------------------ *
 * Sound (tiny WebAudio, gesture gated)
 * ------------------------------------------------------------------ */

function ensureAudio() {
  if (ctx.settings.muted) return null;
  if (!ctx.audio) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx.audio = new Ctor();
  }
  if (ctx.audio.state === 'suspended') ctx.audio.resume().catch(() => {});
  return ctx.audio;
}

function tone(freq, duration, type, gain) {
  const audio = ensureAudio();
  if (!audio) return;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.value = gain;
  amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
  osc.connect(amp).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + duration);
}

function noise(duration, gain) {
  const audio = ensureAudio();
  if (!audio) return;
  const frames = Math.floor(audio.sampleRate * duration);
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }
  const source = audio.createBufferSource();
  const amp = audio.createGain();
  amp.gain.value = gain;
  source.buffer = buffer;
  source.connect(amp).connect(audio.destination);
  source.start();
}

function sfx(kind) {
  if (ctx.settings.muted) return;
  if (kind === 'click') tone(560, 0.05, 'square', 0.03);
  if (kind === 'choose') tone(760, 0.08, 'triangle', 0.05);
  if (kind === 'shoot') { noise(0.22, 0.25); tone(120, 0.2, 'sawtooth', 0.12); }
  if (kind === 'event') tone(300, 0.18, 'triangle', 0.06);
  if (kind === 'good') { tone(660, 0.1, 'triangle', 0.06); setTimeout(() => tone(880, 0.16, 'triangle', 0.06), 90); }
  if (kind === 'bad') { tone(220, 0.22, 'sawtooth', 0.07); setTimeout(() => tone(160, 0.3, 'sawtooth', 0.07), 140); }
  if (kind === 'win') {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.07), i * 140));
  }
}

/* ------------------------------------------------------------------ *
 * HUD and log
 * ------------------------------------------------------------------ */

const CHIPS = [
  { key: 'food', label: 'FOOD', icon: 'food' },
  { key: 'bullets', label: 'BULLETS', icon: 'bullets' },
  { key: 'clothing', label: 'CLOTHING', icon: 'clothing' },
  { key: 'supplies', label: 'SUPPLIES', icon: 'supplies' },
  { key: 'cash', label: 'CASH', icon: 'cash' },
  { key: 'oxen', label: 'OXEN', icon: 'oxen' },
];

function renderHud(state) {
  if (!state) return;
  ctx.els.date.textContent = state.date || START_DATE;
  ctx.els.miles.textContent = `${state.mileage} / ${TOTAL_MILES} MI`;
  ctx.els.progress.style.width = `${Math.min(100, (state.mileage / TOTAL_MILES) * 100)}%`;

  const health = ctx.els.health;
  health.hidden = state.health === 'GOOD';
  health.textContent = state.health;
  health.className = `health-badge health-${state.health === 'GOOD' ? 'good' : state.health === 'INJURED' ? 'warn' : 'bad'}`;

  clearNode(ctx.els.chips);
  for (const chip of CHIPS) {
    const value = chip.key === 'cash' ? `$${state.cash}` : String(state[chip.key]);
    const node = el('div', `chip chip-${chip.key}`);
    node.innerHTML = icon(chip.icon, 'chip-icon');
    node.append(el('span', 'chip-value', value), el('span', 'chip-label', chip.label));
    ctx.els.chips.append(node);
  }
}

function appendLog(entries) {
  if (!entries || !entries.length) return;
  const nearBottom = ctx.els.log.scrollHeight - ctx.els.log.scrollTop - ctx.els.log.clientHeight < 60;
  for (const entry of entries) {
    const line = el('p', `log-line log-${entry.kind}`);
    line.textContent = entry.text;
    if (entry.meta && Number.isFinite(entry.meta.responseTime)) {
      line.append(el('span', 'log-time', ` ${entry.meta.responseTime.toFixed(2)}s`));
    }
    ctx.els.log.append(line);
  }
  while (ctx.els.log.childElementCount > 220) ctx.els.log.removeChild(ctx.els.log.firstChild);
  if (nearBottom) ctx.els.log.scrollTop = ctx.els.log.scrollHeight;
}

function renderLog(state) {
  const log = state.log || [];
  appendLog(log.slice(ctx.renderedLog));
  ctx.renderedLog = log.length;
}

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */

function updateScene(prompt) {
  const state = prompt.state;
  const scene = ctx.scene;
  scene.setView({
    mileage: state.mileage,
    turn: state.turn,
    weather: state.weather || 'clear',
    outcome: state.outcome,
    deathCause: state.deathCause,
    promptType: prompt.type,
    context: prompt.context || null,
    food: state.food,
    oxen: state.oxen,
  });

  const region = state.mileage < 950 ? 'PLAINS' : state.mileage < 1700 ? 'ROCKY MOUNTAINS' : 'BLUE MOUNTAINS';
  const where = state.mileage <= 0 ? 'INDEPENDENCE, MISSOURI' : region;
  ctx.els.caption.textContent = `${where} - TURN ${state.turn || 0}`;
}

/* ------------------------------------------------------------------ *
 * Stepper (touch only, no keyboard)
 * ------------------------------------------------------------------ */

function stepper({ label, hint, value, min = 0, max = 9999, step = 5, chips = [], onChange }) {
  const row = el('div', 'stepper');
  const head = el('div', 'stepper-head');
  head.append(el('span', 'stepper-label', label));
  if (hint) head.append(el('span', 'stepper-hint', hint));
  row.append(head);

  const controls = el('div', 'stepper-controls');
  let current = value;

  const minus = el('button', 'step-btn', '-');
  minus.type = 'button';
  const plus = el('button', 'step-btn', '+');
  plus.type = 'button';
  const display = el('div', 'step-value');
  const money = el('span', 'step-money', `$${current}`);
  const extra = el('span', 'step-extra', '');
  display.append(money, extra);

  function update(next, silent) {
    current = Math.max(min, Math.min(max, Math.round(next)));
    money.textContent = `$${current}`;
    if (extra.dataset.suffix) extra.textContent = extra.dataset.suffix.replace('{v}', String(Math.round(current * Number(extra.dataset.factor || 1))));
    if (!silent) {
      sfx('click');
      onChange(current);
    }
  }

  function hold(fn) {
    let delay = null;
    let repeat = null;
    const start = (event) => {
      event.preventDefault();
      fn();
      delay = setTimeout(() => {
        repeat = setInterval(fn, 80);
      }, 380);
    };
    const stop = () => {
      clearTimeout(delay);
      clearInterval(repeat);
      delay = null;
      repeat = null;
    };
    return { start, stop };
  }

  const minusHold = hold(() => update(current - step));
  const plusHold = hold(() => update(current + step));
  for (const [node, handlers] of [[minus, minusHold], [plus, plusHold]]) {
    node.addEventListener('pointerdown', handlers.start);
    node.addEventListener('pointerup', handlers.stop);
    node.addEventListener('pointerleave', handlers.stop);
    node.addEventListener('pointercancel', handlers.stop);
  }

  controls.append(minus, display, plus);
  row.append(controls);

  if (chips.length) {
    const chipRow = el('div', 'chip-row');
    for (const chip of chips) {
      const chipButton = el('button', 'preset', `$${chip}`);
      chipButton.type = 'button';
      chipButton.addEventListener('click', () => update(chip));
      chipRow.append(chipButton);
    }
    row.append(chipRow);
  }

  row.__setValue = (next) => update(next, true);
  row.__value = () => current;
  return row;
}

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

function panelHead(title, subtitle, message) {
  const head = el('div', 'panel-head');
  head.append(el('h2', 'panel-title', title));
  if (subtitle) head.append(el('p', 'panel-sub', subtitle));
  if (message) head.append(el('p', 'panel-message', message));
  return head;
}

function renderInstructionsPrompt(prompt) {
  const panel = ctx.els.panel;
  clearNode(panel);
  panel.append(panelHead('THE OREGON TRAIL', 'Independence, Missouri to Oregon City - 2040 miles, 1847'));
  const actions = el('div', 'actions');
  actions.append(
    button('primary', 'SHOW ME HOW TO PLAY', () => {
      showInstructions();
      answer('NO');
    }),
    button('ghost', "I KNOW THE TRAIL - START", () => answer('NO')),
  );
  panel.append(el('p', 'panel-hint', 'Tip: everything in this game is a tap. No typing needed.'));
  panel.append(actions);
}

function showInstructions() {
  const sheet = openSheet('HOW TO PLAY');
  const body = el('div', 'sheet-body');
  for (const line of INSTRUCTIONS) body.append(el('p', 'sheet-line', line));
  sheet.append(body);
  sheet.append(button('primary', 'GOT IT', () => closeSheet()));
}

function renderMarksmanship(prompt) {
  const panel = ctx.els.panel;
  clearNode(panel);
  panel.append(panelHead(prompt.message, 'The better you claim to be, the faster you must tap when the rifle fires.'));
  const list = el('div', 'option-list');
  for (const option of prompt.options) {
    const node = button('option', `${option.value}. ${option.label}`, () => answer(option.value));
    node.append(el('span', 'option-detail', option.detail || ''));
    list.append(node);
  }
  panel.append(list);
}

function renderPurchases(prompt) {
  const panel = ctx.els.panel;
  clearNode(panel);
  panel.append(panelHead('INITIAL PURCHASES', `You have $${prompt.budget} to spend after paying $200 for the wagon.`));
  if (prompt.error) panel.append(el('p', 'error-text', prompt.error));

  const values = {
    oxen: 250,
    food: 100,
    ammo: 10,
    clothing: 20,
    supplies: 20,
  };

  const totalLine = el('p', 'total-line');
  const buy = button('primary', 'BUY SUPPLIES', () => answer({ ...values }));

  function refresh() {
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    const left = prompt.budget - total;
    totalLine.textContent = `TOTAL $${total} | CASH LEFT $${left}`;
    totalLine.classList.toggle('over', left < 0);
    buy.disabled = left < 0 || values.oxen < 200 || values.oxen > 300;
  }

  for (const item of PURCHASE_ITEMS) {
    const isOxen = item.key === 'oxen';
    const row = stepper({
      label: item.label,
      hint: item.hint,
      value: values[item.key],
      min: isOxen ? 200 : 0,
      max: prompt.budget,
      step: isOxen ? 10 : 5,
      chips: isOxen ? [200, 250, 300] : [],
      onChange: (value) => {
        values[item.key] = value;
        refresh();
      },
    });
    if (item.key === 'ammo') {
      const extra = row.querySelector('.step-extra');
      extra.dataset.factor = '50';
      extra.dataset.suffix = '= {v} BULLETS';
      extra.textContent = `= ${values.ammo * 50} BULLETS`;
    }
    panel.append(row);
  }

  panel.append(totalLine);
  panel.append(buy);
  refresh();
}

function renderAction(prompt) {
  const panel = ctx.els.panel;
  clearNode(panel);
  panel.append(panelHead(prompt.menu === 'fort' ? 'THE TRAIL FORKS' : 'ON THE TRAIL', 'Mileage is shown up top. Choose your next move.'));
  const list = el('div', 'option-list');
  for (const option of prompt.options) {
    const node = button(option.value === 3 ? 'primary' : 'option', option.label, () => answer(option.value));
    if (option.detail) node.append(el('span', 'option-detail', option.detail));
    list.append(node);
  }
  panel.append(list);
}

function renderFort(prompt) {
  const panel = ctx.els.panel;
  clearNode(panel);
  panel.append(panelHead('STOPPING AT FORT', `Cash available: $${prompt.cash}. Goods cost more out here: $1 buys 2/3 of an item.`));

  const values = { food: 0, ammo: 0, clothing: 0, supplies: 0 };
  const totalLine = el('p', 'total-line');
  const spend = button('primary', 'SPEND AND ROLL ON', () => answer({ ...values }));

  function refresh() {
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    totalLine.textContent = `TOTAL $${total} | CASH $${prompt.cash}`;
    totalLine.classList.toggle('over', total > prompt.cash);
  }

  for (const item of FORT_ITEMS) {
    const row = stepper({
      label: item.label,
      hint: item.key === 'ammo' ? '33 bullets per $1' : item.key === 'food' ? '0.67 lbs per $1' : '0.67 per $1',
      value: 0,
      min: 0,
      max: prompt.cash,
      step: 5,
      chips: [0, 20, 50],
      onChange: (value) => {
        values[item.key] = value;
        refresh();
      },
    });
    panel.append(row);
  }

  panel.append(totalLine);
  panel.append(spend);
  refresh();
}

function renderShooting(prompt) {
  const panel = ctx.els.panel;
  clearNode(panel);
  const label = prompt.context === 'hunt' ? 'HUNTING'
    : prompt.context === 'riders' ? 'RIDERS ATTACK'
      : prompt.context === 'bandits' ? 'BANDITS'
        : prompt.context === 'wild animals' ? 'WILD ANIMALS' : 'RIFLE';
  panel.append(panelHead(label, 'Tap FIRE the instant the word appears. Faster is better.', `TYPE ${prompt.word}`));

  const word = el('div', 'shoot-word', prompt.word);
  const bar = el('div', 'shoot-bar');
  const fill = el('div', 'shoot-fill');
  bar.append(fill);
  const readout = el('p', 'shoot-readout', '0.00s');
  const fire = button('fire', 'FIRE', () => {
    if (!started) return;
    const elapsed = (performance.now() - started) / 1000;
    stopTimer();
    sfx('shoot');
    answer({ elapsed });
  });

  let started = performance.now();
  function stopTimer() {
    if (ctx.timer) cancelAnimationFrame(ctx.timer);
    ctx.timer = null;
  }
  function tick() {
    const seconds = (performance.now() - started) / 1000;
    readout.textContent = `${seconds.toFixed(2)}s`;
    fill.style.width = `${Math.min(100, (seconds / 3.5) * 100)}%`;
    if (seconds < 4) ctx.timer = requestAnimationFrame(tick);
  }
  stopTimer();
  ctx.timer = requestAnimationFrame(tick);
  sfx('event');

  panel.append(word, bar, readout, fire);
  panel.append(el('p', 'panel-hint', prompt.context === 'hunt' ? 'A bad shot wastes 45 miles and bullets.' : 'A bad shot can cost you dearly.'));
}

function renderEating(prompt) {
  const panel = ctx.els.panel;
  clearNode(panel);
  panel.append(panelHead('SUPPER ON THE TRAIL', `Food available: ${prompt.food} lbs. Eating better keeps illness away.`));
  const list = el('div', 'option-list');
  for (const meal of MEALS) {
    const affordable = prompt.food >= meal.cost;
    const node = button(affordable ? 'option' : 'option disabled', meal.label, () => answer(meal.value), { disabled: !affordable });
    node.append(el('span', 'option-detail', `${meal.cost} FOOD - ${meal.detail}`));
    list.append(node);
  }
  panel.append(list);
}

function renderRiders(prompt) {
  const panel = ctx.els.panel;
  clearNode(panel);
  panel.append(panelHead('RIDERS AHEAD', prompt.message));
  const list = el('div', 'option-list');
  for (const tactic of TACTICS) {
    const node = button('option', tactic.label, () => answer(tactic.value));
    node.append(el('span', 'option-detail', tactic.detail));
    list.append(node);
  }
  panel.append(list);
}

function renderFuneral(prompt) {
  const panel = ctx.els.panel;
  clearNode(panel);
  const cause = prompt.deathCause === 'winter' ? 'THE FIRST BLIZZARD OF WINTER'
    : prompt.deathCause === 'starvation' ? 'STARVATION'
      : prompt.deathCause === 'snakebite' ? 'SNAKEBITE'
        : prompt.deathCause === 'riders' ? 'RIDERS'
          : prompt.deathCause === 'wildAnimals' ? 'WOLVES'
            : prompt.deathCause === 'medical' ? 'NO MEDICAL SUPPLIES'
              : prompt.deathCause === 'doctor' ? 'NO DOCTOR' : 'ILLNESS';
  panel.append(panelHead('FORMALITIES', `Cause: ${cause}. There are a few formalities to go through.`));

  const choices = { minister: false, fancyFuneral: false, notifyNextOfKin: false };
  const rows = [
    ['minister', 'WOULD YOU LIKE A MINISTER?'],
    ['fancyFuneral', 'WOULD YOU LIKE A FANCY FUNERAL?'],
    ['notifyNextOfKin', 'SHALL WE INFORM YOUR NEXT OF KIN?'],
  ];
  for (const [key, label] of rows) {
    const row = el('div', 'toggle-row');
    row.append(el('span', 'toggle-label', label));
    const group = el('div', 'toggle-group');
    for (const value of [true, false]) {
      const option = el('button', `toggle ${value ? 'yes' : 'no'}`, value ? 'YES' : 'NO');
      option.type = 'button';
      option.addEventListener('click', () => {
        choices[key] = value;
        sfx('click');
        for (const sibling of group.children) sibling.classList.remove('active');
        option.classList.add('active');
      });
      if (value === false) option.classList.add('active');
      group.append(option);
    }
    row.append(group);
    panel.append(row);
  }

  panel.append(button('primary', 'CONTINUE', () => answer({ ...choices })));
}

function renderEnding(result) {
  const panel = ctx.els.panel;
  clearNode(panel);
  const state = result.state;
  const win = result.outcome === 'win';

  if (win) {
    const final = result.final || {};
    const inventory = final.inventory || {};
    panel.append(panelHead('YOU MADE IT TO OREGON', `${final.weekday} ${final.month} ${final.day} 1847 - after 2040 miles.`));
    panel.append(el('p', 'ending-text', 'YOU FINALLY ARRIVED AT OREGON CITY. HOORAY! A REAL PIONEER!'));
    panel.append(el('p', 'ending-text', 'PRESIDENT JAMES K. POLK SENDS YOU HIS HEARTIEST CONGRATULATIONS AND WISHES YOU A PROSPEROUS LIFE AT YOUR NEW HOME.'));
    const chips = el('div', 'ending-chips');
    for (const [key, value] of Object.entries({
      FOOD: inventory.food, BULLETS: inventory.bullets, CLOTHING: inventory.clothing, SUPPLIES: inventory.supplies, CASH: `$${inventory.cash}`,
    })) {
      const chip = el('div', 'ending-chip');
      chip.append(el('span', 'ending-value', String(value ?? 0)), el('span', 'ending-label', key));
      chips.append(chip);
    }
    panel.append(chips);
    sfx('win');
  } else {
    const cause = result.deathCause === 'winter' ? 'THE FIRST BLIZZARD OF WINTER'
      : result.deathCause === 'starvation' ? 'YOU STARVED'
        : result.deathCause === 'snakebite' ? 'SNAKEBITE'
          : result.deathCause === 'riders' ? 'MASSACRED BY RIDERS'
            : result.deathCause === 'wildAnimals' ? 'KILLED BY WOLVES'
              : result.deathCause === 'doctor' ? 'NO DOCTOR'
                : result.deathCause === 'medical' ? 'NO MEDICAL SUPPLIES'
                  : `YOU DIED OF ${result.deathLabel || 'PNEUMONIA'}`;
    panel.append(panelHead('YOUR JOURNEY ENDS', cause));
    panel.append(el('p', 'ending-text', result.state.log.filter((entry) => entry.kind === 'death').map((entry) => entry.text).join(' ')));
    const funeral = result.funeral || {};
    const summary = `MINISTER: ${funeral.minister ? 'YES' : 'NO'} | FANCY FUNERAL: ${funeral.fancyFuneral ? 'YES' : 'NO'} | NEXT OF KIN NOTIFIED: ${funeral.notifyNextOfKin ? 'YES' : 'NO'}`;
    panel.append(el('p', 'ending-meta', summary));
    panel.append(el('p', 'ending-text', "WE ARE SORRY YOU DIDN'T MAKE IT TO THE GREAT TERRITORY OF OREGON. BETTER LUCK NEXT TIME."));
    panel.append(el('p', 'ending-meta', 'THE OREGON CITY CHAMBER OF COMMERCE'));
    sfx('bad');
  }

  panel.append(el('p', 'ending-meta', win ? `SEED ${state.seed}` : `TURN ${state.turn} - MILEAGE ${state.mileage} - SEED ${state.seed}`));
  panel.append(button('primary', 'START A NEW JOURNEY', () => startNew()));
}

/* ------------------------------------------------------------------ *
 * Sheet overlay (menu, instructions, confirm)
 * ------------------------------------------------------------------ */

function openSheet(title, { dismissible = true } = {}) {
  const overlay = ctx.els.overlay;
  const sheet = ctx.els.sheet;
  clearNode(sheet);
  const head = el('div', 'sheet-head');
  head.append(el('h3', 'sheet-title', title));
  if (dismissible) {
    const close = el('button', 'sheet-close', 'CLOSE');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    head.append(close);
  }
  sheet.append(head);
  overlay.hidden = false;
  return sheet;
}

function closeSheet() {
  ctx.els.overlay.hidden = true;
  clearNode(ctx.els.sheet);
}

function openMenu() {
  const sheet = openSheet('TRAIL MENU');
  const list = el('div', 'menu-list');
  list.append(button('option', 'RESUME THE JOURNEY', () => closeSheet(), { iconName: 'chevron' }));
  list.append(button('option', ctx.settings.muted ? 'SOUND: OFF' : 'SOUND: ON', () => {
    ctx.settings.muted = !ctx.settings.muted;
    saveSettings();
    if (!ctx.settings.muted) sfx('good');
    closeSheet();
    openMenu();
  }, { iconName: ctx.settings.muted ? 'mute' : 'sound' }));
  list.append(button('option', ctx.settings.reducedMotion ? 'REDUCED MOTION: ON' : 'REDUCED MOTION: OFF', () => {
    ctx.settings.reducedMotion = !ctx.settings.reducedMotion;
    saveSettings();
    ctx.scene.setReducedMotion(ctx.settings.reducedMotion);
    closeSheet();
    openMenu();
  }));
  list.append(button('option', 'HOW TO PLAY', () => { closeSheet(); showInstructions(); }, { iconName: 'info' }));
  list.append(button('option', 'NEW JOURNEY', () => { closeSheet(); confirmNew(); }, { iconName: 'restart' }));
  sheet.append(list);
}

function confirmNew() {
  const sheet = openSheet('START OVER?');
  sheet.append(el('p', 'sheet-line', 'Your current journey will be lost.'));
  const actions = el('div', 'actions');
  actions.append(
    button('primary', 'START OVER', () => { closeSheet(); startNew(); }),
    button('ghost', 'KEEP PLAYING', () => closeSheet()),
  );
  sheet.append(actions);
}

/* ------------------------------------------------------------------ *
 * Flow
 * ------------------------------------------------------------------ */

function safeAnswer(value) {
  try {
    sfx('choose');
    ctx.session.submit(value);
    render();
  } catch (error) {
    showFatal(error);
  }
}

function answer(value) {
  if (!ctx.session || ctx.session.done) return;
  if (ctx.timer) {
    cancelAnimationFrame(ctx.timer);
    ctx.timer = null;
  }
  safeAnswer(value);
}

function render() {
  if (!ctx.session) return;
  if (ctx.session.done) {
    const result = ctx.session.result;
    renderLog(result.state);
    renderHud(result.state);
    ctx.scene.setView({
      mileage: result.state.mileage,
      turn: result.state.turn,
      outcome: result.outcome,
      deathCause: result.deathCause,
      weather: result.deathCause === 'winter' ? 'snow' : 'clear',
      promptType: null,
    });
    ctx.els.caption.textContent = result.outcome === 'win' ? 'OREGON CITY, OREGON' : 'THE TRAIL CLAIMS ANOTHER FAMILY';
    renderEnding(result);
    clearSave();
    return;
  }

  const prompt = ctx.session.prompt;
  renderLog(prompt.state);
  renderHud(prompt.state);
  updateScene(prompt);

  const panel = ctx.els.panel;
  switch (prompt.type) {
    case 'instructions': renderInstructionsPrompt(prompt); break;
    case 'marksmanship': renderMarksmanship(prompt); break;
    case 'purchases': renderPurchases(prompt); break;
    case 'action': renderAction(prompt); break;
    case 'fort': renderFort(prompt); break;
    case 'shooting': renderShooting(prompt); break;
    case 'eating': renderEating(prompt); break;
    case 'riders': renderRiders(prompt); break;
    case 'funeral': renderFuneral(prompt); break;
    default:
      clearNode(panel);
      panel.append(el('p', 'error-text', `UNKNOWN PROMPT: ${prompt.type}`));
  }

  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  writeSave();
}

function startNew() {
  clearSave();
  ctx.session = createSession({ seed: randomSeed() });
  ctx.renderedLog = 0;
  clearNode(ctx.els.log);
  if (ctx.scene) ctx.scene.setReducedMotion(ctx.settings.reducedMotion);
  showGame();
  render();
}

function continueSaved() {
  const data = readSave();
  if (!data) {
    startNew();
    return;
  }
  try {
    const session = createSession({ seed: data.seed });
    session.replay(data.answers);
    const promptType = session.prompt ? session.prompt.type : null;
    if (!session.done && promptType !== data.promptType) throw new Error('Save did not replay to the same point.');
    ctx.session = session;
    ctx.renderedLog = 0;
    clearNode(ctx.els.log);
    showGame();
    render();
  } catch (error) {
    clearSave();
    showFatal(new Error('That save could not be restored, so a new journey was started.'));
    startNew();
  }
}

function showGame() {
  ctx.els.title.hidden = true;
  ctx.els.game.hidden = false;
}

function renderTitle() {
  ctx.els.title.hidden = false;
  ctx.els.game.hidden = true;
  const panel = ctx.els.titlePanel;
  clearNode(panel);
  panel.append(el('h1', 'title-main', 'THE OREGON TRAIL'));
  panel.append(el('p', 'title-sub', 'INDEPENDENCE, MISSOURI TO OREGON CITY - 1847'));
  panel.append(el('p', 'title-copy', '2040 miles. Your family of five. Five to six months, if you make it alive.'));

  const actions = el('div', 'actions');
  actions.append(button('primary', 'NEW JOURNEY', () => startNew()));
  if (readSave()) actions.append(button('option', 'CONTINUE SAVED JOURNEY', () => continueSaved()));
  actions.append(button('ghost', 'HOW TO PLAY', () => showInstructions()));
  panel.append(actions);
  ctx.els.caption.textContent = 'INDEPENDENCE, MISSOURI - 1847';
}

function showFatal(error) {
  ctx.els.fatal.hidden = false;
  ctx.els.fatal.textContent = `SOMETHING WENT WRONG: ${error && error.message ? error.message : error}`;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  ctx.els = {
    boot: document.getElementById('boot'),
    fatal: document.getElementById('fatal'),
    title: document.getElementById('title-screen'),
    titlePanel: document.getElementById('title-panel'),
    game: document.getElementById('game'),
    date: document.getElementById('hud-date'),
    miles: document.getElementById('hud-miles'),
    progress: document.getElementById('hud-progress'),
    chips: document.getElementById('hud-chips'),
    health: document.getElementById('hud-health'),
    log: document.getElementById('log'),
    panel: document.getElementById('panel'),
    caption: document.getElementById('caption'),
    overlay: document.getElementById('overlay'),
    sheet: document.getElementById('sheet'),
    menu: document.getElementById('menu-btn'),
  };

  loadSettings();
  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (reduceQuery && reduceQuery.matches) ctx.settings.reducedMotion = true;

  ctx.scene = new TrailScene(document.getElementById('scene'), { reducedMotion: ctx.settings.reducedMotion });
  ctx.scene.start();

  ctx.els.menu.addEventListener('click', openMenu);
  ctx.els.overlay.addEventListener('click', (event) => {
    if (event.target === ctx.els.overlay) closeSheet();
  });
  window.addEventListener('error', (event) => showFatal(event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => showFatal(event.reason));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ctx.scene.stop();
    else ctx.scene.start();
  });

  renderTitle();
  ctx.els.boot.hidden = true;
  document.documentElement.dataset.appReady = 'true';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
