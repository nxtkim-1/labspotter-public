// Live-camera layout check against the REAL backend (real encoder), using Chrome's built-in FAKE camera (a test pattern, not a bench).
// Opt-in: LABSPOTTER_REAL_E2E=1 node gui/e2e_live_fakecam_REAL_BACKEND.mjs [outdir]. No Meta unless the operator exports a key. Secrets never printed.
import { createRequire } from 'module'; import { spawn } from 'child_process'; import crypto from 'crypto'; import fs from 'fs'; import net from 'net'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
if (process.env.LABSPOTTER_REAL_E2E !== '1') { console.log('LIVE FAKECAM REAL: SKIP (set LABSPOTTER_REAL_E2E=1)'); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url)); const APP = path.join(here, '..');
const { chromium } = createRequire(here + '/')('playwright-core');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ls_live_')); fs.mkdirSync(OUT, { recursive: true });
const TOKEN = crypto.randomBytes(24).toString('base64url'); const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'ls_runs_'));
const port = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn(process.env.PYTHON || 'python3', ['server.py', '--port', String(port)], { cwd: APP, env: { ...process.env, LABSPOTTER_TOKEN: TOKEN, LABSPOTTER_RUNS: runs }, stdio: 'ignore' });
let fails = 0; const ok = (n, c, d = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let up = false; for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { } if (!up) await sleep(1000); }
  ok('server up', up);
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  for (const [tag, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, permissions: ['camera'] }); const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/`); await pg.locator('input[type=password]').first().fill(TOKEN); await pg.keyboard.press('Enter'); await pg.waitForTimeout(2000);
    await pg.getByRole('button', { name: 'Go live' }).first().click(); await pg.waitForTimeout(3000);
    ok(tag + ' camera view is on', (await pg.locator('video.as-video').count()) > 0 && /Camera on/.test(await pg.locator('body').innerText()));
    await pg.screenshot({ path: path.join(OUT, `${tag}_live_1.png`) });
    await pg.locator('.as-label').first().waitFor({ timeout: 60000 }).catch(() => { });
    await pg.waitForTimeout(1500); await pg.screenshot({ path: path.join(OUT, `${tag}_live_2_suggestion.png`) });
    ok(tag + ' a suggestion from the fake camera is shown as not confirmed', (await pg.locator('.as-label').count()) > 0 && /not confirmed/i.test(await pg.locator('body').innerText()));
    await pg.getByRole('button', { name: 'Stop the camera' }).first().click().catch(() => { });
  }
  await b.close();
} catch (e) { ok('run completed', false, String(e).slice(0, 200)); } finally { srv.kill('SIGTERM'); }
console.log('screenshots: ' + OUT); console.log(fails ? 'LIVE FAKECAM REAL: FAIL ' + fails : 'LIVE FAKECAM REAL: PASS'); process.exit(fails ? 1 : 0);
