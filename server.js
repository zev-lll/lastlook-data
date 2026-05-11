require('dotenv').config();
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const { paymentMiddleware } = require('x402-express');

const app = express();
app.set('trust proxy', true);
const cache = new NodeCache({ stdTTL: 3600 });
const { facilitator } = require('@coinbase/x402');

const PORT = process.env.PORT || 8080;
const FRED_API_KEY = process.env.FRED_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PRICE_PER_QUERY = process.env.PRICE_PER_QUERY || '0.01';

// Allowed FRED series IDs — expand as new data is added
const ALLOWED_SERIES = new Set([
  'DGS30',        // 30-Year Treasury
  'DGS10',        // 10-Year Treasury
  'FEDFUNDS',     // Fed Funds Rate
  'SOFR',         // Secured Overnight Financing Rate
  'CPIAUCSL',     // CPI
  'MORTGAGE30US', // 30-Year Mortgage Rate
]);

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
    },
    facilitator
  )
);

// ── FRED helpers ─────────────────────────────────────────────────────────────

// Original single-series helper (DGS30 only, used by existing endpoints)
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

// General-purpose helper for any series
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

  // Filter out non-trading days (FRED returns "." for weekends/holidays)
  const observations = response.data.observations
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }));

  cache.set(cacheKey, observations);
  return observations;
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Existing routes ───────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    service: 'LastLook Data',
    description: 'Financial Market Data API for AI Agents',
    website: 'https://www.lastlookdata.com',
    endpoints: [
      'GET /api/treasury/current — most recent 30yr yield ($0.01 USDC)',
      'GET /api/treasury/date?d=YYYY-MM-DD — yield on a specific date ($0.01 USDC)',
      'GET /api/treasury/public — current yield, free',
      'GET /api/series/30?id=DGS30 — last 30 days of observations ($0.05 USDC)',
      'GET /api/series/90?id=DGS30 — last 90 days of observations ($0.10 USDC)',
      'GET /api/series/365?id=DGS30 — last 365 days of observations ($0.25 USDC)',
      'GET /health — service status',
    ],
    supported_series: [...ALLOWED_SERIES],
    payment: 'x402 protocol, USDC on Base network',
  });
});

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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LastLook Data',
    version: '1.1.0',
  });
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

// ── Time series routes ────────────────────────────────────────────────────────

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

app.listen(PORT, () => console.log(`LastLook Data running on port ${PORT}`));
