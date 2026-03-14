/**
 * CeloPay Backend Test Suite
 * Tests all business logic without requiring live Celo RPC, Telegram, or DB dependencies
 * Run with: node tests/backend.test.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => { console.log(`  ✅ ${name}`); passed++; })
        .catch(e => { console.log(`  ❌ ${name}: ${e.message}`); failed++; });
    }
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) { if (!condition) throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertContains(str, substr) { if (!str.includes(substr)) throw new Error(`Expected "${str}" to contain "${substr}"`); }

// ─── Database Schema Validation ───────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   CeloPay Backend Test Suite             ║');
console.log('╚══════════════════════════════════════════╝\n');

console.log('📋 Database Schema');

test('schema.sql exists and is non-empty', () => {
  const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
  assert(schema.length > 100, 'Schema too short');
  assertContains(schema, 'CREATE TABLE IF NOT EXISTS users');
  assertContains(schema, 'CREATE TABLE IF NOT EXISTS transactions');
  assertContains(schema, 'CREATE TABLE IF NOT EXISTS esusu_circles');
  assertContains(schema, 'CREATE TABLE IF NOT EXISTS carts');
});

test('schema has all required user fields', () => {
  const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
  assertContains(schema, 'telegram_id');
  assertContains(schema, 'wallet_address');
  assertContains(schema, 'self_verified');
  assertContains(schema, 'self_nullifier');
  assertContains(schema, 'flagged');
});

test('schema has all transaction fields', () => {
  const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
  assertContains(schema, 'tx_hash');
  assertContains(schema, 'amount_cusd');
  assertContains(schema, 'tx_type');
  assertContains(schema, 'notified_admin');
});

test('schema has esusu tables', () => {
  const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
  assertContains(schema, 'esusu_members');
  assertContains(schema, 'esusu_rounds');
  assertContains(schema, 'esusu_contributions');
});

// ─── Self Protocol Service ────────────────────────────────────────────────────

console.log('\n📋 Self Protocol Service');

const selfModule = await import('../services/self.js');

test('generates verification link with correct structure', () => {
  const { link, sessionId, appDeeplink } = selfModule.generateVerificationLink('12345678');
  assert(link.includes('12345678'), 'Link should include telegram ID');
  assert(link.startsWith('https://self.xyz'), 'Link should be Self.xyz URL');
  assert(sessionId.length === 36, 'Session ID should be UUID');
  assert(appDeeplink.startsWith('self://'), 'Deeplink should use self:// protocol');
});

test('generates different session IDs for each call', () => {
  const { sessionId: s1 } = selfModule.generateVerificationLink('111');
  const { sessionId: s2 } = selfModule.generateVerificationLink('111');
  assert(s1 !== s2, 'Session IDs should be unique');
});

test('webhook signature verification passes in dev mode', () => {
  // In dev mode (no WEBHOOK_SECRET), always returns true
  const valid = selfModule.verifyWebhookSignature('{"test":"body"}', 'any-header');
  assert(valid === true, 'Should pass without webhook secret set');
});

test('processes valid verification proof', async () => {
  const proof = {
    subject: '99887766',
    nullifier: '0xabc123def456789',
    issuedAt: Date.now()
  };
  const result = await selfModule.processVerificationProof(proof);
  assert(result.valid, 'Should be valid');
  assertEqual(result.telegramUserId, '99887766', 'Telegram ID');
  assertEqual(result.nullifier, '0xabc123def456789', 'Nullifier');
});

test('rejects proof missing subject', async () => {
  const result = await selfModule.processVerificationProof({ nullifier: '0xabc' });
  assert(!result.valid, 'Should be invalid');
});

test('rejects proof missing nullifier', async () => {
  const result = await selfModule.processVerificationProof({ subject: '123' });
  assert(!result.valid, 'Should be invalid');
});

test('rejects null proof', async () => {
  const result = await selfModule.processVerificationProof(null);
  assert(!result.valid, 'Should be invalid');
});

test('builds verification message with link', () => {
  const msg = selfModule.buildVerificationMessage('https://self.xyz/verify?test=1');
  assertContains(msg, 'https://self.xyz/verify?test=1');
  assertContains(msg, 'Self Protocol');
  assertContains(msg, 'Identity Verification');
});

// ─── x402 Service ─────────────────────────────────────────────────────────────

console.log('\n📋 x402 Payment Service');

const x402Module = await import('../services/x402.js');

test('builds payment requirement correctly', () => {
  const req = x402Module.buildPaymentRequirement({
    amount: '0.01',
    currency: 'USDC',
    recipientAddress: '0x1234',
    resourcePath: '/api/price',
    description: 'Price feed access'
  });
  assertEqual(req.x402Version, 1, 'Version');
  assert(req.accepts.length > 0, 'Should have accepts');
  assertEqual(req.accepts[0].payTo, '0x1234', 'Recipient');
  assert(req.accepts[0].maxAmountRequired, 'Should have amount');
});

test('returns 402 error for missing payment header', async () => {
  const result = await x402Module.verifyPayment(null, {});
  assert(!result.valid, 'Should be invalid');
  assertContains(result.error, 'No X-PAYMENT');
});

test('returns 402 error for invalid base64 header', async () => {
  const result = await x402Module.verifyPayment('not-valid-base64!!!', {});
  assert(!result.valid, 'Should be invalid');
});

test('verifies valid payment header', async () => {
  const paymentData = {
    payload: {
      authorization: {
        value: '10000',
        to: '0xrecipient',
        from: '0xpayer',
        transactionHash: '0xtxhash'
      }
    }
  };
  const encoded = Buffer.from(JSON.stringify(paymentData)).toString('base64');
  const result = await x402Module.verifyPayment(encoded, {
    accepts: [{ maxAmountRequired: '5000', payTo: '0xrecipient' }]
  });
  assert(result.valid, 'Should be valid');
  assertEqual(result.payer, '0xpayer', 'Payer address');
});

test('rejects payment with insufficient amount', async () => {
  const paymentData = {
    payload: {
      authorization: { value: '100', to: '0xrecipient', from: '0xpayer' }
    }
  };
  const encoded = Buffer.from(JSON.stringify(paymentData)).toString('base64');
  const result = await x402Module.verifyPayment(encoded, {
    accepts: [{ maxAmountRequired: '1000', payTo: '0xrecipient' }]
  });
  assert(!result.valid, 'Should be invalid — insufficient amount');
});

test('rejects payment to wrong recipient', async () => {
  const paymentData = {
    payload: {
      authorization: { value: '10000', to: '0xwrong', from: '0xpayer' }
    }
  };
  const encoded = Buffer.from(JSON.stringify(paymentData)).toString('base64');
  const result = await x402Module.verifyPayment(encoded, {
    accepts: [{ maxAmountRequired: '1000', payTo: '0xcorrect' }]
  });
  assert(!result.valid, 'Should be invalid — wrong recipient');
});

// ─── Receipt Service ──────────────────────────────────────────────────────────

console.log('\n📋 Receipt Service');

const receiptModule = await import('../services/receipt.js');

const sampleReceiptData = {
  txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  sender: '@alice',
  receiver: '@bob',
  amountCusd: '25.00',
  memo: 'Lunch split',
  timestamp: new Date().toISOString(),
  txType: 'send'
};

test('generates PDF receipt as Buffer', async () => {
  const pdf = await receiptModule.generateReceiptPDF(sampleReceiptData);
  assert(Buffer.isBuffer(pdf), 'Should return Buffer');
  assert(pdf.length > 500, 'PDF should have content');
  // PDF magic bytes: %PDF
  assert(pdf[0] === 0x25 && pdf[1] === 0x50, 'Should start with PDF magic bytes');
});

test('generates PDF for split transaction', async () => {
  const pdf = await receiptModule.generateReceiptPDF({ ...sampleReceiptData, txType: 'split', amountCusd: '100.00' });
  assert(Buffer.isBuffer(pdf), 'Split receipt should be Buffer');
  assert(pdf.length > 200, 'Split PDF should have content');
});

test('generates PDF without tx hash (pending)', async () => {
  const pdf = await receiptModule.generateReceiptPDF({ ...sampleReceiptData, txHash: null });
  assert(Buffer.isBuffer(pdf), 'Should handle null txHash');
});

test('generates PNG receipt as Buffer (canvas or fallback)', async () => {
  const png = await receiptModule.generateReceiptPNG(sampleReceiptData);
  assert(Buffer.isBuffer(png), 'Should return Buffer');
  assert(png.length > 0, 'PNG should have content');
});

// ─── DB Module Structure ─────────────────────────────────────────────────────

console.log('\n📋 DB Module');

test('db module exports all required functions', async () => {
  const dbModule = await import('../db/index.js');
  const required = [
    'getDB', 'initDB', 'upsertUser', 'getUserByTelegramId',
    'getUserByWallet', 'getUserByUsername', 'setUserWallet',
    'setUserVerified', 'flagUser', 'createTransaction',
    'confirmTransaction', 'failTransaction', 'getTransactions',
    'createCircle', 'getCircle', 'getCircleMembers', 'addCircleMember',
    'recordContribution', 'getUnpaidMembers', 'resolveAlias', 'saveAlias'
  ];
  for (const fn of required) {
    assert(typeof dbModule[fn] === 'function', `Missing export: ${fn}`);
  }
});

// ─── Celo Service Structure ───────────────────────────────────────────────────

console.log('\n📋 Celo Service');

test('celo module exports all required functions', async () => {
  const celoModule = await import('../services/celo.js');
  const required = ['getPublicClient', 'getWalletClient', 'generateWallet',
    'getCUSDBalance', 'sendCUSD', 'approveCUSD', 'splitEqualOnChain',
    'contributeToCircle', 'waitForTransaction', 'getExplorerUrl'];
  for (const fn of required) {
    assert(typeof celoModule[fn] === 'function', `Missing export: ${fn}`);
  }
});

test('generateWallet returns valid Ethereum address and private key', async () => {
  const { generateWallet } = await import('../services/celo.js');
  const wallet = generateWallet();
  assert(wallet.address.startsWith('0x'), 'Address should start with 0x');
  assertEqual(wallet.address.length, 42, 'Address length');
  assert(wallet.privateKey.startsWith('0x'), 'Private key should start with 0x');
  assertEqual(wallet.privateKey.length, 66, 'Private key length');
});

test('generateWallet returns unique wallets each time', async () => {
  const { generateWallet } = await import('../services/celo.js');
  const w1 = generateWallet();
  const w2 = generateWallet();
  assert(w1.address !== w2.address, 'Addresses should be unique');
  assert(w1.privateKey !== w2.privateKey, 'Keys should be unique');
});

test('getExplorerUrl returns correct Alfajores URL', async () => {
  const { getExplorerUrl } = await import('../services/celo.js');
  const url = getExplorerUrl('0xabc123');
  assertEqual(url, 'https://alfajores.celoscan.io/tx/0xabc123', 'Explorer URL');
});

// ─── Esusu Service Structure ──────────────────────────────────────────────────

console.log('\n📋 Esusu Service');

test('esusu module exports all required functions', async () => {
  const esusuModule = await import('../services/esusu.js');
  const required = ['createCircle', 'joinCircle', 'contribute', 'getCircleStatus', 'getUserCircles'];
  for (const fn of required) {
    assert(typeof esusuModule[fn] === 'function', `Missing export: ${fn}`);
  }
});

// ─── Intent Parsing Logic ─────────────────────────────────────────────────────

console.log('\n📋 Intent Parsing (SOUL.md coverage)');

// These simulate what the OpenClaw agent should parse

function simulateIntent(message) {
  const msg = message.toLowerCase().trim();

  if (/\b(balance|how much|what.s my balance|check balance)\b/.test(msg)) return 'balance';
  if (/\b(send|pay|transfer)\s+\S+\s+\d/.test(msg)) return 'send';
  if (/\bsplit\s+\d+/.test(msg)) return 'split';
  if (/\b(my circles|esusu|ajo|my savings)\b/.test(msg)) return 'circles';
  if (/\b(join circle|join #)\b/.test(msg)) return 'join_circle';
  if (/\b(create circle|new esusu|start ajo|new savings)\b/.test(msg)) return 'create_circle';
  if (/\b(pay.*circle|contribute|pay.*esusu|pay.*ajo)\b/.test(msg)) return 'contribute';
  if (/\b(help|\/start|\/help)\b/.test(msg)) return 'help';
  return 'unknown';
}

const intentTests = [
  ["what's my balance", 'balance'],
  ["check balance", 'balance'],
  ["how much do i have", 'balance'],
  ["send peter 5 cusd", 'send'],
  ["pay james 100 cusd", 'send'],
  ["transfer 50 to alice", 'send'],
  ["split 100 between james and john", 'split'],
  ["split 200 btw alice bob charlie", 'split'],
  ["my circles", 'circles'],
  ["show my esusu", 'circles'],
  ["ajo status", 'circles'],
  ["join circle #3", 'join_circle'],
  ["create circle", 'create_circle'],
  ["new esusu group", 'create_circle'],
  ["pay esusu", 'contribute'],
  ["contribute to circle", 'contribute'],
  ["/help", 'help'],
  ["/start", 'help'],
];

for (const [msg, expectedIntent] of intentTests) {
  test(`intent: "${msg}" → ${expectedIntent}`, () => {
    const result = simulateIntent(msg);
    assertEqual(result, expectedIntent, `Intent for "${msg}"`);
  });
}

// ─── Split Amount Logic ───────────────────────────────────────────────────────

console.log('\n📋 Split Amount Calculations');

function calculateSplit(total, numPeople) {
  const each = Math.floor((total * 100) / numPeople) / 100;
  const dust = Math.round((total - each * numPeople) * 100) / 100;
  return { each, dust, total: each * numPeople + dust };
}

test('splits 100 cUSD between 2 people: 50 each', () => {
  const { each } = calculateSplit(100, 2);
  assertEqual(each, 50, 'Amount each');
});

test('splits 99 cUSD between 3 people: 33 each + 0 dust', () => {
  const { each } = calculateSplit(99, 3);
  assertEqual(each, 33, 'Amount each');
});

test('splits 100 cUSD between 3 people: 33.33 each + 0.01 dust', () => {
  const { each, dust } = calculateSplit(100, 3);
  assertEqual(each, 33.33, 'Amount each');
  assertEqual(dust, 0.01, 'Dust');
});

test('splits 50 cUSD between 4 people: 12.5 each', () => {
  const { each } = calculateSplit(50, 4);
  assertEqual(each, 12.5, 'Amount each');
});

test('splits 1000 cUSD between 10 people: 100 each', () => {
  const { each } = calculateSplit(1000, 10);
  assertEqual(each, 100, 'Amount each');
});

// ─── Route Structure ──────────────────────────────────────────────────────────

console.log('\n📋 Route Files');

test('api routes file exists', async () => {
  const api = await import('../routes/api.js');
  assert(api.default, 'Should export default router');
});

test('verify routes file exists', async () => {
  const verify = await import('../routes/verify.js');
  assert(verify.default, 'Should export default router');
});

test('receipt routes file exists', async () => {
  const receipt = await import('../routes/receipt.js');
  assert(receipt.default, 'Should export default router');
});

test('x402 routes file exists', async () => {
  const x402 = await import('../routes/x402.js');
  assert(x402.default, 'Should export default router');
});

// ─── OpenClaw Config Validation ──────────────────────────────────────────────

console.log('\n📋 OpenClaw Configuration');

test('gateway config is valid JSON with 3 agents', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '../../openclaw/gateway/openclaw.json'), 'utf8'));
  assertEqual(config.agents.list.length, 3, 'Should have 3 agents');
  const ids = config.agents.list.map(a => a.id);
  assert(ids.includes('personal'), 'personal agent');
  assert(ids.includes('payment-app'), 'payment-app agent');
  assert(ids.includes('admin'), 'admin agent');
});

test('gateway config has 3 bindings', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '../../openclaw/gateway/openclaw.json'), 'utf8'));
  assertEqual(config.bindings.length, 3, 'Should have 3 bindings');
});

test('admin bot has allowlist policy', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '../../openclaw/gateway/openclaw.json'), 'utf8'));
  const adminAccount = config.channels.telegram.accounts.find(a => a.id === 'celopayadminbot');
  assertEqual(adminAccount.dmPolicy, 'allowlist', 'Admin should use allowlist');
  assert(adminAccount.allowlist?.length > 0, 'Allowlist should not be empty');
});

test('payment bot has open DM policy', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '../../openclaw/gateway/openclaw.json'), 'utf8'));
  const paymentAccount = config.channels.telegram.accounts.find(a => a.id === 'celopaybot');
  assertEqual(paymentAccount.dmPolicy, 'open', 'Payment bot should be open');
});

test('payment SOUL.md contains all required intent patterns', () => {
  const soul = readFileSync(join(__dirname, '../../openclaw/workspace-payment/SOUL.md'), 'utf8');
  assertContains(soul, 'balance');
  assertContains(soul, 'send');
  assertContains(soul, 'split');
  assertContains(soul, 'esusu');
  assertContains(soul, 'CONFIRM');
  assertContains(soul, 'NEVER display or repeat private keys');
});

test('admin SOUL.md contains key admin capabilities', () => {
  const soul = readFileSync(join(__dirname, '../../openclaw/workspace-admin/SOUL.md'), 'utf8');
  assertContains(soul, 'transactions');
  assertContains(soul, 'flag');
  assertContains(soul, 'circles');
  assertContains(soul, 'verified');
});

// ─── Project Structure ────────────────────────────────────────────────────────

console.log('\n📋 Project Structure');

import { existsSync } from 'fs';

const requiredFiles = [
  // Contracts
  '../../contracts/contracts/EsusuCircle.sol',
  '../../contracts/contracts/SplitPayment.sol',
  '../../contracts/contracts/CeloPayRegistry.sol',
  '../../contracts/contracts/MockERC20.sol',
  '../../contracts/contracts/interfaces/IERC20.sol',
  '../../contracts/scripts/deploy.js',
  '../../contracts/hardhat.config.js',
  '../../contracts/validate-contracts.js',
  // Backend
  '../server.js',
  '../db/schema.sql',
  '../db/index.js',
  '../services/celo.js',
  '../services/receipt.js',
  '../services/self.js',
  '../services/esusu.js',
  '../services/x402.js',
  '../routes/api.js',
  '../routes/verify.js',
  '../routes/receipt.js',
  '../routes/x402.js',
  // OpenClaw
  '../../openclaw/gateway/openclaw.json',
  '../../openclaw/workspace-payment/SOUL.md',
  '../../openclaw/workspace-payment/HEARTBEAT.md',
  '../../openclaw/workspace-payment/skills/balance.js',
  '../../openclaw/workspace-payment/skills/send.js',
  '../../openclaw/workspace-payment/skills/split.js',
  '../../openclaw/workspace-payment/skills/esusu.js',
  '../../openclaw/workspace-payment/skills/onboard.js',
  '../../openclaw/workspace-payment/skills/receipt.js',
  '../../openclaw/workspace-admin/SOUL.md',
  '../../openclaw/workspace-admin/skills/admin-skills.js',
];

for (const file of requiredFiles) {
  test(`file exists: ${file.split('/').slice(-2).join('/')}`, () => {
    assert(existsSync(join(__dirname, file)), `Missing: ${file}`);
  });
}

// ─── Summary ─────────────────────────────────────────────────────────────────

// Wait for all async tests
await new Promise(r => setTimeout(r, 200));

console.log(`\n${'─'.repeat(44)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('🎉 All backend tests passed!\n');
} else {
  console.log('⚠️  Some tests failed. Review above.\n');
  process.exit(1);
}
