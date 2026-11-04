import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright-core');
const PORT=process.env.PORT, TOKEN=process.env.TOK; let fails=0; const ok=(n,c)=>{console.log((c?'PASS ':'FAIL ')+n); if(!c)fails++};
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:390,height:800}}); const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(String(e))); const agent=[]; pg.on('request',r=>{if(r.url().includes('/api/agent'))agent.push(r.url().replace(/.*\/api/,'/api').replace(/session=.*/,'session=…'))});
// health NOT faked: real /api/health (torch missing in this environment)
const login=async()=>{await pg.goto('http://127.0.0.1:'+PORT+'/'); await pg.locator('input[type=password]').first().fill(TOKEN); await pg.keyboard.press('Enter'); await pg.waitForTimeout(1200)};
await login();
if(await pg.getByRole('button',{name:'Follow a written guide',exact:true}).count()>0) await pg.getByRole('button',{name:'Follow a written guide',exact:true}).click(); else await pg.getByRole('button',{name:'Follow a written guide, step by step'}).click(); await pg.getByRole('button',{name:'Try the water example'}).click(); await pg.waitForTimeout(900);
await pg.getByRole('button',{name:'Correct'}).first().click(); await pg.waitForTimeout(500); await pg.getByRole('button',{name:'Correct'}).first().click(); await pg.waitForTimeout(500);
ok('two steps ticked',await pg.getByText('You did this').count()===2);
await pg.locator('input.as-input').first().fill('Synthetic note: tube two looked cloudy.'); await pg.getByRole('button',{name:'Save note'}).click(); await pg.waitForTimeout(800);
await pg.getByRole('button',{name:'Pause and save my place'}).first().click(); await pg.waitForTimeout(2500);
const kick=await pg.locator('.as-ai-kicker').first().innerText().catch(()=>'NONE'); const rec=await pg.locator('.as-recap-list').first().innerText().catch(()=>'NONE');
ok('paused recap card shown (local fallback, no key)',/Summary of your saved entries/.test(kick)); console.log('RECAP:',rec.slice(0,300)); ok('recap mentions note',/cloudy/i.test(rec)||/note/i.test(rec)); ok('no Powered by Meta on fallback',await pg.locator('.as-powered').count()===0);
await pg.screenshot({path:'/downloads/ui/notorch_guideonly_paused.png'});
await pg.getByRole('button',{name:'Resume'}).first().click(); await pg.waitForTimeout(800); ok('after Resume, steps still shown ticked',await pg.getByText('You did this').count()===2);
await login(); const rows=await pg.getByText('Guided session').count(); ok('recent list shows the guided session after reload',rows>0);
if(rows>0){ await pg.getByText('Guided session').first().click(); await pg.waitForTimeout(2500); ok('resume shows recap card',await pg.locator('.as-recap-list').count()>0); await pg.screenshot({path:'/downloads/ui/notorch_guideonly_resumed.png'}); await pg.getByRole('button',{name:'Resume'}).first().click(); await pg.waitForTimeout(800); ok('after resume + Continue, 2 ticked steps restored',await pg.getByText('You did this').count()===2); }
console.log('agent requests',JSON.stringify(agent)); ok('no page errors',errs.length===0); console.log('FAILS',fails); await b.close();
