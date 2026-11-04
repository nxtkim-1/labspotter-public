// Pure helpers for showing class probabilities of one prediction.
// Erasable TypeScript only (no enums/namespaces/parameter properties) so Node can run it with type stripping.

export type ProbRow = { label: string; p: number };
export type ProbRows = { rows: ProbRow[]; fallback: boolean };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const byProbDesc = (a: ProbRow, b: ProbRow): number =>
    b.p - a.p || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

// All classes from p.probs, sorted by probability descending (tie-break by label).
// Older stored runs only have p.top3: then those rows are returned with fallback=true.
// Neither present (or not usable) -> no rows, fallback=false.
// Non-finite or non-numeric probabilities are skipped.
export function predictionRows(pred: unknown): ProbRows {
    const p = pred && typeof pred === 'object' ? (pred as Record<string, unknown>) : {};
    const probs = p.probs;
    if (probs && typeof probs === 'object' && !Array.isArray(probs)) {
        const rows: ProbRow[] = [];
        for (const [label, v] of Object.entries(probs as Record<string, unknown>)) if (isNum(v)) rows.push({ label, p: v });
        return { rows: rows.sort(byProbDesc), fallback: false };
    }
    if (!Array.isArray(p.top3)) return { rows: [], fallback: false };
    const rows: ProbRow[] = [];
    for (const kv of p.top3) {
        if (Array.isArray(kv) && kv.length >= 2 && isNum(kv[1])) rows.push({ label: String(kv[0]), p: kv[1] });
    }
    return { rows: rows.sort(byProbDesc), fallback: true };
}

// Display-only label for a class key: 'PhaseSeparation step' -> 'Phase separation step'.
// Splits CamelCase, keeps all-caps acronym runs whole ('PCRStep' -> 'PCR step'), turns underscores
// into spaces, collapses whitespace and sentence-cases the result. Never throws; null/undefined -> ''.
// The key itself is data (API, stored runs, sorting, React keys) and must stay unchanged.
export function classLabel(key: unknown): string {
    if (key === null || key === undefined) return '';
    let s: string;
    try { s = typeof key === 'string' ? key : String(key); } catch { return ''; }
    const words = s
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/\s+/)
        .filter(w => w.length > 0)
        .map(w => (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w.toLowerCase()));
    if (words.length === 0) return '';
    words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    return words.join(' ');
}

// 0.47 -> "47.0%"; non-finite -> "-".
export function formatPct(p: number): string {
    return isNum(p) ? (p * 100).toFixed(1) + '%' : '-';
}

// Saved evidence keeps the original class key, including spaces. Presentation only.
export function savedClaimLabel(note: string): string {
    const match = /claim: (.+?) \(p=/.exec(note);
    return match ? classLabel(match[1]) : 'a video action';
}
