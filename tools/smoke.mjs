/**
 * Minimal smoke test for Oregon Trail 1847.
 * Launches Chrome headless, loads the page, waits for the app to boot,
 * clicks through the opening screens, and checks for fatal errors.
 *
 * Targets http://mother.local:8080/oregon-trail/ (served by XAMPP).
 *
 * Usage: node tools/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'http://mother.local:8080/oregon-trail/';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

async function main() {
  const browserPath = CHROME_CANDIDATES.find((c) => existsSync(c));
  if (!browserPath) throw new Error('No Chrome or Edge executable found');

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'oregon-1847-'));
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
    '--user-data-dir=' + userDataDir,
    'about:blank',
  ], { stdio: 'pipe', windowsHide: true });

  let stdOut = '';
  let stdErr = '';
  chrome.stdout.on('data', (d) => stdOut += d.toString());
  chrome.stderr.on('data', (d) => stdErr += d.toString());

  // Wait for Chrome to start (it spawns quickly with about:blank)
  await wait(3000);

  // Navigate to the game
  chrome.stdin.write('GET ' + URL + ' HTTP/1.1\r\nHost: mother.local:8080\r\nConnection: close\r\n\r\n');
  await wait(5000);

  // Simple script to run in the loaded page
  const script = `
    (async () => {
      // Wait for the app to report it's ready
      let ready = false;
      let attempts = 0;
      while (attempts < 100) {
        if (document.documentElement.dataset.appReady === 'true') { ready = true; break; }
        attempts++;
        await new Promise(r => setTimeout(r, 200));
      }
      if (!ready) { document.body.textContent = 'TIMEOUT: app never ready'; return; }

      // Click through the opening sequence
      // 1. New Journey
      let btn = Array.from(document.querySelectorAll('#title-panel button')).find(b => /NEW JOURNEY/i.test(b.textContent));
      if (btn) { btn.click(); await new Promise(r => setTimeout(r, 300)); }
      // 2. Instructions start (SHOW ME or START)
      btn = Array.from(document.querySelectorAll('#panel button')).find(b => /START/i.test(b.textContent));
      if (btn) { btn.click(); await new Promise(r => setTimeout(r, 300)); }
      // 3. Marksmanship GOOD SHOT
      btn = Array.from(document.querySelectorAll('#panel .option')).find(b => /GOOD SHOT/i.test(b.textContent));
      if (btn) { btn.click(); await new Promise(r => setTimeout(r, 300)); }
      // 4. Purchases BUY SUPPLIES
      btn = Array.from(document.querySelectorAll('#panel button')).find(b => /BUY SUPPLIES/i.test(b.textContent));
      if (btn) { btn.click(); await new Promise(r => setTimeout(r, 300)); }
      // 5. Continue
      btn = Array.from(document.querySelectorAll('#panel button')).find(b => /CONTINUE/i.test(b.textContent));
      if (btn) { btn.click(); await new Promise(r => setTimeout(r, 300)); }
      // 6. Moderately
      btn = Array.from(document.querySelectorAll('#panel .option')).find(b /MODERATELY/i.test(b.textContent));
      if (btn) { btn.click(); await new Promise(r => setTimeout(r, 300)); }

      // Check for error banner and log health
      const fatal = document.querySelector('#fatal');
      const fatalVisible = fatal && !fatal.hidden;
      const logLines = document.querySelectorAll('#log .log-line').length;
      const chips = document.querySelectorAll('#hud-chips .chip').length;
      const miles = document.querySelector('#hud-miles')?.textContent || '';
      const prompt = document.querySelector('#panel .panel-title')?.textContent || '';

      // Report results via postMessage so the parent can exit cleanly
      const result = { ready, fatalVisible, logLines, chips, miles, prompt };
      window.postMessage(result, '*');
    })();
  `;

  // Inject and run the script
  const cdpUrl = 'http://127.0.0.1:9222/json/version'; // attempt default CDP port
  // Instead of CDP, use eval after page load via meta + script injection
  const inject = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.textContent = script;
    document.documentElement.appendChild(el);
    el.remove();
    // Wait a bit for the script to run and postMessage
    setTimeout(() => {
      // check if message already received
      resolve();
    }, 8000);
  });

  // Wait for the result message from the page
  await new Promise((resolve, reject) => {
    const onmsg = (e) => {
      if (e.data && e.data.ready !== undefined) {
        window.removeEventListener('message', onmsg);
        resolve(e.data);
      }
    };
    window.addEventListener('message', onmsg, { once: true });
    // timeout after 20s
    setTimeout(() => { window.removeEventListener('message', onmsg); reject(new Error('SMOKE TIMEOUT')); }, 20000);
  }).then((result) => {
    console.log('SMOKE PASS');
    console.log(`  ready=${result.ready} fatalVisible=${result.fatalVisible} logLines=${result.logLines} chips=${result.chips} miles=${result.miles} prompt=${result.prompt}`);
    if (result.fatalVisible) { console.log('  FAIL: error banner visible'); process.exitCode = 1; }
    else if (result.logLines < 4) { console.log('  FAIL: too few log lines'); process.exitCode = 1; }
    else { console.log('  OK'); }
  }).catch((err) => {
    console.log('SMOKE FAIL', err.message);
    process.exitCode = 1;
  });

  // Clean up
  chrome.kill();
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}

main();