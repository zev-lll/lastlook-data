require('dotenv').config();
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

// x402 v2 with CDP facilitator + Bazaar discovery
const { paymentMiddleware } = require('@x402/express');
const { x402ResourceServer, HTTPFacilitatorClient } = require('@x402/core/server');
const { registerExactEvmScheme } = require('@x402/evm/exact/server');
const { bazaarResourceServerExtension, declareDiscoveryExtension } = require('@x402/extensions/bazaar');
const { facilitator: cdpFacilitator } = require('@coinbase/x402');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Shared brand fields for all Bazaar endpoint declarations
const LASTLOOK_BRAND = {
  name: 'LastLook Data',
  description: 'Financial market data for AI agents — Treasury yields, mortgage rates, FX rates, energy prices, and macro indicators. Pay per query via x402.',
  category: 'finance',
  logo_url: 'https://api.lastlookdata.com/logo.png',
};

function lastlookExtension(inputSchema, outputExample) {
  // Derive minimal example values so AJV validation passes (required fields must be present in info.input.queryParams)
  const input = {};
  if (inputSchema?.properties) {
    for (const [key, spec] of Object.entries(inputSchema.properties)) {
      input[key] = spec.enum?.[0] ?? '';
    }
  }
  // Pass properties/required without the top-level type:object (library adds that)
  const cleanSchema = { properties: inputSchema?.properties || {} };
  if (inputSchema?.required) cleanSchema.required = inputSchema.required;

  const ext = declareDiscoveryExtension({
    input,
    inputSchema: cleanSchema,
    output: outputExample ? { example: outputExample } : undefined,
  });
  Object.assign(ext.bazaar.info, LASTLOOK_BRAND);
  return ext;
}

const cache = new NodeCache({ stdTTL: 3600 });

const PORT = process.env.PORT || 8080;
const FRED_API_KEY = process.env.FRED_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

// ── x402 v2 setup ─────────────────────────────────────────────────────────────

const facilitatorClient = new HTTPFacilitatorClient(cdpFacilitator);
const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);
server.registerExtension(bazaarResourceServerExtension);

// ── Allowed symbols ───────────────────────────────────────────────────────────

const ALLOWED_SERIES = new Set([
  'DGS30', 'DGS10', 'DGS5', 'DGS2', 'DGS1MO',
  'MORTGAGE30US', 'MORTGAGE15US', 'MSPUS', 'HOUST',
  'FEDFUNDS', 'SOFR', 'DPRIME', 'DTB3', 'IORB', 'EFFR',
  'CPIAUCSL', 'CPILFESL', 'UNRATE', 'GDP',
  'DCOILWTICO', 'DCOILBRENTEU', 'GASREGCOVW', 'DHHNGSP',
  'SAHMREALTIME',
]);

const SERIES_LABELS = {
  DGS30: '30-Year Treasury Constant Maturity Rate',
  DGS10: '10-Year Treasury Constant Maturity Rate',
  DGS5:  '5-Year Treasury Constant Maturity Rate',
  DGS2:  '2-Year Treasury Constant Maturity Rate',
  DGS1MO:'1-Month T-Bill Rate',
  MORTGAGE30US: '30-Year Fixed Rate Mortgage Average',
  MORTGAGE15US: '15-Year Fixed Rate Mortgage Average',
  MSPUS:        'Median Sales Price of Houses Sold',
  HOUST:        'Housing Starts',
  FEDFUNDS:     'Federal Funds Effective Rate',
  SOFR:         'Secured Overnight Financing Rate',
  DPRIME:       'Bank Prime Loan Rate',
  DTB3:         '3-Month T-Bill Secondary Market Rate',
  IORB:         'Interest on Reserve Balances',
  EFFR:         'Effective Federal Funds Rate',
  CPIAUCSL:     'Consumer Price Index (All Urban Consumers)',
  CPILFESL:     'Core CPI ex Food & Energy',
  UNRATE:       'Unemployment Rate',
  GDP:          'Gross Domestic Product',
  DCOILWTICO:   'WTI Crude Oil Price',
  DCOILBRENTEU: 'Brent Crude Oil Price',
  GASREGCOVW:   'US Regular Gasoline Price',
  DHHNGSP:      'Henry Hub Natural Gas Price',
  SAHMREALTIME: 'Real-Time Sahm Rule Recession Indicator',
};

const ALLOWED_FX = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
  'USDCAD', 'AUDUSD', 'NZDUSD', 'USDSEK', 'USDNOK',
]);

const FX_LABELS = {
  EURUSD: 'Euro / US Dollar', GBPUSD: 'British Pound / US Dollar',
  USDJPY: 'US Dollar / Japanese Yen', USDCHF: 'US Dollar / Swiss Franc',
  USDCAD: 'US Dollar / Canadian Dollar', AUDUSD: 'Australian Dollar / US Dollar',
  NZDUSD: 'New Zealand Dollar / US Dollar', USDSEK: 'US Dollar / Swedish Krona',
  USDNOK: 'US Dollar / Norwegian Krone',
};

// ── HEAD → 402 for paid endpoints ────────────────────────────────────────────

const PAID_PATHS = [
  '/api/current', '/api/date',
  '/api/series/30', '/api/series/90', '/api/series/365',
  '/api/treasury/current', '/api/treasury/date',
  '/api/fx/current', '/api/fx/date', '/api/fx/series',
  '/api/derived/yield-curve', '/api/derived/recession', '/api/derived/policy-spread',
  '/api/calendar',
  '/api/bundle/rate-environment', '/api/bundle/mortgage-pulse', '/api/bundle/macro',
  '/api/bundle/fx-dashboard', '/api/bundle/energy', '/api/bundle/context-brief',
  '/api/bundle/refi-signal', '/api/bundle/purchase-market',
  '/api/crypto/price', '/api/crypto/history', '/api/bundle/crypto',
  '/api/edgar/company',
];
app.use((req, res, next) => {
  if (req.method === 'HEAD' && PAID_PATHS.includes(req.path)) return res.status(402).end();
  next();
});

// ── x402 payment middleware ───────────────────────────────────────────────────

app.use(
  paymentMiddleware(
    {
      // ── FRED: current value ($0.01) ───────────────────────────────────────────
      'GET /api/current': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — most recent value for any supported FRED series. Use ?id=IORB, ?id=EFFR, ?id=MORTGAGE30US, ?id=FEDFUNDS, ?id=DGS10, etc.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','SAHMREALTIME','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] } }, required: ['id'] },
            { service: 'LastLook Data', series_id: 'IORB', label: 'Interest on Reserve Balances', date: '2026-05-09', value: 4.40, note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          ),
        },
      },

      // ── FRED: value by date ($0.01) ───────────────────────────────────────────
      'GET /api/date': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — value for any supported FRED series on a specific date. Use ?id=SERIES_ID&d=YYYY-MM-DD. Business days only.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','SAHMREALTIME','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] }, d: { type: 'string', description: 'Date in YYYY-MM-DD format' } }, required: ['id', 'd'] },
            { service: 'LastLook Data', series_id: 'DGS10', label: '10-Year Treasury Constant Maturity Rate', date: '2026-05-09', value: 4.42, note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          ),
        },
      },

      // ── FRED: 30-day series ($0.05) ───────────────────────────────────────────
      'GET /api/series/30': {
        accepts: [{ scheme: 'exact', price: '$0.05', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — last 30 days of any FRED series. Use for mortgage rates, Fed funds, IORB, EFFR, Treasury yields, CPI, energy prices, and more.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','SAHMREALTIME','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] } }, required: ['id'] },
            { service: 'LastLook Data', series_id: 'MORTGAGE30US', days: 30, count: 4, start: '2026-04-10', end: '2026-05-09', observations: [{ date: '2026-04-10', value: 6.82 }, { date: '2026-05-09', value: 6.79 }], note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          ),
        },
      },

      // ── FRED: 90-day series ($0.10) ───────────────────────────────────────────
      'GET /api/series/90': {
        accepts: [{ scheme: 'exact', price: '$0.10', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — last 90 days of any supported FRED series.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','SAHMREALTIME','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] } }, required: ['id'] },
            { service: 'LastLook Data', series_id: 'DGS30', days: 90, count: 63, start: '2026-02-09', end: '2026-05-09', observations: [{ date: '2026-02-09', value: 4.75 }, { date: '2026-05-09', value: 4.97 }], note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          ),
        },
      },

      // ── FRED: 365-day series ($0.25) ──────────────────────────────────────────
      'GET /api/series/365': {
        accepts: [{ scheme: 'exact', price: '$0.25', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — last 365 days of any supported FRED series.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','SAHMREALTIME','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] } }, required: ['id'] },
            { service: 'LastLook Data', series_id: 'DGS30', days: 365, count: 252, start: '2025-05-09', end: '2026-05-09', observations: [{ date: '2025-05-09', value: 4.55 }, { date: '2026-05-09', value: 4.97 }], note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          ),
        },
      },

      // ── Treasury aliases (backward compat) ────────────────────────────────────
      'GET /api/treasury/current': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — current 30-year US Treasury yield (DGS30). Alias for /api/current?id=DGS30.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: '2026-05-09', yield_percent: 4.97, note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          ),
        },
      },

      'GET /api/treasury/date': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — 30-year Treasury yield for a specific date. Alias for /api/date?id=DGS30&d=YYYY-MM-DD.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { d: { type: 'string', description: 'Date in YYYY-MM-DD format' } }, required: ['d'] },
            { service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: '2026-05-09', yield_percent: 4.97, note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          ),
        },
      },

      // ── FX: current ($0.01) ───────────────────────────────────────────────────
      'GET /api/fx/current': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — current exchange rate for a G10 currency pair. Source: European Central Bank.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { pair: { type: 'string', description: 'G10 currency pair', enum: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'] } }, required: ['pair'] },
            { service: 'LastLook Data', pair: 'EURUSD', label: 'Euro / US Dollar', date: '2026-05-09', rate: 1.1245, base: 'EUR', quote: 'USD', note: 'Source: Frankfurter (European Central Bank)' },
          ),
        },
      },

      // ── FX: by date ($0.01) ───────────────────────────────────────────────────
      'GET /api/fx/date': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — exchange rate for a G10 currency pair on a specific date. Use ?pair=EURUSD&d=YYYY-MM-DD.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { pair: { type: 'string', description: 'G10 currency pair', enum: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'] }, d: { type: 'string', description: 'Date in YYYY-MM-DD format' } }, required: ['pair', 'd'] },
            { service: 'LastLook Data', pair: 'EURUSD', label: 'Euro / US Dollar', date: '2026-05-09', rate: 1.1245, base: 'EUR', quote: 'USD', note: 'Source: Frankfurter (European Central Bank)' },
          ),
        },
      },

      // ── FX: series ($0.05/$0.10/$0.25) ───────────────────────────────────────
      'GET /api/fx/series': {
        accepts: [{ scheme: 'exact', price: '$0.05', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — historical daily exchange rates for a G10 currency pair.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { pair: { type: 'string', description: 'G10 currency pair', enum: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'] }, days: { type: 'string', description: '30, 90, or 365 days of history', enum: ['30','90','365'] } }, required: ['pair', 'days'] },
            { service: 'LastLook Data', pair: 'EURUSD', label: 'Euro / US Dollar', days: 30, count: 21, start: '2026-04-10', end: '2026-05-09', observations: [{ date: '2026-04-10', value: 1.1102 }, { date: '2026-05-09', value: 1.1245 }], note: 'Source: Frankfurter (European Central Bank)' },
          ),
        },
      },

      // ── Derived: yield curve spreads ($0.03) ──────────────────────────────────
      'GET /api/derived/yield-curve': {
        accepts: [{ scheme: 'exact', price: '$0.03', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — yield curve spreads (2s10s and 3m10y) with inversion signal. Computed from FRED Treasury data.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-15', spreads: { '2s10s': { value: -0.15, inverted: true }, '3m10y': { value: 0.42, inverted: false } }, components: { DGS2: 4.85, DGS10: 4.70, DGS1MO: 4.28 }, signal: 'Partially inverted' },
          ),
        },
      },

      // ── Derived: Sahm Rule recession indicator ($0.02) ────────────────────────
      'GET /api/derived/recession': {
        accepts: [{ scheme: 'exact', price: '$0.02', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — real-time Sahm Rule recession indicator. Value >= 0.5 signals recession underway. Source: FRED SAHMREALTIME.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-04-01', sahm_rule: { value: 0.37, threshold: 0.50, triggered: false, signal: 'No recession signal' } },
          ),
        },
      },

      // ── Derived: Fed policy spread ($0.02) ────────────────────────────────────
      'GET /api/derived/policy-spread': {
        accepts: [{ scheme: 'exact', price: '$0.02', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — EFFR vs IORB spread. Shows where the effective Fed funds rate trades relative to interest on reserves.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-14', effr: 4.33, iorb: 4.40, spread: -0.07, interpretation: 'EFFR trading below IORB — within normal operating band' },
          ),
        },
      },

      // ── Economic calendar ($0.02) ─────────────────────────────────────────────
      'GET /api/calendar': {
        accepts: [{ scheme: 'exact', price: '$0.02', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — upcoming FRED economic data release dates. CPI, jobs, GDP, Treasury, and more. Use ?days=30|60|90.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { days: { type: 'string', description: 'Lookahead window in days', enum: ['30','60','90'] } } },
            { service: 'LastLook Data', calendar_start: '2026-05-16', calendar_end: '2026-06-15', count: 12, releases: [{ date: '2026-05-20', release_id: 50, release_name: 'Employment Situation' }] },
          ),
        },
      },

      // ── Bundle: Refi Signal ($0.60) ───────────────────────────────────────────
      'GET /api/bundle/refi-signal': {
        accepts: [{ scheme: 'exact', price: '$0.60', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — refinance signal bundle: current 30yr and 15yr mortgage rates, 52-week range, MBS spread, rate trend, and refi break-even threshold. Tells an AI agent whether a borrower should consider refinancing.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-29', bundle: 'refi_signal', series: { MORTGAGE30US: 6.86, MORTGAGE15US: 6.12, DGS10: 4.46, FEDFUNDS: 4.33 }, derived: { mbs_spread: 2.40, week52_high: 7.22, week52_low: 6.41, week52_position_pct: 63, refi_breakeven_threshold: 7.61, refi_breakeven_label: 'Borrowers with existing rates above this level likely benefit from refinancing' }, signals: { rate_trend_30d: 'flat', rate_trend_90d: 'falling', rate_vs_52wk: 'mid_range', refi_environment: 'neutral' } },
          ),
        },
      },

      // ── Bundle: Purchase Market ($0.60) ───────────────────────────────────────
      'GET /api/bundle/purchase-market': {
        accepts: [{ scheme: 'exact', price: '$0.60', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — home purchase market bundle: current mortgage rate, median sale price, monthly payment estimate, income required to qualify, and affordability level. Directly answers whether a buyer can afford a median home.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-29', bundle: 'purchase_market', series: { MORTGAGE30US: 6.86, MSPUS: 419700, HOUST: 1378, FEDFUNDS: 4.33 }, derived: { loan_amount: 335760, monthly_payment_estimate: 2213, income_required_28pct: 94843, home_price_change_qoq: 2.1 }, signals: { affordability_level: 'elevated', market_activity: 'moderate' } },
          ),
        },
      },

      // ── Bundle: Rate Environment Snapshot ($0.35) ─────────────────────────────
      'GET /api/bundle/rate-environment': {
        accepts: [{ scheme: 'exact', price: '$0.35', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — rate environment snapshot: FEDFUNDS, SOFR, DGS2, DGS5, DGS10, DGS30 plus yield curve spreads and policy spread. One payment, all rate data.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-29', bundle: 'rate_environment', series: { FEDFUNDS: 4.33, SOFR: 4.31, DGS2: 3.94, DGS5: 4.01, DGS10: 4.46, DGS30: 4.97 }, derived: { spread_2s10s: 0.52, spread_3m10y: 0.18, policy_spread: -0.07 }, signals: { curve_shape: 'Normal (upward sloping)', policy_stance: 'EFFR trading below IORB — within normal operating band' } },
          ),
        },
      },

      // ── Bundle: Mortgage Market Pulse ($0.40) ─────────────────────────────────
      'GET /api/bundle/mortgage-pulse': {
        accepts: [{ scheme: 'exact', price: '$0.40', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — mortgage market pulse: 30yr and 15yr mortgage rates, 10Y Treasury, Fed funds, median home price, housing starts. Includes MBS spread and rate trend.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-29', bundle: 'mortgage_pulse', series: { MORTGAGE30US: 6.86, MORTGAGE15US: 6.12, DGS10: 4.46, FEDFUNDS: 4.33, MSPUS: 412000, HOUST: 1401 }, derived: { mbs_spread: 2.40, mbs_spread_label: '30yr mortgage minus 10Y Treasury' }, signals: { rate_trend_30d: 'flat' } },
          ),
        },
      },

      // ── Bundle: Macro Health Snapshot ($0.50) ─────────────────────────────────
      'GET /api/bundle/macro': {
        accepts: [{ scheme: 'exact', price: '$0.50', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — macro health snapshot: GDP, unemployment, CPI, core CPI, Fed funds, yield curve spreads, and Sahm Rule recession signal. Includes cycle phase.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-29', bundle: 'macro', series: { GDP: 29350, UNRATE: 4.2, CPIAUCSL: 315.5, CPILFESL: 323.8, FEDFUNDS: 4.33 }, derived: { sahm_rule: 0.37, spread_2s10s: 0.52 }, signals: { cycle_phase: 'expansion', recession_triggered: false } },
          ),
        },
      },

      // ── Bundle: FX Dashboard ($0.35) ──────────────────────────────────────────
      'GET /api/bundle/fx-dashboard': {
        accepts: [{ scheme: 'exact', price: '$0.35', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — G10 FX dashboard: all 9 spot rates (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK) plus USD strength index vs basket (30d).',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-29', bundle: 'fx_dashboard', series: { EURUSD: 1.1345, GBPUSD: 1.3512, USDJPY: 142.5, USDCHF: 0.8910, USDCAD: 1.3621, AUDUSD: 0.6445, NZDUSD: 0.5987, USDSEK: 9.82, USDNOK: 10.28 }, derived: { usd_strength_index: -2.18, usd_strength_index_label: 'Avg % change of USD vs G10 basket (30d)' }, signals: { usd_trend_30d: 'weakening' } },
          ),
        },
      },

      // ── Bundle: Energy & Commodities ($0.25) ──────────────────────────────────
      'GET /api/bundle/energy': {
        accepts: [{ scheme: 'exact', price: '$0.25', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — energy and commodities bundle: WTI crude, Brent crude, US regular gasoline, Henry Hub natural gas. Includes WTI-Brent spread and market signal.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-29', bundle: 'energy', series: { DCOILWTICO: 61.5, DCOILBRENTEU: 64.8, GASREGCOVW: 3.18, DHHNGSP: 3.82 }, derived: { wti_brent_spread: -3.3, wti_brent_spread_label: 'WTI minus Brent crude (USD/bbl)' }, signals: { wti_brent_signal: 'Normal contango (Brent premium)' } },
          ),
        },
      },

      // ── Bundle: Economic Context Brief ($0.75) ────────────────────────────────
      'GET /api/bundle/context-brief': {
        accepts: [{ scheme: 'exact', price: '$0.75', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — economic context brief: 15+ indicators across rates, inflation, employment, FX, and energy in a pre-formatted natural-language paragraph for LLM context injection.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', as_of: '2026-05-29', bundle: 'context_brief', brief: 'As of 2026-05-29: The Fed Funds Rate is 4.33%, the yield curve is +52bps (normal), 10Y Treasury at 4.46%, 30Y at 4.97%, CPI at 315.5, unemployment at 4.2%, 30yr mortgage rate 6.86% (240bps over 10Y), WTI crude $61.50/bbl, Brent $64.80/bbl, EUR/USD 1.1345, USD/JPY 142.5, Sahm Rule 0.37 (below 0.50 threshold).', series: { FEDFUNDS: 4.33, DGS10: 4.46, DGS30: 4.97, MORTGAGE30US: 6.86, UNRATE: 4.2, CPIAUCSL: 315.5, DCOILWTICO: 61.5 } },
          ),
        },
      },

      // ── Crypto: single coin price ($0.02) ─────────────────────────────────────
      'GET /api/crypto/price': {
        accepts: [{ scheme: 'exact', price: '$0.02', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — current price, 24h change, market cap, and volume for any supported cryptocurrency. Use ?coin=BTC|ETH|SOL|BNB|XRP|ADA|AVAX|DOGE|LINK|DOT|etc. Source: CoinGecko.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { coin: { type: 'string', description: 'Crypto symbol', enum: ['BTC','ETH','SOL','BNB','XRP','USDT','USDC','ADA','AVAX','DOGE','DOT','MATIC','LINK','LTC','ATOM','UNI','SUI','APT','NEAR','PEPE'] } }, required: ['coin'] },
            { service: 'LastLook Data', symbol: 'BTC', name: 'Bitcoin', price_usd: 67500.5, change_24h_pct: 2.43, market_cap_usd: 1332000000000, volume_24h_usd: 28500000000, as_of: '2026-06-23T12:00:00Z', source: 'CoinGecko' },
          ),
        },
      },

      // ── Crypto: historical prices ($0.15) ─────────────────────────────────────
      'GET /api/crypto/history': {
        accepts: [{ scheme: 'exact', price: '$0.15', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — historical daily closing prices for any supported cryptocurrency. Use ?coin=BTC&days=30|90|365. Source: CoinGecko.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { coin: { type: 'string', description: 'Crypto symbol', enum: ['BTC','ETH','SOL','BNB','XRP','USDT','USDC','ADA','AVAX','DOGE','DOT','MATIC','LINK','LTC','ATOM','UNI','SUI','APT','NEAR','PEPE'] }, days: { type: 'string', description: '30, 90, or 365 days of history', enum: ['30','90','365'] } }, required: ['coin', 'days'] },
            { service: 'LastLook Data', symbol: 'BTC', name: 'Bitcoin', days: 30, count: 30, start: '2026-05-24', end: '2026-06-23', observations: [{ date: '2026-05-24', price_usd: 65000.0 }, { date: '2026-06-23', price_usd: 67500.5 }], source: 'CoinGecko' },
          ),
        },
      },

      // ── Bundle: Crypto Top 20 ($0.50) ─────────────────────────────────────────
      'GET /api/bundle/crypto': {
        accepts: [{ scheme: 'exact', price: '$0.50', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — top 20 cryptocurrencies by market cap: price, 24h change, 7d change, market cap, and volume in one call. Source: CoinGecko.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            null,
            { service: 'LastLook Data', bundle: 'crypto', as_of: '2026-06-23T12:00:00Z', count: 20, coins: [{ rank: 1, symbol: 'BTC', name: 'Bitcoin', price_usd: 67500.5, change_24h_pct: 2.43, change_7d_pct: -1.2, market_cap_usd: 1332000000000, volume_24h_usd: 28500000000 }], source: 'CoinGecko' },
          ),
        },
      },

      // ── EDGAR: company fundamentals ($0.75) ───────────────────────────────────
      'GET /api/edgar/company': {
        accepts: [{ scheme: 'exact', price: '$0.75', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — company financial fundamentals from SEC EDGAR XBRL: revenue, net income, total assets, stockholders equity, and EPS from 10-K and 10-Q filings. Use ?ticker=AAPL|MSFT|TSLA|AMZN|NVDA|GOOGL|META|etc.',
        mimeType: 'application/json',
        extensions: {
          ...lastlookExtension(
            { type: 'object', properties: { ticker: { type: 'string', description: 'Stock ticker symbol e.g. AAPL, MSFT, TSLA, AMZN, NVDA, GOOGL, META' } }, required: ['ticker'] },
            { service: 'LastLook Data', ticker: 'AAPL', company_name: 'APPLE INC', cik: '0000320193', fundamentals: { revenue: { annual: [{ period_end: '2023-09-30', value: 383285000000, fiscal_year: 2023 }], quarterly: [{ period_end: '2024-03-30', value: 90753000000, fiscal_period: 'Q2' }] }, net_income: { annual: [{ period_end: '2023-09-30', value: 96995000000 }] }, total_assets: { annual: [{ period_end: '2023-09-30', value: 352583000000 }] } }, as_of: '2026-06-23', source: 'SEC EDGAR (XBRL)' },
          ),
        },
      },
    },
    server,
  )
);

// ── FRED helpers ──────────────────────────────────────────────────────────────

async function fetchFRED(startDate, endDate) {
  const cacheKey = `dgs30_${startDate}_${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const response = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
    params: { series_id: 'DGS30', api_key: FRED_API_KEY, file_type: 'json', observation_start: startDate, observation_end: endDate },
  });
  const observations = response.data.observations;
  cache.set(cacheKey, observations);
  return observations;
}

async function fetchFredSeries(seriesId, startDate, endDate) {
  const cacheKey = `${seriesId}_${startDate}_${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const response = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
    params: { series_id: seriesId, api_key: FRED_API_KEY, file_type: 'json', observation_start: startDate, observation_end: endDate },
  });
  const observations = response.data.observations
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }));
  cache.set(cacheKey, observations);
  return observations;
}

// ── FX helpers ────────────────────────────────────────────────────────────────

async function fetchFXCurrent(pair) {
  const cacheKey = `fx_current_${pair}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const base = pair.slice(0, 3), quote = pair.slice(3, 6);
  const response = await axios.get('https://api.frankfurter.app/latest', { params: { from: base, to: quote } });
  const result = { date: response.data.date, rate: response.data.rates[quote], pair, base, quote };
  cache.set(cacheKey, result, 3600);
  return result;
}

async function fetchFXByDate(pair, date) {
  const cacheKey = `fx_date_${pair}_${date}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const base = pair.slice(0, 3), quote = pair.slice(3, 6);
  const response = await axios.get(`https://api.frankfurter.app/${date}`, { params: { from: base, to: quote } });
  const result = { date: response.data.date, rate: response.data.rates[quote], pair, base, quote };
  cache.set(cacheKey, result);
  return result;
}

async function fetchFXSeries(pair, days) {
  const cacheKey = `fx_series_${pair}_${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const base = pair.slice(0, 3), quote = pair.slice(3, 6);
  const response = await axios.get(`https://api.frankfurter.app/${daysAgoISO(days)}..${todayISO()}`, { params: { from: base, to: quote } });
  const observations = Object.entries(response.data.rates)
    .map(([date, rates]) => ({ date, value: rates[quote] }))
    .sort((a, b) => a.date.localeCompare(b.date));
  cache.set(cacheKey, observations, 3600);
  return observations;
}

// ── Crypto constants ──────────────────────────────────────────────────────────

const COIN_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana',
  BNB: 'binancecoin', XRP: 'ripple', USDT: 'tether',
  USDC: 'usd-coin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOGE: 'dogecoin', DOT: 'polkadot', MATIC: 'matic-network',
  LINK: 'chainlink', LTC: 'litecoin', ATOM: 'cosmos',
  UNI: 'uniswap', SUI: 'sui', APT: 'aptos',
  NEAR: 'near', PEPE: 'pepe',
};

const COIN_LABELS = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana',
  BNB: 'BNB', XRP: 'XRP', USDT: 'Tether',
  USDC: 'USD Coin', ADA: 'Cardano', AVAX: 'Avalanche',
  DOGE: 'Dogecoin', DOT: 'Polkadot', MATIC: 'Polygon',
  LINK: 'Chainlink', LTC: 'Litecoin', ATOM: 'Cosmos',
  UNI: 'Uniswap', SUI: 'Sui', APT: 'Aptos',
  NEAR: 'NEAR Protocol', PEPE: 'Pepe',
};

const ALLOWED_COINS = new Set(Object.keys(COIN_IDS));

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// ── EDGAR constants ───────────────────────────────────────────────────────────

const EDGAR_HEADERS = {
  'User-Agent': 'LastLook Data api@lastlookdata.com',
  'Accept': 'application/json',
};

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function fetchCoinPrice(symbol) {
  const id = COIN_IDS[symbol];
  const cacheKey = `crypto_price_${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const response = await axios.get(`${COINGECKO_BASE}/simple/price`, {
    params: {
      ids: id,
      vs_currencies: 'usd',
      include_market_cap: true,
      include_24hr_vol: true,
      include_24hr_change: true,
      precision: 6,
    },
  });
  const data = response.data[id];
  const result = {
    symbol,
    name: COIN_LABELS[symbol],
    price_usd: data.usd,
    market_cap_usd: data.usd_market_cap,
    volume_24h_usd: data.usd_24h_vol,
    change_24h_pct: parseFloat((data.usd_24h_change || 0).toFixed(4)),
    fetched_at: new Date().toISOString(),
  };
  cache.set(cacheKey, result, 60); // 1-min TTL for prices
  return result;
}

async function fetchCryptoMarkets(perPage = 20) {
  const cacheKey = `crypto_markets_${perPage}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const response = await axios.get(`${COINGECKO_BASE}/coins/markets`, {
    params: {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: perPage,
      page: 1,
      sparkline: false,
      price_change_percentage: '24h,7d',
      precision: 6,
    },
  });
  cache.set(cacheKey, response.data, 60); // 1-min TTL
  return response.data;
}

async function fetchCoinHistory(symbol, days) {
  const id = COIN_IDS[symbol];
  const cacheKey = `crypto_history_${symbol}_${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const response = await axios.get(`${COINGECKO_BASE}/coins/${id}/market_chart`, {
    params: { vs_currency: 'usd', days, interval: 'daily' },
  });
  // prices is [[timestamp_ms, price], ...] — deduplicate by date, keep last per day
  const byDate = {};
  for (const [ts, price] of response.data.prices) {
    const date = new Date(ts).toISOString().slice(0, 10);
    byDate[date] = parseFloat(price.toFixed(6));
  }
  const result = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price_usd]) => ({ date, price_usd }));
  cache.set(cacheKey, result, 3600); // 1-hour TTL for history
  return result;
}

// ── EDGAR helpers ─────────────────────────────────────────────────────────────

let edgarTickerMapCache = null;

async function getEdgarTickerMap() {
  if (edgarTickerMapCache) return edgarTickerMapCache;
  const cached = cache.get('edgar_ticker_map');
  if (cached) { edgarTickerMapCache = cached; return cached; }
  const response = await axios.get('https://www.sec.gov/files/company_tickers.json', {
    headers: EDGAR_HEADERS,
    timeout: 20000,
  });
  const map = {};
  for (const entry of Object.values(response.data)) {
    map[entry.ticker.toUpperCase()] = {
      cik: String(entry.cik_str).padStart(10, '0'),
      name: entry.title,
    };
  }
  cache.set('edgar_ticker_map', map, 86400); // 24-hour TTL
  edgarTickerMapCache = map;
  return map;
}

async function fetchEdgarConcept(cikUrl, concept) {
  try {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/${cikUrl}/us-gaap/${concept}.json`;
    const response = await axios.get(url, { headers: EDGAR_HEADERS, timeout: 15000 });
    const usd = response.data.units?.USD;
    if (!usd || !usd.length) return null;
    const annual = usd
      .filter(e => e.form === '10-K' && e.val != null)
      .sort((a, b) => b.end.localeCompare(a.end))
      .slice(0, 5)
      .map(e => ({ period_end: e.end, fiscal_year: e.fy, value: e.val, filed: e.filed }));
    const quarterly = usd
      .filter(e => e.form === '10-Q' && e.val != null && e.fp)
      .sort((a, b) => b.end.localeCompare(a.end))
      .slice(0, 8)
      .map(e => ({ period_end: e.end, fiscal_period: e.fp, fiscal_year: e.fy, value: e.val, filed: e.filed }));
    return { concept, label: response.data.label || concept, annual, quarterly };
  } catch (err) {
    if (err.response?.status === 404) return null;
    return null; // absorb timeouts and other errors gracefully
  }
}

async function fetchEdgarCompany(ticker) {
  const upper = ticker.toUpperCase();
  const cacheKey = `edgar_company_${upper}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const tickerMap = await getEdgarTickerMap();
  const company = tickerMap[upper];
  if (!company) return null;
  const cikUrl = `CIK${company.cik}`;
  const [rev, revAlt, netIncome, assets, equity, eps] = await Promise.allSettled([
    fetchEdgarConcept(cikUrl, 'Revenues'),
    fetchEdgarConcept(cikUrl, 'RevenueFromContractWithCustomerExcludingAssessedTax'),
    fetchEdgarConcept(cikUrl, 'NetIncomeLoss'),
    fetchEdgarConcept(cikUrl, 'Assets'),
    fetchEdgarConcept(cikUrl, 'StockholdersEquity'),
    fetchEdgarConcept(cikUrl, 'EarningsPerShareBasic'),
  ]);
  const get = r => r.status === 'fulfilled' ? r.value : null;
  const result = {
    service: 'LastLook Data',
    ticker: upper,
    company_name: company.name,
    cik: company.cik,
    fundamentals: {
      revenue:              get(rev) || get(revAlt),
      net_income:           get(netIncome),
      total_assets:         get(assets),
      stockholders_equity:  get(equity),
      eps_basic:            get(eps),
    },
    as_of: new Date().toISOString().slice(0, 10),
    edgar_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}&type=10-K&owner=include&count=10`,
    source: 'SEC EDGAR (XBRL)',
    note: 'Annual data from 10-K filings. Quarterly from 10-Q. All monetary values in USD.',
  };
  cache.set(cacheKey, result, 14400); // 4-hour TTL
  return result;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function calcMonthlyPayment(principal, annualRatePct, termYears = 30) {
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return Math.round(principal / n);
  return Math.round(principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  if (req.accepts('html') && !req.accepts('json')) return res.redirect(301, 'https://www.lastlookdata.com');
  res.json({
    service: 'LastLook Data',
    version: '2.12.0',
    description: 'Financial market data for AI agents — Treasury yields, mortgage rates, FX rates, energy prices, macro indicators, crypto prices (CoinGecko), and company fundamentals (SEC EDGAR). Pay per query via x402.',
    website: 'https://www.lastlookdata.com',
    openapi: 'https://api.lastlookdata.com/openapi.json',
    x402: {
      manifest: 'https://api.lastlookdata.com/.well-known/x402.json',
      version: 2,
      network: 'eip155:8453',
      currency: 'USDC',
    },
    resources: [
      { method: 'GET', url: 'https://api.lastlookdata.com/api/current',      description: 'Most recent value for any supported FRED series (Treasury yields, mortgage rates, CPI, unemployment, energy prices, benchmark rates). Use ?id=SERIES_ID.',  price: '0.01', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/date',         description: 'FRED series value on a specific date. Use ?id=SERIES_ID&d=YYYY-MM-DD.',                                                                                          price: '0.01', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/series/30',    description: 'Last 30 days of any supported FRED series. Use ?id=SERIES_ID.',                                                                                                    price: '0.05', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/series/90',    description: 'Last 90 days of any supported FRED series. Use ?id=SERIES_ID.',                                                                                                    price: '0.10', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/series/365',   description: 'Last 365 days of any supported FRED series. Use ?id=SERIES_ID.',                                                                                                   price: '0.25', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/treasury/current', description: 'Current Treasury yield curve — all maturities (1M, 2Y, 5Y, 10Y, 30Y) in one call.',                                                                         price: '0.01', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/treasury/date',    description: 'Treasury yield curve on a specific date. Use ?d=YYYY-MM-DD.',                                                                                                 price: '0.01', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/fx/current',   description: 'Current G10 FX rate. Use ?pair=EURUSD, GBPUSD, USDJPY, etc.',                                                                                                     price: '0.01', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/fx/date',      description: 'G10 FX rate on a specific date. Use ?pair=EURUSD&d=YYYY-MM-DD.',                                                                                                  price: '0.01', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/fx/series',    description: 'Historical G10 FX rate series. Use ?pair=EURUSD&days=30 (or 90, 365).',                                                                                           price: '0.05', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/derived/yield-curve',   description: 'Yield curve spreads (2s10s and 3m10y) with inversion signal computed from live FRED data.',                                                              price: '0.03', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/derived/recession',     description: 'Real-Time Sahm Rule recession indicator — current value, threshold, triggered flag, and signal.',                                                        price: '0.03', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/derived/policy-spread', description: 'Fed policy spread — EFFR vs IORB with interpretation of monetary policy stance.',                                                                        price: '0.03', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/calendar',     description: 'Upcoming economic events — next FOMC meeting date and CPI release date.',                                                                                         price: '0.01', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/bundle/refi-signal',       description: 'Refinance signal — current 30yr/15yr rates, 52-week range, MBS spread, rate trend, and refi break-even threshold. Tells an AI agent whether a borrower should consider refinancing.',  price: '0.60', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/bundle/purchase-market',  description: 'Home purchase market — median sale price, monthly payment estimate on median home (20% down), income required to qualify at 28% DTI, affordability level, housing starts.',      price: '0.60', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/bundle/rate-environment', description: 'Rate environment snapshot — FEDFUNDS, SOFR, DGS2, DGS5, DGS10, DGS30 with yield curve spreads and policy spread. One payment, all rate data.',                  price: '0.35', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/bundle/mortgage-pulse',   description: 'Mortgage market pulse — 30yr/15yr mortgage rates, 10Y Treasury, Fed funds, median home price, housing starts. Includes MBS spread and rate trend.',           price: '0.40', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/bundle/macro',            description: 'Macro health snapshot — GDP, unemployment, CPI, core CPI, Fed funds, yield curve, and Sahm Rule recession signal with cycle phase interpretation.',             price: '0.50', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/bundle/fx-dashboard',     description: 'G10 FX dashboard — all 9 spot rates (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK) with USD strength index vs basket (30d).',      price: '0.35', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/bundle/energy',           description: 'Energy and commodities bundle — WTI crude, Brent crude, US gasoline, Henry Hub natural gas with WTI-Brent spread and market signal.',                         price: '0.25', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/bundle/context-brief',    description: 'Economic context brief — 15+ indicators in a pre-formatted natural-language paragraph ready for LLM context injection. Covers rates, inflation, FX, energy.',  price: '0.75', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/crypto/price',           description: 'Current price, 24h change, market cap, and volume for any supported crypto. Use ?coin=BTC|ETH|SOL|BNB|XRP|ADA|AVAX|DOGE|LINK|DOT|etc. Source: CoinGecko.',         price: '0.02', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/crypto/history',         description: 'Historical daily prices for any supported cryptocurrency. Use ?coin=BTC&days=30|90|365. Source: CoinGecko.',                                                         price: '0.15', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/bundle/crypto',          description: 'Top 20 cryptocurrencies by market cap — price, 24h change, 7d change, market cap, volume in one call. Source: CoinGecko.',                                          price: '0.50', currency: 'USDC' },
      { method: 'GET', url: 'https://api.lastlookdata.com/api/edgar/company',          description: 'Company fundamentals from SEC EDGAR XBRL: revenue, net income, total assets, stockholders equity, EPS. 10-K and 10-Q filings. Use ?ticker=AAPL|MSFT|TSLA|etc.',   price: '0.75', currency: 'USDC' },
    ],
    supported_series: {
      treasury:        ['DGS30', 'DGS10', 'DGS5', 'DGS2', 'DGS1MO'],
      mortgage_housing:['MORTGAGE30US', 'MORTGAGE15US', 'MSPUS', 'HOUST'],
      benchmark_rates: ['FEDFUNDS', 'SOFR', 'DPRIME', 'DTB3', 'IORB', 'EFFR'],
      macro:           ['CPIAUCSL', 'CPILFESL', 'UNRATE', 'GDP', 'SAHMREALTIME'],
      energy:          ['DCOILWTICO', 'DCOILBRENTEU', 'GASREGCOVW', 'DHHNGSP'],
    },
    supported_fx: [...ALLOWED_FX],
    supported_crypto: [...ALLOWED_COINS],
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data', version: '2.12.0' }));

app.get('/logo.png', (req, res) => res.sendFile('logo.png', { root: __dirname }));

app.get('/openapi.json', (req, res) => res.sendFile('openapi.json', { root: __dirname }));
app.get('/agent.json', (req, res) => res.sendFile('agent.json', { root: __dirname }));
app.get('/.well-known/agent.json', (req, res) => res.sendFile('agent.json', { root: __dirname }));

app.get(['/.well-known/x402', '/.well-known/x402.json'], (req, res) => res.json({
  name: 'LastLook Data',
  description: 'Financial market data for AI agents — Treasury yields, mortgage rates, energy prices, FX rates, and macro indicators. Pay per query via x402. No API keys or accounts required.',
  logo_url: 'https://api.lastlookdata.com/logo.png',
  url: 'https://www.lastlookdata.com',
  website: 'https://www.lastlookdata.com',
  docs: 'https://www.lastlookdata.com/docs',
  openapi: 'https://api.lastlookdata.com/openapi.json',
  category: 'finance',
  version: '1.0',
  base_url: 'https://api.lastlookdata.com',
  content_type: 'application/json',
  payment: { protocol: 'x402', network: 'eip155:8453', asset: 'USDC' },
  resources: [
    {
      name: 'FRED Series — Current Value',
      url: 'https://api.lastlookdata.com/api/current',
      method: 'GET',
      description: 'Most recent value for any supported FRED series. Use ?id= with DGS10, MORTGAGE30US, FEDFUNDS, IORB, EFFR, CPIAUCSL, UNRATE, DCOILWTICO, etc.',
      price: '0.01',
      currency: 'USDC',
      pricing: { amount: '0.01', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP','SAHMREALTIME'] } },
    },
    {
      name: 'FRED Series — Value by Date',
      url: 'https://api.lastlookdata.com/api/date',
      method: 'GET',
      description: 'FRED series value for a specific date. Use ?id=SERIES_ID&d=YYYY-MM-DD. Business days only.',
      price: '0.01',
      currency: 'USDC',
      pricing: { amount: '0.01', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: {
        id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP','SAHMREALTIME'] },
        d: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      },
    },
    {
      name: 'FRED Series — Last 30 Days',
      url: 'https://api.lastlookdata.com/api/series/30',
      method: 'GET',
      description: 'Last 30 days of observations for any supported FRED series. Use ?id=SERIES_ID.',
      price: '0.05',
      currency: 'USDC',
      pricing: { amount: '0.05', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP','SAHMREALTIME'] } },
    },
    {
      name: 'FRED Series — Last 90 Days',
      url: 'https://api.lastlookdata.com/api/series/90',
      method: 'GET',
      description: 'Last 90 days of observations for any supported FRED series. Use ?id=SERIES_ID.',
      price: '0.10',
      currency: 'USDC',
      pricing: { amount: '0.10', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP','SAHMREALTIME'] } },
    },
    {
      name: 'FRED Series — Last 365 Days',
      url: 'https://api.lastlookdata.com/api/series/365',
      method: 'GET',
      description: 'Last 365 days of observations for any supported FRED series. Use ?id=SERIES_ID.',
      price: '0.25',
      currency: 'USDC',
      pricing: { amount: '0.25', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP','SAHMREALTIME'] } },
    },
    {
      name: 'G10 FX Rate — Current',
      url: 'https://api.lastlookdata.com/api/fx/current',
      method: 'GET',
      description: 'Current exchange rate for any G10 currency pair. Use ?pair=EURUSD, USDJPY, GBPUSD, etc. Source: ECB.',
      price: '0.01',
      currency: 'USDC',
      pricing: { amount: '0.01', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: { pair: { type: 'string', description: 'G10 currency pair', enum: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'] } },
    },
    {
      name: 'G10 FX Rate — By Date',
      url: 'https://api.lastlookdata.com/api/fx/date',
      method: 'GET',
      description: 'G10 exchange rate for a specific date. Use ?pair=EURUSD&d=YYYY-MM-DD. Source: ECB.',
      price: '0.01',
      currency: 'USDC',
      pricing: { amount: '0.01', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: {
        pair: { type: 'string', description: 'G10 currency pair', enum: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'] },
        d: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      },
    },
    {
      name: 'G10 FX Rate — Historical Series',
      url: 'https://api.lastlookdata.com/api/fx/series',
      method: 'GET',
      description: 'Historical daily exchange rates for a G10 currency pair. Use ?pair=EURUSD&days=30|90|365. Source: ECB.',
      price: '0.05',
      currency: 'USDC',
      pricing: { amount: '0.05', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: {
        pair: { type: 'string', description: 'G10 currency pair', enum: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'] },
        days: { type: 'string', description: 'History window', enum: ['30','90','365'] },
      },
    },
    {
      name: '30-Year Treasury Yield — Current',
      url: 'https://api.lastlookdata.com/api/treasury/current',
      method: 'GET',
      description: 'Most recent 30-year US Treasury constant maturity yield (DGS30). Source: FRED.',
      price: '0.01',
      currency: 'USDC',
      pricing: { amount: '0.01', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: '30-Year Treasury Yield — By Date',
      url: 'https://api.lastlookdata.com/api/treasury/date',
      method: 'GET',
      description: '30-year US Treasury yield for a specific date. Use ?d=YYYY-MM-DD.',
      price: '0.01',
      currency: 'USDC',
      pricing: { amount: '0.01', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: { d: { type: 'string', description: 'Date in YYYY-MM-DD format' } },
    },
    {
      name: 'Yield Curve Spreads',
      url: 'https://api.lastlookdata.com/api/derived/yield-curve',
      method: 'GET',
      description: '2s10s and 3m10y Treasury yield curve spreads with inversion signal. Computed from FRED data.',
      price: '0.03',
      currency: 'USDC',
      pricing: { amount: '0.03', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Sahm Rule Recession Indicator',
      url: 'https://api.lastlookdata.com/api/derived/recession',
      method: 'GET',
      description: 'Real-time Sahm Rule recession indicator. Value >= 0.50 signals recession underway. Source: FRED SAHMREALTIME.',
      price: '0.02',
      currency: 'USDC',
      pricing: { amount: '0.02', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Fed Policy Spread (EFFR vs IORB)',
      url: 'https://api.lastlookdata.com/api/derived/policy-spread',
      method: 'GET',
      description: 'Effective Fed funds rate vs interest on reserves spread, with interpretation. Source: FRED.',
      price: '0.02',
      currency: 'USDC',
      pricing: { amount: '0.02', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Economic Calendar',
      url: 'https://api.lastlookdata.com/api/calendar',
      method: 'GET',
      description: 'Upcoming FRED economic data release dates — CPI, jobs, GDP, Treasury rates, and more. Use ?days=30|60|90.',
      price: '0.02',
      currency: 'USDC',
      pricing: { amount: '0.02', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: { days: { type: 'string', description: 'Lookahead window', enum: ['30','60','90'] } },
    },
    {
      name: 'Bundle — Refi Signal',
      url: 'https://api.lastlookdata.com/api/bundle/refi-signal',
      method: 'GET',
      description: 'Refinance signal: current 30yr/15yr mortgage rates, 52-week high/low, MBS spread, rate trend, and refi break-even threshold. Answers whether a borrower should consider refinancing.',
      price: '0.60',
      currency: 'USDC',
      pricing: { amount: '0.60', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Bundle — Purchase Market',
      url: 'https://api.lastlookdata.com/api/bundle/purchase-market',
      method: 'GET',
      description: 'Home purchase market: median sale price, monthly P&I payment estimate on median home (20% down), annual income required at 28% DTI, affordability level, and housing starts.',
      price: '0.60',
      currency: 'USDC',
      pricing: { amount: '0.60', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Bundle — Rate Environment Snapshot',
      url: 'https://api.lastlookdata.com/api/bundle/rate-environment',
      method: 'GET',
      description: 'Rate environment snapshot: FEDFUNDS, SOFR, DGS2, DGS5, DGS10, DGS30 with yield curve spreads and Fed policy spread. One payment.',
      price: '0.35',
      currency: 'USDC',
      pricing: { amount: '0.35', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Bundle — Mortgage Market Pulse',
      url: 'https://api.lastlookdata.com/api/bundle/mortgage-pulse',
      method: 'GET',
      description: 'Mortgage market pulse: 30yr and 15yr mortgage rates, 10Y Treasury, Fed funds, median home price, housing starts. Includes MBS spread and rate trend.',
      price: '0.40',
      currency: 'USDC',
      pricing: { amount: '0.40', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Bundle — Macro Health Snapshot',
      url: 'https://api.lastlookdata.com/api/bundle/macro',
      method: 'GET',
      description: 'Macro health snapshot: GDP, unemployment, CPI, core CPI, Fed funds, yield curve, and Sahm Rule with cycle phase interpretation.',
      price: '0.50',
      currency: 'USDC',
      pricing: { amount: '0.50', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Bundle — G10 FX Dashboard',
      url: 'https://api.lastlookdata.com/api/bundle/fx-dashboard',
      method: 'GET',
      description: 'G10 FX dashboard: all 9 spot rates (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK) with USD strength index vs basket.',
      price: '0.35',
      currency: 'USDC',
      pricing: { amount: '0.35', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Bundle — Energy & Commodities',
      url: 'https://api.lastlookdata.com/api/bundle/energy',
      method: 'GET',
      description: 'Energy and commodities bundle: WTI crude, Brent crude, US regular gasoline, Henry Hub natural gas. Includes WTI-Brent spread.',
      price: '0.25',
      currency: 'USDC',
      pricing: { amount: '0.25', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Bundle — Economic Context Brief',
      url: 'https://api.lastlookdata.com/api/bundle/context-brief',
      method: 'GET',
      description: '15+ indicators across rates, inflation, employment, FX, and energy in a pre-formatted natural-language paragraph for LLM context injection.',
      price: '0.75',
      currency: 'USDC',
      pricing: { amount: '0.75', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'Crypto — Current Price',
      url: 'https://api.lastlookdata.com/api/crypto/price',
      method: 'GET',
      description: 'Current price, 24h change, market cap, and volume for any supported cryptocurrency. Use ?coin=BTC|ETH|SOL|BNB|XRP|ADA|AVAX|DOGE|LINK|DOT|etc. Source: CoinGecko.',
      price: '0.02',
      currency: 'USDC',
      pricing: { amount: '0.02', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: { coin: { type: 'string', description: 'Crypto symbol', enum: ['BTC','ETH','SOL','BNB','XRP','USDT','USDC','ADA','AVAX','DOGE','DOT','MATIC','LINK','LTC','ATOM','UNI','SUI','APT','NEAR','PEPE'] } },
    },
    {
      name: 'Crypto — Historical Prices',
      url: 'https://api.lastlookdata.com/api/crypto/history',
      method: 'GET',
      description: 'Historical daily prices for any supported cryptocurrency. Use ?coin=BTC&days=30|90|365. Source: CoinGecko.',
      price: '0.15',
      currency: 'USDC',
      pricing: { amount: '0.15', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: {
        coin: { type: 'string', description: 'Crypto symbol', enum: ['BTC','ETH','SOL','BNB','XRP','USDT','USDC','ADA','AVAX','DOGE','DOT','MATIC','LINK','LTC','ATOM','UNI','SUI','APT','NEAR','PEPE'] },
        days: { type: 'string', description: 'History window', enum: ['30','90','365'] },
      },
    },
    {
      name: 'Bundle — Crypto Top 20',
      url: 'https://api.lastlookdata.com/api/bundle/crypto',
      method: 'GET',
      description: 'Top 20 cryptocurrencies by market cap — price, 24h change, 7d change, market cap, and volume in one call. Source: CoinGecko.',
      price: '0.50',
      currency: 'USDC',
      pricing: { amount: '0.50', currency: 'USDC', network: 'Base', scheme: 'exact' },
    },
    {
      name: 'EDGAR — Company Fundamentals',
      url: 'https://api.lastlookdata.com/api/edgar/company',
      method: 'GET',
      description: 'Company financial fundamentals from SEC EDGAR XBRL: revenue, net income, total assets, stockholders equity, and EPS from 10-K and 10-Q filings. Use ?ticker=AAPL|MSFT|TSLA|AMZN|NVDA|GOOGL|META|etc.',
      price: '0.75',
      currency: 'USDC',
      pricing: { amount: '0.75', currency: 'USDC', network: 'Base', scheme: 'exact' },
      schema: { ticker: { type: 'string', description: 'Stock ticker symbol e.g. AAPL, MSFT, TSLA, AMZN, NVDA' } },
    },
  ],
}));

// ── FRED: current value ───────────────────────────────────────────────────────

app.get('/api/current', async (req, res) => {
  try {
    const seriesId = (req.query.id || '').toUpperCase();
    if (ALLOWED_FX.has(seriesId)) return res.status(400).json({
      error: `"${seriesId}" is an FX pair, not a FRED series. Use /api/fx/current?pair=${seriesId} instead.`,
    });
    if (!ALLOWED_SERIES.has(seriesId)) return res.status(400).json({
      error: `Unknown series "${seriesId}".`,
      supported_series: [...ALLOWED_SERIES],
    });
    const obs = await fetchFredSeries(seriesId, daysAgoISO(90), todayISO());
    if (!obs.length) return res.status(404).json({ error: `No data returned for ${seriesId}` });
    const latest = obs[obs.length - 1];
    res.json({
      service: 'LastLook Data',
      series_id: seriesId,
      label: SERIES_LABELS[seriesId] || seriesId,
      date: latest.date,
      value: latest.value,
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch data', detail: err.message }); }
});

// ── FRED: value by date ───────────────────────────────────────────────────────

app.get('/api/date', async (req, res) => {
  try {
    const seriesId = (req.query.id || '').toUpperCase();
    const { d } = req.query;
    if (ALLOWED_FX.has(seriesId)) return res.status(400).json({
      error: `"${seriesId}" is an FX pair, not a FRED series. Use /api/fx/date?pair=${seriesId}&d=${d || 'YYYY-MM-DD'} instead.`,
    });
    if (!ALLOWED_SERIES.has(seriesId)) return res.status(400).json({
      error: `Unknown series "${seriesId}".`,
      supported_series: [...ALLOWED_SERIES],
    });
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'Please provide a date in YYYY-MM-DD format using ?d=YYYY-MM-DD' });
    const obs = await fetchFredSeries(seriesId, d, d);
    if (!obs.length) return res.status(404).json({ error: `No data for ${seriesId} on ${d}. FRED only publishes on business days.` });
    res.json({
      service: 'LastLook Data',
      series_id: seriesId,
      label: SERIES_LABELS[seriesId] || seriesId,
      date: obs[0].date,
      value: obs[0].value,
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch data', detail: err.message }); }
});

// ── FRED: series ──────────────────────────────────────────────────────────────

function seriesHandler(days) {
  return async (req, res) => {
    try {
      const seriesId = (req.query.id || 'DGS30').toUpperCase();
      if (!ALLOWED_SERIES.has(seriesId)) return res.status(400).json({
        error: `Unknown series "${seriesId}".`,
        supported_series: [...ALLOWED_SERIES],
      });
      const obs = await fetchFredSeries(seriesId, daysAgoISO(days), todayISO());
      if (!obs.length) return res.status(404).json({ error: `No data returned for ${seriesId}` });
      res.json({
        service: 'LastLook Data',
        series_id: seriesId,
        label: SERIES_LABELS[seriesId] || seriesId,
        days,
        count: obs.length,
        start: obs[0].date,
        end: obs[obs.length - 1].date,
        observations: obs,
        note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
      });
    } catch (err) { res.status(500).json({ error: 'Failed to fetch data', detail: err.message }); }
  };
}

app.get('/api/series/30', seriesHandler(30));
app.get('/api/series/90', seriesHandler(90));
app.get('/api/series/365', seriesHandler(365));

// ── Treasury aliases (backward compat) ───────────────────────────────────────

app.get('/api/treasury/public', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const today = new Date(), weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const obs = await fetchFRED(weekAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    const latest = obs.filter(o => o.value !== '.').slice(-1)[0];
    if (!latest) return res.status(404).json({ error: 'No data available' });
    res.json({ date: latest.date, yield_percent: parseFloat(latest.value), series: 'DGS30' });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch data', detail: err.message }); }
});

app.get('/api/treasury/current', async (req, res) => {
  try {
    const today = new Date(), weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const obs = await fetchFRED(weekAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    const latest = obs.filter(o => o.value !== '.').slice(-1)[0];
    if (!latest) return res.status(404).json({ error: 'No data available' });
    res.json({ service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: latest.date, yield_percent: parseFloat(latest.value), note: 'Source: Federal Reserve Bank of St. Louis (FRED)' });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch data', detail: err.message }); }
});

app.get('/api/treasury/date', async (req, res) => {
  try {
    const { d } = req.query;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'Please provide a date in YYYY-MM-DD format' });
    const obs = await fetchFRED(d, d);
    const match = obs.find(o => o.value !== '.');
    if (!match) return res.status(404).json({ error: `No yield data for ${d}. FRED only publishes on business days.` });
    res.json({ service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: match.date, yield_percent: parseFloat(match.value), note: 'Source: Federal Reserve Bank of St. Louis (FRED)' });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch data', detail: err.message }); }
});

// ── FX routes ─────────────────────────────────────────────────────────────────

app.get('/api/fx/current', async (req, res) => {
  try {
    const pair = (req.query.pair || '').toUpperCase();
    if (!ALLOWED_FX.has(pair)) return res.status(400).json({ error: `Unknown pair "${pair}".`, supported_pairs: [...ALLOWED_FX] });
    const data = await fetchFXCurrent(pair);
    res.json({ service: 'LastLook Data', pair, label: FX_LABELS[pair], date: data.date, rate: data.rate, base: data.base, quote: data.quote, note: 'Source: Frankfurter (European Central Bank)' });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch FX data', detail: err.message }); }
});

app.get('/api/fx/date', async (req, res) => {
  try {
    const pair = (req.query.pair || '').toUpperCase();
    const { d } = req.query;
    if (!ALLOWED_FX.has(pair)) return res.status(400).json({ error: `Unknown pair "${pair}".`, supported_pairs: [...ALLOWED_FX] });
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'Please provide a date in YYYY-MM-DD format using ?d=YYYY-MM-DD' });
    const data = await fetchFXByDate(pair, d);
    res.json({ service: 'LastLook Data', pair, label: FX_LABELS[pair], date: data.date, rate: data.rate, base: data.base, quote: data.quote, note: 'Source: Frankfurter (European Central Bank)' });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch FX data', detail: err.message }); }
});

app.get('/api/fx/series', async (req, res) => {
  try {
    const pair = (req.query.pair || '').toUpperCase();
    const days = parseInt(req.query.days, 10) || 30;
    if (!ALLOWED_FX.has(pair)) return res.status(400).json({ error: `Unknown pair "${pair}".`, supported_pairs: [...ALLOWED_FX] });
    if (![30,90,365].includes(days)) return res.status(400).json({ error: 'days must be 30, 90, or 365' });
    const obs = await fetchFXSeries(pair, days);
    if (!obs.length) return res.status(404).json({ error: `No data returned for ${pair}` });
    res.json({ service: 'LastLook Data', pair, label: FX_LABELS[pair], days, count: obs.length, start: obs[0].date, end: obs[obs.length-1].date, observations: obs, note: 'Source: Frankfurter (European Central Bank)' });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch FX data', detail: err.message }); }
});

// ── Derived: yield curve spreads ──────────────────────────────────────────────

app.get('/api/derived/yield-curve', async (req, res) => {
  try {
    const start = daysAgoISO(10);
    const end = todayISO();
    const [dgs2, dgs10, dgs1mo] = await Promise.all([
      fetchFredSeries('DGS2', start, end),
      fetchFredSeries('DGS10', start, end),
      fetchFredSeries('DGS1MO', start, end),
    ]);
    const latest2 = dgs2[dgs2.length - 1];
    const latest10 = dgs10[dgs10.length - 1];
    const latest1mo = dgs1mo[dgs1mo.length - 1];
    if (!latest2 || !latest10 || !latest1mo) return res.status(404).json({ error: 'Insufficient data' });
    const spread2s10s = parseFloat((latest10.value - latest2.value).toFixed(4));
    const spread3m10y = parseFloat((latest10.value - latest1mo.value).toFixed(4));
    const asOf = latest10.date;
    const inverted2s10s = spread2s10s < 0;
    const inverted3m10y = spread3m10y < 0;
    const signal = inverted2s10s && inverted3m10y ? 'Fully inverted'
      : inverted2s10s || inverted3m10y ? 'Partially inverted'
      : 'Normal (upward sloping)';
    res.json({
      service: 'LastLook Data',
      as_of: asOf,
      spreads: {
        '2s10s': { value: spread2s10s, label: '10Y minus 2Y Treasury', inverted: inverted2s10s },
        '3m10y': { value: spread3m10y, label: '10Y minus 3-Month T-Bill', inverted: inverted3m10y },
      },
      components: { DGS1MO: latest1mo.value, DGS2: latest2.value, DGS10: latest10.value },
      signal,
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to compute yield curve', detail: err.message }); }
});

// ── Derived: Sahm Rule recession indicator ────────────────────────────────────

app.get('/api/derived/recession', async (req, res) => {
  try {
    const obs = await fetchFredSeries('SAHMREALTIME', daysAgoISO(60), todayISO());
    const latest = obs[obs.length - 1];
    if (!latest) return res.status(404).json({ error: 'No data available' });
    const triggered = latest.value >= 0.5;
    res.json({
      service: 'LastLook Data',
      as_of: latest.date,
      sahm_rule: {
        value: latest.value,
        threshold: 0.50,
        triggered,
        signal: triggered ? 'Recession signal triggered' : 'No recession signal',
      },
      note: 'Sahm Rule: value >= 0.50 indicates recession likely underway. Source: FRED (SAHMREALTIME)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch recession indicator', detail: err.message }); }
});

// ── Derived: Fed policy spread (EFFR vs IORB) ─────────────────────────────────

app.get('/api/derived/policy-spread', async (req, res) => {
  try {
    const start = daysAgoISO(10);
    const end = todayISO();
    const [effr, iorb] = await Promise.all([
      fetchFredSeries('EFFR', start, end),
      fetchFredSeries('IORB', start, end),
    ]);
    const latestEffr = effr[effr.length - 1];
    const latestIorb = iorb[iorb.length - 1];
    if (!latestEffr || !latestIorb) return res.status(404).json({ error: 'Insufficient data' });
    const spread = parseFloat((latestEffr.value - latestIorb.value).toFixed(4));
    const interpretation = spread < 0
      ? 'EFFR trading below IORB — within normal operating band'
      : spread === 0 ? 'EFFR at IORB — at floor'
      : 'EFFR trading above IORB — unusual, monitor for reserve scarcity';
    res.json({
      service: 'LastLook Data',
      as_of: latestEffr.date,
      effr: latestEffr.value,
      iorb: latestIorb.value,
      spread,
      interpretation,
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to compute policy spread', detail: err.message }); }
});

// ── Economic calendar ─────────────────────────────────────────────────────────

app.get('/api/calendar', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const start = todayISO();
    const end = (() => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); })();
    const cacheKey = `calendar_${start}_${days}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const response = await axios.get('https://api.stlouisfed.org/fred/releases/dates', {
      params: { api_key: FRED_API_KEY, realtime_start: start, realtime_end: end, sort_order: 'asc', include_release_dates_with_no_data: false, file_type: 'json' },
    });
    const releases = (response.data.release_dates || []).map(r => ({
      date: r.date, release_id: r.release_id, release_name: r.release_name,
    }));
    const result = {
      service: 'LastLook Data',
      calendar_start: start,
      calendar_end: end,
      count: releases.length,
      releases,
      note: 'Source: Federal Reserve Bank of St. Louis (FRED) release calendar',
    };
    cache.set(cacheKey, result, 3600);
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch calendar', detail: err.message }); }
});

// ── Bundle: Rate Environment Snapshot ────────────────────────────────────────

app.get('/api/bundle/rate-environment', async (req, res) => {
  try {
    const start = daysAgoISO(30), end = todayISO();
    const [fedfunds, sofr, dgs2, dgs5, dgs10, dgs30, effr, iorb, dgs1mo] = await Promise.all([
      fetchFredSeries('FEDFUNDS', start, end),
      fetchFredSeries('SOFR',     start, end),
      fetchFredSeries('DGS2',     start, end),
      fetchFredSeries('DGS5',     start, end),
      fetchFredSeries('DGS10',    start, end),
      fetchFredSeries('DGS30',    start, end),
      fetchFredSeries('EFFR',     start, end),
      fetchFredSeries('IORB',     start, end),
      fetchFredSeries('DGS1MO',   start, end),
    ]);
    const l = arr => arr[arr.length - 1];
    const lDgs2 = l(dgs2), lDgs10 = l(dgs10), lDgs30 = l(dgs30);
    const lDgs1mo = l(dgs1mo), lEffr = l(effr), lIorb = l(iorb);
    if (!lDgs2 || !lDgs10 || !lDgs30) return res.status(404).json({ error: 'Insufficient data' });
    const spread2s10s  = parseFloat((lDgs10.value - lDgs2.value).toFixed(4));
    const spread3m10y  = lDgs1mo ? parseFloat((lDgs10.value - lDgs1mo.value).toFixed(4)) : null;
    const policySpread = lEffr && lIorb ? parseFloat((lEffr.value - lIorb.value).toFixed(4)) : null;
    const inv2 = spread2s10s < 0, inv3m = spread3m10y !== null && spread3m10y < 0;
    const curveShape = inv2 && inv3m ? 'Fully inverted' : inv2 || inv3m ? 'Partially inverted' : 'Normal (upward sloping)';
    const policyStance = policySpread === null ? 'N/A'
      : policySpread < 0 ? 'EFFR trading below IORB — within normal operating band'
      : policySpread === 0 ? 'EFFR at IORB — at floor'
      : 'EFFR trading above IORB — unusual, monitor for reserve scarcity';
    res.json({
      service: 'LastLook Data', as_of: lDgs10.date, bundle: 'rate_environment',
      series: {
        FEDFUNDS: l(fedfunds)?.value ?? null,
        SOFR:     l(sofr)?.value ?? null,
        DGS2:     lDgs2.value,
        DGS5:     l(dgs5)?.value ?? null,
        DGS10:    lDgs10.value,
        DGS30:    lDgs30.value,
      },
      derived: {
        spread_2s10s:        spread2s10s,
        spread_2s10s_label:  '10Y minus 2Y Treasury',
        spread_3m10y:        spread3m10y,
        spread_3m10y_label:  '10Y minus 3-Month T-Bill',
        policy_spread:       policySpread,
        policy_spread_label: 'EFFR minus IORB',
      },
      signals: { curve_shape: curveShape, policy_stance: policyStance },
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch rate environment bundle', detail: err.message }); }
});

// ── Bundle: Mortgage Market Pulse ─────────────────────────────────────────────

app.get('/api/bundle/mortgage-pulse', async (req, res) => {
  try {
    const end = todayISO();
    const [mort30, mort15, dgs10, fedfunds, mspus, houst] = await Promise.all([
      fetchFredSeries('MORTGAGE30US', daysAgoISO(45), end),
      fetchFredSeries('MORTGAGE15US', daysAgoISO(45), end),
      fetchFredSeries('DGS10',        daysAgoISO(10), end),
      fetchFredSeries('FEDFUNDS',     daysAgoISO(10), end),
      fetchFredSeries('MSPUS',        daysAgoISO(120), end),
      fetchFredSeries('HOUST',        daysAgoISO(90), end),
    ]);
    const l = arr => arr[arr.length - 1];
    const lMort30 = l(mort30), lMort15 = l(mort15), lDgs10 = l(dgs10);
    if (!lMort30 || !lDgs10) return res.status(404).json({ error: 'Insufficient data' });
    const mbsSpread = parseFloat((lMort30.value - lDgs10.value).toFixed(4));
    const cutoff30d = daysAgoISO(28);
    const ref30d = mort30.find(o => o.date >= cutoff30d) ?? mort30[0];
    const diff = lMort30.value - ref30d.value;
    const rateTrend = diff > 0.1 ? 'rising' : diff < -0.1 ? 'falling' : 'flat';
    res.json({
      service: 'LastLook Data', as_of: lMort30.date, bundle: 'mortgage_pulse',
      series: {
        MORTGAGE30US: lMort30.value,
        MORTGAGE15US: lMort15?.value ?? null,
        DGS10:        lDgs10.value,
        FEDFUNDS:     l(fedfunds)?.value ?? null,
        MSPUS:        l(mspus)?.value ?? null,
        HOUST:        l(houst)?.value ?? null,
      },
      derived: {
        mbs_spread:       mbsSpread,
        mbs_spread_label: '30yr mortgage rate minus 10Y Treasury yield',
      },
      signals: { rate_trend_30d: rateTrend },
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch mortgage pulse bundle', detail: err.message }); }
});

// ── Bundle: Macro Health Snapshot ─────────────────────────────────────────────

app.get('/api/bundle/macro', async (req, res) => {
  try {
    const end = todayISO();
    const [gdp, unrate, cpi, cpilf, fedfunds, sahm, dgs2, dgs10, dgs1mo] = await Promise.all([
      fetchFredSeries('GDP',          daysAgoISO(180), end),
      fetchFredSeries('UNRATE',       daysAgoISO(90),  end),
      fetchFredSeries('CPIAUCSL',     daysAgoISO(90),  end),
      fetchFredSeries('CPILFESL',     daysAgoISO(90),  end),
      fetchFredSeries('FEDFUNDS',     daysAgoISO(10),  end),
      fetchFredSeries('SAHMREALTIME', daysAgoISO(60),  end),
      fetchFredSeries('DGS2',         daysAgoISO(10),  end),
      fetchFredSeries('DGS10',        daysAgoISO(10),  end),
      fetchFredSeries('DGS1MO',       daysAgoISO(10),  end),
    ]);
    const l = arr => arr[arr.length - 1];
    const lUnrate = l(unrate), lCpi = l(cpi), lDgs2 = l(dgs2), lDgs10 = l(dgs10);
    const lSahm = l(sahm);
    if (!lUnrate || !lCpi) return res.status(404).json({ error: 'Insufficient macro data' });
    const recessionTriggered = lSahm ? lSahm.value >= 0.50 : null;
    const spread2s10s = lDgs2 && lDgs10 ? parseFloat((lDgs10.value - lDgs2.value).toFixed(4)) : null;
    let cyclePhase = 'expansion';
    if (recessionTriggered) cyclePhase = 'contraction';
    else if (spread2s10s !== null && spread2s10s < 0 && lSahm && lSahm.value > 0.25) cyclePhase = 'peak';
    else if (spread2s10s !== null && spread2s10s < 0) cyclePhase = 'late cycle';
    res.json({
      service: 'LastLook Data', as_of: lUnrate.date, bundle: 'macro',
      series: {
        GDP:      l(gdp)?.value ?? null,
        UNRATE:   lUnrate.value,
        CPIAUCSL: lCpi.value,
        CPILFESL: l(cpilf)?.value ?? null,
        FEDFUNDS: l(fedfunds)?.value ?? null,
      },
      derived: {
        sahm_rule:    lSahm?.value ?? null,
        spread_2s10s: spread2s10s,
      },
      signals: { cycle_phase: cyclePhase, recession_triggered: recessionTriggered },
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch macro bundle', detail: err.message }); }
});

// ── Bundle: G10 FX Dashboard ──────────────────────────────────────────────────

app.get('/api/bundle/fx-dashboard', async (req, res) => {
  try {
    const thirtyDaysAgo = daysAgoISO(30);
    const [currentResp, pastResp] = await Promise.all([
      axios.get('https://api.frankfurter.app/latest', { params: { from: 'USD', to: 'EUR,GBP,JPY,CHF,CAD,AUD,NZD,SEK,NOK' } }),
      axios.get(`https://api.frankfurter.app/${thirtyDaysAgo}`, { params: { from: 'USD', to: 'EUR,GBP,JPY,CHF,CAD,AUD,NZD,SEK,NOK' } }),
    ]);
    const cr = currentResp.data.rates, pr = pastResp.data.rates;
    const asOf = currentResp.data.date;
    const round = (n, d) => parseFloat(n.toFixed(d));
    const series = {
      EURUSD: round(1 / cr.EUR, 5),
      GBPUSD: round(1 / cr.GBP, 5),
      USDJPY: round(cr.JPY, 3),
      USDCHF: round(cr.CHF, 5),
      USDCAD: round(cr.CAD, 5),
      AUDUSD: round(1 / cr.AUD, 5),
      NZDUSD: round(1 / cr.NZD, 5),
      USDSEK: round(cr.SEK, 4),
      USDNOK: round(cr.NOK, 4),
    };
    // Positive = USD bought more foreign currency vs 30d ago = USD stronger
    const currencies = ['EUR','GBP','JPY','CHF','CAD','AUD','NZD','SEK','NOK'];
    const changes = currencies.map(c => (cr[c] - pr[c]) / pr[c] * 100);
    const usdStrengthIndex = round(changes.reduce((a, b) => a + b, 0) / changes.length, 3);
    const usdTrend = usdStrengthIndex > 0.5 ? 'strengthening' : usdStrengthIndex < -0.5 ? 'weakening' : 'stable';
    res.json({
      service: 'LastLook Data', as_of: asOf, bundle: 'fx_dashboard',
      series,
      derived: {
        usd_strength_index:       usdStrengthIndex,
        usd_strength_index_label: 'Avg % change of USD vs G10 basket vs 30 days ago (positive = stronger)',
      },
      signals: { usd_trend_30d: usdTrend },
      note: 'Source: Frankfurter (European Central Bank)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch FX dashboard bundle', detail: err.message }); }
});

// ── Bundle: Energy & Commodities ──────────────────────────────────────────────

app.get('/api/bundle/energy', async (req, res) => {
  try {
    const start = daysAgoISO(20), end = todayISO();
    const [wti, brent, gas, natgas] = await Promise.all([
      fetchFredSeries('DCOILWTICO',   start, end),
      fetchFredSeries('DCOILBRENTEU', start, end),
      fetchFredSeries('GASREGCOVW',   start, end),
      fetchFredSeries('DHHNGSP',      start, end),
    ]);
    const l = arr => arr[arr.length - 1];
    const lWti = l(wti), lBrent = l(brent), lGas = l(gas), lNatgas = l(natgas);
    if (!lWti || !lBrent) return res.status(404).json({ error: 'Insufficient energy data' });
    const spread = parseFloat((lWti.value - lBrent.value).toFixed(3));
    const wtiPremium = spread > 0;
    const wtiSignal = wtiPremium ? 'WTI premium (unusual — monitor for US supply disruption)'
      : Math.abs(spread) < 1 ? 'Near parity (converging)'
      : 'Normal contango (Brent premium)';
    res.json({
      service: 'LastLook Data', as_of: lWti.date, bundle: 'energy',
      series: {
        DCOILWTICO:   lWti.value,
        DCOILBRENTEU: lBrent.value,
        GASREGCOVW:   lGas?.value ?? null,
        DHHNGSP:      lNatgas?.value ?? null,
      },
      derived: {
        wti_brent_spread:       spread,
        wti_brent_spread_label: 'WTI minus Brent crude (USD/bbl)',
      },
      signals: { wti_brent_signal: wtiSignal },
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch energy bundle', detail: err.message }); }
});

// ── Bundle: Economic Context Brief ───────────────────────────────────────────

app.get('/api/bundle/context-brief', async (req, res) => {
  try {
    const end = todayISO();
    const [fedfunds, dgs2, dgs5, dgs10, dgs30, effr, iorb, dgs1mo,
           mort30, mort15, unrate, cpi, cpilf, sahm,
           wti, brent, natgas, fxResp] = await Promise.all([
      fetchFredSeries('FEDFUNDS',     daysAgoISO(10),  end),
      fetchFredSeries('DGS2',         daysAgoISO(10),  end),
      fetchFredSeries('DGS5',         daysAgoISO(10),  end),
      fetchFredSeries('DGS10',        daysAgoISO(10),  end),
      fetchFredSeries('DGS30',        daysAgoISO(10),  end),
      fetchFredSeries('EFFR',         daysAgoISO(10),  end),
      fetchFredSeries('IORB',         daysAgoISO(10),  end),
      fetchFredSeries('DGS1MO',       daysAgoISO(10),  end),
      fetchFredSeries('MORTGAGE30US', daysAgoISO(14),  end),
      fetchFredSeries('MORTGAGE15US', daysAgoISO(14),  end),
      fetchFredSeries('UNRATE',       daysAgoISO(90),  end),
      fetchFredSeries('CPIAUCSL',     daysAgoISO(90),  end),
      fetchFredSeries('CPILFESL',     daysAgoISO(90),  end),
      fetchFredSeries('SAHMREALTIME', daysAgoISO(60),  end),
      fetchFredSeries('DCOILWTICO',   daysAgoISO(10),  end),
      fetchFredSeries('DCOILBRENTEU', daysAgoISO(10),  end),
      fetchFredSeries('DHHNGSP',      daysAgoISO(14),  end),
      axios.get('https://api.frankfurter.app/latest', { params: { from: 'USD', to: 'EUR,GBP,JPY' } }),
    ]);
    const l = arr => arr[arr.length - 1];
    const lFf = l(fedfunds), lDgs2 = l(dgs2), lDgs10 = l(dgs10), lDgs30 = l(dgs30);
    const lDgs1mo = l(dgs1mo), lEffr = l(effr), lIorb = l(iorb);
    const lMort30 = l(mort30), lMort15 = l(mort15);
    const lUnrate = l(unrate), lCpi = l(cpi), lCpilf = l(cpilf), lSahm = l(sahm);
    const lWti = l(wti), lBrent = l(brent), lNatgas = l(natgas);
    const fxRates = fxResp.data.rates;
    if (!lDgs10 || !lUnrate) return res.status(404).json({ error: 'Insufficient data for context brief' });
    const spread2s10s = lDgs2 ? parseFloat((lDgs10.value - lDgs2.value).toFixed(2)) : null;
    const spread2s10sBps = spread2s10s !== null ? Math.round(spread2s10s * 100) : null;
    const mbsSpread = lMort30 ? parseFloat((lMort30.value - lDgs10.value).toFixed(2)) : null;
    const eurusd = fxRates.EUR ? parseFloat((1 / fxRates.EUR).toFixed(4)) : null;
    const gbpusd = fxRates.GBP ? parseFloat((1 / fxRates.GBP).toFixed(4)) : null;
    const usdjpy = fxRates.JPY ? parseFloat(fxRates.JPY.toFixed(2)) : null;
    const sahmVal = lSahm?.value ?? null;
    const recessionTriggered = sahmVal !== null ? sahmVal >= 0.50 : null;
    const curveShape = spread2s10s === null ? 'unknown'
      : spread2s10s < -0.25 ? 'deeply inverted' : spread2s10s < 0 ? 'inverted'
      : spread2s10s < 0.25 ? 'flat' : 'normal (upward sloping)';
    const asOf = lDgs10.date;
    const parts = [];
    if (lFf)     parts.push(`The Fed Funds Rate is ${lFf.value}%`);
    if (spread2s10s !== null) parts.push(`yield curve at ${spread2s10sBps > 0 ? '+' : ''}${spread2s10sBps}bps (${curveShape})`);
    if (lDgs10)  parts.push(`10Y Treasury at ${lDgs10.value}%`);
    if (lDgs30)  parts.push(`30Y at ${lDgs30.value}%`);
    if (lCpi)    parts.push(`CPI at ${lCpi.value} (${lCpi.date})`);
    if (lUnrate) parts.push(`unemployment at ${lUnrate.value}%`);
    if (lMort30) parts.push(`30yr mortgage ${lMort30.value}%${mbsSpread !== null ? ` (${Math.round(mbsSpread * 100)}bps over 10Y)` : ''}`);
    if (lMort15) parts.push(`15yr ${lMort15.value}%`);
    if (lWti)    parts.push(`WTI crude $${lWti.value}/bbl`);
    if (lBrent)  parts.push(`Brent $${lBrent.value}/bbl`);
    if (eurusd)  parts.push(`EUR/USD ${eurusd}`);
    if (gbpusd)  parts.push(`GBP/USD ${gbpusd}`);
    if (usdjpy)  parts.push(`USD/JPY ${usdjpy}`);
    if (sahmVal !== null) parts.push(`Sahm Rule ${sahmVal} (${recessionTriggered ? 'recession signal TRIGGERED' : 'below 0.50 threshold'})`);
    const brief = `As of ${asOf}: ` + parts.join(', ') + '.';
    const seriesMap = {};
    if (lFf)     seriesMap.FEDFUNDS     = lFf.value;
    if (lEffr)   seriesMap.EFFR         = lEffr.value;
    if (lIorb)   seriesMap.IORB         = lIorb.value;
    if (lDgs2)   seriesMap.DGS2         = lDgs2.value;
    if (l(dgs5)) seriesMap.DGS5         = l(dgs5).value;
    if (lDgs10)  seriesMap.DGS10        = lDgs10.value;
    if (lDgs30)  seriesMap.DGS30        = lDgs30.value;
    if (lMort30) seriesMap.MORTGAGE30US = lMort30.value;
    if (lMort15) seriesMap.MORTGAGE15US = lMort15.value;
    if (lUnrate) seriesMap.UNRATE       = lUnrate.value;
    if (lCpi)    seriesMap.CPIAUCSL     = lCpi.value;
    if (lCpilf)  seriesMap.CPILFESL     = lCpilf.value;
    if (lWti)    seriesMap.DCOILWTICO   = lWti.value;
    if (lBrent)  seriesMap.DCOILBRENTEU = lBrent.value;
    if (lNatgas) seriesMap.DHHNGSP      = lNatgas.value;
    res.json({
      service: 'LastLook Data', as_of: asOf, bundle: 'context_brief',
      brief,
      series: seriesMap,
      fx: { EURUSD: eurusd, GBPUSD: gbpusd, USDJPY: usdjpy },
      derived: {
        spread_2s10s:     spread2s10s,
        spread_2s10s_bps: spread2s10sBps,
        mbs_spread:       mbsSpread,
        sahm_rule:        sahmVal,
      },
      signals: { curve_shape: curveShape, recession_triggered: recessionTriggered },
      note: 'Source: FRED and ECB (Frankfurter) via LastLook Data',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to generate context brief', detail: err.message }); }
});

// ── Bundle: Refi Signal ───────────────────────────────────────────────────────

app.get('/api/bundle/refi-signal', async (req, res) => {
  try {
    const end = todayISO();
    const [mort30year, mort15, dgs10, fedfunds] = await Promise.all([
      fetchFredSeries('MORTGAGE30US', daysAgoISO(370), end),
      fetchFredSeries('MORTGAGE15US', daysAgoISO(45),  end),
      fetchFredSeries('DGS10',        daysAgoISO(10),  end),
      fetchFredSeries('FEDFUNDS',     daysAgoISO(10),  end),
    ]);
    const l = arr => arr[arr.length - 1];
    const lMort30 = l(mort30year), lMort15 = l(mort15), lDgs10 = l(dgs10);
    if (!lMort30 || !lDgs10) return res.status(404).json({ error: 'Insufficient mortgage data' });

    const mbsSpread = parseFloat((lMort30.value - lDgs10.value).toFixed(4));

    const values30 = mort30year.map(o => o.value);
    const week52High = parseFloat(Math.max(...values30).toFixed(2));
    const week52Low  = parseFloat(Math.min(...values30).toFixed(2));
    const week52Range = week52High - week52Low;
    const week52PositionPct = week52Range > 0
      ? Math.round((lMort30.value - week52Low) / week52Range * 100) : 50;

    const refiBtThreshold = parseFloat((lMort30.value + 0.75).toFixed(2));

    const cutoff30d = daysAgoISO(30), cutoff90d = daysAgoISO(90);
    const ref30d = mort30year.find(o => o.date >= cutoff30d) ?? mort30year[0];
    const ref90d = mort30year.find(o => o.date >= cutoff90d) ?? mort30year[0];
    const diff30 = lMort30.value - ref30d.value;
    const diff90 = lMort30.value - ref90d.value;
    const trend30 = diff30 > 0.1 ? 'rising' : diff30 < -0.1 ? 'falling' : 'flat';
    const trend90 = diff90 > 0.2 ? 'rising' : diff90 < -0.2 ? 'falling' : 'flat';

    const rateVs52wk = week52PositionPct >= 80 ? 'near_52wk_high'
      : week52PositionPct <= 20 ? 'near_52wk_low' : 'mid_range';
    const refiEnv = trend30 === 'falling' && rateVs52wk !== 'near_52wk_high' ? 'favorable'
      : trend30 === 'rising' && rateVs52wk !== 'near_52wk_low' ? 'unfavorable' : 'neutral';

    res.json({
      service: 'LastLook Data', as_of: lMort30.date, bundle: 'refi_signal',
      series: {
        MORTGAGE30US: lMort30.value,
        MORTGAGE15US: lMort15?.value ?? null,
        DGS10:        lDgs10.value,
        FEDFUNDS:     l(fedfunds)?.value ?? null,
      },
      derived: {
        mbs_spread:              mbsSpread,
        mbs_spread_label:        '30yr mortgage rate minus 10Y Treasury yield',
        week52_high:             week52High,
        week52_low:              week52Low,
        week52_position_pct:     week52PositionPct,
        week52_position_label:   `Current rate is at ${week52PositionPct}% of the 52-week high-low range`,
        refi_breakeven_threshold: refiBtThreshold,
        refi_breakeven_label:    'Borrowers with existing rates above this level likely benefit from refinancing (0.75% savings rule of thumb)',
      },
      signals: {
        rate_trend_30d:   trend30,
        rate_trend_90d:   trend90,
        rate_vs_52wk:     rateVs52wk,
        refi_environment: refiEnv,
      },
      note: 'Source: Federal Reserve Bank of St. Louis (FRED). Break-even threshold assumes ~0.75% rate reduction needed to recover closing costs within 3 years.',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch refi signal bundle', detail: err.message }); }
});

// ── Bundle: Purchase Market ───────────────────────────────────────────────────

app.get('/api/bundle/purchase-market', async (req, res) => {
  try {
    const end = todayISO();
    const [mort30, mspus, houst, fedfunds] = await Promise.all([
      fetchFredSeries('MORTGAGE30US', daysAgoISO(45),  end),
      fetchFredSeries('MSPUS',        daysAgoISO(200), end),
      fetchFredSeries('HOUST',        daysAgoISO(90),  end),
      fetchFredSeries('FEDFUNDS',     daysAgoISO(10),  end),
    ]);
    const l = arr => arr[arr.length - 1];
    const lMort30 = l(mort30), lMspus = l(mspus), lHoust = l(houst);
    if (!lMort30 || !lMspus) return res.status(404).json({ error: 'Insufficient purchase market data' });

    const loanAmount   = Math.round(lMspus.value * 0.80);
    const monthlyPmt   = calcMonthlyPayment(loanAmount, lMort30.value);
    const incomeReq28  = Math.round(monthlyPmt / 0.28 * 12);

    const prevMspus = mspus.length >= 2 ? mspus[mspus.length - 2] : null;
    const priceChgQoQ = prevMspus
      ? parseFloat(((lMspus.value - prevMspus.value) / prevMspus.value * 100).toFixed(2)) : null;

    const affordLevel = incomeReq28 > 120000 ? 'elevated'
      : incomeReq28 > 80000 ? 'moderate' : 'accessible';

    const houstVal = lHoust?.value ?? null;
    const marketActivity = houstVal === null ? null
      : houstVal > 1500 ? 'strong' : houstVal > 1100 ? 'moderate' : 'subdued';

    res.json({
      service: 'LastLook Data', as_of: lMspus.date, bundle: 'purchase_market',
      series: {
        MORTGAGE30US: lMort30.value,
        MSPUS:        lMspus.value,
        HOUST:        houstVal,
        FEDFUNDS:     l(fedfunds)?.value ?? null,
      },
      derived: {
        loan_amount:               loanAmount,
        loan_amount_label:         'Median home price at 80% LTV (20% down payment assumed)',
        monthly_payment_estimate:  monthlyPmt,
        monthly_payment_label:     'Estimated monthly P&I at current 30yr rate on median home',
        income_required_28pct:     incomeReq28,
        income_required_label:     'Annual gross income required to qualify at 28% front-end DTI',
        home_price_change_qoq:     priceChgQoQ,
        home_price_change_qoq_label: 'Median sale price change vs prior quarter (%)',
      },
      signals: {
        affordability_level: affordLevel,
        market_activity:     marketActivity,
      },
      note: 'Source: Federal Reserve Bank of St. Louis (FRED). Payment estimates assume 30yr fixed, 20% down. Income requirement uses 28% front-end DTI (principal and interest only — does not include taxes, insurance, or HOA).',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch purchase market bundle', detail: err.message }); }
});

// ── Crypto: single coin price ─────────────────────────────────────────────────

app.get('/api/crypto/price', async (req, res) => {
  try {
    const coin = (req.query.coin || '').toUpperCase();
    if (!ALLOWED_COINS.has(coin)) return res.status(400).json({
      error: `Unknown coin "${coin}".`,
      supported_coins: [...ALLOWED_COINS],
    });
    const data = await fetchCoinPrice(coin);
    res.json({
      service: 'LastLook Data',
      symbol: data.symbol,
      name: data.name,
      price_usd: data.price_usd,
      change_24h_pct: data.change_24h_pct,
      market_cap_usd: data.market_cap_usd,
      volume_24h_usd: data.volume_24h_usd,
      as_of: data.fetched_at,
      source: 'CoinGecko',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch crypto price', detail: err.message }); }
});

// ── Crypto: historical daily prices ──────────────────────────────────────────

app.get('/api/crypto/history', async (req, res) => {
  try {
    const coin = (req.query.coin || '').toUpperCase();
    const days = parseInt(req.query.days, 10) || 30;
    if (!ALLOWED_COINS.has(coin)) return res.status(400).json({
      error: `Unknown coin "${coin}".`,
      supported_coins: [...ALLOWED_COINS],
    });
    if (![30, 90, 365].includes(days)) return res.status(400).json({ error: 'days must be 30, 90, or 365' });
    const obs = await fetchCoinHistory(coin, days);
    if (!obs.length) return res.status(404).json({ error: `No data returned for ${coin}` });
    res.json({
      service: 'LastLook Data',
      symbol: coin,
      name: COIN_LABELS[coin],
      days,
      count: obs.length,
      start: obs[0].date,
      end: obs[obs.length - 1].date,
      observations: obs,
      source: 'CoinGecko',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch crypto history', detail: err.message }); }
});

// ── Bundle: Crypto Top 20 ─────────────────────────────────────────────────────

app.get('/api/bundle/crypto', async (req, res) => {
  try {
    const markets = await fetchCryptoMarkets(20);
    const asOf = new Date().toISOString();
    const coins = markets.map((c, i) => ({
      rank: i + 1,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      price_usd: c.current_price,
      change_24h_pct: c.price_change_percentage_24h !== null
        ? parseFloat(c.price_change_percentage_24h.toFixed(4)) : null,
      change_7d_pct: c.price_change_percentage_7d_in_currency !== null
        ? parseFloat(c.price_change_percentage_7d_in_currency.toFixed(4)) : null,
      market_cap_usd: c.market_cap,
      volume_24h_usd: c.total_volume,
    }));
    res.json({
      service: 'LastLook Data',
      bundle: 'crypto',
      as_of: asOf,
      count: coins.length,
      coins,
      source: 'CoinGecko',
    });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch crypto bundle', detail: err.message }); }
});

// ── EDGAR: company fundamentals ───────────────────────────────────────────────

app.get('/api/edgar/company', async (req, res) => {
  try {
    const ticker = (req.query.ticker || '').toUpperCase().trim();
    if (!ticker) return res.status(400).json({ error: 'Please provide a ticker symbol using ?ticker=AAPL' });
    if (!/^[A-Z]{1,5}$/.test(ticker)) return res.status(400).json({
      error: `Invalid ticker format "${ticker}". Use 1–5 uppercase letters (e.g. ?ticker=AAPL).`,
    });
    const data = await fetchEdgarCompany(ticker);
    if (!data) return res.status(404).json({
      error: `Ticker "${ticker}" not found in SEC EDGAR. Verify it is a US-listed public company.`,
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch EDGAR data', detail: err.message }); }
});

app.listen(PORT, () => console.log(`LastLook Data running on port ${PORT}`));
