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
        'CPIAUCSL','CPILFESL','UNRATE','GDP',
        'DCOILWTICO','DCOILBRENTEU','GASREGCOVW','DHHNGSP',
      ]).describe('FRED series ID. Use IORB for Interest on Reserve Balances, EFFR for Effective Federal Funds Rate, FEDFUNDS for Fed funds monthly average, MORTGAGE30US for 30-yr mortgage rate, DCOILWTICO for WTI crude oil, etc.'),
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

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data MCP', version: '2.7.0' }));

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`LastLook Data MCP server running on port ${PORT}`));
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
