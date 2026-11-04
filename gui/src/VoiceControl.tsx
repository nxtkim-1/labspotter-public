import { useRef, useState } from 'react';
import { voiceTranscribe } from './backend';

// Turn a recorded blob into 16 kHz mono 16-bit PCM WAV (what the Meta endpoint takes).
async function toWav(blob: Blob): Promise<Blob> {
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    const n = Math.max(1, Math.ceil(buf.duration * 16000));
    const off = new OfflineAudioContext(1, n, 16000);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, 16000, true); out.setUint32(28, 32000, true);
    out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return new Blob([out.buffer], { type: 'audio/wav' });
}

export type VoiceIntent = 'start' | 'save' | 'freeze';
const LABEL: Record<VoiceIntent, string> = { start: 'Yes, start it', save: 'Yes, save it', freeze: 'Yes, freeze it' };

// Voice only proposes one of three BenchFreeze actions. A tap runs it. Voice never approves, acknowledges, clears safety or speaks a resume token.
export function VoiceControl({ ep, voice, canDo, run }: { ep: string; voice?: { available: boolean; reason: string }; canDo: Record<VoiceIntent, boolean>; run: (i: VoiceIntent) => void }) {
    const [state, setState] = useState<'idle' | 'rec' | 'send'>('idle');
    const [heard, setHeard] = useState<{ text: string; intent: VoiceIntent | null } | null>(null);
    const [err, setErr] = useState('');
    const rec = useRef<MediaRecorder | null>(null); const stopT = useRef<number>(0);
    const avail = !!voice && voice.available;
    const stop = () => { window.clearTimeout(stopT.current); if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); };
    const start = async () => {
        setErr(''); setHeard(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const chunks: Blob[] = []; const r = new MediaRecorder(stream); rec.current = r;
            r.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
            r.onstop = async () => {
                stream.getTracks().forEach(t => t.stop()); setState('send');
                try {
                    const o = await voiceTranscribe(ep, await toWav(new Blob(chunks)));
                    setHeard({ text: o.transcript, intent: (o.intent as VoiceIntent | null) || null });
                } catch (e: any) { setErr(String(e && e.message ? e.message : e)); } finally { setState('idle'); }
            };
            r.start(); setState('rec'); stopT.current = window.setTimeout(stop, 8000);
        } catch (e: any) { setErr(e && e.name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow it in the browser to use voice.' : 'No microphone available.'); setState('idle'); }
    };
    return <div className="vc">
        <div className="vc-row">
            <button className={'vc-mic' + (state === 'rec' ? ' rec' : '')} disabled={!avail || state === 'send'} aria-label="Voice command" onClick={state === 'rec' ? stop : start}>
                {state === 'rec' ? 'Stop' : state === 'send' ? 'Listening to your clip...' : 'Speak a command'}</button>
            <span className="vc-hint">{avail ? 'Say "start session", "save result" or "freeze". Powered by Meta Muse Voice Transcribe.' : (voice ? voice.reason : 'Connect to the backend to use voice.')}</span>
        </div>
        {heard && <div className="vc-heard">Heard: "{heard.text}"
            {heard.intent ? <span> - <button className={'bk-load' + (canDo[heard.intent] ? '' : ' disabled')} disabled={!canDo[heard.intent]} onClick={() => { run(heard.intent as VoiceIntent); setHeard(null); }}>{LABEL[heard.intent]}</button>{!canDo[heard.intent] && <span className="vc-hint"> (not available yet)</span>}</span>
                : <span className="vc-hint"> - no matching command. Voice can only start a session, save a result or freeze.</span>}
            <button className="vc-x" onClick={() => setHeard(null)}>Dismiss</button></div>}
        {err && <div className="bk-error"><b>Voice:</b> {err}</div>}
    </div>;
}
