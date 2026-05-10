require('dotenv').config();
const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 3600 }); // cache responses for 1 hour

const PORT = process.env.PORT || 3000;
const FRED_API_KEY = process.env.FRED_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PRICE_PER_QUERY = process.env.PRICE_PER_QUERY || '0.01'; // $0.01 USDC default

// ── Helper: fetch from FRED ───────────────────────────────────────────────────
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

// ── Route: current / most recent yield ───────────────────────────────────────
app.get('/api/treasury/current', async (req, res) => {
  try {
    // Fetch last 7 days to account for weekends/holidays
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);

    const startDate = weekAgo.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];

    const observations = await fetchFRED(startDate, endDate);

    // Get the most recent non-null value
    const latest = observations
      .filter(o => o.value !== '.')
      .slice(-1)[0];

    if (!latest) {
      return res.status(404).json({ error: 'No data available' });
    }

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

// ── Route: yield on a specific date ──────────────────────────────────────────
// Usage: /api/treasury/date?d=2026-05-01
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

// ── Health check (free, no payment required) ─────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LastLook Data',
    description: '30-Year Treasury Yield API',
    endpoints: [
      'GET /api/treasury/current  — most recent yield ($0.01 USDC)',
      'GET /api/treasury/date?d=YYYY-MM-DD  — yield on a specific date ($0.01 USDC)',
    ],
  });
});

app.listen(PORT, () => {
  console.log(`LastLook Data running on port ${PORT}`);
});