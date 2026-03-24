import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const ARC_RPC = 'https://rpc.testnet.arc.network';
const USDC = '0x3600000000000000000000000000000000000000';
const GATEWAY = 'http://localhost:4403';
const PAY_TO = process.env.WALLET_ADDRESS;

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

async function main() {
  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const signer = new ethers.Wallet(process.env.TEST_PRIVATE_KEY, provider);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);

  console.log('=== OptimEngine Arc Testnet x402 Test ===');
  console.log('Payer:', signer.address);
  console.log('Receiver:', PAY_TO);
  const bal = await usdc.balanceOf(signer.address);
  console.log('Balance:', ethers.formatUnits(bal, 6), 'USDC');

  // Step 1: call without payment
  console.log('\n--- Step 1: Request without payment ---');
  let res = await fetch(`${GATEWAY}/solve/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  console.log('Status:', res.status, '(expected 402)');

  // Step 2: pay USDC on Arc
  console.log('\n--- Step 2: Pay 0.15 USDC on Arc ---');
  const amount = ethers.parseUnits('0.15', 6);
  const tx = await usdc.transfer(PAY_TO, amount);
  console.log('TX hash:', tx.hash);
  const receipt = await tx.wait();
  console.log('Confirmed block:', receipt.blockNumber, '| Gas:', receipt.gasUsed.toString());

  // Step 3: retry with payment
  console.log('\n--- Step 3: Solve with payment ---');
  const t0 = Date.now();
  res = await fetch(`${GATEWAY}/solve/schedule`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Payment': tx.hash
    },
    body: JSON.stringify({
      jobs: [
        { job_id: "J1", tasks: [{ task_id: "T1", duration: 3, eligible_machines: ["M1","M2"] }] },
        { job_id: "J2", tasks: [{ task_id: "T1", duration: 2, eligible_machines: ["M1","M2"] }] }
      ],
      machines: [{ machine_id: "M1" }, { machine_id: "M2" }]
    })
  });
  const data = await res.json();
  const total = Date.now() - t0;

  console.log('\nStatus:', res.status);
  console.log('Solver:', data.status);
  console.log('Makespan:', data.metrics?.makespan);
  console.log('Verify:', data._payment?.verify_time_ms, 'ms');
  console.log('Solve:', data._payment?.solve_time_ms, 'ms');
  console.log('TOTAL:', total, 'ms');
  console.log('\n✅ Arc Testnet x402 COMPLETE');
}

main().catch(console.error);
