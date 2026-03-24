// In-memory stats tracker
const stats = {
  started_at: new Date().toISOString(),
  requests: {
    total: 0,
    by_endpoint: {},
    by_status: { '402': 0, '200': 0, '500': 0 }
  },
  payments: {
    verified: 0,
    failed: 0,
    total_usdc: 0,
    transactions: []
  },
  solves: {
    completed: 0,
    total_verify_ms: 0,
    total_solve_ms: 0,
    avg_verify_ms: 0,
    avg_solve_ms: 0
  },
  unique_payers: new Set()
};

export function trackRequest(endpoint, status) {
  stats.requests.total++;
  stats.requests.by_endpoint[endpoint] = (stats.requests.by_endpoint[endpoint] || 0) + 1;
  stats.requests.by_status[String(status)] = (stats.requests.by_status[String(status)] || 0) + 1;
}

export function trackPayment(success, amount, payer, txHash, endpoint, verifyMs, solveMs) {
  if (success) {
    stats.payments.verified++;
    stats.payments.total_usdc += amount;
    stats.solves.completed++;
    stats.solves.total_verify_ms += verifyMs;
    stats.solves.total_solve_ms += solveMs;
    stats.solves.avg_verify_ms = Math.round(stats.solves.total_verify_ms / stats.solves.completed);
    stats.solves.avg_solve_ms = Math.round(stats.solves.total_solve_ms / stats.solves.completed);
    stats.unique_payers.add(payer);
    stats.payments.transactions.push({
      time: new Date().toISOString(),
      tx_hash: txHash,
      payer,
      amount,
      endpoint,
      verify_ms: verifyMs,
      solve_ms: solveMs
    });
    // Keep last 100 transactions
    if (stats.payments.transactions.length > 100) stats.payments.transactions.shift();
  } else {
    stats.payments.failed++;
  }
}

export function getStats() {
  return {
    service: 'OptimEngine Arc Gateway',
    chain: 'Arc Testnet (eip155:5042002)',
    uptime_since: stats.started_at,
    requests: stats.requests,
    payments: {
      verified: stats.payments.verified,
      failed: stats.payments.failed,
      total_usdc: Math.round(stats.payments.total_usdc * 1e6) / 1e6,
      unique_payers: stats.unique_payers.size,
      last_10: stats.payments.transactions.slice(-10)
    },
    solves: stats.solves,
    alert: stats.unique_payers.size > 0
      ? `🟢 ${stats.unique_payers.size} unique payer(s) detected!`
      : '⚪ No external payments yet'
  };
}
