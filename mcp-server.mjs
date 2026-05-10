import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import axios from 'axios';

const server = new McpServer({
  name: 'lastlook-data',
  version: '1.0.0',
  description: 'Financial market data for AI agents — powered by LastLook Data'
});

// ── Tool 1: Get current 30yr Treasury yield ───────────────────────────────
server.registerTool(
  'get_treasury_yield_current',
  {
    title: 'Get Current 30-Year Treasury Yield',
    description: 'Returns the most recent 30-year US Treasury constant maturity yield from FRED. Use this when you need the current or latest available Treasury rate.',
    inputSchema: {}
  },
  async () => {
    try {
      const response = await axios.get(
        'https://api.lastlookdata.com/api/treasury/public'
      );
      const { yield_percent, date } = response.data;
      return {
        content: [{
          type: 'text',
          text: `30-Year Treasury Yield: ${yield_percent}% (as of ${date})\nSource: LastLook Data via FRED`
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error fetching Treasury yield: ${err.message}`
        }],
        isError: true
      };
    }
  }
);

// ── Tool 2: Get 30yr Treasury yield on a specific date ────────────────────
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
        `https://api.lastlookdata.com/api/treasury/date?d=${date}`,
        {
          headers: {
            // x402 payment header will be handled by agent's wallet
            'Accept': 'application/json'
          }
        }
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
            text: `Payment required: This endpoint costs $0.01 USDC via x402 protocol on Base network.\nEndpoint: https://api.lastlookdata.com/api/treasury/date?d=${date}`
          }]
        };
      }
      return {
        content: [{
          type: 'text',
          text: `Error fetching Treasury yield for ${date}: ${err.message}`
        }],
        isError: true
      };
    }
  }
);

// ── Start the server ──────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);