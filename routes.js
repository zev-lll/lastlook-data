// routes.js — single source of truth for every paid LastLook Data endpoint.
//
// server.js builds its x402 payment config, HEAD→402 list, root resource list and
// /.well-known/x402.json from this file; openapi.json and agent.json are generated
// from it (served live, and written to disk by `npm run gen:docs`); mcp-server.mjs
// reads prices from it. Add or reprice an endpoint HERE, not in those files.

const SERVICE = {
  name: 'LastLook Data',
  version: '2.14.0',
  description: 'Financial market data and mortgage decision tools for AI agents — Treasury yields, mortgage rates, a refinance calculator and mortgage offer grader, FX, energy, macro indicators, crypto prices, and company fundamentals. Pay per query via x402 (USDC on Base or Solana). No accounts or API keys.',
  website: 'https://www.lastlookdata.com',
  docs: 'https://www.lastlookdata.com/docs',
  apiBase: 'https://api.lastlookdata.com',
  mcpUrl: 'https://mcp.lastlookdata.com/mcp',
  logo: 'https://api.lastlookdata.com/logo.png',
  email: 'hello@lastlookdata.com',
};

const NETWORKS = {
  base: { id: 'eip155:8453', label: 'Base' },
  solana: { id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', label: 'Solana' },
};

const TAGS = [
  { name: 'Mortgage Tools', description: 'Decision tools — refinance calculator and mortgage offer grader, priced against live market rates' },
  { name: 'Bundles', description: 'Pre-built multi-series bundles — one payment, parallel data fetch' },
  { name: 'FRED', description: 'Federal Reserve Economic Data — raw series' },
  { name: 'FX', description: 'G10 FX rates via European Central Bank' },
  { name: 'Derived', description: 'Computed and interpreted market signals' },
  { name: 'Calendar', description: 'Economic data release schedule' },
  { name: 'Crypto', description: 'Crypto prices via CoinGecko' },
  { name: 'EDGAR', description: 'Company fundamentals via SEC EDGAR XBRL' },
  { name: 'Free', description: 'No payment required' },
];

// Query params are declared as strings (they arrive as strings, and Bazaar's
// validator builds example inputs from `example`/`enum[0]`).
const MORTGAGE_TOOLS = [
  {
    path: '/api/calc/refi', price: '0.35', tag: 'Mortgage Tools',
    name: 'Mortgage Tool — Refinance Calculator',
    summary: 'Refinance break-even calculator', operationId: 'getRefiCalculation',
    description: 'Refinance calculator priced against today\'s market. Give the current rate, balance and remaining term; get new monthly payment, monthly savings, break-even month, net benefit over the years you expect to stay, and a plain verdict. New rate defaults to the live Optimal Blue locked-rate index for the borrower\'s credit/LTV segment.',
    params: {
      properties: {
        current_rate: { type: 'string', description: 'Current note rate in percent, e.g. 7.25', example: '7.25' },
        balance: { type: 'string', description: 'Remaining principal balance in USD, e.g. 400000', example: '400000' },
        remaining_years: { type: 'string', description: 'Years left on the current loan (default 30)', example: '28' },
        new_rate: { type: 'string', description: 'Quoted new rate in percent. Omit to use today\'s market rate for the segment.', example: '6.25' },
        new_term: { type: 'string', description: 'New loan term in years (default 30)', enum: ['30', '15'] },
        closing_costs: { type: 'string', description: 'Total refinance closing costs in USD (default: 2% of balance)', example: '8000' },
        years_in_home: { type: 'string', description: 'Years the borrower expects to keep the loan (default 7)', example: '7' },
        credit_score: { type: 'string', description: 'Borrower FICO score, used to pick the market-rate segment', example: '760' },
        ltv: { type: 'string', description: 'Loan-to-value percent, used to pick the market-rate segment', example: '75' },
      },
      required: ['current_rate', 'balance'],
    },
    example: { service: 'LastLook Data', tool: 'refi_calculator', as_of: '2026-10-30', market: { benchmark_series: 'OBMMIC30YFLVLE80FGE740', benchmark_rate: 6.21, benchmark_date: '2026-10-30' }, current_loan: { rate: 7.25, balance: 400000, remaining_years: 28, monthly_pi: 2804 }, new_loan: { rate: 6.21, term_years: 30, amount: 400000, monthly_pi: 2452, closing_costs: 8000 }, results: { monthly_savings: 352, breakeven_months: 23, rate_reduction_bps: 104, net_benefit_at_horizon: 21304, horizon_years: 7, verdict: 'worth_considering' } },
  },
  {
    path: '/api/grade/offer', price: '0.50', tag: 'Mortgage Tools',
    name: 'Mortgage Tool — Offer Grader',
    summary: 'Grade a mortgage offer against the live market', operationId: 'getOfferGrade',
    description: 'Grades a written mortgage offer (rate, points, lender fees) against the live Optimal Blue locked-rate index for the same product, term, credit score and LTV. Returns a letter grade, spread vs market in basis points, monthly and total-over-horizon cost vs market, and a plain-language verdict.',
    params: {
      properties: {
        rate: { type: 'string', description: 'Offered note rate in percent, e.g. 6.875', example: '6.875' },
        loan_amount: { type: 'string', description: 'Loan amount in USD, e.g. 450000', example: '450000' },
        points: { type: 'string', description: 'Discount points as percent of loan (negative for lender credits, default 0)', example: '0.5' },
        lender_fees: { type: 'string', description: 'Lender origination/underwriting fees in USD, excluding third-party costs (default 0)', example: '1500' },
        term: { type: 'string', description: 'Loan term in years (default 30)', enum: ['30', '15'] },
        loan_type: { type: 'string', description: 'Loan program (default conventional)', enum: ['conventional', 'fha', 'va', 'jumbo', 'usda'] },
        credit_score: { type: 'string', description: 'Borrower FICO score', example: '740' },
        ltv: { type: 'string', description: 'Loan-to-value percent', example: '80' },
        years_in_home: { type: 'string', description: 'Years the borrower expects to keep the loan (default 7)', example: '7' },
      },
      required: ['rate', 'loan_amount'],
    },
    example: { service: 'LastLook Data', tool: 'offer_grader', as_of: '2026-10-30', grade: 'C', verdict: 'above_market', offer: { rate: 6.875, points: 0.5, lender_fees: 1500, loan_amount: 450000, term_years: 30, monthly_pi: 2956 }, market: { benchmark_series: 'OBMMIC30YFLVLE80FGE740', benchmark_rate: 6.65, benchmark_date: '2026-10-30' }, analysis: { points_adjusted_rate: 7.0, spread_vs_market_bps: 35, monthly_cost_vs_market: 68, cost_vs_market_over_horizon: 8212 } },
  },
];

const PAID_ROUTES = [
  ...MORTGAGE_TOOLS,
  {
    path: "/api/current", price: "0.01", tag: "FRED",
    name: "FRED Series — Current Value",
    summary: "Current value for any FRED series", operationId: "getFredCurrent",
    description: "Most recent value for any supported FRED series. Use ?id=IORB, ?id=EFFR, ?id=MORTGAGE30US, ?id=FEDFUNDS, ?id=DGS10, etc.",
    params: {"properties":{"id":{"type":"string","description":"FRED series ID","enum":["DGS30","DGS10","DGS5","DGS2","DGS1MO","MORTGAGE30US","MORTGAGE15US","MSPUS","HOUST","FEDFUNDS","SOFR","DPRIME","DTB3","IORB","EFFR","CPIAUCSL","CPILFESL","UNRATE","GDP","SAHMREALTIME","DCOILWTICO","DCOILBRENTEU","GASREGCOVW","DHHNGSP"]}},"required":["id"]},
    example: {"service":"LastLook Data","series_id":"IORB","label":"Interest on Reserve Balances","date":"2026-05-09","value":4.4,"note":"Source: Federal Reserve Bank of St. Louis (FRED)"},
  },
  {
    path: "/api/date", price: "0.01", tag: "FRED",
    name: "FRED Series — Value by Date",
    summary: "FRED series value on a specific date", operationId: "getFredByDate",
    description: "Value for any supported FRED series on a specific date. Use ?id=SERIES_ID&d=YYYY-MM-DD. Business days only.",
    params: {"properties":{"id":{"type":"string","description":"FRED series ID","enum":["DGS30","DGS10","DGS5","DGS2","DGS1MO","MORTGAGE30US","MORTGAGE15US","MSPUS","HOUST","FEDFUNDS","SOFR","DPRIME","DTB3","IORB","EFFR","CPIAUCSL","CPILFESL","UNRATE","GDP","SAHMREALTIME","DCOILWTICO","DCOILBRENTEU","GASREGCOVW","DHHNGSP"]},"d":{"type":"string","description":"Date in YYYY-MM-DD format"}},"required":["id","d"]},
    example: {"service":"LastLook Data","series_id":"DGS10","label":"10-Year Treasury Constant Maturity Rate","date":"2026-05-09","value":4.42,"note":"Source: Federal Reserve Bank of St. Louis (FRED)"},
  },
  {
    path: "/api/series/30", price: "0.05", tag: "FRED",
    name: "FRED Series — Last 30 Days",
    summary: "Last 30 days of observations", operationId: "getFredSeries30",
    description: "Last 30 days of any FRED series. Use for mortgage rates, Fed funds, IORB, EFFR, Treasury yields, CPI, energy prices, and more.",
    params: {"properties":{"id":{"type":"string","description":"FRED series ID","enum":["DGS30","DGS10","DGS5","DGS2","DGS1MO","MORTGAGE30US","MORTGAGE15US","MSPUS","HOUST","FEDFUNDS","SOFR","DPRIME","DTB3","IORB","EFFR","CPIAUCSL","CPILFESL","UNRATE","GDP","SAHMREALTIME","DCOILWTICO","DCOILBRENTEU","GASREGCOVW","DHHNGSP"]}},"required":["id"]},
    example: {"service":"LastLook Data","series_id":"MORTGAGE30US","days":30,"count":4,"start":"2026-04-10","end":"2026-05-09","observations":[{"date":"2026-04-10","value":6.82},{"date":"2026-05-09","value":6.79}],"note":"Source: Federal Reserve Bank of St. Louis (FRED)"},
  },
  {
    path: "/api/series/90", price: "0.10", tag: "FRED",
    name: "FRED Series — Last 90 Days",
    summary: "Last 90 days of observations", operationId: "getFredSeries90",
    description: "Last 90 days of any supported FRED series.",
    params: {"properties":{"id":{"type":"string","description":"FRED series ID","enum":["DGS30","DGS10","DGS5","DGS2","DGS1MO","MORTGAGE30US","MORTGAGE15US","MSPUS","HOUST","FEDFUNDS","SOFR","DPRIME","DTB3","IORB","EFFR","CPIAUCSL","CPILFESL","UNRATE","GDP","SAHMREALTIME","DCOILWTICO","DCOILBRENTEU","GASREGCOVW","DHHNGSP"]}},"required":["id"]},
    example: {"service":"LastLook Data","series_id":"DGS30","days":90,"count":63,"start":"2026-02-09","end":"2026-05-09","observations":[{"date":"2026-02-09","value":4.75},{"date":"2026-05-09","value":4.97}],"note":"Source: Federal Reserve Bank of St. Louis (FRED)"},
  },
  {
    path: "/api/series/365", price: "0.25", tag: "FRED",
    name: "FRED Series — Last 365 Days",
    summary: "Last 365 days of observations", operationId: "getFredSeries365",
    description: "Last 365 days of any supported FRED series.",
    params: {"properties":{"id":{"type":"string","description":"FRED series ID","enum":["DGS30","DGS10","DGS5","DGS2","DGS1MO","MORTGAGE30US","MORTGAGE15US","MSPUS","HOUST","FEDFUNDS","SOFR","DPRIME","DTB3","IORB","EFFR","CPIAUCSL","CPILFESL","UNRATE","GDP","SAHMREALTIME","DCOILWTICO","DCOILBRENTEU","GASREGCOVW","DHHNGSP"]}},"required":["id"]},
    example: {"service":"LastLook Data","series_id":"DGS30","days":365,"count":252,"start":"2025-05-09","end":"2026-05-09","observations":[{"date":"2025-05-09","value":4.55},{"date":"2026-05-09","value":4.97}],"note":"Source: Federal Reserve Bank of St. Louis (FRED)"},
  },
  {
    path: "/api/treasury/current", price: "0.01", tag: "FRED",
    name: "30-Year Treasury Yield — Current",
    summary: "Current 30-year Treasury yield", operationId: "getTreasuryCurrent",
    description: "Current 30-year US Treasury yield (DGS30). Alias for /api/current?id=DGS30.",
    params: null,
    example: {"service":"LastLook Data","series":"DGS30 - 30-Year Treasury Constant Maturity Rate","date":"2026-05-09","yield_percent":4.97,"note":"Source: Federal Reserve Bank of St. Louis (FRED)"},
  },
  {
    path: "/api/treasury/date", price: "0.01", tag: "FRED",
    name: "30-Year Treasury Yield — By Date",
    summary: "30-year Treasury yield on a specific date", operationId: "getTreasuryByDate",
    description: "30-year Treasury yield for a specific date. Alias for /api/date?id=DGS30&d=YYYY-MM-DD.",
    params: {"properties":{"d":{"type":"string","description":"Date in YYYY-MM-DD format"}},"required":["d"]},
    example: {"service":"LastLook Data","series":"DGS30 - 30-Year Treasury Constant Maturity Rate","date":"2026-05-09","yield_percent":4.97,"note":"Source: Federal Reserve Bank of St. Louis (FRED)"},
  },
  {
    path: "/api/fx/current", price: "0.01", tag: "FX",
    name: "G10 FX Rate — Current",
    summary: "Current G10 FX rate", operationId: "getFxCurrent",
    description: "Current exchange rate for a G10 currency pair. Source: European Central Bank.",
    params: {"properties":{"pair":{"type":"string","description":"G10 currency pair","enum":["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD","USDSEK","USDNOK"]}},"required":["pair"]},
    example: {"service":"LastLook Data","pair":"EURUSD","label":"Euro / US Dollar","date":"2026-05-09","rate":1.1245,"base":"EUR","quote":"USD","note":"Source: Frankfurter (European Central Bank)"},
  },
  {
    path: "/api/fx/date", price: "0.01", tag: "FX",
    name: "G10 FX Rate — By Date",
    summary: "G10 FX rate on a specific date", operationId: "getFxByDate",
    description: "Exchange rate for a G10 currency pair on a specific date. Use ?pair=EURUSD&d=YYYY-MM-DD.",
    params: {"properties":{"pair":{"type":"string","description":"G10 currency pair","enum":["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD","USDSEK","USDNOK"]},"d":{"type":"string","description":"Date in YYYY-MM-DD format"}},"required":["pair","d"]},
    example: {"service":"LastLook Data","pair":"EURUSD","label":"Euro / US Dollar","date":"2026-05-09","rate":1.1245,"base":"EUR","quote":"USD","note":"Source: Frankfurter (European Central Bank)"},
  },
  {
    path: "/api/fx/series", price: "0.05", tag: "FX",
    name: "G10 FX Rate — Historical Series",
    summary: "Historical G10 FX rate series", operationId: "getFxSeries",
    description: "Historical daily exchange rates for a G10 currency pair.",
    params: {"properties":{"pair":{"type":"string","description":"G10 currency pair","enum":["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD","USDSEK","USDNOK"]},"days":{"type":"string","description":"30, 90, or 365 days of history","enum":["30","90","365"]}},"required":["pair","days"]},
    example: {"service":"LastLook Data","pair":"EURUSD","label":"Euro / US Dollar","days":30,"count":21,"start":"2026-04-10","end":"2026-05-09","observations":[{"date":"2026-04-10","value":1.1102},{"date":"2026-05-09","value":1.1245}],"note":"Source: Frankfurter (European Central Bank)"},
  },
  {
    path: "/api/derived/yield-curve", price: "0.03", tag: "Derived",
    name: "Yield Curve Spreads",
    summary: "Yield curve spreads with inversion signal", operationId: "getYieldCurve",
    description: "Yield curve spreads (2s10s and 3m10y) with inversion signal. Computed from FRED Treasury data.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-15","spreads":{"2s10s":{"value":-0.15,"inverted":true},"3m10y":{"value":0.42,"inverted":false}},"components":{"DGS2":4.85,"DGS10":4.7,"DGS1MO":4.28},"signal":"Partially inverted"},
  },
  {
    path: "/api/derived/recession", price: "0.02", tag: "Derived",
    name: "Sahm Rule Recession Indicator",
    summary: "Sahm Rule recession indicator", operationId: "getRecessionIndicator",
    description: "Real-time Sahm Rule recession indicator. Value >= 0.5 signals recession underway. Source: FRED SAHMREALTIME.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-04-01","sahm_rule":{"value":0.37,"threshold":0.5,"triggered":false,"signal":"No recession signal"}},
  },
  {
    path: "/api/derived/policy-spread", price: "0.02", tag: "Derived",
    name: "Fed Policy Spread (EFFR vs IORB)",
    summary: "Fed policy spread (EFFR vs IORB)", operationId: "getPolicySpread",
    description: "EFFR vs IORB spread. Shows where the effective Fed funds rate trades relative to interest on reserves.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-14","effr":4.33,"iorb":4.4,"spread":-0.07,"interpretation":"EFFR trading below IORB — within normal operating band"},
  },
  {
    path: "/api/calendar", price: "0.02", tag: "Calendar",
    name: "Economic Calendar",
    summary: "Upcoming economic data release dates", operationId: "getCalendar",
    description: "Upcoming FRED economic data release dates. CPI, jobs, GDP, Treasury, and more. Use ?days=30|60|90.",
    params: {"properties":{"days":{"type":"string","description":"Lookahead window in days","enum":["30","60","90"]}},"required":[]},
    example: {"service":"LastLook Data","calendar_start":"2026-05-16","calendar_end":"2026-06-15","count":12,"releases":[{"date":"2026-05-20","release_id":50,"release_name":"Employment Situation"}]},
  },
  {
    path: "/api/bundle/refi-signal", price: "0.60", tag: "Bundles",
    name: "Bundle — Refi Signal",
    summary: "Refinance signal bundle", operationId: "getBundleRefiSignal",
    description: "Refinance signal bundle: current 30yr and 15yr mortgage rates, 52-week range, MBS spread, rate trend, and refi break-even threshold. Tells an AI agent whether a borrower should consider refinancing.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-29","bundle":"refi_signal","series":{"MORTGAGE30US":6.86,"MORTGAGE15US":6.12,"DGS10":4.46,"FEDFUNDS":4.33},"derived":{"mbs_spread":2.4,"week52_high":7.22,"week52_low":6.41,"week52_position_pct":63,"refi_breakeven_threshold":7.61,"refi_breakeven_label":"Borrowers with existing rates above this level likely benefit from refinancing"},"signals":{"rate_trend_30d":"flat","rate_trend_90d":"falling","rate_vs_52wk":"mid_range","refi_environment":"neutral"}},
  },
  {
    path: "/api/bundle/purchase-market", price: "0.60", tag: "Bundles",
    name: "Bundle — Purchase Market",
    summary: "Home purchase market bundle", operationId: "getBundlePurchaseMarket",
    description: "Home purchase market bundle: current mortgage rate, median sale price, monthly payment estimate, income required to qualify, and affordability level. Directly answers whether a buyer can afford a median home.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-29","bundle":"purchase_market","series":{"MORTGAGE30US":6.86,"MSPUS":419700,"HOUST":1378,"FEDFUNDS":4.33},"derived":{"loan_amount":335760,"monthly_payment_estimate":2213,"income_required_28pct":94843,"home_price_change_qoq":2.1},"signals":{"affordability_level":"elevated","market_activity":"moderate"}},
  },
  {
    path: "/api/bundle/rate-environment", price: "0.35", tag: "Bundles",
    name: "Bundle — Rate Environment Snapshot",
    summary: "Rate environment snapshot bundle", operationId: "getBundleRateEnvironment",
    description: "Rate environment snapshot: FEDFUNDS, SOFR, DGS2, DGS5, DGS10, DGS30 plus yield curve spreads and policy spread. One payment, all rate data.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-29","bundle":"rate_environment","series":{"FEDFUNDS":4.33,"SOFR":4.31,"DGS2":3.94,"DGS5":4.01,"DGS10":4.46,"DGS30":4.97},"derived":{"spread_2s10s":0.52,"spread_3m10y":0.18,"policy_spread":-0.07},"signals":{"curve_shape":"Normal (upward sloping)","policy_stance":"EFFR trading below IORB — within normal operating band"}},
  },
  {
    path: "/api/bundle/mortgage-pulse", price: "0.40", tag: "Bundles",
    name: "Bundle — Mortgage Market Pulse",
    summary: "Mortgage market pulse bundle", operationId: "getBundleMortgagePulse",
    description: "Mortgage market pulse: 30yr and 15yr mortgage rates, 10Y Treasury, Fed funds, median home price, housing starts. Includes MBS spread and rate trend.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-29","bundle":"mortgage_pulse","series":{"MORTGAGE30US":6.86,"MORTGAGE15US":6.12,"DGS10":4.46,"FEDFUNDS":4.33,"MSPUS":412000,"HOUST":1401},"derived":{"mbs_spread":2.4,"mbs_spread_label":"30yr mortgage minus 10Y Treasury"},"signals":{"rate_trend_30d":"flat"}},
  },
  {
    path: "/api/bundle/macro", price: "0.50", tag: "Bundles",
    name: "Bundle — Macro Health Snapshot",
    summary: "Macro health snapshot bundle", operationId: "getBundleMacro",
    description: "Macro health snapshot: GDP, unemployment, CPI, core CPI, Fed funds, yield curve spreads, and Sahm Rule recession signal. Includes cycle phase.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-29","bundle":"macro","series":{"GDP":29350,"UNRATE":4.2,"CPIAUCSL":315.5,"CPILFESL":323.8,"FEDFUNDS":4.33},"derived":{"sahm_rule":0.37,"spread_2s10s":0.52},"signals":{"cycle_phase":"expansion","recession_triggered":false}},
  },
  {
    path: "/api/bundle/fx-dashboard", price: "0.35", tag: "Bundles",
    name: "Bundle — G10 FX Dashboard",
    summary: "G10 FX dashboard bundle", operationId: "getBundleFxDashboard",
    description: "G10 FX dashboard: all 9 spot rates (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK) plus USD strength index vs basket (30d).",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-29","bundle":"fx_dashboard","series":{"EURUSD":1.1345,"GBPUSD":1.3512,"USDJPY":142.5,"USDCHF":0.891,"USDCAD":1.3621,"AUDUSD":0.6445,"NZDUSD":0.5987,"USDSEK":9.82,"USDNOK":10.28},"derived":{"usd_strength_index":-2.18,"usd_strength_index_label":"Avg % change of USD vs G10 basket (30d)"},"signals":{"usd_trend_30d":"weakening"}},
  },
  {
    path: "/api/bundle/energy", price: "0.25", tag: "Bundles",
    name: "Bundle — Energy & Commodities",
    summary: "Energy and commodities bundle", operationId: "getBundleEnergy",
    description: "Energy and commodities bundle: WTI crude, Brent crude, US regular gasoline, Henry Hub natural gas. Includes WTI-Brent spread and market signal.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-29","bundle":"energy","series":{"DCOILWTICO":61.5,"DCOILBRENTEU":64.8,"GASREGCOVW":3.18,"DHHNGSP":3.82},"derived":{"wti_brent_spread":-3.3,"wti_brent_spread_label":"WTI minus Brent crude (USD/bbl)"},"signals":{"wti_brent_signal":"Normal contango (Brent premium)"}},
  },
  {
    path: "/api/bundle/context-brief", price: "0.75", tag: "Bundles",
    name: "Bundle — Economic Context Brief",
    summary: "Economic context brief bundle", operationId: "getBundleContextBrief",
    description: "Economic context brief: 15+ indicators across rates, inflation, employment, FX, and energy in a pre-formatted natural-language paragraph for LLM context injection.",
    params: null,
    example: {"service":"LastLook Data","as_of":"2026-05-29","bundle":"context_brief","brief":"As of 2026-05-29: The Fed Funds Rate is 4.33%, the yield curve is +52bps (normal), 10Y Treasury at 4.46%, 30Y at 4.97%, CPI at 315.5, unemployment at 4.2%, 30yr mortgage rate 6.86% (240bps over 10Y), WTI crude $61.50/bbl, Brent $64.80/bbl, EUR/USD 1.1345, USD/JPY 142.5, Sahm Rule 0.37 (below 0.50 threshold).","series":{"FEDFUNDS":4.33,"DGS10":4.46,"DGS30":4.97,"MORTGAGE30US":6.86,"UNRATE":4.2,"CPIAUCSL":315.5,"DCOILWTICO":61.5}},
  },
  {
    path: "/api/crypto/price", price: "0.02", tag: "Crypto",
    name: "Crypto — Current Price",
    summary: "Current crypto price", operationId: "getCryptoPrice",
    description: "Current price, 24h change, market cap, and volume for any supported cryptocurrency. Use ?coin=BTC|ETH|SOL|BNB|XRP|ADA|AVAX|DOGE|LINK|DOT|etc. Source: CoinGecko.",
    params: {"properties":{"coin":{"type":"string","description":"Crypto symbol","enum":["BTC","ETH","SOL","BNB","XRP","USDT","USDC","ADA","AVAX","DOGE","DOT","MATIC","LINK","LTC","ATOM","UNI","SUI","APT","NEAR","PEPE"]}},"required":["coin"]},
    example: {"service":"LastLook Data","symbol":"BTC","name":"Bitcoin","price_usd":67500.5,"change_24h_pct":2.43,"market_cap_usd":1332000000000,"volume_24h_usd":28500000000,"as_of":"2026-06-23T12:00:00Z","source":"CoinGecko"},
  },
  {
    path: "/api/crypto/history", price: "0.15", tag: "Crypto",
    name: "Crypto — Historical Prices",
    summary: "Historical crypto prices", operationId: "getCryptoHistory",
    description: "Historical daily closing prices for any supported cryptocurrency. Use ?coin=BTC&days=30|90|365. Source: CoinGecko.",
    params: {"properties":{"coin":{"type":"string","description":"Crypto symbol","enum":["BTC","ETH","SOL","BNB","XRP","USDT","USDC","ADA","AVAX","DOGE","DOT","MATIC","LINK","LTC","ATOM","UNI","SUI","APT","NEAR","PEPE"]},"days":{"type":"string","description":"30, 90, or 365 days of history","enum":["30","90","365"]}},"required":["coin","days"]},
    example: {"service":"LastLook Data","symbol":"BTC","name":"Bitcoin","days":30,"count":30,"start":"2026-05-24","end":"2026-06-23","observations":[{"date":"2026-05-24","price_usd":65000},{"date":"2026-06-23","price_usd":67500.5}],"source":"CoinGecko"},
  },
  {
    path: "/api/bundle/crypto", price: "0.50", tag: "Bundles",
    name: "Bundle — Crypto Top 20",
    summary: "Top 20 crypto bundle", operationId: "getBundleCrypto",
    description: "Top 20 cryptocurrencies by market cap: price, 24h change, 7d change, market cap, and volume in one call. Source: CoinGecko.",
    params: null,
    example: {"service":"LastLook Data","bundle":"crypto","as_of":"2026-06-23T12:00:00Z","count":20,"coins":[{"rank":1,"symbol":"BTC","name":"Bitcoin","price_usd":67500.5,"change_24h_pct":2.43,"change_7d_pct":-1.2,"market_cap_usd":1332000000000,"volume_24h_usd":28500000000}],"source":"CoinGecko"},
  },
  {
    path: "/api/edgar/company", price: "0.75", tag: "EDGAR",
    name: "EDGAR — Company Fundamentals",
    summary: "Company fundamentals from SEC EDGAR", operationId: "getEdgarCompany",
    description: "Company financial fundamentals from SEC EDGAR XBRL: revenue, net income, total assets, stockholders equity, and EPS from 10-K and 10-Q filings. Use ?ticker=AAPL|MSFT|TSLA|AMZN|NVDA|GOOGL|META|etc.",
    params: {"properties":{"ticker":{"type":"string","description":"Stock ticker symbol e.g. AAPL, MSFT, TSLA, AMZN, NVDA, GOOGL, META"}},"required":["ticker"]},
    example: {"service":"LastLook Data","ticker":"AAPL","company_name":"APPLE INC","cik":"0000320193","fundamentals":{"revenue":{"annual":[{"period_end":"2023-09-30","value":383285000000,"fiscal_year":2023}],"quarterly":[{"period_end":"2024-03-30","value":90753000000,"fiscal_period":"Q2"}]},"net_income":{"annual":[{"period_end":"2023-09-30","value":96995000000}]},"total_assets":{"annual":[{"period_end":"2023-09-30","value":352583000000}]}},"as_of":"2026-06-23","source":"SEC EDGAR (XBRL)"},
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const routeByPath = Object.fromEntries(PAID_ROUTES.map(r => [r.path, r]));

/** "$0.35" — the form x402 route config expects. */
function usdPrice(path) {
  const r = routeByPath[path];
  if (!r) throw new Error(`Unknown paid route ${path}`);
  return `$${r.price}`;
}

/** payTo: { base: '0x…', solana: 'base58…' | null } → the networks actually accepted. */
function acceptedNetworks(payTo) {
  const out = [{ network: NETWORKS.base.id, label: NETWORKS.base.label, asset: 'USDC', payTo: payTo.base }];
  if (payTo.solana) out.push({ network: NETWORKS.solana.id, label: NETWORKS.solana.label, asset: 'USDC', payTo: payTo.solana });
  return out;
}

function queryHint(r) {
  if (!r.params) return '';
  return '?' + Object.keys(r.params.properties)
    .filter(k => (r.params.required || []).includes(k))
    .map(k => `${k}=`).join('&');
}

/** Resource list for GET / */
function buildResourceList() {
  return PAID_ROUTES.map(r => ({
    method: 'GET',
    url: SERVICE.apiBase + r.path,
    name: r.name,
    description: r.description,
    price: r.price,
    currency: 'USDC',
  }));
}

/** /.well-known/x402.json */
function buildX402Manifest(payTo) {
  const networks = acceptedNetworks(payTo);
  return {
    name: SERVICE.name,
    description: SERVICE.description,
    logo_url: SERVICE.logo,
    url: SERVICE.website,
    website: SERVICE.website,
    docs: SERVICE.docs,
    openapi: `${SERVICE.apiBase}/openapi.json`,
    mcp: SERVICE.mcpUrl,
    category: 'finance',
    version: SERVICE.version,
    base_url: SERVICE.apiBase,
    content_type: 'application/json',
    payment: { protocol: 'x402', version: 2, asset: 'USDC', networks },
    resources: PAID_ROUTES.map(r => ({
      name: r.name,
      url: SERVICE.apiBase + r.path,
      method: 'GET',
      description: r.description,
      price: r.price,
      currency: 'USDC',
      pricing: networks.map(n => ({ amount: r.price, currency: 'USDC', network: n.label, scheme: 'exact' })),
      ...(r.params ? { schema: r.params.properties, required: r.params.required || [] } : {}),
    })),
  };
}

/** openapi.json (OpenAPI 3.0.3) */
function buildOpenApi(payTo) {
  const networks = acceptedNetworks(payTo);
  const paths = {};
  for (const r of PAID_ROUTES) {
    const parameters = r.params ? Object.entries(r.params.properties).map(([name, s]) => {
      const schema = { type: 'string' };
      if (s.enum) schema.enum = s.enum;
      if (s.example !== undefined) schema.example = s.example;
      else if (s.enum) schema.example = s.enum[0];
      return { name, in: 'query', required: (r.params.required || []).includes(name), description: s.description, schema };
    }) : undefined;
    paths[r.path] = {
      get: {
        tags: [r.tag],
        summary: r.summary,
        description: r.description,
        operationId: r.operationId,
        'x-x402': { price: r.price, currency: 'USDC', networks: networks.map(n => n.network) },
        ...(parameters ? { parameters } : {}),
        responses: {
          200: { description: r.summary, content: { 'application/json': { schema: { type: 'object' }, example: r.example } } },
          ...(parameters ? { 400: { $ref: '#/components/responses/BadRequest' } } : {}),
          402: { $ref: '#/components/responses/PaymentRequired' },
        },
      },
    };
  }
  paths['/api/treasury/public'] = { get: {
    tags: ['Free'], summary: 'Current 30-year Treasury yield (free)', operationId: 'getTreasuryPublic',
    description: 'Most recent 30-year Treasury yield (DGS30). No payment required.',
    responses: { 200: { description: 'Current yield', content: { 'application/json': { example: { date: '2026-10-30', yield_percent: 4.71, series: 'DGS30' } } } } },
  } };
  paths['/health'] = { get: {
    tags: ['Free'], summary: 'Health check', operationId: 'getHealth',
    responses: { 200: { description: 'Service status', content: { 'application/json': { example: { status: 'ok', service: SERVICE.name, version: SERVICE.version } } } } },
  } };

  return {
    openapi: '3.0.3',
    info: {
      title: 'LastLook Data API',
      version: SERVICE.version,
      description: SERVICE.description,
      contact: { name: SERVICE.name, url: SERVICE.website, email: SERVICE.email },
      termsOfService: `${SERVICE.website}/terms`,
      'x-x402': { protocol: 'x402-v2', asset: 'USDC', networks: networks.map(n => ({ network: n.network, payTo: n.payTo })), docs: SERVICE.docs },
      'x-mcp': SERVICE.mcpUrl,
    },
    servers: [{ url: SERVICE.apiBase, description: 'Production' }],
    tags: TAGS,
    paths,
    components: {
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' }, detail: { type: 'string' } }, required: ['error'] },
      },
      responses: {
        BadRequest: { description: 'Invalid parameters', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        PaymentRequired: {
          description: `Payment required via x402 v2. Pay USDC on ${networks.map(n => n.label).join(' or ')}; requirements are in the PAYMENT-REQUIRED response header.`,
        },
      },
    },
  };
}

/** agent.json (served at /agent.json and /.well-known/agent.json) */
function buildAgentJson(payTo) {
  const networks = acceptedNetworks(payTo);
  return {
    schema_version: '1.0',
    version: SERVICE.version,
    name: SERVICE.name,
    description: SERVICE.description,
    url: SERVICE.website,
    logo: SERVICE.logo,
    contact: SERVICE.email,
    api_base: SERVICE.apiBase,
    openapi: `${SERVICE.apiBase}/openapi.json`,
    x402_manifest: `${SERVICE.apiBase}/.well-known/x402.json`,
    mcp_server: SERVICE.mcpUrl,
    payment: { protocol: 'x402', version: '2', asset: 'USDC', networks: networks.map(n => ({ network: n.network, label: n.label, pay_to: n.payTo })) },
    endpoints: PAID_ROUTES.map(r => ({
      path: r.path + queryHint(r),
      method: 'GET',
      category: r.tag,
      description: r.description,
      price_usdc: Number(r.price),
    })),
    common_use_cases: {
      should_i_refinance: 'GET /api/calc/refi?current_rate=7.25&balance=400000&remaining_years=28',
      is_this_mortgage_offer_good: 'GET /api/grade/offer?rate=6.875&loan_amount=450000&points=0.5&credit_score=740&ltv=80',
      refinance_market_signal: 'GET /api/bundle/refi-signal',
      can_buyer_afford_median_home: 'GET /api/bundle/purchase-market',
      current_30yr_mortgage: 'GET /api/current?id=MORTGAGE30US',
      current_10yr_treasury: 'GET /api/current?id=DGS10',
      current_fed_funds: 'GET /api/current?id=FEDFUNDS',
      economic_context_for_llm: 'GET /api/bundle/context-brief',
      recession_signal: 'GET /api/derived/recession',
      yield_curve_spreads: 'GET /api/derived/yield-curve',
      current_eurusd: 'GET /api/fx/current?pair=EURUSD',
      company_fundamentals: 'GET /api/edgar/company?ticker=AAPL',
    },
    free_endpoints: ['GET /api/treasury/public', 'GET /health', 'GET /openapi.json', 'GET /.well-known/x402.json'],
  };
}

module.exports = {
  SERVICE, NETWORKS, TAGS, PAID_ROUTES, routeByPath, usdPrice, acceptedNetworks,
  buildResourceList, buildX402Manifest, buildOpenApi, buildAgentJson,
};
