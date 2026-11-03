#!/usr/bin/env node
/* tools/perf.mjs — isolate what costs the most in a frame. */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 9921;
const profile = await mkdtemp(path.join(tmpdir(), 'trail-perf-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader', '--window-size=1440,900',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 60; i += 1) {
  try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.find((t) => t.type === 'page')) break; } catch {}
  await sleep(200);
}
const target = list.find((x) => x.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m.result); } } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'http://mother.local:8080/oregon-trail/' });
await sleep(7000);
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? (r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || '')) : r.result.value;
};

async function fps(label, setup) {
  if (setup) await ev(setup);
  await sleep(600);
  const a = await ev('window.__trail.world.renderer.info.render.frame');
  await sleep(2500);
  const b = await ev('window.__trail.world.renderer.info.render.frame');
  console.log(label.padEnd(34), ((b - a) / 2.5).toFixed(1).padStart(6), 'fps');
}

await fps('baseline (all on)');
await fps('precipitation off', 'window.__trail.world.precip.points.visible=false');
await fps('+ shadows off', 'window.__trail.world.renderer.shadowMap.enabled=false;window.__trail.world.sun.castShadow=false');
await fps('+ grass off', 'window.__trail.world.grass.visible=false');
await fps('+ trees off', 'window.__trail.world.trees.visible=false');
await fps('+ mountains off', 'window.__trail.world.rangeFar.visible=false;window.__trail.world.rangeNear.visible=false');
await fps('+ rocks off', 'window.__trail.world.rocks.visible=false');
await fps('+ ground off', 'window.__trail.world.groundMesh.visible=false');
await fps('pixelRatio 0.6', 'window.__trail.world.renderer.setPixelRatio(0.6);window.__trail.world.onResize()');

console.log('drawn tris:', await ev('window.__trail.world.renderer.info.render.triangles'));
ws.close(); chrome.kill();
setTimeout(() => rm(profile, { recursive: true, force: true }).catch(() => {}), 400);
