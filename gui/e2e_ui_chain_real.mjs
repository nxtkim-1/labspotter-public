// UI-driven chain against the REAL backend (real V-JEPA2 encoder; needs torch, transformers, pillow, cached weights, Chrome, built gui/dist).
// Opt-in: LABSPOTTER_REAL_E2E=1 node gui/e2e_ui_chain_real.mjs [outdir]
// Drives the app's own buttons: start code -> guide -> Add a video (public demo clip) -> encoder suggestion -> your tap on a step -> note -> Pause -> recap.
// No Meta call unless the operator also exports MODEL_API_KEY and LABSPOTTER_LIVE_CLEARED=1 (then the recap comes from Meta; spend guard applies). Secrets are never printed.
import { createRequire } from 'module'; import { spawn } from 'child_process'; import crypto from 'crypto'; import fs from 'fs'; import net from 'net'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
if (process.env.LABSPOTTER_REAL_E2E !== '1') { console.log('UI CHAIN REAL: SKIP (set LABSPOTTER_REAL_E2E=1)'); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url)); const APP = path.join(here, '..');
const req = createRequire(here + '/'); const { chromium } = req('playwright-core');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ls_chain_')); fs.mkdirSync(OUT, { recursive: true });
const TOKEN = crypto.randomBytes(24).toString('base64url'); const runs = process.env.LABSPOTTER_RUNS || fs.mkdtempSync(path.join(os.tmpdir(), 'ls_runs_'));
const port = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn(process.env.PYTHON || 'python3', ['server.py', '--port', String(port)], { cwd: APP, env: { ...process.env, LABSPOTTER_TOKEN: TOKEN, LABSPOTTER_RUNS: runs }, stdio: 'ignore' });
let fails = 0; const ok = (n, c, d = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let up = false; for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { } if (!up) await sleep(1000); }
  ok('server up', up);
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [tag, w, h] of [['desk', 1440, 900], ['phone', 390, 844]].filter(x => !process.env.CHAIN_ONLY || x[0] === process.env.CHAIN_ONLY)) {
    const pg = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'desk' ? 1 : 2 })).newPage();
    const net = []; pg.on('response', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) net.push(r.request().method() + ' ' + u.pathname + ' ' + r.status()); });
    await pg.goto(`http://127.0.0.1:${port}/`); await pg.locator('input[type=password]').first().fill(TOKEN); await pg.keyboard.press('Enter'); await pg.waitForTimeout(2000);
    const g = pg.getByRole('button', { name: /Follow a written guide/ }).first(); if (await g.count()) await g.click().catch(() => { });
    await pg.getByRole('button', { name: 'Try the water example' }).click(); await pg.waitForTimeout(900);
    await pg.screenshot({ path: path.join(OUT, `${tag}_1_guide_now.png`) });
    await pg.setInputFiles('input[type=file][accept="video/mp4"]', path.join(APP, 'demo_clips', 'Stir_step.mp4'));
    await pg.locator('.as-label').first().waitFor({ timeout: 90000 }).catch(() => { });
    ok(tag + ' encoder suggestion shown, marked as not confirmed', (await pg.locator('.as-label').count()) > 0 && /not confirmed/i.test(await pg.locator('body').innerText()));
    await pg.waitForTimeout(500); await pg.screenshot({ path: path.join(OUT, `${tag}_2_video_suggestion.png`) });
    ok(tag + ' no step ticked by the model', (await pg.locator('.as-steps li.is-done').count()) === 0);
    await pg.getByRole('button', { name: 'Correct' }).first().click(); await pg.waitForTimeout(500);
    ok(tag + ' step ticked only after the tap', (await pg.locator('.as-steps li.is-done').count()) === 1);
    ok(tag + ' one Save note button on screen', (await pg.getByRole('button', { name: 'Save note' }).count()) === 1);
    await pg.locator('input.as-input').first().fill('Synthetic test note: public demo clip.'); await pg.getByRole('button', { name: 'Save note' }).first().click(); await pg.waitForTimeout(600);
    await pg.getByRole('button', { name: 'Pause and save my place' }).first().click(); await pg.locator('.as-ai-kicker').first().waitFor({ timeout: 40000 }).catch(() => { });
    await pg.waitForTimeout(1000); await pg.screenshot({ path: path.join(OUT, `${tag}_3_paused_recap.png`) });
    const body = await pg.locator('body').innerText();
    ok(tag + ' recap shown with its source label', /AI summary|Summary of your saved entries/.test(body));
    ok(tag + ' no raw score in recap', !/\bp\s*=\s*0?\.\d+/.test(await pg.locator('.as-ai').first().innerText()));
    ok(tag + ' API calls all ok', net.filter(l => l !== 'GET /api/auth/me 404').every(l => /\s(200|201)$/.test(l) || (!process.env.MODEL_API_KEY && /agent\/coach 503$/.test(l))), net.length + ' calls');
  }
  await b.close();
} catch (e) { ok('run completed', false, String(e).slice(0, 200)); } finally { srv.kill('SIGTERM'); }
console.log('screenshots: ' + OUT); console.log(fails ? 'UI CHAIN REAL: FAIL ' + fails : 'UI CHAIN REAL: PASS'); process.exit(fails ? 1 : 0);
