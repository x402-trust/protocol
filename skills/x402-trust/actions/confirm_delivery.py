"""
confirm_delivery action
Confirm successful delivery and release escrowed payment
"""

from .utils import (
    get_web3,
    get_account,
    get_contracts,
    hash_string,
    send_transaction
)


def confirm_delivery(payment_id: str, response_data: str) -> dict:
    """
    Confirm successful delivery and release escrowed payment.
    
    Args:
        payment_id: Payment identifier from secure_payment
        response_data: The response data received from provider
        
    Returns:
        dict with success, transaction_hash, provider_new_score
    """
    w3 = get_web3()
    account = get_account()
    contracts = get_contracts(w3)
    
    try:
        # Get payment info first
        payment_id_bytes = bytes.fromhex(payment_id.replace("0x", ""))
        payment = contracts["escrow_vault"].functions.getPayment(payment_id_bytes).call()
        
        buyer, provider, amount, request_hash, created_at, timeout, delivery_block, status, use_escrow = payment
        
        # Check status
        if status != 1:  # Not Pending
            status_names = {0: "None", 1: "Pending", 2: "Completed", 3: "Refunded", 4: "Disputed", 5: "Stuck"}
            return {"error": f"Payment not pending. Status: {status_names.get(status, 'Unknown')}"}
        
        # Check caller is buyer
        if buyer.lower() != account.address.lower():
            return {"error": "Only buyer can confirm delivery"}
        
        # Build proof
        response_hash = hash_string(response_data)
        
        proof = {
            "requestHash": request_hash,
            "responseHash": response_hash,
            "responseSize": len(response_data),
            "schemaHash": bytes(32),  # Zero hash
            "signature": bytes(65)     # Mock signature
        }
        
        # Confirm delivery
        confirm_tx = contracts["escrow_vault"].functions.confirmDelivery(
            payment_id_bytes,
            (
                proof["requestHash"],
                proof["responseHash"],
                proof["responseSize"],
                proof["schemaHash"],
                proof["signature"]
            )
        ).build_transaction({
            "from": account.address,
            "chainId": w3.eth.chain_id
        })
        
        receipt = send_transaction(w3, account, confirm_tx)
        
        # Get updated provider score
        new_score = contracts["trust_protocol"].functions.getProviderInfo(provider).call()[0]
        
        return {
            "success": True,
            "transaction_hash": receipt.transactionHash.hex(),
            "provider": provider,
            "provider_new_score": new_score,
            "amount_released": amount / 1e6
        }
        
    except Exception as e:
        return {"error": str(e), "success": False}


# OpenClaw action entry point
def run(params: dict) -> dict:
    """OpenClaw action entry point"""
    payment_id = params.get("payment_id")
    response_data = params.get("response_data")
    
    if not payment_id:
        return {"error": "payment_id is required"}
    if not response_data:
        return {"error": "response_data is required"}
    
    return confirm_delivery(payment_id, response_data)
