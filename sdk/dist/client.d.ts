import { TrustProtocolConfig, ProviderStats, ProviderComparison, PaymentResult, DeliveryProof, Payment, PaymentStatus, TrustTier, DisputeTrack } from './types';
/**
 * TrustProtocolClient
 *
 * Main SDK client for interacting with x402 Trust Protocol
 */
export declare class TrustProtocolClient {
    private provider;
    private signer?;
    private config;
    private trustProtocol;
    private reputationEngine;
    private escrowVault;
    private disputeManager;
    private usdc;
    constructor(config: TrustProtocolConfig);
    /**
     * Get provider's trust score (300-900)
     */
    getProviderScore(address: string): Promise<number>;
    /**
     * Get provider's trust tier
     */
    getProviderTier(address: string): Promise<TrustTier>;
    /**
     * Get full provider stats
     */
    getProviderStats(address: string): Promise<ProviderStats>;
    /**
     * Check if provider requires escrow
     */
    needsEscrow(address: string): Promise<boolean>;
    /**
     * Compare multiple providers
     */
    compareProviders(addresses: string[]): Promise<ProviderComparison[]>;
    /**
     * Create a secure payment with trust-based routing
     */
    createSecurePayment(params: {
        provider: string;
        amount: bigint;
        requestHash: string;
    }): Promise<PaymentResult>;
    /**
     * Confirm delivery and release escrowed payment
     */
    confirmDelivery(paymentId: string, proof: DeliveryProof): Promise<string>;
    /**
     * Claim refund after timeout
     */
    claimTimeout(paymentId: string): Promise<string>;
    /**
     * Get payment info
     */
    getPayment(paymentId: string): Promise<Payment>;
    /**
     * Get payment status
     */
    getPaymentStatus(paymentId: string): Promise<PaymentStatus>;
    /**
     * Raise a dispute for a pending payment
     */
    raiseDispute(paymentId: string, evidence: string): Promise<{
        disputeId: string;
        track: DisputeTrack;
        transactionHash: string;
    }>;
    /**
     * Register as a provider with stake
     */
    registerAsProvider(endpoint: string): Promise<string>;
    /**
     * Register as an arbitrator
     */
    registerAsArbitrator(): Promise<string>;
    /**
     * Get USDC balance
     */
    getUsdcBalance(address: string): Promise<bigint>;
    /**
     * Hash a request for payment creation
     */
    hashRequest(request: string): string;
    /**
     * Hash a response for delivery proof
     */
    hashResponse(response: string): string;
}
