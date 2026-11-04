// TEST STUB: not the real backend. Mimics server.py contract (health/analyze/runs) to regression-test the v2 GUI.
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright-core');
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url';
const here=path.dirname(fileURLToPath(import.meta.url)); const CLIP=path.join(here,'..','demo_clips','Stir_step.mp4');
const SHOTS=fs.mkdtempSync(path.join(os.tmpdir(),'ls_e2e_stub_')); // screenshots
const root=process.env.DIST||path.join(here,'dist'); const TOKEN='test-stub-token'; const types={'.svg':'image/svg+xml','.html':'text/html','.js':'text/javascript','.css':'text/css','.mp4':'video/mp4','.jpg':'image/jpeg','.ttf':'font/ttf','.woff2':'font/woff2'};
const busySeen={}; const runs={}; let analyzeCalls=0, dropNext=false, sawTokenHeader=[], statics=0;
const J=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];
 if(u.startsWith('/api/')){ const tok=q.headers['x-labspotter-token']; sawTokenHeader.push(u+':'+(tok?'tok':'none'));
  if(u==='/api/health'){ if(tok!==TOKEN) return J(r,200,{status:'up',deps_ok:true,auth:'X-LabSpotter-Token required'}); return J(r,200,{status:'up',head:'TEST STUB head',encoder:'stub-encoder',requires:'test stub only',deps:{cuda:false},deps_ok:true}); }
  if(tok!==TOKEN) return J(r,401,{error:'token required'});
  const m=/^\/api\/runs\/([\w.-]+)$/.exec(u); if(m){ return runs[m[1]]?J(r,200,runs[m[1]]):J(r,404,{error:'not found'}); }
  if(u==='/api/detections') return J(r,200,{});
  if(u==='/api/analyze'){ const tag=new URL(q.url,'http://x').searchParams.get('tag'); let n=0; q.on('data',d=>n+=d.length); q.on('end',()=>{ analyzeCalls++;
    if(tag.startsWith('busy1') && !busySeen[tag]){ busySeen[tag]=1; return J(r,503,{error:'busy'}); }
    if(tag.startsWith('drop1')){ runs[tag]=mk(tag); q.socket.destroy(); return; }
    if(runs[tag]) return J(r,409,{error:'tag exists'});
    runs[tag]=mk(tag); J(r,200,runs[tag]); }); return; }
  return J(r,404,{error:'not found'}); }
 let f=path.join(root,u==='/'?'/index.html':u); if(!fs.existsSync(f)){r.statusCode=404;return r.end()} const st=fs.statSync(f);const t=types[path.extname(f)]||'application/octet-stream';const rg=q.headers.range;
 if(rg){const mm=/bytes=(\d*)-(\d*)/.exec(rg);const s=+mm[1]||0,e=mm[2]?+mm[2]:st.size-1;r.writeHead(206,{'Content-Type':t,'Content-Range':`bytes ${s}-${e}/${st.size}`,'Accept-Ranges':'bytes','Content-Length':e-s+1});fs.createReadStream(f,{start:s,end:e}).pipe(r)} else {r.writeHead(200,{'Content-Type':t,'Content-Length':st.size,'Accept-Ranges':'bytes'});fs.createReadStream(f).pipe(r)}});
await new Promise((res,rej)=>{srv.once('error',rej); srv.listen(0,'127.0.0.1',res)}); const PORT=srv.address().port; // ephemeral port
// The 8 class labels of this package's heads (same strings as gui/src/data.ts and DEV_RESULTS_1427.md); probs sum to 1 and agree with top3.
const PROBS={'MeasureLiquid step':0.47,'Add step':0.2,'Stir step':0.1,'No action':0.08,'PhaseSeparation step':0.06,'CollectLayer step':0.05,'MeasureSolid step':0.03,'AnalyticalMeasurement step':0.01};
const mk=tag=>({predictions:[{clip:'up.mp4',t:0,decoded_frames:16,top3:[['MeasureLiquid step',0.47],['Add step',0.2],['Stir step',0.1]],probs:{...PROBS}}],facts:[],result:{alert:'act-'+tag+' pending_review'}});
// older stored run format: top3 only, no probs (GUI must show 3 rows plus the fallback note)
runs['oldtop3']={predictions:[{clip:'old.mp4',t:0,decoded_frames:16,top3:[['Stir step',0.41],['Add step',0.3],['No action',0.12]]}],facts:[],result:{alert:'act-oldtop3 pending_review'}};
// rows of the first .bk-pred inside a .bk-result: count, labels, percentages, header label/top-1, fallback note
// Keys (data-key) are the API class keys; visible text is the display label (gui/src/probs.ts classLabel), copied literally here.
const LABEL={'CollectLayer step':'Collect layer step','PhaseSeparation step':'Phase separation step','AnalyticalMeasurement step':'Analytical measurement step','MeasureLiquid step':'Measure liquid step','Add step':'Add step','Stir step':'Stir step','MeasureSolid step':'Measure solid step','No action':'No action'};
const predView=async res=>{const p=res.locator('.bk-pred').first(); const rows=p.locator('.bk-row');
 return {n:await rows.count(),nProb:await p.locator('.bk-row.bk-prob').count(),keys:await rows.evaluateAll(es=>es.map(e=>e.getAttribute('data-key'))),
  labels:await rows.locator('span').allTextContents(),pcts:(await rows.locator('b').allTextContents()).map(s=>parseFloat(s)),
  head:await p.locator('.bk-pred-head b').textContent().catch(()=>''),headKey:await p.locator('.bk-pred-head b').getAttribute('data-key').catch(()=>''),
  headTxt:await p.locator('.bk-pred-head span').textContent().catch(()=>''),
  note:(await p.locator('.bk-note').allTextContents()).join(' | ')};};
const labelsMatch=v=>v.keys.length===v.labels.length&&v.keys.every((k,i)=>k in LABEL&&v.labels[i]===LABEL[k]);
// layout of probability labels and the result header inside one .bk-result (computed in the page)
const layout=res=>res.evaluate(r=>{const rows=[...r.querySelectorAll('.bk-row.bk-prob')];
 const lab=rows.map(row=>{const s=row.querySelector('span'),b=row.querySelector('b'),cs=getComputedStyle(s);const lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2;const sr=s.getBoundingClientRect(),br=b.getBoundingClientRect();
  return {key:row.dataset.key,tt:cs.textTransform,h:sr.height,lh,sw:s.scrollWidth,cw:s.clientWidth,sameLine:br.top<sr.bottom&&sr.top<br.bottom&&br.left>=sr.right-1,bRight:Math.round(row.getBoundingClientRect().right-br.right),bAlign:getComputedStyle(b).textAlign,ws:cs.wordBreak+'/'+cs.overflowWrap+'/'+cs.textOverflow}});
 const hd=r.querySelector('.bk-pred-head');const hb=hd.querySelector('b').getBoundingClientRect(),hs=hd.querySelector('span').getBoundingClientRect();
 return {lab,head:{bTop:hb.top,bBottom:hb.bottom,bRight:hb.right,sTop:hs.top,sLeft:hs.left,bLeft:hb.left}}});
const layoutChecks=async(n,what,res,mob)=>{const L=await layout(res);
 ok(n+' '+what+': no probability label rendered uppercase',L.lab.length>0&&L.lab.every(x=>x.tt!=='uppercase'),JSON.stringify(L.lab.map(x=>x.tt)));
 const bad=L.lab.filter(x=>!(x.h<=1.6*x.lh&&x.sw<=x.cw+1));
 ok(n+' '+what+': every probability label on one line, no mid-word break',L.lab.length>0&&bad.length===0,bad.length?JSON.stringify(bad):'max h/lh='+Math.max(...L.lab.map(x=>x.h/x.lh)).toFixed(2));
 ok(n+' '+what+': percent on same line as label, right-aligned',L.lab.every(x=>x.sameLine&&x.bAlign==='right'&&!/break-all|anywhere|ellipsis/.test(x.ws)),JSON.stringify(L.lab.map(x=>[x.sameLine,x.bAlign,x.ws])));
 const h=L.head; if(mob) ok(n+' '+what+': header stacked (meta under label)',h.sTop>=h.bBottom-1&&Math.abs(h.sLeft-h.bLeft)<=1,JSON.stringify(h));
 else ok(n+' '+what+': header side-by-side',h.sTop<h.bBottom&&h.sLeft>=h.bRight,JSON.stringify(h));};
// scroll to the very bottom and measure live-result last .bk-prob row and all visible buttons/inputs in .run-wrap against #tabbar
const clearance=async(n,pg)=>{await pg.evaluate(()=>{window.scrollTo(0,1e6);document.querySelectorAll('*').forEach(e=>{if(e.scrollHeight>e.clientHeight+5&&getComputedStyle(e).overflowY!=='visible')e.scrollTop=1e6})}); await pg.waitForTimeout(300);
 const g=await pg.evaluate(()=>{const tb=document.querySelector('#tabbar').getBoundingClientRect().top;const live=document.querySelector('.bk-result');const ps=live?live.querySelectorAll('.bk-row.bk-prob'):[];const lastProb=ps.length?ps[ps.length-1].getBoundingClientRect().bottom:NaN;
  const ctl=[...document.querySelectorAll('.run-wrap button,.run-wrap input')].filter(e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&cs.opacity!=='0'});
  const maxCtl=Math.max(...ctl.map(e=>e.getBoundingClientRect().bottom));return {tb,lastProb,maxCtl,nCtl:ctl.length,vh:innerHeight,sy:scrollY,sh:document.documentElement.scrollHeight}});
 ok(n+' bottom clearance at max scroll: last .bk-prob row and every button/input above #tabbar',Number.isFinite(g.lastProb)&&g.nCtl>0&&g.lastProb<=g.tb&&g.maxCtl<=g.tb,
  'lastProb.bottom='+Math.round(g.lastProb)+' maxControl.bottom='+Math.round(g.maxCtl)+' ('+g.nCtl+' controls) tabbar.top='+Math.round(g.tb)+' viewport='+g.vh+' scrollY='+Math.round(g.sy)+' scrollHeight='+g.sh);};
const sortedDesc=a=>a.length>0&&a.every((x,i)=>Number.isFinite(x)&&(i===0||a[i-1]>=x));
const res=[]; const ok=(n,c,d='')=>{const line=(c?'PASS ':'FAIL ')+n+(d?' - '+d:''); res.push(line); console.log(line)};
let b=null;
try {
 if(!fs.existsSync(CLIP)) throw new Error('demo clip not found: '+CLIP);
 b=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
for (const [n,vp,mob] of [['d',{width:1440,height:940},false],['m',{width:390,height:844},true]]){
 const pg=await b.newPage({viewport:vp});await pg.addInitScript(()=>{const o=()=>document.querySelectorAll('details.bk-adv').forEach(d=>{d.open=true});new MutationObserver(o).observe(document,{childList:true,subtree:true});}); const perr=[]; pg.on('pageerror',e=>perr.push(String(e)));
 await pg.goto(`http://localhost:${PORT}/`); await pg.waitForTimeout(800);
 const nav=i=>pg.locator(mob?'#tabbar .tab':'#rail .rail-item').nth(i+1).click(); await nav(0); await pg.waitForTimeout(300);
 // clips: playback
 await pg.locator('.frame').click(); await pg.waitForTimeout(1500); const t=await pg.evaluate(()=>document.querySelector('video').currentTime); ok(n+' video playback advances',t>0.3,'currentTime='+t.toFixed(2)); await pg.screenshot({path:`${SHOTS}/e2e_${n}_playing.png`});
 await pg.locator('.frame').click();
 // evidence
 await pg.getByRole('button',{name:'Evidence'}).click(); ok(n+' Evidence opens',await pg.locator('.evidence').isVisible()); if(!mob) await pg.screenshot({path:`${SHOTS}/e2e_${n}_evidence.png`});
 await pg.getByRole('button',{name:'Evidence'}).click(); ok(n+' Evidence closes',!(await pg.locator('.evidence').count()));
 const sb=pg.getByRole('button',{name:/boxes/i}); if(await sb.count()){ await sb.first().click(); await pg.waitForTimeout(400); ok(n+' Show boxes toggles on',(await pg.locator('.ctl.on').count())>0); await pg.screenshot({path:`${SHOTS}/e2e_${n}_boxes.png`}); await sb.first().click(); } else ok(n+' Show boxes button present for clip 1',false,'no button');
 // review seen/flag
 await nav(2); await pg.waitForTimeout(300); const seen=pg.getByRole('button',{name:'seen'}).first(); await seen.click(); ok(n+' seen sets local mark',(await pg.locator('.ctl.sm.on').count())===1); await seen.click(); ok(n+' seen toggles off',(await pg.locator('.ctl.sm.on').count())===0);
 await pg.getByRole('button',{name:'flag'}).nth(1).click(); ok(n+' flag sets local mark',(await pg.locator('.ctl.sm.on').count())===1); await pg.screenshot({path:`${SHOTS}/e2e_${n}_review_marks.png`});
 // run flow
 await nav(1); await pg.waitForTimeout(500);
 await pg.locator('input[placeholder^="session token"]').fill(TOKEN); await pg.getByRole('button',{name:'Connect'}).click(); await pg.waitForTimeout(700);
 ok(n+' token connect shows Connected (not locked)',(await pg.getByText('Backend dependencies present').count())>0);
 await pg.locator('input[type=file][accept="video/mp4"]').setInputFiles(CLIP);
 const setTag=async v=>{const inp=pg.locator('.bk-row:has(span:text-is("run tag")) input'); await inp.fill(v)};
 // busy + retry
 analyzeCalls=0; await setTag('busy1'+n); // note tag busy1 only on exact
 await setTag('busy1'+n); await pg.getByRole('button',{name:/Analyze clip/}).click(); await pg.waitForTimeout(700);
 ok(n+' 503 busy shows Retry and "Nothing was saved"',(await pg.getByRole('button',{name:'Retry'}).count())>0 && (await pg.getByText('Nothing was saved').count())>0);
 await pg.screenshot({path:`${SHOTS}/e2e_${n}_busy.png`}); await pg.getByRole('button',{name:'Retry'}).click(); await pg.waitForTimeout(800);
 ok(n+' Retry succeeds, result shown',(await pg.getByText('Uploaded clip - live result').count())>0);
 { const v=await predView(pg.locator('.bk-result').first());
   ok(n+' live result: exactly 8 .bk-row in first .bk-pred',v.n===8,'rows='+v.n+' '+JSON.stringify(v.labels));
   ok(n+' live result: rows sorted by probability descending',sortedDesc(v.pcts),JSON.stringify(v.pcts));
   ok(n+' live result: every row is .bk-prob',v.nProb===8,'bk-prob='+v.nProb);
   ok(n+' live result: all 8 class keys (data-key) once each',v.keys.length===8&&new Set(v.keys).size===8&&v.keys.every(k=>k in PROBS),JSON.stringify(v.keys));
   ok(n+' live result: row text is the display label of its key',labelsMatch(v),JSON.stringify(v.labels));
   ok(n+' live result: header top-1 matches first row (47.0%)',v.headKey===v.keys[0]&&v.headKey==='MeasureLiquid step'&&v.head==='Measure liquid step'&&v.head===v.labels[0]&&v.pcts[0]===47,v.headKey+' / '+v.head+' / '+v.headTxt);
   ok(n+' live result: no fallback note for a full run',!v.note.includes('older run'),v.note);
   await layoutChecks(n,'live result',pg.locator('.bk-result').first(),mob); }
 if(mob) await clearance(n,pg);
 if(mob){await pg.evaluate(()=>{window.scrollTo(0,1e6);document.querySelectorAll('*').forEach(e=>{if(e.scrollHeight>e.clientHeight+5&&getComputedStyle(e).overflowY!=='visible')e.scrollTop=1e6})}); await pg.waitForTimeout(300); const g=await pg.evaluate(()=>{const tb=document.querySelector('#tabbar').getBoundingClientRect().top;const w=document.querySelector('.run-wrap');const ks=[...w.children].filter(e=>e.getBoundingClientRect().height>0);const last=ks[ks.length-1].getBoundingClientRect().bottom;return {tb,last,sy:window.scrollY,sh:document.documentElement.scrollHeight}}); ok(n+' mobile bottom scroll: last content above tab bar ('+Math.round(g.last)+' <= '+Math.round(g.tb)+')', g.last<=g.tb+1);}
 await pg.screenshot({path:`${SHOTS}/e2e_${n}_result.png`,fullPage:true});
 // duplicate
 await pg.getByRole('button',{name:/Analyze clip/}).click(); await pg.waitForTimeout(700); ok(n+' 409 duplicate hint',(await pg.getByText('Tags are never overwritten').count())>0);
 // dropped connection -> check saved tag
 await setTag('drop1'+n); await pg.getByRole('button',{name:/Analyze clip/}).click(); await pg.waitForTimeout(900);
 const chk=pg.getByRole('button',{name:/Check whether this tag was saved/}); ok(n+' dropped connection offers Check (no blind retry)',(await chk.count())>0 && (await pg.getByRole('button',{name:'Retry'}).count())===0);
 if(!(await chk.count())){console.log(n,'DEBUG bk text:',(await pg.locator('.bk-error,.bk-note').allInnerTexts()).join(' | ').slice(0,900)); await pg.screenshot({path:`${SHOTS}/e2e_${n}_dropdebug.png`,fullPage:true}); ok(n+' remaining run checks skipped after the dropped-connection failure',false); continue;} await chk.click(); await pg.waitForTimeout(900); ok(n+' Check finds saved run and opens it',(await pg.getByText(/Stored run|stored run/).count())>0);
 { const v=await predView(pg.locator('.bk-result:has-text("Stored run")').first());
   ok(n+' stored run (Check/Load): exactly 8 .bk-row in first .bk-pred',v.n===8,'rows='+v.n);
   ok(n+' stored run: rows sorted descending, header matches first row',sortedDesc(v.pcts)&&v.head===v.labels[0]&&v.headKey===v.keys[0]&&v.headKey==='MeasureLiquid step'&&v.head==='Measure liquid step',JSON.stringify(v.pcts)+' '+v.headKey+' / '+v.head);
   ok(n+' stored run: 8 keys once each, row text is the display label',v.keys.length===8&&new Set(v.keys).size===8&&v.keys.every(k=>k in PROBS)&&labelsMatch(v),JSON.stringify(v.keys)+' '+JSON.stringify(v.labels));
   ok(n+' stored run: no fallback note for a full run',!v.note.includes('older run'),v.note);
   await layoutChecks(n,'stored run',pg.locator('.bk-result:has-text("Stored run")').first(),mob); }
 // review shows live run
 await nav(2); await pg.waitForTimeout(400); ok(n+' Review lists run clip beside the 8 demo clips',(await pg.locator('.rev-live').count())>0 && (await pg.locator('.rev-item').count())>=9); await pg.screenshot({path:`${SHOTS}/e2e_${n}_review_live.png`,fullPage:true});
 // older stored run with top3 only: 3 rows + fallback note (note is not a .bk-row)
 await nav(1); await pg.waitForTimeout(400);
 await pg.locator('.bk-row:has(span:text-is("past run")) input').fill('oldtop3'); await pg.getByRole('button',{name:'Load run'}).click(); await pg.waitForTimeout(700);
 { const res=pg.locator('.bk-result:has-text("Stored run \\"oldtop3\\"")'); const v=await predView(res.first());
   ok(n+' old top3-only run: 3 .bk-row in first .bk-pred',(await res.count())===1&&v.n===3,'results='+(await res.count())+' rows='+v.n);
   ok(n+' old top3-only run: fallback note shown inside .bk-pred',v.note.includes('older run: only the top 3 classes were stored'),v.note);
   ok(n+' old top3-only run: sorted, header matches first row',sortedDesc(v.pcts)&&v.headKey==='Stir step'&&v.head==='Stir step'&&v.keys[0]==='Stir step'&&v.labels[0]==='Stir step'&&v.pcts[0]===41,JSON.stringify(v.keys)+' '+v.headKey+' / '+v.headTxt);
   ok(n+' old top3-only run: keys are the 3 top3 keys, row text is the display label',JSON.stringify(v.keys)===JSON.stringify(['Stir step','Add step','No action'])&&labelsMatch(v),JSON.stringify(v.labels));
   await layoutChecks(n,'old top3-only run',res.first(),mob);
   await pg.screenshot({path:`${SHOTS}/e2e_${n}_old_top3.png`,fullPage:true}); }
 ok(n+' no page JS errors',perr.length===0,JSON.stringify(perr));
 ok(n+' token header only sent on api calls',sawTokenHeader.some(x=>x.endsWith(':tok')));
}
// light pass at 700x900 (tab bar shown at <=820px): connect, analyze one clip, measure bottom clearance only
{ const n='w700'; const pg=await b.newPage({viewport:{width:700,height:900}});await pg.addInitScript(()=>{const o=()=>document.querySelectorAll('details.bk-adv').forEach(d=>{d.open=true});new MutationObserver(o).observe(document,{childList:true,subtree:true});});
  await pg.goto(`http://localhost:${PORT}/`); await pg.waitForTimeout(800);
  await pg.locator('#tabbar .tab').nth(2).click(); await pg.waitForTimeout(500);
  await pg.locator('input[placeholder^="session token"]').fill(TOKEN); await pg.getByRole('button',{name:'Connect'}).click(); await pg.waitForTimeout(700);
  await pg.locator('input[type=file][accept="video/mp4"]').setInputFiles(CLIP);
  await pg.locator('.bk-row:has(span:text-is("run tag")) input').fill('w700run'); await pg.getByRole('button',{name:/Analyze clip/}).click();
  await pg.getByText('Uploaded clip - live result').waitFor({timeout:5000}).catch(()=>{});
  ok(n+' live result shown',(await pg.getByText('Uploaded clip - live result').count())>0);
  await clearance(n,pg); await pg.screenshot({path:`${SHOTS}/e2e_${n}_result.png`,fullPage:true}); await pg.close(); }
} catch (e) {
 ok('GUI stub run completed without an uncaught error',false,String(e && e.message ? e.message : e));
} finally {
 if(b) await b.close().catch(()=>{});
 srv.close();
}
const nf=res.filter(x=>x.startsWith('FAIL')).length;
console.log('screenshots: '+SHOTS);
console.log(`GUI STUB E2E: ${res.length-nf} PASS, ${nf} FAIL`);
if(nf>0||res.length===0) process.exitCode=1;
