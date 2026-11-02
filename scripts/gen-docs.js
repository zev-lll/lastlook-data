// Writes openapi.json and agent.json from routes.js.
// The API serves these live from the same builders; the files on disk are for
// the repo, the Lovable site, and directory submissions.
//   npm run gen:docs
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { buildOpenApi, buildAgentJson } = require('../routes');

const payTo = {
  base: process.env.WALLET_ADDRESS || '0xB4848d1b4b7E31B75b9b30d717F89777dC65D68e',
  solana: process.env.SOLANA_WALLET_ADDRESS || null,
};
const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'openapi.json'), JSON.stringify(buildOpenApi(payTo), null, 2) + '\n');
fs.writeFileSync(path.join(root, 'agent.json'), JSON.stringify(buildAgentJson(payTo), null, 2) + '\n');
console.log(`Wrote openapi.json and agent.json (networks: Base${payTo.solana ? ' + Solana' : ''})`);
