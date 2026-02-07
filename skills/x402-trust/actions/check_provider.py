"""
check_provider action
Check a provider's trust score and get recommendation before paying
"""

from .utils import (
    get_web3,
    get_contracts,
    TIER_NAMES,
    get_recommendation
)


def check_provider(provider_address: str) -> dict:
    """
    Check a provider's trust score and reputation.
    
    Args:
        provider_address: Ethereum address of the provider
        
    Returns:
        dict with score, tier, escrow_required, recommended_timeout, recommendation
    """
    w3 = get_web3()
    contracts = get_contracts(w3)
    
    # Validate address
    if not w3.is_address(provider_address):
        return {"error": f"Invalid address: {provider_address}"}
    
    provider = w3.to_checksum_address(provider_address)
    
    try:
        # Get provider info
        info = contracts["trust_protocol"].functions.getProviderInfo(provider).call()
        score, tier, timeout, is_active = info
        
        if not is_active:
            return {
                "error": "Provider not registered or inactive",
                "is_active": False
            }
        
        # Get tier name
        tier_name = contracts["trust_protocol"].functions.getTrustTier(provider).call()
        
        # Check if escrow needed
        needs_escrow = contracts["trust_protocol"].functions.needsEscrow(provider).call()
        
        return {
            "provider": provider,
            "score": score,
            "tier": tier_name,
            "escrow_required": needs_escrow,
            "recommended_timeout": timeout // 60,  # Convert to minutes
            "recommendation": get_recommendation(score),
            "is_active": True
        }
        
    except Exception as e:
        return {"error": str(e)}


# OpenClaw action entry point
def run(params: dict) -> dict:
    """OpenClaw action entry point"""
    provider_address = params.get("provider_address")
    
    if not provider_address:
        return {"error": "provider_address is required"}
    
    return check_provider(provider_address)
