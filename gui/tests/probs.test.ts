// GUI unit tests for gui/src/probs.ts. Run from app/: node --test gui/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictionRows, formatPct, classLabel } from '../src/probs.ts';

test('classLabel: all 8 class keys get readable sentence-case labels', () => {
    const want: Record<string, string> = {
        'CollectLayer step': 'Collect layer step', 'PhaseSeparation step': 'Phase separation step',
        'AnalyticalMeasurement step': 'Analytical measurement step', 'MeasureLiquid step': 'Measure liquid step',
        'Add step': 'Add step', 'Stir step': 'Stir step', 'MeasureSolid step': 'Measure solid step', 'No action': 'No action',
    };
    assert.equal(Object.keys(want).length, 8);
    for (const [k, v] of Object.entries(want)) assert.equal(classLabel(k), v, k);
});

test('classLabel: underscores and extra spaces collapse, acronyms stay whole', () => {
    assert.equal(classLabel('Phase_Separation__step'), 'Phase separation step');
    assert.equal(classLabel('  MeasureLiquid   step  '), 'Measure liquid step');
    assert.equal(classLabel('PCRStep'), 'PCR step');
    assert.equal(classLabel('runPCRStep'), 'Run PCR step');
});

test('classLabel: empty and non-string input never throws', () => {
    assert.equal(classLabel(''), '');
    assert.equal(classLabel('   '), '');
    assert.equal(classLabel('_'), '');
    assert.equal(classLabel(null), '');
    assert.equal(classLabel(undefined), '');
    assert.equal(classLabel(42), '42');
    assert.equal(classLabel(Object.create(null)), '');
    assert.doesNotThrow(() => classLabel({}));
    assert.doesNotThrow(() => classLabel(Symbol('x')));
});

const LABELS = ['Add step', 'AnalyticalMeasurement step', 'CollectLayer step', 'MeasureLiquid step',
    'MeasureSolid step', 'No action', 'PhaseSeparation step', 'Stir step'];

test('8 probs -> 8 rows sorted by probability descending, not a fallback', () => {
    const vals = [0.2, 0.01, 0.05, 0.47, 0.03, 0.08, 0.06, 0.1];
    const probs = Object.fromEntries(LABELS.map((l, i) => [l, vals[i]]));
    const r = predictionRows({ top3: [['MeasureLiquid step', 0.47], ['Add step', 0.2], ['Stir step', 0.1]], probs });
    assert.equal(r.fallback, false);
    assert.equal(r.rows.length, 8);
    assert.deepEqual(r.rows.map(x => x.label), ['MeasureLiquid step', 'Add step', 'Stir step', 'No action',
        'PhaseSeparation step', 'CollectLayer step', 'MeasureSolid step', 'AnalyticalMeasurement step']);
    for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i - 1].p >= r.rows[i].p);
    assert.deepEqual(r.rows[0], { label: 'MeasureLiquid step', p: 0.47 });
});

test('equal probabilities tie-break by label, independent of input order', () => {
    const a = predictionRows({ probs: { 'Stir step': 0.25, 'Add step': 0.25, 'No action': 0.5, 'CollectLayer step': 0.25 } });
    const b = predictionRows({ probs: { 'CollectLayer step': 0.25, 'No action': 0.5, 'Add step': 0.25, 'Stir step': 0.25 } });
    const want = ['No action', 'Add step', 'CollectLayer step', 'Stir step'];
    assert.deepEqual(a.rows.map(x => x.label), want);
    assert.deepEqual(b.rows.map(x => x.label), want);
});

test('missing probs falls back to top3 and is flagged', () => {
    const top3 = [['Add step', 0.2], ['MeasureLiquid step', 0.47], ['Stir step', 0.1]];
    for (const probs of [undefined, null, 'x', 3, [0.1, 0.2]]) {
        const r = predictionRows({ top3, probs });
        assert.equal(r.fallback, true, 'probs=' + JSON.stringify(probs));
        assert.deepEqual(r.rows.map(x => x.label), ['MeasureLiquid step', 'Add step', 'Stir step']);
    }
});

test('missing everything -> empty rows, no crash', () => {
    for (const p of [undefined, null, 0, 'x', {}, { top3: null }, { top3: 'bad' }]) {
        const r = predictionRows(p);
        assert.deepEqual(r.rows, [], 'input=' + JSON.stringify(p));
        assert.equal(r.fallback, false);
    }
});

test('non-finite or non-numeric probabilities are skipped', () => {
    const r = predictionRows({ probs: { 'Add step': NaN, 'Stir step': Infinity, 'No action': -Infinity, 'CollectLayer step': '0.5', 'MeasureSolid step': null, 'MeasureLiquid step': 0.3 } });
    assert.deepEqual(r.rows, [{ label: 'MeasureLiquid step', p: 0.3 }]);
    const f = predictionRows({ top3: [['Add step', NaN], ['Stir step', 0.1], 'junk', ['No action'], ['MeasureLiquid step', Infinity]] });
    assert.equal(f.fallback, true);
    assert.deepEqual(f.rows, [{ label: 'Stir step', p: 0.1 }]);
});

test('formatPct: one decimal place, non-finite -> "-"', () => {
    assert.equal(formatPct(0.47), '47.0%');
    assert.equal(formatPct(0.1234), '12.3%');
    assert.equal(formatPct(1), '100.0%');
    assert.equal(formatPct(0), '0.0%');
    assert.equal(formatPct(0.0004), '0.0%');
    assert.equal(formatPct(NaN), '-');
    assert.equal(formatPct(Infinity), '-');
});
