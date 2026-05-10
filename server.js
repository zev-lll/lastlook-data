require('dotenv').config();
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const { paymentMiddleware } = require('x402-express');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

const PORT = process.env.PORT || 8080;
const FRED_API_KEY = process.env.FRED_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PRICE_PER_QUERY = process.env.PRICE_PER_QUERY || '0.01';

// ── x402 v2 payment middleware ────────────────────────────────────────────
app.use(
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      'GET /api/treasury/current': {
        price: `$${PRICE_PER_QUERY}`,
        network: 'base',
        description: 'Most recent 30-year US Treasury constant maturity yield',
        mimeType: 'application/json',
      },
      'GET /api/treasury/date': {
        price: `$${PRICE_PER_QUERY}`,
        network: 'base',
        description: '30-year US Treasury yield for a specific date (YYYY-MM-DD)',
        mimeType: 'application/json',
      },
    },
    {
      facilitatorUrl: 'https://x402.org/facilitator',
    }
  )
);

// ── Helper: fetch from FRED ───────────────────────────────────────────────
async function fetchFRED(startDate, endDate) {
  const cacheKey = `${startDate}_${endDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = 'https://api.stlouisfed.org/fred/series/observations';
  const params = {
    series_id: 'DGS30',
    api_key: FRED_API_KEY,
    file_type: 'json',
    observation_start: startDate,
    observation_end: endDate,
  };

  const response = await axios.get(url, { params });
  const observations = response.data.observations;
  cache.set(cacheKey, observations);
  return observations;
}

// ── Root ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'LastLook Data',
    description: '30-Year Treasury Yield API for AI Agents',
    website: 'https://www.lastlookdata.com',
    endpoints: [
      'GET /api/treasury/current — most recent 30yr yield ($0.01 USDC)',
      'GET /api/treasury/date?d=YYYY-MM-DD — yield on a specific date ($0.01 USDC)',
      'GET /api/treasury/public — current yield, free (for display)',
      'GET /health — service status (free)',
    ],
    payment: 'x402 v2 protocol, USDC on Base network',
    contact: 'hello@lastlookdata.com',
  });
});

// ── Free public endpoint for website display ──────────────────────────────
app.get('/api/treasury/public', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const startDate = weekAgo.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];
    const observations = await fetchFRED(startDate, endDate);
    const latest = observations.filter(o => o.value !== '.').slice(-1)[0];
    if (!latest) return res.status(404).json({ error: 'No data available' });
    res.json({
      date: latest.date,
      yield_percent: parseFloat(latest.value),
      series: 'DGS30'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LastLook Data',
    description: '30-Year Treasury Yield API',
    version: '2.0.0',
    x402version: 2,
    endpoints: [
      'GET /api/treasury/current  — most recent yield ($0.01 USDC)',
      'GET /api/treasury/date?d=YYYY-MM-DD  — yield on a specific date ($0.01 USDC)',
    ],
  });
});

// ── Current yield ─────────────────────────────────────────────────────────
app.get('/api/treasury/current', async (req, res) => {
  try {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const startDate = weekAgo.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];
    const observations = await fetchFRED(startDate, endDate);
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
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ── Yield by date ─────────────────────────────────────────────────────────
app.get('/api/treasury/date', async (req, res) => {
  try {
    const { d } = req.query;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return res.status(400).json({
        error: 'Please provide a date in YYYY-MM-DD format, e.g. ?d=2026-05-01'
      });
    }
    const observations = await fetchFRED(d, d);
    const match = observations.find(o => o.value !== '.');
    if (!match) {
      return res.status(404).json({
        error: `No yield data for ${d}. FRED only publishes on business days.`
      });
    }
    res.json({
      service: 'LastLook Data',
      series: 'DGS30 - 30-Year Treasury Constant Maturity Rate',
      date: match.date,
      yield_percent: parseFloat(match.value),
      note: 'Source: Federal Reserve Bank of St. Louis (FRED)',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.listen(PORT, () => {
  console.log(`LastLook Data running on port ${PORT}`);
});