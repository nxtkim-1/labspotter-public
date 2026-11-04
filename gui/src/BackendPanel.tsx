import { BenchPanel } from './BenchPanel';
import React, { useEffect, useRef, useState } from 'react';
import { apiEndpoint, saveApiEndpoint, lsGet, lsSet, getHealth, loadRun, analyzeClip, Health, RunData, queryEndpointProposal, setSessionToken, needsManualToken } from './backend';
import { predictionRows, formatPct, classLabel } from './probs';

// One .bk-row per class (all 8 for current runs); older runs that stored only top3 get a .bk-note instead of extra rows.
function PredRows({ pr }: { pr: ReturnType<typeof predictionRows> }) {
    return <>
        {pr.fallback && <div className="bk-note">older run: only the top 3 classes were stored</div>}
        {pr.rows.map(r => <div className="bk-row bk-prob" key={r.label} data-key={r.label}><span>{classLabel(r.label)}</span><i className="bk-track"><i className="bk-bar" style={{ width: Math.max(0, Math.min(100, r.p * 100)) + '%' }} /></i><b>{formatPct(r.p)}</b></div>)}
    </>;
}

export function BackendPanel({ onAnalyzed, onExample }: { onExample?: () => void; onAnalyzed?: (info: { tag: string; device: string; alert: string; kind: 'uploaded' | 'stored'; preds?: any[]; blob?: string; fname?: string }) => void }) {
    const [ep, setEp] = useState(apiEndpoint());
    const [health, setHealth] = useState<Health | null>(null);
    const [healthErr, setHealthErr] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [tag, setTag] = useState('run1');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [errKind, setErrKind] = useState('');
    const [checkMsg, setCheckMsg] = useState('');
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => { if (!busy) { setElapsed(0); return; } const t0 = Date.now(); const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000); return () => clearInterval(id); }, [busy]);
    const [result, setResult] = useState<any>(null);
    const [loadTag, setLoadTag] = useState('fresh1');
    const [run, setRun] = useState<RunData | null>(null);
    const [shownTag, setShownTag] = useState('');
    const [shownEp, setShownEp] = useState('');
    const [runErr, setRunErr] = useState('');
    type HistEntry = { tag: string; kind: 'analyzed' | 'loaded'; at: number; ep?: string };
    const readHist = (): HistEntry[] => {
        try {
            const v = JSON.parse(lsGet('labspotter_history') || '[]');
            return Array.isArray(v) ? v.filter((x: any) => x && typeof x.tag === 'string' && x.tag.length > 0) : [];
        } catch { return []; }
    };
    const [hist, setHist] = useState<HistEntry[]>(readHist);
    const writeHist = (h: HistEntry[]) => { setHist(h); lsSet('labspotter_history', JSON.stringify(h)); };
    const pushHist = (t: string, kind: 'analyzed' | 'loaded', forEp?: string) => {
        writeHist([{ tag: t, kind, at: Date.now(), ep: forEp || ep }, ...hist.filter(x => !(x.tag === t && (x.ep || '') === (forEp || ep)))].slice(0, 10));
    };
    const dropHist = (t: string, forEp?: string) => {
        writeHist(hist.filter(x => !(x.tag === t && (x.ep || '') === (forEp || ep))));
    };
    const fileRef = useRef<HTMLInputElement>(null);
    const [proposal, setProposal] = useState<string | null>(null);
    const [manualToken, setManualToken] = useState('');

    const refresh = (endpoint: string) => {
        setHealth(null); setHealthErr('');
        getHealth(endpoint).then(setHealth).catch(e => setHealthErr(String(e && e.message ? e.message : e)));
    };
    useEffect(() => {
        const q = queryEndpointProposal();
        if (q && q !== ep) setProposal(q);
        refresh(ep);
    }, []); // eslint-disable-line
    const acceptProposal = () => { if (!proposal) return; saveApiEndpoint(proposal); setEp(proposal); refresh(proposal); setProposal(null); };
    const rejectProposal = () => setProposal(null);

    const [tokenEp, setTokenEp] = useState('');
    // Bind the typed token to the endpoint it was entered for; switching endpoints never re-sends it.
    useEffect(() => { if (manualToken && tokenEp === ep) setSessionToken(manualToken, ep); }, [manualToken, tokenEp, ep]); // eslint-disable-line
    const depsErr = health && health.deps && (health.deps as any).error ? String((health.deps as any).error) : '';
    const locked = !!health && !health.head; // minimal public health - token not entered yet
    const showTok = needsManualToken(ep) || !!manualToken || locked; // never unmount the field while typing or while locked
    const ready = !!health && !!health.head && !depsErr;

    const doAnalyze = async () => {
        if (!file || !ready || busy) return;
        setBusy(true); setErr(''); setErrKind(''); setCheckMsg(''); setResult(null);
        try {
            const r = await analyzeClip(ep, tag.trim() || 'run1', file);
            setResult(r);
            if (onAnalyzed) onAnalyzed({ tag: tag.trim() || 'run1', device: health && health.deps && (health.deps as any).cuda ? 'CUDA GPU' : 'CPU', alert: r && r.result ? String(r.result.alert) : 'pending_review', kind: 'uploaded', preds: r && r.predictions, blob: URL.createObjectURL(file), fname: file.name });
            pushHist(tag.trim() || 'run1', 'analyzed');
        }
        catch (e: any) { setErr(String(e && e.message ? e.message : e)); setErrKind(e && e.status === 503 ? 'busy' : e && e.status === 409 ? 'tagexists' : e && e.status === undefined ? 'unknown' : ''); }
        setBusy(false);
    };
    const checkTag = async () => {
        const t = tag.trim() || 'run1'; setCheckMsg('Checking...');
        try { await loadRun(ep, t); setErr(''); setErrKind(''); setCheckMsg(''); await doLoadTag(t); }
        catch (e: any) { setCheckMsg(e && e.status === 404 ? 'Tag ' + t + ' is not saved on the backend (yet). If the clip may still be analyzing, wait a few seconds and check again; otherwise it is safe to press Analyze again.' : 'Could not check: ' + String(e && e.message ? e.message : e)); }
    };
    const doLoadTag = async (t: string, forEp?: string) => {
        const target = forEp || ep;
        setRun(null); setRunErr('');
        try { const r = await loadRun(target, t); setRun(r); setShownTag(t); setShownEp(target); if (onAnalyzed) onAnalyzed({ tag: t, device: '', alert: r && r.result ? String(r.result.alert) : 'pending_review', kind: 'stored', preds: r && r.predictions }); pushHist(t, 'loaded', target); setLoadTag(t); }
        catch (e: any) { setRunErr(t + (target !== ep ? ' on ' + target : '') + ': ' + String(e && e.message ? e.message : e)); }
    };
    const openFromHistory = (h: HistEntry) => {
        if (h.ep && h.ep !== ep) {
            // same tag can exist on a different backend - switch the endpoint openly, then load from it
            setEp(h.ep); saveApiEndpoint(h.ep); refresh(h.ep); doLoadTag(h.tag, h.ep);
        } else {
            doLoadTag(h.tag);
        }
    };
    const doLoad = () => { const t = loadTag.trim(); if (t) doLoadTag(t); };

    return <div className="bk">
        <details className="bk-conn" key={health && !locked ? 'c' : 'o'} open={!(health && !locked)}>
            <summary>{ready ? 'Setup - connected to ' + ep : health && !locked ? 'Setup - connected, analysis not available on this machine' : 'Connect to the backend'}</summary>
        <div className="bk-row"><span>endpoint</span>
            <input value={ep} onChange={e => { setEp(e.target.value); if (e.target.value !== tokenEp) setManualToken(''); }} spellCheck={false} />
            <button className="bk-load" onClick={() => { saveApiEndpoint(ep); refresh(ep); }}>Connect</button>
        </div>
        {proposal && <div className="bk-error"><b>This link asks to use a different backend: {proposal}</b><br />
            Clips you upload and every run you open would go to that address. Only continue if you expected this.<br />
            <button className="bk-load" onClick={acceptProposal}>Use this backend</button>{' '}
            <button className="bk-load" onClick={rejectProposal}>Keep {ep}</button></div>}
        {showTok && <div className="bk-row"><span>token</span>
            <input type="password" value={manualToken} onChange={e => { setManualToken(e.target.value); setTokenEp(ep); }} spellCheck={false} placeholder="session token printed by the backend at startup" />
        </div>}
        {showTok && <div className="bk-note">Type the session token the backend printed when it started, then press Connect. It is kept in memory only, never stored or put in the URL.</div>}
        {healthErr && <div className="bk-error"><b>Backend not reachable.</b> {healthErr}<br />Start it with: python3 server.py (portable package, stdlib only). The recorded demo above works either way.</div>}
        {health && locked && <div className="bk-note"><b>Connected, locked.</b> This backend is up. Type its session token in the token box above and press Connect to open runs and clip analysis.</div>}
        {health && !locked && <div className="bk-note">
            <b>Connected.</b> <details className="bk-dev"><summary>Model details</summary>head: {health.head} - encoder: {health.encoder}. {health.requires}.</details>
            {depsErr
                ? <span className="bk-err">Clip analysis is not available on this machine yet: the analysis packages (torch, transformers, pillow, ffmpeg, about 3 GB RAM) are not installed here. <details className="bk-dev"><summary>Technical detail</summary>{depsErr}</details></span>
                : <span>Backend dependencies present{health.deps && (health.deps as any).cuda ? ' (CUDA available)' : ' (CPU)'}.</span>}
        </div>}
        </details>
        <div className="bk-row"><span>clip</span>
            <input ref={fileRef} type="file" accept="video/mp4" onChange={e => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
        </div>
        <details className="bk-adv"><summary>Name this run</summary><div className="bk-row"><span>run tag</span>
            <input value={tag} onChange={e => setTag(e.target.value)} spellCheck={false} />
        </div></details>
        {!ready && onExample && <button className="bk-upload bk-example" onClick={onExample}>Try the example clips</button>}
        <button className={'bk-upload' + (ready && file && !busy ? '' : ' disabled')} onClick={doAnalyze}>
            {busy ? 'Analyzing - encoder running, ' + elapsed + ' s' : ready ? (file ? 'Analyze clip (model-predicted, unvalidated)' : 'Choose an mp4 clip above') : locked ? 'Analyze unavailable - enter the session token above' : 'Analyze unavailable - setup needed on backend host'}</button>
        {err && <div className="bk-error"><b>Analyze failed.</b> {err}</div>}
        {err && errKind === 'busy' && <div className="bk-note">The backend is analyzing another clip. Nothing was saved for your clip. <button className="bk-load" onClick={doAnalyze}>Retry</button></div>}
        {err && errKind === 'unknown' && <div className="bk-note">The connection dropped before a result came back, so the backend may still have analyzed the clip. Check before sending it again. <button className="bk-load" onClick={checkTag}>Check whether this tag was saved</button>{checkMsg && <div>{checkMsg}</div>}</div>}
        {err && errKind === 'tagexists' && <div className="bk-note">Tags are never overwritten. Pick a new run tag, or use Load run to open the saved one.</div>}
        {result && <div className="bk-result">
            <div className="bk-note"><b>Uploaded clip - live result.</b> Model prediction, ready for your review. Saved as run tag {tag.trim() || 'run1'} on this backend.
                <details className="bk-dev"><summary>Run details</summary>Ran on {health && health.deps && (health.deps as any).cuda ? 'CUDA GPU' : 'CPU'} - head {health && health.head ? String(health.head).split(' (')[0] : '?'} - gate: every step UNVERIFIED - alert {result.result && result.result.alert} - approval {result.result && result.result.approval}. The 51.2% / 3-of-8 figures in the Reference section below are the recorded demo benchmark, not this clip. Results stay on the backend until the host owner removes them.</details></div>
            {(result.predictions || []).map((p: any, i: number) => { const pr = predictionRows(p); const top = pr.rows[0]; return <div className="bk-pred" key={i}>
                <div className="bk-pred-head"><b data-key={top ? top.label : ''}>{top ? classLabel(top.label) : '-'}</b><span>{p.t != null ? 't=' + p.t + 's - ' : ''}decoded {p.decoded_frames} frames</span></div>
                <details className="bk-dev"><summary>Model scores</summary><PredRows pr={pr} /></details>
            </div>; })}
        </div>}
        <details className="bk-adv"><summary>Open a saved run by name</summary><div className="bk-row"><span>past run</span>
            <input value={loadTag} onChange={e => setLoadTag(e.target.value)} spellCheck={false} />
            <button className="bk-load" disabled={!health || locked} onClick={doLoad}>Load run</button>
        </div></details>
        {runErr && <div className="bk-error"><b>Load run failed.</b> {runErr}</div>}
        {hist.length > 0 && <div className="bk-hist">
            <div className="bk-hist-label">History - this browser only; times are when the run was opened here, not when anything was recorded</div>
            {hist.map(h => <div className="bk-hist-row" key={(h.ep || '') + '/' + h.tag}>
                <button className="bk-hist-open" onClick={() => openFromHistory(h)}>{h.tag}</button>
                <span>{h.kind} - opened {new Date(h.at).toLocaleString()}{h.ep && h.ep !== ep ? ' - on ' + h.ep + ' (opens by switching endpoint)' : ''}</span>
                <button className="bk-hist-x" title="Remove from this list (does not delete the run on the server)" onClick={() => dropHist(h.tag, h.ep)}>x</button>
            </div>)}
        </div>}
        {run && run.predictions && <div className="bk-result">
            <div className="bk-note"><b>Stored run "{shownTag}"</b> - model suggestion, unvalidated.
                <details className="bk-dev"><summary>Run details</summary>On {shownEp}. Model-predicted, unvalidated - {run.result ? 'gate UNVERIFIED on every step' + (run.result.alert ? ' - alert ' + run.result.alert : '') + (run.result.approval ? ' - approval ' + run.result.approval : '') : ''}</details></div>
            {run.predictions.map((p: any, i: number) => { const pr = predictionRows(p); const top = pr.rows[0]; return <div className="bk-pred" key={i}>
                <div className="bk-pred-head"><b data-key={top ? top.label : ''}>{top ? classLabel(top.label) : '-'}</b><span>{p.t != null ? 't=' + p.t + 's - ' : ''}{/^tmp/.test(String(p.clip)) ? 'uploaded clip (original file name is not stored)' : p.clip}</span></div>
                <details className="bk-dev"><summary>Model scores</summary><PredRows pr={pr} /></details>
            </div>; })}
        </div>}
        <BenchPanel ep={ep} enabled={!!health && !locked} voice={health ? health.voice : undefined} claimTag={run && shownTag ? shownTag : (result ? (tag.trim() || 'run1') : '')} />
    </div>;
}
