"""
x402 Trust Protocol - Shared utilities for OpenClaw skill actions
"""

import os
import json
from web3 import Web3
from eth_account import Account

# Contract ABIs (simplified for essential functions)
TRUST_PROTOCOL_ABI = json.loads('''[
    {"inputs":[{"name":"provider","type":"address"}],"name":"getProviderInfo","outputs":[{"name":"score","type":"uint256"},{"name":"tier","type":"uint8"},{"name":"timeout","type":"uint256"},{"name":"isActive","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"provider","type":"address"}],"name":"getTrustTier","outputs":[{"name":"","type":"string"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"provider","type":"address"}],"name":"needsEscrow","outputs":[{"name":"","type":"bool"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"providers","type":"address[]"}],"name":"compareProviders","outputs":[{"name":"scores","type":"uint256[]"},{"name":"timeouts","type":"uint256[]"}],"stateMutability":"view","type":"function"}
]''')

ESCROW_VAULT_ABI = json.loads('''[
    {"inputs":[{"name":"provider","type":"address"},{"name":"amount","type":"uint256"},{"name":"requestHash","type":"bytes32"}],"name":"createPayment","outputs":[{"name":"paymentId","type":"bytes32"}],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"paymentId","type":"bytes32"},{"components":[{"name":"requestHash","type":"bytes32"},{"name":"responseHash","type":"bytes32"},{"name":"responseSize","type":"uint256"},{"name":"schemaHash","type":"bytes32"},{"name":"signature","type":"bytes"}],"name":"proof","type":"tuple"}],"name":"confirmDelivery","outputs":[],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"paymentId","type":"bytes32"},{"name":"evidence","type":"bytes32"}],"name":"raiseDispute","outputs":[{"name":"disputeId","type":"bytes32"}],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"paymentId","type":"bytes32"}],"name":"getPayment","outputs":[{"components":[{"name":"buyer","type":"address"},{"name":"provider","type":"address"},{"name":"amount","type":"uint256"},{"name":"requestHash","type":"bytes32"},{"name":"createdAt","type":"uint256"},{"name":"timeout","type":"uint256"},{"name":"deliveryBlock","type":"uint256"},{"name":"status","type":"uint8"},{"name":"useEscrow","type":"bool"}],"name":"","type":"tuple"}],"stateMutability":"view","type":"function"}
]''')

ERC20_ABI = json.loads('''[
    {"inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
    {"inputs":[{"name":"owner","type":"address"},{"name":"spender","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    {"inputs":[{"name":"account","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
]''')

# Tier mapping
TIER_NAMES = {
    0: "None",
    1: "Newcomer",
    2: "Fair",
    3: "Verified",
    4: "Good",
    5: "Excellent",
    6: "Elite"
}

# Dispute tracks
DISPUTE_TRACKS = {
    0: {"name": "FastTrack", "hours": 60},
    1: {"name": "Standard", "hours": 120},
    2: {"name": "Complex", "hours": 192}
}


def get_config():
    """Get configuration from environment variables with Arc Testnet defaults"""
    return {
        "rpc_url": os.environ.get("RPC_URL", "https://rpc.testnet.arc.network"),
        "chain_id": int(os.environ.get("CHAIN_ID", "5042002")),
        "trust_protocol": os.environ.get("TRUST_PROTOCOL_ADDRESS", "0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F"),
        "reputation_engine": os.environ.get("REPUTATION_ENGINE_ADDRESS", "0x86fa599c4474E8098400e57760543E7191B2DA1e"),
        "escrow_vault": os.environ.get("ESCROW_VAULT_ADDRESS", "0x8E46e646ab9caACC8322dBD5E17A08166F09B9FD"),
        "dispute_manager": os.environ.get("DISPUTE_MANAGER_ADDRESS", "0x7449713F47A782b5df27ac6d375A55E6dA7A58a9"),
        "usdc": os.environ.get("USDC_ADDRESS", "0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B"),
        "private_key": os.environ.get("EVM_PRIVATE_KEY")
    }


def get_web3():
    """Get Web3 instance connected to Base Sepolia"""
    config = get_config()
    return Web3(Web3.HTTPProvider(config["rpc_url"]))


def get_account():
    """Get account from private key"""
    config = get_config()
    if not config["private_key"]:
        raise ValueError("EVM_PRIVATE_KEY not configured")
    return Account.from_key(config["private_key"])


def get_contracts(w3):
    """Get contract instances"""
    config = get_config()
    
    return {
        "trust_protocol": w3.eth.contract(
            address=Web3.to_checksum_address(config["trust_protocol"]),
            abi=TRUST_PROTOCOL_ABI
        ),
        "escrow_vault": w3.eth.contract(
            address=Web3.to_checksum_address(config["escrow_vault"]),
            abi=ESCROW_VAULT_ABI
        ),
        "usdc": w3.eth.contract(
            address=Web3.to_checksum_address(config["usdc"]),
            abi=ERC20_ABI
        )
    }


def hash_string(s: str) -> bytes:
    """Hash a string using keccak256"""
    return Web3.keccak(text=s)


def send_transaction(w3, account, tx):
    """Sign and send a transaction"""
    tx["nonce"] = w3.eth.get_transaction_count(account.address)
    tx["gas"] = w3.eth.estimate_gas(tx)
    tx["gasPrice"] = w3.eth.gas_price
    
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    
    return receipt


def get_recommendation(score: int) -> str:
    """Get recommendation based on score"""
    if score >= 850:
        return "Highly recommended - Elite provider with excellent track record"
    elif score >= 700:
        return "Recommended - Excellent provider, low risk"
    elif score >= 500:
        return "Acceptable - Good provider, use with escrow protection"
    elif score >= 400:
        return "Caution - Fair provider, escrow strongly recommended"
    else:
        return "Not recommended - Poor track record, high risk"
