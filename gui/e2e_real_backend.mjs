// GUI test against the REAL backend: server.py from app/ with the real V-JEPA2 encoder (no stub).
// Opt-in: LABSPOTTER_REAL_E2E=1 node gui/e2e_real_backend.mjs   (CHROME, PYTHON override the defaults)
// With the variable set, every missing dependency or runtime error is a FAIL (exit 1), never a skip.
import { createRequire } from 'module'; import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto'; import fs from 'fs'; import net from 'net'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
if (process.env.LABSPOTTER_REAL_E2E !== '1') {
 console.log('REAL BACKEND E2E: SKIP (set LABSPOTTER_REAL_E2E=1; needs torch, transformers, pillow, ffmpeg, cached or downloadable V-JEPA2 weights, about 4 GB RAM)');
 process.exit(0);
}
const here=path.dirname(fileURLToPath(import.meta.url)); const APP=path.join(here,'..');
const CLIP=path.join(APP,'demo_clips','Add_step.mp4'); const DIST=path.join(here,'dist');
const CHROME=process.env.CHROME||'/usr/bin/google-chrome'; const PY=process.env.PYTHON||'python3';
const HEALTH_TIMEOUT_MS=180000, ANALYZE_TIMEOUT_MS=10*60000;
const TOKEN=crypto.randomBytes(24).toString('base64url'); // passed only via the LABSPOTTER_TOKEN env var, never printed
const res=[]; const ok=(n,c,d='')=>{const line=(c?'PASS ':'FAIL ')+n+(d?' - '+d:''); res.push(line); console.log(line)};
const redact=s=>String(s).split(TOKEN).join('<token>');
const freePort=()=>new Promise((r,j)=>{const s=net.createServer(); s.once('error',j); s.listen(0,'127.0.0.1',()=>{const p=s.address().port; s.close(()=>r(p))})});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let b=null, srv=null, srvLog='', runsDir=null;
const killSrv=()=>{ if (srv && srv.exitCode===null && srv.signalCode===null) { try { srv.kill('SIGTERM'); } catch { } } };
process.on('exit',killSrv); // last resort: a crash must never orphan server.py
try {
 // dependencies: each missing one is a FAIL
 let chromium=null; try { ({ chromium } = createRequire(import.meta.url)('playwright-core')); } catch { }
 const deps=[['playwright-core',!!chromium],['Chrome at '+CHROME,fs.existsSync(CHROME)],['built GUI at '+DIST,fs.existsSync(path.join(DIST,'index.html'))],
  ['python ('+PY+')',spawnSync(PY,['--version']).status===0],['ffmpeg on PATH',spawnSync('ffmpeg',['-version']).status===0],['demo clip '+CLIP,fs.existsSync(CLIP)]];
 for (const [n,present] of deps) ok('dependency: '+n,present);
 if (deps.some(([,p])=>!p)) throw new Error('missing dependencies (see FAIL lines above)');
 // real backend on a free 127.0.0.1 port, temporary run storage
 const port=await freePort(); const base=`http://127.0.0.1:${port}`;
 runsDir=fs.mkdtempSync(path.join(os.tmpdir(),'ls_real_e2e_runs_'));
 srv=spawn(PY,['server.py','--port',String(port),'--host','127.0.0.1'],{cwd:APP,env:{...process.env,LABSPOTTER_TOKEN:TOKEN,LABSPOTTER_RUNS:runsDir,PYTHONUNBUFFERED:'1'},stdio:['ignore','pipe','pipe']});
 srv.stdout.on('data',d=>srvLog+=d); srv.stderr.on('data',d=>srvLog+=d);
 let up=false; const t0=Date.now();
 while (!up && Date.now()-t0<HEALTH_TIMEOUT_MS && srv.exitCode===null) { try { up=(await fetch(base+'/api/health')).ok; } catch { } if(!up) await sleep(1000); }
 ok('server.py /api/health up',up,up?'':'not up after '+Math.round((Date.now()-t0)/1000)+' s (exit code '+srv.exitCode+')');
 if (!up) throw new Error('backend did not start');
 // GUI: Run view, token, clip, unique tag, Analyze
 b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
 const pg=await b.newPage({viewport:{width:1440,height:940}}); const perr=[]; pg.on('pageerror',e=>perr.push(String(e)));
 await pg.goto(base+'/'); await pg.waitForTimeout(800);
 await pg.locator('#rail .rail-item').nth(1).click(); await pg.waitForTimeout(500);
 await pg.locator('input[placeholder^="session token"]').fill(TOKEN); await pg.getByRole('button',{name:'Connect'}).click(); await pg.waitForTimeout(1500);
 const depsOk=(await pg.getByText('Backend dependencies present').count())>0;
 let health='';
 if (!depsOk) { try { const r=await fetch(base+'/api/health',{headers:{'X-LabSpotter-Token':TOKEN}}); health='/api/health '+r.status+': '+redact((await r.text()).slice(0,1500)); } catch (e) { health='/api/health fetch failed: '+redact(e && e.message ? e.message : e); } }
 ok('token connect shows Backend dependencies present',depsOk,health);
 if (!depsOk) throw new Error('backend lacks encoder dependencies (torch/transformers/pillow) - Analyze stays disabled; install them for '+PY+' and rerun');
 await pg.locator('input[type=file][accept="video/mp4"]').setInputFiles(CLIP);
 const tag='realE2E-'+Date.now().toString(36);
 await pg.locator('.bk-row:has(span:text-is("run tag")) input').fill(tag);
 // Capture the reply body via a pass-through route: Chrome can evict a large upload's response from the DevTools
 // cache, so resp.json() fails with 'Request content was evicted from inspector cache'.
 let routedBody=null, routeErr='';
 await pg.route('**/api/analyze**', async route => { try { const r=await route.fetch({timeout:ANALYZE_TIMEOUT_MS}); const buf=await r.body();
  try { routedBody=JSON.parse(buf.toString('utf8')); } catch { routeErr='reply body is not JSON'; } await route.fulfill({response:r, body:buf}); }
  catch (e) { routeErr='pass-through fetch failed: '+redact(e && e.message ? e.message : e); await route.abort().catch(()=>{}); } });
 const respP=pg.waitForResponse(r=>r.url().includes('/api/analyze'),{timeout:ANALYZE_TIMEOUT_MS});
 respP.catch(()=>{}); // never an unhandled rejection if the click below fails and the browser closes
 const ta=Date.now(); await pg.getByRole('button',{name:/Analyze clip/}).click();
 const resp=await respP; const body=routedBody, bodyErr=routeErr;
 ok('/api/analyze returned 200',resp.status()===200,'status '+resp.status()+' after '+Math.round((Date.now()-ta)/1000)+' s'+(body&&body.error?' - '+body.error:''));
 const probs=body&&body.predictions&&body.predictions[0]&&body.predictions[0].probs;
 const nBackend=probs?Object.keys(probs).length:0;
 ok('BACKEND: /api/analyze predictions[0].probs has 8 classes',nBackend===8,'backend returned '+nBackend+(bodyErr?' - '+bodyErr:''));
 // independent of the browser: read the saved run back over the API (token in the header only)
 let nStored=0, storedErr=''; try { const r=await fetch(base+'/api/runs/'+tag,{headers:{'X-LabSpotter-Token':TOKEN}}); const j=await r.json(); const sp=j&&j.predictions&&j.predictions[0]&&j.predictions[0].probs; nStored=sp?Object.keys(sp).length:0; if(!r.ok) storedErr='status '+r.status; } catch (e) { storedErr=redact(e && e.message ? e.message : e); }
 ok('BACKEND: saved run /api/runs/<tag> predictions[0].probs has 8 classes',nStored===8,'saved run has '+nStored+(storedErr?' - '+storedErr:''));
 await pg.getByText('Uploaded clip - live result').waitFor({timeout:30000}).catch(()=>{});
 const shown=await pg.getByText('Uploaded clip - live result').count()>0;
 ok('GUI shows the live result',shown);
 // gui/src/BackendPanel.tsx renders one .bk-row per entry of p.probs (gui/src/probs.ts), so this check is
 // expected to PASS with all 8 class probabilities. Do not weaken it to 3.
 const nGui=await pg.locator('.bk-result').first().locator('.bk-pred').first().locator('.bk-row').count();
 ok('GUI: 8 class probabilities shown',nGui===8,'GUI shows '+nGui+' rows, backend returned '+nBackend);
 const chip=await pg.locator('.run-chip').textContent().catch(()=>'') || ''; // textContent, not innerText: CSS uppercases the chip on screen
 ok('GUI shows "unvalidated" label for this run',chip.includes('Uploaded clip - '+tag)&&chip.includes('unvalidated'),'run chip: '+chip);
 const shotPath=path.join(os.tmpdir(),tag+'_result.png'); await pg.screenshot({path:shotPath,fullPage:true}).catch(()=>{}); console.log('screenshot: '+shotPath);
 ok('no page JS errors',perr.length===0,JSON.stringify(perr));
} catch (e) {
 ok('real backend run completed without an error',false,redact(e && e.message ? e.message : e));
} finally {
 killSrv();
 if (b) await b.close().catch(()=>{});
 try { if (runsDir) fs.rmSync(runsDir,{recursive:true,force:true}); } catch { }
}
const nf=res.filter(x=>x.startsWith('FAIL')).length;
if (nf>0 && srvLog) console.log('server log (last 2000 chars):\n'+redact(srvLog.slice(-2000)));
console.log(`REAL BACKEND E2E: ${res.length-nf} PASS, ${nf} FAIL`);
if (nf>0||res.length===0) process.exitCode=1;
