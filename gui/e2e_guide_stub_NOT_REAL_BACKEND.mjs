// TEST STUB: not the real backend. Mimics server.py contract (health/analyze/runs) to regression-test the v2 GUI.
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright-core');
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const here=path.dirname(fileURLToPath(import.meta.url)); const CLIP=path.join(here,'..','demo_clips','Stir_step.mp4');
const SHOTS=fs.mkdtempSync(path.join(os.tmpdir(),'ls_e2e_stub_')); // screenshots
const root=process.env.DIST||path.join(here,'dist'); const TOKEN='test-stub-token'; const types={'.svg':'image/svg+xml','.html':'text/html','.js':'text/javascript','.css':'text/css','.mp4':'video/mp4','.jpg':'image/jpeg','.ttf':'font/ttf','.woff2':'font/woff2'};
const DELAY=+process.env.DELAY||12000; const busySeen={}; const runs={}; let glCalls=0, cps=[], inflight=0, maxInflight=0, analyzeCalls=0, dropNext=false, sawTokenHeader=[], statics=0;
const J=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];
 if(u.startsWith('/api/')){ const tok=q.headers['x-labspotter-token']; sawTokenHeader.push(u+':'+(tok?'tok':'none'));
  if(u==='/api/health'){ if(tok!==TOKEN) return J(r,200,{status:'up',deps_ok:true,auth:'X-LabSpotter-Token required'}); return J(r,200,{status:'up',head:'TEST STUB head',encoder:'stub-encoder',requires:'test stub only',deps:{cuda:false},deps_ok:true}); }
  if(tok!==TOKEN) return J(r,401,{error:'token required'});
  const m=/^\/api\/runs\/([\w.-]+)$/.exec(u); if(m){ return runs[m[1]]?J(r,200,runs[m[1]]):J(r,404,{error:'not found'}); }
  if(u==='/api/detections') return J(r,200,{});
  if(u==='/api/agent/glimpse'){ glCalls++; let n=0; q.on('data',d=>n+=d.length); q.on('end',()=>setTimeout(()=>J(r,200,{text:'Gloved hands hold a flask. (stub)'}),1500)); return; }
  if(u==='/api/analyze'){ const tag=new URL(q.url,'http://x').searchParams.get('tag'); let n=0; q.on('data',d=>n+=d.length); q.on('end',()=>{ analyzeCalls++; inflight++; maxInflight=Math.max(maxInflight,inflight); setTimeout(()=>{ inflight--; reply(); },DELAY); function reply(){
    if(tag.startsWith('busy1') && !busySeen[tag]){ busySeen[tag]=1; return J(r,503,{error:'busy'}); }
    if(tag.startsWith('drop1')){ runs[tag]=mk(tag); q.socket.destroy(); return; }
    if(runs[tag]) return J(r,409,{error:'tag exists'});
    runs[tag]=mk(tag); J(r,200,runs[tag]); } }); return; }
  if(u==='/api/bench/session'&&q.method==='POST'){ q.resume(); return J(r,200,{session_id:'s1'}); }
  if(/\/claim$/.test(u)){ q.resume(); cps.push({notes:['claim: Add_step']}); return J(r,200,{session_id:'s1',checkpoint:cps[cps.length-1]}); }
  if(/\/note$/.test(u)){ let b=''; q.on('data',d=>b+=d); q.on('end',()=>{ const j=JSON.parse(b); cps.push({id:'c'+cps.length,notes:[j.text],evidence:[{kind:'user_'+j.kind}],step:'x',hash:'h',t:1}); J(r,200,{session_id:'s1',checkpoint:cps[cps.length-1]}); }); return; }
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

const b=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
const pg=await (await b.newContext({viewport:{width:390,height:800}})).newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(String(e))); let pass=0,fail=0; const ok=(n,c)=>{c?pass++:fail++; console.log(c?'PASS':'FAIL',n)};
await pg.goto('http://127.0.0.1:'+PORT+'/'); await pg.locator('input[type=password]').first().fill(TOKEN); await pg.keyboard.press('Enter'); await pg.waitForTimeout(800);
await pg.getByText('Follow a written guide').click(); await pg.getByRole('button',{name:'Try the water example'}).click(); await pg.waitForTimeout(800);
ok('guide loaded',await pg.getByText('Pour about 50 mL').count()>0);
await pg.getByRole('button',{name:'Correct'}).first().click(); await pg.waitForTimeout(500); await pg.getByRole('button',{name:'Correct'}).first().click(); await pg.waitForTimeout(500);
ok('two steps ticked by tap',await pg.getByText('You did this').count()===2);
ok('notes saved: 1 protocol_loaded + 2 learner_confirmed',cps.filter(c=>c.evidence[0].kind==='user_protocol_loaded').length===1&&cps.filter(c=>c.evidence[0].kind==='user_learner_confirmed').length===2);
await pg.screenshot({path:SHOTS+'/g1.png',fullPage:true});
const t=await pg.locator('body').innerText(); ok('no verified/accepted/approved wording',!/verified|accepted|approved/i.test(t));
ok('no page errors',errs.length===0);
console.log('GUIDE (stub)',pass,'PASS',fail,'FAIL',SHOTS); await b.close(); srv.close(); process.exit(0);
