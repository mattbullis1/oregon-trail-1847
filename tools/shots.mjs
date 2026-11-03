#!/usr/bin/env node
/* tools/shots.mjs — capture screenshots of each screen for visual review. */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OUT = path.resolve('shots');
await mkdir(OUT, { recursive: true });
const PORT = 9941;
const profile = await mkdtemp(path.join(tmpdir(), 'trail-shots-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader', '--window-size=1600,1000', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 60; i += 1) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.find((t) => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m.result); } } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1.5, mobile: false });
await send('Page.navigate', { url: 'http://mother.local:8080/oregon-trail/' });
await sleep(9000);

const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? r.exceptionDetails.text : r.result.value; };
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('saved', name);
}

await shot('01-title');

await ev("document.getElementById('btn-begin').click()");
await sleep(1400);
await shot('02-outfit');

await ev("document.getElementById('btn-outfit-go').click()");
await sleep(2500);
await shot('03-travel');

// The action menu, then the meal menu.
await ev("document.querySelector('#turn-options [data-action=\"continue\"]').click()");
await sleep(700);
await shot('04-meal');
await ev("document.querySelector('#turn-options [data-meal=\"moderate\"]').click()");

// Catch the real five-second journey in motion.
await sleep(2200);
await shot('04-travel-midway');
await sleep(4200);
await ev(`(() => {
  const b = document.querySelector('#modal-body .modal-actions .btn');
  if (b) b.click();
})()`);
await sleep(600);

// Play a few more turns at reduced-motion speed to fill the log and scenery.
await ev('window.__trail.fastTravel = true');
for (let i = 0; i < 4; i += 1) {
  await ev(`(() => {
    const m = document.getElementById('modal');
    if (m.classList.contains('is-active')) {
      const b = document.querySelector('#modal-body .modal-actions .btn');
      if (b) { b.click(); return 'modal'; }
    }
    const next = document.querySelector('#turn-options [data-action="continue"]');
    if (next) {
      next.click();
      const meal = document.querySelector('#turn-options [data-meal="moderate"]');
      if (meal) meal.click();
      return 'turn';
    }
    return 'idle';
  })()`);
  await sleep(1500);
}
await shot('05-travel-later');

// Fort trading post.
await ev(`(() => {
  const m = document.getElementById('modal');
  if (m.classList.contains('is-active')) {
    const b = document.querySelector('#modal-body .modal-actions .btn');
    if (b) b.click();
  }
})()`);
await sleep(500);
await ev(`(() => {
  const A = window.__trail;
  for (let i = 0; i < 3 && !A.game.snapshot().fortAvailable; i += 1) A.debug.nextTurn();
  const b = document.querySelector('#turn-options [data-action="fort"]');
  if (b) b.click();
  const meal = document.querySelector('#turn-options [data-meal="moderate"]');
  if (meal) meal.click();
})()`);
await sleep(800);
await shot('05b-fort');
await ev(`(() => { const b = document.querySelector('#modal-body .modal-actions .btn'); if (b) b.click(); })()`);
await sleep(1500);
await ev(`(() => {
  const m = document.getElementById('modal');
  if (m.classList.contains('is-active')) {
    const b = document.querySelector('#modal-body .modal-actions .btn');
    if (b) b.click();
  }
})()`);
await sleep(400);

await ev("document.getElementById('btn-journal').click()");
await sleep(900);
await shot('06-journal');
await ev("document.getElementById('journal-close').click()");
await sleep(400);

// Hunting through the real turn menu.
await ev(`(() => {
  const m = document.getElementById('modal');
  if (m.classList.contains('is-active')) {
    const b = document.querySelector('#modal-body .modal-actions .btn');
    if (b) b.click();
  }
})()`);
await sleep(600);
await ev(`(() => {
  const A = window.__trail;
  A.game.goods.bullets = Math.max(200, A.game.goods.bullets);
  let b = document.querySelector('#turn-options [data-action="hunt"]');
  if (!b) {
    // Still between turns: open the next action menu directly for the still.
    A.debug.nextTurn();
    b = document.querySelector('#turn-options [data-action="hunt"]');
  }
  if (b) b.click();
  const meal = document.querySelector('#turn-options [data-meal="moderate"]');
  if (meal) meal.click();
})()`);
await sleep(1100);
await shot('07-hunt');
await ev("(() => { document.getElementById('hunt-done').click(); })()");
await sleep(500);

await ev("document.getElementById('btn-help').click()");
await sleep(900);
await shot('08-help');
await ev("document.getElementById('modal-close').click()");
await sleep(500);

// Weather showcase: each look rendered cleanly with the modal closed.
for (const [name, mode, miles] of [
  ['09-storm', 'storm', 700],
  ['10-snow', 'snow', 1500],
  ['11-desert-heat', 'heat', 1400],
  ['12-fog', 'fog', 400],
]) {
  await ev(`(() => {
    const A = window.__trail;
    A.game.goods.food = 600;
    A.debug.jumpTo(${miles});
    A.debug.setWeather('${mode}');
    A.world.precip.points.visible = true;
    A.world.precipSuppressed = false;
  })()`);
  await sleep(2600);
  await shot(name);
}

ws.close(); chrome.kill();
setTimeout(() => rm(profile, { recursive: true, force: true }).catch(() => {}), 400);
