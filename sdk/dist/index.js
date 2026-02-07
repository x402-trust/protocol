"use strict";
/**
 * x402 Trust Protocol SDK
 *
 * Secure USDC payments for AI agents with trust scoring and escrow protection
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ethers = exports.DEFAULT_CONFIG = exports.ARC_TESTNET_CONFIG = exports.BASE_SEPOLIA_CONFIG = exports.ERC20_ABI = exports.DISPUTE_MANAGER_ABI = exports.ESCROW_VAULT_ABI = exports.REPUTATION_ENGINE_ABI = exports.TRUST_PROTOCOL_ABI = exports.DisputeOutcome = exports.DisputeTrack = exports.DisputePhase = exports.PaymentStatus = exports.TrustProtocolClient = void 0;
var client_1 = require("./client");
Object.defineProperty(exports, "TrustProtocolClient", { enumerable: true, get: function () { return client_1.TrustProtocolClient; } });
var types_1 = require("./types");
Object.defineProperty(exports, "PaymentStatus", { enumerable: true, get: function () { return types_1.PaymentStatus; } });
Object.defineProperty(exports, "DisputePhase", { enumerable: true, get: function () { return types_1.DisputePhase; } });
Object.defineProperty(exports, "DisputeTrack", { enumerable: true, get: function () { return types_1.DisputeTrack; } });
Object.defineProperty(exports, "DisputeOutcome", { enumerable: true, get: function () { return types_1.DisputeOutcome; } });
var contracts_1 = require("./contracts");
Object.defineProperty(exports, "TRUST_PROTOCOL_ABI", { enumerable: true, get: function () { return contracts_1.TRUST_PROTOCOL_ABI; } });
Object.defineProperty(exports, "REPUTATION_ENGINE_ABI", { enumerable: true, get: function () { return contracts_1.REPUTATION_ENGINE_ABI; } });
Object.defineProperty(exports, "ESCROW_VAULT_ABI", { enumerable: true, get: function () { return contracts_1.ESCROW_VAULT_ABI; } });
Object.defineProperty(exports, "DISPUTE_MANAGER_ABI", { enumerable: true, get: function () { return contracts_1.DISPUTE_MANAGER_ABI; } });
Object.defineProperty(exports, "ERC20_ABI", { enumerable: true, get: function () { return contracts_1.ERC20_ABI; } });
// Default Base Sepolia configuration
exports.BASE_SEPOLIA_CONFIG = {
    rpcUrl: 'https://sepolia.base.org',
    chainId: 84532,
    contracts: {
        trustProtocol: '', // Not deployed yet
        reputationEngine: '',
        escrowVault: '',
        disputeManager: '',
        usdc: ''
    }
};
// Arc Testnet configuration (LIVE DEPLOYMENT)
exports.ARC_TESTNET_CONFIG = {
    rpcUrl: 'https://rpc.testnet.arc.network',
    chainId: 5042002,
    blockExplorer: 'https://testnet.arcscan.app',
    contracts: {
        trustProtocol: '0x1eC0007C35Aa4A5008263e2C257942f4cb4F329F',
        reputationEngine: '0x86fa599c4474E8098400e57760543E7191B2DA1e',
        escrowVault: '0x8E46e646ab9caACC8322dBD5E17A08166F09B9FD',
        disputeManager: '0x7449713F47A782b5df27ac6d375A55E6dA7A58a9',
        usdc: '0x8Fd5A8a2d6373a1c299C46Ed7862CA277316237B' // MockUSDC
    }
};
// Default to Arc Testnet (current deployment)
exports.DEFAULT_CONFIG = exports.ARC_TESTNET_CONFIG;
// Re-export for convenience
var ethers_1 = require("ethers");
Object.defineProperty(exports, "ethers", { enumerable: true, get: function () { return ethers_1.ethers; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7O0dBSUc7OztBQUVILG1DQUErQztBQUF0Qyw2R0FBQSxtQkFBbUIsT0FBQTtBQUU1QixpQ0FpQmlCO0FBZmIsc0dBQUEsYUFBYSxPQUFBO0FBQ2IscUdBQUEsWUFBWSxPQUFBO0FBQ1oscUdBQUEsWUFBWSxPQUFBO0FBQ1osdUdBQUEsY0FBYyxPQUFBO0FBY2xCLHlDQU1xQjtBQUxqQiwrR0FBQSxrQkFBa0IsT0FBQTtBQUNsQixrSEFBQSxxQkFBcUIsT0FBQTtBQUNyQiw2R0FBQSxnQkFBZ0IsT0FBQTtBQUNoQixnSEFBQSxtQkFBbUIsT0FBQTtBQUNuQixzR0FBQSxTQUFTLE9BQUE7QUFHYixxQ0FBcUM7QUFDeEIsUUFBQSxtQkFBbUIsR0FBRztJQUMvQixNQUFNLEVBQUUsMEJBQTBCO0lBQ2xDLE9BQU8sRUFBRSxLQUFLO0lBQ2QsU0FBUyxFQUFFO1FBQ1AsYUFBYSxFQUFFLEVBQUUsRUFBRyxtQkFBbUI7UUFDdkMsZ0JBQWdCLEVBQUUsRUFBRTtRQUNwQixXQUFXLEVBQUUsRUFBRTtRQUNmLGNBQWMsRUFBRSxFQUFFO1FBQ2xCLElBQUksRUFBRSxFQUFFO0tBQ1g7Q0FDSixDQUFDO0FBRUYsOENBQThDO0FBQ2pDLFFBQUEsa0JBQWtCLEdBQUc7SUFDOUIsTUFBTSxFQUFFLGlDQUFpQztJQUN6QyxPQUFPLEVBQUUsT0FBTztJQUNoQixhQUFhLEVBQUUsNkJBQTZCO0lBQzVDLFNBQVMsRUFBRTtRQUNQLGFBQWEsRUFBRSw0Q0FBNEM7UUFDM0QsZ0JBQWdCLEVBQUUsNENBQTRDO1FBQzlELFdBQVcsRUFBRSw0Q0FBNEM7UUFDekQsY0FBYyxFQUFFLDRDQUE0QztRQUM1RCxJQUFJLEVBQUUsNENBQTRDLENBQUUsV0FBVztLQUNsRTtDQUNKLENBQUM7QUFFRiw4Q0FBOEM7QUFDakMsUUFBQSxjQUFjLEdBQUcsMEJBQWtCLENBQUM7QUFFakQsNEJBQTRCO0FBQzVCLGlDQUFnQztBQUF2QixnR0FBQSxNQUFNLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIHg0MDIgVHJ1c3QgUHJvdG9jb2wgU0RLXG4gKiBcbiAqIFNlY3VyZSBVU0RDIHBheW1lbnRzIGZvciBBSSBhZ2VudHMgd2l0aCB0cnVzdCBzY29yaW5nIGFuZCBlc2Nyb3cgcHJvdGVjdGlvblxuICovXG5cbmV4cG9ydCB7IFRydXN0UHJvdG9jb2xDbGllbnQgfSBmcm9tICcuL2NsaWVudCc7XG5cbmV4cG9ydCB7XG4gICAgVHJ1c3RUaWVyLFxuICAgIFBheW1lbnRTdGF0dXMsXG4gICAgRGlzcHV0ZVBoYXNlLFxuICAgIERpc3B1dGVUcmFjayxcbiAgICBEaXNwdXRlT3V0Y29tZSxcbiAgICBQcm92aWRlclByb2ZpbGUsXG4gICAgUHJvdmlkZXJTdGF0cyxcbiAgICBQYXltZW50LFxuICAgIFBheW1lbnRSZXN1bHQsXG4gICAgRGVsaXZlcnlQcm9vZixcbiAgICBEaXNwdXRlLFxuICAgIFRydXN0UHJvdG9jb2xDb25maWcsXG4gICAgUHJvdmlkZXJDb21wYXJpc29uLFxuICAgIFBheW1lbnRDcmVhdGVkRXZlbnQsXG4gICAgUGF5bWVudFJlbGVhc2VkRXZlbnQsXG4gICAgRGlzcHV0ZVJhaXNlZEV2ZW50XG59IGZyb20gJy4vdHlwZXMnO1xuXG5leHBvcnQge1xuICAgIFRSVVNUX1BST1RPQ09MX0FCSSxcbiAgICBSRVBVVEFUSU9OX0VOR0lORV9BQkksXG4gICAgRVNDUk9XX1ZBVUxUX0FCSSxcbiAgICBESVNQVVRFX01BTkFHRVJfQUJJLFxuICAgIEVSQzIwX0FCSVxufSBmcm9tICcuL2NvbnRyYWN0cyc7XG5cbi8vIERlZmF1bHQgQmFzZSBTZXBvbGlhIGNvbmZpZ3VyYXRpb25cbmV4cG9ydCBjb25zdCBCQVNFX1NFUE9MSUFfQ09ORklHID0ge1xuICAgIHJwY1VybDogJ2h0dHBzOi8vc2Vwb2xpYS5iYXNlLm9yZycsXG4gICAgY2hhaW5JZDogODQ1MzIsXG4gICAgY29udHJhY3RzOiB7XG4gICAgICAgIHRydXN0UHJvdG9jb2w6ICcnLCAgLy8gTm90IGRlcGxveWVkIHlldFxuICAgICAgICByZXB1dGF0aW9uRW5naW5lOiAnJyxcbiAgICAgICAgZXNjcm93VmF1bHQ6ICcnLFxuICAgICAgICBkaXNwdXRlTWFuYWdlcjogJycsXG4gICAgICAgIHVzZGM6ICcnXG4gICAgfVxufTtcblxuLy8gQXJjIFRlc3RuZXQgY29uZmlndXJhdGlvbiAoTElWRSBERVBMT1lNRU5UKVxuZXhwb3J0IGNvbnN0IEFSQ19URVNUTkVUX0NPTkZJRyA9IHtcbiAgICBycGNVcmw6ICdodHRwczovL3JwYy50ZXN0bmV0LmFyYy5uZXR3b3JrJyxcbiAgICBjaGFpbklkOiA1MDQyMDAyLFxuICAgIGJsb2NrRXhwbG9yZXI6ICdodHRwczovL3Rlc3RuZXQuYXJjc2Nhbi5hcHAnLFxuICAgIGNvbnRyYWN0czoge1xuICAgICAgICB0cnVzdFByb3RvY29sOiAnMHgxZUMwMDA3QzM1QWE0QTUwMDgyNjNlMkMyNTc5NDJmNGNiNEYzMjlGJyxcbiAgICAgICAgcmVwdXRhdGlvbkVuZ2luZTogJzB4ODZmYTU5OWM0NDc0RTgwOTg0MDBlNTc3NjA1NDNFNzE5MUIyREExZScsXG4gICAgICAgIGVzY3Jvd1ZhdWx0OiAnMHg4RTQ2ZTY0NmFiOWNhQUNDODMyMmRCRDVFMTdBMDgxNjZGMDlCOUZEJyxcbiAgICAgICAgZGlzcHV0ZU1hbmFnZXI6ICcweDc0NDk3MTNGNDdBNzgyYjVkZjI3YWM2ZDM3NUE1NUU2ZEE3QTU4YTknLFxuICAgICAgICB1c2RjOiAnMHg4RmQ1QThhMmQ2MzczYTFjMjk5QzQ2RWQ3ODYyQ0EyNzczMTYyMzdCJyAgLy8gTW9ja1VTRENcbiAgICB9XG59O1xuXG4vLyBEZWZhdWx0IHRvIEFyYyBUZXN0bmV0IChjdXJyZW50IGRlcGxveW1lbnQpXG5leHBvcnQgY29uc3QgREVGQVVMVF9DT05GSUcgPSBBUkNfVEVTVE5FVF9DT05GSUc7XG5cbi8vIFJlLWV4cG9ydCBmb3IgY29udmVuaWVuY2VcbmV4cG9ydCB7IGV0aGVycyB9IGZyb20gJ2V0aGVycyc7XG5cbiJdfQ==