/**
 * Real browser smoke test for Oregon Trail 1847.
 *
 * Launches headless Chrome/Edge, loads the game, taps through the opening
 * screens, and fails on page exceptions, the error banner, or missing UI.
 *
 * Usage:
 *   node tools/smoke.mjs                       # tests mother.local:8080 (XAMPP)
 *   node tools/smoke.mjs <url>                 # tests any deployed URL
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2] || 'http://mother.local:8080/oregon-trail/';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const srv = net.createServer();
  await new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', resolve);
  });
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const handler of this.listeners.get(message.method) || []) handler(message.params);
    });
  }

  static async connect(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const list = this.listeners.get(method) || [];
    list.push(handler);
    this.listeners.set(method, list);
  }
}

async function main() {
  const browserPath = CHROME_CANDIDATES.find((c) => existsSync(c));
  if (!browserPath) throw new Error('No Chrome or Edge executable found');

  const port = await freePort();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'oregon-smoke-'));
  const chrome = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--mute-audio',
    '--window-size=430,932',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  const errors = [];
  let client;
  let failed = false;
  try {
    // Wait for DevTools endpoint
    let ready = false;
    for (let i = 0; i < 120; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) { ready = true; break; }
      } catch { /* still starting */ }
      await wait(150);
    }
    if (!ready) throw new Error('Chrome DevTools endpoint never came up');

    const targetRes = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    const target = await targetRes.json();
    client = await Cdp.connect(target.webSocketDebuggerUrl);
    client.on('Runtime.exceptionThrown', (params) => {
      errors.push(params.exceptionDetails?.exception?.description
        || params.exceptionDetails?.text
        || 'page exception');
    });

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    const evaluate = async (expression) => {
      const res = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
      }
      return res.result.value;
    };

    const waitFor = async (expression, label, timeout = 12000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await evaluate(expression)) return true;
        await wait(100);
      }
      throw new Error(`Timed out waiting for: ${label}`);
    };

    const tapText = (scope, pattern) => evaluate(`(() => {
      const nodes = Array.from(document.querySelectorAll(${JSON.stringify(scope)}));
      const target = nodes.find((node) => new RegExp(${JSON.stringify(pattern)}, 'i').test(node.textContent || ''));
      if (!target || target.disabled) return false;
      target.click();
      return true;
    })()`);

    const steps = [];
    const step = async (label, fn) => {
      const ok = await fn();
      if (!ok) throw new Error(`Could not complete step: ${label}`);
      steps.push(label);
      await wait(200);
    };

    console.log(`smoke: loading ${url}`);
    await client.send('Page.navigate', { url });
    await waitFor("document.readyState === 'complete'", 'page load');
    await waitFor("document.documentElement.dataset.appReady === 'true'", 'app ready (boot() ran)');

    const fatalHidden = await evaluate("document.getElementById('fatal').hidden === true");
    if (!fatalHidden) {
      const text = await evaluate("document.getElementById('fatal').textContent");
      throw new Error(`Error banner visible: ${text}`);
    }

    // Visibility audit: [hidden] alone is not enough if CSS sets display on the element.
    const bootStyles = await evaluate(`(() => {
      const disp = (id) => {
        const node = document.getElementById(id);
        return node ? getComputedStyle(node).display : 'missing';
      };
      return { boot: disp('boot'), overlay: disp('overlay'), title: disp('title-screen'), app: disp('app') };
    })()`);
    if (bootStyles.boot !== 'none') {
      throw new Error(`Boot overlay still visible (display: ${bootStyles.boot}) - CSS is overriding [hidden]`);
    }
    if (bootStyles.overlay !== 'none') {
      throw new Error(`Overlay sheet should start hidden (display: ${bootStyles.overlay})`);
    }
    if (bootStyles.title === 'none') throw new Error('Title screen is not visible after boot');
    if (bootStyles.app !== 'none') throw new Error('Game UI should stay hidden until New Journey');

    await step('title -> new journey', () => tapText('#title-panel button', 'NEW JOURNEY'));
    await step('instructions -> start', () => tapText('#panel button', 'START'));
    await step('marksmanship', () => tapText('#panel .option', 'GOOD SHOT'));
    await step('purchases', () => tapText('#panel button', 'BUY SUPPLIES'));
    await step('action', () => tapText('#panel button', 'CONTINUE'));
    await step('meal', () => tapText('#panel .option', 'MODERATELY'));

    const snapshot = await evaluate(`(() => ({
      prompt: document.querySelector('#panel .panel-title')?.textContent || '',
      logLines: document.querySelectorAll('#log .log-line').length,
      miles: document.querySelector('#hud-miles')?.textContent || '',
      chips: document.querySelectorAll('#hud-chips .chip').length,
      fatal: document.getElementById('fatal').hidden === false,
      titleHidden: document.getElementById('title-screen').hidden,
      appVisible: document.getElementById('app').hidden === false,
    }))()`);

    if (snapshot.fatal) throw new Error('The error banner became visible during play');
    if (snapshot.logLines < 4) throw new Error(`Expected trail log entries, saw ${snapshot.logLines}`);
    if (snapshot.chips !== 6) throw new Error(`Expected 6 status chips, saw ${snapshot.chips}`);
    if (!snapshot.appVisible || !snapshot.titleHidden) throw new Error('Game did not swap away from title screen');

    console.log('SMOKE PASS');
    console.log(`  steps: ${steps.join(' > ')}`);
    console.log(`  prompt now: ${snapshot.prompt}`);
    console.log(`  mileage: ${snapshot.miles} | log lines: ${snapshot.logLines} | chips: ${snapshot.chips}`);

    if (errors.length) {
      console.log('page exceptions:');
      for (const error of errors) console.log(`  - ${error}`);
      failed = true;
    }
  } catch (error) {
    console.log('SMOKE FAIL');
    console.log(`  ${error.message}`);
    if (errors.length) {
      console.log('  page exceptions:');
      for (const error of errors) console.log(`    - ${error}`);
    }
    failed = true;
  } finally {
    try { client?.socket.close(); } catch { /* ignore */ }
    chrome.kill();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.log('SMOKE FAIL');
  console.log(`  ${error.message}`);
  process.exitCode = 1;
});
