// Live backend wiring for the portable build. Contract (server.py):
//   GET  /api/health           -> minimal readiness open; full details with token
//   POST /api/analyze?tag=T    -> body = one mp4 (4s / 16 frames @4fps); {predictions, result}   [token]
//   GET  /api/runs/T           -> {predictions, facts, result} for a past run                    [token]
//   GET  /api/detections       -> experimental boxes for the recorded demo clips                 [token]
// Auth: per-launch token as X-LabSpotter-Token. The launcher prints it in its Terminal window at
// startup; the user types it into the GUI once per launch. It lives in memory only - never
// localStorage, never the URL, never in served HTML, and never carried across endpoint origins.
// Every result is MODEL-PREDICTED and UNVALIDATED; the server never writes an approval.

export type Health = { status?: string; head?: string; measured?: string; encoder?: string; deps?: Record<string, unknown>; requires?: string; status_labels?: string; deps_ok?: boolean; auth?: string; voice?: { available: boolean; reason: string } };
export type RunData = { predictions?: any[]; facts?: any[]; result?: any };

const DEFAULT_EP = 'http://127.0.0.1:8765';

export function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
export function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked - persistence stays off */ } }

const PAGE_ORIGIN = location.protocol.startsWith('http') ? location.origin : '';
// Session token, entered by the user from the launcher's console output. Scoped to one endpoint
// origin; tokenFor() returns it only for that origin, so a token typed for backend A is never
// sent to backend B.
let sessionToken = '';
let tokenOrigin = '';
export function setSessionToken(t: string, forEp: string) {
    sessionToken = t; tokenOrigin = originOf(forEp);
}
export function originOf(ep: string): string { try { return new URL(ep).origin; } catch { return ''; } }
export function tokenFor(ep: string): string { return originOf(ep) === tokenOrigin ? sessionToken : ''; }
// Every endpoint needs a token typed in (there is no injected or stored credential).
export function needsManualToken(ep: string): boolean { return !tokenFor(ep); }

export function apiEndpoint(): string {
    const fallback = PAGE_ORIGIN || DEFAULT_EP;
    return (lsGet('labspotter_api') || fallback).replace(/\/+$/, '');
}
export function saveApiEndpoint(ep: string) { lsSet('labspotter_api', ep); }
// A ?api= link is a PROPOSAL, never auto-adopted or persisted - the user must confirm it in the UI.
export function queryEndpointProposal(): string | null {
    const q = new URLSearchParams(location.search).get('api');
    return q ? q.replace(/\/+$/, '') : null;
}

async function req<T>(ep: string, path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { ...(init && init.headers as any || {}) };
    const t = tokenFor(ep);
    if (t) headers['X-LabSpotter-Token'] = t;
    const r = await fetch(ep + path, { ...init, headers });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok) { const er: any = new Error(body && body.error ? String(body.error) : 'HTTP ' + r.status); er.status = r.status; throw er; }
    return body as T;
}
export const getHealth = (ep: string) => req<Health>(ep, '/api/health');
export const loadRun = (ep: string, tag: string) => req<RunData>(ep, '/api/runs/' + encodeURIComponent(tag));
export const analyzeClip = (ep: string, tag: string, file: File) =>
    req<{ predictions: any[]; result: any }>(ep, '/api/analyze?tag=' + encodeURIComponent(tag), { method: 'POST', body: file });

// BenchFreeze session routes (server.py -> bench_session.py). A session is a save/resume RECORD of model-predicted,
// unvalidated clip claims. It is never a bench-state reading: bench_state is always UNKNOWN and safety_clearance false.
export type BenchLabels = { bench_state: string; bench_readings: string; safety_clearance: boolean; meaning: string };
export type BenchCp = { id: string; t?: number; step: number; status: string; hash: string; tubes: number; notes: string[]; evidence: { kind: string; path: string }[] };
const J = { 'Content-Type': 'application/json' };
export const benchCreate = (ep: string, name: string) =>
    req<{ session_id: string } & BenchLabels>(ep, '/api/bench/session', { method: 'POST', headers: J, body: JSON.stringify({ name }) });
export const benchClaim = (ep: string, sid: string, run_tag: string) =>
    req<{ session_id: string; checkpoint: BenchCp } & BenchLabels>(ep, '/api/bench/session/' + sid + '/claim', { method: 'POST', headers: J, body: JSON.stringify({ run_tag }) });
export const benchFreeze = (ep: string, sid: string, name: string) =>
    req<{ token: string; session_id: string; checkpoint: BenchCp; frozen_status_note: string } & BenchLabels>(ep, '/api/bench/session/' + sid + '/freeze', { method: 'POST', headers: J, body: JSON.stringify({ name }) });
export const benchResume = (ep: string, token: string) =>
    req<{ session_id: string; checkpoint: BenchCp; record_intact: boolean } & BenchLabels>(ep, '/api/bench/resume', { method: 'POST', headers: J, body: JSON.stringify({ token }) });
export type BenchSessionRow = { session_id: string; created: number; intact: boolean; entries: number | null; last_t: number | null; frozen: { checkpoint_id: string; unchanged_since_freeze: boolean; entries_after_freeze: number | null } | null };
export const benchList = (ep: string) => req<{ sessions: BenchSessionRow[] } & BenchLabels>(ep, '/api/bench/sessions');
export const benchContinue = (ep: string, sid: string) =>
    req<{ session_id: string; checkpoint: BenchCp; record_intact: boolean } & BenchLabels>(ep, '/api/bench/session/' + sid + '/continue', { method: 'POST', headers: J, body: '{}' });
export const benchInfo = (ep: string, sid: string) =>
    req<{ session_id: string; checkpoints: BenchCp[] } & BenchLabels>(ep, '/api/bench/session/' + sid);

// Voice command (Meta Muse Voice Transcribe through the local server). The browser sends one short WAV; the server holds the key.
export const voiceTranscribe = (ep: string, wav: Blob) =>
    req<{ transcript: string; intent: string | null; seconds: number; model: string }>(ep, '/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });

export const agentReview = (ep: string, tag: string) =>
    req<{ steps: { step: string; gate: string; agent: string; final: string; overclaim: boolean }[]; agent_possible_mistakes: string[] | null; note: string }>(ep, '/api/agent/review?tag=' + encodeURIComponent(tag), { method: 'POST', headers: J, body: '{}' });

export const agentGlimpse = (ep: string, seg: Blob) =>
    req<{ text: string }>(ep, '/api/agent/glimpse', { method: 'POST', headers: { 'Content-Type': seg.type || 'application/octet-stream' }, body: seg });
export const agentCoach = (ep: string, sid: string) =>
    req<{ recap: string; open_questions: string[]; next_steps: string[]; note: string }>(ep, '/api/agent/coach?session=' + encodeURIComponent(sid), { method: 'POST', headers: J, body: '{}' });

export const benchNote = (ep: string, sid: string, kind: string, text: string) =>
    req<{ session_id: string; checkpoint: BenchCp } & BenchLabels>(ep, '/api/bench/session/' + sid + '/note', { method: 'POST', headers: J, body: JSON.stringify({ kind, text }) });

export const benchLabel = (ep: string, sid: string, run_tag: string, decision: 'agreed' | 'corrected', label: string) =>
    req<{ session_id: string; checkpoint: BenchCp } & BenchLabels>(ep, '/api/bench/session/' + sid + '/label', { method: 'POST', headers: J, body: JSON.stringify({ run_tag, decision, label }) });

export type Organization = { projects: { id: string; name: string; created: number }[]; labels: Record<string, { name: string; project: string }> };
export const getOrganization = (ep: string) => req<Organization>(ep, '/api/bench/projects');
export const saveOrganization = (ep: string, data: Record<string, string>) => req<Organization>(ep, '/api/bench/projects', { method: 'POST', headers: J, body: JSON.stringify(data) });
