// LabSpotter demo recording against the REAL server.py + REAL V-JEPA2 encoder (no stub, no live Meta call).
// Usage: LABSPOTTER_REAL_E2E=1 CHROME=... PYTHON=python3 OUT=/path node gui/demo_record.mjs   (run from the app root's gui/ dir)
// One page, one Playwright context with video recording. Captions are overlay text injected into the page.
import { createRequire } from 'module'; import { spawn, spawnSync } from 'child_process'; import fs from 'fs'; import net from 'net'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url)); const APP = path.join(here, '..');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome'; const PY = process.env.PYTHON || 'python3'; const OUT = process.env.OUT || path.join(os.tmpdir(), 'demo_out');
const CLIPS = (process.env.CLIPS || process.env.CLIP || 'Add_step.mp4').split(','); const CLIPNAME = CLIPS[CLIPS.length - 1]; const LAUNCHER = process.env.LAUNCHER === '1';
fs.mkdirSync(OUT, { recursive: true });
const TOKEN = 'demo-token-' + Date.now().toString(36); const RUNS = fs.mkdtempSync(path.join(os.tmpdir(), 'ls_demo_runs_'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((r, j) => { const s = net.createServer(); s.once('error', j); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let srv = null; const kill = sig => { if (LAUNCHER) { try { spawnSync('pkill', ['-9', '-f', '[s]erver.py --port']); } catch { } } if (srv && srv.exitCode === null) try { srv.kill(sig); } catch { } }; process.on('exit', () => kill('SIGKILL'));
const start = async port => { if (LAUNCHER) { srv = spawn('bash', ['run_local.sh', '--port', String(port)], { cwd: APP, env: { ...process.env, LABSPOTTER_TOKEN: TOKEN, LABSPOTTER_RUNS: RUNS, LABSPOTTER_RUN_DIR: path.join(RUNS, '.run') }, stdio: 'ignore' }); }
  else { srv = spawn(PY, ['server.py', '--port', String(port), '--host', '127.0.0.1'], { cwd: APP, env: { ...process.env, LABSPOTTER_TOKEN: TOKEN, LABSPOTTER_RUNS: RUNS }, stdio: 'ignore' }); }
  for (let i = 0; i < 1200; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true; } catch { } await sleep(500); } return false; };
const log = []; const L = (m) => { const l = new Date().toISOString().slice(11, 19) + ' ' + m; log.push(l); console.log(l); };
let b = null;
try {
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  L('server up: ' + await start(port));
  b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  const T0 = Date.now(); const rel = () => ((Date.now() - T0) / 1000).toFixed(1); const pg = await ctx.newPage(); const perr = []; pg.on('pageerror', e => perr.push(String(e)));
  const cap = async (t) => { await pg.evaluate((t) => { let d = document.getElementById('demo-cap'); if (!d) { d = document.createElement('div'); d.id = 'demo-cap'; d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(10,12,16,.92);color:#fff;font:600 18px/1.35 Inter,system-ui,sans-serif;padding:12px 20px;border-top:2px solid #4fb3ff'; document.body.appendChild(d); } d.textContent = t; }, t).catch(() => { }); };
  const connect = async () => { await pg.goto(base + '/'); await pg.waitForTimeout(800);
    const tab = (await pg.locator('#rail').isVisible()) ? pg.locator('#rail .rail-item').nth(1) : pg.locator('#tabbar .tab').nth(1); await tab.click(); await pg.waitForTimeout(400);
    await pg.locator('input[type=password]').first().fill(TOKEN); await pg.getByRole('button', { name: 'Connect' }).click(); await pg.waitForTimeout(1500); };
  await pg.goto(base + '/'); await pg.waitForTimeout(1200);
  await cap('LabSpotter: a lab-action assistant. A Meta open-weight video model (V-JEPA 2) reads a short bench clip. Predictions are UNVALIDATED claims.'); await pg.waitForTimeout(5000);
  await pg.locator('#rail .rail-item').nth(0).click().catch(() => { }); await pg.waitForTimeout(500); await cap('Review: a PRE-RECORDED example run (fresh1), not live. Model output is a claim, not a safety clearance.'); await pg.waitForTimeout(5000);
  await connect(); await cap('Run: connect to the local backend with a session token (token stays on this computer, never shown).'); await pg.waitForTimeout(3500);
  let tag = '';
  for (const CN of CLIPS) {
    await pg.locator('input[type=file][accept="video/mp4"]').setInputFiles(path.join(APP, 'demo_clips', CN));
    tag = 'demo-' + Date.now().toString(36); await pg.locator('.bk-row:has(span:text-is("run tag")) input').fill(tag);
    await cap('Upload ' + CN + ' and analyze: REAL V-JEPA 2 encoder on CPU, then a head with 8 class probabilities.');
    L('MARK analysis_start ' + CN + ' ' + rel()); await pg.getByRole('button', { name: /Analyze clip/ }).click(); await pg.getByText('Uploaded clip - live result').waitFor({ timeout: 900000 }); L('MARK analysis_end ' + CN + ' ' + rel());
    const firstRow = (await pg.locator('.bk-result').first().locator('.bk-pred').first().locator('.bk-row').first().innerText()).replace(/\s+/g, ' ').trim(); L('TOP1 ' + CN + ' ' + firstRow);
    await pg.locator('.bk-result').first().scrollIntoViewIfNeeded().catch(() => { }); await pg.waitForTimeout(500);
    const lab = CN.replace(/_step\.mp4|\.mp4/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    const hit = firstRow.toLowerCase().replace(/[^a-z]/g, '').startsWith(lab.toLowerCase().replace(/[^a-z]/g, ''));
    await cap('LIVE result for ' + CN + ' (dataset label: ' + lab + '). Top-1: ' + firstRow + '. ' + (hit ? 'This one matches the label. One clip is not an accuracy measurement.' : 'This is a MISS. The app shows it as unvalidated.')); L('MARK result_hold ' + CN + ' ' + rel() + ' hit=' + hit); await pg.waitForTimeout(11000);
    await pg.locator('#rail .rail-item').nth(1).click().catch(() => { }); await pg.evaluate(() => window.scrollTo(0, 0)).catch(() => { }); await pg.waitForTimeout(300);
  }
  await pg.getByRole('button', { name: /Start session/ }).click(); await pg.getByText(/Session [0-9a-f]{12} - 0 saved entries/).waitFor({ timeout: 10000 });
  await cap('BenchFreeze: start a protocol session.'); await pg.waitForTimeout(2500);
  await pg.getByRole('button', { name: new RegExp('Save result "' + tag + '"') }).click(); await pg.getByText(/Step 1 - UNCONFIRMED/).waitFor({ timeout: 10000 });
  await cap('The model result is saved as an UNCONFIRMED claim. Nothing is verified about the bench.'); await pg.waitForTimeout(5000);
  await pg.getByRole('button', { name: /Freeze and get resume token/ }).click(); await pg.locator('.bf-code').waitFor({ timeout: 10000 });
  const rtok = (await pg.locator('.bf-code').textContent()).trim();
  await pg.evaluate(() => { document.querySelectorAll('.bf-code').forEach(e => { e.textContent = '[resume token hidden in this recording]'; }); });
  await cap('Freeze: the saved state gets a resume token (hidden here). Frozen does not mean verified.'); await pg.waitForTimeout(5000);
  await cap('Now the server is hard-killed (SIGKILL) and restarted on the same data.'); await pg.waitForTimeout(3000);
  kill('SIGKILL'); await sleep(1000); L('restart: ' + await start(port));
  await connect(); await cap('Server restarted. A wrong token is rejected first.'); await pg.waitForTimeout(2000);
  await pg.locator('.bf-panel input[type=password]').fill('not-a-real-token'); await pg.getByRole('button', { name: 'Resume', exact: true }).click(); await pg.locator('.bk-error:has-text("BenchFreeze")').waitFor({ timeout: 10000 }); await cap('Wrong token: rejected with an error, nothing restored.'); L('MARK wrong_token ' + rel()); await pg.waitForTimeout(5000);
  await pg.locator('.bf-panel input[type=password]').fill(rtok); await pg.getByRole('button', { name: 'Resume', exact: true }).click(); await pg.locator('.bf-resumed').waitFor({ timeout: 10000 });
  await pg.locator('.bf-panel').scrollIntoViewIfNeeded().catch(() => { });
  await cap('Right token: record intact (hash chain re-checked), status UNCONFIRMED, bench state UNKNOWN, safety clearance NO.'); L('MARK resumed ' + rel()); await pg.waitForTimeout(10000);
  await cap('LabSpotter shows what a video model claims it saw and keeps that claim honest. The live Meta agent is offline in this build.'); await pg.waitForTimeout(5000);
  L('page errors: ' + JSON.stringify(perr));
  const vp = await pg.video().path(); await ctx.close(); L('video ' + vp + ' ' + fs.statSync(vp).size);
  fs.writeFileSync(path.join(OUT, 'demo_log.txt'), log.join('\n') + '\n');
} catch (e) { L('FAILED ' + String(e && e.message ? e.message : e).slice(0, 500)); fs.writeFileSync(path.join(OUT, 'demo_log.txt'), log.join('\n') + '\n'); }
finally { kill('SIGKILL'); if (b) await b.close().catch(() => { }); try { fs.rmSync(RUNS, { recursive: true, force: true }); } catch { } }
