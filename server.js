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
          ...declareDiscoveryExtension({
            input: { id: 'IORB' },
            inputSchema: {
              properties: {
                id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] },
              },
              required: ['id'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                series_id: 'IORB',
                label: 'Interest on Reserve Balances',
                date: '2026-05-09',
                value: 4.40,
                note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
              },
            },
          }),
        },
      },

      // ── FRED: value by date ($0.01) ───────────────────────────────────────────
      'GET /api/date': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — value for any supported FRED series on a specific date. Use ?id=SERIES_ID&d=YYYY-MM-DD. Business days only.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { id: 'DGS10', d: '2026-05-09' },
            inputSchema: {
              properties: {
                id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] },
                d: { type: 'string', description: 'Date in YYYY-MM-DD format' },
              },
              required: ['id', 'd'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                series_id: 'DGS10',
                label: '10-Year Treasury Constant Maturity Rate',
                date: '2026-05-09',
                value: 4.42,
                note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
              },
            },
          }),
        },
      },

      // ── FRED: 30-day series ($0.05) ───────────────────────────────────────────
      'GET /api/series/30': {
        accepts: [{ scheme: 'exact', price: '$0.05', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — last 30 days of any FRED series. Use for mortgage rates, Fed funds, IORB, EFFR, Treasury yields, CPI, energy prices, and more.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { id: 'MORTGAGE30US' },
            inputSchema: {
              properties: {
                id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] },
              },
              required: ['id'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                series_id: 'MORTGAGE30US',
                days: 30,
                count: 4,
                start: '2026-04-10',
                end: '2026-05-09',
                observations: [{ date: '2026-04-10', value: 6.82 }, { date: '2026-05-09', value: 6.79 }],
                note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
              },
            },
          }),
        },
      },

      // ── FRED: 90-day series ($0.10) ───────────────────────────────────────────
      'GET /api/series/90': {
        accepts: [{ scheme: 'exact', price: '$0.10', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — last 90 days of any supported FRED series.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { id: 'DGS30' },
            inputSchema: {
              properties: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] } },
              required: ['id'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                series_id: 'DGS30',
                days: 90,
                count: 63,
                start: '2026-02-09',
                end: '2026-05-09',
                observations: [{ date: '2026-02-09', value: 4.75 }, { date: '2026-05-09', value: 4.97 }],
                note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
              },
            },
          }),
        },
      },

      // ── FRED: 365-day series ($0.25) ──────────────────────────────────────────
      'GET /api/series/365': {
        accepts: [{ scheme: 'exact', price: '$0.25', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — last 365 days of any supported FRED series.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { id: 'DGS30' },
            inputSchema: {
              properties: { id: { type: 'string', description: 'FRED series ID', enum: ['DGS30','DGS10','DGS5','DGS2','DGS1MO','MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST','FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR','CPIAUCSL','CPILFESL','UNRATE','GDP','DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP'] } },
              required: ['id'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                series_id: 'DGS30',
                days: 365,
                count: 252,
                start: '2025-05-09',
                end: '2026-05-09',
                observations: [{ date: '2025-05-09', value: 4.55 }, { date: '2026-05-09', value: 4.97 }],
                note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
              },
            },
          }),
        },
      },

      // ── Treasury aliases (backward compat) ────────────────────────────────────
      'GET /api/treasury/current': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — current 30-year US Treasury yield (DGS30). Alias for /api/current?id=DGS30.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {},
            output: {
              example: {
                service: 'LastLook Data',
                series: 'DGS30 - 30-Year Treasury Constant Maturity Rate',
                date: '2026-05-09',
                yield_percent: 4.97,
                note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
              },
            },
          }),
        },
      },

      'GET /api/treasury/date': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — 30-year Treasury yield for a specific date. Alias for /api/date?id=DGS30&d=YYYY-MM-DD.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { d: '2026-05-09' },
            inputSchema: {
              properties: { d: { type: 'string', description: 'Date in YYYY-MM-DD format' } },
              required: ['d'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                series: 'DGS30 - 30-Year Treasury Constant Maturity Rate',
                date: '2026-05-09',
                yield_percent: 4.97,
                note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
              },
            },
          }),
        },
      },

      // ── FX: current ($0.01) ───────────────────────────────────────────────────
      'GET /api/fx/current': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — current exchange rate for a G10 currency pair. Source: European Central Bank.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { pair: 'EURUSD' },
            inputSchema: {
              properties: { pair: { type: 'string', description: 'G10 currency pair', enum: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'] } },
              required: ['pair'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                pair: 'EURUSD',
                label: 'Euro / US Dollar',
                date: '2026-05-09',
                rate: 1.1245,
                base: 'EUR',
                quote: 'USD',
                note: 'Source: Frankfurter (European Central Bank)',
              },
            },
          }),
        },
      },

      // ── FX: by date ($0.01) ───────────────────────────────────────────────────
      'GET /api/fx/date': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — exchange rate for a G10 currency pair on a specific date. Use ?pair=EURUSD&d=YYYY-MM-DD.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { pair: 'EURUSD', d: '2026-05-09' },
            inputSchema: {
              properties: {
                pair: { type: 'string', description: 'G10 currency pair', enum: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'] },
                d: { type: 'string', description: 'Date in YYYY-MM-DD format' },
              },
              required: ['pair', 'd'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                pair: 'EURUSD',
                label: 'Euro / US Dollar',
                date: '2026-05-09',
                rate: 1.1245,
                base: 'EUR',
                quote: 'USD',
                note: 'Source: Frankfurter (European Central Bank)',
              },
            },
          }),
        },
      },

      // ── FX: series ($0.05/$0.10/$0.25) ───────────────────────────────────────
      'GET /api/fx/series': {
        accepts: [{ scheme: 'exact', price: '$0.05', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — historical daily exchange rates for a G10 currency pair.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { pair: 'EURUSD', days: '30' },
            inputSchema: {
              properties: {
                pair: { type: 'string', description: 'G10 currency pair', enum: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'] },
                days: { type: 'string', description: '30, 90, or 365 days of history', enum: ['30','90','365'] },
              },
              required: ['pair', 'days'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                pair: 'EURUSD',
                label: 'Euro / US Dollar',
                days: 30,
                count: 21,
                start: '2026-04-10',
                end: '2026-05-09',
                observations: [{ date: '2026-04-10', value: 1.1102 }, { date: '2026-05-09', value: 1.1245 }],
                note: 'Source: Frankfurter (European Central Bank)',
              },
            },
          }),
        },
      },

      // ── Derived: yield curve spreads ($0.03) ──────────────────────────────────
      'GET /api/derived/yield-curve': {
        accepts: [{ scheme: 'exact', price: '$0.03', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — yield curve spreads (2s10s and 3m10y) with inversion signal. Computed from FRED Treasury data.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {},
            inputSchema: { properties: {} },
            output: {
              example: {
                service: 'LastLook Data', as_of: '2026-05-15',
                spreads: { '2s10s': { value: -0.15, inverted: true }, '3m10y': { value: 0.42, inverted: false } },
                components: { DGS2: 4.85, DGS10: 4.70, DGS1MO: 4.28 },
                signal: 'Partially inverted',
              },
            },
          }),
        },
      },

      // ── Derived: Sahm Rule recession indicator ($0.02) ────────────────────────
      'GET /api/derived/recession': {
        accepts: [{ scheme: 'exact', price: '$0.02', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — real-time Sahm Rule recession indicator. Value >= 0.5 signals recession underway. Source: FRED SAHMREALTIME.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {},
            inputSchema: { properties: {} },
            output: {
              example: {
                service: 'LastLook Data', as_of: '2026-04-01',
                sahm_rule: { value: 0.37, threshold: 0.50, triggered: false, signal: 'No recession signal' },
              },
            },
          }),
        },
      },

      // ── Derived: Fed policy spread ($0.02) ────────────────────────────────────
      'GET /api/derived/policy-spread': {
        accepts: [{ scheme: 'exact', price: '$0.02', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — EFFR vs IORB spread. Shows where the effective Fed funds rate trades relative to interest on reserves.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: {},
            inputSchema: { properties: {} },
            output: {
              example: {
                service: 'LastLook Data', as_of: '2026-05-14',
                effr: 4.33, iorb: 4.40, spread: -0.07,
                interpretation: 'EFFR trading below IORB — within normal operating band',
              },
            },
          }),
        },
      },

      // ── Economic calendar ($0.02) ─────────────────────────────────────────────
      'GET /api/calendar': {
        accepts: [{ scheme: 'exact', price: '$0.02', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'LastLook Data — upcoming FRED economic data release dates. CPI, jobs, GDP, Treasury, and more. Use ?days=30|60|90.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { days: '30' },
            inputSchema: {
              properties: { days: { type: 'string', description: 'Lookahead window in days', enum: ['30','60','90'] } },
            },
            output: {
              example: {
                service: 'LastLook Data', calendar_start: '2026-05-16', calendar_end: '2026-06-15',
                count: 12,
                releases: [{ date: '2026-05-20', release_id: 50, release_name: 'Employment Situation' }],
              },
            },
          }),
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

// ── Utility ───────────────────────────────────────────────────────────────────

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
  res.json({
    service: 'LastLook Data',
    version: '2.8.2',
    description: 'Financial market data for AI agents — Treasury yields, mortgage rates, energy prices, FX rates, and macro indicators.',
    website: 'https://www.lastlookdata.com',
    openapi: 'https://api.lastlookdata.com/openapi.json',
    payment: 'x402 v2 protocol, USDC on Base mainnet (eip155:8453)',
    endpoint_pattern: {
      'Current value':        'GET /api/current?id=SERIES_ID — $0.01 USDC',
      'Value by date':        'GET /api/date?id=SERIES_ID&d=YYYY-MM-DD — $0.01 USDC',
      'Last 30 days':         'GET /api/series/30?id=SERIES_ID — $0.05 USDC',
      'Last 90 days':         'GET /api/series/90?id=SERIES_ID — $0.10 USDC',
      'Last 365 days':        'GET /api/series/365?id=SERIES_ID — $0.25 USDC',
      'Current FX rate':      'GET /api/fx/current?pair=PAIR — $0.01 USDC',
      'FX rate by date':      'GET /api/fx/date?pair=PAIR&d=YYYY-MM-DD — $0.01 USDC',
      'FX historical series': 'GET /api/fx/series?pair=PAIR&days=N — $0.05/$0.10/$0.25 USDC',
    },
    common_use_cases: {
      'Current IORB rate':           'GET /api/current?id=IORB',
      'Current EFFR rate':           'GET /api/current?id=EFFR',
      'Current 30-yr mortgage rate': 'GET /api/current?id=MORTGAGE30US',
      'Current 15-yr mortgage rate': 'GET /api/current?id=MORTGAGE15US',
      'Current Fed funds rate':      'GET /api/current?id=FEDFUNDS',
      'Current 10-yr Treasury':      'GET /api/current?id=DGS10',
      'Current 30-yr Treasury':      'GET /api/current?id=DGS30',
      'Current CPI':                 'GET /api/current?id=CPIAUCSL',
      'Current unemployment':        'GET /api/current?id=UNRATE',
      'Current WTI crude oil':       'GET /api/current?id=DCOILWTICO',
      'Current EUR/USD rate':        'GET /api/fx/current?pair=EURUSD',
    },
    supported_series: {
      treasury:        ['DGS30', 'DGS10', 'DGS5', 'DGS2', 'DGS1MO'],
      mortgage_housing:['MORTGAGE30US', 'MORTGAGE15US', 'MSPUS', 'HOUST'],
      benchmark_rates: ['FEDFUNDS', 'SOFR', 'DPRIME', 'DTB3', 'IORB', 'EFFR'],
      macro:           ['CPIAUCSL', 'CPILFESL', 'UNRATE', 'GDP'],
      energy:          ['DCOILWTICO', 'DCOILBRENTEU', 'GASREGCOVW', 'DHHNGSP'],
    },
    supported_fx: [...ALLOWED_FX],
    legacy_endpoints: {
      note: 'Backward-compatible aliases maintained for existing integrations',
      '/api/treasury/current': 'alias for /api/current?id=DGS30',
      '/api/treasury/date':    'alias for /api/date?id=DGS30&d=YYYY-MM-DD',
    },
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data', version: '2.8.2' }));

app.get('/logo.png', (req, res) => res.sendFile('logo.png', { root: __dirname }));

app.get('/openapi.json', (req, res) => res.sendFile('openapi.json', { root: __dirname }));

app.get('/.well-known/x402.json', (req, res) => res.json({
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
  ],
}));

// ── FRED: current value ───────────────────────────────────────────────────────

app.get('/api/current', async (req, res) => {
  try {
    const seriesId = (req.query.id || '').toUpperCase();
    if (!ALLOWED_SERIES.has(seriesId)) return res.status(400).json({
      error: `Unknown series "${seriesId}".`,
      supported_series: [...ALLOWED_SERIES],
    });
    const obs = await fetchFredSeries(seriesId, daysAgoISO(14), todayISO());
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

app.listen(PORT, () => console.log(`LastLook Data running on port ${PORT}`));
