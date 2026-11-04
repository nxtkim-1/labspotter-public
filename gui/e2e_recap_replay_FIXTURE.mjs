// REPLAY / FIXTURE check, NOT a fresh end-to-end run and NOT a Meta call: feeds a previously SAVED coach response (RESPONSE_JSON=path to the saved agent_resp file,
// kept outside the repo) into the real app's final renderer by intercepting POST /api/agent/coach in the browser. Zero API calls to Meta.
// Also probes Read-aloud: counts speech voices and logs utterance start/end/error events (no claim of audible speech; a headless browser may have no voice).
// Opt-in: LABSPOTTER_REAL_E2E=1 RESPONSE_JSON=... node gui/e2e_recap_replay_FIXTURE.mjs [outdir]
import { createRequire } from 'module'; import { spawn } from 'child_process'; import crypto from 'crypto'; import fs from 'fs'; import net from 'net'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
if (process.env.LABSPOTTER_REAL_E2E !== '1' || !process.env.RESPONSE_JSON) { console.log('REPLAY: SKIP (set LABSPOTTER_REAL_E2E=1 and RESPONSE_JSON)'); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url)); const APP = path.join(here, '..');
const { chromium } = createRequire(here + '/')('playwright-core');
const saved = JSON.parse(fs.readFileSync(process.env.RESPONSE_JSON, 'utf8')).answer;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ls_replay_')); fs.mkdirSync(OUT, { recursive: true });
const TOKEN = crypto.randomBytes(24).toString('base64url'); const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'ls_runs_'));
const port = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const env = { ...process.env, LABSPOTTER_TOKEN: TOKEN, LABSPOTTER_RUNS: runs }; delete env.MODEL_API_KEY; delete env.LABSPOTTER_LIVE_CLEARED;
const srv = spawn(process.env.PYTHON || 'python3', ['server.py', '--port', String(port)], { cwd: APP, env, stdio: 'ignore' });
let fails = 0; const ok = (n, c, d = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let up = false; for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { } if (!up) await sleep(1000); }
  ok('server up', up);
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [tag, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
    const pg = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'desk' ? 1 : 2 })).newPage();
    await pg.addInitScript(() => { window.__sp = []; const ss = window.speechSynthesis; if (ss) { const o = ss.speak.bind(ss); ss.speak = u => { for (const ev of ['start', 'end', 'error']) u.addEventListener(ev, e => window.__sp.push(ev + (e.error ? ':' + e.error : ''))); window.__sp.push('speak-called'); return o(u); }; } });
    await pg.route('**/api/agent/coach*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recap: saved.recap, open_questions: saved.open_questions, next_steps: saved.next_steps, note: 'REPLAY of a saved response' }) }));
    await pg.goto(`http://127.0.0.1:${port}/`); await pg.locator('input[type=password]').first().fill(TOKEN); await pg.keyboard.press('Enter'); await pg.waitForTimeout(2000);
    const g = pg.getByRole('button', { name: /Follow a written guide/ }).first(); if (await g.count()) await g.click().catch(() => { });
    await pg.getByRole('button', { name: 'Try the water example' }).click(); await pg.waitForTimeout(800);
    await pg.getByRole('button', { name: 'Correct' }).first().click(); await pg.waitForTimeout(500);
    await pg.locator('input.as-input').first().fill('Synthetic test note.'); await pg.getByRole('button', { name: 'Save note' }).first().click(); await pg.waitForTimeout(500);
    await pg.getByRole('button', { name: 'Pause and save my place' }).first().click(); await pg.locator('.as-ai-kicker').first().waitFor({ timeout: 20000 }).catch(() => { }); await pg.waitForTimeout(800);
    await pg.screenshot({ path: path.join(OUT, `${tag}_replay_recap.png`) });
    const txt = await pg.locator('.as-ai').first().innerText();
    ok(tag + ' AI summary label and Powered by Meta shown', /AI summary/.test(txt) && /Powered by Meta/.test(txt));
    ok(tag + ' full saved text present (every recap + next-step sentence)', [saved.recap, ...saved.next_steps].every(s => s.replace(/\s*\((?:p|score|probability)\s*[=:]\s*[0-9.]+\)/gi, '').split(/(?<=[.!?])\s+/).filter(Boolean).every(x => txt.includes(x.trim().replace(/\.$/, '')))));
    ok(tag + ' score removed from the screen', !/\bp\s*=\s*0?\.\d+/.test(txt));
    const voices = await pg.evaluate(() => (window.speechSynthesis ? window.speechSynthesis.getVoices().length : -1));
    const rb = pg.getByRole('button', { name: 'Read it to me' });
    if (await rb.count()) { await rb.first().click(); await pg.waitForTimeout(4000); }
    console.log(tag + ' read-aloud probe: voices=' + voices + ' events=' + JSON.stringify(await pg.evaluate(() => window.__sp)) + ' (events are not proof of audible speech)');
  }
  await b.close();
} catch (e) { ok('run completed', false, String(e).slice(0, 200)); } finally { srv.kill('SIGTERM'); }
console.log('screenshots: ' + OUT); console.log(fails ? 'REPLAY: FAIL ' + fails : 'REPLAY: PASS (replay/fixture scope)'); process.exit(fails ? 1 : 0);
