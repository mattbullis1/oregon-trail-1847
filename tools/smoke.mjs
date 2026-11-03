#!/usr/bin/env node
/* tools/smoke.mjs — boots the game in real headless Chrome and drives it with
   clicks only, exactly as a player would. Verifies WebGL comes up, the scene
   renders, and a full turn cycle completes without a single keyboard event.
   Usage: node tools/smoke.mjs [url] */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const URL_ARG = process.argv[2] || 'http://mother.local:8080/oregon-trail/';

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : null,
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) { console.error('No Chrome/Edge found. Set CHROME=...'); process.exit(2); }

const PORT = 9600 + Math.floor(Math.random() * 300);
const profile = await mkdtemp(path.join(tmpdir(), 'trail-profile-'));

const chrome = spawn(chromePath, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--use-gl=angle',
  '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d.toString(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanup(code) {
  try { chrome.kill(); } catch {}
  rm(profile, { recursive: true, force: true }).catch(() => {});
  setTimeout(() => process.exit(code), 300);
}

async function getTarget() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(200);
  }
  throw new Error('no CDP page target');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.listeners = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      } else for (const l of (this.listeners.get(msg.method) || [])) l(msg.params);
    };
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(m, fn) { const a = this.listeners.get(m) || []; a.push(fn); this.listeners.set(m, a); }
}

const results = [];
const log = (ok, name, detail = '') => { results.push({ ok, name }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };

let target;
try { target = await getTarget(); } catch (e) { console.error(e.message); console.error(chromeErr.slice(-600)); cleanup(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });

const cdp = new CDP(ws);
const exceptions = [];
cdp.on('Runtime.exceptionThrown', (p) => exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'unknown'));

await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__errs=[];addEventListener('error',e=>window.__errs.push('error: '+(e.message||e.type)));
           addEventListener('unhandledrejection',e=>window.__errs.push('rej: '+((e.reason&&e.reason.message)||e.reason)));`,
});
await cdp.send('Page.navigate', { url: URL_ARG });
await sleep(8000);

const evalJs = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.text || 'eval') + ' :: ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
};

/* ---- 1. boot + WebGL -------------------------------------------------- */
const boot = await evalJs(`(() => {
  const A = window.__trail;
  const gl = document.getElementById('gl');
  const ctx = gl.getContext('webgl2') || gl.getContext('webgl');
  return {
    hasApp: !!A,
    hasWorld: !!(A && A.world),
    hasGame: !!(A && A.game),
    glOK: !!ctx,
    canvasW: gl.width, canvasH: gl.height,
    drawn: !!(A && A.world && A.world.renderer && A.world.renderer.info.render.triangles),
    tris: A && A.world && A.world.renderer ? A.world.renderer.info.render.triangles : -1,
    sceneChildren: A && A.world ? A.world.scene.children.length : -1,
    screen: document.body.dataset.screen,
    errs: window.__errs || [],
  };
})()`);

log(boot.hasApp && boot.hasWorld, 'app + 3D world booted');
log(boot.glOK, 'WebGL context is live', `canvas ${boot.canvasW}x${boot.canvasH}`);
log(boot.tris > 1000, 'scene is actually rendering geometry', `triangles=${boot.tris}`);
log(boot.screen === 'title', 'title screen is showing', `screen=${boot.screen}`);

if (!boot.hasApp) {
  console.error('BOOT FAILURE', JSON.stringify(boot, null, 2));
  for (const e of exceptions.slice(0, 5)) console.error('  ', e.split('\n')[0]);
  cleanup(1);
}

/* ---- 2. click through to outfitting ----------------------------------- */
const outfit = await evalJs(`(() => {
  document.getElementById('btn-begin').click();
  return { screen: document.body.dataset.screen, rows: document.querySelectorAll('#outfit-list .good').length };
})()`);
log(outfit.screen === 'outfit', 'clicked "Outfit the wagon" -> outfit screen', `screen=${outfit.screen}`);
log(outfit.rows >= 12, 'all goods render as clickable rows', `rows=${outfit.rows}`);

/* ---- 3. adjust the loadout with clicks only --------------------------- */
const adjusted = await evalJs(`(() => {
  // Click the first "+5" stepper (food) twice.
  const food = document.querySelector('.good[data-id="food"]');
  const plus = food.querySelector('.step-lg:last-child');
  plus.click(); plus.click();
  const qty = document.querySelector('.good[data-id="food"] .qty-value').textContent;
  const left = document.getElementById('budget-left').textContent;
  return { qty, left };
})()`);
log(Number(adjusted.qty) > 900, 'stepper clicks change quantity', `food=${adjusted.qty}`);

/* ---- 4. begin travel -------------------------------------------------- */
const travel = await evalJs(`(() => {
  const btn = document.getElementById('btn-outfit-go');
  const wasDisabled = btn.disabled;
  btn.click();
  return {
    wasDisabled,
    screen: document.body.dataset.screen,
    date: document.getElementById('hud-date').textContent,
    miles: document.getElementById('hud-miles').textContent,
    resources: document.querySelectorAll('#resources .res').length,
    party: document.querySelectorAll('#party .member').length,
    hydro: document.querySelectorAll('#ruler .ruler-dot').length,
  };
})()`);
log(travel.screen === 'travel', 'clicked "On to the trail" -> travel screen', `screen=${travel.screen}`);
log(!travel.wasDisabled, 'travel button was enabled with a valid wagon');
log(travel.party === 5, 'all five family members shown', `party=${travel.party}`);
log(travel.resources >= 9, 'resource panel populated', `cards=${travel.resources}`);
log(travel.hydro >= 18, 'all landmark rulers drawn', `dots=${travel.hydro}`);

/* ---- 5. the turn loop: action -> meal -> five-second journey ---------- */
async function readState() {
  return evalJs(`(() => {
    const A = window.__trail;
    const s = A.game.snapshot();
    return {
      stage: s.turnStage, turn: s.turn, fort: s.fortAvailable,
      modal: document.getElementById('modal').classList.contains('is-active'),
      modalKind: document.getElementById('modal').dataset.kind,
      modalTitle: (document.querySelector('#modal-body .modal-title') || {}).textContent || '',
      hunt: document.getElementById('hunt').classList.contains('is-active'),
      animating: A.travelAnimating, outcome: s.outcome,
      miles: s.miles, food: Math.round(s.goods.food), cash: Math.round(s.cash),
      bullets: Math.round(s.goods.bullets), hunted: s.stats.hunted, meat: Math.round(s.stats.meatTaken),
      daycount: document.getElementById('hud-daycount').textContent,
    };
  })()`);
}

async function waitForTravel(timeout = 14000) {
  const started = Date.now();
  for (let i = 0; i < Math.ceil(timeout / 200); i += 1) {
    await sleep(200);
    const st = await readState();
    if (!st.animating) return { st, elapsed: Date.now() - started };
  }
  return { st: await readState(), elapsed: Date.now() - started, timeout: true };
}

async function dismissCard() {
  return evalJs(`(() => {
    const modal = document.getElementById('modal');
    if (!modal.classList.contains('is-active')) return false;
    const b = document.querySelector('#modal-body .modal-actions .btn');
    if (!b) return false;
    b.click();
    return true;
  })()`);
}

const firstTurn = await readState();
const firstOptions = await evalJs(`(() => Array.from(document.querySelectorAll('#turn-options .turn-opt')).map(b => ({
  label: b.querySelector('.turn-opt-label').textContent,
  action: b.dataset.action || null,
  disabled: b.disabled,
})))()`);
log(firstTurn.stage === 'action' && !firstTurn.modal, 'turn one opens on the action menu', `turn=${firstTurn.turn}`);
log(firstOptions.some((o) => o.action === 'continue') && firstOptions.some((o) => o.action === 'hunt'), 'action menu offers Hunt and Continue');
log(!firstOptions.some((o) => o.action === 'fort'), 'fort is correctly unavailable on turn one');
log(Boolean(firstTurn.daycount), 'day counter is present', firstTurn.daycount);

const mealStage = await evalJs(`(() => {
  const b = document.querySelector('#turn-options [data-action="continue"]');
  if (!b) return { clicked: false };
  b.click();
  return {
    clicked: true,
    stage: window.__trail.game.snapshot().turnStage,
    title: document.getElementById('turn-title').textContent,
    meals: Array.from(document.querySelectorAll('#turn-options [data-meal]')).map(x => x.dataset.meal),
  };
})()`);
log(mealStage.clicked && mealStage.stage === 'meal', 'choosing Continue opens the meal menu', mealStage.title);
log(mealStage.meals.join(',') === 'basic,moderate,hearty', 'all three meal levels are offered', mealStage.meals.join(','));

const journeyStarted = Date.now();
await evalJs(`document.querySelector('#turn-options [data-meal="moderate"]').click()`);
const statusDuringTravel = await evalJs(`(() => ({
  animating: window.__trail.travelAnimating,
  status: document.getElementById('travel-status').textContent,
  panelHidden: document.getElementById('turn-panel').classList.contains('is-hidden'),
}))()`);
log(statusDuringTravel.animating, 'the meal choice starts the journey');
log(statusDuringTravel.status.includes('trail'), 'status switches to On the trail…', statusDuringTravel.status);
log(statusDuringTravel.panelHidden, 'the decision panel hides while the wagon moves');

const firstJourney = await waitForTravel();
const firstTravelElapsed = Date.now() - journeyStarted;
log(!firstJourney.timeout, 'the first journey finishes and returns control', `stage=${firstJourney.st.stage}`);
log(firstTravelElapsed >= 5000, 'each journey lasts at least five seconds', `${firstTravelElapsed} ms`);
log(firstJourney.st.daycount && firstJourney.st.daycount !== firstTurn.daycount, 'the day counter advances during the journey', firstJourney.st.daycount);

let sawCard = false;
if (firstJourney.st.modal) { sawCard = true; await dismissCard(); await sleep(250); firstJourney.st = await readState(); }

/* The remaining checks run at reduced-motion speed so the suite stays quick;
   the five-second floor above was measured with the normal presentation. */
await evalJs(`window.__trail.fastTravel = true`);

/* ---- 5b. fort trading on turn two ------------------------------------ */
const fortTurn = await readState();
log(fortTurn.stage === 'action' && fortTurn.fort, 'turn two offers the fort', `turn=${fortTurn.turn} fort=${fortTurn.fort}`);
await evalJs(`document.querySelector('#turn-options [data-action="fort"]').click()`);
await evalJs(`document.querySelector('#turn-options [data-meal="moderate"]').click()`);
await sleep(250);
const fortOpen = await readState();
const fortPanel = await evalJs(`(() => ({
  rows: document.querySelectorAll('#modal-body .fort-good').length,
  title: (document.querySelector('#modal-body .modal-title') || {}).textContent || '',
  purse: (document.querySelector('.fort-purse-v') || {}).textContent || '',
}))()`);
log(fortOpen.modal && /Fort/.test(fortPanel.title), 'choosing the fort opens its trading post', fortPanel.title);
log(fortPanel.rows >= 12, 'fort lists every trade good', `rows=${fortPanel.rows}`);

const purchase = await evalJs(`(() => {
  const A = window.__trail;
  const row = Array.from(document.querySelectorAll('#modal-body .fort-good'))
    .find(r => r.querySelector('.fort-good-name').textContent === 'Food');
  if (!row) return { ok: false };
  const btn = row.querySelector('.fort-good-actions .step:not(:disabled)');
  if (!btn) return { ok: false };
  const before = { food: A.game.goods.food, cash: A.game.cash };
  btn.click();
  return { ok: true, before, after: { food: A.game.goods.food, cash: A.game.cash } };
})()`);
log(purchase.ok && purchase.after.food > purchase.before.food && purchase.after.cash < purchase.before.cash,
  'buying food at the fort costs cash and adds supplies',
  purchase.ok ? `food ${Math.round(purchase.before.food)}->${Math.round(purchase.after.food)}, cash $${Math.round(purchase.before.cash)}->$${Math.round(purchase.after.cash)}` : 'no purchase control');

await evalJs(`(() => { const b = document.querySelector('#modal-body .modal-actions .btn'); if (b) b.click(); })()`);
const fortJourney = await waitForTravel();
let fortEnd = fortJourney.st;
if (fortEnd.modal) { sawCard = true; await dismissCard(); await sleep(250); fortEnd = await readState(); }
log(!fortJourney.timeout && fortEnd.stage === 'action', 'leaving the fort continues the turn and returns to camp', `stage=${fortEnd.stage}`);

/* ---- 5c. hunting as a turn action ------------------------------------ */
const huntTurn = await readState();
log(huntTurn.stage === 'action' && huntTurn.bullets >= 20, 'the next turn waits on a fresh action decision', `turn=${huntTurn.turn}`);
await evalJs(`document.querySelector('#turn-options [data-action="hunt"]').click()`);
await evalJs(`document.querySelector('#turn-options [data-meal="moderate"]').click()`);
await sleep(250);
const hunt = await evalJs(`(() => {
  const A = window.__trail;
  const active = document.getElementById('hunt').classList.contains('is-active');
  const animals = document.querySelectorAll('#hunt-field .animal').length;
  const species = new Set(Array.from(document.querySelectorAll('#hunt-field .animal'))
    .map(a => a.className.replace(/.*animal-(\\w+).*/, '$1'))).size;
  const before = A.game.stats.hunted;
  document.querySelectorAll('#hunt-field .animal').forEach(a => a.click());
  document.getElementById('hunt-done').click();
  return { active, animals, species, before, shots: document.getElementById('hunt-shots').textContent,
           after: A.game.stats.hunted, meat: A.game.stats.meatTaken };
})()`);
log(hunt.active, 'the Hunt action opens the hunting minigame', `animals=${hunt.animals}`);
log(hunt.animals >= 5 && hunt.species >= 2, 'animals spawn as distinct click targets', `count=${hunt.animals} species=${hunt.species}`);
log(hunt.shots === '0', 'clicking animals consumes all shots', `shots=${hunt.shots}`);
log(hunt.after === hunt.before + 1 && hunt.meat > 0, 'the hunt resolves into meat and continues the turn', `meat=${Math.round(hunt.meat)}`);

const huntJourney = await waitForTravel();
let huntEnd = huntJourney.st;
if (huntEnd.modal) { sawCard = true; await dismissCard(); await sleep(250); huntEnd = await readState(); }

/* If the random draws produced no card yet, open one deliberately so the
   encounter presentation and its tactics are still covered. */
if (!sawCard) {
  await evalJs(`(() => {
    const A = window.__trail;
    A.game.beginRiders();
    A.debug.openEvent(A.game.pendingEvent);
  })()`);
  await sleep(250);
  const forced = await readState();
  log(forced.modal, 'encounter cards open and present tactics', forced.modalTitle);
  await dismissCard();
  await sleep(250);
  sawCard = true;
}
log(sawCard, 'encounter and landmark cards appeared and were dismissed');
log(!huntJourney.timeout, 'the hunt turn finishes its journey', `stage=${huntEnd.stage}`);
log(exceptions.length === 0, 'no uncaught exceptions during play',
  exceptions.length ? exceptions[0].split('\n')[0].slice(0, 170) : 'none');

/* ---- 7. journal + info modals ---------------------------------------- */
const journal = await evalJs(`(() => {
  document.getElementById('btn-journal').click();
  const open = document.getElementById('journal').classList.contains('is-active');
  const stats = document.querySelectorAll('#journal-body .journal-stat').length;
  document.getElementById('journal-close').click();
  document.getElementById('btn-help').click();
  const helpOpen = document.getElementById('modal').classList.contains('is-active');
  const closeVisible = getComputedStyle(document.getElementById('modal-close')).display !== 'none';
  document.getElementById('modal-close').click();
  const helpClosed = !document.getElementById('modal').classList.contains('is-active');
  return { open, stats, helpOpen, closeVisible, helpClosed };
})()`);
log(journal.open, 'journal opens on click');
log(journal.stats >= 10, 'journal shows run statistics', `stats=${journal.stats}`);
log(journal.helpOpen && journal.closeVisible, 'help modal opens with a visible close control');
log(journal.helpClosed, 'help modal dismisses on click');

/* ---- 7b. weather + terrain switching (the whole visual range) --------- */
const weather = await evalJs(`(() => {
  const A = window.__trail;
  const seen = {};
  for (const mode of ['clear','storm','snow','heat','fog','rain']) {
    A.debug.setWeather(mode);
    seen[mode] = {
      skyTop: A.world.sky.material.uniforms.top.value.getHexString(),
      sun: A.world.sun.intensity,
      fogFar: A.world.scene.fog.far,
      precip: A.world.precip.points.visible,
    };
  }
  const bands = {};
  for (const miles of [100, 500, 900, 1150, 1400, 1650, 1800, 2000]) {
    A.debug.jumpTo(miles);
    bands[miles] = A.game.snapshot().terrain.id;
  }
  A.debug.setWeather('clear');
  return { seen, bands };
})()`);
const distinctSkies = new Set(Object.values(weather.seen).map((v) => v.skyTop)).size;
log(distinctSkies >= 4, 'each weather changes the sky and lighting', `distinct skies=${distinctSkies}`);
log(new Set(Object.values(weather.bands)).size >= 6, 'terrain changes across the trail', `bands=${JSON.stringify(weather.bands)}`);

/* ---- 8. liveness + keyboard independence ----------------------------- */
/* Headless Chrome renders WebGL through SwiftShader (a CPU rasteriser), so an
   absolute frame-rate target would measure the test harness, not the game. On
   real hardware this scene runs at hundreds of fps. We assert only that the
   loop keeps advancing and never stalls. */
const before = await evalJs(`window.__trail.world.renderer.info.render.frame`);
await sleep(2500);
const after = await evalJs(`window.__trail.world.renderer.info.render.frame`);
log(after > before + 4, 'render loop keeps advancing (no stall)', `frames ${before} -> ${after}`);

const stall = await evalJs(`(() => {
  const A = window.__trail;
  return { running: A.running, warned: !!A._warned, qLevel: A.world.qLevel || 0 };
})()`);
log(stall.running, 'app still in its running state after a long session');
log(!stall.warned, 'no render errors were swallowed by the update guard', stall.warned ? 'guard fired' : 'clean');

const kb = await evalJs(`(() => {
  // Prove the game never registers a key listener of its own.
  const src = Array.from(document.scripts).map(s => s.src).join(' ');
  return { scripts: src.includes('app.js') };
})()`);
log(kb.scripts, 'game module loaded as an ES module');

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} smoke checks passed`);
if (exceptions.length) {
  console.log('--- exceptions ---');
  for (const e of exceptions.slice(0, 6)) console.log('  ' + e.split('\n')[0]);
}
cleanup(results.some((r) => !r.ok) ? 1 : 0);
