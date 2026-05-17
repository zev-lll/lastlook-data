import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import axios from 'axios';
import express from 'express';

const server = new McpServer({
  name: 'lastlook-data',
  version: '2.8.3',
  description: 'LastLook Data — financial market data for AI agents. FRED macro data (Treasury yields, mortgage rates, benchmark rates, CPI, IORB, EFFR, energy prices), G10 FX rates. Pay per query via x402.'
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

// ── Tool 1: Current 30yr Treasury yield ──────────────────────────────────────
server.registerTool(
  'get_treasury_yield_current',
  {
    title: 'Get Current 30-Year Treasury Yield',
    description: 'Returns the most recent 30-year US Treasury constant maturity yield (DGS30) from FRED. Use this specifically for the 30-year Treasury rate. For other series use get_series instead.',
    inputSchema: {}
  },
  async () => {
    try {
      const response = await axios.get('https://api.lastlookdata.com/api/treasury/public');
      const { yield_percent, date } = response.data;
      return {
        content: [{ type: 'text', text: `30-Year Treasury Yield (DGS30): ${yield_percent}% (as of ${date})\nSource: LastLook Data via FRED` }]
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 2: Yield by date ─────────────────────────────────────────────────────
server.registerTool(
  'get_treasury_yield_by_date',
  {
    title: 'Get 30-Year Treasury Yield by Date',
    description: 'Returns the 30-year US Treasury yield for a specific date. Business days only. Use YYYY-MM-DD format.',
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format e.g. 2026-05-09')
    }
  },
  async ({ date }) => {
    try {
      const response = await axios.get(`https://api.lastlookdata.com/api/treasury/date?d=${date}`);
      const { yield_percent, date: dataDate } = response.data;
      return {
        content: [{ type: 'text', text: `30-Year Treasury Yield on ${dataDate}: ${yield_percent}%\nSource: LastLook Data via FRED` }]
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: https://api.lastlookdata.com/api/treasury/date?d=${date}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 3: FRED time series ──────────────────────────────────────────────────
server.registerTool(
  'get_series',
  {
    title: 'Get FRED Data Series',
    description:
      'Returns recent observations for any supported FRED data series. ' +
      'Use this to get current and historical values for mortgage rates, Treasury yields, Fed funds rate, CPI, SOFR, unemployment, GDP, energy prices, and more. ' +
      'Common use cases:\n' +
      '- Current 30-yr mortgage rate: series_id=MORTGAGE30US, days=30\n' +
      '- Current 15-yr mortgage rate: series_id=MORTGAGE15US, days=30\n' +
      '- Current Fed funds rate: series_id=FEDFUNDS, days=30\n' +
      '- Current IORB (Interest on Reserve Balances): series_id=IORB, days=30\n' +
      '- Current EFFR (Effective Fed Funds Rate): series_id=EFFR, days=30\n' +
      '- Current 10-yr Treasury yield: series_id=DGS10, days=30\n' +
      '- Current CPI (inflation): series_id=CPIAUCSL, days=30\n' +
      '- Current unemployment rate: series_id=UNRATE, days=30\n' +
      '- Current WTI crude oil price: series_id=DCOILWTICO, days=30\n' +
      '- Current Brent crude price: series_id=DCOILBRENTEU, days=30\n' +
      '- Current natural gas price: series_id=DHHNGSP, days=30\n' +
      '- Current gasoline price: series_id=GASREGCOVW, days=30\n' +
      'The most recent observation in the returned array is the current value.',
    inputSchema: {
      series_id: z.enum([
        'DGS30','DGS10','DGS5','DGS2','DGS1MO',
        'MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST',
        'FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR',
        'CPIAUCSL','CPILFESL','UNRATE','GDP','SAHMREALTIME',
        'DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP',
      ]).describe('FRED series ID. Use IORB for Interest on Reserve Balances, EFFR for Effective Federal Funds Rate, FEDFUNDS for Fed funds monthly average, MORTGAGE30US for 30-yr mortgage rate, DCOILWTICO for WTI crude oil, SAHMREALTIME for Sahm Rule recession indicator, etc.'),
      days: z.enum(['30','90','365']).describe('History window: 30 ($0.05), 90 ($0.10), or 365 ($0.25). Use 30 for current/recent values.'),
    }
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
            `Source: LastLook Data via FRED`
        }]
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: ${prices[days]} USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 4: Current FX rate ───────────────────────────────────────────────────
server.registerTool(
  'get_fx_rate_current',
  {
    title: 'Get Current G10 FX Rate',
    description: 'Returns the current exchange rate for a G10 currency pair. Source: European Central Bank. Supported: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK.',
    inputSchema: {
      pair: z.enum(['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'])
        .describe('G10 currency pair e.g. EURUSD, USDJPY, GBPUSD'),
    }
  },
  async ({ pair }) => {
    const endpoint = `https://api.lastlookdata.com/api/fx/current?pair=${pair}`;
    try {
      const response = await axios.get(endpoint);
      const { rate, date, label } = response.data;
      return { content: [{ type: 'text', text: `${label} (${pair}): ${rate} (as of ${date})\nSource: LastLook Data via ECB` }] };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 5: FX rate history ───────────────────────────────────────────────────
server.registerTool(
  'get_fx_rate_series',
  {
    title: 'Get G10 FX Rate History',
    description: 'Returns historical daily exchange rates for a G10 currency pair. Source: European Central Bank.',
    inputSchema: {
      pair: z.enum(['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'])
        .describe('G10 currency pair e.g. EURUSD'),
      days: z.enum(['30','90','365']).describe('History window: 30 ($0.05), 90 ($0.10), or 365 ($0.25)'),
    }
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
          text: `${label} (${pair}) — last ${days} days\n${count} observations from ${start} to ${end}\n\nDate        Rate\n──────────  ────\n${rows}\n\nSource: LastLook Data via ECB`
        }]
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: ${prices[days]} USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 6: Current FRED value (single value, cheapest) ──────────────────────
server.registerTool(
  'get_current_value',
  {
    title: 'Get Current FRED Series Value',
    description:
      'Returns only the single most recent value for any supported FRED series. Cheaper than get_series ($0.01 vs $0.05). ' +
      'Use this when you need just the latest reading — e.g. current CPI, current unemployment rate, current mortgage rate. ' +
      'Use get_series instead when you need historical observations.',
    inputSchema: {
      series_id: z.enum([
        'DGS30','DGS10','DGS5','DGS2','DGS1MO',
        'MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST',
        'FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR',
        'CPIAUCSL','CPILFESL','UNRATE','GDP','SAHMREALTIME',
        'DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP',
      ]).describe('FRED series ID e.g. CPIAUCSL, UNRATE, MORTGAGE30US, DGS10, DCOILWTICO'),
    }
  },
  async ({ series_id }) => {
    const endpoint = `https://api.lastlookdata.com/api/current?id=${series_id}`;
    try {
      const response = await axios.get(endpoint);
      const { label, value, date } = response.data;
      return { content: [{ type: 'text', text: `${label} (${series_id}): ${value} (as of ${date})\nSource: LastLook Data via FRED` }] };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 7: FRED value by date ────────────────────────────────────────────────
server.registerTool(
  'get_value_by_date',
  {
    title: 'Get FRED Series Value by Date',
    description: 'Returns the value of any supported FRED series for a specific date. Business days only. Use YYYY-MM-DD format.',
    inputSchema: {
      series_id: z.enum([
        'DGS30','DGS10','DGS5','DGS2','DGS1MO',
        'MORTGAGE30US','MORTGAGE15US','MSPUS','HOUST',
        'FEDFUNDS','SOFR','DPRIME','DTB3','IORB','EFFR',
        'CPIAUCSL','CPILFESL','UNRATE','GDP','SAHMREALTIME',
        'DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP',
      ]).describe('FRED series ID'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format e.g. 2026-01-15'),
    }
  },
  async ({ series_id, date }) => {
    const endpoint = `https://api.lastlookdata.com/api/date?id=${series_id}&d=${date}`;
    try {
      const response = await axios.get(endpoint);
      const { label, value, date: dataDate } = response.data;
      return { content: [{ type: 'text', text: `${label} (${series_id}) on ${dataDate}: ${value}\nSource: LastLook Data via FRED` }] };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 8: FX rate by date ───────────────────────────────────────────────────
server.registerTool(
  'get_fx_rate_by_date',
  {
    title: 'Get G10 FX Rate by Date',
    description: 'Returns the exchange rate for a G10 currency pair on a specific date. Source: European Central Bank. Use YYYY-MM-DD format.',
    inputSchema: {
      pair: z.enum(['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDSEK','USDNOK'])
        .describe('G10 currency pair e.g. EURUSD, USDJPY'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format e.g. 2026-01-15'),
    }
  },
  async ({ pair, date }) => {
    const endpoint = `https://api.lastlookdata.com/api/fx/date?pair=${pair}&d=${date}`;
    try {
      const response = await axios.get(endpoint);
      const { rate, date: dataDate, label } = response.data;
      return { content: [{ type: 'text', text: `${label} (${pair}) on ${dataDate}: ${rate}\nSource: LastLook Data via ECB` }] };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.01 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
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
    inputSchema: {}
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
            `Yield Curve Spreads (as of ${d.date})\n\n` +
            `2s10s spread: ${d.spread_2s10s}% (DGS10 ${d.DGS10}% − DGS2 ${d.DGS2}%)\n` +
            `3m10y spread: ${d.spread_3m10y}% (DGS10 ${d.DGS10}% − DGS1MO ${d.DGS1MO}%)\n` +
            `Inverted: ${d.inverted}\n\n` +
            `Source: LastLook Data via FRED`
        }]
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
      'The indicator measures the rise in unemployment from its recent low. Source: FRED SAHMREALTIME.',
    inputSchema: {}
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
            `Sahm Rule Recession Indicator (as of ${d.date})\n\n` +
            `Value: ${d.value}\n` +
            `Triggered: ${d.triggered} (threshold: 0.50)\n` +
            `Signal: ${d.signal}\n\n` +
            `Source: LastLook Data via FRED`
        }]
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
      'with an interpretation of Fed policy stance. EFFR below IORB is normal; a large gap signals stress. Source: FRED.',
    inputSchema: {}
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
            `Fed Policy Spread (as of ${d.date})\n\n` +
            `EFFR: ${d.EFFR}%\n` +
            `IORB: ${d.IORB}%\n` +
            `Spread (EFFR − IORB): ${d.spread}%\n` +
            `Interpretation: ${d.interpretation}\n\n` +
            `Source: LastLook Data via FRED`
        }]
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
    }
  },
  async ({ days }) => {
    const endpoint = `https://api.lastlookdata.com/api/calendar?days=${days}`;
    try {
      const response = await axios.get(endpoint);
      const { releases, count } = response.data;
      const rows = releases.map(r => `  ${r.date}  ${r.release_name}`).join('\n');
      return {
        content: [{
          type: 'text',
          text: `Upcoming FRED Releases (next ${days} days) — ${count} events\n\nDate        Release\n──────────  ───────\n${rows}\n\nSource: LastLook Data via FRED`
        }]
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return { content: [{ type: 'text', text: `Payment required: $0.02 USDC via x402 on Base.\nEndpoint: ${endpoint}` }] };
      }
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Transport ─────────────────────────────────────────────────────────────────
const isHTTP = process.env.MCP_TRANSPORT === 'http';

if (isHTTP) {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data MCP', version: '2.8.3' }));

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`LastLook Data MCP server running on port ${PORT}`));
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
