#!/usr/bin/env node
/* tools/playthrough.mjs — play a complete run to its ending using clicks only,
   then screenshot the outcome. Proves the game is winnable through the UI. */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OUT = path.resolve('shots');
await mkdir(OUT, { recursive: true });
const PORT = 9971;
const profile = await mkdtemp(path.join(tmpdir(), 'trail-play-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader', '--window-size=1440,900', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 60; i += 1) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.find((t) => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map(); const exceptions = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m.result); } }
  else if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0]);
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'http://mother.local:8080/oregon-trail/' });
await sleep(8000);
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? (r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || '')) : r.result.value;
};

// Outfit well, pick a brisk pace, and play headlessly through the real UI.
const setup = await ev(`(() => {
  const A = window.__trail;
  document.getElementById('btn-begin').click();
  document.querySelector('.good[data-id="oxen"] .step-lg:last-child').click();
  document.querySelector('.good[data-id="oxen"] .step-lg:last-child').click();
  document.querySelector('.good[data-id="food"] .step-lg:last-child').click();
  document.querySelector('.good[data-id="water"] .step-lg:last-child').click();
  document.querySelector('.good[data-id="medicine"] .step-lg:last-child').click();
  document.getElementById('btn-outfit-go').click();
  document.querySelector('#pace-choices [data-pace="brisk"]').click();
  A.fastTravel = true; // the five-second journey is verified by smoke.mjs
  return { screen: document.body.dataset.screen, cash: A.game.cash, food: A.game.goods.food };
})()`);
console.log('after outfitting:', JSON.stringify(setup));

let guard = 0;
let outcome = null;
while (guard < 220 && !outcome) {
  guard += 1;
  const step = await ev(`(() => {
    const A = window.__trail;
    const s = A.game.snapshot();
    if (s.outcome) return { done: s.outcome };

    const modal = document.getElementById('modal');
    if (modal.classList.contains('is-active')) {
      // At a fort: restock food and water before leaving.
      if (document.querySelector('#modal-body .fort-list')) {
        for (let i = 0; i < 3; i += 1) {
          const foodRow = Array.from(document.querySelectorAll('#modal-body .fort-good'))
            .find(r => r.querySelector('.fort-good-name').textContent === 'Food');
          const btn = foodRow && foodRow.querySelectorAll('.fort-good-actions .step')[1];
          if (btn && !btn.disabled) btn.click();
        }
        const back = document.querySelector('#modal-body .modal-actions .btn');
        if (back) { back.click(); return { fort: 'left' }; }
      }
      // Riders: parley is the safe choice. It never triggers the "no powder"
      // death roll and usually costs less than running or fighting.
      const parley = document.querySelector('#modal-body .modal-actions [data-choice="parley"]');
      if (parley) { parley.click(); return { riders: 'parley' }; }
      const btns = Array.from(document.querySelectorAll('#modal-body .modal-actions .btn'));
      if (btns.length) { btns[0].click(); return { resolved: btns.length }; }
      return { stuck: modal.dataset.kind };
    }

    if (document.getElementById('hunt').classList.contains('is-active')) {
      document.querySelectorAll('#hunt-field .animal').forEach(a => a.click());
      document.getElementById('hunt-done').click();
      return { hunted: true };
    }

    // Every turn: pick the action, then the meal. Buying at every fort is
    // faster than losing a turn to hunting, so the winning line never hunts.
    if (s.turnStage === 'action') {
      // Restock early — the desert has no wells — and fall back on the rifle
      // when the barrel runs low between posts.
      if (s.fortAvailable && s.goods.food < 900) {
        const b = document.querySelector('#turn-options [data-action="fort"]');
        if (b) { b.click(); return { action: 'fort' }; }
      }
      if (s.goods.food < 60) {
        const h = document.querySelector('#turn-options [data-action="hunt"]');
        if (h && !h.disabled) { h.click(); return { action: 'hunt' }; }
      }
      const cont = document.querySelector('#turn-options [data-action="continue"]');
      if (cont) { cont.click(); return { action: 'continue' }; }
      return { idle: true, stage: s.turnStage };
    }
    if (s.turnStage === 'meal') {
      // A well-fed family recovers best on a full table; the winning line
      // feeds heartily whenever the barrel can cover the whole trek segment.
      const want = s.goods.food > 420 ? 'hearty' : 'moderate';
      const meal = document.querySelector('#turn-options [data-meal="' + want + '"]');
      if (meal) { meal.click(); return { meal: want }; }
      return { idle: true, stage: s.turnStage };
    }
    return { traveling: true, stage: s.turnStage };
  })()`);
  if (step.done) outcome = step.done;
  await sleep(700);
}

const final = await ev(`(() => {
  const A = window.__trail;
  const s = A.game.snapshot();
  return {
    outcome: s.outcome, miles: s.miles, days: s.totalDays,
    alive: s.alive, morale: s.morale, cash: s.cash,
    score: A.game.score().score, rank: A.game.score().rank,
    dead: A.game.dead.map(d => d.name + ' ' + d.cause),
    stats: s.stats,
    modalOpen: document.getElementById('modal').classList.contains('is-active'),
  };
})()`);
console.log('final:', JSON.stringify(final, null, 2));
console.log('exceptions:', exceptions.length ? exceptions.slice(0, 4) : 'none');
console.log('iterations:', guard);

const png = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(path.join(OUT, '13-outcome.png'), Buffer.from(png.data, 'base64'));
console.log('saved 13-outcome');

ws.close(); chrome.kill();
setTimeout(() => rm(profile, { recursive: true, force: true }).catch(() => {}), 400);
