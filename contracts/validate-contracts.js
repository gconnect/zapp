/**
 * CeloPay Contract Logic Validator
 * Validates business logic of smart contracts without requiring a blockchain
 * Run with: node validate-contracts.js
 */

let passed = 0;
let failed = 0;

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

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "Not equal"}: expected ${b}, got ${a}`);
}

// ─── Simulate EsusuCircle Logic ──────────────────────────────────────────────

class EsusuCircleSimulator {
  constructor() {
    this.circles = {};
    this.circleCount = 0;
  }

  createCircle(name, contributionAmount, intervalDays, maxMembers, admin) {
    if (contributionAmount <= 0) throw new Error("InvalidAmount");
    if (maxMembers < 2) throw new Error("InvalidAmount");
    const id = ++this.circleCount;
    this.circles[id] = {
      id, name, admin,
      contributionAmount,
      intervalDays,
      maxMembers,
      currentRound: 1,
      nextPayoutTime: Date.now() + intervalDays * 86400000,
      active: true,
      members: [admin],
      isMember: { [admin]: true },
      roundPaid: { 1: {} },
      roundContributions: { 1: 0 },
      roundRecipient: {},
      balances: {},
      contractBalance: 0
    };
    return id;
  }

  joinCircle(circleId, member) {
    const c = this.circles[circleId];
    if (!c.active) throw new Error("CircleNotActive");
    if (c.isMember[member]) throw new Error("AlreadyMember");
    if (c.members.length >= c.maxMembers) throw new Error("CircleFull");
    c.members.push(member);
    c.isMember[member] = true;
  }

  contribute(circleId, member, walletBalance) {
    const c = this.circles[circleId];
    if (!c.active) throw new Error("CircleNotActive");
    if (!c.isMember[member]) throw new Error("NotMember");
    if (c.roundPaid[c.currentRound][member]) throw new Error("AlreadyPaidThisRound");
    if (walletBalance < c.contributionAmount) throw new Error("InsufficientBalance");

    c.roundPaid[c.currentRound][member] = true;
    c.roundContributions[c.currentRound] += c.contributionAmount;
    c.contractBalance += c.contributionAmount;
    return walletBalance - c.contributionAmount;
  }

  allPaid(circleId) {
    const c = this.circles[circleId];
    return c.members.every(m => c.roundPaid[c.currentRound][m]);
  }

  releasePayout(circleId, recipient, admin, now = Date.now()) {
    const c = this.circles[circleId];
    if (c.admin !== admin) throw new Error("NotAdmin");
    if (!this.allPaid(circleId)) throw new Error("RoundNotComplete");
    if (now < c.nextPayoutTime) throw new Error("PayoutNotDue");
    if (!c.isMember[recipient]) throw new Error("NotMember");

    const pot = c.roundContributions[c.currentRound];
    c.roundRecipient[c.currentRound] = recipient;
    c.contractBalance -= pot;
    const round = c.currentRound;
    c.currentRound++;
    c.nextPayoutTime = now + c.intervalDays * 86400000;
    c.roundPaid[c.currentRound] = {};
    c.roundContributions[c.currentRound] = 0;

    if (c.currentRound > c.members.length) {
      c.active = false;
    }

    return { pot, round };
  }
}

// ─── Simulate SplitPayment Logic ─────────────────────────────────────────────

class SplitPaymentSimulator {
  splitEqual(recipients, totalAmount, payerBalance) {
    if (recipients.length === 0) throw new Error("NoRecipients");
    if (totalAmount <= 0) throw new Error("ZeroAmount");
    if (payerBalance < totalAmount) throw new Error("InsufficientBalance");

    const amountEach = Math.floor(totalAmount / recipients.length);
    if (amountEach === 0) throw new Error("ZeroAmount");

    const dust = totalAmount - amountEach * recipients.length;
    const result = {};
    for (const r of recipients) result[r] = amountEach;
    return { result, dust, newPayerBalance: payerBalance - totalAmount + dust };
  }

  splitCustom(recipients, amounts, payerBalance) {
    if (recipients.length === 0) throw new Error("NoRecipients");
    if (recipients.length !== amounts.length) throw new Error("LengthMismatch");

    const total = amounts.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error("ZeroAmount");
    if (payerBalance < total) throw new Error("InsufficientBalance");

    const result = {};
    recipients.forEach((r, i) => result[r] = amounts[i]);
    return { result, total, newPayerBalance: payerBalance - total };
  }
}

// ─── Run Tests ───────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════╗");
console.log("║   CeloPay Contract Logic Validator       ║");
console.log("╚══════════════════════════════════════════╝\n");

// EsusuCircle Tests
console.log("📋 EsusuCircle");
const esusu = new EsusuCircleSimulator();

test("creates circle with admin as first member", () => {
  const id = esusu.createCircle("Lagos Circle", 10, 7, 3, "admin");
  assertEqual(esusu.circles[id].members.length, 1, "Member count");
  assertEqual(esusu.circles[id].name, "Lagos Circle", "Name");
  assert(esusu.circles[id].active, "Should be active");
});

test("rejects zero contribution amount", () => {
  try { esusu.createCircle("Bad", 0, 7, 3, "admin"); assert(false, "Should throw"); }
  catch (e) { assert(e.message === "InvalidAmount"); }
});

test("rejects maxMembers < 2", () => {
  try { esusu.createCircle("Bad", 10, 7, 1, "admin"); assert(false); }
  catch (e) { assert(e.message === "InvalidAmount"); }
});

test("members can join circle", () => {
  const id = esusu.createCircle("Abuja Circle", 10, 7, 4, "admin2");
  esusu.joinCircle(id, "alice");
  esusu.joinCircle(id, "bob");
  assertEqual(esusu.circles[id].members.length, 3, "Member count");
});

test("rejects duplicate member", () => {
  const id = esusu.createCircle("Duplicate Test", 10, 7, 3, "admin3");
  try { esusu.joinCircle(id, "admin3"); assert(false); }
  catch (e) { assert(e.message === "AlreadyMember"); }
});

test("rejects joining full circle", () => {
  const id = esusu.createCircle("Full Circle", 10, 7, 2, "admin4");
  esusu.joinCircle(id, "member1");
  try { esusu.joinCircle(id, "member2"); assert(false); }
  catch (e) { assert(e.message === "CircleFull"); }
});

test("accepts contributions from all members", () => {
  const id = esusu.createCircle("Contribute Test", 10, 7, 3, "admin5");
  esusu.joinCircle(id, "m1");
  esusu.joinCircle(id, "m2");
  esusu.contribute(id, "admin5", 100);
  esusu.contribute(id, "m1", 100);
  esusu.contribute(id, "m2", 100);
  assertEqual(esusu.circles[id].roundContributions[1], 30, "Total contributions");
  assertEqual(esusu.circles[id].contractBalance, 30, "Contract balance");
});

test("rejects double contribution", () => {
  const id = esusu.createCircle("DoubleContrib", 10, 7, 2, "admin6");
  esusu.joinCircle(id, "m6");
  esusu.contribute(id, "admin6", 100);
  try { esusu.contribute(id, "admin6", 100); assert(false); }
  catch (e) { assert(e.message === "AlreadyPaidThisRound"); }
});

test("detects when all members have paid", () => {
  const id = esusu.createCircle("AllPaid", 10, 7, 2, "admin7");
  esusu.joinCircle(id, "m7");
  assert(!esusu.allPaid(id), "Not all paid yet");
  esusu.contribute(id, "admin7", 100);
  esusu.contribute(id, "m7", 100);
  assert(esusu.allPaid(id), "All paid");
});

test("releases payout after interval", () => {
  const id = esusu.createCircle("Payout", 10, 7, 2, "admin8");
  esusu.joinCircle(id, "m8");
  esusu.contribute(id, "admin8", 100);
  esusu.contribute(id, "m8", 100);
  const future = Date.now() + 8 * 86400000;
  const { pot } = esusu.releasePayout(id, "m8", "admin8", future);
  assertEqual(pot, 20, "Pot size");
  assertEqual(esusu.circles[id].currentRound, 2, "Round incremented");
  assertEqual(esusu.circles[id].contractBalance, 0, "Contract emptied");
});

test("rejects payout before interval", () => {
  const id = esusu.createCircle("EarlyPayout", 10, 7, 2, "admin9");
  esusu.joinCircle(id, "m9");
  esusu.contribute(id, "admin9", 100);
  esusu.contribute(id, "m9", 100);
  try { esusu.releasePayout(id, "m9", "admin9", Date.now() - 1); assert(false); }
  catch (e) { assert(e.message === "PayoutNotDue"); }
});

test("rejects payout when not all paid", () => {
  const id = esusu.createCircle("IncompletePayout", 10, 7, 2, "admin10");
  esusu.joinCircle(id, "m10");
  esusu.contribute(id, "admin10", 100);
  // m10 hasn't paid
  const future = Date.now() + 8 * 86400000;
  try { esusu.releasePayout(id, "m10", "admin10", future); assert(false); }
  catch (e) { assert(e.message === "RoundNotComplete"); }
});

test("closes circle after all members receive payout", () => {
  const id = esusu.createCircle("FullCircle", 10, 1, 2, "adm");
  esusu.joinCircle(id, "mX");
  let future = Date.now() + 2 * 86400000;

  // Round 1
  esusu.contribute(id, "adm", 100);
  esusu.contribute(id, "mX", 100);
  esusu.releasePayout(id, "adm", "adm", future);

  // Round 2
  esusu.contribute(id, "adm", 100);
  esusu.contribute(id, "mX", 100);
  future += 2 * 86400000;
  esusu.releasePayout(id, "mX", "adm", future);

  assert(!esusu.circles[id].active, "Circle should be closed");
});

// SplitPayment Tests
console.log("\n📋 SplitPayment");
const splitter = new SplitPaymentSimulator();

test("splits 100 equally between 2 recipients", () => {
  const { result } = splitter.splitEqual(["alice", "bob"], 100, 500);
  assertEqual(result["alice"], 50, "Alice amount");
  assertEqual(result["bob"], 50, "Bob amount");
});

test("splits 90 equally between 3 recipients", () => {
  const { result } = splitter.splitEqual(["a", "b", "c"], 90, 500);
  assertEqual(result["a"], 30);
  assertEqual(result["b"], 30);
  assertEqual(result["c"], 30);
});

test("handles dust from integer division", () => {
  const { result, dust } = splitter.splitEqual(["a", "b", "c"], 100, 500);
  // 100 / 3 = 33 each, dust = 1
  assertEqual(result["a"], 33);
  assertEqual(dust, 1, "Dust returned to payer");
});

test("rejects empty recipients list", () => {
  try { splitter.splitEqual([], 100, 500); assert(false); }
  catch (e) { assert(e.message === "NoRecipients"); }
});

test("rejects zero amount", () => {
  try { splitter.splitEqual(["alice"], 0, 500); assert(false); }
  catch (e) { assert(e.message === "ZeroAmount"); }
});

test("rejects insufficient payer balance", () => {
  try { splitter.splitEqual(["alice", "bob"], 1000, 50); assert(false); }
  catch (e) { assert(e.message === "InsufficientBalance"); }
});

test("custom split with different amounts", () => {
  const { result } = splitter.splitCustom(["james", "john"], [60, 40], 500);
  assertEqual(result["james"], 60);
  assertEqual(result["john"], 40);
});

test("rejects mismatched arrays", () => {
  try { splitter.splitCustom(["a"], [10, 20], 500); assert(false); }
  catch (e) { assert(e.message === "LengthMismatch"); }
});

test("split between 4 members (esusu scenario)", () => {
  const members = ["amaka", "tunde", "chidi", "ngozi"];
  const { result } = splitter.splitEqual(members, 400, 1000);
  for (const m of members) assertEqual(result[m], 100, `${m} gets 100`);
});

// ─── Integration Scenario ────────────────────────────────────────────────────
console.log("\n📋 Integration: Full Esusu Circle Lifecycle");

test("3-member esusu circle completes all 3 rounds", () => {
  const sim = new EsusuCircleSimulator();
  const id = sim.createCircle("Naija Savings", 50, 30, 3, "admin");
  sim.joinCircle(id, "peter");
  sim.joinCircle(id, "paul");

  const recipients = ["admin", "peter", "paul"];
  let now = Date.now();

  for (let round = 0; round < 3; round++) {
    for (const m of ["admin", "peter", "paul"]) {
      sim.contribute(id, m, 1000);
    }
    now += 31 * 86400000;
    const { pot } = sim.releasePayout(id, recipients[round], "admin", now);
    assertEqual(pot, 150, `Round ${round + 1} pot = 150`);
  }

  assert(!sim.circles[id].active, "Circle closed after 3 rounds");
  assertEqual(sim.circles[id].contractBalance, 0, "No funds left in contract");
});

test("conversation: 'send peter 5 cusd' → split(1 recipient, 5 cUSD)", () => {
  const { result } = splitter.splitCustom(["peter_wallet"], [5], 100);
  assertEqual(result["peter_wallet"], 5);
});

test("conversation: 'split 100 btw james and john' → splitEqual", () => {
  const { result } = splitter.splitEqual(["james_wallet", "john_wallet"], 100, 500);
  assertEqual(result["james_wallet"], 50);
  assertEqual(result["john_wallet"], 50);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(44)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("🎉 All contract logic tests passed!\n");
} else {
  console.log("⚠️  Some tests failed. Review above.\n");
  process.exit(1);
}
