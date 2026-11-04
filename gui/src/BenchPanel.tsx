import { useEffect, useRef, useState } from 'react';
import { VoiceControl } from './VoiceControl';
import { agentCoach, agentReview, benchNote, benchClaim, benchCreate, benchFreeze, benchInfo, benchResume, benchList, benchContinue, BenchSessionRow, BenchCp, BenchLabels } from './backend';

const when = (t?: number) => t ? new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
const KIND: Record<string, string> = { user_observation: 'Your note', user_question: 'Your question', user_protocol_loaded: 'Protocol loaded', user_learner_confirmed: 'You confirmed a step' };
const label = (c: BenchCp) => KIND[c.evidence[0] ? c.evidence[0].kind : ''] || 'Model suggestion';
type Proto = { title: string; source: string; steps: string[] };
// A harmless EXAMPLE only. It is not a lab SOP, not assigned by anyone, and not validated.
const EXAMPLE: Proto = { title: 'Water measuring walkthrough (EXAMPLE)', source: 'Written for this demo as a harmless example. Water only. Not a lab procedure.',
    steps: ['Pour about 50 mL of water into a graduated cylinder.', 'Read the level at eye height, at the bottom of the curve.', 'Pour the water into a beaker.', 'Write down the volume you read.'] };

const body = (c: BenchCp) => (c.notes[0] || '').replace(/^[A-Z ]+(\([^)]*\))?( typed by the user| loaded by the user| by the learner's own tap)?[^:]*: /, '');
const claimText = (n: string) => { const m = /claim: (.+?) \(p=([0-9.]+)\) from clip run (\S+?)\./.exec(n || ''); return m ? 'Suggested step: "' + m[1].replace(/_/g, ' ') + '" in clip ' + m[3] : (n || ''); };
const kindOf = (c: BenchCp) => c.evidence[0] ? c.evidence[0].kind : '';
// Read-only log built only from the persisted checkpoints of this session. Nothing is added that is not stored.
function SessionLog({ cps }: { cps: BenchCp[] }) {
    if (cps.length === 0) return <div className="bk-note">Nothing saved in this session yet.</div>;
    return <ol className="bf-log">{cps.map(c => { const k = kindOf(c); const model = !k.startsWith('user_');
        const chip = model ? '' : k === 'user_learner_confirmed' ? 'Confirmed by you' : '';
        const text = model ? claimText(c.notes[0]) : k === 'user_protocol_loaded' ? body(c).split(' | steps:')[0].replace(/ - source:/, '. Source:') : body(c);
        const tech = k === 'user_learner_confirmed' ? 'Confirmed by your own tap. It was not checked against the bench or by the classifier. ' : model ? 'Status: unconfirmed model suggestion, needs your review. It is not an observed action. ' : '';
        return <li key={c.id} data-status={model ? 'unconfirmed-needs-review' : k === 'user_learner_confirmed' ? 'confirmed-by-user' : 'user-entry'}>
            <div className="bf-log-h"><b>{label(c)}</b>{chip && <span className={'bf-chip' + (model ? ' warn' : '')}>{chip}</span>}<span className="bf-when">{when(c.t)}</span></div>
            <div className="bf-log-b">{text}</div>
            <details className="bf-tech"><summary>Details</summary>{tech}step {c.step} - hash {c.hash}</details>
        </li>; })}</ol>;
}

// BenchFreeze: save and resume the record of model-predicted clip claims. Not a bench check.
export function BenchPanel({ ep, enabled, claimTag, voice }: { ep: string; enabled: boolean; claimTag: string; voice?: { available: boolean; reason: string } }) {
    const [sid, setSid] = useState('');
    const [cps, setCps] = useState<BenchCp[]>([]);
    const [token, setToken] = useState('');
    const [frozenNote, setFrozenNote] = useState('');
    const [resumeTok, setResumeTok] = useState('');
    const [resumed, setResumed] = useState<{ session_id: string; checkpoint: BenchCp; record_intact: boolean } & BenchLabels | null>(null);
    const [recap, setRecap] = useState<BenchCp[] | null>(null);
    const [agent, setAgent] = useState('');
    const [coach, setCoach] = useState('');
    const [showTok, setShowTok] = useState(false);
    const [mode, setMode] = useState<'research' | 'teaching'>('research');
    const [noteKind, setNoteKind] = useState('observation');
    const [noteText, setNoteText] = useState('');
    const [proto, setProto] = useState<Proto | null>(null);
    const [protoText, setProtoText] = useState('');
    const [done, setDone] = useState<number[]>([]);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const run = async (f: () => Promise<void>) => { setErr(''); setBusy(true); try { await f(); } catch (e: any) { setErr(String(e && e.message ? e.message : e)); } finally { setBusy(false); } };
    const start = () => run(async () => { const r = await benchCreate(ep, 'session'); setSid(r.session_id); setCps([]); setToken(''); setFrozenNote(''); setResumed(null); setRecap(null); });
    const save = () => run(async () => { await benchClaim(ep, sid, claimTag); const i = await benchInfo(ep, sid); setCps(i.checkpoints); setToken(''); });
    const freeze = () => run(async () => { const r = await benchFreeze(ep, sid, 'interruption'); setToken(r.token); setShowTok(false); setFrozenNote(r.frozen_status_note); });
    const restoreProto = (list: BenchCp[]) => {
        const pi = list.map(kindOf).lastIndexOf('user_protocol_loaded'); setProto(null); setDone([]);
        if (pi < 0) return;
        const m = /^(.*?) - source: (.*?) - \d+ steps \| steps: (.*)$/.exec(body(list[pi]));
        if (!m) return;
        setProto({ title: m[1], source: m[2], steps: m[3].split(/; (?=\d+\. )/).map(x => x.replace(/^\d+\. /, '')) });
        setDone(list.slice(pi + 1).filter(c => kindOf(c) === 'user_learner_confirmed').map(c => { const n = /^Step (\d+):/.exec(body(c)); return n ? parseInt(n[1], 10) - 1 : -1; }).filter(i => i >= 0));
    };
    const doResume = async (tok: string) => { setRecap(null); const r = await benchResume(ep, tok.trim()); const info = await benchInfo(ep, r.session_id); setResumed(r); setSid(r.session_id); setCps(info.checkpoints); setToken(''); setFrozenNote(''); restoreProto(info.checkpoints); setMode(info.checkpoints.some(c => kindOf(c) === 'user_protocol_loaded') ? 'teaching' : 'research'); };
    const resume = () => run(async () => { await doResume(resumeTok); });
    const [saved, setSaved] = useState<BenchSessionRow[]>([]);
    useEffect(() => { if (!enabled) return; let live = true; benchList(ep).then(r => { if (live) setSaved(r.sessions); }).catch(() => { if (live) setSaved([]); }); return () => { live = false; }; }, [ep, enabled, sid, cps.length, resumed]);
    const continueSaved = (id: string) => run(async () => { setRecap(null); const r = await benchContinue(ep, id); const info = await benchInfo(ep, r.session_id); setResumed(r); setSid(r.session_id); setCps(info.checkpoints); setToken(''); setFrozenNote(''); restoreProto(info.checkpoints); setMode(info.checkpoints.some(c => kindOf(c) === 'user_protocol_loaded') ? 'teaching' : 'research'); });
    const fileRef = useRef<HTMLInputElement>(null);
    const downloadFile = () => { const blob = new Blob([JSON.stringify({ labspotter_session: 1, session_id: sid, key: token })], { type: 'application/json' }); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'labspotter-session-' + sid + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; run(async () => { let j: any; try { j = JSON.parse(await f.text()); } catch { throw new Error('That is not a LabSpotter session file.'); } if (!j || j.labspotter_session !== 1 || typeof j.key !== 'string' || !j.key) throw new Error('That is not a LabSpotter session file.'); await doResume(j.key); }); };
    const review = () => run(async () => { if (resumed) setRecap((await benchInfo(ep, resumed.session_id)).checkpoints); });
    const addNote = () => run(async () => { await benchNote(ep, sid, noteKind, noteText); setNoteText(''); setCps((await benchInfo(ep, sid)).checkpoints); });
    const loadProto = (p: Proto) => run(async () => { await benchNote(ep, sid, 'protocol_loaded', p.title + ' - source: ' + p.source + ' - ' + p.steps.length + ' steps | steps: ' + p.steps.map((x, i) => (i + 1) + '. ' + x).join('; ')); setProto(p); setDone([]); setCps((await benchInfo(ep, sid)).checkpoints); });
    const parseProto = () => { try { const j = JSON.parse(protoText); if (!j || typeof j.title !== 'string' || typeof j.source !== 'string' || !Array.isArray(j.steps) || !j.steps.length || j.steps.some((x: any) => typeof x !== 'string')) throw new Error('x'); loadProto({ title: j.title.slice(0, 120), source: j.source.slice(0, 200), steps: j.steps.slice(0, 30).map((x: string) => x.slice(0, 200)) }); } catch { setErr('That protocol is not in the expected form: {"title": "...", "source": "...", "steps": ["...", "..."]}'); } };
    const confirmStep = (i: number) => run(async () => { await benchNote(ep, sid, 'learner_confirmed', 'Step ' + (i + 1) + ': ' + (proto as Proto).steps[i]); setDone(d => [...d, i]); setCps((await benchInfo(ep, sid)).checkpoints); });
    const lastClaim = [...cps].reverse().find(c => c.notes[0] && c.notes[0].startsWith('UNVALIDATED'));
    const askAgent = async () => { setAgent('Asking the Meta agent...'); try { const r = await agentReview(ep, claimTag); setAgent(r.steps.map(s => s.step + ': code gate says ' + s.final + (s.overclaim ? ' (agent over-claimed, gate wins)' : '')).join('\n') || 'No protocol steps to review.'); } catch (e: any) { setAgent(String(e && e.message ? e.message : e)); } };
    const askCoach = async () => { setCoach('Asking the Meta agent...'); try { const r = await agentCoach(ep, sid); setCoach([r.recap, r.open_questions.length ? 'Questions for you:\n- ' + r.open_questions.join('\n- ') : '', r.next_steps.length ? 'Possible next steps (suggestions only):\n- ' + r.next_steps.join('\n- ') : ''].filter(Boolean).join('\n\n')); } catch (e: any) { setCoach(String(e && e.message ? e.message : e)); } };
    const off = !enabled || busy;
    const canDo = { start: !off, save: !off && !!sid && !!claimTag, freeze: !off && !!sid && cps.length > 0 };
    const runVoice = (i: 'start' | 'save' | 'freeze') => { if (i === 'start') start(); else if (i === 'save') save(); else freeze(); };
    // One primary action: the next sensible step.
    const primary = !sid ? { t: 'Start session', f: start, ok: !off }
        : claimTag && cps.length === 0 ? { t: 'Save this result', f: save, ok: canDo.save }
        : cps.length > 0 ? { t: 'Save session', f: freeze, ok: canDo.freeze }
        : { t: 'Analyze a clip to save it', f: () => {}, ok: false };
    return <div className="bf-panel">
        <div className="bf-title">Save and resume</div>
        <div className="bf-status">{!sid ? 'No session yet.' : `Session open - ${cps.length} saved entr${cps.length === 1 ? 'y' : 'ies'}${cps.filter(c => !kindOf(c).startsWith('user_')).length ? ', suggestions waiting for you to confirm' : ''}`}</div>
        <div className="bf-actions">
            <button className={'bk-load bf-primary' + (primary.ok ? '' : ' disabled')} disabled={!primary.ok} onClick={primary.f}>{primary.t}</button>
            <VoiceControl ep={ep} voice={enabled ? voice : undefined} canDo={canDo} run={runVoice} />
        </div>
        {sid && claimTag && cps.length > 0 && <button className={'bf-link' + (canDo.save ? '' : ' disabled')} disabled={!canDo.save} onClick={save}>Save another result ("{claimTag}")</button>}
        {sid && <button className="bf-link" disabled={off} onClick={start}>Start a new session</button>}
        {sid && <div className="bf-seg" role="group" aria-label="Session mode"><button className={mode === 'research' ? 'on' : ''} aria-pressed={mode === 'research'} onClick={() => setMode('research')}>Research</button><button className={mode === 'teaching' ? 'on' : ''} aria-pressed={mode === 'teaching'} onClick={() => setMode('teaching')}>Teaching</button></div>}
        {sid && <div className="bk-note">{mode === 'research' ? 'Research: log what the model suggested, add your observations and questions, freeze and resume later.' : 'Teaching: follow a written protocol step by step. You confirm each step yourself; the model only suggests.'}</div>}
        <details className="bf-more"><summary>What this does and does not do</summary>
            <div className="bk-note">Saves the model-predicted claims from your clip runs as an <b>unconfirmed</b> record and restores it later. It does not check the bench: bench state is unknown, there are no camera or sensor readings, and a restored record is not a safety clearance.</div>
        </details>
        {token && <div className="bf-token"><div className="bk-note"><b>Session saved.</b> Find it under Saved sessions whenever you want to continue.</div>
            <details className="bf-more"><summary>Advanced: backup file and key</summary>
                <div className="bk-note">{frozenNote}</div>
                <div className="bk-note">An optional portable backup that works on its own, for another backend or a restored copy. The key inside is private. It is shown once and kept only in this page.</div>
                <div className="bf-noterow"><button className="bk-load" onClick={downloadFile}>Download session file</button></div>
                <code className="bf-code">{showTok ? token : '\u2022'.repeat(24)}</code>
                <div className="bf-noterow"><button className="bk-load" onClick={() => setShowTok(v => !v)}>{showTok ? 'Hide token' : 'Show token'}</button>
                    <button className="bk-load" onClick={() => { try { navigator.clipboard.writeText(token); } catch { /* clipboard unavailable: use Show token */ } }}>Copy token</button></div></details></div>}
        {sid && <details className="bf-more" open><summary>Session log ({cps.length})</summary><SessionLog cps={cps} /></details>}
        {sid && mode === 'research' && <details className="bf-more" open><summary>Add a note (observation or question)</summary>
            <div className="bf-noterow"><select value={noteKind} onChange={e => setNoteKind(e.target.value)}><option value="observation">Observation</option><option value="question">Question</option></select>
                <input type="text" maxLength={500} placeholder="what you saw or want to ask" value={noteText} onChange={e => setNoteText(e.target.value)} />
                <button className={'bk-load' + (off || !noteText.trim() ? ' disabled' : '')} disabled={off || !noteText.trim()} onClick={addNote}>Add</button></div>
            <div className="bk-note">Saved with the session as your own words, unverified. The classifier does not write notes.</div>
        </details>}
        {sid && mode === 'teaching' && <div className="bf-teach"><div className="bf-sub">Guided walkthrough</div>
            {!proto && <div>
                <button className="bk-load" disabled={off} onClick={() => loadProto(EXAMPLE)}>Try the water-measuring example</button>
                <div className="bk-note">Or paste your own protocol as JSON with a title, a source and a list of steps. It is shown with its source and is not treated as validated.</div>
                <textarea rows={3} className="bf-proto" value={protoText} onChange={e => setProtoText(e.target.value)} spellCheck={false} placeholder='{"title": "...", "source": "...", "steps": ["..."]}' />
                <button className={'bk-load' + (off || !protoText.trim() ? ' disabled' : '')} disabled={off || !protoText.trim()} onClick={parseProto}>Load protocol</button></div>}
            {proto && <div>
                <div className="bk-note"><b>{proto.title}</b> - source: {proto.source}</div>
                <ol className="bf-steps">{proto.steps.map((st, i) => <li key={i}>{st} {done.includes(i) ? <span className="bf-chip">YOU CONFIRMED</span> : <button className="bf-link" disabled={off} onClick={() => confirmStep(i)}>I did this step</button>}</li>)}</ol>
                {lastClaim && <div className="bk-note">Latest model suggestion (never marks a step done): {claimText(lastClaim.notes[0])}</div>}
                <div className="bk-note">Steps are marked only when you tap them.</div>
                <div className="bf-noterow"><input type="text" maxLength={500} placeholder="ask or note something about this step" value={noteText} onChange={e => setNoteText(e.target.value)} />
                    <button className={'bk-load' + (off || !noteText.trim() ? ' disabled' : '')} disabled={off || !noteText.trim()} onClick={() => run(async () => { await benchNote(ep, sid, 'question', noteText); setNoteText(''); setCps((await benchInfo(ep, sid)).checkpoints); })}>Ask</button></div>
            </div>}
        </div>}
        <div className="bf-continue"><div className="bf-sub">Saved sessions</div>
            {saved.length === 0 && <div className="bk-note">Nothing saved yet. Start a session, add a result, then Save session.</div>}
            <ul className="bf-saved">{saved.map(r => <li key={r.session_id}><span><b>{r.entries === null ? 'Saved session' : 'Saved ' + when(r.last_t || r.created)}</b>{r.entries === null ? ' - the record failed its integrity check' : ' - ' + r.entries + (r.entries === 1 ? ' entry' : ' entries') + (r.frozen ? ', frozen' : '')}</span>
                {r.intact && (r.entries || 0) > 0 && <button className={'bk-load' + (off ? ' disabled' : '')} disabled={off} onClick={() => continueSaved(r.session_id)}>Continue</button>}</li>)}</ul>
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFile} />
            <details className="bf-more"><summary>Advanced: use a backup file or key</summary>
                <button className={'bk-load' + (off ? ' disabled' : '')} disabled={off} onClick={() => fileRef.current && fileRef.current.click()}>Choose backup file</button>
                <div className="bk-row"><span>resume</span>
                    <input type="password" placeholder="paste a resume token" value={resumeTok} onChange={e => setResumeTok(e.target.value)} spellCheck={false} />
                    <button className={'bk-load' + (off || !resumeTok.trim() ? ' disabled' : '')} disabled={off || !resumeTok.trim()} onClick={resume}>Resume</button>
                </div></details></div>
        {resumed && <div className="bf-resumed">
            <div className="bk-note"><b>Session restored.</b> Your saved entries are back. This does not tell you the bench is unchanged or safe now, so check it in person.</div>
            <details className="bf-more"><summary>Verification details</summary>
                <div className="bk-note">Saved record intact: {resumed.record_intact ? 'yes' : 'NO'}. Session {resumed.session_id}. {resumed.meaning}</div>
                <div className="bf-chips"><span className="bf-chip warn">BENCH STATE: {resumed.bench_state}</span><span className="bf-chip warn">SAFETY CLEARANCE: {resumed.safety_clearance ? 'YES' : 'NO'}</span></div></details>
            {!recap && <button className="bk-load" disabled={busy} onClick={review}>Review what was saved (optional)</button>}
            {recap && <div className="bf-recap">
                <div className="bk-note"><b>What was saved</b> - {recap.length} entr{recap.length === 1 ? 'y' : 'ies'}, oldest first.</div>
                <SessionLog cps={recap} />
                <div className="bk-note"><b>What comes next:</b> no protocol is loaded in this build, so there is no list of next steps. Nothing here confirms that any step happened.</div>
            </div>}
        </div>}
        {(claimTag || sid) && <details className="bf-more"><summary>Meta agent (optional)</summary>
            {sid && cps.length > 0 && <button className="bk-load" onClick={askCoach}>Recap my session and suggest questions</button>}
            {coach && <pre className="bf-agent">{coach}</pre>}
            {claimTag && <button className="bk-load" onClick={askAgent}>Check "{claimTag}" against the protocol gate</button>}
            {agent && <pre className="bf-agent">{agent}</pre>}
            <div className="bk-note">The agent only reads the text in your session log, never video. It suggests; you decide. The code gate decides protocol steps; nothing here approves one.</div>
        </details>}
        {err && <div className="bk-error"><b>Save and resume:</b> {err}</div>}
    </div>;
}
