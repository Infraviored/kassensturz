#!/usr/bin/env node
// Smoke test: load build/chrome into a headless Chromium and confirm Chrome
// accepts the manifest and starts the background service worker.
// Needs a Chromium-based browser; set CHROME=/path/to/binary to pick one.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'build', 'chrome');
if (!existsSync(join(ext, 'manifest.json'))) {
  console.error('build/chrome is missing, run `npm run build:chrome` first');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const names = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const n of names) {
      for (const f of [join(dir, n), join(dir, n + '.exe')]) if (dir && existsSync(f)) return f;
    }
  }
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].find(existsSync);
}
const bin = findChrome();
if (!bin) { console.error('no Chrome/Chromium found, set CHROME=/path/to/binary'); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), 'ext-check-'));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(bin, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, `--load-extension=${ext}`, `--disable-extensions-except=${ext}`,
  // branded Chrome 137+ ignores --load-extension unless this feature is off
  '--disable-features=DisableLoadExtensionCommandLineSwitch', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = false;
const worker = manifest.background && manifest.background.service_worker;
try {
  for (let i = 0; i < 40 && !ok; i++) {
    await sleep(500);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      ok = worker
        ? targets.some(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://') && t.url.endsWith('/' + worker))
        : targets.length > 0;
      if (process.env.DEBUG) console.log(targets.map(t => t.type + ' ' + t.url));
    } catch { /* browser still starting */ }
  }
} finally {
  proc.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
if (!worker) console.log('note: no background service worker, only checked that Chrome started');
console.log(ok ? `chrome: OK, ${manifest.name} ${manifest.version} loaded` : 'chrome: FAILED, extension did not load (bad manifest?)');
process.exit(ok ? 0 : 1);
