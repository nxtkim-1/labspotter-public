// liveCapture: camera, rolling segment recorder and browser speech for LabSpotter.
// Browser-only, no network calls. All browser globals can be replaced through
// the optional `deps` argument so the module can be tested in Node.

// ---------- shared ----------

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
};

/** Stops every track of a stream. Safe to call more than once. */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

// ---------- 1. camera ----------

export type CameraFailReason =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'not-found'
  | 'in-use'
  | 'unknown';

export type CameraResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: CameraFailReason; message: string };

export interface CameraOptions {
  facingMode?: 'environment' | 'user';
  width?: number;
  height?: number;
  frameRate?: number;
}

export interface CameraDeps {
  isSecureContext: boolean;
  mediaDevices?: { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> };
}

const CAMERA_MESSAGES: Record<CameraFailReason, string> = {
  'insecure-context':
    'The camera needs a secure page (https or localhost). Plain http LAN addresses are blocked by the browser.',
  unsupported: 'This browser cannot open the camera.',
  'permission-denied': 'Camera permission was denied. Allow camera access in the browser settings and try again.',
  'not-found': 'No suitable camera was found on this device.',
  'in-use': 'The camera is in use by another app or tab, or could not be started.',
  unknown: 'The camera could not be opened.',
};

function cameraFail(reason: CameraFailReason): CameraResult {
  return { ok: false, reason, message: CAMERA_MESSAGES[reason] };
}

function defaultCameraDeps(): CameraDeps {
  const g = globalThis as { isSecureContext?: boolean; navigator?: { mediaDevices?: CameraDeps['mediaDevices'] } };
  return { isSecureContext: g.isSecureContext === true, mediaDevices: g.navigator?.mediaDevices };
}

export function cameraErrorReason(err: unknown): CameraFailReason {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission-denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'not-found';
    case 'NotReadableError':
    case 'AbortError':
      return 'in-use';
    default:
      return 'unknown';
  }
}

/** Opens the camera (rear by default, ~640x480 @ 30 fps ideal). Never throws. */
export async function openCamera(opts: CameraOptions = {}, deps: CameraDeps = defaultCameraDeps()): Promise<CameraResult> {
  if (!deps.isSecureContext) return cameraFail('insecure-context');
  const getUserMedia = deps.mediaDevices?.getUserMedia;
  if (typeof getUserMedia !== 'function') return cameraFail('unsupported');

  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: opts.facingMode ?? 'environment' },
      width: { ideal: opts.width ?? 640 },
      height: { ideal: opts.height ?? 480 },
      frameRate: { ideal: opts.frameRate ?? 30 },
    },
  };
  try {
    const stream = await getUserMedia.call(deps.mediaDevices, constraints);
    return { ok: true, stream };
  } catch (err) {
    return cameraFail(cameraErrorReason(err));
  }
}

// ---------- 2. rolling segment recorder ----------

export const MIME_PREFERENCE = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8'] as const;

/** Minimal MediaRecorder surface this module uses. */
export interface RecorderLike {
  readonly mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(): void;
  stop(): void;
}

export interface RecorderCtor {
  new (stream: MediaStream, options?: { mimeType?: string; videoBitsPerSecond?: number }): RecorderLike;
  isTypeSupported?(type: string): boolean;
}

export interface RecorderDeps {
  MediaRecorder?: RecorderCtor;
  timers: Timers;
  now: () => number;
}

function defaultRecorderDeps(): RecorderDeps {
  const g = globalThis as { MediaRecorder?: unknown };
  return { MediaRecorder: g.MediaRecorder as RecorderCtor | undefined, timers: realTimers, now: () => Date.now() };
}

/** First supported preferred type, or '' to let the browser choose its default. */
export function pickMimeType(ctor: Pick<RecorderCtor, 'isTypeSupported'>): string {
  if (typeof ctor.isTypeSupported !== 'function') return '';
  for (const type of MIME_PREFERENCE) {
    try {
      if (ctor.isTypeSupported(type)) return type;
    } catch {
      // treat as unsupported
    }
  }
  return '';
}

export interface Segment {
  id: number;
  blob: Blob;
  mimeType: string;
  startedAt: number;
  durationMs: number;
}

export interface SegmentRecorderOptions {
  segmentMs?: number; // default 5000
  videoBitsPerSecond?: number; // default 400000 so a 5 s segment stays under the quick-look size limit
  maxQueue?: number; // default 3
  onSegment?: (segment: Segment) => void; // a new segment is waiting; call take() to get it
  onDrop?: (segment: Segment) => void; // oldest pending segment was dropped
  onError?: (message: string) => void;
}

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface SegmentRecorder {
  readonly mimeType: string;
  readonly state: RecorderState;
  readonly pending: number;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Removes and returns the oldest pending segment, or undefined if none. */
  take(): Segment | undefined;
}

export type SegmentRecorderResult =
  | { ok: true; recorder: SegmentRecorder }
  | { ok: false; reason: 'unsupported'; message: string };
export function createSegmentRecorder(
  stream: MediaStream,
  opts: SegmentRecorderOptions = {},
  deps: RecorderDeps = defaultRecorderDeps(),
): SegmentRecorderResult {
  const Ctor = deps.MediaRecorder;
  if (typeof Ctor !== 'function') {
    return { ok: false, reason: 'unsupported', message: 'This browser cannot record video (MediaRecorder is missing).' };
  }
  const segmentMs = opts.segmentMs ?? 5000;
  const maxQueue = Math.max(1, opts.maxQueue ?? 3);
  const mimeType = pickMimeType(Ctor);
  const queue: Segment[] = [];
  let state: RecorderState = 'idle';
  let current: RecorderLike | null = null;
  let timer: unknown = null;
  let nextId = 1;

  const reportError = (message: string) => opts.onError?.(message);

  function clearTimer(): void {
    if (timer !== null) deps.timers.clearTimeout(timer);
    timer = null;
  }

  function enqueue(segment: Segment): void {
    queue.push(segment);
    while (queue.length > maxQueue) {
      const dropped = queue.shift();
      if (dropped) opts.onDrop?.(dropped);
    }
    opts.onSegment?.(segment);
  }

  // Each segment gets a fresh MediaRecorder so every Blob is a complete, playable file.
  function startSegment(): void {
    let rec: RecorderLike;
    try {
      rec = mimeType ? new Ctor!(stream, { mimeType, videoBitsPerSecond: opts.videoBitsPerSecond ?? 400000 }) : new Ctor!(stream, { videoBitsPerSecond: opts.videoBitsPerSecond ?? 400000 });
    } catch {
      reportError('Recording could not start in this browser.');
      shutdown();
      return;
    }
    const chunks: Blob[] = [];
    const startedAt = deps.now();
    current = rec;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onerror = () => reportError('Recording failed for one segment.');
    rec.onstop = () => {
      const type = rec.mimeType || mimeType;
      if (chunks.length > 0) {
        enqueue({ id: nextId++, blob: new Blob(chunks, { type }), mimeType: type, startedAt, durationMs: deps.now() - startedAt });
      }
      // Roll over only if this recorder ended because its time slot ran out.
      if (current === rec) {
        current = null;
        if (state === 'recording') startSegment();
      }
    };
    try {
      rec.start(); // no timeslice: one complete file per recorder
    } catch {
      current = null;
      reportError('Recording could not start in this browser.');
      shutdown();
      return;
    }
    timer = deps.timers.setTimeout(() => {
      timer = null;
      safeStop(rec);
    }, segmentMs);
  }

  function safeStop(rec: RecorderLike): void {
    try {
      rec.stop();
    } catch {
      // already stopped
    }
  }

  // Ends the current segment early; its data is still delivered via onstop.
  function finishCurrent(): void {
    clearTimer();
    const rec = current;
    current = null;
    if (rec) safeStop(rec);
  }

  function shutdown(): void {
    state = 'stopped';
    finishCurrent();
    stopStream(stream);
  }

  const recorder: SegmentRecorder = {
    get mimeType() {
      return mimeType;
    },
    get state() {
      return state;
    },
    get pending() {
      return queue.length;
    },
    start() {
      if (state !== 'idle') return;
      state = 'recording';
      startSegment();
    },
    pause() {
      if (state !== 'recording') return;
      state = 'paused';
      finishCurrent(); // flushes the partial segment
    },
    resume() {
      if (state !== 'paused') return;
      state = 'recording';
      startSegment();
    },
    stop() {
      if (state === 'stopped') return;
      shutdown();
    },
    take() {
      return queue.shift();
    },
  };
  return { ok: true, recorder };
}

// ---------- 3. browser speech ----------

export type SpeakResult =
  | { ok: true; voice: 'browser' }
  | { ok: false; voice: 'browser'; reason: 'unavailable' | 'empty' | 'error' | 'timeout'; message: string };

export interface UtteranceLike {
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface SpeechDeps {
  speechSynthesis?: { speak(u: UtteranceLike): void; cancel(): void };
  SpeechSynthesisUtterance?: new (text: string) => UtteranceLike;
  timers: Timers;
}

function defaultSpeechDeps(): SpeechDeps {
  const g = globalThis as { speechSynthesis?: unknown; SpeechSynthesisUtterance?: unknown };
  return {
    speechSynthesis: g.speechSynthesis as SpeechDeps['speechSynthesis'],
    SpeechSynthesisUtterance: g.SpeechSynthesisUtterance as SpeechDeps['SpeechSynthesisUtterance'],
    timers: realTimers,
  };
}

/** Speaks text with the browser's built-in voice. Resolves on end or error; never rejects. */
export function speakRecap(text: string, opts: { timeoutMs?: number } = {}, deps: SpeechDeps = defaultSpeechDeps()): Promise<SpeakResult> {
  const synth = deps.speechSynthesis;
  const Utterance = deps.SpeechSynthesisUtterance;
  if (!synth || typeof Utterance !== 'function') {
    return Promise.resolve({ ok: false, voice: 'browser', reason: 'unavailable', message: 'Spoken recap is not available in this browser.' });
  }
  if (!text.trim()) {
    return Promise.resolve({ ok: false, voice: 'browser', reason: 'empty', message: 'Nothing to say.' });
  }
  return new Promise<SpeakResult>((resolve) => {
    let settled = false;
    let timer: unknown = null;
    const finish = (result: SpeakResult) => {
      if (settled) return;
      settled = true;
      if (timer !== null) deps.timers.clearTimeout(timer);
      resolve(result);
    };
    try {
      const u = new Utterance(text);
      u.onend = () => finish({ ok: true, voice: 'browser' });
      u.onerror = () => finish({ ok: false, voice: 'browser', reason: 'error', message: 'The browser voice stopped with an error.' });
      timer = deps.timers.setTimeout(() => {
        try {
          synth.cancel();
        } catch {
          // ignore
        }
        finish({ ok: false, voice: 'browser', reason: 'timeout', message: 'The browser voice did not finish in time.' });
      }, opts.timeoutMs ?? 60000);
      synth.cancel(); // do not queue behind an older recap
      synth.speak(u);
    } catch {
      finish({ ok: false, voice: 'browser', reason: 'error', message: 'The browser voice could not start.' });
    }
  });
}
