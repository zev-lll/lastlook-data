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
  // Treasury Rates
  'DGS30', 'DGS10', 'DGS5', 'DGS2', 'DGS1MO',
  // Mortgage & Housing
  'MORTGAGE30US', 'MORTGAGE15US', 'MSPUS', 'HOUST',
  // Benchmark Rates
  'FEDFUNDS', 'SOFR', 'DPRIME', 'DTB3',
  // Macro Indicators
  'CPIAUCSL', 'CPILFESL', 'UNRATE', 'GDP',
  // Energy
  'DCOILWTICO', 'DCOILBRENTEU', 'GASREGCOVW', 'DHHNGSP',
]);

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
      'GET /api/treasury/current': {
        accepts: { scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS },
        description: 'LastLook Data — current 30-year US Treasury yield (DGS30) from FRED',
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
        accepts: { scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS },
        description: 'LastLook Data — 30-year US Treasury yield for a specific date (YYYY-MM-DD)',
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
      'GET /api/series/30': {
        accepts: { scheme: 'exact', price: '$0.05', network: 'eip155:8453', payTo: WALLET_ADDRESS },
        description: 'LastLook Data — last 30 days of any FRED series. Use for current mortgage rates (?id=MORTGAGE30US or MORTGAGE15US), Fed funds rate (?id=FEDFUNDS), 10-yr Treasury (?id=DGS10), CPI (?id=CPIAUCSL), unemployment (?id=UNRATE), crude oil (?id=DCOILWTICO), and more.',
        mimeType: 'application/json',
        extensions: {
          ...declareDiscoveryExtension({
            input: { id: 'MORTGAGE30US' },
            inputSchema: {
              properties: {
                id: { type: 'string', description: 'FRED series ID: MORTGAGE30US, MORTGAGE15US, DGS10, DGS30, FEDFUNDS, SOFR, CPIAUCSL, UNRATE, DCOILWTICO (WTI crude), DCOILBRENTEU (Brent crude), GASREGCOVW (gasoline), DHHNGSP (natural gas), and more' },
              },
              required: ['id'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                series_id: 'DCOILWTICO',
                days: 30,
                count: 21,
                start: '2026-04-10',
                end: '2026-05-09',
                observations: [{ date: '2026-04-10', value: 61.42 }, { date: '2026-05-09', value: 58.73 }],
                note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
              },
            },
          }),
        },
      },
      'GET /api/series/90': {
        accepts: { scheme: 'exact', price: '$0.10', network: 'eip155:8453', payTo: WALLET_ADDRESS },
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
      'GET /api/series/365': {
        accepts: { scheme: 'exact', price: '$0.25', network: 'eip155:8453', payTo: WALLET_ADDRESS },
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
      'GET /api/fx/current': {
        accepts: { scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS },
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
      'GET /api/fx/series': {
        accepts: { scheme: 'exact', price: '$0.05', network: 'eip155:8453', payTo: WALLET_ADDRESS },
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
  const cacheKey = `${startDate}_${endDate}`;
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
    version: '2.6.0',
    description: 'Financial market data for AI agents — Treasury yields, mortgage rates, energy prices, FX rates. Pay per query via x402, no accounts or API keys required.',
    website: 'https://www.lastlookdata.com',
    payment: 'x402 v2 protocol, USDC on Base mainnet (eip155:8453)',
    common_use_cases: {
      'Current 30-yr mortgage rate': 'GET /api/series/30?id=MORTGAGE30US',
      'Current 15-yr mortgage rate': 'GET /api/series/30?id=MORTGAGE15US',
      'Current Fed funds rate':      'GET /api/series/30?id=FEDFUNDS',
      'Current 10-yr Treasury yield':'GET /api/series/30?id=DGS10',
      'Current 30-yr Treasury yield':'GET /api/treasury/current',
      'Current CPI (inflation)':     'GET /api/series/30?id=CPIAUCSL',
      'Current unemployment rate':   'GET /api/series/30?id=UNRATE',
      'Current WTI crude oil price': 'GET /api/series/30?id=DCOILWTICO',
      'Current Brent crude price':   'GET /api/series/30?id=DCOILBRENTEU',
      'Current natural gas price':   'GET /api/series/30?id=DHHNGSP',
      'Current gasoline price':      'GET /api/series/30?id=GASREGCOVW',
      'Current EUR/USD rate':        'GET /api/fx/current?pair=EURUSD',
    },
    supported_series: {
      treasury:        ['DGS30', 'DGS10', 'DGS5', 'DGS2', 'DGS1MO'],
      mortgage_housing:['MORTGAGE30US', 'MORTGAGE15US', 'MSPUS', 'HOUST'],
      benchmark_rates: ['FEDFUNDS', 'SOFR', 'DPRIME', 'DTB3'],
      macro:           ['CPIAUCSL', 'CPILFESL', 'UNRATE', 'GDP'],
      energy:          ['DCOILWTICO', 'DCOILBRENTEU', 'GASREGCOVW', 'DHHNGSP'],
    },
    supported_fx: [...ALLOWED_FX],
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data', version: '2.6.0' }));

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

function seriesHandler(days) {
  return async (req, res) => {
    try {
      const seriesId = (req.query.id || 'DGS30').toUpperCase();
      if (!ALLOWED_SERIES.has(seriesId)) return res.status(400).json({
        error: `Unknown series "${seriesId}".`,
        supported_series: [...ALLOWED_SERIES],
        common_examples: 'MORTGAGE30US, FEDFUNDS, DGS10, CPIAUCSL, DCOILWTICO',
      });
      const obs = await fetchFredSeries(seriesId, daysAgoISO(days), todayISO());
      if (!obs.length) return res.status(404).json({ error: `No data returned for ${seriesId}` });
      res.json({ service: 'LastLook Data', series_id: seriesId, days, count: obs.length, start: obs[0].date, end: obs[obs.length-1].date, observations: obs, note: 'Source: Federal Reserve Bank of St. Louis (FRED)' });
    } catch (err) { res.status(500).json({ error: 'Failed to fetch data', detail: err.message }); }
  };
}

app.get('/api/series/30', seriesHandler(30));
app.get('/api/series/90', seriesHandler(90));
app.get('/api/series/365', seriesHandler(365));

app.get('/api/fx/current', async (req, res) => {
  try {
    const pair = (req.query.pair || '').toUpperCase();
    if (!ALLOWED_FX.has(pair)) return res.status(400).json({ error: `Unknown pair "${pair}".`, supported_pairs: [...ALLOWED_FX] });
    const data = await fetchFXCurrent(pair);
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
