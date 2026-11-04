// GUI unit tests for speakRecap with a fake speech engine (no audio, no browser). Run from app/: node --test gui/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakRecap } from '../src/liveCapture.ts';
const timers = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: unknown) => clearTimeout(h as any) };
function fake(behaviour: 'end' | 'error' | 'silent' | 'throw', cancelThrows = false) {
  const spoken: string[] = []; let cancels = 0;
  class U { onend: any = null; onerror: any = null; text: string; constructor(t: string) { this.text = t; } }
  const synth = {
    speak(u: any) { spoken.push(u.text); if (behaviour === 'throw') throw new Error('x'); if (behaviour === 'end') setTimeout(() => u.onend && u.onend(), 1); if (behaviour === 'error') setTimeout(() => u.onerror && u.onerror({}), 1); },
    cancel() { cancels++; if (cancelThrows) throw new Error('c'); },
  };
  return { deps: { speechSynthesis: synth, SpeechSynthesisUtterance: U as any, timers }, spoken, cancels: () => cancels };
}
test('no speech engine: unavailable, never throws', async () => {
  const r = await speakRecap('hello', {}, { timers });
  assert.equal(r.ok, false); assert.equal((r as any).reason, 'unavailable');
});
test('empty or blank text: nothing is spoken', async () => {
  const f = fake('end');
  for (const t of ['', '   \n']) { const r = await speakRecap(t, {}, f.deps); assert.equal((r as any).reason, 'empty'); }
  assert.equal(f.spoken.length, 0);
});
test('speaks once, cancels older speech first, ok on end', async () => {
  const f = fake('end'); const r = await speakRecap('Your recap', {}, f.deps);
  assert.equal(r.ok, true); assert.deepEqual(f.spoken, ['Your recap']); assert.equal(f.cancels(), 1);
});
test('engine error event: reported as error', async () => {
  const r = await speakRecap('x', {}, fake('error').deps); assert.equal((r as any).reason, 'error');
});
test('speak() throws (for example blocked without a tap): error, not a crash', async () => {
  const r = await speakRecap('x', {}, fake('throw').deps); assert.equal((r as any).reason, 'error');
});
test('engine never answers (no voices installed): times out and says so', async () => {
  const f = fake('silent'); const r = await speakRecap('x', { timeoutMs: 20 }, f.deps);
  assert.equal((r as any).reason, 'timeout'); assert.equal(f.cancels(), 2);
});
test('timeout still settles if cancel() throws', async () => {
  const r = await speakRecap('x', { timeoutMs: 20 }, fake('silent', true).deps);
  // cancel() throws on the first call (before speak), which is caught and reported as an error; this is still a settled result
  assert.equal(r.ok, false);
});
