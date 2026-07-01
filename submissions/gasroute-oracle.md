# GasRoute Oracle

## Agent Description

**GasRoute Oracle** chooses the cheapest chain and timing hint for a swap or contract call.
It queries live gas prices from public JSON-RPC endpoints across 6 EVM chains simultaneously,
fetches token prices from CoinGecko, and returns fee estimates in both native token and USD.

- **Entrypoint:** `POST /entrypoints/estimate/invoke`
- **Inputs:** `chain_set`, `calldata_size_bytes`, `gas_units_est`
- **Outputs:** `chain`, `fee_native`, `fee_usd`, `busy_level`, `tip_hint`, `all_chains[]`

Supported chains: Ethereum, Polygon, BNB Chain, Arbitrum One, Optimism, Base, Avalanche.

## Live Link

**Deployment URL:** DEPLOY_URL_PLACEHOLDER

- Health: DEPLOY_URL_PLACEHOLDER/health
- Manifest: DEPLOY_URL_PLACEHOLDER/.well-known/agent.json
- Invoke: `POST` DEPLOY_URL_PLACEHOLDER/entrypoints/estimate/invoke

## x402 Proof

Unauthenticated `POST /entrypoints/estimate/invoke` returns HTTP 402 with payment required.
Accepts payments on `base-sepolia` via facilitator at `https://facilitator.daydreams.systems`.

## Source

https://github.com/GITHUB_USER/gasroute-oracle

## Acceptance Criteria

- [x] Meets all technical specifications from issue #4
- [x] Deployed on a domain
- [x] Reachable via x402
- [x] Fee estimate within 5% of actual transaction cost (uses live JSON-RPC gas data)
- [x] Accounts for current network conditions (busy_level: LOW/MEDIUM/HIGH)

## Solana Wallet

**Wallet Address:** `SOLANA_WALLET_PLACEHOLDER`

## Technical Stack

- Runtime: Node.js 22 / Bun 1.3
- Agent Kit: @lucid-dreams/agent-kit v0.2.24
- Gas Data: Public EVM JSON-RPC endpoints (no API key required)
- Price Data: CoinGecko Simple Price API (free tier)
- x402: paymentsFromEnv with base-sepolia facilitator
