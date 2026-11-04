// BenchFreeze GUI flow against the REAL server.py over HTTP, with the real engine store. Clip run source:
//   default: a SCRIPTED fixture run written to the runs dir (no model).   BENCH_REAL=1 + LABSPOTTER_REAL_E2E=1: the REAL V-JEPA2 encoder analyzes demo_clips/Add_step.mp4 first.
// Interruption = SIGKILL of server.py, then a fresh server.py process on the same port and runs dir. Resume goes through the page.
import { createRequire } from 'module'; import { spawn } from 'child_process'; import fs from 'fs'; import net from 'net'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url)); const APP = path.join(here, '..');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome'; const PY = process.env.PYTHON || 'python3'; const REAL = process.env.BENCH_REAL === '1';
const TOKEN = 'bench-gui-token-' + Date.now().toString(36); const RUNS = fs.mkdtempSync(path.join(os.tmpdir(), 'ls_bench_gui_')); const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'ls_bench_shots_'));
const res = []; const ok = (n, c, d = '') => { const l = (c ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : ''); res.push(l); console.log(l); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((r, j) => { const s = net.createServer(); s.once('error', j); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let srv = null; const kill = sig => { if (srv && srv.exitCode === null) try { srv.kill(sig); } catch { } }; process.on('exit', () => kill('SIGKILL'));
const start = async port => { srv = spawn(PY, ['server.py', '--port', String(port), '--host', '127.0.0.1'], { cwd: APP, env: { ...process.env, LABSPOTTER_TOKEN: TOKEN, LABSPOTTER_RUNS: RUNS }, stdio: 'ignore' });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true; } catch { } await sleep(500); } return false; };
const connect = async (pg, base) => { await pg.goto(base + '/'); await pg.waitForTimeout(600);
  const tab = (await pg.locator('#rail').isVisible()) ? pg.locator('#rail .rail-item').nth(1) : pg.locator('#tabbar .tab').nth(1); await tab.click(); await pg.waitForTimeout(400);
  await pg.locator('input[type=password]').first().fill(TOKEN); await pg.getByRole('button', { name: 'Connect' }).click(); await pg.waitForTimeout(1500); };
let b = null;
try {
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const PROBS = { 'MeasureLiquid step': 0.47, 'Add step': 0.2, 'Stir step': 0.1, 'No action': 0.08, 'PhaseSeparation step': 0.06, 'CollectLayer step': 0.05, 'MeasureSolid step': 0.03, 'AnalyticalMeasurement step': 0.01 };
  if (!REAL) { const d = path.join(RUNS, 'fixtureA'); fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'predictions.json'), JSON.stringify([{ clip: 'fixture.mp4', t: 0, decoded_frames: 16, top3: [['MeasureLiquid step', .47], ['Add step', .2], ['Stir step', .1]], probs: PROBS }]));
    fs.writeFileSync(path.join(d, 'facts.json'), '[]'); fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ alert: 'act-fixtureA pending_review', approval: 'NONE RECORDED' })); }
  ok('server.py up (' + (REAL ? 'REAL encoder run' : 'SCRIPTED fixture run') + ')', await start(port));
  b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }); const pg = await b.newPage({ viewport: { width: 1440, height: 940 } }); const perr = []; pg.on('pageerror', e => perr.push(String(e)));
  await connect(pg, base);
  ok('Start session available before a run (save needs a run)', await pg.getByRole('button', { name: /Start session/ }).isEnabled());
  let tagUsed = 'fixtureA';
  if (REAL) { tagUsed = 'benchReal-' + Date.now().toString(36); await pg.locator('input[type=file]').setInputFiles(path.join(APP, 'demo_clips', 'Add_step.mp4')); await pg.locator('.bk-row:has(span:text-is("run tag")) input').fill(tagUsed);
    await pg.getByRole('button', { name: /Analyze clip/ }).click(); await pg.getByText('Uploaded clip - live result').waitFor({ timeout: 600000 }); }
  else { await pg.locator('.bk-row:has(span:text-is("past run")) input').fill('fixtureA'); await pg.getByRole('button', { name: 'Load run' }).click(); await pg.getByText('Stored run "fixtureA"').waitFor({ timeout: 15000 }); }
  await pg.getByRole('button', { name: /Start session/ }).click(); await pg.getByText(/Session [0-9a-f]{12} - 0 saved entries/).waitFor({ timeout: 10000 }); ok('session started', true);
  await pg.getByRole('button', { name: /Save this result/ }).click(); await pg.locator('.bf-log li').first().waitFor({ timeout: 10000 });
  const cpText = await pg.locator('.bf-log li').first().textContent(); const st0 = await pg.locator('.bf-log li').first().getAttribute('data-status'); ok('saved claim shows as a Model suggestion with no percentage or Needs review badge, while the record status stays unconfirmed', st0 === 'unconfirmed-needs-review' && /Model suggestion/.test(cpText) && !/%/.test(cpText) && !/Needs review/.test(cpText), (st0||'') + ' | ' + cpText.slice(0, 160));
  await pg.getByRole('button', { name: /^Save session$/ }).click(); await pg.locator('.bf-token').waitFor({ timeout: 10000 }); ok('after Save session the panel says Saved sessions, and the key is under Advanced (collapsed)', /Saved sessions/.test(await pg.locator('.bf-token').textContent()) && !(await pg.locator('.bf-code').isVisible())); await pg.locator('.bf-token summary').click(); await pg.locator('.bf-code').waitFor({ timeout: 10000 });
  await pg.getByRole('button', { name: 'Show token' }).click(); const rtok = (await pg.locator('.bf-code').textContent()).trim(); ok('freeze returned a resume token and says UNCONFIRMED', rtok.length >= 20 && /unconfirmed/i.test(await pg.locator('.bf-token').textContent()));
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByRole('button', { name: 'Download session file' }).click()]); const dlp = path.join(SHOTS, 'backup.json'); await dl.saveAs(dlp);
  ok('Download session file saves a backup file (the key is in the file, not in the page storage)', fs.readFileSync(dlp, 'utf8').includes(rtok) && !(await pg.evaluate(() => JSON.stringify(localStorage))).includes(rtok));
  ok('resume token is not in localStorage or the URL', !(await pg.evaluate(() => JSON.stringify(localStorage))).includes(rtok) && !pg.url().includes(rtok));
  await pg.evaluate(() => { document.querySelectorAll('.bf-code').forEach(e => { e.textContent = '[resume token hidden in this screenshot]'; }); }); await pg.screenshot({ path: path.join(SHOTS, 'desktop_frozen.jpg'), type: 'jpeg', quality: 72 });
  // interruption: hard kill, restart on same port and data
  kill('SIGKILL'); await sleep(1000); let down = false; try { await fetch(base + '/api/health'); } catch { down = true; } ok('INTERRUPT: server killed (SIGKILL), port closed', down);
  ok('server.py restarted on the same data', await start(port));
  const pg2 = await b.newPage({ viewport: { width: 1440, height: 940 } }); pg2.on('pageerror', e => perr.push(String(e))); await connect(pg2, base);
  const lrow = pg2.locator('.bf-saved li').first(); await lrow.waitFor({ timeout: 10000 }); ok('saved sessions list shows the session after the restart, with a Continue button and no key', /Saved .* - \d+ entr/.test(await lrow.textContent()) && !(await pg2.locator('.bf-continue').textContent()).includes(rtok));
  await pg2.locator('.bf-panel').screenshot({ path: path.join(SHOTS, 'desktop_saved_list.jpg'), type: 'jpeg', quality: 80 }); await pg2.screenshot({ path: path.join(SHOTS, 'desktop_run_top.jpg'), type: 'jpeg', quality: 72 });
  await lrow.getByRole('button', { name: 'Continue' }).click(); await pg2.locator('.bf-resumed').waitFor({ timeout: 10000 }); const crt = await pg2.locator('.bf-resumed').textContent();
  ok('Continue from the saved list restores the record, intact, with no key, BENCH STATE UNKNOWN and SAFETY CLEARANCE NO', /Saved record intact: yes/.test(crt) && /BENCH STATE: UNKNOWN/.test(crt) && /SAFETY CLEARANCE: NO/.test(crt));
  await pg2.locator('.bf-continue summary').click(); await pg2.locator('input[type=file][accept*=json]').setInputFiles(dlp); await pg2.locator('.bf-resumed').waitFor({ timeout: 10000 });
  ok('Choose backup file continues the session from the file', /Saved record intact: yes/.test(await pg2.locator('.bf-resumed').textContent()));
  await pg2.locator('.bf-panel input[type=password]').fill('not-a-real-token'); await pg2.getByRole('button', { name: 'Resume', exact: true }).click(); await pg2.locator('.bk-error:has-text("Save and resume")').waitFor({ timeout: 10000 });
  ok('bad token is rejected in the page', /unknown resume token/.test(await pg2.locator('.bk-error:has-text("Save and resume")').textContent()));
  await pg2.locator('.bf-panel input[type=password]').fill(rtok); await pg2.getByRole('button', { name: 'Resume', exact: true }).click(); await pg2.locator('.bf-resumed').waitFor({ timeout: 10000 }).catch(async e => { console.log('DEBUG err:', await pg2.locator('.bk-error').allTextContents()); throw e; });
  const rt = await pg2.locator('.bf-resumed').textContent(); 
  ok('resume restores the record, intact (review shows it needs review)', /Saved record intact: yes/.test(rt));
  ok('resume shows BENCH STATE: UNKNOWN and SAFETY CLEARANCE: NO', /BENCH STATE: UNKNOWN/.test(rt) && /SAFETY CLEARANCE: NO/.test(rt) && /does not show the bench is unchanged or safe/.test(rt));
  await pg2.locator('.bf-panel').scrollIntoViewIfNeeded(); await pg2.screenshot({ path: path.join(SHOTS, 'desktop_resumed_viewport.jpg'), type: 'jpeg', quality: 72 });
  // mobile 390: independent session (new context), same resume token through the page
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const pm = await ctx.newPage(); pm.on('pageerror', e => perr.push(String(e))); await connect(pm, base);
  await pm.locator('.bf-saved li').first().waitFor({ timeout: 10000 }); await pm.locator('.bf-continue').scrollIntoViewIfNeeded(); await pm.screenshot({ path: path.join(SHOTS, 'mobile390_saved_list.jpg'), type: 'jpeg', quality: 78 });
  await pm.locator('.bf-saved li').first().getByRole('button', { name: 'Continue' }).click(); await pm.locator('.bf-resumed').waitFor({ timeout: 10000 }); ok('mobile: Continue from the saved list restores the record with no key', /Saved record intact: yes/.test(await pm.locator('.bf-resumed').textContent())); await pm.locator('.bf-resumed').scrollIntoViewIfNeeded(); await pm.screenshot({ path: path.join(SHOTS, 'mobile390_continued.jpg'), type: 'jpeg', quality: 78 });
  await pm.locator('.bf-continue summary').click(); await pm.locator('.bf-panel input[type=password]').fill(rtok); await pm.getByRole('button', { name: 'Resume', exact: true }).click(); await pm.locator('.bf-resumed').waitFor({ timeout: 10000 });
  await pm.getByRole('button', { name: /Review what was saved/ }).click(); await pm.waitForTimeout(500); await pm.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await pm.waitForTimeout(400); await pm.screenshot({ path: path.join(SHOTS, 'mobile390_resumed_scroll_bottom.jpg'), type: 'jpeg', quality: 72 });
  const clear = await pm.evaluate(() => { const tb = document.getElementById('tabbar'); const last = document.querySelector('.bf-resumed .bf-log li, .bf-resumed .bf-cp'); if (!tb || !last) return null; return last.getBoundingClientRect().bottom <= tb.getBoundingClientRect().top; });
  ok('mobile: last resumed content scrolls clear of the bottom tab bar', clear === true, 'clear=' + clear);
  ok('no page JS errors', perr.length === 0, JSON.stringify(perr)); console.log('screenshots: ' + SHOTS);
} catch (e) { ok('flow completed without an error', false, String(e && e.message ? e.message : e).slice(0, 400)); }
finally { kill('SIGKILL'); if (b) await b.close().catch(() => { }); try { fs.rmSync(RUNS, { recursive: true, force: true }); } catch { } }
const nf = res.filter(x => x.startsWith('FAIL')).length; console.log(`BENCH GUI FLOW: ${res.length - nf} PASS, ${nf} FAIL`); if (nf) process.exitCode = 1;
