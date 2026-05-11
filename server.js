require('dotenv').config();
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const yahooFinance = require('yahoo-finance2').default;

// x402 v1 packages (CDP facilitator requires @coinbase/x402@1.x)
const { paymentMiddleware } = require('x402-express');
const { facilitator } = require('@coinbase/x402');

// Bazaar discovery extension
const { declareDiscoveryExtension } = require('@x402/extensions/bazaar');

const app = express();
app.set('trust proxy', true);
const cache = new NodeCache({ stdTTL: 3600 });

const PORT = process.env.PORT || 8080;
const FRED_API_KEY = process.env.FRED_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

// ── Allowed symbols ───────────────────────────────────────────────────────────

const ALLOWED_SERIES = new Set([
  'DGS30', 'DGS10', 'DGS5', 'DGS2', 'DGS1MO',
  'MORTGAGE30US', 'MORTGAGE15US', 'MSPUS', 'HOUST',
  'FEDFUNDS', 'SOFR', 'DPRIME', 'DTB3',
  'CPIAUCSL', 'CPILFESL', 'UNRATE', 'GDP',
]);

const ALLOWED_FX = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
  'USDCAD', 'AUDUSD', 'NZDUSD', 'USDSEK', 'USDNOK',
]);

const ALLOWED_EQUITIES = new Set(['SPX', 'NDX', 'DJIA', 'RUT', 'VIX']);

const EQUITY_YAHOO_SYMBOLS = {
  SPX: '^GSPC', NDX: '^NDX', DJIA: '^DJI', RUT: '^RUT', VIX: '^VIX',
};

const EQUITY_LABELS = {
  SPX: 'S&P 500', NDX: 'NASDAQ 100', DJIA: 'Dow Jones Industrial Average',
  RUT: 'Russell 2000', VIX: 'CBOE Volatility Index',
};

const FX_LABELS = {
  EURUSD: 'Euro / US Dollar', GBPUSD: 'British Pound / US Dollar',
  USDJPY: 'US Dollar / Japanese Yen', USDCHF: 'US Dollar / Swiss Franc',
  USDCAD: 'US Dollar / Canadian Dollar', AUDUSD: 'Australian Dollar / US Dollar',
  NZDUSD: 'New Zealand Dollar / US Dollar', USDSEK: 'US Dollar / Swedish Krona',
  USDNOK: 'US Dollar / Norwegian Krone',
};

// ── x402 payment middleware with Bazaar extensions ────────────────────────────
// Uses CDP facilitator (reads CDP_API_KEY_ID + CDP_API_KEY_SECRET from env)

app.use(
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      'GET /api/treasury/current': {
        price: '$0.01',
        network: 'base',
        config: {
          description: 'Most recent 30-year US Treasury constant maturity yield from FRED',
          mimeType: 'application/json',
        },
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
        price: '$0.01',
        network: 'base',
        config: {
          description: '30-year US Treasury yield for a specific business date',
          mimeType: 'application/json',
        },
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
        price: '$0.05',
        network: 'base',
        config: {
          description: 'Last 30 days of daily observations for any supported FRED series',
          mimeType: 'application/json',
        },
        extensions: {
          ...declareDiscoveryExtension({
            input: { id: 'DGS30' },
            inputSchema: {
              properties: { id: { type: 'string', description: 'FRED series ID e.g. DGS30, FEDFUNDS, CPIAUCSL' } },
              required: ['id'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                series_id: 'DGS30',
                days: 30,
                count: 21,
                start: '2026-04-10',
                end: '2026-05-09',
                observations: [{ date: '2026-04-10', value: 4.89 }, { date: '2026-05-09', value: 4.97 }],
                note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
              },
            },
          }),
        },
      },
      'GET /api/series/90': {
        price: '$0.10',
        network: 'base',
        config: {
          description: 'Last 90 days of daily observations for any supported FRED series',
          mimeType: 'application/json',
        },
        extensions: {
          ...declareDiscoveryExtension({
            input: { id: 'DGS30' },
            inputSchema: {
              properties: { id: { type: 'string', description: 'FRED series ID e.g. DGS30, FEDFUNDS, CPIAUCSL' } },
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
        price: '$0.25',
        network: 'base',
        config: {
          description: 'Last 365 days of daily observations for any supported FRED series',
          mimeType: 'application/json',
        },
        extensions: {
          ...declareDiscoveryExtension({
            input: { id: 'DGS30' },
            inputSchema: {
              properties: { id: { type: 'string', description: 'FRED series ID e.g. DGS30, FEDFUNDS, CPIAUCSL' } },
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
        price: '$0.01',
        network: 'base',
        config: {
          description: 'Current exchange rate for a G10 currency pair, sourced from the European Central Bank',
          mimeType: 'application/json',
        },
        extensions: {
          ...declareDiscoveryExtension({
            input: { pair: 'EURUSD' },
            inputSchema: {
              properties: { pair: { type: 'string', description: 'G10 currency pair e.g. EURUSD, USDJPY, GBPUSD' } },
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
        price: '$0.05',
        network: 'base',
        config: {
          description: 'Historical daily exchange rates for a G10 currency pair',
          mimeType: 'application/json',
        },
        extensions: {
          ...declareDiscoveryExtension({
            input: { pair: 'EURUSD', days: '30' },
            inputSchema: {
              properties: {
                pair: { type: 'string', description: 'G10 currency pair e.g. EURUSD, USDJPY' },
                days: { type: 'string', description: 'Number of days: 30, 90, or 365' },
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
      'GET /api/equity/current': {
        price: '$0.01',
        network: 'base',
        config: {
          description: 'Current price for a major US equity index',
          mimeType: 'application/json',
        },
        extensions: {
          ...declareDiscoveryExtension({
            input: { symbol: 'SPX' },
            inputSchema: {
              properties: { symbol: { type: 'string', description: 'Index symbol: SPX, NDX, DJIA, RUT, or VIX' } },
              required: ['symbol'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                symbol: 'SPX',
                label: 'S&P 500',
                price: 5248.32,
                change: 12.44,
                change_percent: 0.24,
                market_time: '2026-05-09',
                note: 'Source: Yahoo Finance',
              },
            },
          }),
        },
      },
      'GET /api/equity/series': {
        price: '$0.05',
        network: 'base',
        config: {
          description: 'Historical daily closing prices for a major US equity index',
          mimeType: 'application/json',
        },
        extensions: {
          ...declareDiscoveryExtension({
            input: { symbol: 'SPX', days: '30' },
            inputSchema: {
              properties: {
                symbol: { type: 'string', description: 'Index symbol: SPX, NDX, DJIA, RUT, or VIX' },
                days: { type: 'string', description: 'Number of days: 30, 90, or 365' },
              },
              required: ['symbol', 'days'],
            },
            output: {
              example: {
                service: 'LastLook Data',
                symbol: 'SPX',
                label: 'S&P 500',
                days: 30,
                count: 21,
                start: '2026-04-10',
                end: '2026-05-09',
                observations: [{ date: '2026-04-10', value: 5201.44 }, { date: '2026-05-09', value: 5248.32 }],
                note: 'Source: Yahoo Finance',
              },
            },
          }),
        },
      },
    },
    facilitator,
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
  const base = pair.slice(0, 3);
  const quote = pair.slice(3, 6);
  const response = await axios.get('https://api.frankfurter.app/latest', { params: { from: base, to: quote } });
  const result = { date: response.data.date, rate: response.data.rates[quote], pair, base, quote };
  cache.set(cacheKey, result, 3600);
  return result;
}

async function fetchFXSeries(pair, days) {
  const cacheKey = `fx_series_${pair}_${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const base = pair.slice(0, 3);
  const quote = pair.slice(3, 6);
  const startDate = daysAgoISO(days);
  const endDate = todayISO();
  const response = await axios.get(`https://api.frankfurter.app/${startDate}..${endDate}`, { params: { from: base, to: quote } });
  const observations = Object.entries(response.data.rates)
    .map(([date, rates]) => ({ date, value: rates[quote] }))
    .sort((a, b) => a.date.localeCompare(b.date));
  cache.set(cacheKey, observations, 3600);
  return observations;
}

// ── Equity helpers ────────────────────────────────────────────────────────────

async function fetchEquityCurrent(symbol) {
  const cacheKey = `equity_current_${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const yahooSymbol = EQUITY_YAHOO_SYMBOLS[symbol];
  const quote = await yahooFinance.quote(yahooSymbol);
  const result = {
    symbol, label: EQUITY_LABELS[symbol],
    price: quote.regularMarketPrice,
    change: quote.regularMarketChange,
    change_percent: quote.regularMarketChangePercent,
    market_time: new Date(quote.regularMarketTime * 1000).toISOString().slice(0, 10),
  };
  cache.set(cacheKey, result, 900);
  return result;
}

async function fetchEquitySeries(symbol, days) {
  const cacheKey = `equity_series_${symbol}_${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const yahooSymbol = EQUITY_YAHOO_SYMBOLS[symbol];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const result = await yahooFinance.historical(yahooSymbol, { period1: startDate, period2: new Date(), interval: '1d' });
  const observations = result.map(d => ({ date: d.date.toISOString().slice(0, 10), value: parseFloat(d.close.toFixed(2)) }));
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
    description: 'Financial Market Data API for AI Agents',
    version: '2.1.0',
    website: 'https://www.lastlookdata.com',
    endpoints: [
      'GET /api/treasury/current — most recent 30yr yield ($0.01 USDC)',
      'GET /api/treasury/date?d=YYYY-MM-DD — yield on a specific date ($0.01 USDC)',
      'GET /api/treasury/public — current yield, free',
      'GET /api/series/30?id=SERIES_ID — last 30 days of FRED observations ($0.05 USDC)',
      'GET /api/series/90?id=SERIES_ID — last 90 days of FRED observations ($0.10 USDC)',
      'GET /api/series/365?id=SERIES_ID — last 365 days of FRED observations ($0.25 USDC)',
      'GET /api/fx/current?pair=EURUSD — current G10 FX rate ($0.01 USDC)',
      'GET /api/fx/series?pair=EURUSD&days=30 — FX rate history ($0.05 USDC)',
      'GET /api/equity/current?symbol=SPX — current equity index price ($0.01 USDC)',
      'GET /api/equity/series?symbol=SPX&days=30 — equity index history ($0.05 USDC)',
      'GET /health — service status',
    ],
    supported_series: {
      treasury: ['DGS30', 'DGS10', 'DGS5', 'DGS2', 'DGS1MO'],
      mortgage_housing: ['MORTGAGE30US', 'MORTGAGE15US', 'MSPUS', 'HOUST'],
      benchmark_rates: ['FEDFUNDS', 'SOFR', 'DPRIME', 'DTB3'],
      macro: ['CPIAUCSL', 'CPILFESL', 'UNRATE', 'GDP'],
    },
    supported_fx: [...ALLOWED_FX],
    supported_equities: [...ALLOWED_EQUITIES],
    payment: 'x402 protocol, USDC on Base mainnet',
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LastLook Data', version: '2.1.0' });
});

app.get('/api/treasury/public', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const observations = await fetchFRED(weekAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    const latest = observations.filter(o => o.value !== '.').slice(-1)[0];
    if (!latest) return res.status(404).json({ error: 'No data available' });
    res.json({ date: latest.date, yield_percent: parseFloat(latest.value), series: 'DGS30' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.get('/api/treasury/current', async (req, res) => {
  try {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const observations = await fetchFRED(weekAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    const latest = observations.filter(o => o.value !== '.').slice(-1)[0];
    if (!latest) return res.status(404).json({ error: 'No data available' });
    res.json({ service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: latest.date, yield_percent: parseFloat(latest.value), note: 'Source: Federal Reserve Bank of St. Louis (FRED)' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.get('/api/treasury/date', async (req, res) => {
  try {
    const { d } = req.query;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'Please provide a date in YYYY-MM-DD format' });
    const observations = await fetchFRED(d, d);
    const match = observations.find(o => o.value !== '.');
    if (!match) return res.status(404).json({ error: `No yield data for ${d}. FRED only publishes on business days.` });
    res.json({ service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: match.date, yield_percent: parseFloat(match.value), note: 'Source: Federal Reserve Bank of St. Louis (FRED)' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

function seriesHandler(days) {
  return async (req, res) => {
    try {
      const seriesId = (req.query.id || 'DGS30').toUpperCase();
      if (!ALLOWED_SERIES.has(seriesId)) return res.status(400).json({ error: `Unknown series "${seriesId}".`, supported_series: [...ALLOWED_SERIES] });
      const observations = await fetchFredSeries(seriesId, daysAgoISO(days), todayISO());
      if (!observations.length) return res.status(404).json({ error: `No data returned for ${seriesId}` });
      res.json({ service: 'LastLook Data', series_id: seriesId, days, count: observations.length, start: observations[0].date, end: observations[observations.length - 1].date, observations, note: 'Source: Federal Reserve Bank of St. Louis (FRED)' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch data' });
    }
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
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FX data' });
  }
});

app.get('/api/fx/series', async (req, res) => {
  try {
    const pair = (req.query.pair || '').toUpperCase();
    const days = parseInt(req.query.days, 10) || 30;
    if (!ALLOWED_FX.has(pair)) return res.status(400).json({ error: `Unknown pair "${pair}".`, supported_pairs: [...ALLOWED_FX] });
    if (![30, 90, 365].includes(days)) return res.status(400).json({ error: 'days must be 30, 90, or 365' });
    const observations = await fetchFXSeries(pair, days);
    if (!observations.length) return res.status(404).json({ error: `No data returned for ${pair}` });
    res.json({ service: 'LastLook Data', pair, label: FX_LABELS[pair], days, count: observations.length, start: observations[0].date, end: observations[observations.length - 1].date, observations, note: 'Source: Frankfurter (European Central Bank)' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FX data' });
  }
});

app.get('/api/equity/current', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').toUpperCase();
    if (!ALLOWED_EQUITIES.has(symbol)) return res.status(400).json({ error: `Unknown symbol "${symbol}".`, supported_symbols: [...ALLOWED_EQUITIES] });
    const data = await fetchEquityCurrent(symbol);
    res.json({ service: 'LastLook Data', ...data, note: 'Source: Yahoo Finance' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch equity data' });
  }
});

app.get('/api/equity/series', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').toUpperCase();
    const days = parseInt(req.query.days, 10) || 30;
    if (!ALLOWED_EQUITIES.has(symbol)) return res.status(400).json({ error: `Unknown symbol "${symbol}".`, supported_symbols: [...ALLOWED_EQUITIES] });
    if (![30, 90, 365].includes(days)) return res.status(400).json({ error: 'days must be 30, 90, or 365' });
    const observations = await fetchEquitySeries(symbol, days);
    if (!observations.length) return res.status(404).json({ error: `No data returned for ${symbol}` });
    res.json({ service: 'LastLook Data', symbol, label: EQUITY_LABELS[symbol], days, count: observations.length, start: observations[0].date, end: observations[observations.length - 1].date, observations, note: 'Source: Yahoo Finance' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch equity data' });
  }
});

app.listen(PORT, () => console.log(`LastLook Data running on port ${PORT}`));
