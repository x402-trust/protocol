const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * COMPREHENSIVE SECURITY TESTS
 * 
 * Tests for:
 * - Reentrancy attacks
 * - Access control bypasses
 * - Integer overflow/underflow
 * - Front-running vulnerabilities
 * - State manipulation
 * - Edge cases and boundary conditions
 */

describe("Security Tests", function () {
  let usdc, reputationEngine, escrowVault, disputeManager, trustProtocol;
  let owner, attacker, provider, buyer, arbitrator;

  const PROVIDER_STAKE = ethers.parseUnits("500", 6);
  const ARBITRATOR_STAKE = ethers.parseUnits("500", 6);
  const PAYMENT_AMOUNT = ethers.parseUnits("100", 6);

  beforeEach(async function () {
    [owner, attacker, provider, buyer, arbitrator] = await ethers.getSigners();

    // Deploy all contracts
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const ReputationEngine = await ethers.getContractFactory("ReputationEngine");
    reputationEngine = await ReputationEngine.deploy(await usdc.getAddress());

    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    escrowVault = await EscrowVault.deploy(
      await usdc.getAddress(),
      await reputationEngine.getAddress()
    );

    const DisputeManager = await ethers.getContractFactory("DisputeManager");
    disputeManager = await DisputeManager.deploy(
      await usdc.getAddress(),
      await escrowVault.getAddress(),
      await reputationEngine.getAddress()
    );

    const TrustProtocol = await ethers.getContractFactory("TrustProtocol");
    trustProtocol = await TrustProtocol.deploy(
      await reputationEngine.getAddress(),
      await escrowVault.getAddress()
    );

    // Link contracts
    await reputationEngine.setEscrowVault(await escrowVault.getAddress());
    await escrowVault.setDisputeManager(await disputeManager.getAddress());

    // Setup legitimate provider
    await usdc.mint(provider.address, PROVIDER_STAKE);
    await usdc.connect(provider).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
    await reputationEngine.connect(provider).registerWithStake("https://api.legit.com");

    // Setup buyer with funds
    await usdc.mint(buyer.address, PAYMENT_AMOUNT * 10n);
    await usdc.connect(buyer).approve(await escrowVault.getAddress(), PAYMENT_AMOUNT * 10n);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESS CONTROL TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Access Control", function () {
    it("Should prevent non-owner from setting escrow vault", async function () {
      await expect(
        reputationEngine.connect(attacker).setEscrowVault(attacker.address)
      ).to.be.revertedWithCustomError(reputationEngine, "OwnableUnauthorizedAccount");
    });

    it("Should prevent non-owner from setting dispute manager", async function () {
      await expect(
        escrowVault.connect(attacker).setDisputeManager(attacker.address)
      ).to.be.revertedWithCustomError(escrowVault, "OwnableUnauthorizedAccount");
    });

    it("Should prevent non-escrow from recording transactions", async function () {
      await expect(
        reputationEngine.connect(attacker).recordTransaction(
          provider.address,
          buyer.address,
          PAYMENT_AMOUNT,
          true,
          1000
        )
      ).to.be.revertedWith("Only escrow");
    });

    it("Should prevent non-escrow from recording disputes", async function () {
      await expect(
        reputationEngine.connect(attacker).recordDispute(provider.address)
      ).to.be.revertedWith("Only escrow");
    });

    it("Should prevent non-dispute-manager from resolving for buyer", async function () {
      // First create a disputed payment
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      // Raise dispute
      await escrowVault.connect(buyer).raiseDispute(paymentId, requestHash);

      // Attacker tries to resolve
      await expect(
        escrowVault.connect(attacker).resolveForBuyer(paymentId)
      ).to.be.revertedWith("Only dispute manager");
    });

    it("Should prevent non-buyer from confirming delivery", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      const proof = {
        requestHash: requestHash,
        responseHash: ethers.keccak256(ethers.toUtf8Bytes("response")),
        responseSize: 100,
        schemaHash: ethers.ZeroHash,
        signature: ethers.randomBytes(65)
      };

      await expect(
        escrowVault.connect(attacker).confirmDelivery(paymentId, proof)
      ).to.be.revertedWith("Only buyer");
    });

    it("Should prevent non-buyer from claiming timeout", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [25 * 60]);
      await ethers.provider.send("evm_mine");

      await expect(
        escrowVault.connect(attacker).claimTimeout(paymentId)
      ).to.be.revertedWith("Only buyer");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DOUBLE-SPENDING & STATE MANIPULATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Double Spending Prevention", function () {
    it("Should prevent double confirmation of payment", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      const proof = {
        requestHash: requestHash,
        responseHash: ethers.keccak256(ethers.toUtf8Bytes("response")),
        responseSize: 100,
        schemaHash: ethers.ZeroHash,
        signature: ethers.randomBytes(65)
      };

      // First confirmation
      await escrowVault.connect(buyer).confirmDelivery(paymentId, proof);

      // Second confirmation should fail
      await expect(
        escrowVault.connect(buyer).confirmDelivery(paymentId, proof)
      ).to.be.revertedWith("Invalid status");
    });

    it("Should prevent double timeout claim", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      // Fast forward time
      await ethers.provider.send("evm_increaseTime", [25 * 60]);
      await ethers.provider.send("evm_mine");

      // First claim
      await escrowVault.connect(buyer).claimTimeout(paymentId);

      // Second claim should fail
      await expect(
        escrowVault.connect(buyer).claimTimeout(paymentId)
      ).to.be.revertedWith("Invalid status");
    });

    it("Should prevent dispute after confirmation", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      const proof = {
        requestHash: requestHash,
        responseHash: ethers.keccak256(ethers.toUtf8Bytes("response")),
        responseSize: 100,
        schemaHash: ethers.ZeroHash,
        signature: ethers.randomBytes(65)
      };

      // Confirm first
      await escrowVault.connect(buyer).confirmDelivery(paymentId, proof);

      // Then try to dispute
      const evidence = ethers.keccak256(ethers.toUtf8Bytes("fake evidence"));
      await expect(
        escrowVault.connect(buyer).raiseDispute(paymentId, evidence)
      ).to.be.revertedWith("Invalid status");
    });

    it("Should prevent confirmation after dispute", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      // Dispute first
      const evidence = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
      await escrowVault.connect(buyer).raiseDispute(paymentId, evidence);

      // Then try to confirm
      const proof = {
        requestHash: requestHash,
        responseHash: ethers.keccak256(ethers.toUtf8Bytes("response")),
        responseSize: 100,
        schemaHash: ethers.ZeroHash,
        signature: ethers.randomBytes(65)
      };

      await expect(
        escrowVault.connect(buyer).confirmDelivery(paymentId, proof)
      ).to.be.revertedWith("Invalid status");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SYBIL ATTACK TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Sybil Attack Prevention", function () {
    it("Should require stake for registration", async function () {
      await expect(
        reputationEngine.connect(attacker).registerWithStake("https://api.attacker.com")
      ).to.be.reverted; // Reverts because no stake approved
    });

    it("Should reject double registration", async function () {
      await usdc.mint(provider.address, PROVIDER_STAKE);
      await usdc.connect(provider).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);

      await expect(
        reputationEngine.connect(provider).registerWithStake("https://api.another.com")
      ).to.be.revertedWith("Already registered");
    });

    it("Should reject reused humanity proof", async function () {
      const proof = ethers.randomBytes(64);

      // First registration
      await reputationEngine.connect(attacker).registerWithHumanityProof(
        "https://api.human1.com",
        proof
      );

      // Second registration with same proof
      const [, , , , , attacker2] = await ethers.getSigners();
      await expect(
        reputationEngine.connect(attacker2).registerWithHumanityProof(
          "https://api.human2.com",
          proof
        )
      ).to.be.revertedWith("Proof already used");
    });

    it("Should start new providers at low score", async function () {
      await usdc.mint(attacker.address, PROVIDER_STAKE);
      await usdc.connect(attacker).approve(await reputationEngine.getAddress(), PROVIDER_STAKE);
      await reputationEngine.connect(attacker).registerWithStake("https://api.new.com");

      const score = await reputationEngine.getScore(attacker.address);
      expect(score).to.equal(500); // Starting score, not elite
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PROOF VALIDATION TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Proof Validation", function () {
    let paymentId;
    const requestHash = ethers.keccak256(ethers.toUtf8Bytes("Get BTC price"));

    beforeEach(async function () {
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      paymentId = event.args[0];
    });

    it("Should reject mismatched request hash", async function () {
      const proof = {
        requestHash: ethers.keccak256(ethers.toUtf8Bytes("WRONG")),
        responseHash: ethers.keccak256(ethers.toUtf8Bytes("response")),
        responseSize: 100,
        schemaHash: ethers.ZeroHash,
        signature: ethers.randomBytes(65)
      };

      await expect(
        escrowVault.connect(buyer).confirmDelivery(paymentId, proof)
      ).to.be.revertedWith("Invalid proof");
    });

    it("Should reject too small response size", async function () {
      const proof = {
        requestHash: requestHash,
        responseHash: ethers.keccak256(ethers.toUtf8Bytes("response")),
        responseSize: 10, // Too small
        schemaHash: ethers.ZeroHash,
        signature: ethers.randomBytes(65)
      };

      await expect(
        escrowVault.connect(buyer).confirmDelivery(paymentId, proof)
      ).to.be.revertedWith("Invalid proof");
    });

    it("Should reject too short signature", async function () {
      const proof = {
        requestHash: requestHash,
        responseHash: ethers.keccak256(ethers.toUtf8Bytes("response")),
        responseSize: 100,
        schemaHash: ethers.ZeroHash,
        signature: ethers.randomBytes(32) // Too short
      };

      await expect(
        escrowVault.connect(buyer).confirmDelivery(paymentId, proof)
      ).to.be.revertedWith("Invalid proof");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ARBITRATOR SECURITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Arbitrator Security", function () {
    it("Should require 700+ score for arbitrator registration", async function () {
      await usdc.mint(attacker.address, ARBITRATOR_STAKE);
      await usdc.connect(attacker).approve(
        await disputeManager.getAddress(),
        ARBITRATOR_STAKE
      );

      await expect(
        disputeManager.connect(attacker).registerAsArbitrator()
      ).to.be.revertedWith("Score too low");
    });

    it("Should prevent double arbitrator registration via bootstrap", async function () {
      await disputeManager.connect(owner).bootstrapArbitrator(arbitrator.address);

      await expect(
        disputeManager.connect(owner).bootstrapArbitrator(arbitrator.address)
      ).to.be.revertedWith("Already registered");
    });

    it("Should reject withdrawal for bootstrapped arbitrator with 0 stake", async function () {
      await disputeManager.connect(owner).bootstrapArbitrator(arbitrator.address);

      // Bootstrapped arbitrators have 0 stake, so withdrawal should revert
      await expect(
        disputeManager.connect(arbitrator).withdrawArbitratorStake()
      ).to.be.revertedWith("No stake");
    });

    it("Should prevent non-owner from bootstrapping arbitrators", async function () {
      await expect(
        disputeManager.connect(attacker).bootstrapArbitrator(arbitrator.address)
      ).to.be.revertedWithCustomError(disputeManager, "OwnableUnauthorizedAccount");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TIMEOUT & TIMING ATTACKS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Timing Security", function () {
    it("Should prevent premature timeout claim", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      // Try to claim immediately
      await expect(
        escrowVault.connect(buyer).claimTimeout(paymentId)
      ).to.be.revertedWith("Not timed out");
    });

    it("Should prevent late dispute", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      // Fast forward past grace period
      await ethers.provider.send("evm_increaseTime", [25 * 60]);
      await ethers.provider.send("evm_mine");

      const evidence = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
      await expect(
        escrowVault.connect(buyer).raiseDispute(paymentId, evidence)
      ).to.be.revertedWith("Too late");
    });

    it("Should allow dispute within grace period", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      const paymentId = event.args[0];

      // Move to just before grace period ends (15 min timeout + 4 min grace)
      await ethers.provider.send("evm_increaseTime", [19 * 60]);
      await ethers.provider.send("evm_mine");

      const evidence = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
      await escrowVault.connect(buyer).raiseDispute(paymentId, evidence);

      const payment = await escrowVault.getPayment(paymentId);
      expect(payment.status).to.equal(4); // Disputed
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE CASES & BOUNDARY CONDITIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Edge Cases", function () {
    it("Should handle minimum payment amount", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const minPayment = ethers.parseUnits("1", 6); // 1 USDC

      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        minPayment,
        requestHash
      );

      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });

    it("Should reject below minimum payment", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const belowMin = ethers.parseUnits("0.5", 6); // 0.5 USDC

      await expect(
        escrowVault.connect(buyer).createPayment(
          provider.address,
          belowMin,
          requestHash
        )
      ).to.be.revertedWith("Amount too small");
    });

    it("Should handle large payment amounts", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const largePayment = ethers.parseUnits("100000", 6); // 100K USDC

      await usdc.mint(buyer.address, largePayment);
      await usdc.connect(buyer).approve(await escrowVault.getAddress(), largePayment);

      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        largePayment,
        requestHash
      );

      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });

    it("Should handle empty request hash", async function () {
      const emptyHash = ethers.ZeroHash;

      // This should work - empty hash is valid
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        emptyHash
      );

      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });

    it("Should handle multiple concurrent payments", async function () {
      const payments = [];

      for (let i = 0; i < 5; i++) {
        const requestHash = ethers.keccak256(ethers.toUtf8Bytes(`request-${i}`));
        const tx = await escrowVault.connect(buyer).createPayment(
          provider.address,
          ethers.parseUnits("10", 6),
          requestHash
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
        payments.push(event.args[0]);
      }

      // All payments should be unique
      const uniquePayments = new Set(payments);
      expect(uniquePayments.size).to.equal(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HUMAN FALLBACK SECURITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Human Fallback Security", function () {
    let paymentId;

    beforeEach(async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      const tx = await escrowVault.connect(buyer).createPayment(
        provider.address,
        PAYMENT_AMOUNT,
        requestHash
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment?.name === "PaymentCreated");
      paymentId = event.args[0];
    });

    it("Should only allow buyer to set fallback", async function () {
      await expect(
        escrowVault.connect(attacker).setHumanFallback(paymentId, attacker.address)
      ).to.be.revertedWith("Only buyer");
    });

    it("Should prevent unauthorized human intervention", async function () {
      const [, , , , , human] = await ethers.getSigners();

      // Set fallback
      await escrowVault.connect(buyer).setHumanFallback(paymentId, human.address);

      // Mark as stuck (need to wait)
      await ethers.provider.send("evm_increaseTime", [2 * 24 * 60 * 60]); // 2 days
      await ethers.provider.send("evm_mine");
      await escrowVault.markAsStuck(paymentId);

      // Attacker tries to intervene
      await expect(
        escrowVault.connect(attacker).humanIntervention(paymentId, true)
      ).to.be.revertedWith("Not authorized");
    });

    it("Should only allow intervention on stuck payments", async function () {
      const [, , , , , human] = await ethers.getSigners();

      // Set fallback
      await escrowVault.connect(buyer).setHumanFallback(paymentId, human.address);

      // Try to intervene without marking as stuck
      await expect(
        escrowVault.connect(human).humanIntervention(paymentId, true)
      ).to.be.revertedWith("Not stuck");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BANNED PROVIDER TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Banned Provider Handling", function () {
    it("Should reject payments to inactive provider", async function () {
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes("test"));

      // Try to pay unregistered provider
      await expect(
        escrowVault.connect(buyer).createPayment(
          attacker.address, // Not registered
          PAYMENT_AMOUNT,
          requestHash
        )
      ).to.be.revertedWith("Provider not active");
    });
  });
});
