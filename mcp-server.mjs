import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import axios from 'axios';
import express from 'express';

function createMcpServer() {
const server = new McpServer({
  name: 'lastlook-data',
  version: '2.8.3',
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

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data MCP', version: '2.8.3' }));

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`LastLook Data MCP server running on port ${PORT}`));
} else {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
