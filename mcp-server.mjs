import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import axios from 'axios';
import express from 'express';

function createMcpServer() {
const server = new McpServer({
  name: 'lastlook-data',
  version: '2.12.0',
  description: 'LastLook Data — financial market data for AI agents. FRED macro data (Treasury yields, mortgage rates, benchmark rates, CPI, IORB, EFFR, energy prices), G10 FX rates, derived indicators. Pay per query via x402.'
});

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
  SAHMREALTIME: 'Real-Time Sahm Rule Recession Indicator',
  DCOILWTICO:   'WTI Crude Oil Price',
  DCOILBRENTEU: 'Brent Crude Oil Price',
  GASREGCOVW:   'US Regular Gasoline Price',
  DHHNGSP:      'Henry Hub Natural Gas Price',
};

const FX_LABELS = {
  EURUSD: 'Euro / US Dollar', GBPUSD: 'British Pound / US Dollar',
  USDJPY: 'US Dollar / Japanese Yen', USDCHF: 'US Dollar / Swiss Franc',
  USDCAD: 'US Dollar / Canadian Dollar', AUDUSD: 'Australian Dollar / US Dollar',
  NZDUSD: 'New Zealand Dollar / US Dollar', USDSEK: 'US Dollar / Swedish Krona',
  USDNOK: 'US Dollar / Norwegian Krone',
};

const SERIES_ENUM = [
  'DGS30','DGS10','DGS5','DGS2','DGS1MO',
  'MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST',
  'FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR',
  'CPIAUCSL','CPILFESL','UNRATE','GDP','SAHMREALTIME',
  'DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP',
];

const FX_ENUM = ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'];

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

const COIN_ENUM = Object.keys(COIN_IDS);

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

// ── Tool 1: Current 30yr Treasury yield (free) ────────────────────────────────
server.registerTool(
  'get_treasury_yield_current',
  {
    title: 'Get Current 30-Year Treasury Yield',
    description: 'Returns the most recent 30-year US Treasury constant maturity yield (DGS30) from FRED. Free — no payment required. For other series use get_current_value or get_series.',
    inputSchema: {},
    outputSchema: {
      yield_percent: z.string().describe('Current 30-year Treasury yield as a percentage'),
      date: z.string().describe('Date of the observation (YYYY-MM-DD)'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    try {
      const response = await axios.get('https://api.lastlookdata.com/api/treasury/public');
      const { yield_percent, date } = response.data;
      return {
        content: [{ type: 'text', text: `30-Year Treasury Yield (DGS30): ${yield_percent}% (as of ${date})\nSource: LastLook Data via FRED` }],
        structuredContent: { yield_percent, date },
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 2: 30yr yield by date ────────────────────────────────────────────────
server.registerTool(
  'get_treasury_yield_by_date',
  {
    title: 'Get 30-Year Treasury Yield by Date',
    description: 'Returns the 30-year US Treasury yield for a specific date. Business days only. Use YYYY-MM-DD format.',
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format e.g. 2026-05-09'),
    },
    outputSchema: {
      yield_percent: z.string().describe('30-year Treasury yield as a percentage'),
      date: z.string().describe('Date of the observation (YYYY-MM-DD)'),
    },
    annotations: READ_ONLY,
  },
  async ({ date }) => {
    try {
      const response = await axios.get(`https://api.lastlookdata.com/api/treasury/date?d=${date}`);
      const { yield_percent, date: dataDate } = response.data;
      return {
        content: [{ type: 'text', text: `30-Year Treasury Yield on ${dataDate}: ${yield_percent}%\nSource: LastLook Data via FRED` }],
        structuredContent: { yield_percent, date: dataDate },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: https://api.lastlookdata.com/api/treasury/date?d=${date}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 3: Current FRED value (cheapest — single value) ─────────────────────
server.registerTool(
  'get_current_value',
  {
    title: 'Get Current FRED Series Value',
    description:
      'Returns only the single most recent value for any supported FRED series. Cheaper than get_series ($0.01 vs $0.05). ' +
      'Use this when you need just the latest reading — e.g. current CPI, unemployment rate, mortgage rate. ' +
      'Use get_series instead when you need historical observations.',
    inputSchema: {
      series_id: z.enum(SERIES_ENUM).describe('FRED series ID e.g. CPIAUCSL, UNRATE, MORTGAGE30US, DGS10, DCOILWTICO, SAHMREALTIME'),
    },
    outputSchema: {
      series_id: z.string().describe('FRED series identifier'),
      label: z.string().describe('Human-readable series name'),
      value: z.string().describe('Most recent observed value'),
      date: z.string().describe('Date of the observation (YYYY-MM-DD)'),
    },
    annotations: READ_ONLY,
  },
  async ({ series_id }) => {
    const endpoint = `https://api.lastlookdata.com/api/current?id=${series_id}`;
    try {
      const response = await axios.get(endpoint);
      const { label, value, date } = response.data;
      return {
        content: [{ type: 'text', text: `${label} (${series_id}): ${value} (as of ${date})\nSource: LastLook Data via FRED` }],
        structuredContent: { series_id, label, value: String(value), date },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 4: FRED value by date ────────────────────────────────────────────────
server.registerTool(
  'get_value_by_date',
  {
    title: 'Get FRED Series Value by Date',
    description: 'Returns the value of any supported FRED series for a specific date. Business days only. Use YYYY-MM-DD format.',
    inputSchema: {
      series_id: z.enum(SERIES_ENUM).describe('FRED series ID'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format e.g. 2026-01-15'),
    },
    outputSchema: {
      series_id: z.string().describe('FRED series identifier'),
      label: z.string().describe('Human-readable series name'),
      value: z.string().describe('Observed value on the requested date'),
      date: z.string().describe('Date of the observation (YYYY-MM-DD)'),
    },
    annotations: READ_ONLY,
  },
  async ({ series_id, date }) => {
    const endpoint = `https://api.lastlookdata.com/api/date?id=${series_id}&d=${date}`;
    try {
      const response = await axios.get(endpoint);
      const { label, value, date: dataDate } = response.data;
      return {
        content: [{ type: 'text', text: `${label} (${series_id}) on ${dataDate}: ${value}\nSource: LastLook Data via FRED` }],
        structuredContent: { series_id, label, value: String(value), date: dataDate },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 5: FRED time series ──────────────────────────────────────────────────
server.registerTool(
  'get_series',
  {
    title: 'Get FRED Data Series',
    description:
      'Returns recent observations for any supported FRED data series. ' +
      'Use this to get current and historical values for mortgage rates, Treasury yields, Fed funds rate, CPI, SOFR, unemployment, GDP, energy prices, and more. ' +
      'Common use cases:\n' +
      '- Current 30-yr mortgage rate: series_id=MORTGAGE30US, days=30\n' +
      '- Current Fed funds rate: series_id=FEDFUNDS, days=30\n' +
      '- Current 10-yr Treasury yield: series_id=DGS10, days=30\n' +
      '- Current CPI (inflation): series_id=CPIAUCSL, days=30\n' +
      '- Current WTI crude oil: series_id=DCOILWTICO, days=30\n' +
      'The most recent observation in the returned array is the current value.',
    inputSchema: {
      series_id: z.enum(SERIES_ENUM).describe('FRED series ID. Use IORB for Interest on Reserve Balances, EFFR for Effective Fed Funds Rate, MORTGAGE30US for 30-yr mortgage rate, SAHMREALTIME for Sahm Rule, etc.'),
      days: z.enum(['30','90','365']).describe('History window: 30 ($0.05), 90 ($0.10), or 365 ($0.25). Use 30 for current/recent values.'),
    },
    outputSchema: {
      series_id: z.string().describe('FRED series identifier'),
      label: z.string().describe('Human-readable series name'),
      current_value: z.string().describe('Most recent observed value'),
      current_date: z.string().describe('Date of the most recent observation'),
      count: z.number().describe('Number of observations returned'),
      start: z.string().describe('Start date of the series window'),
      end: z.string().describe('End date of the series window'),
      observations: z.array(z.object({ date: z.string(), value: z.string() })).describe('All observations in the window'),
    },
    annotations: READ_ONLY,
  },
  async ({ series_id, days }) => {
    const prices = { '30': '$0.05', '90': '$0.10', '365': '$0.25' };
    const endpoint = `https://api.lastlookdata.com/api/series/${days}?id=${series_id}`;
    try {
      const response = await axios.get(endpoint);
      const { count, start, end, observations } = response.data;
      const label = SERIES_LABELS[series_id] || series_id;
      const latest = observations[observations.length - 1];
      const rows = observations.map(o => `  ${o.date}  ${o.value}`).join('\n');
      return {
        content: [{
          type: 'text',
          text:
            `${label} (${series_id})\n` +
            `Current value: ${latest.value} (as of ${latest.date})\n\n` +
            `Last ${days} days — ${count} observations (${start} to ${end})\n\n` +
            `Date        Value\n──────────  ─────\n${rows}\n\n` +
            `Source: LastLook Data via FRED`,
        }],
        structuredContent: {
          series_id,
          label,
          current_value: String(latest.value),
          current_date: latest.date,
          count,
          start,
          end,
          observations: observations.map(o => ({ date: o.date, value: String(o.value) })),
        },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: ${prices[days]} USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 6: Current FX rate ───────────────────────────────────────────────────
server.registerTool(
  'get_fx_rate_current',
  {
    title: 'Get Current G10 FX Rate',
    description: 'Returns the current exchange rate for a G10 currency pair. Source: European Central Bank. Supported: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK.',
    inputSchema: {
      pair: z.enum(FX_ENUM).describe('G10 currency pair e.g. EURUSD, USDJPY, GBPUSD'),
    },
    outputSchema: {
      pair: z.string().describe('Currency pair identifier'),
      label: z.string().describe('Human-readable pair name'),
      rate: z.string().describe('Current exchange rate'),
      date: z.string().describe('Date of the rate (YYYY-MM-DD)'),
    },
    annotations: READ_ONLY,
  },
  async ({ pair }) => {
    const endpoint = `https://api.lastlookdata.com/api/fx/current?pair=${pair}`;
    try {
      const response = await axios.get(endpoint);
      const { rate, date, label } = response.data;
      return {
        content: [{ type: 'text', text: `${label} (${pair}): ${rate} (as of ${date})\nSource: LastLook Data via ECB` }],
        structuredContent: { pair, label, rate: String(rate), date },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 7: FX rate by date ───────────────────────────────────────────────────
server.registerTool(
  'get_fx_rate_by_date',
  {
    title: 'Get G10 FX Rate by Date',
    description: 'Returns the exchange rate for a G10 currency pair on a specific date. Source: European Central Bank. Use YYYY-MM-DD format.',
    inputSchema: {
      pair: z.enum(FX_ENUM).describe('G10 currency pair e.g. EURUSD, USDJPY'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format e.g. 2026-01-15'),
    },
    outputSchema: {
      pair: z.string().describe('Currency pair identifier'),
      label: z.string().describe('Human-readable pair name'),
      rate: z.string().describe('Exchange rate on the requested date'),
      date: z.string().describe('Date of the rate (YYYY-MM-DD)'),
    },
    annotations: READ_ONLY,
  },
  async ({ pair, date }) => {
    const endpoint = `https://api.lastlookdata.com/api/fx/date?pair=${pair}&d=${date}`;
    try {
      const response = await axios.get(endpoint);
      const { rate, date: dataDate, label } = response.data;
      return {
        content: [{ type: 'text', text: `${label} (${pair}) on ${dataDate}: ${rate}\nSource: LastLook Data via ECB` }],
        structuredContent: { pair, label, rate: String(rate), date: dataDate },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 8: FX rate history ───────────────────────────────────────────────────
server.registerTool(
  'get_fx_rate_series',
  {
    title: 'Get G10 FX Rate History',
    description: 'Returns historical daily exchange rates for a G10 currency pair. Source: European Central Bank.',
    inputSchema: {
      pair: z.enum(FX_ENUM).describe('G10 currency pair e.g. EURUSD'),
      days: z.enum(['30','90','365']).describe('History window: 30 ($0.05), 90 ($0.10), or 365 ($0.25)'),
    },
    outputSchema: {
      pair: z.string().describe('Currency pair identifier'),
      label: z.string().describe('Human-readable pair name'),
      count: z.number().describe('Number of observations returned'),
      start: z.string().describe('Start date of the window'),
      end: z.string().describe('End date of the window'),
      observations: z.array(z.object({ date: z.string(), value: z.string() })).describe('Daily exchange rates'),
    },
    annotations: READ_ONLY,
  },
  async ({ pair, days }) => {
    const prices = { '30': '$0.05', '90': '$0.10', '365': '$0.25' };
    const endpoint = `https://api.lastlookdata.com/api/fx/series?pair=${pair}&days=${days}`;
    try {
      const response = await axios.get(endpoint);
      const { count, start, end, observations, label } = response.data;
      const rows = observations.map(o => `  ${o.date}  ${o.value}`).join('\n');
      return {
        content: [{
          type: 'text',
          text: `${label} (${pair}) — last ${days} days\n${count} observations from ${start} to ${end}\n\nDate        Rate\n──────────  ────\n${rows}\n\nSource: LastLook Data via ECB`,
        }],
        structuredContent: {
          pair,
          label,
          count,
          start,
          end,
          observations: observations.map(o => ({ date: o.date, value: String(o.value) })),
        },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: ${prices[days]} USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 9: Yield curve spreads ───────────────────────────────────────────────
server.registerTool(
  'get_yield_curve',
  {
    title: 'Get Yield Curve Spreads',
    description:
      'Returns 2s10s (2-year vs 10-year) and 3m10y (3-month vs 10-year) Treasury yield curve spreads with inversion signal. ' +
      'An inverted yield curve (negative spread) historically precedes recessions. Source: FRED.',
    inputSchema: {},
    outputSchema: {
      as_of: z.string().describe('Date of the most recent underlying data'),
      spread_2s10s: z.number().describe('10Y minus 2Y Treasury spread in percentage points'),
      spread_3m10y: z.number().describe('10Y minus 3-Month T-Bill spread in percentage points'),
      DGS2: z.number().describe('2-Year Treasury yield'),
      DGS10: z.number().describe('10-Year Treasury yield'),
      DGS1MO: z.number().describe('1-Month T-Bill rate'),
      inverted_2s10s: z.boolean().describe('Whether the 2s10s spread is negative (inverted)'),
      inverted_3m10y: z.boolean().describe('Whether the 3m10y spread is negative (inverted)'),
      signal: z.string().describe('Curve shape signal: Fully inverted, Partially inverted, or Normal'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/derived/yield-curve';
    try {
      const response = await axios.get(endpoint);
      const d = response.data;
      return {
        content: [{
          type: 'text',
          text:
            `Yield Curve Spreads (as of ${d.as_of})\n\n` +
            `2s10s spread: ${d.spreads['2s10s'].value}% (DGS10 ${d.components.DGS10}% − DGS2 ${d.components.DGS2}%)\n` +
            `3m10y spread: ${d.spreads['3m10y'].value}% (DGS10 ${d.components.DGS10}% − DGS1MO ${d.components.DGS1MO}%)\n` +
            `Signal: ${d.signal}\n\n` +
            `Source: LastLook Data via FRED`,
        }],
        structuredContent: {
          as_of: d.as_of,
          spread_2s10s: d.spreads['2s10s'].value,
          spread_3m10y: d.spreads['3m10y'].value,
          DGS2: d.components.DGS2,
          DGS10: d.components.DGS10,
          DGS1MO: d.components.DGS1MO,
          inverted_2s10s: d.spreads['2s10s'].inverted,
          inverted_3m10y: d.spreads['3m10y'].inverted,
          signal: d.signal,
        },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.03 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 10: Sahm Rule recession indicator ────────────────────────────────────
server.registerTool(
  'get_recession_indicator',
  {
    title: 'Get Sahm Rule Recession Indicator',
    description:
      'Returns the real-time Sahm Rule recession indicator. A value >= 0.50 signals a recession is likely underway. ' +
      'Measures the rise in unemployment from its recent low. Source: FRED SAHMREALTIME.',
    inputSchema: {},
    outputSchema: {
      as_of: z.string().describe('Date of the most recent observation'),
      value: z.number().describe('Sahm Rule indicator value'),
      threshold: z.number().describe('Trigger threshold (0.50)'),
      triggered: z.boolean().describe('True if value >= 0.50 (recession signal active)'),
      signal: z.string().describe('Human-readable signal description'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/derived/recession';
    try {
      const response = await axios.get(endpoint);
      const d = response.data;
      return {
        content: [{
          type: 'text',
          text:
            `Sahm Rule Recession Indicator (as of ${d.as_of})\n\n` +
            `Value: ${d.sahm_rule.value}\n` +
            `Triggered: ${d.sahm_rule.triggered} (threshold: 0.50)\n` +
            `Signal: ${d.sahm_rule.signal}\n\n` +
            `Source: LastLook Data via FRED`,
        }],
        structuredContent: {
          as_of: d.as_of,
          value: d.sahm_rule.value,
          threshold: d.sahm_rule.threshold,
          triggered: d.sahm_rule.triggered,
          signal: d.sahm_rule.signal,
        },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.02 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 11: Fed policy spread ────────────────────────────────────────────────
server.registerTool(
  'get_policy_spread',
  {
    title: 'Get Fed Policy Spread (EFFR vs IORB)',
    description:
      'Returns the spread between the Effective Federal Funds Rate (EFFR) and Interest on Reserve Balances (IORB), ' +
      'with an interpretation of Fed policy stance. EFFR below IORB is the normal operating band. Source: FRED.',
    inputSchema: {},
    outputSchema: {
      as_of: z.string().describe('Date of the most recent data'),
      effr: z.number().describe('Effective Federal Funds Rate (%)'),
      iorb: z.number().describe('Interest on Reserve Balances (%)'),
      spread: z.number().describe('EFFR minus IORB spread in percentage points'),
      interpretation: z.string().describe('Policy stance interpretation'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/derived/policy-spread';
    try {
      const response = await axios.get(endpoint);
      const d = response.data;
      return {
        content: [{
          type: 'text',
          text:
            `Fed Policy Spread (as of ${d.as_of})\n\n` +
            `EFFR: ${d.effr}%\n` +
            `IORB: ${d.iorb}%\n` +
            `Spread (EFFR − IORB): ${d.spread}%\n` +
            `Interpretation: ${d.interpretation}\n\n` +
            `Source: LastLook Data via FRED`,
        }],
        structuredContent: {
          as_of: d.as_of,
          effr: d.effr,
          iorb: d.iorb,
          spread: d.spread,
          interpretation: d.interpretation,
        },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.02 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 12: Economic calendar ────────────────────────────────────────────────
server.registerTool(
  'get_economic_calendar',
  {
    title: 'Get Economic Calendar',
    description:
      'Returns upcoming FRED economic data release dates — CPI, jobs report, GDP, Treasury rates, and more. ' +
      'Use this to find out when the next major economic data will be published.',
    inputSchema: {
      days: z.enum(['30','60','90']).describe('Lookahead window in days: 30, 60, or 90'),
    },
    outputSchema: {
      calendar_start: z.string().describe('Start date of the calendar window'),
      calendar_end: z.string().describe('End date of the calendar window'),
      count: z.number().describe('Number of scheduled releases'),
      releases: z.array(z.object({
        date: z.string().describe('Release date (YYYY-MM-DD)'),
        release_id: z.number().describe('FRED release identifier'),
        release_name: z.string().describe('Name of the economic release'),
      })).describe('Scheduled FRED economic data releases'),
    },
    annotations: READ_ONLY,
  },
  async ({ days }) => {
    const endpoint = `https://api.lastlookdata.com/api/calendar?days=${days}`;
    try {
      const response = await axios.get(endpoint);
      const { releases, count, calendar_start, calendar_end } = response.data;
      const rows = releases.map(r => `  ${r.date}  ${r.release_name}`).join('\n');
      return {
        content: [{
          type: 'text',
          text: `Upcoming FRED Releases (next ${days} days) — ${count} events\n\nDate        Release\n──────────  ───────\n${rows}\n\nSource: LastLook Data via FRED`,
        }],
        structuredContent: { calendar_start, calendar_end, count, releases },
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.02 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 13: Refi Signal Bundle ───────────────────────────────────────────────
server.registerTool(
  'get_bundle_refi_signal',
  {
    title: 'Get Refinance Signal Bundle',
    description:
      'Returns a refinance signal bundle: current 30yr and 15yr mortgage rates, 52-week high/low range, ' +
      'MBS spread over 10Y Treasury, 30-day and 90-day rate trend, and a refi break-even threshold. ' +
      'The refi_breakeven_threshold field directly answers "what rate does a borrower need to have to benefit from refinancing today?" ' +
      'Priced at $0.60 USDC via x402 on Base.',
    inputSchema: {},
    outputSchema: {
      as_of:   z.string().describe('Date of the most recent underlying data'),
      bundle:  z.string().describe('Bundle identifier: refi_signal'),
      series:  z.record(z.string(), z.number().nullable()).describe('MORTGAGE30US, MORTGAGE15US, DGS10, FEDFUNDS'),
      derived: z.record(z.string(), z.any()).describe('mbs_spread, week52_high, week52_low, week52_position_pct, refi_breakeven_threshold'),
      signals: z.record(z.string(), z.string().nullable()).describe('rate_trend_30d, rate_trend_90d, rate_vs_52wk, refi_environment'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/bundle/refi-signal';
    try {
      const { data: d } = await axios.get(endpoint);
      const summary = `Refi Signal (${d.as_of}): 30yr rate ${d.series?.MORTGAGE30US}%, 52wk range ${d.derived?.week52_low}–${d.derived?.week52_high}%. Refi break-even threshold: ${d.derived?.refi_breakeven_threshold}%. Environment: ${d.signals?.refi_environment}. Trend (30d): ${d.signals?.rate_trend_30d}.`;
      return {
        content: [{ type: 'text', text: summary + '\n\nSource: LastLook Data via FRED' }],
        structuredContent: { as_of: d.as_of, bundle: d.bundle, series: d.series, derived: d.derived, signals: d.signals },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.60 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 14: Purchase Market Bundle ──────────────────────────────────────────
server.registerTool(
  'get_bundle_purchase_market',
  {
    title: 'Get Home Purchase Market Bundle',
    description:
      'Returns a home purchase market bundle: current 30yr mortgage rate, median US home sale price (MSPUS), ' +
      'estimated monthly P&I payment on the median home assuming 20% down, annual income required to qualify at 28% DTI, ' +
      'affordability level signal, and housing starts. Directly answers "can my client afford a home today?" ' +
      'Priced at $0.60 USDC via x402 on Base.',
    inputSchema: {},
    outputSchema: {
      as_of:   z.string().describe('Date of the most recent underlying data'),
      bundle:  z.string().describe('Bundle identifier: purchase_market'),
      series:  z.record(z.string(), z.number().nullable()).describe('MORTGAGE30US, MSPUS, HOUST, FEDFUNDS'),
      derived: z.record(z.string(), z.any()).describe('loan_amount, monthly_payment_estimate, income_required_28pct, home_price_change_qoq'),
      signals: z.record(z.string(), z.string().nullable()).describe('affordability_level (elevated/moderate/accessible), market_activity (strong/moderate/subdued)'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/bundle/purchase-market';
    try {
      const { data: d } = await axios.get(endpoint);
      const summary = `Purchase Market (${d.as_of}): 30yr rate ${d.series?.MORTGAGE30US}%, median home $${d.series?.MSPUS?.toLocaleString()}. Monthly P&I on median home: $${d.derived?.monthly_payment_estimate?.toLocaleString()}. Income required (28% DTI): $${d.derived?.income_required_28pct?.toLocaleString()}/yr. Affordability: ${d.signals?.affordability_level}.`;
      return {
        content: [{ type: 'text', text: summary + '\n\nSource: LastLook Data via FRED' }],
        structuredContent: { as_of: d.as_of, bundle: d.bundle, series: d.series, derived: d.derived, signals: d.signals },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.60 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 15: Rate Environment Bundle ─────────────────────────────────────────
server.registerTool(
  'get_bundle_rate_environment',
  {
    title: 'Get Rate Environment Snapshot Bundle',
    description:
      'Returns a complete rate environment snapshot in one call: FEDFUNDS, SOFR, DGS2, DGS5, DGS10, DGS30, ' +
      'plus computed yield curve spreads (2s10s and 3m10y), Fed policy spread (EFFR vs IORB), and curve shape signal. ' +
      'Use this instead of multiple individual calls when you need the full rate picture.',
    inputSchema: {},
    outputSchema: {
      as_of:   z.string().describe('Date of the most recent underlying data'),
      bundle:  z.string().describe('Bundle identifier'),
      series:  z.record(z.string(), z.number().nullable()).describe('Current values for each rate series'),
      derived: z.record(z.string(), z.any()).describe('Computed spread and policy fields'),
      signals: z.record(z.string(), z.string()).describe('Curve shape and policy stance signals'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/bundle/rate-environment';
    try {
      const { data: d } = await axios.get(endpoint);
      const lines = [
        `Rate Environment Snapshot (as of ${d.as_of})`,
        '',
        'Rates:',
        ...Object.entries(d.series).filter(([,v]) => v !== null).map(([k, v]) => `  ${k}: ${v}%`),
        '',
        'Derived:',
        `  2s10s spread: ${d.derived.spread_2s10s}% (${d.derived.spread_2s10s_label})`,
        d.derived.spread_3m10y !== null ? `  3m10y spread: ${d.derived.spread_3m10y}%` : null,
        d.derived.policy_spread !== null ? `  Policy spread: ${d.derived.policy_spread}%` : null,
        '',
        `Signals: ${d.signals.curve_shape} | ${d.signals.policy_stance}`,
        '',
        'Source: LastLook Data via FRED',
      ].filter(x => x !== null);
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: { as_of: d.as_of, bundle: d.bundle, series: d.series, derived: d.derived, signals: d.signals },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.35 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 16: Mortgage Market Pulse Bundle ────────────────────────────────────
server.registerTool(
  'get_bundle_mortgage_pulse',
  {
    title: 'Get Mortgage Market Pulse Bundle',
    description:
      'Returns a complete mortgage market snapshot: 30yr and 15yr mortgage rates, 10Y Treasury yield, ' +
      'Fed funds rate, median home price (MSPUS), housing starts (HOUST), MBS spread (30yr mortgage minus 10Y), ' +
      'and 30-day rate trend signal. Use this for mortgage market analysis.',
    inputSchema: {},
    outputSchema: {
      as_of:   z.string().describe('Date of the most recent underlying data'),
      bundle:  z.string().describe('Bundle identifier'),
      series:  z.record(z.string(), z.number().nullable()).describe('Current values for each series'),
      derived: z.record(z.string(), z.any()).describe('MBS spread and related computed fields'),
      signals: z.record(z.string(), z.string()).describe('Rate trend signal'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/bundle/mortgage-pulse';
    try {
      const { data: d } = await axios.get(endpoint);
      const lines = [
        `Mortgage Market Pulse (as of ${d.as_of})`,
        '',
        'Rates:',
        d.series.MORTGAGE30US !== null ? `  30yr mortgage: ${d.series.MORTGAGE30US}%` : null,
        d.series.MORTGAGE15US !== null ? `  15yr mortgage: ${d.series.MORTGAGE15US}%` : null,
        d.series.DGS10 !== null ? `  10Y Treasury: ${d.series.DGS10}%` : null,
        d.series.FEDFUNDS !== null ? `  Fed Funds: ${d.series.FEDFUNDS}%` : null,
        '',
        'Housing:',
        d.series.MSPUS !== null ? `  Median home price: $${d.series.MSPUS?.toLocaleString()}` : null,
        d.series.HOUST !== null ? `  Housing starts: ${d.series.HOUST}K` : null,
        '',
        `MBS Spread: ${d.derived.mbs_spread}% (${d.derived.mbs_spread_label})`,
        `Rate trend (30d): ${d.signals.rate_trend_30d}`,
        '',
        'Source: LastLook Data via FRED',
      ].filter(x => x !== null);
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: { as_of: d.as_of, bundle: d.bundle, series: d.series, derived: d.derived, signals: d.signals },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.40 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 17: Macro Health Bundle ─────────────────────────────────────────────
server.registerTool(
  'get_bundle_macro',
  {
    title: 'Get Macro Health Snapshot Bundle',
    description:
      'Returns a macro health snapshot: GDP, unemployment rate (UNRATE), CPI and core CPI, Fed funds rate, ' +
      'yield curve 2s10s spread, and Sahm Rule recession indicator. ' +
      'Includes a cycle phase signal (expansion/late cycle/peak/contraction). ' +
      'Use this for macroeconomic context or recession risk assessment.',
    inputSchema: {},
    outputSchema: {
      as_of:   z.string().describe('Date of the most recent underlying data'),
      bundle:  z.string().describe('Bundle identifier'),
      series:  z.record(z.string(), z.number().nullable()).describe('Current values for each macro series'),
      derived: z.record(z.string(), z.any()).describe('Sahm Rule value and yield curve spread'),
      signals: z.record(z.string(), z.any()).describe('Cycle phase and recession triggered flag'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/bundle/macro';
    try {
      const { data: d } = await axios.get(endpoint);
      const lines = [
        `Macro Health Snapshot (as of ${d.as_of})`,
        '',
        d.series.GDP !== null ? `GDP: ${d.series.GDP}` : null,
        `Unemployment: ${d.series.UNRATE}%`,
        d.series.CPIAUCSL !== null ? `CPI: ${d.series.CPIAUCSL}` : null,
        d.series.CPILFESL !== null ? `Core CPI: ${d.series.CPILFESL}` : null,
        d.series.FEDFUNDS !== null ? `Fed Funds: ${d.series.FEDFUNDS}%` : null,
        '',
        `Sahm Rule: ${d.derived.sahm_rule} (threshold: 0.50)`,
        d.derived.spread_2s10s !== null ? `2s10s spread: ${d.derived.spread_2s10s}%` : null,
        '',
        `Cycle phase: ${d.signals.cycle_phase}`,
        `Recession triggered: ${d.signals.recession_triggered}`,
        '',
        'Source: LastLook Data via FRED',
      ].filter(x => x !== null);
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: { as_of: d.as_of, bundle: d.bundle, series: d.series, derived: d.derived, signals: d.signals },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.50 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 18: G10 FX Dashboard Bundle ─────────────────────────────────────────
server.registerTool(
  'get_bundle_fx_dashboard',
  {
    title: 'Get G10 FX Dashboard Bundle',
    description:
      'Returns all 9 G10 FX spot rates in one call: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK. ' +
      'Also includes a USD strength index (average % change vs G10 basket over 30 days) and a USD trend signal. ' +
      'Source: European Central Bank via Frankfurter.',
    inputSchema: {},
    outputSchema: {
      as_of:   z.string().describe('Date of the FX rates'),
      bundle:  z.string().describe('Bundle identifier'),
      series:  z.record(z.string(), z.number()).describe('All 9 G10 FX spot rates'),
      derived: z.record(z.string(), z.any()).describe('USD strength index vs G10 basket'),
      signals: z.record(z.string(), z.string()).describe('USD trend over 30 days'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/bundle/fx-dashboard';
    try {
      const { data: d } = await axios.get(endpoint);
      const rows = Object.entries(d.series).map(([pair, rate]) => `  ${pair}: ${rate}`).join('\n');
      const text =
        `G10 FX Dashboard (as of ${d.as_of})\n\n${rows}\n\n` +
        `USD Strength Index (30d): ${d.derived.usd_strength_index > 0 ? '+' : ''}${d.derived.usd_strength_index}%\n` +
        `USD Trend: ${d.signals.usd_trend_30d}\n\n` +
        `Source: LastLook Data via ECB`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: { as_of: d.as_of, bundle: d.bundle, series: d.series, derived: d.derived, signals: d.signals },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.35 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 19: Energy & Commodities Bundle ─────────────────────────────────────
server.registerTool(
  'get_bundle_energy',
  {
    title: 'Get Energy & Commodities Bundle',
    description:
      'Returns current energy commodity prices in one call: WTI crude oil (DCOILWTICO), Brent crude (DCOILBRENTEU), ' +
      'US regular gasoline (GASREGCOVW), and Henry Hub natural gas (DHHNGSP). ' +
      'Includes the WTI-Brent spread and a market signal. Source: FRED.',
    inputSchema: {},
    outputSchema: {
      as_of:   z.string().describe('Date of the most recent underlying data'),
      bundle:  z.string().describe('Bundle identifier'),
      series:  z.record(z.string(), z.number().nullable()).describe('Current values for each energy series'),
      derived: z.record(z.string(), z.any()).describe('WTI-Brent spread'),
      signals: z.record(z.string(), z.string()).describe('WTI-Brent market signal'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/bundle/energy';
    try {
      const { data: d } = await axios.get(endpoint);
      const text =
        `Energy & Commodities (as of ${d.as_of})\n\n` +
        `WTI Crude:     $${d.series.DCOILWTICO}/bbl\n` +
        `Brent Crude:   $${d.series.DCOILBRENTEU}/bbl\n` +
        (d.series.GASREGCOVW !== null ? `US Gasoline:   $${d.series.GASREGCOVW}/gal\n` : '') +
        (d.series.DHHNGSP !== null    ? `Natural Gas:   $${d.series.DHHNGSP}/MMBtu\n` : '') +
        `\nWTI-Brent Spread: $${d.derived.wti_brent_spread}/bbl\n` +
        `Signal: ${d.signals.wti_brent_signal}\n\n` +
        `Source: LastLook Data via FRED`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: { as_of: d.as_of, bundle: d.bundle, series: d.series, derived: d.derived, signals: d.signals },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.25 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 20: Economic Context Brief Bundle ────────────────────────────────────
server.registerTool(
  'get_bundle_context_brief',
  {
    title: 'Get Economic Context Brief Bundle',
    description:
      'Returns a pre-formatted natural-language paragraph summarizing 15+ economic indicators — rates, inflation, ' +
      'employment, mortgage market, energy prices, and FX. The "brief" field is ready to inject directly into an LLM prompt ' +
      'as economic context. Also returns structured series, FX, derived, and signals fields.',
    inputSchema: {},
    outputSchema: {
      as_of:   z.string().describe('Date of the most recent underlying data'),
      bundle:  z.string().describe('Bundle identifier'),
      brief:   z.string().describe('Pre-formatted natural-language economic context paragraph'),
      series:  z.record(z.string(), z.number().nullable()).describe('Current values for all FRED series in the brief'),
      fx:      z.record(z.string(), z.number().nullable()).describe('Current FX rates included in the brief'),
      derived: z.record(z.string(), z.any()).describe('Computed fields (spreads, Sahm Rule, etc.)'),
      signals: z.record(z.string(), z.any()).describe('Curve shape and recession signals'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/bundle/context-brief';
    try {
      const { data: d } = await axios.get(endpoint);
      return {
        content: [{ type: 'text', text: d.brief + '\n\nSource: LastLook Data via FRED and ECB' }],
        structuredContent: { as_of: d.as_of, bundle: d.bundle, brief: d.brief, series: d.series, fx: d.fx, derived: d.derived, signals: d.signals },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.75 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 21: Crypto — current price ──────────────────────────────────────────
server.registerTool(
  'get_crypto_price',
  {
    title: 'Get Current Crypto Price',
    description:
      'Returns the current USD price, 24h % change, market cap, and 24h volume for any supported cryptocurrency. ' +
      'Supported: BTC, ETH, SOL, BNB, XRP, USDT, USDC, ADA, AVAX, DOGE, DOT, MATIC, LINK, LTC, ATOM, UNI, SUI, APT, NEAR, PEPE. ' +
      'Source: CoinGecko. Priced at $0.02 USDC via x402 on Base.',
    inputSchema: {
      coin: z.enum(COIN_ENUM).describe('Crypto symbol e.g. BTC, ETH, SOL, DOGE'),
    },
    outputSchema: {
      symbol:           z.string().describe('Crypto symbol'),
      name:             z.string().describe('Full name'),
      price_usd:        z.number().describe('Current price in USD'),
      change_24h_pct:   z.number().describe('24-hour price change %'),
      market_cap_usd:   z.number().nullable().describe('Market cap in USD'),
      volume_24h_usd:   z.number().nullable().describe('24-hour trading volume in USD'),
      as_of:            z.string().describe('ISO timestamp of the data fetch'),
    },
    annotations: READ_ONLY,
  },
  async ({ coin }) => {
    const endpoint = `https://api.lastlookdata.com/api/crypto/price?coin=${coin}`;
    try {
      const { data: d } = await axios.get(endpoint);
      const text =
        `${d.name} (${d.symbol}): $${d.price_usd?.toLocaleString()} USD\n` +
        `24h change: ${d.change_24h_pct > 0 ? '+' : ''}${d.change_24h_pct}%\n` +
        `Market cap: $${d.market_cap_usd?.toLocaleString()}\n` +
        `Volume (24h): $${d.volume_24h_usd?.toLocaleString()}\n` +
        `As of: ${d.as_of}\nSource: LastLook Data via CoinGecko`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          symbol: d.symbol, name: d.name,
          price_usd: d.price_usd, change_24h_pct: d.change_24h_pct,
          market_cap_usd: d.market_cap_usd, volume_24h_usd: d.volume_24h_usd,
          as_of: d.as_of,
        },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.02 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 22: Crypto — historical prices ──────────────────────────────────────
server.registerTool(
  'get_crypto_history',
  {
    title: 'Get Crypto Historical Prices',
    description:
      'Returns historical daily closing prices for any supported cryptocurrency over 30, 90, or 365 days. ' +
      'Use for trend analysis, drawdown calculation, or training data. Source: CoinGecko. Priced at $0.15 USDC via x402.',
    inputSchema: {
      coin: z.enum(COIN_ENUM).describe('Crypto symbol e.g. BTC, ETH, SOL'),
      days: z.enum(['30','90','365']).describe('History window: 30 ($0.15), 90 ($0.15), or 365 ($0.15) days'),
    },
    outputSchema: {
      symbol:       z.string().describe('Crypto symbol'),
      name:         z.string().describe('Full coin name'),
      days:         z.number().describe('Number of days requested'),
      count:        z.number().describe('Number of data points returned'),
      start:        z.string().describe('Start date (YYYY-MM-DD)'),
      end:          z.string().describe('End date (YYYY-MM-DD)'),
      observations: z.array(z.object({ date: z.string(), price_usd: z.number() })).describe('Daily price observations'),
    },
    annotations: READ_ONLY,
  },
  async ({ coin, days }) => {
    const endpoint = `https://api.lastlookdata.com/api/crypto/history?coin=${coin}&days=${days}`;
    try {
      const { data: d } = await axios.get(endpoint);
      const latest = d.observations[d.observations.length - 1];
      const first  = d.observations[0];
      const pctChg = first?.price_usd ? parseFloat(((latest.price_usd - first.price_usd) / first.price_usd * 100).toFixed(2)) : null;
      const rows = d.observations.map(o => `  ${o.date}  $${o.price_usd.toLocaleString()}`).join('\n');
      const text =
        `${d.name} (${d.symbol}) — last ${days} days\n` +
        `${d.count} observations from ${d.start} to ${d.end}\n` +
        (pctChg !== null ? `Period change: ${pctChg > 0 ? '+' : ''}${pctChg}%\n` : '') +
        `\nDate        Price (USD)\n──────────  ──────────\n${rows}\n\nSource: LastLook Data via CoinGecko`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          symbol: d.symbol, name: d.name, days: d.days,
          count: d.count, start: d.start, end: d.end,
          observations: d.observations,
        },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.15 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 23: Bundle — Crypto Top 20 ──────────────────────────────────────────
server.registerTool(
  'get_bundle_crypto',
  {
    title: 'Get Crypto Top 20 Bundle',
    description:
      'Returns the top 20 cryptocurrencies by market cap in one call: price, 24h change, 7d change, market cap, and volume. ' +
      'Covers BTC, ETH, SOL, BNB, XRP, USDT, USDC, ADA, AVAX, DOGE, and more. ' +
      'Use this instead of individual get_crypto_price calls when you need broad market coverage. ' +
      'Source: CoinGecko. Priced at $0.50 USDC via x402 on Base.',
    inputSchema: {},
    outputSchema: {
      bundle:  z.string().describe('Bundle identifier: crypto'),
      as_of:   z.string().describe('ISO timestamp of the data fetch'),
      count:   z.number().describe('Number of coins returned'),
      coins:   z.array(z.object({
        rank:            z.number().describe('Market cap rank'),
        symbol:          z.string().describe('Ticker symbol'),
        name:            z.string().describe('Full name'),
        price_usd:       z.number().describe('Current price in USD'),
        change_24h_pct:  z.number().nullable().describe('24h price change %'),
        change_7d_pct:   z.number().nullable().describe('7d price change %'),
        market_cap_usd:  z.number().nullable().describe('Market cap in USD'),
        volume_24h_usd:  z.number().nullable().describe('24h volume in USD'),
      })).describe('Top 20 coins by market cap'),
    },
    annotations: READ_ONLY,
  },
  async () => {
    const endpoint = 'https://api.lastlookdata.com/api/bundle/crypto';
    try {
      const { data: d } = await axios.get(endpoint);
      const rows = d.coins.map(c =>
        `  ${String(c.rank).padStart(2)}. ${c.symbol.padEnd(6)} $${c.price_usd?.toLocaleString().padStart(14)}  ${(c.change_24h_pct != null ? (c.change_24h_pct >= 0 ? '+' : '') + c.change_24h_pct.toFixed(2) + '%' : 'N/A').padStart(8)}  MCap: $${(c.market_cap_usd / 1e9).toFixed(1)}B`
      ).join('\n');
      const text =
        `Crypto Market — Top 20 by Market Cap\n` +
        `As of: ${d.as_of}\n\n` +
        `Rank  Symbol  Price (USD)       24h Chg    Market Cap\n` +
        `─────────────────────────────────────────────────────\n` +
        `${rows}\n\nSource: LastLook Data via CoinGecko`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: { bundle: d.bundle, as_of: d.as_of, count: d.count, coins: d.coins },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.50 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 24: EDGAR — company fundamentals ────────────────────────────────────
server.registerTool(
  'get_edgar_company',
  {
    title: 'Get Company Fundamentals (SEC EDGAR)',
    description:
      'Returns financial fundamentals for any US public company from SEC EDGAR XBRL filings: ' +
      'revenue, net income, total assets, stockholders equity, and EPS. ' +
      'Includes both annual (10-K) and quarterly (10-Q) data for the most recent periods. ' +
      'Works for any ticker listed on a US exchange (AAPL, MSFT, TSLA, AMZN, NVDA, GOOGL, META, JPM, BAC, etc.). ' +
      'Source: SEC EDGAR. Priced at $0.75 USDC via x402 on Base.',
    inputSchema: {
      ticker: z.string().min(1).max(5).describe('Stock ticker symbol e.g. AAPL, MSFT, TSLA, AMZN, NVDA, GOOGL'),
    },
    outputSchema: {
      ticker:        z.string().describe('Ticker symbol'),
      company_name:  z.string().describe('Company legal name'),
      cik:           z.string().describe('SEC Central Index Key'),
      fundamentals:  z.record(z.string(), z.any()).describe('Financial data: revenue, net_income, total_assets, stockholders_equity, eps_basic'),
      as_of:         z.string().describe('Date the data was fetched'),
      edgar_url:     z.string().describe('EDGAR filing browser URL for this company'),
    },
    annotations: READ_ONLY,
  },
  async ({ ticker }) => {
    const endpoint = `https://api.lastlookdata.com/api/edgar/company?ticker=${ticker.toUpperCase()}`;
    try {
      const { data: d } = await axios.get(endpoint);
      const fmt = (v) => v != null ? `$${(v / 1e9).toFixed(2)}B` : 'N/A';
      const fmtPeriod = (arr) => arr?.length ? `${arr[0].period_end} → ${fmt(arr[0].value)}` : 'N/A';
      const lines = [
        `${d.company_name} (${d.ticker})  |  CIK: ${d.cik}`,
        `As of: ${d.as_of}  |  Source: SEC EDGAR`,
        '',
        'Annual Fundamentals (most recent 10-K):',
        `  Revenue:             ${fmtPeriod(d.fundamentals?.revenue?.annual)}`,
        `  Net Income:          ${fmtPeriod(d.fundamentals?.net_income?.annual)}`,
        `  Total Assets:        ${fmtPeriod(d.fundamentals?.total_assets?.annual)}`,
        `  Stockholders Equity: ${fmtPeriod(d.fundamentals?.stockholders_equity?.annual)}`,
        d.fundamentals?.eps_basic?.annual?.length
          ? `  EPS Basic:           ${d.fundamentals.eps_basic.annual[0].period_end} → $${d.fundamentals.eps_basic.annual[0].value}`
          : null,
        '',
        `EDGAR filings: ${d.edgar_url}`,
      ].filter(x => x !== null);
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          ticker: d.ticker, company_name: d.company_name, cik: d.cik,
          fundamentals: d.fundamentals, as_of: d.as_of, edgar_url: d.edgar_url,
        },
      };
    } catch (err) {
      if (err.response?.status === 402) return { content: [{ type: 'text', text: `Payment required: $0.75 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      if (err.response?.status === 404) return { content: [{ type: 'text', text: `Company not found for ticker "${ticker}". Verify it is a US-listed public company.` }], isError: true };
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

  return server;
}

// ── Transport ─────────────────────────────────────────────────────────────────
const isHTTP = process.env.MCP_TRANSPORT === 'http';

if (isHTTP) {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (req, res) => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data MCP', version: '2.12.0' }));

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`LastLook Data MCP server running on port ${PORT}`));
} else {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
