# OptimEngine Arc Gateway

Native x402 middleware for Arc testnet. Zero third-party facilitators.

- **9 paid endpoints** (scheduling, routing, packing, pareto, stochastic, robust, sensitivity, prescriptive, validate)
- **Sub-second payment verification** via direct RPC (~200ms)
- **Arc testnet** (Chain ID 5042002, USDC native gas)
- **No CDP, no PayAI, no intermediaries** — gateway verifies payments directly on-chain

## Architecture
```
Agent → POST /solve/schedule (no header) → 402 Payment Required
Agent → Transfer USDC on Arc testnet
Agent → POST /solve/schedule (X-Payment: tx_hash) → 200 + solver result
```

## Endpoints

| Endpoint | Price | Solver |
|---|---|---|
| POST /solve/schedule | $0.15 | FJSP OR-Tools CP-SAT |
| POST /solve/routing | $0.20 | CVRPTW |
| POST /solve/packing | $0.10 | Bin Packing |
| POST /solve/pareto | $0.20 | Multi-objective Pareto |
| POST /solve/stochastic | $0.25 | Monte Carlo CVaR |
| POST /solve/robust | $0.20 | Worst-case |
| POST /solve/sensitivity | $0.15 | Parametric |
| POST /solve/prescriptive | $0.30 | Forecast+Optimize |
| POST /solve/validate | $0.05 | Validation |

## Free Endpoints

- `GET /health`
- `GET /.well-known/x402`
- `GET /docs`

## First Payment on Arc Testnet

- **TX**: `0x8a7e4d413fea4a62ea3e2e18a7c80aca3cba98ce81ed2f1f37a3ab58a8491020`
- **Block**: 33580864, confirmed ≤ 0.5s
- **Verify**: 205ms | Solve: 906ms | Total: 1,128ms
- **Explorer**: [View on ArcScan](https://testnet.arcscan.app/tx/0x8a7e4d413fea4a62ea3e2e18a7c80aca3cba98ce81ed2f1f37a3ab58a8491020)

## ERC-8004 Agent #22518

Registered on Base L2. Owner: `0xC9ddd9f1D3c63AFAd2C06F175cE907C5C5D4A410`
