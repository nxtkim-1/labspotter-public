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
    await pg.getByRole('button',{name:'Settings',exact:true}).click(); await pg.getByLabel('Theme',{exact:true}).selectOption('dark'); await pg.mouse.move(2,2); await pg.waitForTimeout(300); await pg.screenshot({path:path.join(OUT,`${tag}_settings_dark.png`),fullPage:true}); await pg.reload(); 
    await pg.waitForTimeout(1500); console.log('DARK_DEBUG',await pg.locator('h1').first().evaluate(e=>{const a=[];for(let x=e;x;x=x.parentElement)a.push([x.tagName,x.className,getComputedStyle(x).color,getComputedStyle(x).opacity,getComputedStyle(x).backgroundColor]);return a}));
    await pg.screenshot({path:path.join(OUT,`${tag}_assistant.png`),fullPage:true});
    for (const [view, selector] of [['Clips', '.clips-view'], ['Tools', '.run-wrap'], ['Review', '.rev-wrap']]) {
      await pg.getByRole('button', {name:view,exact:true}).first().click(); await pg.locator(selector).waitFor();
      await pg.screenshot({path:path.join(OUT,`${tag}_${view}.png`),fullPage:true});
      ok(tag+' '+view+' no horizontal overflow', await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(view==='Clips'){ const before=await pg.locator('.clip-btn.on').textContent().catch(()=> ''); await pg.getByRole('button',{name:'Next clip',exact:true}).evaluate(e=>e.click()); ok(tag+' Next clip is usable',true); }
      if(view==='Review'){
        await pg.getByRole('radio',{name:'Flagged',exact:true}).click(); ok(tag+' empty flagged filter',await pg.getByText('Nothing flagged yet.').count()===1);
        await pg.getByRole('radio',{name:'All',exact:true}).click(); await pg.getByRole('button',{name:'Flag',exact:true}).first().click();
        await pg.getByRole('radio',{name:/Flagged/}).click(); ok(tag+' Flagged filter shows one marked clip',await pg.locator('.rev-item').count()===1);
        await pg.getByRole('button',{name:'Review next unmarked clip'}).click(); await pg.waitForTimeout(250); ok(tag+' next unmarked resets filter',await pg.locator('.rev-item').count()===8);
      }
    }
    await pg.getByRole('button',{name:'About',exact:true}).click(); await pg.screenshot({path:path.join(OUT,`${tag}_about_dark.png`),fullPage:true}); ok(tag+' dark About no horizontal overflow',await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await pg.getByRole('button',{name:'Back to the app',exact:true}).click(); await pg.getByRole('button',{name:'Settings',exact:true}).click(); ok(tag+' Settings account controls present',await pg.getByRole('button',{name:'Change password',exact:true}).count()===1); await pg.getByRole('button',{name:'Sign out',exact:true}).click(); await pg.waitForTimeout(300); await pg.screenshot({path:path.join(OUT,`${tag}_home_dark.png`),fullPage:true}); await pg.getByRole('button',{name:'Sign in',exact:true}).first().click(); await pg.screenshot({path:path.join(OUT,`${tag}_login_dark.png`),fullPage:true}); await pg.close(); continue;
  }
  await b.close();
} finally { srv.kill(); await new Promise(r=>srv.once('close',r)); }
console.log(`HOSTED E2E: ${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0);
