"""
secure_payment action
Make a USDC payment with trust-based escrow protection
"""

from .utils import (
    get_web3,
    get_account,
    get_contracts,
    get_config,
    hash_string,
    send_transaction
)
from web3 import Web3


def secure_payment(provider_address: str, amount_usdc: float, request_description: str) -> dict:
    """
    Make a secure USDC payment with trust-based routing.
    
    Args:
        provider_address: Provider's wallet address
        amount_usdc: Payment amount in USDC
        request_description: What you're paying for
        
    Returns:
        dict with payment_id, escrow_used, timeout_minutes, transaction_hash
    """
    w3 = get_web3()
    account = get_account()
    contracts = get_contracts(w3)
    config = get_config()
    
    # Validate inputs
    if not w3.is_address(provider_address):
        return {"error": f"Invalid provider address: {provider_address}"}
    
    if amount_usdc < 1:
        return {"error": "Minimum payment is 1 USDC"}
    
    provider = w3.to_checksum_address(provider_address)
    amount_wei = int(amount_usdc * 1e6)  # USDC has 6 decimals
    request_hash = hash_string(request_description)
    
    try:
        # Check USDC balance
        balance = contracts["usdc"].functions.balanceOf(account.address).call()
        if balance < amount_wei:
            return {"error": f"Insufficient USDC balance. Have: {balance / 1e6}, Need: {amount_usdc}"}
        
        # Check and set approval
        escrow_address = w3.to_checksum_address(config["escrow_vault"])
        allowance = contracts["usdc"].functions.allowance(account.address, escrow_address).call()
        
        if allowance < amount_wei:
            # Approve USDC
            approve_tx = contracts["usdc"].functions.approve(
                escrow_address,
                amount_wei
            ).build_transaction({
                "from": account.address,
                "chainId": w3.eth.chain_id
            })
            send_transaction(w3, account, approve_tx)
        
        # Create payment
        payment_tx = contracts["escrow_vault"].functions.createPayment(
            provider,
            amount_wei,
            request_hash
        ).build_transaction({
            "from": account.address,
            "chainId": w3.eth.chain_id
        })
        
        receipt = send_transaction(w3, account, payment_tx)
        
        # Parse event to get payment ID
        # Look for PaymentCreated event
        payment_id = None
        escrow_used = True
        timeout = 900  # Default 15 min
        
        for log in receipt.logs:
            if len(log.topics) >= 1:
                # PaymentCreated event signature
                if log.topics[0].hex() == w3.keccak(text="PaymentCreated(bytes32,address,address,uint256,bool,uint256)").hex():
                    payment_id = log.topics[1].hex()
                    # Decode data for escrow_used and timeout
                    data = log.data
                    if len(data) >= 64:
                        escrow_used = int(data[32:64].hex(), 16) == 1
                        timeout = int(data[64:96].hex(), 16) if len(data) >= 96 else 900
        
        if not payment_id:
            # Fallback: use transaction hash as reference
            payment_id = receipt.transactionHash.hex()
        
        return {
            "payment_id": payment_id,
            "escrow_used": escrow_used,
            "timeout_minutes": timeout // 60,
            "transaction_hash": receipt.transactionHash.hex(),
            "amount_usdc": amount_usdc,
            "provider": provider
        }
        
    except Exception as e:
        return {"error": str(e)}


# OpenClaw action entry point
def run(params: dict) -> dict:
    """OpenClaw action entry point"""
    provider_address = params.get("provider_address")
    amount_usdc = params.get("amount_usdc")
    request_description = params.get("request_description")
    
    if not provider_address:
        return {"error": "provider_address is required"}
    if not amount_usdc:
        return {"error": "amount_usdc is required"}
    if not request_description:
        return {"error": "request_description is required"}
    
    return secure_payment(provider_address, float(amount_usdc), request_description)
