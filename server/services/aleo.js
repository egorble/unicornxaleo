const { execSync } = require('child_process');
const path = require('path');
const config = require('../config');

const CONTRACT_DIR = path.resolve(__dirname, '..', config.CONTRACT_PATH);

/**
 * Read a mapping value from the Aleo program on-chain.
 * Returns:
 *   - The value (string/null) on successful read
 *   - Throws on network/HTTP errors — caller can distinguish "not found" vs "API error"
 */
async function readMapping(mappingName, key) {
  const url = `${config.ENDPOINT}/${config.NETWORK}/program/${config.PROGRAM_ID}/mapping/${mappingName}/${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`readMapping ${mappingName}/${key} failed: HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Get latest block height.
 */
async function getBlockHeight() {
  const res = await fetch(`${config.ENDPOINT}/${config.NETWORK}/block/height/latest`);
  return parseInt(await res.text());
}

/**
 * Normalize an Aleo plaintext / struct so it fits on a single line.
 * Leo CLI can't parse multi-line inputs.
 * Also strips _version field which Shield wallet adds but Leo CLI doesn't accept.
 */
function flattenInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/\r?\n/g, ' ')           // remove newlines
    .replace(/,?\s*_version:\s*\d+u8\.public/g, '') // strip _version (Shield-only field)
    .replace(/,(\s*})/g, '$1')        // clean trailing comma before }
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim();
}

/**
 * Execute a transition on the deployed program via Leo CLI.
 * Returns the raw stdout (contains output records).
 */
function executeTransition(functionName, inputs) {
  const flattened = inputs.map(flattenInput);
  const inputStr = flattened.map(i => `"${i}"`).join(' ');
  const cmd = `${config.LEO_PATH} execute ${functionName} ${inputStr} --broadcast --yes --json-output --private-key ${config.ADMIN_PRIVATE_KEY} --endpoint ${config.ENDPOINT} --network ${config.NETWORK}`;

  console.log(`[aleo] Executing ${functionName}...`);

  try {
    const stdout = execSync(cmd, {
      cwd: CONTRACT_DIR,
      timeout: 600000, // 10 min — Aleo API is slow
      encoding: 'utf8',
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
    });

    const rejected = stdout.includes('Transaction rejected') || stdout.includes('Failed to broadcast');

    // Leo 4.0.0 with --broadcast returns immediately after broadcast (does not wait
    // for confirmation). Presence of a tx ID + no rejection signal = successfully
    // broadcast. Final on-chain confirmation must be polled separately.
    const txMatch = stdout.match(/transaction ID:?\s*'?([a-z0-9]+)'?/i)
                 || stdout.match(/(at1[a-z0-9]+)/);
    const txId = txMatch ? txMatch[1] : null;

    const broadcast = !!txId && !rejected;
    const status = rejected ? 'REJECTED' : broadcast ? 'BROADCAST' : 'UNKNOWN';
    console.log(`[aleo] ${functionName}: ${status} tx=${txId}`);

    return { success: broadcast, rejected, txId, output: stdout };
  } catch (err) {
    console.error(`[aleo] ${functionName} failed:`, err.message);
    return { success: false, rejected: true, txId: null, output: err.stdout || err.message };
  }
}

/**
 * Get transaction details from explorer.
 */
async function getTransaction(txId) {
  const res = await fetch(`${config.ENDPOINT}/${config.NETWORK}/transaction/${txId}`);
  if (!res.ok) return null;
  return res.json();
}

module.exports = { readMapping, getBlockHeight, executeTransition, getTransaction };
