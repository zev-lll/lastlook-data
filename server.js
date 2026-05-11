require('dotenv').config();
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const { paymentMiddleware } = require('x402-express');
const yahooFinance = require('yahoo-finance2').default;

const app = express();
app.set('trust proxy', true);
const cache = new NodeCache({ stdTTL: 3600 });
const { facilitator } = require('@coinbase/x402');

const PORT = process.env.PORT || 8080;
const FRED_API_KEY = process.env.FRED_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PRICE_PER_QUERY = process.env.PRICE_PER_QUERY || '0.01';

// ── Allowed symbols ───────────────────────────────────────────────────────────

const ALLOWED_SERIES = new Set([
  // Treasury Rates
  'DGS30',        // 30-Year Treasury Constant Maturity
  'DGS10',        // 10-Year Treasury Constant Maturity
  'DGS5',         // 5-Year Treasury Constant Maturity
  'DGS2',         // 2-Year Treasury Constant Maturity
  'DGS1MO',       // 1-Month T-Bill Rate
  // Mortgage & Housing
  'MORTGAGE30US', // 30-Year Fixed Mortgage Average
  'MORTGAGE15US', // 15-Year Fixed Mortgage Average
  'MSPUS',        // Median Home Sales Price (quarterly)
  'HOUST',        // Housing Starts
  // Benchmark Rates
  'FEDFUNDS',     // Federal Funds Effective Rate
  'SOFR',         // Secured Overnight Financing Rate
  'DPRIME',       // Bank Prime Loan Rate
  'DTB3',         // 3-Month T-Bill Rate
  // Macro Indicators
  'CPIAUCSL',     // CPI All Urban Consumers
  'CPILFESL',     // Core CPI ex Food & Energy
  'UNRATE',       // Unemployment Rate
  'GDP',          // Gross Domestic Product (quarterly)
]);

const ALLOWED_FX = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
  'USDCAD', 'AUDUSD', 'NZDUSD', 'USDSEK', 'USDNOK',
]);

const ALLOWED_EQUITIES = new Set([
  'SPX',   // S&P 500
  'NDX',   // NASDAQ 100
  'DJIA',  // Dow Jones Industrial Average
  'RUT',   // Russell 2000
  'VIX',   // CBOE Volatility Index
]);

// Yahoo Finance symbols for equity indices
const EQUITY_YAHOO_SYMBOLS = {
  SPX:  '^GSPC',
  NDX:  '^NDX',
  DJIA: '^DJI',
  RUT:  '^RUT',
  VIX:  '^VIX',
};

const EQUITY_LABELS = {
  SPX:  'S&P 500',
  NDX:  'NASDAQ 100',
  DJIA: 'Dow Jones Industrial Average',
  RUT:  'Russell 2000',
  VIX:  'CBOE Volatility Index',
};

const FX_LABELS = {
  EURUSD: 'Euro / US Dollar',
  GBPUSD: 'British Pound / US Dollar',
  USDJPY: 'US Dollar / Japanese Yen',
  USDCHF: 'US Dollar / Swiss Franc',
  USDCAD: 'US Dollar / Canadian Dollar',
  AUDUSD: 'Australian Dollar / US Dollar',
  NZDUSD: 'New Zealand Dollar / US Dollar',
  USDSEK: 'US Dollar / Swedish Krona',
  USDNOK: 'US Dollar / Norwegian Krone',
};

// ── Payment middleware ────────────────────────────────────────────────────────

app.use(
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      'GET /api/treasury/current': {
        price: `$${PRICE_PER_QUERY}`,
        network: 'base',
        resource: 'https://api.lastlookdata.com/api/treasury/current',
        description: 'Most recent 30-year US Treasury constant maturity yield',
      },
      'GET /api/treasury/date': {
        price: `$${PRICE_PER_QUERY}`,
        network: 'base',
        resource: 'https://api.lastlookdata.com/api/treasury/date',
        description: '30-year US Treasury yield for a specific date (YYYY-MM-DD)',
      },
      'GET /api/series/30': {
        price: '$0.05',
        network: 'base',
        resource: 'https://api.lastlookdata.com/api/series/30',
        description: 'Last 30 days of daily observations for any supported FRED series',
      },
      'GET /api/series/90': {
        price: '$0.10',
        network: 'base',
        resource: 'https://api.lastlookdata.com/api/series/90',
        description: 'Last 90 days of daily observations for any supported FRED series',
      },
      'GET /api/series/365': {
        price: '$0.25',
        network: 'base',
        resource: 'https://api.lastlookdata.com/api/series/365',
        description: 'Last 365 days of daily observations for any supported FRED series',
      },
      'GET /api/fx/current': {
        price: `$${PRICE_PER_QUERY}`,
        network: 'base',
        resource: 'https://api.lastlookdata.com/api/fx/current',
        description: 'Current rate for a G10 currency pair',
      },
      'GET /api/fx/series': {
        price: '$0.05',
        network: 'base',
        resource: 'https://api.lastlookdata.com/api/fx/series',
        description: 'Historical daily rates for a G10 currency pair',
      },
      'GET /api/equity/current': {
        price: `$${PRICE_PER_QUERY}`,
        network: 'base',
        resource: 'https://api.lastlookdata.com/api/equity/current',
        description: 'Current price for a major equity index',
      },
      'GET /api/equity/series': {
        price: '$0.05',
        network: 'base',
        resource: 'https://api.lastlookdata.com/api/equity/series',
        description: 'Historical daily closing prices for a major equity index',
      },
    },
    facilitator
  )
);

// ── FRED helpers ──────────────────────────────────────────────────────────────

async function fetchFRED(startDate, endDate) {
  const cacheKey = `${startDate}_${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const response = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
    params: {
      series_id: 'DGS30',
      api_key: FRED_API_KEY,
      file_type: 'json',
      observation_start: startDate,
      observation_end: endDate,
    }
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
    params: {
      series_id: seriesId,
      api_key: FRED_API_KEY,
      file_type: 'json',
      observation_start: startDate,
      observation_end: endDate,
    }
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

  // Frankfurter uses ISO currency codes — convert pair string to base/quote
  const base = pair.slice(0, 3);
  const quote = pair.slice(3, 6);

  const response = await axios.get(`https://api.frankfurter.app/latest`, {
    params: { from: base, to: quote },
  });

  const rate = response.data.rates[quote];
  const result = { date: response.data.date, rate, pair, base, quote };
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

  const response = await axios.get(`https://api.frankfurter.app/${startDate}..${endDate}`, {
    params: { from: base, to: quote },
  });

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
    symbol,
    label: EQUITY_LABELS[symbol],
    price: quote.regularMarketPrice,
    change: quote.regularMarketChange,
    change_percent: quote.regularMarketChangePercent,
    market_time: new Date(quote.regularMarketTime * 1000).toISOString().slice(0, 10),
  };

  cache.set(cacheKey, result, 900); // 15-min cache for equity prices
  return result;
}

async function fetchEquitySeries(symbol, days) {
  const cacheKey = `equity_series_${symbol}_${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const yahooSymbol = EQUITY_YAHOO_SYMBOLS[symbol];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const result = await yahooFinance.historical(yahooSymbol, {
    period1: startDate,
    period2: new Date(),
    interval: '1d',
  });

  const observations = result.map(d => ({
    date: d.date.toISOString().slice(0, 10),
    value: parseFloat(d.close.toFixed(2)),
  }));

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

// ── Routes: info ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    service: 'LastLook Data',
    description: 'Financial Market Data API for AI Agents',
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
    payment: 'x402 protocol, USDC on Base network',
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LastLook Data', version: '1.2.0' });
});

// ── Routes: FRED ──────────────────────────────────────────────────────────────

app.get('/api/treasury/public', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const observations = await fetchFRED(
      weekAgo.toISOString().split('T')[0],
      today.toISOString().split('T')[0]
    );
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
    const observations = await fetchFRED(
      weekAgo.toISOString().split('T')[0],
      today.toISOString().split('T')[0]
    );
    const latest = observations.filter(o => o.value !== '.').slice(-1)[0];
    if (!latest) return res.status(404).json({ error: 'No data available' });
    res.json({
      service: 'LastLook Data',
      series: 'DGS30 - 30-Year Treasury Constant Maturity Rate',
      date: latest.date,
      yield_percent: parseFloat(latest.value),
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.get('/api/treasury/date', async (req, res) => {
  try {
    const { d } = req.query;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return res.status(400).json({ error: 'Please provide a date in YYYY-MM-DD format' });
    }
    const observations = await fetchFRED(d, d);
    const match = observations.find(o => o.value !== '.');
    if (!match) {
      return res.status(404).json({ error: `No yield data for ${d}. FRED only publishes on business days.` });
    }
    res.json({
      service: 'LastLook Data',
      series: 'DGS30 - 30-Year Treasury Constant Maturity Rate',
      date: match.date,
      yield_percent: parseFloat(match.value),
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

function seriesHandler(days) {
  return async (req, res) => {
    try {
      const seriesId = (req.query.id || 'DGS30').toUpperCase();
      if (!ALLOWED_SERIES.has(seriesId)) {
        return res.status(400).json({
          error: `Unknown series "${seriesId}".`,
          supported_series: [...ALLOWED_SERIES],
        });
      }
      const observations = await fetchFredSeries(seriesId, daysAgoISO(days), todayISO());
      if (!observations.length) {
        return res.status(404).json({ error: `No data returned for ${seriesId}` });
      }
      res.json({
        service: 'LastLook Data',
        series_id: seriesId,
        days,
        count: observations.length,
        start: observations[0].date,
        end: observations[observations.length - 1].date,
        observations,
        note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  };
}

app.get('/api/series/30',  seriesHandler(30));
app.get('/api/series/90',  seriesHandler(90));
app.get('/api/series/365', seriesHandler(365));

// ── Routes: FX ────────────────────────────────────────────────────────────────

app.get('/api/fx/current', async (req, res) => {
  try {
    const pair = (req.query.pair || '').toUpperCase();
    if (!ALLOWED_FX.has(pair)) {
      return res.status(400).json({
        error: `Unknown pair "${pair}".`,
        supported_pairs: [...ALLOWED_FX],
      });
    }
    const data = await fetchFXCurrent(pair);
    res.json({
      service: 'LastLook Data',
      pair,
      label: FX_LABELS[pair],
      date: data.date,
      rate: data.rate,
      base: data.base,
      quote: data.quote,
      note: 'Source: Frankfurter (European Central Bank)',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FX data' });
  }
});

app.get('/api/fx/series', async (req, res) => {
  try {
    const pair = (req.query.pair || '').toUpperCase();
    const days = parseInt(req.query.days, 10) || 30;
    if (!ALLOWED_FX.has(pair)) {
      return res.status(400).json({
        error: `Unknown pair "${pair}".`,
        supported_pairs: [...ALLOWED_FX],
      });
    }
    if (![30, 90, 365].includes(days)) {
      return res.status(400).json({ error: 'days must be 30, 90, or 365' });
    }
    const observations = await fetchFXSeries(pair, days);
    if (!observations.length) {
      return res.status(404).json({ error: `No data returned for ${pair}` });
    }
    res.json({
      service: 'LastLook Data',
      pair,
      label: FX_LABELS[pair],
      days,
      count: observations.length,
      start: observations[0].date,
      end: observations[observations.length - 1].date,
      observations,
      note: 'Source: Frankfurter (European Central Bank)',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FX data' });
  }
});

// ── Routes: Equities ──────────────────────────────────────────────────────────

app.get('/api/equity/current', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').toUpperCase();
    if (!ALLOWED_EQUITIES.has(symbol)) {
      return res.status(400).json({
        error: `Unknown symbol "${symbol}".`,
        supported_symbols: [...ALLOWED_EQUITIES],
      });
    }
    const data = await fetchEquityCurrent(symbol);
    res.json({
      service: 'LastLook Data',
      ...data,
      note: 'Source: Yahoo Finance',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch equity data' });
  }
});

app.get('/api/equity/series', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').toUpperCase();
    const days = parseInt(req.query.days, 10) || 30;
    if (!ALLOWED_EQUITIES.has(symbol)) {
      return res.status(400).json({
        error: `Unknown symbol "${symbol}".`,
        supported_symbols: [...ALLOWED_EQUITIES],
      });
    }
    if (![30, 90, 365].includes(days)) {
      return res.status(400).json({ error: 'days must be 30, 90, or 365' });
    }
    const observations = await fetchEquitySeries(symbol, days);
    if (!observations.length) {
      return res.status(404).json({ error: `No data returned for ${symbol}` });
    }
    res.json({
      service: 'LastLook Data',
      symbol,
      label: EQUITY_LABELS[symbol],
      days,
      count: observations.length,
      start: observations[0].date,
      end: observations[observations.length - 1].date,
      observations,
      note: 'Source: Yahoo Finance',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch equity data' });
  }
});

app.listen(PORT, () => console.log(`LastLook Data running on port ${PORT}`));

