import React, { useEffect, useRef, useState } from 'react';
import { LABSPOTTER } from './data';
import { DETECTIONS } from './detections';
// Hosted demo build: recorded results only; the portable build wires the live backend panel.
import './style.css';
import './v2.css';
import './v3.css';
import './v4.css';
import './assistant.css';
import { Assistant } from './Assistant';
import { Projects } from './Projects';
import { BackendPanel } from './BackendPanel';

import addMp4 from './clips/Add_step.mp4';
import addJpg from './clips/Add_step.jpg';
import analyticalMp4 from './clips/AnalyticalMeasurement_step.mp4';
import analyticalJpg from './clips/AnalyticalMeasurement_step.jpg';
import collectMp4 from './clips/CollectLayer_step.mp4';
import collectJpg from './clips/CollectLayer_step.jpg';
import measureLiquidMp4 from './clips/MeasureLiquid_step.mp4';
import measureLiquidJpg from './clips/MeasureLiquid_step.jpg';
import measureSolidMp4 from './clips/MeasureSolid_step.mp4';
import measureSolidJpg from './clips/MeasureSolid_step.jpg';
import noActionMp4 from './clips/No_action.mp4';
import noActionJpg from './clips/No_action.jpg';
import phaseMp4 from './clips/PhaseSeparation_step.mp4';
import phaseJpg from './clips/PhaseSeparation_step.jpg';
import stirMp4 from './clips/Stir_step.mp4';
import stirJpg from './clips/Stir_step.jpg';

const MEDIA: Record<string, { video: string; poster: string }> = {
    'clips/Add_step.mp4': { video: addMp4, poster: addJpg },
    'clips/AnalyticalMeasurement_step.mp4': { video: analyticalMp4, poster: analyticalJpg },
    'clips/CollectLayer_step.mp4': { video: collectMp4, poster: collectJpg },
    'clips/MeasureLiquid_step.mp4': { video: measureLiquidMp4, poster: measureLiquidJpg },
    'clips/MeasureSolid_step.mp4': { video: measureSolidMp4, poster: measureSolidJpg },
    'clips/No_action.mp4': { video: noActionMp4, poster: noActionJpg },
    'clips/PhaseSeparation_step.mp4': { video: phaseMp4, poster: phaseJpg },
    'clips/Stir_step.mp4': { video: stirMp4, poster: stirJpg },
};

const D = LABSPOTTER as any;
const clips = D.clips.map((c: any) => ({ ...c, media: MEDIA[c.video] }));

const pct = (c: number | null) => c == null ? 'n/r' : Math.round(c * 100) + '%';
const short = (l: string) => l.replace(/ step$/, '');
const human = (l: string) => { const s = short(l).replace(/([a-z])([A-Z])/g, '$1 $2'); return s.charAt(0).toUpperCase() + s.slice(1); };
const detFor = (c: any): Detections | undefined => DETECTIONS[c.video.split('/').pop().replace('.mp4', '')];

type Detections = { detector: string; status: string; sourceWidth: number; sourceHeight: number; fps: number;
    frames: { t: number; boxes: { xyxy: [number, number, number, number]; label: string; kind: 'hand' | 'object'; score: number }[] }[] };
type DetBox = Detections['frames'][0]['boxes'][0];

/* Boxes drawn on the video carry no text; the legend outside the image lists the
   current frame's detections and selecting one highlights it. Real data only. */
function Player({ c, showBoxes, onFrame }: { c: any; showBoxes: boolean; onFrame: (boxes: DetBox[], sel: number | null) => void }) {
    const vidRef = useRef<HTMLVideoElement>(null);
    const ovlRef = useRef<HTMLDivElement>(null);
    const progRef = useRef<HTMLElement>(null);
    const [playing, setPlaying] = useState(false);
    const [sel, setSel] = useState<number | null>(null);
    const det = detFor(c);
    (Player as any).select = (i: number | null) => setSel(i);
    useEffect(() => { setSel(null); const v = vidRef.current; if (v) { v.pause(); setPlaying(false); } }, [c.id]);
    useEffect(() => {
        const vid = vidRef.current!, ovl = ovlRef.current!;
        const place = () => {
            const ew = vid.clientWidth, eh = vid.clientHeight, vw = vid.videoWidth, vh = vid.videoHeight;
            if (!ew || !vw) return;
            const s = Math.min(ew / vw, eh / vh);
            const w = vw * s, h = vh * s;
            const sr = ovl.parentElement!.getBoundingClientRect(), vr = vid.getBoundingClientRect();
            ovl.style.left = (vr.left - sr.left + (ew - w) / 2) + 'px';
            ovl.style.top = (vr.top - sr.top + (eh - h) / 2) + 'px';
            ovl.style.width = w + 'px'; ovl.style.height = h + 'px';
        };
        const draw = () => {
            place();
            if (progRef.current && vid.duration) progRef.current.style.width = (vid.currentTime / vid.duration * 100) + '%';
            if (!showBoxes || !det) { ovl.innerHTML = ''; onFrame([], sel); return; }
            const t = vid.currentTime;
            const fr = det.frames.filter(f => f.t <= t + 1e-6).pop();
            const fresh = fr && (t - fr.t) <= 1.5 / det.fps;
            if (!fresh) { ovl.innerHTML = ''; onFrame([], sel); return; }
            ovl.innerHTML = `<svg viewBox="0 0 ${det.sourceWidth} ${det.sourceHeight}" preserveAspectRatio="none">` +
                fr!.boxes.map((b, i) => {
                    const [x1, y1, x2, y2] = b.xyxy;
                    const cls = (b.kind === 'hand' ? 'hand' : 'obj') + (sel === i ? ' sel' : '');
                    return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" class="bx ${cls}"/>`;
                }).join('') + '</svg>';
            onFrame(fr!.boxes, sel);
        };
        vid.addEventListener('loadedmetadata', place);
        vid.addEventListener('timeupdate', draw);
        vid.addEventListener('play', place);
        window.addEventListener('resize', draw);
        const to = setTimeout(draw, 350);
        draw();
        return () => { vid.removeEventListener('loadedmetadata', place); vid.removeEventListener('timeupdate', draw); vid.removeEventListener('play', place); window.removeEventListener('resize', draw); clearTimeout(to); };
    }, [showBoxes, c.id, sel]);
    return <div className="player">
        <div className="frame" onClick={() => { const v = vidRef.current!; if (v.paused) { document.querySelectorAll('video').forEach(x => { if (x !== v) x.pause(); }); v.play(); } else v.pause(); }}>
            <video ref={vidRef} key={c.id} src={c.media.video} poster={c.media.poster} muted playsInline loop preload="metadata" disableRemotePlayback
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
            <div className="ovl" ref={ovlRef}></div>
            {!playing && <div className="playbtn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg></div>}
        </div>
        <div className="progress"><i ref={progRef as any}></i></div>
    </div>;
}

// The official mark, used as-is from public/brand (the tile version reads on light and dark backgrounds).
const MARK_SRC = import.meta.env.BASE_URL + 'brand/labspotter-mark-light.svg';
export function App() {
    const [view, setView] = useState('assistant');
    const [selId, setSelId] = useState((clips.find((x: any) => x.correct) || clips[0]).id);
    const [boxes, setBoxes] = useState(false);
    const [frame, setFrame] = useState<{ boxes: DetBox[]; sel: number | null }>({ boxes: [], sel: null });
    const [marks, setMarks] = useState<Record<string, string | undefined>>({});
    const [showEvidence, setShowEvidence] = useState(false);
    const [revFilter, setRevFilter] = useState<'all' | 'open' | 'flagged'>('all');
    const [liveRun, setLiveRun] = useState<{ tag: string; device: string; alert: string; kind: 'uploaded' | 'stored'; preds?: any[]; blob?: string; fname?: string } | null>(null);
    const c = clips.find((x: any) => x.id === selId);
    const det = detFor(c);
    const setMark = (id: string, v: string) => setMarks(m => ({ ...m, [id]: m[id] === v ? undefined : v }));

    const header = <header id="topbar">
        <div className="brand"><span className="mark-m"><img className="brand-mark" src={MARK_SRC} width={26} height={26} alt="" /></span>LabSpotter<span className="kicker">{view === 'clips' ? 'Clips' : view === 'run' ? 'Tools' : 'Review'}</span></div>
        <div className="top-right"><span className="run-chip" style={view === 'assistant' || view === 'projects' ? { display: 'none' } : undefined}>{liveRun ? (liveRun.kind === 'stored' ? 'Stored run - ' : 'Uploaded clip - ') + liveRun.tag + (liveRun.device ? ' - ' + liveRun.device : '') + ' - agent not called - model-predicted, unvalidated' : (view === 'run' ? 'No clip added yet. Predictions you add are suggestions, not confirmed.' : 'Example clips - imported predictions, origin unverified, unvalidated')}</span></div>
    </header>;

    const clipIndex = <div className="index">{clips.map((x: any, i: number) =>
        <button key={x.id} className={'index-item' + (x.id === selId ? ' active' : '')} onClick={() => { setSelId(x.id); setShowEvidence(false); }}>
            <span className="idx-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="idx-name">{human(x.actual)}</span>
            {marks[x.id] && <span className="idx-mark">{marks[x.id]}</span>}
            <span className={'dot ' + (x.correct ? 'ok' : 'bad')}></span>
        </button>)}</div>;
    const clipStrip = <div className="strip">{clips.map((x: any) =>
        <button key={x.id} className={'strip-item' + (x.id === selId ? ' active' : '')} onClick={() => { setSelId(x.id); setShowEvidence(false); }}>
            <img src={x.media.poster} alt="" />
            <span className={'dot ' + (x.correct ? 'ok' : 'bad')}></span>
            <span className="strip-name">{human(x.actual)}</span>
        </button>)}</div>;

    const legend = boxes && det && <div className="legend">
        <div className="legend-head">
            <span className="lg-chip hand"></span>hand<span className="lg-chip obj"></span>object
            <em>experimental boxes - unvalidated - detector scores, not accuracy</em>
        </div>
        {frame.boxes.length === 0 && <div className="legend-empty">No boxes on this frame.</div>}
        {frame.boxes.map((b, i) => <button key={i} className={'legend-item' + (frame.sel === i ? ' active' : '')}
            onClick={() => (Player as any).select(frame.sel === i ? null : i)}>
            <span className={'lg-chip ' + (b.kind === 'hand' ? 'hand' : 'obj')}></span>
            <span className="lg-label">{b.label}</span>
            <span className="lg-score">{Math.round(b.score * 100)}%</span>
        </button>)}
    </div>;

    const analysis = <div className="panel">
        <div className="panel-head">
            <div>
                <div className="panel-kicker">clip {c.n} of 8 - 4s excerpt - 16 frames</div>
                <h2 className={c.correct ? '' : 'wrong'}>{human(c.predicted)}</h2>
                <div className="panel-sub">Looks like <b>{human(c.predicted)}</b></div>
            </div>
            
        </div>
        <div className="chip-row">
            <span className="tag unval">Example prediction - not yet confirmed</span>
            {marks[c.id] && <span className="tag local">{marks[c.id]} - local mark only</span>}
        </div>
        <details className="t3-more"><summary>Model scores</summary><div className="t3">{c.top3.map(([l, s]: [string, number], i: number) =>
            <div className={'t3row' + (i === 0 ? ' first' : '')} key={l} data-key={l}>
                <span className="t3lbl">{human(l)}</span>
                <div className="conf-bar"><i style={{ width: Math.round(s * 100) + '%' }}></i></div>
                <span className="t3pct">{pct(s)}</span>
            </div>)}</div></details>
        <div className="panel-actions">
            <button className="ctl primary next-clip" onClick={() => { const i = clips.findIndex((x: any) => x.id === selId); setSelId(clips[(i + 1) % clips.length].id); setShowEvidence(false); }}>Next clip</button>
            {det && <button className={'ctl' + (boxes ? ' on' : '')} onClick={() => setBoxes(b => !b)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="3" /></svg>
                {boxes ? 'Hide boxes' : 'Show boxes'}</button>}
            <button className={'ctl' + (showEvidence ? ' on' : '')} onClick={() => setShowEvidence(e => !e)}>Evidence</button>
        </div>
        {showEvidence && <div className="evidence">
            <div className="group-label">Facts - model claims (unvalidated)</div>
            {c.claims.map((cl: any) => <div className="ev-claim" key={cl.claim}>
                <span className="cl">{cl.claim.replace('lab_action:', '')}</span>
                <span className="cs">{pct(cl.score)}</span>
                <span className="cst">{cl.status.replace(/_/g, ' ')}</span>
            </div>)}
            <div className="group-label">Gate trace</div>
            <p className="ev-p">{c.gateStep}: <b className="orange">UNVERIFIED</b> - agent overclaims 0 - human review pending</p>
            <div className="group-label">Source</div>
            <p className="ev-p mono">{c.sourceClip}</p>
            {det && <>
                <div className="group-label">Experimental detector boxes</div>
                <p className="ev-p">{det.detector}. {det.frames.reduce((n: number, f: any) => n + f.boxes.length, 0)} boxes over 16 frames at 4fps, threshold 0.15 + NMS. Scores are detector confidence, not accuracy; boxes are not action proof.</p>
            </>}
        </div>}
    </div>;

    const clipsView = <div className="view clips-view">
        <div className="view-head"><h1>Clips</h1><p className="view-lede">Example bench steps with what LabSpotter suggests. Play a clip, then open the details you need.</p></div>
        <aside className="index-card"><div className="index-title">Example clips</div>{clipIndex}</aside>
        {clipStrip}
        <div className="work">
            <div className="work-left">
                <Player c={c} showBoxes={boxes} onFrame={(b, s) => setFrame({ boxes: b, sel: s })} />
                {legend}
            </div>
            {analysis}
        </div>
    </div>;

    const lr: any = liveRun;
    const lrKey = lr ? 'run:' + lr.kind + ':' + lr.tag : '';
    const lrTop: any[] = lr && lr.preds && lr.preds[0] && lr.preds[0].top3 ? lr.preds[0].top3 : [];
    const liveCard = lr ? <div className="rev-live">
        <div className="group-label">{lr.kind === 'stored' ? 'Stored run' : 'Your uploaded clip'} - this session</div>
        {lr.blob && <video className="rev-live-video" src={lr.blob} controls playsInline muted preload="metadata" />}
        <div className="rev-item">
            <div className="rev-mid"><b>{lrTop[0] ? human(String(lrTop[0][0]).replace(/_/g, ' ')) : 'No prediction'}</b>
                <span>{lr.kind === 'stored' ? 'run ' + lr.tag : (lr.fname || 'clip') + ' - tag ' + lr.tag} {marks[lrKey] ? ' - ' + marks[lrKey] + ' (local mark only)' : ''}</span>
                <span>Model suggestion, unvalidated</span></div>
            <div className="rev-actions">
                <button className={'ctl sm seen' + (marks[lrKey] === 'seen' ? ' on' : '')} aria-pressed={marks[lrKey] === 'seen'} onClick={() => setMark(lrKey, 'seen')}>Seen</button>
                <button className={'ctl sm flag' + (marks[lrKey] === 'flagged' ? ' on' : '')} aria-pressed={marks[lrKey] === 'flagged'} onClick={() => setMark(lrKey, 'flagged')}>Flag</button>
            </div>
        </div>
        <div className="rev-note">Model-predicted, not verified. Video playback is only in this tab. The clip was uploaded to the analysis server for analysis: the server deletes the video file afterwards but keeps the result files and one still frame from the clip under this run tag until the host owner removes them. Marks are local and are not review decisions.</div>
    </div> : <div className="rev-live-empty">These are imported demo clips. Add your own video in Assistant or Tools to review a real analysis.</div>;

    const nMarked = clips.filter((x: any) => marks[x.id]).length;
    const nFlagged = clips.filter((x: any) => marks[x.id] === 'flagged').length;
    const shown = clips.filter((x: any) => revFilter === 'all' || (revFilter === 'open' ? !marks[x.id] : marks[x.id] === 'flagged'));
    const nextOpen = () => { const x = clips.find((y: any) => !marks[y.id]); if (!x) return; setRevFilter('all'); setTimeout(() => { const el = document.querySelector('[data-rev-id="' + x.id + '"]') as HTMLElement | null; if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); (el.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true }); } }, 0); };
    const reviewView = <div className="view rev-wrap">
        <div className="view-head"><h1>Review queue</h1><p className="view-lede">Look over each suggestion and mark it. Seen means you looked. Flag means check it again. Marks stay in this tab and reset on reload.</p></div>
        <section className="rev-summary">
        <div className="ledger" data-testid="ledger"><span className="ledger-num">{String(nMarked).padStart(2, '0')} / {String(clips.length).padStart(2, '0')}</span><span className="ledger-cap">demo clips marked locally (seen or flagged) - not review decisions</span></div>
        <div className="rev-meter" aria-hidden="true"><i style={{ width: (nMarked / clips.length * 100) + '%' }}></i></div>
        <button className="ctl primary rev-next" onClick={nextOpen} disabled={nMarked === clips.length}>{nMarked === clips.length ? 'All clips marked' : 'Review next unmarked clip'}</button>
        </section>
        {liveCard}
        {lr && <div className="group-label">Demo clips - imported example predictions (origin unverified)</div>}
        <p className="rev-sub">Demo clips with imported example predictions (origin unverified), grouped under one pending review alert. Nothing here is confirmed yet.</p>
        <div className="rev-filter" role="radiogroup" aria-label="Show clips">
            {([['all', 'All'], ['open', 'Not marked'], ['flagged', 'Flagged']] as const).map(([k, l]) =>
                <button key={k} role="radio" className={'rev-fbtn' + (revFilter === k ? ' on' : '')} aria-checked={revFilter === k} onClick={() => setRevFilter(k)}>{l}{k === 'flagged' && nFlagged ? ' (' + nFlagged + ')' : ''}</button>)}
        </div>
        {shown.length === 0 && <div className="rev-live-empty">{revFilter === 'flagged' ? 'Nothing flagged yet.' : 'Every demo clip has a mark.'}</div>}
        <div className="rev-list">{shown.map((x: any) => <div className="rev-item" key={x.id} data-rev-id={x.id}>
            <img src={x.media.poster} alt="" />
            <div className="rev-mid"><b>{human(x.predicted)}</b>
                <span>Model suggestion - not yet confirmed</span>
                {!x.correct && <span>Example label: {human(x.actual)}</span>}
                {marks[x.id] && <span className="rev-mark">{marks[x.id] === 'seen' ? 'Seen' : 'Flagged'} (local mark only)</span>}</div>
            <div className="rev-actions">
                <button className={'ctl sm seen' + (marks[x.id] === 'seen' ? ' on' : '')} aria-pressed={marks[x.id] === 'seen'} onClick={() => setMark(x.id, 'seen')}>Seen</button>
                <button className={'ctl sm flag' + (marks[x.id] === 'flagged' ? ' on' : '')} aria-pressed={marks[x.id] === 'flagged'} onClick={() => setMark(x.id, 'flagged')}>Flag</button>
            </div>
        </div>)}</div>
        <div className="rev-note">Marks are local to this preview. They are not authenticated review decisions and do not change gate output.</div>
    </div>;

    const stages: [string, string, string][] = [
        ['Recorded clip in', 'offline chain input', 'done'],
        ['V-JEPA2 feature extraction', 'frozen encoder, CPU, imported example run', 'done'],
        ['Linear 8-class head', 'top-3 + probabilities', 'done'],
        ['Facts', 'built from the model output', 'done'],
        ['Meta agent', 'optional - not called in the imported example run', 'off'],
        ['Code gate executed', 'every step UNVERIFIED', 'done'],
        ['Human review', 'pending_review queue', 'wait'],
    ];
    const runView = <div className="view run-wrap">
        <h1>Add a clip</h1>
        <p className="rev-sub">Add a short clip of a bench step. LabSpotter suggests what it sees, and you confirm each step.</p>
        <section className="tools-card"><BackendPanel onAnalyzed={setLiveRun} onExample={() => setView('clips')} /></section>
        <details className="diag tools-more"><summary>More: example data, pipeline and sources (not your upload)</summary>
        <div className="rev-sub">Hand boxes on the Clips tab are stored detections on the demo clips, not live tracking of your upload.</div>
        <div className="group-label">Imported example predictions - tag fresh1 - origin unverified - not the uploaded clip</div>
        <div className="bench">
            <div className="bench-card"><div className="v warn">51.2%</div><div className="k">FINAL balanced accuracy, 384-clip frozen head - 229 untouched clips, 5 source videos - top-1 43.2% - target 75% not met</div></div>
            <div className="bench-card"><div className="v muted-v">51.6%</div><div className="k">previous development seen-test, 64 clips, earlier head - different model, not comparable</div></div>
            <div className="bench-card wide"><div className="v small-v">3/8</div><div className="k">clips match the dataset label in these imported examples (not a measured accuracy)</div>
                <div className="bench-bar"><i></i><em></em></div></div>
        </div>
        <div className="group-label">Pipeline - imported example run fresh1 (origin unverified, agent not called)</div>
        <div className="pipe">{stages.map(([nm, st, cls]) =>
            <div className="pstage" key={nm}><div className="nm">{nm}<span>{st}</span></div><span className={'stt ' + cls}>{cls === 'done' ? 'ran' : cls === 'off' ? 'not called' : 'pending'}</span></div>)}</div>
        <div className="group-label">Source - imported example predictions</div>
        <div className="kv">
            <div className="row"><span>data</span><b>backend handoff - predictions.json, facts.json, result.json (tag fresh1)</b></div>
            <div className="row"><span>models</span><b>imported example clip predictions (origin unverified): earlier saved head - final benchmark: 384-clip frozen head (sha c5af2cb4) - different models, reported separately</b></div>
            <div className="row"><span>final eval</span><b>final_result.json - CI wide on 5 sources (0.35-0.61); majority class 40.2%</b></div>
            <div className="row"><span>live inference</span><b>optional local backend - see the Analyze panel</b></div>
            <div className="row"><span>gate</span><b>alert {D.run.alert} - approval {D.run.approval}</b></div>
        </div>
        </details>
        <div className="attrib">{D.run.attribution}</div>
    </div>;

    const views: Record<string, React.ReactNode> = { projects: <Projects />, assistant: <Assistant onTools={() => setView('run')} />, clips: clipsView, review: reviewView, run: runView };
    const tab = (v: string, label: string, badge?: string) =>
        <button key={v} className={'tab' + (view === v ? ' active' : '')} onClick={() => setView(v)}>{label}{badge && <em className="badge-dot" title="8 clips queued, covered by 1 run-level alert">{badge}</em>}</button>;

    const railItem = (v: string, label: string) => <button key={v} className={'rail-item' + (view === v ? ' active' : '')} onClick={() => setView(v)} aria-label={label} aria-current={view === v ? 'page' : undefined}><span className="lbl">{label}</span><span className="tick"></span></button>;
    return <div id="app" className="is-assistant">
        <aside id="rail"><span className="mark"><img className="brand-mark" src={MARK_SRC} width={34} height={34} alt="" /></span><nav>{railItem('assistant', 'Assistant')}{railItem('clips', 'Clips')}{railItem('run', 'Tools')}{railItem('review', 'Review')}{railItem('projects', 'Projects')}</nav><div className="unval"><i></i><b>Unconfirmed</b></div></aside>
        <div id="main">
            {header}
            <main id="view">{views[view]}</main>
        </div>
        <nav id="tabbar">{tab('assistant', 'Assistant')}{tab('clips', 'Clips')}{tab('run', 'Tools')}{tab('review', 'Review', liveRun ? '8 demo + 1 run' : '8 demo clips')}{tab('projects', 'Projects')}<span className="unval-m"><i></i>Unconfirmed</span></nav>
    </div>;
}
