/**
 * x402 Trust Protocol — Demo Flow
 * 
 * Demonstrates the complete payment flow with trust scoring.
 * Run: node scripts/demo-flow.js
 */

const hre = require("hardhat");

// Deployed contract addresses (Arc Testnet)
const CONTRACTS = {
    TRUST_PROTOCOL: "0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F",
    REPUTATION_ENGINE: "0x86fa599c4474E8098400e57760543E7191B2DA1e",
    ESCROW_VAULT: "0x35D3d7Ff317bca17a123D8B18923599Ac1F9d817",
    USDC: "0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B"
};

async function main() {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║         x402 Trust Protocol — Agent Demo Flow            ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    const [agent] = await hre.ethers.getSigners();
    console.log(`Agent: ${agent.address}\n`);

    // Connect to deployed contracts
    const reputationEngine = await hre.ethers.getContractAt(
        "ReputationEngine",
        CONTRACTS.REPUTATION_ENGINE
    );

    // Demo providers (simulated)
    const providers = {
        trusted: "0x1111111111111111111111111111111111111111",
        unknown: "0x2222222222222222222222222222222222222222",
        risky: "0x3333333333333333333333333333333333333333"
    };

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 1: Check Provider Trust Scores");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Get contract constants
    const INITIAL_SCORE = await reputationEngine.INITIAL_SCORE();
    const MIN_SCORE = await reputationEngine.MIN_SCORE();
    const MAX_SCORE = await reputationEngine.MAX_SCORE();

    console.log(`System Parameters:`);
    console.log(`  Initial Score: ${INITIAL_SCORE}`);
    console.log(`  Min Score: ${MIN_SCORE}`);
    console.log(`  Max Score: ${MAX_SCORE}\n`);

    // Simulate checking providers
    const checkProvider = (address, score) => {
        let tier, escrowRequired, recommendation;

        if (score >= 850) {
            tier = "Elite";
            escrowRequired = false;
            recommendation = "✅ SAFE - Direct payment OK";
        } else if (score >= 700) {
            tier = "Good";
            escrowRequired = false;
            recommendation = "✅ RECOMMENDED - Escrow optional";
        } else if (score >= 500) {
            tier = "Standard";
            escrowRequired = true;
            recommendation = "⚠️ CAUTION - Escrow required";
        } else if (score >= 400) {
            tier = "Fair";
            escrowRequired = true;
            recommendation = "⚠️ HIGH RISK - Extra scrutiny";
        } else {
            tier = "Poor";
            escrowRequired = true;
            recommendation = "❌ AVOID - Very high risk";
        }

        console.log(`Provider: ${address.slice(0, 10)}...`);
        console.log(`  Score: ${score} (${tier})`);
        console.log(`  Escrow: ${escrowRequired ? "Required" : "Optional"}`);
        console.log(`  Decision: ${recommendation}\n`);

        return { tier, escrowRequired };
    };

    // Check different providers
    checkProvider(providers.trusted, 780);
    checkProvider(providers.unknown, 500);
    checkProvider(providers.risky, 350);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 2: Simulate Payment Flow");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    const paymentAmount = 5_000000; // 5 USDC
    const selectedProvider = providers.trusted;

    console.log(`Payment Request:`);
    console.log(`  Provider: ${selectedProvider.slice(0, 10)}...`);
    console.log(`  Amount: ${paymentAmount / 1e6} USDC`);
    console.log(`  Request: "Get BTC/USDC price"\n`);

    console.log(`Flow:`);
    console.log(`  1. Agent checks provider → Score: 780 (Good) ✅`);
    console.log(`  2. Score >= 700 → Escrow optional`);
    console.log(`  3. Agent creates payment → PaymentID: 0xabc123...`);
    console.log(`  4. Provider delivers service`);
    console.log(`  5. Agent confirms delivery → Funds released`);
    console.log(`  6. Provider score updated → 785 (+5)\n`);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 3: Trust Tier System");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("Score Tiers:");
    console.log("┌─────────────┬───────────────┬─────────────────────┐");
    console.log("│ Score Range │ Tier          │ Escrow Requirement  │");
    console.log("├─────────────┼───────────────┼─────────────────────┤");
    console.log("│ 850-900     │ Elite         │ None                │");
    console.log("│ 700-849     │ Good          │ Optional            │");
    console.log("│ 500-699     │ Standard      │ Required            │");
    console.log("│ 400-499     │ Fair          │ Required + Scrutiny │");
    console.log("│ 300-399     │ Poor          │ Required + Warning  │");
    console.log("└─────────────┴───────────────┴─────────────────────┘\n");

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 4: Sybil Resistance");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("Anti-Gaming Measures:");
    console.log("  • Score > 600 requires: 7 days minimum account age");
    console.log("  • Score > 700 requires: 30 days minimum");
    console.log("  • Score > 800 requires: 60 days minimum");
    console.log("  • Daily growth limit: +5 points max");
    console.log("  • Burst detection: 30 tx/min = flag, 100 tx/min = quarantine");
    console.log("  • Wash trading: A→B→A flows detected and flagged\n");

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("STEP 5: Contract Verification");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("Deployed Contracts (Arc Testnet):");
    console.log(`  TrustProtocol:    ${CONTRACTS.TRUST_PROTOCOL}`);
    console.log(`  ReputationEngine: ${CONTRACTS.REPUTATION_ENGINE}`);
    console.log(`  EscrowVault:      ${CONTRACTS.ESCROW_VAULT}`);
    console.log(`  MockUSDC:         ${CONTRACTS.USDC}\n`);

    console.log("Verify with:");
    console.log(`  cast call ${CONTRACTS.REPUTATION_ENGINE} "INITIAL_SCORE()" --rpc-url https://rpc.testnet.arc.network\n`);

    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║                    Demo Complete! 🎉                     ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    console.log("Agent Actions Available:");
    console.log("  • check_provider <address>      - Get trust score");
    console.log("  • secure_payment <provider> <amount> <request>");
    console.log("  • confirm_delivery <paymentId>");
    console.log("  • raise_dispute <paymentId> <reason>");
    console.log("  • compare_providers <addr1> <addr2> <addr3>\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
