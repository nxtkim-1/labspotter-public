import React, { useEffect, useRef, useState } from 'react';
import { apiEndpoint, getHealth, Health, analyzeClip, benchCreate, benchClaim, benchLabel, benchNote, benchFreeze, benchContinue, benchInfo, benchList, BenchSessionRow, BenchCp, agentCoach, agentGlimpse, setSessionToken, needsManualToken } from './backend';
import { predictionRows, classLabel } from './probs';
import { openCamera, createSegmentRecorder, speakRecap, stopStream, SegmentRecorder, Segment } from './liveCapture';

// The everyday flow: add a video (file or phone camera), see the suggestion, agree or change it, add a note.
// Everything is saved as it happens in a hidden BenchFreeze session. The model suggestion is never treated as confirmed.
const TZ = 'America/Toronto';
// Words only on the normal screen (no digits): "This morning", "Yesterday evening", "Monday afternoon", "Earlier in October".
const when = (ms: number) => {
    const d = new Date(ms), now = new Date();
    const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: TZ });
    const h = parseInt(d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }), 10);
    const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    if (day(d) === day(now)) return 'This ' + part;
    if (day(d) === day(new Date(now.getTime() - 864e5))) return 'Yesterday ' + part;
    if (now.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString('en-CA', { timeZone: TZ, weekday: 'long' }) + ' ' + part;
    return 'Earlier in ' + d.toLocaleDateString('en-CA', { timeZone: TZ, month: 'long' });
};
const whenExact = (ms: number) => new Date(ms).toLocaleString('en-CA', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
const NAMES_KEY = 'labspotter_session_names';
const readNames = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(NAMES_KEY) || '{}') || {}; } catch { return {}; } };
const saveName = (sid: string, n: string) => { try { const m = readNames(); m[sid] = n; localStorage.setItem(NAMES_KEY, JSON.stringify(m)); } catch { /* names are a convenience only */ } };
const kindOf = (c: BenchCp) => (c.evidence && c.evidence[0] ? c.evidence[0].kind : '');
const afterColon = (s: string) => s.replace(/^[^:]*: /, '');
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

type Item = { tag: string; name: string; label: string; labels: string[]; decided: '' | 'agreed' | 'corrected'; finalLabel: string; url?: string; look?: string };

type Guide = { title: string; source: string; steps: string[] };
// A harmless EXAMPLE only. Not a lab procedure, not assigned by anyone, not validated.
const EXAMPLE_GUIDE: Guide = { title: 'Water measuring walkthrough (example)', source: 'Written for this demo as a harmless example. Water only. Not a lab procedure.',
    steps: ['Pour about 50 mL of water into a graduated cylinder.', 'Read the level at eye height, at the bottom of the curve.', 'Pour the water into a beaker.', 'Write down the volume you read.'] };
function restoreGuide(list: BenchCp[]): { guide: Guide | null; done: number[] } {
    const pi = list.map(kindOf).lastIndexOf('user_protocol_loaded'); if (pi < 0) return { guide: null, done: [] };
    const raw = (list[pi].notes[0] || '').replace(/^[A-Z ]+(\([^)]*\))?( typed by the user| loaded by the user| by the learner's own tap)?[^:]*: /, '');
    const m = /^(.*?) - source: (.*?) - \d+ steps \| steps: (.*)$/.exec(raw);
    if (!m) return { guide: null, done: [] };
    const done = list.slice(pi + 1).filter(c => kindOf(c) === 'user_learner_confirmed').map(c => { const n = /Step (\d+):/.exec(c.notes[0] || ''); return n ? parseInt(n[1], 10) - 1 : -1; }).filter(i => i >= 0);
    return { guide: { title: m[1], source: m[2], steps: m[3].split(/; (?=\d+\. )/).map(x => x.replace(/^\d+\. /, '')) }, done };
}
function describe(cps: BenchCp[]): string[] {
    return cps.map(c => {
        const k = kindOf(c), t = c.notes[0] || '';
        if (k === 'clip_run') { const m = /claim: ([^ ]+)/.exec(t); return 'App suggestion: ' + (m ? classLabel(m[1]) : 'a video action') + ' (not confirmed)'; }
        if (k === 'user_label_agreed') return 'You agreed with the suggestion';
        if (k === 'user_label_corrected') { const m = /user label (\S+)/.exec(t); return 'You changed it to ' + (m ? classLabel(m[1]) : 'another action'); }
        if (k === 'user_observation') return 'Your note: ' + afterColon(t);
        if (k === 'user_question') return 'Your question: ' + afterColon(t);
        if (k === 'user_learner_confirmed') { const m = /Step (\d+): (.*)$/.exec(t); return m ? 'You marked step ' + m[1] + ' done: ' + m[2].replace(/[.!?\s]+$/, '') : 'You marked a protocol step done'; }
        if (k === 'user_protocol_loaded') return 'Protocol loaded';
        return 'Saved entry';
    });
}
function localRecap(lines: string[]): string {
    const ls = lines.filter(l => l !== 'Protocol loaded');
    if (!ls.length) return 'Nothing saved yet in this session.';
    return ls.slice(-6).map(l => l.replace(/[.!?\s]+$/, '')).join('. ') + '.';
}

function joinSentences(parts: string[]): string { return parts.map(x => String(x || '').trim()).filter(Boolean).map(x => /[.!?]$/.test(x) ? x : x + '.').join(' '); }
export function Assistant({ onTools }: { onTools: () => void }) {
    const [ep] = useState(apiEndpoint());
    const [health, setHealth] = useState<Health | null>(null);
    const [down, setDown] = useState('');
    const [tok, setTok] = useState('');
    const [sid, setSid] = useState('');
    const [items, setItems] = useState<Item[]>([]);
    const itemsRef = useRef<Item[]>([]); itemsRef.current = items;
    const freeUrls = () => { itemsRef.current.forEach(x => { try { if (x.url) URL.revokeObjectURL(x.url); } catch { /* ignore */ } }); };
    useEffect(() => () => freeUrls(), []); // eslint-disable-line
    const [cur, setCur] = useState(-1);
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    const [changing, setChanging] = useState(false);
    const [note, setNote] = useState('');
    const [log, setLog] = useState<string[]>([]);
    const [recent, setRecent] = useState<BenchSessionRow[]>([]);
    const [paused, setPaused] = useState(false);
    const [restored, setRestored] = useState(false);
    const [recap, setRecap] = useState('');
    const [recapFrom, setRecapFrom] = useState<'meta' | 'local' | ''>('');
    const [guide, setGuide] = useState<Guide | null>(null);
    const [gDone, setGDone] = useState<number[]>([]);
    const [gText, setGText] = useState('');
    const [gOpen, setGOpen] = useState(false);
    const [live, setLive] = useState(false);
    const [liveMsg, setLiveMsg] = useState('');
    const [skipped, setSkipped] = useState(0);
    const [lastAt, setLastAt] = useState(0);
    const [, tick] = useState(0);
    const vid = useRef<HTMLVideoElement>(null);
    const rec = useRef<SegmentRecorder | null>(null);
    const camStream = useRef<MediaStream | null>(null);
    const working = useRef(false);
    const liveOn = useRef(false);
    const lookOff = useRef(false);
    const gen = useRef(0);
    const sidRef = useRef('');
    const itemsLen = useRef(0);
    sidRef.current = sid; itemsLen.current = items.length;
    useEffect(() => { if (!live) return; const id = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(id); }, [live]);
    useEffect(() => () => { try { rec.current && rec.current.stop(); } catch { /* already stopped */ } stopStream(camStream.current); }, []);
    const pick = useRef<HTMLInputElement>(null);
    const cam = useRef<HTMLInputElement>(null);

    const refresh = () => { setDown(''); getHealth(ep).then(setHealth).catch(e => setDown(String(e && e.message ? e.message : e))); };
    useEffect(refresh, []); // eslint-disable-line
    const locked = !!health && !health.head;
    const depsErr = health && health.deps && (health.deps as any).error ? String((health.deps as any).error) : '';
    const ready = !!health && !!health.head && !depsErr;
    const authed = !!health && !!health.head;
    const loadRecent = () => { if (!authed) return; benchList(ep).then(r => setRecent(r.sessions.filter(s => s.intact && (s.entries || 0) > 0))).catch(() => setRecent([])); };
    useEffect(loadRecent, [authed, sid, paused]); // eslint-disable-line
    const connect = () => { if (!tok.trim()) return; setSessionToken(tok.trim(), ep); setTok(''); refresh(); };
    const run = async (label: string, f: () => Promise<void>) => { setBusy(label); setErr(''); try { await f(); } catch (e: any) { setErr(String(e && e.message ? e.message : e)); } setBusy(''); };
    const refreshLog = async (s: string) => { const info = await benchInfo(ep, s); setLog(describe(info.checkpoints)); return info.checkpoints; };

    const addVideo = (f: File | null | undefined) => {
        if (!f) return;
        run('Looking at your video', async () => {
            let s = sid;
            if (!s) { s = (await benchCreate(ep, f.name.slice(0, 60))).session_id; setSid(s); saveName(s, f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Video session'); }
            const tag = 'v-' + Date.now().toString(36);
            const r = await analyzeClip(ep, tag, f);
            const pr = predictionRows(r.predictions[0]);
            await benchClaim(ep, s, tag);
            const it: Item = { tag, name: f.name, label: pr.rows[0].label, labels: pr.rows.map(x => x.label).sort(), decided: '', finalLabel: '', url: URL.createObjectURL(f) };
            setItems(a => [...a, it]); setCur(items.length); setChanging(false); setPaused(false); setRecap('');
            await refreshLog(s);
        });
    };
    const decide = (decision: 'agreed' | 'corrected', label: string) => {
        const it = items[cur]; if (!it || !sid) return;
        run('Saving', async () => {
            await benchLabel(ep, sid, it.tag, decision, label);
            setItems(a => a.map((x, i) => i === cur ? { ...x, decided: decision, finalLabel: label } : x)); setChanging(false);
            await refreshLog(sid);
        });
    };
    const addNote = () => { const t = note.trim(); if (!t || !sid) return; run('Saving', async () => { await benchNote(ep, sid, 'observation', t); setNote(''); await refreshLog(sid); }); };
    const [unread, setUnread] = useState(false);
    const [speakMsg, setSpeakMsg] = useState('');
    const pause = () => {
        if (!sid) return;
        setUnread(liveOn.current);
        stopLive();
        run('Saving your place', async () => {
            await benchFreeze(ep, sid, 'paused ' + new Date().toISOString().slice(0, 16));
            const lines = await refreshLog(sid).then(describe);
            setRestored(false); setPaused(true); setTimeout(() => { try { window.scrollTo(0, 0); } catch { /* ignore */ } }, 50);
            let text = '', from: 'meta' | 'local' = 'local';
            try { const r = await agentCoach(ep, sid); text = joinSentences([r.recap, ...(r.next_steps || [])]); from = 'meta'; } catch { text = localRecap(lines); }
            setRecap(text || localRecap(lines)); setRecapFrom(text ? from : 'local');
        });
    };
    const ensureSid = async () => { let s = sidRef.current; if (!s) { s = (await benchCreate(ep, 'Guided session')).session_id; setSid(s); sidRef.current = s; saveName(s, 'Guided session'); } return s; };
    const loadGuide = (g: Guide) => run('Loading the guide', async () => { const s = await ensureSid(); await benchNote(ep, s, 'protocol_loaded', g.title + ' - source: ' + g.source + ' - ' + g.steps.length + ' steps | steps: ' + g.steps.map((x, i) => (i + 1) + '. ' + x).join('; ')); setGuide(g); setGDone([]); await refreshLog(s); setTimeout(() => { try { window.scrollTo(0, 0); } catch { /* ignore */ } }, 50); });
    const parseGuide = () => { try { const j = JSON.parse(gText); if (!j || typeof j.title !== 'string' || typeof j.source !== 'string' || !Array.isArray(j.steps) || !j.steps.length || j.steps.some((x: any) => typeof x !== 'string')) throw new Error('x'); loadGuide({ title: j.title.slice(0, 120), source: j.source.slice(0, 200), steps: j.steps.slice(0, 30).map((x: string) => x.slice(0, 200)) }); } catch { setErr('That guide is not in the expected form: {"title": "...", "source": "...", "steps": ["...", "..."]}'); } };
    // Only the person's own tap marks a step done. A model suggestion or agreeing with a label never does.
    const tickStep = (i: number) => run('Saving', async () => { const s = await ensureSid(); await benchNote(ep, s, 'learner_confirmed', 'Step ' + (i + 1) + ': ' + (guide as Guide).steps[i]); setGDone(d => d.indexOf(i) >= 0 ? d : [...d, i]); await refreshLog(s); });
    const resume = (s: string) => run('Opening your session', async () => {
        await benchContinue(ep, s); setSid(s); freeUrls(); setItems([]); setCur(-1); setPaused(false);
        const cps0 = await refreshLog(s); const rg = restoreGuide(cps0); setGuide(rg.guide); setGDone(rg.done); const lines = describe(cps0); setRecap(localRecap(lines)); setRecapFrom('local'); setRestored(true); setPaused(true); setTimeout(() => { try { window.scrollTo(0, 0); } catch { /* ignore */ } }, 50);
        try { const r = await agentCoach(ep, s); const t = joinSentences([r.recap, ...(r.next_steps || [])]); if (t) { setRecap(t); setRecapFrom('meta'); } } catch { /* Meta recap is optional */ }
    });
    const cont = () => { setPaused(false); };
    const fresh = () => { freeUrls(); setGuide(null); setGDone([]); setSid(''); setItems([]); setCur(-1); setLog([]); setPaused(false); setRecap(''); setErr(''); };

    const heldSeg = useRef<Segment | null>(null);
    const recRef2 = useRef<SegmentRecorder | null>(null);
    const [hasHeld, setHasHeld] = useState(false);
    const pump = async () => {
        if (working.current || !rec.current) return;
        const seg = rec.current.take(); if (!seg) return;
        processSeg(seg, false);
    };
    // force: read a moment that was kept after the camera stopped (the person asked for it)
    const processSeg = async (seg: Segment, force: boolean) => {
        if (working.current) return;
        working.current = true;
        try {
            let s = sidRef.current;
            if (!s) { s = (await benchCreate(ep, 'Live session')).session_id; setSid(s); sidRef.current = s; saveName(s, 'Live session'); }
            const tag = 'v-' + Date.now().toString(36);
            const f = new File([seg.blob], 'live-' + tag + (seg.mimeType.indexOf('mp4') >= 0 ? '.mp4' : '.webm'), { type: seg.mimeType });
            const myGen = gen.current;
            const lookP: Promise<string> = lookOff.current ? Promise.resolve('') : agentGlimpse(ep, seg.blob).then(x => x.text, (e: any) => { if (e && (e.status === 503 || e.status === 415)) lookOff.current = true; return ''; });
            const r = await analyzeClip(ep, tag, f);
            if (!force && (!liveOn.current || myGen !== gen.current)) { working.current = false; return; }
            const look = await lookP;
            const pr = predictionRows(r.predictions[0]);
            await benchClaim(ep, s, tag);
            const item: Item = { tag, name: f.name, label: pr.rows[0].label, labels: pr.rows.map(x => x.label).sort(), decided: '', finalLabel: '', url: URL.createObjectURL(seg.blob), look };
            setItems(a => [...a, item]); setCur(itemsLen.current); itemsLen.current += 1; setChanging(false); setLastAt(seg.startedAt);
            const info = await benchInfo(ep, s); setLog(describe(info.checkpoints));
        } catch (e: any) { { const m = String(e && e.message ? e.message : e); setLiveMsg(/busy/i.test(m) ? 'Still reading the last piece. It will try the next one in a moment.' : 'A moment could not be read: ' + m); } }
        working.current = false;
        if (!force) pump();
    };
    const stopLive = () => { liveOn.current = false; gen.current += 1; try { rec.current && rec.current.stop(); } catch { /* already stopped */ } rec.current = null; stopStream(camStream.current); camStream.current = null; setLive(false); };
    const liveStarting = useRef(false);
    const goLive = async () => {
        if (liveOn.current || liveStarting.current) return;
        liveStarting.current = true;
        setUnread(false);
        setErr(''); setLiveMsg(''); setSkipped(0);
        const c = await openCamera({});
        liveStarting.current = false;
        if (!c.ok) { setLiveMsg(c.message); return; }
        camStream.current = c.stream;
        const r = createSegmentRecorder(c.stream, { segmentMs: 5000, onSegment: () => { if (liveOn.current) { pump(); return; } const sg = recRef2.current && recRef2.current.take(); if (sg) { heldSeg.current = sg; setHasHeld(true); } }, onDrop: () => setSkipped(n => n + 1) });
        if (!r.ok) { stopStream(c.stream); setLiveMsg(r.message); return; }
        recRef2.current = r.recorder; heldSeg.current = null; setHasHeld(false);
        rec.current = r.recorder; liveOn.current = true; setLive(true); setPaused(false); setRecap('');
        setTimeout(() => { if (vid.current) { vid.current.srcObject = c.stream; vid.current.play().catch(() => { /* needs a tap */ }); } r.recorder.start(); }, 50);
    };
    const ago = () => { if (!lastAt) return ''; const s = Math.round((Date.now() - lastAt) / 1000); return s < 20 ? 'just now' : s < 90 ? 'a minute ago' : 'a little while ago'; };
    const it = cur >= 0 ? items[cur] : null;
    const started = !!sid;
    const nowIdx = guide ? guide.steps.findIndex((_, i) => gDone.indexOf(i) < 0) : -1;
    const mainNote = !!it || (!live && nowIdx >= 0);
    const secure = typeof window !== 'undefined' && window.isSecureContext;

    if (down) return <div className="as-wrap"><div className="as-card"><h1>LabSpotter can't reach its helper</h1><p>Start LabSpotter on your computer, then try again.</p><button className="as-btn" onClick={refresh}>Try again</button></div></div>;
    if (!health) return <div className="as-wrap"><div className="as-card"><p className="as-quiet">Getting ready</p></div></div>;
    if (locked || (needsManualToken(ep) && !authed)) return <div className="as-wrap"><div className="as-card">
        <h1>Welcome</h1><p>Enter the code LabSpotter showed when it started. It stays on this device.</p>
        <input className="as-input" type="password" value={tok} onChange={e => setTok(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') connect(); }} placeholder="Start code" aria-label="Start code" spellCheck={false} />
        <button className="as-btn" onClick={connect}>Continue</button></div></div>;

    const openPick = () => pick.current && pick.current.click();
    const openCam = () => cam.current && cam.current.click();
    return <div className="as-wrap as-split">
        <div className="as-main">
        {!started && !busy && !live && <div className="as-hero">
            <h1>What are you working on?</h1>
            {ready ? <p>Go live with your camera or add a short video. LabSpotter says what it thinks it sees, you decide if it is right. Notes and steps you confirm are saved as you go.</p> : <p>Follow a written guide, tick each step yourself and keep notes. Notes and steps you confirm are saved as you go.</p>}
            {!ready && <div className="as-card"><h2>Video analysis isn't set up on this computer yet</h2><p className="as-quiet">You can still follow a written guide with notes, pause and save your place, or look at the example clips.</p><div className="as-actions"><button className="as-btn" onClick={() => { setGOpen(true); setTimeout(() => { const g = document.querySelector('.as-guide'); if (g && g.scrollIntoView) g.scrollIntoView({ block: 'start' }); }, 50); }}>Follow a written guide</button><button className="as-btn alt" onClick={onTools}>See the example clips</button></div></div>}
            {ready && <div className="as-stage">
                <div className="as-stage-lens" aria-hidden="true" />
                <p className="as-stage-cap">{secure ? 'Your camera view shows here' : 'Add a short video from this device'}</p>
                {secure ? <button className="as-btn big" onClick={goLive}>Go live</button> : <button className="as-btn big" onClick={openPick}>Add a video</button>}
            </div>}
            <p className="as-quiet as-privacy">If Meta's AI is switched on for this launch, short clips and your notes are sent to Meta to write the quick look and the summary. While Meta's free credits are in use, Meta says content may be used for product improvement. Do not use private or sensitive footage.</p>
            {liveMsg && <p className="as-quiet">{liveMsg}</p>}
            {!secure && <p className="as-quiet">Recording opens your phone's own camera app. A live camera view needs a secure link, which is not set up yet.</p>}
        </div>}
        <input ref={pick} type="file" accept="video/mp4" hidden onChange={e => { addVideo(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        <input ref={cam} type="file" accept="video/*" capture="environment" hidden onChange={e => { addVideo(e.target.files && e.target.files[0]); e.target.value = ''; }} />

        {live && <div className="as-card as-live"><video ref={vid} className="as-video" playsInline muted autoPlay />
            <div className="as-kicker">Camera on. It looks at short pieces of your bench and may skip some while it catches up{working.current ? '. Looking at one now' : ''}.</div>
            {skipped > 0 && <p className="as-quiet">Some pieces were skipped to keep up. It does not see every second.</p>}
            {liveMsg && <p className="as-quiet">{liveMsg}</p>}
            <div className="as-actions"><button className="as-btn alt" onClick={stopLive}>Stop the camera</button><button className="as-btn" onClick={pause}>Pause and save my place</button></div></div>}
        {busy && <div className="as-card as-busy" role="status"><div className="as-spin" /><p>{busy}</p><p className="as-quiet">This can take a little while on this computer.</p></div>}
        {err && <div className="as-card as-err" role="alert"><p>Something went wrong: {err}</p><button className="as-btn alt" onClick={() => setErr('')}>Dismiss</button></div>}

        {started && !busy && paused && <div className="as-pause-focus" role="dialog" aria-label="Paused"><div className="as-card as-pause">
            <h2>{restored ? 'Welcome back' : 'Paused'}</h2><p className="as-quiet">{restored ? 'Your saved place is restored.' : 'Your place is saved.'}</p>
            {unread && hasHeld && <><p className="as-quiet">The last few seconds before you paused are kept in this tab only and have not been read yet. Closing or reloading the page loses them.</p><button className="as-btn alt" onClick={() => { const sg = heldSeg.current; heldSeg.current = null; setHasHeld(false); setPaused(false); if (sg) processSeg(sg, true); }}>Read the last moment</button></>}
            {unread && !hasHeld && <p className="as-quiet">The last few seconds before you paused were not read. Go live again to cover them.</p>}
            <div className={'as-ai' + (recapFrom === 'meta' ? ' meta' : ' plain')}>
                <p className="as-ai-kicker">{recapFrom === 'meta' ? 'AI summary' : 'Summary of your saved entries'}</p>
                {(() => { const t = recap.replace(/\s*\((?:p|score|probability)\s*[=:]\s*[0-9.]+\)/gi, '').replace(/\b(?:p|score)\s*=\s*[0-9.]+/gi, ''); const parts = t.match(/[^.!?]+[.!?]+(\s|$)/g) || [t]; if (true) return <ul className="as-recap-list">{parts.map((x, k) => <li key={k}>{x.trim()}</li>)}</ul>; const cut = t.length > 320 ? 2 : parts.length; const head = parts.slice(0, cut).join('').trim(); const rest = parts.slice(cut).join('').trim(); return <><p className="as-recap">{head}</p>{rest && <details className="as-more"><summary>More</summary><p className="as-recap">{rest}</p></details>}</>; })()}
                {recapFrom === 'meta' && <p className="as-powered">Powered by Meta</p>}
            </div>
            <p className="as-quiet">Saved entries cannot show the bench's current state. Check it in person.</p>
            <div className="as-actions">
                {canSpeak && <button className="as-btn alt" onClick={async () => { setSpeakMsg(''); const r = await speakRecap(recap).catch(() => null); if (r && !r.ok) setSpeakMsg(r.message); }}>Read it to me</button>}
                <button className="as-btn big" onClick={cont}>Resume</button></div>
            {canSpeak && <p className="as-quiet">Spoken by this device's voice, not by Meta.</p>}
            {speakMsg && <p className="as-quiet">{speakMsg}</p>}
        </div></div>}

        {started && !busy && !paused && it && <div className="as-card as-result" key={it.tag}>
            {it.url && !live && <video className="as-video" src={it.url} controls playsInline muted />}
            {it.look && <div className="as-ai meta compact"><p className="as-ai-kicker">Quick look</p><p className="as-recap">{it.look}</p><p className="as-powered">Powered by Meta. It describes what it sees and does not check your steps.</p></div>}
            {guide && nowIdx >= 0 && <div className="as-upnext-m"><span>Up next</span><b>{guide.steps[nowIdx]}</b><small className="as-quiet">Tap Correct once you have done it yourself.</small><button className="as-btn alt" onClick={() => tickStep(nowIdx)} title="Mark this step done">Correct</button></div>}
            <div className="as-kicker">{live && lastAt ? 'From ' + ago() + ', the app thinks this is' : 'The app thinks this is'}</div>
            <div className="as-label">{classLabel(it.label)}</div>
            <p className="as-quiet">This is a suggestion from the video model. It is not confirmed.</p>
            {it.decided === '' && !changing && <div className="as-actions">
                <button className="as-btn big" onClick={() => decide('agreed', it.label)}>Yes, that's right</button>
                <button className="as-btn alt" onClick={() => setChanging(true)}>Edit</button></div>}
            {it.decided === '' && changing && <div className="as-pickgrid" role="group" aria-label="What is it?">
                {it.labels.filter(l => l !== it.label).map(l => <button key={l} className="as-chip" onClick={() => decide('corrected', l)}>{classLabel(l)}</button>)}
                <button className="as-chip quiet" onClick={() => setChanging(false)}>Back</button></div>}
            {it.decided !== '' && <p className="as-done">{it.decided === 'agreed' ? 'You said this is right.' : 'You changed it to ' + classLabel(it.finalLabel) + '.'} Saved.</p>}
            <div className="as-note"><input className="as-input" value={note} maxLength={500} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote(); }} placeholder="Add a note about this" aria-label="Add a note" />
                <button className="as-btn alt" disabled={!note.trim()} onClick={addNote}>Save note</button></div>
            <div className="as-actions">
                <button className="as-btn alt" onClick={() => pick.current && pick.current.click()}>Add another video</button>
                <button className="as-btn alt" onClick={() => cam.current && cam.current.click()}>Record with camera</button>
                <button className="as-btn" onClick={pause}>Pause and save my place</button></div>
        </div>}

        {started && !busy && !paused && !live && !it && guide && nowIdx >= 0 && <div className="as-card as-now" key={'now' + nowIdx}>
            <p className="as-now-kicker">Step {nowIdx + 1} of {guide.steps.length}</p>
            <div className="as-dots" aria-hidden="true">{guide.steps.map((_, i) => <i key={i} className={gDone.indexOf(i) >= 0 ? 'on' : i === nowIdx ? 'cur' : undefined} />)}</div>
            <p className="as-now-step">{guide.steps[nowIdx]}</p>
            <div className="as-actions"><button className="as-btn big" onClick={() => tickStep(nowIdx)} title="Mark this step done">Correct</button>{ready && <button className="as-btn alt" onClick={() => pick.current && pick.current.click()}>Add a video</button>}</div>
            <p className="as-quiet">Tap Correct once you have done this step yourself. Only your tap marks a step.</p>
            <div className="as-note"><input className="as-input" value={note} maxLength={500} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote(); }} placeholder="Add a note" aria-label="Add a note" />
                <button className="as-btn alt" disabled={!note.trim()} onClick={addNote}>Save note</button></div>
        </div>}
        {started && !busy && !paused && !it && !(guide && nowIdx >= 0 && !live) && <div className="as-card">
            <h2>Session open</h2>{ready ? <p className="as-quiet">Add a video to carry on.</p> : <p className="as-quiet">Video analysis isn't set up on this computer, so follow the written guide and keep notes. Pause any time to save your place.</p>}
            {ready && <div className="as-actions"><button className="as-btn big" onClick={() => pick.current && pick.current.click()}>Add a video</button></div>}</div>}
        </div>

        <div className="as-side">
        {!started && !busy && ready && <div className="as-card as-start-alt">
            <h2>Or start from a video</h2>
            <p className="as-quiet">Pick a clip you already have, or record one with this device's camera.</p>
            <div className="as-actions">
                {secure && <button className="as-btn alt" onClick={openPick}>Add a video</button>}
                <button className="as-btn alt" onClick={openCam}>Record with camera</button>
            </div>
        </div>}

        {!busy && !paused && !live && <div className="as-card as-guide">
            {!guide && !gOpen && <button className="as-link" onClick={() => setGOpen(true)}>Follow a written guide, step by step</button>}
            {!guide && gOpen && <div><h2>Follow a guide</h2><p className="as-quiet">You tick each step yourself. LabSpotter only suggests what it sees and never ticks a step for you.</p>
                <div className="as-actions"><button className="as-btn alt" onClick={() => loadGuide(EXAMPLE_GUIDE)}>Try the water example</button></div>
                <details className="as-details"><summary>Use my own guide</summary><textarea className="as-input" rows={3} value={gText} onChange={e => setGText(e.target.value)} spellCheck={false} placeholder='{"title": "...", "source": "...", "steps": ["..."]}' aria-label="Your guide" />
                    <button className="as-btn alt" disabled={!gText.trim()} onClick={parseGuide}>Load my guide</button></details></div>}
            {guide && <div><h2>{guide.title}</h2><p className="as-quiet">From: {guide.source}</p>
                <p className="as-prog">{gDone.length} of {guide.steps.length} done</p>
                <div className="as-dots small" aria-hidden="true">{guide.steps.map((_, i) => <i key={i} className={gDone.indexOf(i) >= 0 ? 'on' : i === nowIdx ? 'cur' : undefined} />)}</div>
                {(!!it || live) && nowIdx >= 0 && <div className="as-curstep"><p className="as-quiet">Up next</p><p className="as-curtext">{guide.steps[nowIdx]}</p><p className="as-quiet">Tap Correct once you have done it yourself.</p><button className="as-btn alt" onClick={() => tickStep(nowIdx)} title="Mark this step done">Correct</button></div>}
                <details className="as-details" open={nowIdx < 0}><summary>All steps</summary>
                <ol className="as-steps">{guide.steps.map((st, i) => <li key={i} className={gDone.indexOf(i) >= 0 ? 'is-done' : undefined}><span>{st}</span> {gDone.indexOf(i) >= 0 ? <span className="as-done">You did this</span> : <button className="as-link" onClick={() => tickStep(i)} title="Mark this step done">Correct</button>}</li>)}</ol></details>
                {!!it && <button className="as-btn alt as-pause-side" onClick={pause}>Pause and save my place</button>}
                </div>}
            {sid && !it && <div className="as-session-actions">
                {!mainNote && <div className="as-note"><input className="as-input" value={note} maxLength={500} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote(); }} placeholder="Add a note" aria-label="Add a note" />
                    <button className="as-btn alt" disabled={!note.trim()} onClick={addNote}>Save note</button></div>}
                <div className="as-actions"><button className="as-btn" onClick={pause}>Pause and save my place</button></div></div>}
        </div>}
        {started && !busy && !paused && <button className="as-fab-pause" onClick={pause} aria-label="Pause and save my place">Pause</button>}
        {started && log.length > 0 && <details className="as-details"><summary>What's saved</summary>
            <ul className="as-log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <button className="as-link" onClick={fresh}>Start something new</button></details>}

        {!busy && !paused && recent.length > 0 && !(started && !paused && it) && <div className="as-recent"><h2>Recent</h2>
            {recent.slice(0, 6).map(r => <button key={r.session_id} className="as-row" onClick={() => resume(r.session_id)}>
                <span><b>{readNames()[r.session_id] || 'Saved session'}</b><i title={whenExact((r.last_t || r.created) * 1000)}>{when((r.last_t || r.created) * 1000)}</i></span><em>Continue</em></button>)}</div>}
        <button className="as-link as-tools" onClick={onTools}>Tools and example clips</button>
        </div>
    </div>;
}
