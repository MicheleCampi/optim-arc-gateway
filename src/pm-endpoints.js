// Prediction Market Modular Endpoints
// /forecast-basic, /risk-analysis, /full-intel, /batch-pm, /validate-decision

const ENGINE_URL = process.env.OPTIMENGINE_URL;
const ENGINE_KEY = process.env.ENGINE_API_KEY || "";

const DISCLAIMER = "OptimEngine provides risk-adjusted optimization intelligence for algorithmic decision support. This is NOT financial, investment, or trading advice. Users are solely responsible for their own decisions and outcomes. Use at your own risk.";

async function callSolver(path, body) {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Engine-Key": ENGINE_KEY },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── /forecast-basic ($0.25) — Entry level forecast ──
export async function forecastBasic(req, res) {
  const t0 = Date.now();
  const input = req.body;

  if (!input.solver_request || !input.forecast_parameters) {
    return res.status(400).json({
      error: "Missing required fields: solver_request, forecast_parameters",
      hint: "Provide solver_request + forecast_parameters with historical_data (min 3 points)",
      disclaimer: DISCLAIMER
    });
  }

  try {
    const result = await callSolver("/prescriptive_advise", {
      solver_type: input.solver_type || "scheduling",
      risk_appetite: input.risk_appetite || "moderate",
      solver_request: input.solver_request,
      forecast_parameters: input.forecast_parameters,
      include_risk_analysis: false,
    });

    res.json({
      success: true,
      endpoint: "forecast-basic",
      time_ms: Date.now() - t0,
      forecasts: result.forecasts,
      actions: result.actions?.slice(0, 2),
      recommendation: result.recommendation,
      disclaimer: DISCLAIMER
    });
  } catch (err) {
    res.status(500).json({ error: err.message, disclaimer: DISCLAIMER });
  }
}

// ── /risk-analysis ($1.00) — CVaR + Sensitivity ──
export async function riskAnalysis(req, res) {
  const t0 = Date.now();
  const input = req.body;

  if (!input.solver_request || !input.solver_type) {
    return res.status(400).json({
      error: "Missing required fields: solver_request, solver_type",
      hint: "Provide solver_request + solver_type + stochastic_parameters (for CVaR) and/or sensitivity_parameters",
      disclaimer: DISCLAIMER
    });
  }

  const steps = [];
  let stochasticResult = null;
  let sensitivityResult = null;

  try {
    // Step 1: Stochastic CVaR
    if (input.stochastic_parameters) {
      const t1 = Date.now();
      stochasticResult = await callSolver("/optimize_stochastic", {
        solver_type: input.solver_type,
        num_scenarios: input.num_scenarios || 30,
        optimize_for: input.optimize_for || "cvar_95",
        seed: input.seed || 42,
        solver_request: input.solver_request,
        stochastic_parameters: input.stochastic_parameters,
      });
      steps.push({ step: "stochastic", time_ms: Date.now() - t1, status: stochasticResult.status });
    }

    // Step 2: Sensitivity
    const t2 = Date.now();
    sensitivityResult = await callSolver("/analyze_sensitivity", {
      solver_type: input.solver_type,
      solver_request: input.solver_request,
      parameters: input.sensitivity_parameters || input.parameters || [],
    });
    steps.push({ step: "sensitivity", time_ms: Date.now() - t2, status: sensitivityResult.status });

    res.json({
      success: true,
      endpoint: "risk-analysis",
      time_ms: Date.now() - t0,
      steps,
      risk_summary: {
        cvar_95: stochasticResult?.recommended_objective || null,
        expected_value: stochasticResult?.distribution?.mean || null,
        worst_case: stochasticResult?.distribution?.max_value || null,
        cv_pct: stochasticResult?.distribution?.coefficient_of_variation || null,
        skewness: stochasticResult?.distribution?.skewness || null,
        critical_parameters: sensitivityResult?.parameters?.filter(p => p.critical).map(p => ({
          path: p.parameter_path,
          score: p.sensitivity_score,
          elasticity: p.elasticity,
          direction: p.direction,
          summary: p.risk_summary
        })) || [],
        risk_ranking: sensitivityResult?.risk_ranking || [],
      },
      stochastic_detail: stochasticResult ? {
        status: stochasticResult.status,
        distribution: stochasticResult.distribution,
        recommendation: stochasticResult.recommendation,
      } : null,
      sensitivity_detail: sensitivityResult ? {
        status: sensitivityResult.status,
        baseline_objective: sensitivityResult.baseline_objective,
        parameters: sensitivityResult.parameters,
      } : null,
      disclaimer: DISCLAIMER
    });
  } catch (err) {
    res.status(500).json({ error: err.message, steps, disclaimer: DISCLAIMER });
  }
}

// ── /full-intel ($3.00) — Complete pipeline A/B/C ──
// This is the upgraded /predict-strategy with higher price and disclaimer
// full-intel is handled by predict-strategy.js with disclaimer wrapper

// ── /batch-pm ($5-12) — Batch analysis on N markets ──
export async function batchPm(req, res) {
  const t0 = Date.now();
  const input = req.body;

  if (!input.markets || !Array.isArray(input.markets) || input.markets.length === 0) {
    return res.status(400).json({
      error: "Missing required field: markets (array of market analyses)",
      hint: "Each market needs: { name, solver_request, solver_type, stochastic_parameters }",
      max_markets: 10,
      disclaimer: DISCLAIMER
    });
  }

  if (input.markets.length > 10) {
    return res.status(400).json({ error: "Max 10 markets per batch", disclaimer: DISCLAIMER });
  }

  const results = [];
  for (const market of input.markets) {
    const mt0 = Date.now();
    try {
      // Run risk-analysis for each market
      const [stoch, sens] = await Promise.all([
        market.stochastic_parameters ? callSolver("/optimize_stochastic", {
          solver_type: market.solver_type || "scheduling",
          num_scenarios: 20,
          optimize_for: "cvar_95",
          seed: 42,
          solver_request: market.solver_request,
          stochastic_parameters: market.stochastic_parameters,
        }) : null,
        callSolver("/analyze_sensitivity", {
          solver_type: market.solver_type || "scheduling",
          solver_request: market.solver_request,
          parameters: market.sensitivity_parameters || [],
        })
      ]);

      results.push({
        market: market.name || `market_${results.length + 1}`,
        time_ms: Date.now() - mt0,
        cvar_95: stoch?.recommended_objective || null,
        expected: stoch?.distribution?.mean || null,
        worst_case: stoch?.distribution?.max_value || null,
        critical_params: sens?.parameters?.filter(p => p.critical).length || 0,
        risk_ranking: sens?.risk_ranking || [],
        top_risk: sens?.risk_ranking?.[0] || "none",
        status: "completed"
      });
    } catch (err) {
      results.push({
        market: market.name || `market_${results.length + 1}`,
        time_ms: Date.now() - mt0,
        status: "error",
        error: err.message
      });
    }
  }

  // Cross-market analysis
  const completedResults = results.filter(r => r.status === "completed");
  const riskiestMarket = completedResults.sort((a, b) => (b.cvar_95 || 0) - (a.cvar_95 || 0))[0];

  res.json({
    success: true,
    endpoint: "batch-pm",
    time_ms: Date.now() - t0,
    markets_analyzed: results.length,
    results,
    cross_market_summary: {
      riskiest_market: riskiestMarket?.market || null,
      highest_cvar: riskiestMarket?.cvar_95 || null,
      total_critical_params: completedResults.reduce((s, r) => s + r.critical_params, 0),
      markets_with_critical_risk: completedResults.filter(r => r.critical_params > 0).length,
    },
    disclaimer: DISCLAIMER
  });
}

// ── /validate-decision ($0.25) — Second Opinion pre-execution ──
export async function validateDecision(req, res) {
  const t0 = Date.now();
  const input = req.body;

  if (!input.jobs || !input.machines || !input.schedule) {
    return res.status(400).json({
      error: "Missing required fields: jobs, machines, schedule",
      hint: "Provide the schedule to validate. Optionally add sensitivity_parameters for fragility check.",
      disclaimer: DISCLAIMER
    });
  }

  const steps = [];

  try {
    // Step 1: Validate
    const t1 = Date.now();
    const validateResult = await callSolver("/validate_schedule", {
      jobs: input.jobs,
      machines: input.machines,
      schedule: input.schedule,
    });
    steps.push({ step: "validate", time_ms: Date.now() - t1 });

    // Step 2: Optional sensitivity
    let sensitivityResult = null;
    if (input.sensitivity_parameters) {
      const t2 = Date.now();
      sensitivityResult = await callSolver("/analyze_sensitivity", {
        solver_type: "scheduling",
        solver_request: { jobs: input.jobs, machines: input.machines },
        parameters: input.sensitivity_parameters,
      });
      steps.push({ step: "sensitivity", time_ms: Date.now() - t2 });
    }

    res.json({
      success: true,
      endpoint: "validate-decision",
      time_ms: Date.now() - t0,
      steps,
      validation: {
        is_valid: validateResult.is_valid,
        violations: validateResult.num_violations || 0,
        violation_details: validateResult.violations || [],
        suggestions: validateResult.improvement_suggestions || [],
      },
      fragility: sensitivityResult ? {
        critical_parameters: sensitivityResult.parameters?.filter(p => p.critical).length || 0,
        risk_ranking: sensitivityResult.risk_ranking || [],
        parameters: sensitivityResult.parameters?.map(p => ({
          path: p.parameter_path,
          score: p.sensitivity_score,
          critical: p.critical,
          direction: p.direction,
        })) || [],
      } : null,
      verdict: validateResult.is_valid ? "VALID — safe to execute" : `INVALID — ${validateResult.num_violations} violation(s) found`,
      disclaimer: DISCLAIMER
    });
  } catch (err) {
    res.status(500).json({ error: err.message, steps, disclaimer: DISCLAIMER });
  }
}
