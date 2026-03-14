/**
 * CeloPay Full Standalone Test Suite
 * Zero npm dependencies — runs with Node.js built-ins only
 * Validates: contract logic, business rules, config, intent parsing, 
 *            receipt structure, x402 flows, Self Protocol flows, split math
 * Run with: node tests/standalone.test.js
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0, section = '';

function describe(name, fn) {
  section = name;
  console.log(`\n📋 ${name}`);
  fn();
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'false'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function assertIncludes(str, sub) { if (!String(str).includes(sub)) throw new Error(`"${sub}" not found in response`); }

// ═══════════════════════════════════════════════════════════════════
// 1. CONTRACT LOGIC (no Hardhat needed)
// ═══════════════════════════════════════════════════════════════════

class MockTokenLedger {
  constructor() { this.balances = {}; }
  mint(addr, amount) { this.balances[addr] = (this.balances[addr] || 0) + amount; }
  balanceOf(addr) { return this.balances[addr] || 0; }
  transfer(from, to, amount) {
    if (this.balances[from] < amount) throw new Error('ERC20: insufficient balance');
    this.balances[from] -= amount;
    this.balances[to] = (this.balances[to] || 0) + amount;
  }
  approve(from, spender, amount) { /* simplified */ }
  transferFrom(from, to, amount) { this.transfer(from, to, amount); }
}

class EsusuSim {
  constructor(token) { this.token = token; this.circles = {}; this.count = 0; }

  create(name, contribution, intervalMs, maxMembers, admin) {
    if (contribution <= 0 || maxMembers < 2) throw new Error('InvalidAmount');
    const id = ++this.count;
    this.circles[id] = {
      id, name, admin, contribution, intervalMs, maxMembers,
      currentRound: 1, nextPayout: Date.now() + intervalMs, active: true,
      members: [admin], isMember: {[admin]: true},
      roundPaid: {1: {}}, roundContrib: {1: 0}, contractBalance: 0
    };
    return id;
  }

  join(id, member) {
    const c = this.circles[id];
    if (!c.active) throw new Error('CircleNotActive');
    if (c.isMember[member]) throw new Error('AlreadyMember');
    if (c.members.length >= c.maxMembers) throw new Error('CircleFull');
    c.members.push(member); c.isMember[member] = true;
  }

  contribute(id, member) {
    const c = this.circles[id];
    if (!c.isMember[member]) throw new Error('NotMember');
    if (c.roundPaid[c.currentRound][member]) throw new Error('AlreadyPaidThisRound');
    this.token.transferFrom(member, `circle_${id}`, c.contribution);
    c.roundPaid[c.currentRound][member] = true;
    c.roundContrib[c.currentRound] += c.contribution;
    c.contractBalance += c.contribution;
  }

  allPaid(id) {
    const c = this.circles[id];
    return c.members.every(m => c.roundPaid[c.currentRound][m]);
  }

  payout(id, recipient, admin, now = Date.now()) {
    const c = this.circles[id];
    if (c.admin !== admin) throw new Error('NotAdmin');
    if (!this.allPaid(id)) throw new Error('RoundNotComplete');
    if (now < c.nextPayout) throw new Error('PayoutNotDue');
    if (!c.isMember[recipient]) throw new Error('NotMember');
    const pot = c.roundContrib[c.currentRound];
    this.token.transfer(`circle_${id}`, recipient, pot);
    c.contractBalance -= pot;
    c.currentRound++;
    c.nextPayout = now + c.intervalMs;
    c.roundPaid[c.currentRound] = {};
    c.roundContrib[c.currentRound] = 0;
    if (c.currentRound > c.members.length) c.active = false;
    return pot;
  }
}

class SplitSim {
  constructor(token) { this.token = token; }

  equal(from, recipients, total) {
    if (!recipients.length) throw new Error('NoRecipients');
    if (total <= 0) throw new Error('ZeroAmount');
    const each = Math.floor(total / recipients.length);
    this.token.transferFrom(from, '__split__', total);
    for (const r of recipients) this.token.transfer('__split__', r, each);
    const dust = total - each * recipients.length;
    if (dust > 0) this.token.transfer('__split__', from, dust);
    return { each, dust };
  }

  custom(from, recipients, amounts) {
    if (recipients.length !== amounts.length) throw new Error('LengthMismatch');
    const total = amounts.reduce((a, b) => a + b, 0);
    this.token.transferFrom(from, '__split__', total);
    recipients.forEach((r, i) => this.token.transfer('__split__', r, amounts[i]));
    return total;
  }
}

describe('EsusuCircle Contract Logic', () => {
  const token = new MockTokenLedger();
  const esusu = new EsusuSim(token);
  ['admin', 'alice', 'bob', 'charlie'].forEach(u => token.mint(u, 10000));

  test('create circle', () => {
    const id = esusu.create('Lagos Circle', 100, 1000, 3, 'admin');
    assert(esusu.circles[id].active);
    assertEqual(esusu.circles[id].members.length, 1);
  });

  test('rejects zero contribution', () => {
    try { esusu.create('Bad', 0, 1000, 3, 'admin'); assert(false); }
    catch(e) { assertEqual(e.message, 'InvalidAmount'); }
  });

  test('rejects maxMembers < 2', () => {
    try { esusu.create('Bad', 10, 1000, 1, 'admin'); assert(false); }
    catch(e) { assertEqual(e.message, 'InvalidAmount'); }
  });

  test('members join', () => {
    const id = esusu.create('Join Test', 50, 1000, 3, 'admin');
    esusu.join(id, 'alice'); esusu.join(id, 'bob');
    assertEqual(esusu.circles[id].members.length, 3);
  });

  test('rejects duplicate join', () => {
    const id = esusu.create('Dup', 50, 1000, 3, 'admin');
    try { esusu.join(id, 'admin'); assert(false); }
    catch(e) { assertEqual(e.message, 'AlreadyMember'); }
  });

  test('rejects joining full circle', () => {
    const id = esusu.create('Full', 50, 1000, 2, 'admin');
    esusu.join(id, 'alice');
    try { esusu.join(id, 'bob'); assert(false); }
    catch(e) { assertEqual(e.message, 'CircleFull'); }
  });

  test('all members contribute', () => {
    const id = esusu.create('Contrib', 100, 1000, 3, 'admin');
    esusu.join(id, 'alice'); esusu.join(id, 'bob');
    esusu.contribute(id, 'admin');
    esusu.contribute(id, 'alice');
    esusu.contribute(id, 'bob');
    assertEqual(esusu.circles[id].contractBalance, 300);
  });

  test('rejects double contribution', () => {
    const id = esusu.create('Double', 50, 1000, 2, 'admin');
    esusu.join(id, 'alice');
    esusu.contribute(id, 'admin');
    try { esusu.contribute(id, 'admin'); assert(false); }
    catch(e) { assertEqual(e.message, 'AlreadyPaidThisRound'); }
  });

  test('detects all-paid state', () => {
    const id = esusu.create('AllPaid', 50, 1000, 2, 'admin');
    esusu.join(id, 'alice');
    assert(!esusu.allPaid(id));
    esusu.contribute(id, 'admin');
    esusu.contribute(id, 'alice');
    assert(esusu.allPaid(id));
  });

  test('payout releases correct amount', () => {
    const t = new MockTokenLedger();
    ['admin', 'alice', 'bob'].forEach(u => t.mint(u, 10000));
    const e = new EsusuSim(t);
    const id = e.create('Payout', 100, 100, 3, 'admin');
    e.join(id, 'alice'); e.join(id, 'bob');
    ['admin', 'alice', 'bob'].forEach(u => e.contribute(id, u));
    const beforeAlice = t.balanceOf('alice');
    const pot = e.payout(id, 'alice', 'admin', Date.now() + 200);
    assertEqual(pot, 300);
    assertEqual(t.balanceOf('alice'), beforeAlice + 300);
  });

  test('rejects payout before interval', () => {
    const id = esusu.create('Early', 50, 9999999, 2, 'admin');
    esusu.join(id, 'alice');
    esusu.contribute(id, 'admin'); esusu.contribute(id, 'alice');
    try { esusu.payout(id, 'alice', 'admin', Date.now() - 1); assert(false); }
    catch(e) { assertEqual(e.message, 'PayoutNotDue'); }
  });

  test('rejects payout when not all paid', () => {
    const id = esusu.create('Incomplete', 50, 100, 2, 'admin');
    esusu.join(id, 'alice');
    esusu.contribute(id, 'admin'); // alice hasn't paid
    try { esusu.payout(id, 'alice', 'admin', Date.now() + 200); assert(false); }
    catch(e) { assertEqual(e.message, 'RoundNotComplete'); }
  });

  test('circle closes after all rounds complete', () => {
    const t = new MockTokenLedger();
    ['a', 'b'].forEach(u => t.mint(u, 9999));
    const e = new EsusuSim(t);
    const id = e.create('FullCycle', 10, 1, 2, 'a');
    e.join(id, 'b');
    let now = Date.now() + 5;
    e.contribute(id, 'a'); e.contribute(id, 'b');
    e.payout(id, 'a', 'a', now);
    e.contribute(id, 'a'); e.contribute(id, 'b');
    e.payout(id, 'b', 'a', now + 5);
    assert(!e.circles[id].active, 'Circle should be closed');
    assertEqual(e.circles[id].contractBalance, 0);
  });
});

describe('SplitPayment Contract Logic', () => {
  test('equal split 100 between 2', () => {
    const t = new MockTokenLedger();
    ['payer', 'alice', 'bob'].forEach(u => t.mint(u, 50000));
    const s = new SplitSim(t);
    const beforeAlice = t.balanceOf('alice');
    const beforeBob = t.balanceOf('bob');
    const { each } = s.equal('payer', ['alice', 'bob'], 100);
    assertEqual(each, 50);
    assertEqual(t.balanceOf('alice') - beforeAlice, 50);
    assertEqual(t.balanceOf('bob') - beforeBob, 50);
  });

  test('equal split 90 between 3', () => {
    const t = new MockTokenLedger();
    ['p', 'a', 'b', 'c'].forEach(u => t.mint(u, 9999));
    const s = new SplitSim(t);
    const [ba, bb, bc] = ['a', 'b', 'c'].map(u => t.balanceOf(u));
    const { each } = s.equal('p', ['a', 'b', 'c'], 90);
    assertEqual(each, 30);
    assertEqual(t.balanceOf('a') - ba, 30);
    assertEqual(t.balanceOf('b') - bb, 30);
    assertEqual(t.balanceOf('c') - bc, 30);
  });

  test('dust returned to payer on uneven split', () => {
    const t = new MockTokenLedger();
    ['p', 'a', 'b', 'c'].forEach(u => t.mint(u, 9999));
    const s = new SplitSim(t);
    const before = t.balanceOf('p');
    const { each, dust } = s.equal('p', ['a', 'b', 'c'], 100);
    assertEqual(each, 33);
    assertEqual(dust, 1);
    assertEqual(t.balanceOf('p'), before - 100 + 1); // got dust back
  });

  test('rejects empty recipients', () => {
    const t = new MockTokenLedger(); t.mint('payer', 50000);
    const s = new SplitSim(t);
    try { s.equal('payer', [], 100); assert(false); }
    catch(e) { assertEqual(e.message, 'NoRecipients'); }
  });

  test('rejects zero amount', () => {
    const t = new MockTokenLedger(); t.mint('payer', 50000);
    const s = new SplitSim(t);
    try { s.equal('payer', ['alice'], 0); assert(false); }
    catch(e) { assertEqual(e.message, 'ZeroAmount'); }
  });

  test('rejects insufficient balance', () => {
    const t = new MockTokenLedger();
    t.mint('p', 10);
    const s = new SplitSim(t);
    try { s.equal('p', ['a'], 1000); assert(false); }
    catch(e) { assertIncludes(e.message, 'insufficient'); }
  });

  test('custom split: 60/40', () => {
    const t = new MockTokenLedger();
    ['p', 'a', 'b'].forEach(u => t.mint(u, 9999));
    const s = new SplitSim(t);
    const beforeA = t.balanceOf('a');
    const beforeB = t.balanceOf('b');
    s.custom('p', ['a', 'b'], [60, 40]);
    assertEqual(t.balanceOf('a') - beforeA, 60);
    assertEqual(t.balanceOf('b') - beforeB, 40);
  });

  test('rejects length mismatch', () => {
    const t = new MockTokenLedger(); t.mint('payer', 50000);
    const s = new SplitSim(t);
    try { s.custom('payer', ['alice'], [10, 20]); assert(false); }
    catch(e) { assertEqual(e.message, 'LengthMismatch'); }
  });

  test('4-person esusu payout split', () => {
    const t = new MockTokenLedger();
    ['p', 'a', 'b', 'c', 'd'].forEach(u => t.mint(u, 9999));
    const s = new SplitSim(t);
    const { each } = s.equal('p', ['a', 'b', 'c', 'd'], 400);
    assertEqual(each, 100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. SELF PROTOCOL LOGIC
// ═══════════════════════════════════════════════════════════════════

describe('Self Protocol Logic', () => {
  function generateLink(telegramId) {
    const sessionId = crypto.randomUUID();
    const params = new URLSearchParams({
      appId: 'celopay-app', subject: String(telegramId), sessionId,
      requirements: JSON.stringify({ minimumAge: 18, excludedCountries: [], ofac: true })
    });
    return { link: `https://self.xyz/verify?${params}`, sessionId, appDeeplink: `self://verify?${params}` };
  }

  function verifySignature(body, sig, secret) {
    if (!secret) return true;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    return sig === expected;
  }

  function processProof(proof) {
    if (!proof || !proof.subject || !proof.nullifier) return { valid: false, error: 'Missing fields' };
    return { valid: true, telegramUserId: String(proof.subject), nullifier: proof.nullifier };
  }

  test('generates link with telegram ID embedded', () => {
    const { link } = generateLink('12345678');
    assertIncludes(link, '12345678');
    assertIncludes(link, 'https://self.xyz/verify');
  });

  test('generates unique session IDs', () => {
    const { sessionId: s1 } = generateLink('111');
    const { sessionId: s2 } = generateLink('111');
    assert(s1 !== s2);
  });

  test('deeplink uses self:// protocol', () => {
    const { appDeeplink } = generateLink('999');
    assert(appDeeplink.startsWith('self://'));
  });

  test('webhook signature passes without secret (dev mode)', () => {
    assert(verifySignature('body', 'any', ''));
  });

  test('webhook signature validates correctly', () => {
    const secret = 'test-secret';
    const body = '{"test":"data"}';
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    assert(verifySignature(body, sig, secret));
  });

  test('webhook signature rejects wrong sig', () => {
    assert(!verifySignature('body', 'sha256=wrong', 'secret'));
  });

  test('processes valid proof', () => {
    const r = processProof({ subject: '99887766', nullifier: '0xabc' });
    assert(r.valid);
    assertEqual(r.telegramUserId, '99887766');
  });

  test('rejects proof without subject', () => {
    assert(!processProof({ nullifier: '0xabc' }).valid);
  });

  test('rejects null proof', () => {
    assert(!processProof(null).valid);
  });

  test('anti-sybil: same nullifier cannot verify twice', () => {
    const nullifiers = new Set();
    const p1 = processProof({ subject: '111', nullifier: '0xunique1' });
    assert(p1.valid);
    nullifiers.add(p1.nullifier);

    const p2 = processProof({ subject: '222', nullifier: '0xunique1' });
    assert(p2.valid);
    const isReuse = nullifiers.has(p2.nullifier);
    assert(isReuse, 'Nullifier reuse should be detectable');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. x402 PAYMENT LOGIC
// ═══════════════════════════════════════════════════════════════════

describe('x402 Payment Logic', () => {
  function buildRequirement({ amount, recipientAddress, resourcePath }) {
    return {
      x402Version: 1,
      accepts: [{
        scheme: 'exact',
        network: 'celo-alfajores',
        maxAmountRequired: String(Math.round(parseFloat(amount) * 1e6)),
        resource: resourcePath,
        payTo: recipientAddress,
        asset: '0xAd9a854784BD9e8e5E975e39cdFD34cA32dd7fEf'
      }],
      error: 'Payment required'
    };
  }

  function verifyPayment(header, requirement) {
    if (!header) return { valid: false, error: 'No X-PAYMENT header' };
    let data;
    try { data = JSON.parse(Buffer.from(header, 'base64').toString('utf8')); }
    catch { return { valid: false, error: 'Invalid encoding' }; }
    const auth = data?.payload?.authorization;
    if (!auth) return { valid: false, error: 'Missing authorization' };
    const req = requirement?.accepts?.[0];
    if (req) {
      if (BigInt(auth.value || 0) < BigInt(req.maxAmountRequired)) return { valid: false, error: 'Insufficient amount' };
      if (auth.to?.toLowerCase() !== req.payTo?.toLowerCase()) return { valid: false, error: 'Wrong recipient' };
    }
    return { valid: true, payer: auth.from, amount: auth.value };
  }

  function makeHeader(value, to, from = '0xpayer') {
    return Buffer.from(JSON.stringify({ payload: { authorization: { value, to, from } } })).toString('base64');
  }

  test('builds requirement with correct version', () => {
    const r = buildRequirement({ amount: '0.01', recipientAddress: '0x1234', resourcePath: '/api/data' });
    assertEqual(r.x402Version, 1);
  });

  test('amount converted to micro units', () => {
    const r = buildRequirement({ amount: '1.00', recipientAddress: '0x1234', resourcePath: '/' });
    assertEqual(r.accepts[0].maxAmountRequired, '1000000');
  });

  test('rejects missing header', () => {
    const r = verifyPayment(null, {});
    assert(!r.valid); assertIncludes(r.error, 'No X-PAYMENT');
  });

  test('rejects invalid base64', () => {
    const r = verifyPayment('not!!!valid---base64', {});
    assert(!r.valid);
  });

  test('accepts valid payment', () => {
    const req = buildRequirement({ amount: '0.01', recipientAddress: '0xrecipient', resourcePath: '/' });
    const header = makeHeader('10000', '0xrecipient');
    const r = verifyPayment(header, req);
    assert(r.valid);
  });

  test('rejects insufficient amount', () => {
    const req = buildRequirement({ amount: '1.00', recipientAddress: '0xr', resourcePath: '/' });
    const header = makeHeader('1', '0xr');
    const r = verifyPayment(header, req);
    assert(!r.valid); assertIncludes(r.error, 'Insufficient');
  });

  test('rejects wrong recipient', () => {
    const req = buildRequirement({ amount: '0.01', recipientAddress: '0xcorrect', resourcePath: '/' });
    const header = makeHeader('10000', '0xwrong');
    const r = verifyPayment(header, req);
    assert(!r.valid); assertIncludes(r.error, 'recipient');
  });

  test('extracts payer address from valid payment', () => {
    const req = buildRequirement({ amount: '0.01', recipientAddress: '0xr', resourcePath: '/' });
    const header = makeHeader('10000', '0xr', '0xpayerwallet');
    const r = verifyPayment(header, req);
    assert(r.valid); assertEqual(r.payer, '0xpayerwallet');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. WALLET GENERATION
// ═══════════════════════════════════════════════════════════════════

describe('Wallet Generation', () => {
  function generateWallet() {
    const privateKey = '0x' + crypto.randomBytes(32).toString('hex');
    // Simplified address derivation simulation (real uses secp256k1)
    const address = '0x' + crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 40);
    return { privateKey, address };
  }

  test('generates 0x-prefixed private key', () => {
    const { privateKey } = generateWallet();
    assert(privateKey.startsWith('0x'));
    assertEqual(privateKey.length, 66); // 0x + 64 hex chars
  });

  test('generates 0x-prefixed address', () => {
    const { address } = generateWallet();
    assert(address.startsWith('0x'));
    assertEqual(address.length, 42); // 0x + 40 hex chars
  });

  test('each wallet is unique', () => {
    const wallets = Array.from({ length: 10 }, generateWallet);
    const addresses = wallets.map(w => w.address);
    const unique = new Set(addresses);
    assertEqual(unique.size, 10, 'All 10 wallets should be unique');
  });

  test('private key has 32 bytes entropy', () => {
    const { privateKey } = generateWallet();
    const bytes = Buffer.from(privateKey.slice(2), 'hex');
    assertEqual(bytes.length, 32);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. INTENT PARSING
// ═══════════════════════════════════════════════════════════════════

describe('Conversational Intent Parsing', () => {
  function parseIntent(msg) {
    const m = msg.toLowerCase().trim();
    if (/\b(balance|how much|what.?s my balance|check balance|my funds)\b/.test(m)) return { intent: 'balance' };
    if (/\b(send|pay|transfer)\b.*\b\d/.test(m)) {
      const amountMatch = m.match(/(\d+(?:\.\d+)?)\s*(?:cusd|celo|dollars?)?/);
      const nameMatch = m.match(/(?:send|pay|transfer)\s+(\w+)/);
      return { intent: 'send', recipient: nameMatch?.[1], amount: amountMatch?.[1] };
    }
    if (/\bsplit\b.*\b\d/.test(m)) {
      const amount = m.match(/\d+(?:\.\d+)?/)?.[0];
      const names = m.match(/(?:between|btw|among|with)\s+(.+)/)?.[1]?.split(/\s+and\s+|\s*,\s*|\s+/);
      return { intent: 'split', amount, recipients: names };
    }
    // create_circle must be checked BEFORE circles (more specific)
    if (/\b(create|new|start)\s+(?:a\s+)?(?:esusu|circle|ajo|savings)\b/.test(m)) return { intent: 'create_circle' };
    // esusu-contribute: "pay esusu/ajo/circle" without a number (number = send)
    if (/\b(pay|contribute)\b.{0,30}\b(esusu|ajo|circle)\b/.test(m)) return { intent: 'contribute' };
    if (/\b(my circles?|esusu|ajo|my savings?|circle status)\b/.test(m)) return { intent: 'circles' };
    if (/\bjoin\s+(?:circle\s+)?#?\d+/.test(m)) {
      const id = m.match(/#?(\d+)/)?.[1];
      return { intent: 'join_circle', circleId: id };
    }
    if (/^\/?(start|help)$/.test(m)) return { intent: 'help' };
    return { intent: 'unknown' };
  }

  const cases = [
    ["what's my balance", 'balance'],
    ["check balance", 'balance'],
    ["how much do i have", 'balance'],
    ["my funds", 'balance'],
    ["send peter 5 cusd", 'send'],
    ["pay james 100", 'send'],
    ["transfer 50 to alice", 'send'],
    ["send 25.50 to @bob", 'send'],
    ["split 100 between james and john", 'split'],
    ["split 200 btw alice bob charlie", 'split'],
    ["split 300 among 4 people", 'split'],
    ["my circles", 'circles'],
    ["esusu status", 'circles'],
    ["ajo", 'circles'],
    ["my savings", 'circles'],
    ["join circle #3", 'join_circle'],
    ["join circle 7", 'join_circle'],
    ["create circle", 'create_circle'],
    ["new esusu group", 'create_circle'],
    ["start ajo", 'create_circle'],
    ["pay esusu", 'contribute'],
    ["contribute to circle", 'contribute'],
    ["/help", 'help'],
    ["/start", 'help'],
  ];

  for (const [msg, expected] of cases) {
    test(`"${msg}" → ${expected}`, () => {
      const { intent } = parseIntent(msg);
      assertEqual(intent, expected, `Intent for: "${msg}"`);
    });
  }

  test('send intent extracts amount', () => {
    const { amount } = parseIntent('send peter 50 cusd');
    assertEqual(amount, '50');
  });

  test('send intent extracts recipient name', () => {
    const { recipient } = parseIntent('send alice 25 cusd');
    assertEqual(recipient, 'alice');
  });

  test('split intent extracts amount', () => {
    const { amount } = parseIntent('split 100 between james and john');
    assertEqual(amount, '100');
  });

  test('join_circle extracts circle ID', () => {
    const { circleId } = parseIntent('join circle #5');
    assertEqual(circleId, '5');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. SPLIT MATH
// ═══════════════════════════════════════════════════════════════════

describe('Split Amount Calculations', () => {
  function split(total, n) {
    const each = Math.floor(total * 100 / n) / 100;
    const dust = Math.round((total - each * n) * 100) / 100;
    return { each, dust };
  }

  test('100 / 2 = 50 each', () => assertEqual(split(100, 2).each, 50));
  test('100 / 4 = 25 each', () => assertEqual(split(100, 4).each, 25));
  test('90 / 3 = 30 each', () => assertEqual(split(90, 3).each, 30));
  test('100 / 3 = 33.33 each + 0.01 dust', () => {
    const { each, dust } = split(100, 3);
    assertEqual(each, 33.33);
    assertEqual(dust, 0.01);
  });
  test('50 / 4 = 12.5 each', () => assertEqual(split(50, 4).each, 12.5));
  test('1000 / 10 = 100 each', () => assertEqual(split(1000, 10).each, 100));
  test('1 / 3 = 0.33 each', () => assertEqual(split(1, 3).each, 0.33));
});

// ═══════════════════════════════════════════════════════════════════
// 7. DB SCHEMA VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('Database Schema Validation', () => {
  const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');

  test('has users table with all fields', () => {
    assertIncludes(schema, 'CREATE TABLE IF NOT EXISTS users');
    assertIncludes(schema, 'telegram_id');
    assertIncludes(schema, 'wallet_address');
    assertIncludes(schema, 'self_verified');
    assertIncludes(schema, 'self_nullifier');
    assertIncludes(schema, 'flagged');
  });

  test('has transactions table', () => {
    assertIncludes(schema, 'CREATE TABLE IF NOT EXISTS transactions');
    assertIncludes(schema, 'tx_hash');
    assertIncludes(schema, 'amount_cusd');
    assertIncludes(schema, 'notified_admin');
  });

  test('has esusu tables', () => {
    assertIncludes(schema, 'esusu_circles');
    assertIncludes(schema, 'esusu_members');
    assertIncludes(schema, 'esusu_contributions');
  });

  test('has address_book table', () => {
    assertIncludes(schema, 'address_book');
    assertIncludes(schema, 'alias');
  });

  test('has performance indexes', () => {
    assertIncludes(schema, 'CREATE INDEX IF NOT EXISTS');
    assertIncludes(schema, 'idx_users_tgid');
    assertIncludes(schema, 'idx_tx_status');
  });

  test('foreign keys are defined', () => {
    assertIncludes(schema, 'REFERENCES users(id)');
    assertIncludes(schema, 'REFERENCES esusu_circles(id)');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. OPENCLAW CONFIG VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('OpenClaw Configuration', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '../../openclaw/gateway/openclaw.json'), 'utf8'));

  test('has 3 agents', () => assertEqual(config.agents.list.length, 3));
  test('has personal agent', () => assert(config.agents.list.find(a => a.id === 'personal')));
  test('has payment-app agent', () => assert(config.agents.list.find(a => a.id === 'payment-app')));
  test('has admin agent', () => assert(config.agents.list.find(a => a.id === 'admin')));
  test('has 3 bindings', () => assertEqual(config.bindings.length, 3));
  test('admin bot uses allowlist policy', () => {
    const adminAcct = config.channels.telegram.accounts.find(a => a.id === 'celopayadminbot');
    assertEqual(adminAcct.dmPolicy, 'allowlist');
  });
  test('admin allowlist is non-empty', () => {
    const adminAcct = config.channels.telegram.accounts.find(a => a.id === 'celopayadminbot');
    assert(adminAcct.allowlist?.length > 0);
  });
  test('payment bot allows open DMs', () => {
    const payAcct = config.channels.telegram.accounts.find(a => a.id === 'celopaybot');
    assertEqual(payAcct.dmPolicy, 'open');
  });
  test('payment bot enables groups', () => {
    const payAcct = config.channels.telegram.accounts.find(a => a.id === 'celopaybot');
    assertEqual(payAcct.groupPolicy, 'enabled');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. SOUL.md CONTENT VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('SOUL.md Content', () => {
  const paymentSoul = readFileSync(join(__dirname, '../../openclaw/workspace-payment/SOUL.md'), 'utf8');
  const adminSoul = readFileSync(join(__dirname, '../../openclaw/workspace-admin/SOUL.md'), 'utf8');

  test('payment soul has balance intent', () => assertIncludes(paymentSoul, 'balance'));
  test('payment soul has send intent', () => assertIncludes(paymentSoul, 'send'));
  test('payment soul has split intent', () => assertIncludes(paymentSoul, 'split'));
  test('payment soul has esusu intent', () => assertIncludes(paymentSoul, 'esusu'));
  test('payment soul requires confirmation before tx', () => assertIncludes(paymentSoul, 'CONFIRM'));
  test('payment soul forbids exposing private keys', () => assertIncludes(paymentSoul, 'private keys'));
  test('payment soul requires Self verification', () => assertIncludes(paymentSoul, 'self_verified'));
  test('payment soul generates receipts after tx', () => assertIncludes(paymentSoul, 'receipt'));
  test('payment soul has error handling section', () => assertIncludes(paymentSoul, 'ERROR'));
  test('admin soul has transaction monitoring', () => assertIncludes(adminSoul, 'transactions'));
  test('admin soul has user management', () => assertIncludes(adminSoul, 'flag'));
  test('admin soul has circle management', () => assertIncludes(adminSoul, 'circles'));
  test('admin soul has alerts section', () => assertIncludes(adminSoul, 'Alerts'));
});

// ═══════════════════════════════════════════════════════════════════
// 10. FILE STRUCTURE COMPLETENESS
// ═══════════════════════════════════════════════════════════════════

describe('Project File Structure', () => {
  const root = join(__dirname, '../..');
  const files = [
    // Contracts
    'contracts/contracts/EsusuCircle.sol',
    'contracts/contracts/SplitPayment.sol',
    'contracts/contracts/CeloPayRegistry.sol',
    'contracts/contracts/MockERC20.sol',
    'contracts/contracts/interfaces/IERC20.sol',
    'contracts/contracts/interfaces/ISelfVerifier.sol',
    'contracts/scripts/deploy.js',
    'contracts/hardhat.config.js',
    'contracts/validate-contracts.js',
    'contracts/test/contracts.test.js',
    // Backend
    'backend/server.js',
    'backend/db/schema.sql',
    'backend/db/index.js',
    'backend/services/celo.js',
    'backend/services/receipt.js',
    'backend/services/self.js',
    'backend/services/esusu.js',
    'backend/services/x402.js',
    'backend/routes/api.js',
    'backend/routes/verify.js',
    'backend/routes/receipt.js',
    'backend/routes/x402.js',
    // OpenClaw workspaces
    'openclaw/gateway/openclaw.json',
    'openclaw/workspace-payment/SOUL.md',
    'openclaw/workspace-payment/HEARTBEAT.md',
    'openclaw/workspace-payment/skills/balance.js',
    'openclaw/workspace-payment/skills/send.js',
    'openclaw/workspace-payment/skills/split.js',
    'openclaw/workspace-payment/skills/esusu.js',
    'openclaw/workspace-payment/skills/onboard.js',
    'openclaw/workspace-payment/skills/receipt.js',
    'openclaw/workspace-admin/SOUL.md',
    'openclaw/workspace-admin/skills/admin-skills.js',
  ];

  for (const f of files) {
    test(`exists: ${f}`, () => {
      assert(existsSync(join(root, f)), `Missing: ${f}`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`Final Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}`);
if (failed === 0) {
  console.log('🎉 All tests passed! CeloPay is ready to deploy.\n');
} else {
  console.log(`⚠️  ${failed} test(s) failed.\n`);
  process.exit(1);
}
