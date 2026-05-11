require('dotenv').config();
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const yahooFinance = require('yahoo-finance2').default;

// x402 v2 packages
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { ExactEvmScheme } = require('@x402/evm/exact/server');

const app = express();
app.set('trust proxy', true);
const cache = new NodeCache({ stdTTL: 3600 });

const PORT = process.env.PORT || 8080;
const FRED_API_KEY = process.env.FRED_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

// ── x402 v2 setup ─────────────────────────────────────────────────────────────

const facilitatorClient = new HTTPFacilitatorClient({
  url: 'https://facilitator.xpay.sh',
});

const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register('eip155:8453', new ExactEvmScheme());

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

// ── Bazaar extension builder ──────────────────────────────────────────────────
// Matches the exact structure the validator expects:
// extensions.bazaar.info.input and extensions.bazaar.info.output

function bazaar(inputExample, outputExample, description) {
  return {
    bazaar: {
      discoverable: true,
      description,
      info: {
        input: {
          type: 'http',
          method: 'GET',
          ...inputExample,
        },
        output: {
          type: 'json',
          example: outputExample,
        },
      },
    },
  };
}

// ── x402 v2 payment middleware ────────────────────────────────────────────────

app.use(
  paymentMiddleware(
    {
      'GET /api/treasury/current': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'Most recent 30-year US Treasury constant maturity yield from FRED',
        mimeType: 'application/json',
        extensions: bazaar(
          {},
          { service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: '2026-05-09', yield_percent: 4.97, note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          'Most recent 30-year US Treasury constant maturity yield from FRED'
        ),
      },
      'GET /api/treasury/date': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: '30-year US Treasury yield for a specific business date',
        mimeType: 'application/json',
        extensions: bazaar(
          { queryParams: { d: '2026-05-09' } },
          { service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: '2026-05-09', yield_percent: 4.97, note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          '30-year US Treasury yield for a specific business date (YYYY-MM-DD)'
        ),
      },
      'GET /api/series/30': {
        accepts: [{ scheme: 'exact', price: '$0.05', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'Last 30 days of daily observations for any supported FRED series',
        mimeType: 'application/json',
        extensions: bazaar(
          { queryParams: { id: 'DGS30' } },
          { service: 'LastLook Data', series_id: 'DGS30', days: 30, count: 21, start: '2026-04-10', end: '2026-05-09', observations: [{ date: '2026-04-10', value: 4.89 }, { date: '2026-05-09', value: 4.97 }], note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          'Last 30 days of FRED data — supports DGS30, DGS10, DGS5, DGS2, DGS1MO, MORTGAGE30US, MORTGAGE15US, MSPUS, HOUST, FEDFUNDS, SOFR, DPRIME, DTB3, CPIAUCSL, CPILFESL, UNRATE, GDP'
        ),
      },
      'GET /api/series/90': {
        accepts: [{ scheme: 'exact', price: '$0.10', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'Last 90 days of daily observations for any supported FRED series',
        mimeType: 'application/json',
        extensions: bazaar(
          { queryParams: { id: 'DGS30' } },
          { service: 'LastLook Data', series_id: 'DGS30', days: 90, count: 63, start: '2026-02-09', end: '2026-05-09', observations: [{ date: '2026-02-09', value: 4.75 }, { date: '2026-05-09', value: 4.97 }], note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          'Last 90 days of FRED data — supports DGS30, DGS10, DGS5, DGS2, DGS1MO, MORTGAGE30US, MORTGAGE15US, MSPUS, HOUST, FEDFUNDS, SOFR, DPRIME, DTB3, CPIAUCSL, CPILFESL, UNRATE, GDP'
        ),
      },
      'GET /api/series/365': {
        accepts: [{ scheme: 'exact', price: '$0.25', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'Last 365 days of daily observations for any supported FRED series',
        mimeType: 'application/json',
        extensions: bazaar(
          { queryParams: { id: 'DGS30' } },
          { service: 'LastLook Data', series_id: 'DGS30', days: 365, count: 252, start: '2025-05-09', end: '2026-05-09', observations: [{ date: '2025-05-09', value: 4.55 }, { date: '2026-05-09', value: 4.97 }], note: 'Source: Federal Reserve Bank of St. Louis (FRED)' },
          'Last 365 days of FRED data — supports DGS30, DGS10, DGS5, DGS2, DGS1MO, MORTGAGE30US, MORTGAGE15US, MSPUS, HOUST, FEDFUNDS, SOFR, DPRIME, DTB3, CPIAUCSL, CPILFESL, UNRATE, GDP'
        ),
      },
      'GET /api/fx/current': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'Current exchange rate for a G10 currency pair',
        mimeType: 'application/json',
        extensions: bazaar(
          { queryParams: { pair: 'EURUSD' } },
          { service: 'LastLook Data', pair: 'EURUSD', label: 'Euro / US Dollar', date: '2026-05-09', rate: 1.1245, base: 'EUR', quote: 'USD', note: 'Source: Frankfurter (European Central Bank)' },
          'Current G10 FX rate — supports EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK'
        ),
      },
      'GET /api/fx/series': {
        accepts: [{ scheme: 'exact', price: '$0.05', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'Historical daily exchange rates for a G10 currency pair',
        mimeType: 'application/json',
        extensions: bazaar(
          { queryParams: { pair: 'EURUSD', days: '30' } },
          { service: 'LastLook Data', pair: 'EURUSD', label: 'Euro / US Dollar', days: 30, count: 21, start: '2026-04-10', end: '2026-05-09', observations: [{ date: '2026-04-10', value: 1.1102 }, { date: '2026-05-09', value: 1.1245 }], note: 'Source: Frankfurter (European Central Bank)' },
          'Historical G10 FX rates — supports EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK — days: 30, 90, or 365'
        ),
      },
      'GET /api/equity/current': {
        accepts: [{ scheme: 'exact', price: '$0.01', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'Current price for a major US equity index',
        mimeType: 'application/json',
        extensions: bazaar(
          { queryParams: { symbol: 'SPX' } },
          { service: 'LastLook Data', symbol: 'SPX', label: 'S&P 500', price: 5248.32, change: 12.44, change_percent: 0.24, market_time: '2026-05-09', note: 'Source: Yahoo Finance' },
          'Current price for a major US equity index — supports SPX, NDX, DJIA, RUT, VIX'
        ),
      },
      'GET /api/equity/series': {
        accepts: [{ scheme: 'exact', price: '$0.05', network: 'eip155:8453', payTo: WALLET_ADDRESS }],
        description: 'Historical daily closing prices for a major US equity index',
        mimeType: 'application/json',
        extensions: bazaar(
          { queryParams: { symbol: 'SPX', days: '30' } },
          { service: 'LastLook Data', symbol: 'SPX', label: 'S&P 500', days: 30, count: 21, start: '2026-04-10', end: '2026-05-09', observations: [{ date: '2026-04-10', value: 5201.44 }, { date: '2026-05-09', value: 5248.32 }], note: 'Source: Yahoo Finance' },
          'Historical equity index prices — supports SPX, NDX, DJIA, RUT, VIX — days: 30, 90, or 365'
        ),
      },
    },
    resourceServer,
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
  const response = await axios.get(`https://api.frankfurter.app/${daysAgoISO(days)}..${todayISO()}`, { params: { from: base, to: quote } });
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
  const quote = await yahooFinance.quote(EQUITY_YAHOO_SYMBOLS[symbol]);
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
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const result = await yahooFinance.historical(EQUITY_YAHOO_SYMBOLS[symbol], { period1: startDate, period2: new Date(), interval: '1d' });
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
    service: 'LastLook Data', version: '2.2.0',
    description: 'Financial Market Data API for AI Agents',
    website: 'https://www.lastlookdata.com',
    payment: 'x402 v2 protocol, USDC on Base mainnet (eip155:8453)',
    supported_series: { treasury: ['DGS30','DGS10','DGS5','DGS2','DGS1MO'], mortgage_housing: ['MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST'], benchmark_rates: ['FEDFUNDS','SOFR','DPRIME','DTB3'], macro: ['CPIAUCSL','CPILFESL','UNRATE','GDP'] },
    supported_fx: [...ALLOWED_FX],
    supported_equities: [...ALLOWED_EQUITIES],
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data', version: '2.2.0' }));

app.get('/api/treasury/public', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const today = new Date(), weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const obs = await fetchFRED(weekAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    const latest = obs.filter(o => o.value !== '.').slice(-1)[0];
    if (!latest) return res.status(404).json({ error: 'No data available' });
    res.json({ date: latest.date, yield_percent: parseFloat(latest.value), series: 'DGS30' });
  } catch { res.status(500).json({ error: 'Failed to fetch data' }); }
});

app.get('/api/treasury/current', async (req, res) => {
  try {
    const today = new Date(), weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const obs = await fetchFRED(weekAgo.toISOString().split('T')[0], today.toISOString().split('T')[0]);
    const latest = obs.filter(o => o.value !== '.').slice(-1)[0];
    if (!latest) return res.status(404).json({ error: 'No data available' });
    res.json({ service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: latest.date, yield_percent: parseFloat(latest.value), note: 'Source: Federal Reserve Bank of St. Louis (FRED)' });
  } catch { res.status(500).json({ error: 'Failed to fetch data' }); }
});

app.get('/api/treasury/date', async (req, res) => {
  try {
    const { d } = req.query;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'Please provide a date in YYYY-MM-DD format' });
    const obs = await fetchFRED(d, d);
    const match = obs.find(o => o.value !== '.');
    if (!match) return res.status(404).json({ error: `No yield data for ${d}. FRED only publishes on business days.` });
    res.json({ service: 'LastLook Data', series: 'DGS30 - 30-Year Treasury Constant Maturity Rate', date: match.date, yield_percent: parseFloat(match.value), note: 'Source: Federal Reserve Bank of St. Louis (FRED)' });
  } catch { res.status(500).json({ error: 'Failed to fetch data' }); }
});

function seriesHandler(days) {
  return async (req, res) => {
    try {
      const seriesId = (req.query.id || 'DGS30').toUpperCase();
      if (!ALLOWED_SERIES.has(seriesId)) return res.status(400).json({ error: `Unknown series "${seriesId}".`, supported_series: [...ALLOWED_SERIES] });
      const obs = await fetchFredSeries(seriesId, daysAgoISO(days), todayISO());
      if (!obs.length) return res.status(404).json({ error: `No data returned for ${seriesId}` });
      res.json({ service: 'LastLook Data', series_id: seriesId, days, count: obs.length, start: obs[0].date, end: obs[obs.length-1].date, observations: obs, note: 'Source: Federal Reserve Bank of St. Louis (FRED)' });
    } catch { res.status(500).json({ error: 'Failed to fetch data' }); }
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
  } catch { res.status(500).json({ error: 'Failed to fetch FX data' }); }
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
  } catch { res.status(500).json({ error: 'Failed to fetch FX data' }); }
});

app.get('/api/equity/current', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').toUpperCase();
    if (!ALLOWED_EQUITIES.has(symbol)) return res.status(400).json({ error: `Unknown symbol "${symbol}".`, supported_symbols: [...ALLOWED_EQUITIES] });
    const data = await fetchEquityCurrent(symbol);
    res.json({ service: 'LastLook Data', ...data, note: 'Source: Yahoo Finance' });
  } catch { res.status(500).json({ error: 'Failed to fetch equity data' }); }
});

app.get('/api/equity/series', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').toUpperCase();
    const days = parseInt(req.query.days, 10) || 30;
    if (!ALLOWED_EQUITIES.has(symbol)) return res.status(400).json({ error: `Unknown symbol "${symbol}".`, supported_symbols: [...ALLOWED_EQUITIES] });
    if (![30,90,365].includes(days)) return res.status(400).json({ error: 'days must be 30, 90, or 365' });
    const obs = await fetchEquitySeries(symbol, days);
    if (!obs.length) return res.status(404).json({ error: `No data returned for ${symbol}` });
    res.json({ service: 'LastLook Data', symbol, label: EQUITY_LABELS[symbol], days, count: obs.length, start: obs[0].date, end: obs[obs.length-1].date, observations: obs, note: 'Source: Yahoo Finance' });
  } catch { res.status(500).json({ error: 'Failed to fetch equity data' }); }
});

app.listen(PORT, () => console.log(`LastLook Data running on port ${PORT}`));
