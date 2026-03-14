const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("EsusuCircle", function () {
  let esusu, mockToken;
  let admin, member1, member2, member3;
  const CONTRIBUTION = ethers.parseUnits("10", 18); // 10 cUSD each
  const INTERVAL_DAYS = 7;
  const MAX_MEMBERS = 3;

  beforeEach(async function () {
    [admin, member1, member2, member3] = await ethers.getSigners();

    // Deploy mock ERC20 (simulates cUSD)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock cUSD", "cUSD");

    // Mint tokens to all members
    for (const signer of [admin, member1, member2, member3]) {
      await mockToken.mint(signer.address, ethers.parseUnits("1000", 18));
    }

    // Deploy EsusuCircle
    const EsusuCircle = await ethers.getContractFactory("EsusuCircle");
    esusu = await EsusuCircle.deploy();
  });

  describe("Circle Creation", function () {
    it("should create a circle and add admin as first member", async function () {
      await esusu.createCircle("Lagos Circle", mockToken.target, CONTRIBUTION, INTERVAL_DAYS, MAX_MEMBERS);
      const info = await esusu.getCircleInfo(1);
      expect(info.name).to.equal("Lagos Circle");
      expect(info.memberCount).to.equal(1n);
      expect(info.active).to.be.true;
    });

    it("should revert if contribution is zero", async function () {
      await expect(
        esusu.createCircle("Bad Circle", mockToken.target, 0, 7, 3)
      ).to.be.revertedWithCustomError(esusu, "InvalidAmount");
    });
  });

  describe("Member Management", function () {
    beforeEach(async function () {
      await esusu.createCircle("Test Circle", mockToken.target, CONTRIBUTION, INTERVAL_DAYS, MAX_MEMBERS);
    });

    it("should allow members to join", async function () {
      await esusu.connect(member1).joinCircle(1);
      const info = await esusu.getCircleInfo(1);
      expect(info.memberCount).to.equal(2n);
    });

    it("should revert if circle is full", async function () {
      await esusu.connect(member1).joinCircle(1);
      await esusu.connect(member2).joinCircle(1);
      await expect(esusu.connect(member3).joinCircle(1))
        .to.be.revertedWithCustomError(esusu, "CircleFull");
    });

    it("should revert if member tries to join twice", async function () {
      await expect(esusu.connect(admin).joinCircle(1))
        .to.be.revertedWithCustomError(esusu, "AlreadyMember");
    });
  });

  describe("Contributions", function () {
    beforeEach(async function () {
      await esusu.createCircle("Pay Circle", mockToken.target, CONTRIBUTION, INTERVAL_DAYS, MAX_MEMBERS);
      await esusu.connect(member1).joinCircle(1);
      await esusu.connect(member2).joinCircle(1);

      // Approve the contract to spend tokens
      for (const signer of [admin, member1, member2]) {
        await mockToken.connect(signer).approve(esusu.target, ethers.parseUnits("1000", 18));
      }
    });

    it("should accept contributions from members", async function () {
      await esusu.connect(admin).contribute(1);
      expect(await esusu.hasPaidThisRound(1, admin.address)).to.be.true;
    });

    it("should revert double contribution", async function () {
      await esusu.connect(admin).contribute(1);
      await expect(esusu.connect(admin).contribute(1))
        .to.be.revertedWithCustomError(esusu, "AlreadyPaidThisRound");
    });
  });

  describe("Payout", function () {
    beforeEach(async function () {
      await esusu.createCircle("Payout Circle", mockToken.target, CONTRIBUTION, INTERVAL_DAYS, MAX_MEMBERS);
      await esusu.connect(member1).joinCircle(1);
      await esusu.connect(member2).joinCircle(1);

      for (const signer of [admin, member1, member2]) {
        await mockToken.connect(signer).approve(esusu.target, ethers.parseUnits("1000", 18));
        await esusu.connect(signer).contribute(1);
      }
    });

    it("should release payout after interval passes", async function () {
      await time.increase(INTERVAL_DAYS * 24 * 60 * 60 + 1);
      const before = await mockToken.balanceOf(member1.address);
      await esusu.connect(admin).releasePayout(1, member1.address);
      const after = await mockToken.balanceOf(member1.address);
      expect(after - before).to.equal(CONTRIBUTION * 3n);
    });

    it("should revert payout before interval", async function () {
      await expect(esusu.connect(admin).releasePayout(1, member1.address))
        .to.be.revertedWithCustomError(esusu, "PayoutNotDue");
    });

    it("should increment round after payout", async function () {
      await time.increase(INTERVAL_DAYS * 24 * 60 * 60 + 1);
      await esusu.connect(admin).releasePayout(1, member1.address);
      const info = await esusu.getCircleInfo(1);
      expect(info.currentRound).to.equal(2n);
    });
  });
});

describe("SplitPayment", function () {
  let split, mockToken;
  let payer, alice, bob, charlie;

  beforeEach(async function () {
    [payer, alice, bob, charlie] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock cUSD", "cUSD");
    await mockToken.mint(payer.address, ethers.parseUnits("1000", 18));

    const SplitPayment = await ethers.getContractFactory("SplitPayment");
    split = await SplitPayment.deploy();

    await mockToken.connect(payer).approve(split.target, ethers.parseUnits("1000", 18));
  });

  describe("Equal Split", function () {
    it("should split 100 cUSD equally between 2 recipients", async function () {
      const total = ethers.parseUnits("100", 18);
      const beforeAlice = await mockToken.balanceOf(alice.address);
      const beforeBob = await mockToken.balanceOf(bob.address);

      await split.connect(payer).splitEqual(
        mockToken.target,
        [alice.address, bob.address],
        total,
        "Dinner split"
      );

      expect(await mockToken.balanceOf(alice.address) - beforeAlice).to.equal(ethers.parseUnits("50", 18));
      expect(await mockToken.balanceOf(bob.address) - beforeBob).to.equal(ethers.parseUnits("50", 18));
    });

    it("should split among 3 recipients", async function () {
      const total = ethers.parseUnits("90", 18);
      await split.connect(payer).splitEqual(
        mockToken.target,
        [alice.address, bob.address, charlie.address],
        total,
        "3-way split"
      );
      expect(await mockToken.balanceOf(alice.address)).to.equal(ethers.parseUnits("30", 18));
    });
  });

  describe("Custom Split", function () {
    it("should split with custom amounts", async function () {
      const amounts = [ethers.parseUnits("60", 18), ethers.parseUnits("40", 18)];
      await split.connect(payer).splitCustom(
        mockToken.target,
        [alice.address, bob.address],
        amounts,
        "Custom split"
      );
      expect(await mockToken.balanceOf(alice.address)).to.equal(amounts[0]);
      expect(await mockToken.balanceOf(bob.address)).to.equal(amounts[1]);
    });

    it("should revert if lengths mismatch", async function () {
      await expect(
        split.connect(payer).splitCustom(
          mockToken.target,
          [alice.address],
          [ethers.parseUnits("50", 18), ethers.parseUnits("50", 18)],
          "bad"
        )
      ).to.be.revertedWithCustomError(split, "LengthMismatch");
    });
  });

  describe("Direct Pay", function () {
    it("should pay a single recipient", async function () {
      const amount = ethers.parseUnits("25", 18);
      await split.connect(payer).pay(mockToken.target, alice.address, amount, "Payment to alice");
      expect(await mockToken.balanceOf(alice.address)).to.equal(amount);
    });
  });
});
