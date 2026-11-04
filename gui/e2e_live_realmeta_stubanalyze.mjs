// TEST STUB: not the real backend. Mimics server.py contract (health/analyze/runs) to regression-test the v2 GUI.
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright-core');
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const here=path.dirname(fileURLToPath(import.meta.url)); const CLIP=path.join(here,'..','demo_clips','Stir_step.mp4');
const SHOTS=fs.mkdtempSync(path.join(os.tmpdir(),'ls_e2e_stub_')); // screenshots
const root=process.env.DIST||path.join(here,'dist'); const TOKEN='test-stub-token'; const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.mp4':'video/mp4','.jpg':'image/jpeg','.ttf':'font/ttf','.woff2':'font/woff2'};
const DELAY=+process.env.DELAY||12000; const busySeen={}; const runs={}; let glLog=[], glCalls=0, cps=[], inflight=0, maxInflight=0, analyzeCalls=0, dropNext=false, sawTokenHeader=[], statics=0;
const J=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];
 if(u.startsWith('/api/')){ const tok=q.headers['x-labspotter-token']; sawTokenHeader.push(u+':'+(tok?'tok':'none'));
  if(u==='/api/health'){ if(tok!==TOKEN) return J(r,200,{status:'up',deps_ok:true,auth:'X-LabSpotter-Token required'}); return J(r,200,{status:'up',head:'TEST STUB head',encoder:'stub-encoder',requires:'test stub only',deps:{cuda:false},deps_ok:true}); }
  if(tok!==TOKEN) return J(r,401,{error:'token required'});
  const m=/^\/api\/runs\/([\w.-]+)$/.exec(u); if(m){ return runs[m[1]]?J(r,200,runs[m[1]]):J(r,404,{error:'not found'}); }
  if(u==='/api/detections') return J(r,200,{});
  if(u==='/api/agent/glimpse'){ glCalls++; const ch=[]; q.on('data',d=>ch.push(d)); q.on('end',async()=>{ const t0=Date.now(); try{ const rr=await fetch('http://127.0.0.1:8796/api/agent/glimpse',{method:'POST',headers:{'X-LabSpotter-Token':'gl-token','Content-Type':q.headers['content-type']||'video/webm'},body:Buffer.concat(ch)}); const bj=await rr.json().catch(()=>({})); glLog.push({status:rr.status,secs:(Date.now()-t0)/1000,text:(bj.text||bj.message||'').slice(0,120)}); J(r,rr.status,bj);}catch(e){ glLog.push({err:String(e).slice(0,80)}); J(r,502,{error:'x'}); } }); return; }
  if(u==='/api/analyze'){ const tag=new URL(q.url,'http://x').searchParams.get('tag'); let n=0; q.on('data',d=>n+=d.length); q.on('end',()=>{ analyzeCalls++; inflight++; maxInflight=Math.max(maxInflight,inflight); setTimeout(()=>{ inflight--; reply(); },DELAY); function reply(){
    if(tag.startsWith('busy1') && !busySeen[tag]){ busySeen[tag]=1; return J(r,503,{error:'busy'}); }
    if(tag.startsWith('drop1')){ runs[tag]=mk(tag); q.socket.destroy(); return; }
    if(runs[tag]) return J(r,409,{error:'tag exists'});
    runs[tag]=mk(tag); J(r,200,runs[tag]); } }); return; }
  if(u==='/api/bench/session'&&q.method==='POST'){ q.resume(); return J(r,200,{session_id:'s1'}); }
  if(/\/claim$/.test(u)){ q.resume(); cps.push({notes:['claim: Add_step']}); return J(r,200,{session_id:'s1',checkpoint:cps[cps.length-1]}); }
  if(u==='/api/bench/session/s1') return J(r,200,{session_id:'s1',checkpoints:cps});
  if(u==='/api/bench/sessions') return J(r,200,{sessions:[]});
  return J(r,404,{error:'not found'}); }
 let f=path.join(root,u==='/'?'/index.html':u); if(!fs.existsSync(f)){r.statusCode=404;return r.end()} const st=fs.statSync(f);const t=types[path.extname(f)]||'application/octet-stream';const rg=q.headers.range;
 if(rg){const mm=/bytes=(\d*)-(\d*)/.exec(rg);const s=+mm[1]||0,e=mm[2]?+mm[2]:st.size-1;r.writeHead(206,{'Content-Type':t,'Content-Range':`bytes ${s}-${e}/${st.size}`,'Accept-Ranges':'bytes','Content-Length':e-s+1});fs.createReadStream(f,{start:s,end:e}).pipe(r)} else {r.writeHead(200,{'Content-Type':t,'Content-Length':st.size,'Accept-Ranges':'bytes'});fs.createReadStream(f).pipe(r)}});
await new Promise((res,rej)=>{srv.once('error',rej); srv.listen(0,'127.0.0.1',res)}); const PORT=srv.address().port; // ephemeral port
// The 8 class labels of this package's heads (same strings as gui/src/data.ts and DEV_RESULTS_1427.md); probs sum to 1 and agree with top3.
const PROBS={'MeasureLiquid step':0.47,'Add step':0.2,'Stir step':0.1,'No action':0.08,'PhaseSeparation step':0.06,'CollectLayer step':0.05,'MeasureSolid step':0.03,'AnalyticalMeasurement step':0.01};
const mk=tag=>({predictions:[{clip:'up.mp4',t:0,decoded_frames:16,top3:[['MeasureLiquid step',0.47],['Add step',0.2],['Stir step',0.1]],probs:{...PROBS}}],facts:[],result:{alert:'act-'+tag+' pending_review'}});
// older stored run format: top3 only, no probs (GUI must show 3 rows plus the fallback note)
const FAKE=process.env.FAKE;
const b=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+FAKE]});
const ctx=await b.newContext({viewport:{width:390,height:800},permissions:['camera']}); const pg=await ctx.newPage(); const errs=[]; pg.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,200))}); pg.on('request',r=>{if(r.url().includes('/api/'))console.log('REQ',r.method(),r.url().replace(/.*\/api/,'/api'))}); pg.on('pageerror',e=>errs.push(String(e)));
await pg.goto('http://127.0.0.1:'+PORT+'/'); await pg.locator('input[type=password]').first().fill(TOKEN); await pg.keyboard.press('Enter'); await pg.waitForTimeout(800);
console.log('secure',await pg.evaluate(()=>window.isSecureContext),'goLive',await pg.getByRole('button',{name:'Go live'}).count());
await pg.screenshot({path:SHOTS+'/l0.png'});
await pg.getByRole('button',{name:'Go live'}).click(); await pg.waitForTimeout(1500); await pg.screenshot({path:SHOTS+'/l1.png'});
await pg.waitForTimeout(42000); await pg.screenshot({path:SHOTS+'/l2.png'});
const txt=await pg.locator('body').innerText(); console.log(JSON.stringify(sawTokenHeader.filter(x=>x.includes('glimpse')).slice(0,3)));console.log('GLIMPSE_LOG',JSON.stringify(glLog));console.log('analyze',analyzeCalls,'glimpse',glCalls,'maxInflight',maxInflight,'skippedNote',/skipped/.test(txt),'quickLook',/quick look[\s\S]*powered by meta/i.test(txt));
await pg.getByRole('button',{name:'Pause and save my place'}).first().click().catch(()=>{}); await pg.waitForTimeout(500); const a0=analyzeCalls,g0=glCalls; await pg.waitForTimeout(14000);
console.log('after pause: new analyze',analyzeCalls-a0,'new glimpse',glCalls-g0);
console.log('errors',JSON.stringify(errs),'shots',SHOTS); await b.close(); srv.close(); process.exit(0);
