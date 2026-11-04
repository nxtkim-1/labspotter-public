// Screenshots of guide -> tap Correct -> Pause -> Resume at 1440 and 390 on the REAL server (no encoder needed, no Meta). Opt-in: LABSPOTTER_REAL_E2E=1 node gui/e2e_resume_shots.mjs [outdir]
import { createRequire } from 'module'; import { spawn } from 'child_process'; import crypto from 'crypto'; import fs from 'fs'; import net from 'net'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
if (process.env.LABSPOTTER_REAL_E2E !== '1') { console.log('RESUME SHOTS: SKIP'); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url)); const APP = path.join(here, '..'); const { chromium } = createRequire(here + '/')('playwright-core');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ls_rs_')); fs.mkdirSync(OUT, { recursive: true });
const TOKEN = crypto.randomBytes(24).toString('base64url'); const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'ls_runs_'));
const port = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn(process.env.PYTHON || 'python3', ['server.py', '--port', String(port)], { cwd: APP, env: { ...process.env, LABSPOTTER_TOKEN: TOKEN, LABSPOTTER_RUNS: runs }, stdio: 'ignore' });
let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } await new Promise(r => setTimeout(r, 1000)); }
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [tag, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
    const pg = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    await pg.goto(`http://127.0.0.1:${port}/`); await pg.locator('input[type=password]').first().fill(TOKEN); await pg.keyboard.press('Enter'); await pg.waitForTimeout(2000);
    const g = pg.getByRole('button', { name: /Follow a written guide/ }).first(); if (await g.count()) await g.click().catch(() => { });
    await pg.getByRole('button', { name: 'Try the water example' }).click(); await pg.waitForTimeout(800);
    await pg.getByRole('button', { name: 'Correct' }).first().click(); await pg.waitForTimeout(500);
    await pg.getByRole('button', { name: /Pause and save my place/ }).first().click(); await pg.waitForTimeout(1500);
    ok(tag + ' pause view shows Resume', await pg.getByRole('button', { name: 'Resume' }).count() === 1);
    ok(tag + ' pause hides the tab bar content', await pg.getByRole('button', { name: 'Correct' }).count() === 0);
    await pg.screenshot({ path: path.join(OUT, `${tag}_1_paused.png`) });
    await pg.getByRole('button', { name: 'Resume' }).first().click(); await pg.waitForTimeout(1000);
    ok(tag + ' after Resume the workspace is back (Pause button visible)', await pg.getByRole('button', { name: /Pause and save my place/ }).count() >= 1);
    ok(tag + ' step 1 still marked done after Resume', await pg.getByText('You did this').count() >= 1);
    await pg.screenshot({ path: path.join(OUT, `${tag}_2_after_resume.png`) });
    await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await pg.waitForTimeout(400);
    await pg.screenshot({ path: path.join(OUT, `${tag}_3_after_resume_bottom.png`) });
    const last = await pg.evaluate(() => { const nb = document.querySelector('#tabbar'); const top = nb && getComputedStyle(nb).position === 'fixed' ? nb.getBoundingClientRect().top : innerHeight; const els = [...document.querySelectorAll('#view button, #view input')].filter(e => e.offsetParent); return Math.max(...els.map(e => e.getBoundingClientRect().bottom)) <= top + 1; });
    ok(tag + ' at max scroll every control is above the tab bar', last);
    await pg.context().close();
  }
  await b.close();
} finally { srv.kill(); }
console.log('screenshots: ' + OUT); console.log(fails ? 'RESUME SHOTS: FAIL ' + fails : 'RESUME SHOTS: PASS (real server, no Meta)'); process.exit(fails ? 1 : 0);
