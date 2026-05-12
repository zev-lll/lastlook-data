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
                id: { type: 'string', description: 'FRED series ID: DGS30, DGS10, DGS5, DGS2, DGS1MO, MORTGAGE30US, MORTGAGE15US, MSPUS, HOUST, FEDFUNDS, SOFR, DPRIME, DTB3, IORB, EFFR, CPIAUCSL, CPILFESL, UNRATE, GDP, DCOILWTICO, DCOILBRENTEU, GASREGCOVW, DHHNGSP' },
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
                id: { type: 'string', description: 'FRED series ID' },
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
                id: { type: 'string', description: 'FRED series ID' },
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
              properties: { id: { type: 'string', description: 'FRED series ID' } },
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
              properties: { id: { type: 'string', description: 'FRED series ID' } },
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
              properties: { pair: { type: 'string', description: 'G10 pair: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK' } },
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
                pair: { type: 'string', description: 'G10 currency pair' },
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
                pair: { type: 'string', description: 'G10 currency pair' },
                days: { type: 'string', description: '30, 90, or 365' },
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
    version: '2.7.0',
    description: 'Financial market data for AI agents — Treasury yields, mortgage rates, energy prices, FX rates, and macro indicators.',
    website: 'https://www.lastlookdata.com',
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

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data', version: '2.7.0' }));

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

app.listen(PORT, () => console.log(`LastLook Data running on port ${PORT}`));
