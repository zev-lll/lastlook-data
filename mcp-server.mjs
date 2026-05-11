import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import axios from 'axios';
import express from 'express';

const server = new McpServer({
  name: 'lastlook-data',
  version: '1.1.0',
  description: 'Financial market data for AI agents — powered by LastLook Data'
});

const SERIES_LABELS = {
  DGS30:        '30-Year Treasury Constant Maturity Rate',
  DGS10:        '10-Year Treasury Constant Maturity Rate',
  FEDFUNDS:     'Federal Funds Effective Rate',
  SOFR:         'Secured Overnight Financing Rate',
  CPIAUCSL:     'Consumer Price Index (All Urban Consumers)',
  MORTGAGE30US: '30-Year Fixed Rate Mortgage Average',
};

// ── Tool 1: Current 30yr Treasury yield ──────────────────────────────────────
server.registerTool(
  'get_treasury_yield_current',
  {
    title: 'Get Current 30-Year Treasury Yield',
    description: 'Returns the most recent 30-year US Treasury constant maturity yield from FRED. Use this when you need the current or latest available Treasury rate.',
    inputSchema: {}
  },
  async () => {
    try {
      const response = await axios.get('https://api.lastlookdata.com/api/treasury/public');
      const { yield_percent, date } = response.data;
      return {
        content: [{
          type: 'text',
          text: `30-Year Treasury Yield: ${yield_percent}% (as of ${date})\nSource: LastLook Data via FRED`
        }]
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error fetching Treasury yield: ${err.message}` }],
        isError: true
      };
    }
  }
);

// ── Tool 2: Yield by date ─────────────────────────────────────────────────────
server.registerTool(
  'get_treasury_yield_by_date',
  {
    title: 'Get 30-Year Treasury Yield by Date',
    description: 'Returns the 30-year US Treasury constant maturity yield for a specific date. Only available for business days. Use YYYY-MM-DD format.',
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .describe('The date to look up in YYYY-MM-DD format, e.g. 2026-05-07')
    }
  },
  async ({ date }) => {
    try {
      const response = await axios.get(
        `https://api.lastlookdata.com/api/treasury/date?d=${date}`
      );
      const { yield_percent, date: dataDate } = response.data;
      return {
        content: [{
          type: 'text',
          text: `30-Year Treasury Yield on ${dataDate}: ${yield_percent}%\nSource: LastLook Data via FRED`
        }]
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return {
          content: [{
            type: 'text',
            text: `Payment required: This endpoint costs $0.01 USDC via x402 on Base.\nEndpoint: https://api.lastlookdata.com/api/treasury/date?d=${date}`
          }]
        };
      }
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// ── Tool 3: Time series ───────────────────────────────────────────────────────
server.registerTool(
  'get_series',
  {
    title: 'Get Time Series Data',
    description:
      'Returns a time series of daily observations for a supported FRED data series. ' +
      'Supported series: DGS30 (30-yr Treasury), DGS10 (10-yr Treasury), FEDFUNDS (Fed Funds Rate), ' +
      'SOFR (Secured Overnight Financing Rate), CPIAUCSL (CPI), MORTGAGE30US (30-yr Mortgage Rate). ' +
      'Choose a window of 30, 90, or 365 days. Costs $0.05 / $0.10 / $0.25 USDC via x402 on Base.',
    inputSchema: {
      series_id: z.enum(['DGS30', 'DGS10', 'FEDFUNDS', 'SOFR', 'CPIAUCSL', 'MORTGAGE30US'])
        .describe('FRED series ID to retrieve'),
      days: z.enum(['30', '90', '365'])
        .describe('Number of calendar days of history to retrieve: 30 ($0.05), 90 ($0.10), or 365 ($0.25)'),
    }
  },
  async ({ series_id, days }) => {
    const prices = { '30': '$0.05', '90': '$0.10', '365': '$0.25' };
    const endpoint = `https://api.lastlookdata.com/api/series/${days}?id=${series_id}`;

    try {
      const response = await axios.get(endpoint);
      const { count, start, end, observations } = response.data;
      const label = SERIES_LABELS[series_id] || series_id;

      // Build a compact text table for the agent
      const rows = observations
        .map(o => `  ${o.date}  ${o.value}`)
        .join('\n');

      return {
        content: [{
          type: 'text',
          text:
            `${label} (${series_id}) — last ${days} days\n` +
            `${count} observations from ${start} to ${end}\n\n` +
            `Date        Value\n` +
            `──────────  ─────\n` +
            `${rows}\n\n` +
            `Source: LastLook Data via FRED`
        }]
      };
    } catch (err) {
      if (err.response?.status === 402) {
        return {
          content: [{
            type: 'text',
            text:
              `Payment required: This endpoint costs ${prices[days]} USDC via x402 on Base.\n` +
              `Endpoint: ${endpoint}`
          }]
        };
      }
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      };
    }
  }
);

// ── Transport: HTTP (hosted) or stdio (local) ─────────────────────────────────
const isHTTP = process.env.MCP_TRANSPORT === 'http';

if (isHTTP) {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'LastLook Data MCP Server', version: '1.1.0' });
  });

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`LastLook Data MCP server running on port ${PORT}`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
