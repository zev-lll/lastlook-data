// mcp-server.mjs — LastLook Data MCP server.
//
// Every tool is a thin proxy over the HTTP API (api.lastlookdata.com). Prices come
// from routes.js, so the MCP server cannot drift from the API's payment config.
//
// Payments follow the x402 MCP transport:
//   • Unpaid call to a paid tool → result { isError: true, structuredContent: PaymentRequired,
//     content[0].text: JSON(PaymentRequired) }. x402-aware MCP clients (e.g. @x402/mcp)
//     sign a payment and retry automatically.
//   • Retry carries the PaymentPayload in params._meta["x402/payment"]; we forward it to the
//     API as the PAYMENT-SIGNATURE header. The API verifies and settles; the settlement
//     receipt is returned in result._meta["x402/payment-response"].
//
// Tools declare no outputSchema on purpose: structuredContent is the API's JSON as-is,
// and a declared schema that drifted from it made every call fail client-side validation.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SERVICE, routeByPath } = require('./routes.js');

const API_BASE = process.env.LASTLOOK_API_BASE || SERVICE.apiBase;
const API_TIMEOUT_MS = 30_000;

// ── Shared input schemas ──────────────────────────────────────────────────────

const SERIES_ENUM = [
  'DGS30', 'DGS10', 'DGS5', 'DGS2', 'DGS1MO',
  'MORTGAGE30US', 'MORTGAGE15US', 'MSPUS', 'HOUST',
  'FEDFUNDS', 'SOFR', 'DPRIME', 'DTB3', 'IORB', 'EFFR',
  'CPIAUCSL', 'CPILFESL', 'UNRATE', 'GDP', 'SAHMREALTIME',
  'DCOILWTICO', 'DCOILBRENTEU', 'GASREGCOVW', 'DHHNGSP',
];
const FX_ENUM = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'USDSEK', 'USDNOK'];
const COIN_ENUM = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'USDT', 'USDC', 'ADA', 'AVAX', 'DOGE', 'DOT', 'MATIC', 'LINK', 'LTC', 'ATOM', 'UNI', 'SUI', 'APT', 'NEAR', 'PEPE'];

const SERIES = z.enum(SERIES_ENUM).describe('FRED series ID. Use IORB for Interest on Reserve Balances, EFFR for Effective Fed Funds Rate, MORTGAGE30US for 30-yr mortgage rate, SAHMREALTIME for Sahm Rule, etc.');
const PAIR = z.enum(FX_ENUM).describe('G10 currency pair, e.g. EURUSD');
const COIN = z.enum(COIN_ENUM).describe('Crypto symbol, e.g. BTC');
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format, e.g. 2026-05-09');
const PCT = (d) => z.number().min(0).max(25).describe(d);
const USD = (d) => z.number().positive().describe(d);
const optional = (s) => s.optional();

// Drop undefined args and stringify for the query string.
const pick = (args, keys) => Object.fromEntries(keys.filter(k => args[k] !== undefined).map(k => [k, String(args[k])]));

// ── Tool table ────────────────────────────────────────────────────────────────
// route: API path (or a function of args); query: maps tool args → query params.

const TOOLS = [
  {
    name: 'calc_refinance',
    title: 'Refinance Calculator',
    route: '/api/calc/refi',
    description:
      'Should this borrower refinance? Give the current rate, balance and years remaining; returns the new monthly payment, ' +
      'monthly savings, break-even month, net dollar benefit over the years they expect to stay, and a verdict ' +
      '(worth_considering / marginal / not_worth_it). If new_rate is omitted, uses today\'s market rate from the ' +
      'Optimal Blue locked-rate index for the borrower\'s credit score and LTV segment.',
    input: {
      current_rate: PCT('Current note rate in percent, e.g. 7.25'),
      balance: USD('Remaining principal balance in USD'),
      remaining_years: optional(z.number().min(1).max(40).describe('Years left on the current loan (default 30)')),
      new_rate: optional(PCT('Quoted new rate in percent. Omit to use today\'s market rate.')),
      new_term: optional(z.enum(['30', '15']).describe('New loan term in years (default 30)')),
      closing_costs: optional(z.number().min(0).describe('Total refinance closing costs in USD (default 2% of balance)')),
      years_in_home: optional(z.number().min(0.5).max(40).describe('Years the borrower expects to keep the loan (default 7)')),
      credit_score: optional(z.number().int().min(300).max(850).describe('FICO score — selects the market-rate segment')),
      ltv: optional(z.number().min(1).max(125).describe('Loan-to-value percent — selects the market-rate segment')),
    },
    query: (a) => pick(a, ['current_rate', 'balance', 'remaining_years', 'new_rate', 'new_term', 'closing_costs', 'years_in_home', 'credit_score', 'ltv']),
  },
  {
    name: 'grade_mortgage_offer',
    title: 'Mortgage Offer Grader',
    route: '/api/grade/offer',
    description:
      'Is this mortgage offer good? Grades a written offer (rate, points, lender fees) A–D against the live Optimal Blue ' +
      'index of actual locked rates for the same product, term, credit score and LTV. Returns spread vs market in basis ' +
      'points, monthly and total cost vs market over the expected holding period, and a plain-language verdict with next step.',
    input: {
      rate: PCT('Offered note rate in percent, e.g. 6.875'),
      loan_amount: USD('Loan amount in USD'),
      points: optional(z.number().min(-5).max(10).describe('Discount points as percent of loan; negative for lender credits (default 0)')),
      lender_fees: optional(z.number().min(0).describe('Lender origination/underwriting fees in USD, excluding third-party costs (default 0)')),
      term: optional(z.enum(['30', '15']).describe('Loan term in years (default 30)')),
      loan_type: optional(z.enum(['conventional', 'fha', 'va', 'jumbo', 'usda']).describe('Loan program (default conventional)')),
      credit_score: optional(z.number().int().min(300).max(850).describe('Borrower FICO score')),
      ltv: optional(z.number().min(1).max(125).describe('Loan-to-value percent')),
      years_in_home: optional(z.number().min(0.5).max(40).describe('Years the borrower expects to keep the loan (default 7)')),
    },
    query: (a) => pick(a, ['rate', 'loan_amount', 'points', 'lender_fees', 'term', 'loan_type', 'credit_score', 'ltv', 'years_in_home']),
  },
  {
    name: "get_treasury_yield_current",
    title: "Get Current 30-Year Treasury Yield",
    route: '/api/treasury/public',
    free: true,
    description: "Returns the most recent 30-year US Treasury constant maturity yield (DGS30) from FRED. Free — no payment required. For other series use get_current_value or get_series.",
    input: {},
    query: () => ({}),
  },
  {
    name: "get_treasury_yield_by_date",
    title: "Get 30-Year Treasury Yield by Date",
    route: '/api/treasury/date',
    description: "Returns the 30-year US Treasury yield for a specific date. Business days only. Use YYYY-MM-DD format.",
    input: { date: DATE },
    query: ({ date }) => ({ d: date }),
  },
  {
    name: "get_current_value",
    title: "Get Current FRED Series Value",
    route: '/api/current',
    description: "Returns only the single most recent value for any supported FRED series. Cheaper than get_series ($0.01 vs $0.05). Use this when you need just the latest reading — e.g. current CPI, unemployment rate, mortgage rate. Use get_series instead when you need historical observations.",
    input: { series_id: SERIES },
    query: ({ series_id }) => ({ id: series_id }),
  },
  {
    name: "get_value_by_date",
    title: "Get FRED Series Value by Date",
    route: '/api/date',
    description: "Returns the value of any supported FRED series for a specific date. Business days only. Use YYYY-MM-DD format.",
    input: { series_id: SERIES, date: DATE },
    query: ({ series_id, date }) => ({ id: series_id, d: date }),
  },
  {
    name: "get_series",
    title: "Get FRED Data Series",
    route: ({ days }) => `/api/series/${days}`,
    description: "Returns recent observations for any supported FRED data series. Use this to get current and historical values for mortgage rates, Treasury yields, Fed funds rate, CPI, SOFR, unemployment, GDP, energy prices, and more. Common use cases:\n- Current 30-yr mortgage rate: series_id=MORTGAGE30US, days=30\n- Current Fed funds rate: series_id=FEDFUNDS, days=30\n- Current 10-yr Treasury yield: series_id=DGS10, days=30\n- Current CPI (inflation): series_id=CPIAUCSL, days=30\n- Current WTI crude oil: series_id=DCOILWTICO, days=30\nThe most recent observation in the returned array is the current value.",
    input: {
      series_id: SERIES,
      days: z.enum(['30', '90', '365']).describe('History window: 30 ($0.05), 90 ($0.10), or 365 ($0.25). Use 30 for current/recent values.'),
    },
    query: ({ series_id }) => ({ id: series_id }),
  },
  {
    name: "get_fx_rate_current",
    title: "Get Current G10 FX Rate",
    route: '/api/fx/current',
    description: "Returns the current exchange rate for a G10 currency pair. Source: European Central Bank. Supported: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK.",
    input: { pair: PAIR },
    query: ({ pair }) => ({ pair }),
  },
  {
    name: "get_fx_rate_by_date",
    title: "Get G10 FX Rate by Date",
    route: '/api/fx/date',
    description: "Returns the exchange rate for a G10 currency pair on a specific date. Source: European Central Bank. Use YYYY-MM-DD format.",
    input: { pair: PAIR, date: DATE },
    query: ({ pair, date }) => ({ pair, d: date }),
  },
  {
    name: "get_fx_rate_series",
    title: "Get G10 FX Rate History",
    route: '/api/fx/series',
    description: "Returns historical daily exchange rates for a G10 currency pair. Source: European Central Bank.",
    input: { pair: PAIR, days: z.enum(['30', '90', '365']).describe('History window in days') },
    query: ({ pair, days }) => ({ pair, days }),
  },
  {
    name: "get_yield_curve",
    title: "Get Yield Curve Spreads",
    route: '/api/derived/yield-curve',
    description: "Returns 2s10s (2-year vs 10-year) and 3m10y (3-month vs 10-year) Treasury yield curve spreads with inversion signal. An inverted yield curve (negative spread) historically precedes recessions. Source: FRED.",
  },
  {
    name: "get_recession_indicator",
    title: "Get Sahm Rule Recession Indicator",
    route: '/api/derived/recession',
    description: "Returns the real-time Sahm Rule recession indicator. A value >= 0.50 signals a recession is likely underway. Measures the rise in unemployment from its recent low. Source: FRED SAHMREALTIME.",
  },
  {
    name: "get_policy_spread",
    title: "Get Fed Policy Spread (EFFR vs IORB)",
    route: '/api/derived/policy-spread',
    description: "Returns the spread between the Effective Federal Funds Rate (EFFR) and Interest on Reserve Balances (IORB), with an interpretation of Fed policy stance. EFFR below IORB is the normal operating band. Source: FRED.",
  },
  {
    name: "get_economic_calendar",
    title: "Get Economic Calendar",
    route: '/api/calendar',
    description: "Returns upcoming FRED economic data release dates — CPI, jobs report, GDP, Treasury rates, and more. Use this to find out when the next major economic data will be published.",
    input: { days: z.enum(['30', '60', '90']).describe('Lookahead window in days') },
    query: ({ days }) => ({ days }),
  },
  {
    name: "get_bundle_refi_signal",
    title: "Get Refinance Signal Bundle",
    route: '/api/bundle/refi-signal',
    description: "Returns a refinance signal bundle: current 30yr and 15yr mortgage rates, 52-week high/low range, MBS spread over 10Y Treasury, 30-day and 90-day rate trend, and a refi break-even threshold. The refi_breakeven_threshold field directly answers \"what rate does a borrower need to have to benefit from refinancing today?\"",
  },
  {
    name: "get_bundle_purchase_market",
    title: "Get Home Purchase Market Bundle",
    route: '/api/bundle/purchase-market',
    description: "Returns a home purchase market bundle: current 30yr mortgage rate, median US home sale price (MSPUS), estimated monthly P&I payment on the median home assuming 20% down, annual income required to qualify at 28% DTI, affordability level signal, and housing starts. Directly answers \"can my client afford a home today?\"",
  },
  {
    name: "get_bundle_rate_environment",
    title: "Get Rate Environment Snapshot Bundle",
    route: '/api/bundle/rate-environment',
    description: "Returns a complete rate environment snapshot in one call: FEDFUNDS, SOFR, DGS2, DGS5, DGS10, DGS30, plus computed yield curve spreads (2s10s and 3m10y), Fed policy spread (EFFR vs IORB), and curve shape signal. Use this instead of multiple individual calls when you need the full rate picture.",
  },
  {
    name: "get_bundle_mortgage_pulse",
    title: "Get Mortgage Market Pulse Bundle",
    route: '/api/bundle/mortgage-pulse',
    description: "Returns a complete mortgage market snapshot: 30yr and 15yr mortgage rates, 10Y Treasury yield, Fed funds rate, median home price (MSPUS), housing starts (HOUST), MBS spread (30yr mortgage minus 10Y), and 30-day rate trend signal. Use this for mortgage market analysis.",
  },
  {
    name: "get_bundle_macro",
    title: "Get Macro Health Snapshot Bundle",
    route: '/api/bundle/macro',
    description: "Returns a macro health snapshot: GDP, unemployment rate (UNRATE), CPI and core CPI, Fed funds rate, yield curve 2s10s spread, and Sahm Rule recession indicator. Includes a cycle phase signal (expansion/late cycle/peak/contraction). Use this for macroeconomic context or recession risk assessment.",
  },
  {
    name: "get_bundle_fx_dashboard",
    title: "Get G10 FX Dashboard Bundle",
    route: '/api/bundle/fx-dashboard',
    description: "Returns all 9 G10 FX spot rates in one call: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDSEK, USDNOK. Also includes a USD strength index (average % change vs G10 basket over 30 days) and a USD trend signal. Source: European Central Bank via Frankfurter.",
  },
  {
    name: "get_bundle_energy",
    title: "Get Energy & Commodities Bundle",
    route: '/api/bundle/energy',
    description: "Returns current energy commodity prices in one call: WTI crude oil (DCOILWTICO), Brent crude (DCOILBRENTEU), US regular gasoline (GASREGCOVW), and Henry Hub natural gas (DHHNGSP). Includes the WTI-Brent spread and a market signal. Source: FRED.",
  },
  {
    name: "get_bundle_context_brief",
    title: "Get Economic Context Brief Bundle",
    route: '/api/bundle/context-brief',
    description: "Returns a pre-formatted natural-language paragraph summarizing 15+ economic indicators — rates, inflation, employment, mortgage market, energy prices, and FX. The \"brief\" field is ready to inject directly into an LLM prompt as economic context. Also returns structured series, FX, derived, and signals fields.",
  },
  {
    name: "get_crypto_price",
    title: "Get Current Crypto Price",
    route: '/api/crypto/price',
    description: "Returns the current USD price, 24h % change, market cap, and 24h volume for any supported cryptocurrency. Supported: BTC, ETH, SOL, BNB, XRP, USDT, USDC, ADA, AVAX, DOGE, DOT, MATIC, LINK, LTC, ATOM, UNI, SUI, APT, NEAR, PEPE. Source: CoinGecko.",
    input: { coin: COIN },
    query: ({ coin }) => ({ coin }),
  },
  {
    name: "get_crypto_history",
    title: "Get Crypto Historical Prices",
    route: '/api/crypto/history',
    description: "Returns historical daily closing prices for any supported cryptocurrency over 30, 90, or 365 days. Use for trend analysis, drawdown calculation, or training data. Source: CoinGecko.",
    input: { coin: COIN, days: z.enum(['30', '90', '365']).describe('Days of daily price history') },
    query: ({ coin, days }) => ({ coin, days }),
  },
  {
    name: "get_bundle_crypto",
    title: "Get Crypto Top 20 Bundle",
    route: '/api/bundle/crypto',
    description: "Returns the top 20 cryptocurrencies by market cap in one call: price, 24h change, 7d change, market cap, and volume. Covers BTC, ETH, SOL, BNB, XRP, USDT, USDC, ADA, AVAX, DOGE, and more. Use this instead of individual get_crypto_price calls when you need broad market coverage. Source: CoinGecko.",
  },
  {
    name: "get_edgar_company",
    title: "Get Company Fundamentals (SEC EDGAR)",
    route: '/api/edgar/company',
    description: "Returns financial fundamentals for any US public company from SEC EDGAR XBRL filings: revenue, net income, total assets, stockholders equity, and EPS. Includes both annual (10-K) and quarterly (10-Q) data for the most recent periods. Works for any ticker listed on a US exchange (AAPL, MSFT, TSLA, AMZN, NVDA, GOOGL, META, JPM, BAC, etc.). Source: SEC EDGAR.",
    input: { ticker: z.string().min(1).max(10).describe('US stock ticker, e.g. AAPL, MSFT, NVDA') },
    query: ({ ticker }) => ({ ticker: ticker.toUpperCase() }),
  },
];

// ── x402 MCP transport helpers ────────────────────────────────────────────────

const b64json = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const unb64json = (s) => { try { return JSON.parse(Buffer.from(s, 'base64').toString('utf8')); } catch { return null; } };

function priceLine(tool, args) {
  if (tool.free) return 'Free — no payment required.';
  const path = typeof tool.route === 'function' ? null : tool.route;
  if (path && routeByPath[path]) return `Price: $${routeByPath[path].price} USDC per call via x402 (Base or Solana).`;
  if (tool.name === 'get_series') return 'Price: $0.05 / $0.10 / $0.25 USDC per call (30 / 90 / 365 days) via x402 (Base or Solana).';
  return 'Paid via x402 (USDC on Base or Solana).';
}

async function callApi(tool, args, extra) {
  const path = typeof tool.route === 'function' ? tool.route(args) : tool.route;
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(tool.query ? tool.query(args) : {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }

  const headers = { accept: 'application/json', 'user-agent': `lastlook-data-mcp/${SERVICE.version}` };
  const payment = extra?._meta?.['x402/payment'];
  if (payment) headers['PAYMENT-SIGNATURE'] = b64json(payment);

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `LastLook Data API unreachable: ${err.message}` }] };
  }
  const body = await res.json().catch(() => null);

  if (res.status === 402) {
    const paymentRequired = unb64json(res.headers.get('payment-required') || '') || body;
    const route = routeByPath[path];
    const human = [
      `Payment required: $${route?.price ?? '?'} USDC via x402 (USDC on Base or Solana).`,
      payment ? `The payment that was sent was not accepted${paymentRequired?.error ? `: ${paymentRequired.error}` : ''}.` : null,
      'x402-enabled MCP clients (e.g. @x402/mcp) pay automatically by retrying with _meta["x402/payment"].',
      `Or call the HTTP API directly with any x402 client: GET ${url.toString()}`,
    ].filter(Boolean).join('\n');
    return {
      isError: true,
      structuredContent: paymentRequired,
      content: [
        { type: 'text', text: JSON.stringify(paymentRequired) },
        { type: 'text', text: human },
      ],
    };
  }

  if (!res.ok || !body) {
    const msg = body?.error ? `${body.error}${body.detail ? ` (${body.detail})` : ''}` : `HTTP ${res.status}`;
    return { isError: true, content: [{ type: 'text', text: `LastLook Data error: ${msg}` }] };
  }

  const result = {
    structuredContent: body,
    content: [{ type: 'text', text: `${tool.title} — LastLook Data\n${JSON.stringify(body, null, 2)}` }],
  };
  const settle = unb64json(res.headers.get('payment-response') || '');
  if (settle) result._meta = { 'x402/payment-response': settle };
  return result;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function createMcpServer() {
  const server = new McpServer({
    name: 'lastlook-data',
    version: SERVICE.version,
    description: SERVICE.description,
  });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: `${tool.description}\n${priceLine(tool)}`,
        inputSchema: tool.input || {},
        annotations: READ_ONLY,
      },
      async (args, extra) => callApi(tool, args || {}, extra),
    );
  }
  return server;
}

export { TOOLS, createMcpServer, callApi };

// ── Transport ─────────────────────────────────────────────────────────────────

const mode = process.env.MCP_TRANSPORT;

if (mode === 'http') {
  const app = express();
  app.use(express.json());

  const handle = async (req, res) => {
    try {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed:', err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  };
  app.post('/mcp', handle);
  app.get('/mcp', handle);

  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'LastLook Data MCP', version: SERVICE.version, tools: TOOLS.length }));

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`LastLook Data MCP server running on port ${PORT}`));
} else if (mode !== 'none') {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
