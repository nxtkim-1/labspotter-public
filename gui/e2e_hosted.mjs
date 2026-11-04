// Hosted mode in a real browser against the real server.py (HOSTED=1, temp store, no Meta, no encoder). Scope: accounts + guide + notes + pause.
import { createRequire } from 'module'; import { spawn } from 'child_process'; import fs from 'fs'; import net from 'net'; import os from 'os'; import path from 'path';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ls_hosted_')); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, d = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' - ' + d : '')); c ? pass++ : fail++; };
const port = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'ls_hruns_'));
const srv = spawn('python3', ['server.py', '--port', String(port)], { cwd: APP, env: { ...process.env, LABSPOTTER_HOSTED: '1', LABSPOTTER_RUNS: runs, LABSPOTTER_INVITE_CODE: 'let-me-in', MODEL_API_KEY: '' }, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { } await new Promise(r => setTimeout(r, 150)); }
try {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [tag, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
    const pg = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); const user = 'tester_' + tag;
    await pg.goto(`http://127.0.0.1:${port}/`); await pg.getByText('Our mission').waitFor({ timeout: 8000 });
    ok(tag + ' logged-out visitor sees Home with mission and who-by', /keep your place/i.test(await pg.locator('body').innerText()) && /Thomas Kim/.test(await pg.locator('body').innerText()));
    await pg.screenshot({ path: path.join(OUT, `${tag}_home.png`), fullPage: true });
    ok(tag + ' Home has no sign-in form, only buttons to it', (await pg.getByLabel('Password').count()) === 0);
    await pg.getByRole('button', { name: 'Sign in' }).first().click(); await pg.screenshot({ path: path.join(OUT, `${tag}_login.png`) });
    await pg.getByRole('button', { name: 'New here? Create an account' }).click();
    await pg.getByLabel('Username').fill(user); await pg.getByLabel('Password').fill('correct horse battery'); await pg.getByLabel('Invite code').fill('wrong');
    await pg.getByRole('button', { name: 'Create account' }).click(); await pg.waitForTimeout(600);
    ok(tag + ' wrong invite code is refused with a message', /invite/i.test(await pg.locator('.acct-err').innerText().catch(() => '')));
    await pg.getByLabel('Invite code').fill('let-me-in'); await pg.getByRole('button', { name: 'Create account' }).click(); await pg.waitForTimeout(1200);
    ok(tag + ' signed in and the app shows', (await pg.locator('.acct-strip').innerText().catch(() => '')).includes(user));
    const g = pg.getByRole('button', { name: /Follow a written guide/ }).first(); if (await g.count()) await g.click().catch(() => { });
    await pg.getByRole('button', { name: 'Try the water example' }).click(); await pg.waitForTimeout(900);
    ok(tag + ' guide runs with the account session, no token typed', (await pg.getByRole('button', { name: 'Correct' }).count()) > 0);
    if (process.env.LABSPOTTER_REAL_E2E === '1' && tag === 'desk') {
      await pg.setInputFiles('input[type=file][accept="video/mp4"]', path.join(APP, 'demo_clips', 'Stir_step.mp4'));
      await pg.locator('.as-label').first().waitFor({ timeout: 60000 }).catch(async () => { console.log('DEBUG', (await pg.locator('body').innerText()).slice(0, 700).replace(/\n/g, ' | ')); });
      ok(tag + ' REAL encoder suggestion on the hosted build behind the account, marked not confirmed', (await pg.locator('.as-label').count()) > 0 && /not confirmed/i.test(await pg.locator('body').innerText()));
      const ud = fs.readdirSync(path.join(runs, 'users')); const mine = ud.map(u => path.join(runs, 'users', u, 'runs')).filter(d => fs.existsSync(d) && fs.readdirSync(d).length);
      ok(tag + ' the run was stored under that user only', mine.length === 1, mine.length + ' user folder(s) with runs');
      const rtag = fs.readdirSync(mine[0]).find(n => !n.startsWith('.'));
      const mk = await b.newContext({ viewport: { width: 800, height: 600 } }); const p2 = await mk.newPage(); await p2.goto(`http://127.0.0.1:${port}/`);
      const other = await p2.evaluate(async ([t]) => { const j = async (u, b) => (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })); await j('/api/auth/signup', { username: 'other_user', password: 'correct horse battery', invite: 'let-me-in' }); const r = await fetch('/api/runs/' + t); return r.status; }, [rtag]);
      ok(tag + ' a second account cannot open that run', other === 404, 'status ' + other);
      const own = await pg.evaluate(async t => (await fetch('/api/runs/' + t)).status, rtag);
      ok(tag + ' the owner can open it', own === 200, 'status ' + own);
      await mk.close();
    }
    await pg.getByRole('button', { name: 'Correct' }).first().click(); await pg.waitForTimeout(400);
    await pg.locator('input.as-input').first().fill('Hosted note'); await pg.getByRole('button', { name: 'Save note' }).first().click(); await pg.waitForTimeout(600);
    await pg.screenshot({ path: path.join(OUT, `${tag}_app.png`) });
    await pg.getByRole('button', { name: 'Pause and save my place' }).first().click(); await pg.waitForTimeout(1500);
    ok(tag + ' pause saved under the account', /Paused/.test(await pg.locator('body').innerText()));
    await pg.reload(); await pg.waitForTimeout(1200);
    ok(tag + ' reload keeps the sign-in', (await pg.locator('.acct-strip').innerText().catch(() => '')).includes(user));
    await pg.getByRole('button', { name: 'Settings' }).click(); await pg.waitForTimeout(500); await pg.screenshot({ path: path.join(OUT, `${tag}_settings.png`) });
    ok(tag + ' Settings shows account, password change and delete', /Change password/.test(await pg.locator('body').innerText()) && /Delete my account/.test(await pg.locator('body').innerText()));
    await pg.getByRole('button', { name: 'Sign out' }).click(); await pg.waitForTimeout(600);
    ok(tag + ' sign out returns to Home', (await pg.getByText('Our mission').count()) > 0);
  }
  await b.close();
} finally { srv.kill(); }
console.log(`HOSTED E2E: ${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0);
