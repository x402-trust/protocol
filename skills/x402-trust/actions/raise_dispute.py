"""
raise_dispute action
Dispute a failed or incorrect delivery
"""

from .utils import (
    get_web3,
    get_account,
    get_contracts,
    hash_string,
    send_transaction,
    DISPUTE_TRACKS
)


def raise_dispute(payment_id: str, reason: str) -> dict:
    """
    Raise a dispute for a failed or incorrect delivery.
    
    Args:
        payment_id: Payment identifier
        reason: Description of the issue
        
    Returns:
        dict with dispute_id, track, resolution_hours, transaction_hash
    """
    w3 = get_web3()
    account = get_account()
    contracts = get_contracts(w3)
    
    try:
        # Get payment info
        payment_id_bytes = bytes.fromhex(payment_id.replace("0x", ""))
        payment = contracts["escrow_vault"].functions.getPayment(payment_id_bytes).call()
        
        buyer, provider, amount, request_hash, created_at, timeout, delivery_block, status, use_escrow = payment
        
        # Check status
        if status != 1:  # Not Pending
            status_names = {0: "None", 1: "Pending", 2: "Completed", 3: "Refunded", 4: "Disputed", 5: "Stuck"}
            return {"error": f"Cannot dispute. Payment status: {status_names.get(status, 'Unknown')}"}
        
        # Check caller is buyer
        if buyer.lower() != account.address.lower():
            return {"error": "Only buyer can raise dispute"}
        
        # Create evidence hash
        evidence_hash = hash_string(reason)
        
        # Raise dispute
        dispute_tx = contracts["escrow_vault"].functions.raiseDispute(
            payment_id_bytes,
            evidence_hash
        ).build_transaction({
            "from": account.address,
            "chainId": w3.eth.chain_id
        })
        
        receipt = send_transaction(w3, account, dispute_tx)
        
        # Determine track based on amount
        track = 1  # Standard by default
        if amount < 100 * 1e6:  # < 100 USDC
            track = 0  # FastTrack
        elif amount >= 1000 * 1e6:  # >= 1000 USDC
            track = 2  # Complex
        
        track_info = DISPUTE_TRACKS[track]
        
        # Parse dispute_id from event
        dispute_id = None
        for log in receipt.logs:
            if len(log.topics) >= 2:
                # DisputeRaised event
                if log.topics[0].hex() == w3.keccak(text="DisputeRaised(bytes32,bytes32)").hex():
                    dispute_id = log.topics[2].hex() if len(log.topics) > 2 else log.data.hex()
        
        if not dispute_id:
            dispute_id = receipt.transactionHash.hex()
        
        return {
            "dispute_id": dispute_id,
            "payment_id": payment_id,
            "track": track_info["name"],
            "resolution_hours": track_info["hours"],
            "transaction_hash": receipt.transactionHash.hex(),
            "reason": reason,
            "amount_disputed": amount / 1e6
        }
        
    except Exception as e:
        return {"error": str(e)}


# OpenClaw action entry point
def run(params: dict) -> dict:
    """OpenClaw action entry point"""
    payment_id = params.get("payment_id")
    reason = params.get("reason")
    
    if not payment_id:
        return {"error": "payment_id is required"}
    if not reason:
        return {"error": "reason is required"}
    
    return raise_dispute(payment_id, reason)
