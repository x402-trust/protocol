import { ethers, Contract, Signer, Provider } from 'ethers';
import {
    TrustProtocolConfig,
    ProviderStats,
    ProviderComparison,
    PaymentResult,
    DeliveryProof,
    Payment,
    PaymentStatus,
    TrustTier,
    Dispute,
    DisputeTrack
} from './types';
import {
    TRUST_PROTOCOL_ABI,
    REPUTATION_ENGINE_ABI,
    ESCROW_VAULT_ABI,
    DISPUTE_MANAGER_ABI,
    ERC20_ABI
} from './contracts';

/**
 * TrustProtocolClient
 * 
 * Main SDK client for interacting with x402 Trust Protocol
 */
export class TrustProtocolClient {
    private provider: Provider;
    private signer?: Signer;
    private config: TrustProtocolConfig;

    // Contract instances
    private trustProtocol: Contract;
    private reputationEngine: Contract;
    private escrowVault: Contract;
    private disputeManager: Contract;
    private usdc: Contract;

    constructor(config: TrustProtocolConfig) {
        this.config = config;
        this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
        this.signer = config.signer;

        const signerOrProvider = this.signer || this.provider;

        this.trustProtocol = new Contract(
            config.contracts.trustProtocol,
            TRUST_PROTOCOL_ABI,
            signerOrProvider
        );

        this.reputationEngine = new Contract(
            config.contracts.reputationEngine,
            REPUTATION_ENGINE_ABI,
            signerOrProvider
        );

        this.escrowVault = new Contract(
            config.contracts.escrowVault,
            ESCROW_VAULT_ABI,
            signerOrProvider
        );

        this.disputeManager = new Contract(
            config.contracts.disputeManager,
            DISPUTE_MANAGER_ABI,
            signerOrProvider
        );

        this.usdc = new Contract(
            config.contracts.usdc,
            ERC20_ABI,
            signerOrProvider
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROVIDER INFO
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get provider's trust score (300-900)
     */
    async getProviderScore(address: string): Promise<number> {
        const score = await this.reputationEngine.getScore(address);
        return Number(score);
    }

    /**
     * Get provider's trust tier
     */
    async getProviderTier(address: string): Promise<TrustTier> {
        const tier = await this.trustProtocol.getTrustTier(address);
        return tier as TrustTier;
    }

    /**
     * Get full provider stats
     */
    async getProviderStats(address: string): Promise<ProviderStats> {
        const [score, tier, timeout, isActive] = await this.trustProtocol.getProviderInfo(address);
        const tierName = await this.trustProtocol.getTrustTier(address);

        return {
            address,
            score: Number(score),
            tier: tierName as TrustTier,
            successRate: 0, // Would need transaction history
            averageResponseTime: 0,
            totalTransactions: 0,
            disputeRate: 0,
            isActive
        };
    }

    /**
     * Check if provider requires escrow
     */
    async needsEscrow(address: string): Promise<boolean> {
        return await this.trustProtocol.needsEscrow(address);
    }

    /**
     * Compare multiple providers
     */
    async compareProviders(addresses: string[]): Promise<ProviderComparison[]> {
        const [scores, timeouts] = await this.trustProtocol.compareProviders(addresses);

        const comparisons: ProviderComparison[] = [];

        for (let i = 0; i < addresses.length; i++) {
            const tier = await this.trustProtocol.getTrustTier(addresses[i]);
            const score = Number(scores[i]);

            let recommendation = '';
            if (score >= 850) recommendation = 'Highly recommended - Elite provider';
            else if (score >= 700) recommendation = 'Recommended - Excellent track record';
            else if (score >= 500) recommendation = 'Acceptable - Use with escrow';
            else if (score >= 400) recommendation = 'Caution - Higher risk';
            else recommendation = 'Not recommended - Poor history';

            comparisons.push({
                address: addresses[i],
                score,
                tier: tier as TrustTier,
                timeout: Number(timeouts[i]),
                recommendation
            });
        }

        // Sort by score descending
        comparisons.sort((a, b) => b.score - a.score);

        return comparisons;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PAYMENTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Create a secure payment with trust-based routing
     */
    async createSecurePayment(params: {
        provider: string;
        amount: bigint;
        requestHash: string;
    }): Promise<PaymentResult> {
        if (!this.signer) {
            throw new Error('Signer required for transactions');
        }

        // Check allowance and approve if needed
        const signerAddress = await this.signer.getAddress();
        const allowance = await this.usdc.allowance(signerAddress, this.config.contracts.escrowVault);

        if (allowance < params.amount) {
            const approveTx = await this.usdc.approve(this.config.contracts.escrowVault, params.amount);
            await approveTx.wait();
        }

        // Create payment
        const tx = await this.escrowVault.createPayment(
            params.provider,
            params.amount,
            params.requestHash
        );

        const receipt = await tx.wait();

        // Extract paymentId from event
        const event = receipt.logs.find(
            (log: any) => log.fragment?.name === 'PaymentCreated'
        );

        const paymentId = event.args[0];
        const useEscrow = event.args[4];
        const timeout = Number(event.args[5]);

        return {
            paymentId,
            escrowUsed: useEscrow,
            timeoutMinutes: Math.floor(timeout / 60),
            transactionHash: receipt.hash
        };
    }

    /**
     * Confirm delivery and release escrowed payment
     */
    async confirmDelivery(paymentId: string, proof: DeliveryProof): Promise<string> {
        if (!this.signer) {
            throw new Error('Signer required for transactions');
        }

        const proofStruct = {
            requestHash: proof.requestHash,
            responseHash: proof.responseHash,
            responseSize: proof.responseSize,
            schemaHash: proof.schemaHash || ethers.ZeroHash,
            signature: proof.signature
        };

        const tx = await this.escrowVault.confirmDelivery(paymentId, proofStruct);
        const receipt = await tx.wait();

        return receipt.hash;
    }

    /**
     * Claim refund after timeout
     */
    async claimTimeout(paymentId: string): Promise<string> {
        if (!this.signer) {
            throw new Error('Signer required for transactions');
        }

        const tx = await this.escrowVault.claimTimeout(paymentId);
        const receipt = await tx.wait();

        return receipt.hash;
    }

    /**
     * Get payment info
     */
    async getPayment(paymentId: string): Promise<Payment> {
        const p = await this.escrowVault.getPayment(paymentId);

        return {
            id: paymentId,
            buyer: p.buyer,
            provider: p.provider,
            amount: p.amount,
            requestHash: p.requestHash,
            createdAt: Number(p.createdAt),
            timeout: Number(p.timeout),
            status: Number(p.status) as PaymentStatus,
            useEscrow: p.useEscrow
        };
    }

    /**
     * Get payment status
     */
    async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
        const status = await this.escrowVault.getPaymentStatus(paymentId);
        return Number(status) as PaymentStatus;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DISPUTES
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Raise a dispute for a pending payment
     */
    async raiseDispute(paymentId: string, evidence: string): Promise<{
        disputeId: string;
        track: DisputeTrack;
        transactionHash: string;
    }> {
        if (!this.signer) {
            throw new Error('Signer required for transactions');
        }

        const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(evidence));

        const tx = await this.escrowVault.raiseDispute(paymentId, evidenceHash);
        const receipt = await tx.wait();

        // Get payment to determine track
        const payment = await this.getPayment(paymentId);
        const amount = payment.amount;

        let track = DisputeTrack.Standard;
        if (amount < BigInt(100e6)) track = DisputeTrack.FastTrack;
        else if (amount >= BigInt(1000e6)) track = DisputeTrack.Complex;

        // Extract disputeId from event
        const event = receipt.logs.find(
            (log: any) => log.fragment?.name === 'DisputeRaised'
        );

        return {
            disputeId: event.args[1],
            track,
            transactionHash: receipt.hash
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REGISTRATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Register as a provider with stake
     */
    async registerAsProvider(endpoint: string): Promise<string> {
        if (!this.signer) {
            throw new Error('Signer required for transactions');
        }

        // Get required stake
        const stake = await this.reputationEngine.PROVIDER_STAKE();

        // Check and approve USDC
        const signerAddress = await this.signer.getAddress();
        const allowance = await this.usdc.allowance(signerAddress, this.config.contracts.reputationEngine);

        if (allowance < stake) {
            const approveTx = await this.usdc.approve(this.config.contracts.reputationEngine, stake);
            await approveTx.wait();
        }

        // Register
        const tx = await this.reputationEngine.registerWithStake(endpoint);
        const receipt = await tx.wait();

        return receipt.hash;
    }

    /**
     * Register as an arbitrator
     */
    async registerAsArbitrator(): Promise<string> {
        if (!this.signer) {
            throw new Error('Signer required for transactions');
        }

        // Get required stake
        const stake = await this.disputeManager.ARBITRATOR_STAKE();

        // Check and approve USDC
        const signerAddress = await this.signer.getAddress();
        const allowance = await this.usdc.allowance(signerAddress, this.config.contracts.disputeManager);

        if (allowance < stake) {
            const approveTx = await this.usdc.approve(this.config.contracts.disputeManager, stake);
            await approveTx.wait();
        }

        // Register
        const tx = await this.disputeManager.registerAsArbitrator();
        const receipt = await tx.wait();

        return receipt.hash;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get USDC balance
     */
    async getUsdcBalance(address: string): Promise<bigint> {
        return await this.usdc.balanceOf(address);
    }

    /**
     * Hash a request for payment creation
     */
    hashRequest(request: string): string {
        return ethers.keccak256(ethers.toUtf8Bytes(request));
    }

    /**
     * Hash a response for delivery proof
     */
    hashResponse(response: string): string {
        return ethers.keccak256(ethers.toUtf8Bytes(response));
    }
}
