"""
compare_providers action
Compare multiple providers and get recommendation
"""

from .utils import (
    get_web3,
    get_contracts,
    get_recommendation
)


def compare_providers(provider_addresses: list) -> dict:
    """
    Compare multiple providers and get a recommendation.
    
    Args:
        provider_addresses: List of provider addresses to compare
        
    Returns:
        dict with comparison array, recommended address, and reasoning
    """
    w3 = get_web3()
    contracts = get_contracts(w3)
    
    if not provider_addresses or len(provider_addresses) < 2:
        return {"error": "At least 2 provider addresses required for comparison"}
    
    if len(provider_addresses) > 10:
        return {"error": "Maximum 10 providers can be compared at once"}
    
    try:
        # Validate and checksum addresses
        validated = []
        for addr in provider_addresses:
            if not w3.is_address(addr):
                return {"error": f"Invalid address: {addr}"}
            validated.append(w3.to_checksum_address(addr))
        
        # Get comparison from contract
        scores, timeouts = contracts["trust_protocol"].functions.compareProviders(validated).call()
        
        # Build comparison array
        comparison = []
        best_provider = None
        best_score = 0
        
        for i, addr in enumerate(validated):
            score = scores[i]
            timeout = timeouts[i]
            tier = contracts["trust_protocol"].functions.getTrustTier(addr).call()
            needs_escrow = contracts["trust_protocol"].functions.needsEscrow(addr).call()
            
            provider_info = {
                "address": addr,
                "score": score,
                "tier": tier,
                "timeout_minutes": timeout // 60,
                "escrow_required": needs_escrow,
                "recommendation": get_recommendation(score)
            }
            comparison.append(provider_info)
            
            if score > best_score:
                best_score = score
                best_provider = addr
        
        # Sort by score descending
        comparison.sort(key=lambda x: x["score"], reverse=True)
        
        # Generate reasoning
        if best_score >= 850:
            reasoning = f"Provider {best_provider[:10]}... is Elite tier with score {best_score}. Highly recommended."
        elif best_score >= 700:
            reasoning = f"Provider {best_provider[:10]}... has Excellent rating ({best_score}). Good choice for most payments."
        elif best_score >= 500:
            reasoning = f"Provider {best_provider[:10]}... has Good rating ({best_score}). Use with escrow protection."
        else:
            reasoning = f"All providers have low scores. Best available is {best_provider[:10]}... with score {best_score}. Proceed with caution."
        
        return {
            "comparison": comparison,
            "recommended": best_provider,
            "reasoning": reasoning,
            "total_providers": len(comparison)
        }
        
    except Exception as e:
        return {"error": str(e)}


# OpenClaw action entry point
def run(params: dict) -> dict:
    """OpenClaw action entry point"""
    provider_addresses = params.get("provider_addresses")
    
    if not provider_addresses:
        return {"error": "provider_addresses is required"}
    
    if isinstance(provider_addresses, str):
        # Handle comma-separated string
        provider_addresses = [addr.strip() for addr in provider_addresses.split(",")]
    
    return compare_providers(provider_addresses)
