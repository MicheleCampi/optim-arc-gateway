import express from 'express';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { trackRequest, trackPayment, getStats } from './stats.js';
dotenv.config();

const app = express();
app.use(express.json());

const {
  ARC_RPC_URL, ARC_CHAIN_ID, USDC_ADDRESS, USDC_DECIMALS,
  WALLET_ADDRESS, OPTIMENGINE_URL, PORT
} = process.env;

const provider = new ethers.JsonRpcProvider(ARC_RPC_URL);

const PRICES = {
  '/solve/schedule':    { price: '0.15', raw: 150000n },
  '/solve/routing':     { price: '0.20', raw: 200000n },
  '/solve/packing':     { price: '0.10', raw: 100000n },
  '/solve/pareto':      { price: '0.20', raw: 200000n },
  '/solve/stochastic':  { price: '0.25', raw: 250000n },
  '/solve/robust':      { price: '0.20', raw: 200000n },
  '/solve/sensitivity': { price: '0.15', raw: 150000n },
  '/solve/prescriptive':{ price: '0.30', raw: 300000n },
  '/solve/validate':    { price: '0.05', raw: 50000n },
};

const SOLVER_MAP = {
  '/solve/schedule':    '/solve/scheduling',
  '/solve/routing':     '/solve/routing',
  '/solve/packing':     '/solve/packing',
  '/solve/pareto':      '/solve/pareto',
  '/solve/stochastic':  '/solve/stochastic',
  '/solve/robust':      '/solve/robust',
  '/solve/sensitivity': '/solve/sensitivity',
  '/solve/prescriptive':'/solve/prescriptive',
  '/solve/validate':    '/solve/validate',
};

async function verifyArcPayment(txHash, requiredAmount) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return { valid: false, reason: 'Transaction not found or not yet confirmed' };
  if (receipt.status !== 1) return { valid: false, reason: 'Transaction failed on-chain' };

  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const walletTopic = ethers.zeroPadValue(WALLET_ADDRESS.toLowerCase(), 32);

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
      log.topics[0] === transferTopic &&
      log.topics[2]?.toLowerCase() === walletTopic.toLowerCase()
    ) {
      const amount = BigInt(log.data);
      if (amount >= requiredAmount) {
        return {
          valid: true,
          amount: Number(amount) / 1e6,
          from: ethers.getAddress('0x' + log.topics[1].slice(26)),
          blockNumber: receipt.blockNumber
        };
      } else {
        return { valid: false, reason: `Insufficient: sent ${Number(amount)/1e6}, required ${Number(requiredAmount)/1e6}` };
      }
    }
  }

  const tx = await provider.getTransaction(txHash);
  if (tx && tx.to?.toLowerCase() === WALLET_ADDRESS.toLowerCase()) {
    const valueIn6Dec = tx.value / 10n**12n;
    if (valueIn6Dec >= requiredAmount) {
      return { valid: true, amount: Number(valueIn6Dec) / 1e6, from: tx.from, blockNumber: receipt.blockNumber };
    }
  }

  return { valid: false, reason: 'No valid USDC transfer to gateway wallet found' };
}

for (const [path, pricing] of Object.entries(PRICES)) {
  app.post(path, async (req, res) => {
    const txHash = req.headers['x-payment'] || req.headers['x-arc-payment'];

    if (!txHash) {
      trackRequest(path, 402);
      return res.status(402).json({
        status: 402,
        message: 'Payment Required',
        payment: {
          chain: `eip155:${ARC_CHAIN_ID}`,
          chain_name: 'Arc Testnet',
          pay_to: WALLET_ADDRESS,
          amount: pricing.price,
          amount_raw: pricing.raw.toString(),
          asset: USDC_ADDRESS,
          asset_name: 'USDC',
          decimals: parseInt(USDC_DECIMALS),
          finality: '~0.5s',
          instructions: 'Transfer USDC to pay_to on Arc testnet, then retry with X-Payment: <tx_hash>'
        }
      });
    }

    try {
      const start = Date.now();
      const verification = await verifyArcPayment(txHash, pricing.raw);
      const verifyTime = Date.now() - start;

      if (!verification.valid) {
        trackRequest(path, 402);
      trackRequest(path, 402);
        trackPayment(false, 0, 'unknown', txHash, path, 0, 0);
        return res.status(402).json({ status: 402, message: `Payment failed: ${verification.reason}`, tx_hash: txHash });
      }

      console.log(`[ARC] Verified in ${verifyTime}ms: ${verification.amount} USDC from ${verification.from}`);

      const solverPath = SOLVER_MAP[path];
      const solverStart = Date.now();
      const solverRes = await fetch(`${OPTIMENGINE_URL}${solverPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      const solverData = await solverRes.json();
      const solveTime = Date.now() - solverStart;

      trackPayment(true, verification.amount, verification.from, txHash, path, verifyTime, solveTime);
      console.log(`[ARC] Solver in ${solveTime}ms: ${solverData.status}`);

      return res.json({
        ...solverData,
        _payment: {
          chain: 'arc-testnet',
          tx_hash: txHash,
          amount_usdc: verification.amount,
          payer: verification.from,
          verify_time_ms: verifyTime,
          solve_time_ms: solveTime,
          total_time_ms: verifyTime + solveTime
        }
      });
    } catch (err) {
      console.error('[ARC] Error:', err.message);
      return res.status(500).json({ status: 'error', message: err.message });
    }
  });
}

app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'OptimEngine Arc Gateway',
    chain: 'Arc Testnet (eip155:5042002)',
    wallet: WALLET_ADDRESS,
    endpoints: Object.keys(PRICES).length,
    finality: '~0.5s sub-second',
    facilitator: 'native (no third-party)',
    usdc: USDC_ADDRESS
  });
});

app.get('/.well-known/x402', (req, res) => {
  const endpoints = {};
  for (const [path, pricing] of Object.entries(PRICES)) {
    endpoints[path] = { method: 'POST', price: pricing.price, currency: 'USDC', chain: `eip155:${ARC_CHAIN_ID}`, pay_to: WALLET_ADDRESS, asset: USDC_ADDRESS, finality: '~0.5s' };
  }
  res.json({ service: 'OptimEngine', version: 'arc-native-1.0.0', facilitator: 'native-middleware', endpoints });
});

app.get('/stats', (req, res) => { res.json(getStats()); });

app.get('/docs', (req, res) => {
  res.json({
    service: 'OptimEngine Arc Gateway',
    chain: 'Arc Testnet (eip155:5042002)',
    payment_flow: [
      '1. POST /solve/<endpoint> without X-Payment header -> 402 with payment details',
      '2. Transfer USDC to pay_to address on Arc testnet',
      '3. Retry same POST with header X-Payment: <tx_hash>',
      '4. Gateway verifies on-chain (~0.5s) and returns solver result'
    ],
    endpoints: Object.entries(PRICES).map(([p, v]) => ({ path: p, method: 'POST', price_usdc: v.price }))
  });
});

app.listen(PORT, () => {
  console.log(`[ARC GATEWAY] Port ${PORT} | Chain ${ARC_CHAIN_ID} | Wallet ${WALLET_ADDRESS}`);
  console.log(`[ARC GATEWAY] ${Object.keys(PRICES).length} paid endpoints | Facilitator: NATIVE`);
  console.log(`[ARC GATEWAY] OptimEngine: ${OPTIMENGINE_URL}`);
});
