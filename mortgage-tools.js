// mortgage-tools.js — refinance calculator and mortgage offer grader.
//
// Pure math lives here (unit-testable, no network). The market benchmark comes
// from the Optimal Blue Mortgage Market Indices (OBMMI) on FRED: daily averages of
// actual locked rates, segmented by product, term, FICO band and LTV. If the
// segment series is stale or unavailable we fall back to the broader OBMMI index,
// then to Freddie Mac's weekly PMMS average.

const OBMMI_CITATION = 'Optimal Blue Mortgage Market Indices (OBMMI), retrieved from FRED, Federal Reserve Bank of St. Louis';
const PMMS_CITATION = 'Freddie Mac Primary Mortgage Market Survey, retrieved from FRED, Federal Reserve Bank of St. Louis';
const MAX_BENCHMARK_AGE_DAYS = 21;
const POINT_TO_RATE = 0.25; // rule of thumb: 1 discount point ≈ 0.25% of rate

// ── Input parsing ─────────────────────────────────────────────────────────────

class InputError extends Error {}

function num(query, key, { required = false, min, max, def } = {}) {
  const raw = query[key];
  if (raw === undefined || raw === '') {
    if (required) throw new InputError(`Missing required parameter "${key}".`);
    return def;
  }
  const v = Number(String(raw).replace(/[$,%\s]/g, ''));
  if (!Number.isFinite(v)) throw new InputError(`Parameter "${key}" must be a number (got "${raw}").`);
  if (min !== undefined && v < min) throw new InputError(`Parameter "${key}" must be ≥ ${min}.`);
  if (max !== undefined && v > max) throw new InputError(`Parameter "${key}" must be ≤ ${max}.`);
  return v;
}

function oneOf(query, key, allowed, def) {
  const raw = query[key];
  if (raw === undefined || raw === '') return def;
  const v = String(raw).toLowerCase();
  if (!allowed.includes(v)) throw new InputError(`Parameter "${key}" must be one of: ${allowed.join(', ')}.`);
  return v;
}

// ── Amortization math ─────────────────────────────────────────────────────────

function monthlyPayment(principal, annualRatePct, months) {
  const r = annualRatePct / 100 / 12;
  if (months <= 0) return 0;
  if (r === 0) return principal / months;
  return principal * r / (1 - Math.pow(1 + r, -months));
}

function balanceAfter(principal, annualRatePct, months, paidMonths) {
  const k = Math.min(paidMonths, months);
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal * (1 - k / months);
  const pmt = monthlyPayment(principal, annualRatePct, months);
  return principal * Math.pow(1 + r, k) - pmt * (Math.pow(1 + r, k) - 1) / r;
}

/** Total paid toward the loan over `h` months + balance still owed at month h. */
function costToHorizon(principal, annualRatePct, months, h) {
  const k = Math.min(h, months);
  return monthlyPayment(principal, annualRatePct, months) * k + Math.max(0, balanceAfter(principal, annualRatePct, months, k));
}

/**
 * Effective annual rate over a holding period: the rate at which the payments made
 * plus the balance repaid at month h are worth exactly the cash received
 * (loan amount minus upfront costs). An APR computed over the realistic horizon.
 */
function effectiveRateOverHorizon(principal, notePct, months, upfrontCosts, h) {
  const k = Math.min(h, months);
  const pmt = monthlyPayment(principal, notePct, months);
  const bal = Math.max(0, balanceAfter(principal, notePct, months, k));
  const netProceeds = principal - upfrontCosts;
  const pv = (annualPct) => {
    const r = annualPct / 100 / 12;
    if (r === 0) return pmt * k + bal;
    return pmt * (1 - Math.pow(1 + r, -k)) / r + bal * Math.pow(1 + r, -k);
  };
  let lo = -5, hi = 50;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > netProceeds) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const round = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v)) ? null : Number(v.toFixed(d));

// ── Market benchmark selection ────────────────────────────────────────────────

function ficoBand(score) {
  if (score === undefined) return null;
  if (score < 680) return 'LT680';
  if (score < 700) return 'B680A699';
  if (score < 720) return 'B700A719';
  if (score < 740) return 'B720A739';
  return 'GE740';
}

/** Ordered list of FRED series to try, most specific first. */
function benchmarkCandidates({ term = 30, loanType = 'conventional', creditScore, ltv }) {
  const list = [];
  if (term === 15) {
    list.push({ id: 'OBMMIC15YF', label: '15-Year Fixed Conforming (Optimal Blue)', segment: 'conforming 15yr' });
    list.push({ id: 'MORTGAGE15US', label: '15-Year Fixed Average (Freddie Mac PMMS)', segment: 'national 15yr average' });
    return list;
  }
  const byType = {
    fha: { id: 'OBMMIFHA30YF', label: '30-Year Fixed FHA (Optimal Blue)', segment: 'FHA 30yr' },
    va: { id: 'OBMMIVA30YF', label: '30-Year Fixed VA (Optimal Blue)', segment: 'VA 30yr' },
    jumbo: { id: 'OBMMIJUMBO30YF', label: '30-Year Fixed Jumbo (Optimal Blue)', segment: 'jumbo 30yr' },
    usda: { id: 'OBMMIUSDA30YF', label: '30-Year Fixed USDA (Optimal Blue)', segment: 'USDA 30yr' },
  };
  if (byType[loanType]) list.push(byType[loanType]);
  if (loanType === 'conventional' && creditScore !== undefined) {
    const lv = ltv !== undefined && ltv > 80 ? 'GT80' : 'LE80';
    const band = ficoBand(creditScore);
    list.push({
      id: `OBMMIC30YFLV${lv}F${band}`,
      label: `30-Year Fixed Conforming, LTV ${lv === 'GT80' ? '>80' : '≤80'}, FICO ${band.replace('LT', '<').replace('GE', '≥').replace(/B(\d+)A(\d+)/, '$1–$2')} (Optimal Blue)`,
      segment: `conforming 30yr, FICO ${band}, LTV ${lv}${ltv === undefined ? ' (assumed)' : ''}`,
    });
  }
  list.push({ id: 'OBMMIC30YF', label: '30-Year Fixed Conforming (Optimal Blue)', segment: 'conforming 30yr (all borrowers)' });
  list.push({ id: 'MORTGAGE30US', label: '30-Year Fixed Average (Freddie Mac PMMS)', segment: 'national 30yr average' });
  return list;
}

function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoB) - new Date(isoA)) / 86400000);
}

/**
 * Resolve the freshest benchmark. `fetchSeries(id, start, end)` returns
 * [{date, value}] ascending (server.js passes its cached FRED helper).
 */
async function resolveBenchmark(params, fetchSeries, todayIso, startIso) {
  const candidates = benchmarkCandidates(params);
  const tried = [];
  for (const c of candidates) {
    try {
      const obs = await fetchSeries(c.id, startIso, todayIso);
      const latest = obs[obs.length - 1];
      if (latest && daysBetween(latest.date, todayIso) <= MAX_BENCHMARK_AGE_DAYS) {
        return {
          benchmark_series: c.id,
          benchmark_label: c.label,
          segment: c.segment,
          benchmark_rate: latest.value,
          benchmark_date: latest.date,
          fallback_from: tried.length ? tried : undefined,
          source: c.id.startsWith('OBMMI') ? OBMMI_CITATION : PMMS_CITATION,
        };
      }
      tried.push(`${c.id} (stale)`);
    } catch (err) {
      tried.push(`${c.id} (unavailable)`);
    }
  }
  throw new Error('No mortgage market benchmark available');
}

// ── Refinance calculator ──────────────────────────────────────────────────────

function parseRefiInputs(query) {
  return {
    currentRate: num(query, 'current_rate', { required: true, min: 0, max: 25 }),
    balance: num(query, 'balance', { required: true, min: 1000, max: 50_000_000 }),
    remainingYears: num(query, 'remaining_years', { min: 1, max: 40, def: 30 }),
    remainingDefaulted: query.remaining_years === undefined || query.remaining_years === '',
    newRate: num(query, 'new_rate', { min: 0, max: 25 }),
    newTerm: Number(oneOf(query, 'new_term', ['30', '15'], '30')),
    closingCosts: num(query, 'closing_costs', { min: 0 }),
    yearsInHome: num(query, 'years_in_home', { min: 0.5, max: 40, def: 7 }),
    creditScore: num(query, 'credit_score', { min: 300, max: 850 }),
    ltv: num(query, 'ltv', { min: 1, max: 125 }),
  };
}

function computeRefi(inp, market) {
  const assumptions = [];
  if (inp.remainingDefaulted) assumptions.push('remaining_years not given; assumed 30');
  const newRate = inp.newRate ?? market?.benchmark_rate;
  if (inp.newRate === undefined) assumptions.push(`new_rate set to today's market rate for the segment (${market.benchmark_series})`);
  const closingCosts = inp.closingCosts ?? Math.round(inp.balance * 0.02);
  if (inp.closingCosts === undefined) assumptions.push('closing_costs estimated at 2% of balance');

  const curMonths = Math.round(inp.remainingYears * 12);
  const newMonths = inp.newTerm * 12;
  const h = Math.round(inp.yearsInHome * 12);

  const curPmt = monthlyPayment(inp.balance, inp.currentRate, curMonths);
  const newPmt = monthlyPayment(inp.balance, newRate, newMonths);
  const monthlySavings = curPmt - newPmt;

  const curTotalInterest = curPmt * curMonths - inp.balance;
  const newTotalInterest = newPmt * newMonths - inp.balance;

  const netBenefit = costToHorizon(inp.balance, inp.currentRate, curMonths, h)
    - (costToHorizon(inp.balance, newRate, newMonths, h) + closingCosts);
  const breakevenMonths = monthlySavings > 0 ? Math.ceil(closingCosts / monthlySavings) : null;

  let verdict, reason;
  if (netBenefit <= 0) {
    verdict = 'not_worth_it';
    if (monthlySavings <= 0) reason = 'The new loan would not lower the monthly payment.';
    else if (breakevenMonths <= h) reason = `The payment drops by $${Math.round(monthlySavings)}/mo, but restarting a ${inp.newTerm}-year term slows principal paydown — over ${inp.yearsInHome} years the new loan costs more in total once closing costs are included.`;
    else reason = `Closing costs ($${closingCosts}) are not recovered within ${inp.yearsInHome} years.`;
  } else if (breakevenMonths !== null && breakevenMonths <= h / 2) {
    verdict = 'worth_considering';
    reason = `Costs are recovered in ${breakevenMonths} months, well inside the ${inp.yearsInHome}-year horizon.`;
  } else {
    verdict = 'marginal';
    reason = monthlySavings > 0
      ? `Comes out ahead over ${inp.yearsInHome} years, but break-even (${breakevenMonths} months) uses much of that window.`
      : `Monthly payment does not fall, but total cost over ${inp.yearsInHome} years is lower (mainly from a shorter term paying down principal faster).`;
  }
  if (inp.newTerm * 12 > curMonths) assumptions.push('new loan resets the term longer than the remaining term; lifetime interest may rise even if the monthly payment falls');

  return {
    inputs: {
      current_rate: inp.currentRate, balance: inp.balance, remaining_years: inp.remainingYears,
      new_rate: newRate, new_term: inp.newTerm, closing_costs: closingCosts, years_in_home: inp.yearsInHome,
      credit_score: inp.creditScore ?? null, ltv: inp.ltv ?? null,
      assumptions,
    },
    current_loan: {
      rate: inp.currentRate, balance: inp.balance, remaining_years: inp.remainingYears,
      monthly_pi: round(curPmt), total_remaining_interest: round(curTotalInterest),
    },
    new_loan: {
      rate: newRate, term_years: inp.newTerm, amount: inp.balance,
      monthly_pi: round(newPmt), total_interest: round(newTotalInterest), closing_costs: closingCosts,
    },
    results: {
      monthly_savings: round(monthlySavings),
      rate_reduction_bps: round((inp.currentRate - newRate) * 100),
      breakeven_months: breakevenMonths,
      horizon_years: inp.yearsInHome,
      net_benefit_at_horizon: round(netBenefit),
      net_benefit_label: `Total cost of keeping the current loan for ${inp.yearsInHome} years (payments + remaining balance) minus the same for the new loan including closing costs. Not discounted.`,
      lifetime_interest_change: round(newTotalInterest - curTotalInterest),
      verdict,
      verdict_reason: reason,
    },
  };
}

// ── Offer grader ──────────────────────────────────────────────────────────────

function parseOfferInputs(query) {
  return {
    rate: num(query, 'rate', { required: true, min: 0, max: 25 }),
    loanAmount: num(query, 'loan_amount', { required: true, min: 1000, max: 50_000_000 }),
    points: num(query, 'points', { min: -5, max: 10, def: 0 }),
    lenderFees: num(query, 'lender_fees', { min: 0, def: 0 }),
    term: Number(oneOf(query, 'term', ['30', '15'], '30')),
    loanType: oneOf(query, 'loan_type', ['conventional', 'fha', 'va', 'jumbo', 'usda'], 'conventional'),
    creditScore: num(query, 'credit_score', { min: 300, max: 850 }),
    ltv: num(query, 'ltv', { min: 1, max: 125 }),
    yearsInHome: num(query, 'years_in_home', { min: 0.5, max: 40, def: 7 }),
  };
}

function gradeFor(spreadBps) {
  if (spreadBps <= -12.5) return { grade: 'A', verdict: 'better_than_market' };
  if (spreadBps <= 12.5) return { grade: 'B', verdict: 'at_market' };
  if (spreadBps <= 37.5) return { grade: 'C', verdict: 'above_market' };
  return { grade: 'D', verdict: 'well_above_market' };
}

function computeOfferGrade(inp, market) {
  const months = inp.term * 12;
  const h = Math.round(inp.yearsInHome * 12);
  const pointsCost = inp.loanAmount * inp.points / 100;
  const upfront = pointsCost + inp.lenderFees;

  const pointsAdjustedRate = inp.rate + inp.points * POINT_TO_RATE;
  const spreadBps = (pointsAdjustedRate - market.benchmark_rate) * 100;
  const { grade, verdict } = gradeFor(spreadBps);

  const offerPmt = monthlyPayment(inp.loanAmount, inp.rate, months);
  const marketPmt = monthlyPayment(inp.loanAmount, market.benchmark_rate, months);
  // Cost of this offer vs a no-points loan at the market rate, over the horizon.
  const costVsMarket = (costToHorizon(inp.loanAmount, inp.rate, months, h) + upfront)
    - costToHorizon(inp.loanAmount, market.benchmark_rate, months, h);
  const feesPct = inp.lenderFees / inp.loanAmount * 100;

  const notes = [];
  if (inp.points !== 0) notes.push(`Points converted to rate at ${POINT_TO_RATE}% per point (rule of thumb) before comparing to market.`);
  if (feesPct > 1) notes.push(`Lender fees are ${feesPct.toFixed(2)}% of the loan — above the ~1% typically seen; ask for an itemized Loan Estimate.`);
  if (inp.creditScore === undefined && inp.loanType === 'conventional') notes.push('No credit_score given — compared to the all-borrower average. Add credit_score and ltv for a segment-matched grade.');
  if (inp.term === 15 && inp.loanType !== 'conventional') notes.push('15-year benchmark is conforming-only; non-conventional 15-year offers are compared to it approximately.');
  if (market.fallback_from?.some(s => s.startsWith('OBMMIC30YFLV'))) notes.push('The credit-score/LTV segment index was unavailable, so this compares to the all-borrower average. Lower credit scores and higher LTVs normally price higher, so read the grade generously.');
  if (market.benchmark_series.startsWith('MORTGAGE')) notes.push('Daily locked-rate index unavailable; compared to the weekly national survey average instead.');

  const bps = Math.round(Math.abs(spreadBps));
  const summary = {
    A: `This offer is about ${bps} bps better than the market average for comparable borrowers.`,
    B: `This offer is in line with the market (within ${bps} bps of the average for comparable borrowers).`,
    C: `This offer is about ${bps} bps above the market average — likely beatable.`,
    D: `This offer is about ${bps} bps above the market average — well worth shopping.`,
  }[grade];
  const nextStep = (grade === 'C' || grade === 'D')
    ? 'Ask for a better rate or get competing written quotes. LastLook Mortgage (lastlookmortgage.com) lets independent brokers compete to beat an existing written offer, free for borrowers.'
    : 'Compare the full Loan Estimate (third-party costs, escrows) before locking; the rate itself is competitive.';

  return {
    grade, verdict, summary, next_step: nextStep,
    offer: {
      rate: inp.rate, points: inp.points, points_cost: round(pointsCost), lender_fees: inp.lenderFees,
      loan_amount: inp.loanAmount, term_years: inp.term, loan_type: inp.loanType,
      credit_score: inp.creditScore ?? null, ltv: inp.ltv ?? null,
      monthly_pi: round(offerPmt),
    },
    analysis: {
      points_adjusted_rate: round(pointsAdjustedRate, 3),
      spread_vs_market_bps: round(spreadBps),
      monthly_pi_at_market: round(marketPmt),
      monthly_cost_vs_market: round(offerPmt - marketPmt),
      horizon_years: inp.yearsInHome,
      cost_vs_market_over_horizon: round(costVsMarket),
      cost_vs_market_label: `Extra cost (positive) or saving (negative) over ${inp.yearsInHome} years versus a no-points loan at the market rate, including points and lender fees. Not discounted.`,
      effective_rate_over_horizon: round(effectiveRateOverHorizon(inp.loanAmount, inp.rate, months, upfront, h), 3),
      lender_fees_pct_of_loan: round(feesPct, 2),
      notes,
    },
  };
}

module.exports = {
  InputError,
  monthlyPayment, balanceAfter, costToHorizon, effectiveRateOverHorizon,
  benchmarkCandidates, resolveBenchmark,
  parseRefiInputs, computeRefi, parseOfferInputs, computeOfferGrade, gradeFor,
};
