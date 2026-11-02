const test = require('node:test');
const assert = require('node:assert');
const t = require('../mortgage-tools');

const market = { benchmark_series: 'OBMMIC30YF', benchmark_rate: 6.5, benchmark_date: '2026-10-30' };

test('monthly payment matches a known amortization value', () => {
  assert.strictEqual(t.monthlyPayment(400000, 6, 360).toFixed(2), '2398.20');
});

test('balance is zero at end of term', () => {
  assert.ok(Math.abs(t.balanceAfter(400000, 6, 360, 360)) < 0.01);
});

test('effective rate equals note rate when there are no upfront costs', () => {
  assert.ok(Math.abs(t.effectiveRateOverHorizon(300000, 6.5, 360, 0, 84) - 6.5) < 0.001);
});

test('large rate drop is worth considering', () => {
  const r = t.computeRefi(t.parseRefiInputs({ current_rate: '7.5', balance: '400000', remaining_years: '29', new_rate: '6.25', closing_costs: '6000' }), market);
  assert.strictEqual(r.results.verdict, 'worth_considering');
  assert.ok(r.results.breakeven_months > 0 && r.results.breakeven_months < 30);
});

test('tiny rate drop with term reset is not worth it', () => {
  const r = t.computeRefi(t.parseRefiInputs({ current_rate: '6.4', balance: '300000', remaining_years: '25', new_rate: '6.2', closing_costs: '7000' }), market);
  assert.strictEqual(r.results.verdict, 'not_worth_it');
});

test('refi uses market rate when new_rate omitted', () => {
  const r = t.computeRefi(t.parseRefiInputs({ current_rate: '7.5', balance: '400000' }), market);
  assert.strictEqual(r.new_loan.rate, 6.5);
  assert.ok(r.inputs.assumptions.some(a => a.includes('market rate')));
});

test('offer grades follow the spread vs market', () => {
  const grade = (rate, points = '0') => t.computeOfferGrade(t.parseOfferInputs({ rate, loan_amount: '400000', points }), market).grade;
  assert.strictEqual(grade('6.25'), 'A');
  assert.strictEqual(grade('6.5'), 'B');
  assert.strictEqual(grade('6.75'), 'C');
  assert.strictEqual(grade('7.25'), 'D');
  assert.strictEqual(grade('6.5', '1'), 'C'); // 1 point ≈ +25 bps
});

test('segment benchmark is chosen from credit score and LTV', () => {
  const ids = t.benchmarkCandidates({ term: 30, loanType: 'conventional', creditScore: 745, ltv: 75 }).map(c => c.id);
  assert.deepStrictEqual(ids, ['OBMMIC30YFLVLE80FGE740', 'OBMMIC30YF', 'MORTGAGE30US']);
  assert.strictEqual(t.benchmarkCandidates({ term: 15 })[0].id, 'OBMMIC15YF');
  assert.strictEqual(t.benchmarkCandidates({ term: 30, loanType: 'fha' })[0].id, 'OBMMIFHA30YF');
});

test('stale benchmark falls back to the next series', async () => {
  const fetchSeries = async (id) => id === 'OBMMIC30YF'
    ? [{ date: '2026-01-05', value: 6.1 }]
    : [{ date: '2026-10-29', value: 6.3 }];
  const m = await t.resolveBenchmark({ term: 30 }, fetchSeries, '2026-10-30', '2026-10-01');
  assert.strictEqual(m.benchmark_series, 'MORTGAGE30US');
  assert.deepStrictEqual(m.fallback_from, ['OBMMIC30YF (stale)']);
});

test('bad input raises InputError', () => {
  assert.throws(() => t.parseOfferInputs({ rate: 'abc', loan_amount: '1000' }), t.InputError);
  assert.throws(() => t.parseRefiInputs({ balance: '100000' }), /current_rate/);
});
