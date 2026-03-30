// /predict-strategy — Pipeline: Stochastic + Pareto + Sensitivity + Prescriptive
// Aggregates results into 3 strategies: A (aggressive), B (balanced), C (defensive)

const ENGINE_URL = process.env.OPTIMENGINE_URL;
const ENGINE_KEY = process.env.ENGINE_API_KEY || "";

async function callSolver(path, body) {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Engine-Key": ENGINE_KEY },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function predictStrategy(req, res) {
  const t0 = Date.now();
  const input = req.body;

  // Validate minimum input
  if (!input.solver_request || !input.solver_type) {
    return res.status(400).json({
      error: "Missing required fields: solver_request, solver_type",
      hint: "See /docs/templates for prediction market examples"
    });
  }

  const solverType = input.solver_type || "scheduling";
  const results = { steps: [], errors: [] };

  try {
    // Step 1 — Stochastic (CVaR risk quantification)
    let stochasticResult = null;
    if (input.stochastic_parameters) {
      const t1 = Date.now();
      stochasticResult = await callSolver("/optimize_stochastic", {
        solver_type: solverType,
        num_scenarios: input.num_scenarios || 30,
        optimize_for: input.optimize_for || "cvar_95",
        solver_request: input.solver_request,
        stochastic_parameters: input.stochastic_parameters,
        seed: input.seed || 42,
      });
      results.steps.push({ step: "stochastic", time_ms: Date.now() - t1, status: stochasticResult.status || "error" });
    }

    // Step 2 — Pareto (risk/return trade-off)
    let paretoResult = null;
    if (input.objectives) {
      const t2 = Date.now();
      paretoResult = await callSolver("/optimize_pareto", {
        solver_type: solverType,
        num_points: input.num_points || 6,
        objectives: input.objectives,
        solver_request: input.solver_request,
      });
      results.steps.push({ step: "pareto", time_ms: Date.now() - t2, status: paretoResult.status || "error" });
    }

    // Step 3 — Sensitivity (fragility check)
    let sensitivityResult = null;
    const t3 = Date.now();
    sensitivityResult = await callSolver("/analyze_sensitivity", {
      solver_type: solverType,
      solver_request: input.solver_request,
      parameters: input.sensitivity_parameters || [],
    });
    results.steps.push({ step: "sensitivity", time_ms: Date.now() - t3, status: sensitivityResult.status || "error" });

    // Step 4 — Prescriptive (forecast + optimize + advise) — optional
    let prescriptiveResult = null;
    if (input.forecast_parameters) {
      const t4 = Date.now();
      prescriptiveResult = await callSolver("/prescriptive_advise", {
        solver_type: solverType,
        solver_request: input.solver_request,
        forecast_parameters: input.forecast_parameters,
        risk_appetite: "moderate",
      });
      results.steps.push({ step: "prescriptive", time_ms: Date.now() - t4, status: prescriptiveResult.status || "error" });
    }

    // === AGGREGATION: Build strategies A/B/C ===
    const strategies = buildStrategies(stochasticResult, paretoResult, sensitivityResult, prescriptiveResult);

    const totalMs = Date.now() - t0;

    res.json({
      success: true,
      pipeline: "predict-strategy",
      total_time_ms: totalMs,
      steps: results.steps,
      strategies,
      raw_results: {
        stochastic: stochasticResult ? {
          status: stochasticResult.status,
          recommended_objective: stochasticResult.recommended_objective,
          risk: stochasticResult.risk,
          distribution: stochasticResult.distribution,
          recommendation: stochasticResult.recommendation,
        } : null,
        pareto: paretoResult ? {
          status: paretoResult.status,
          frontier: paretoResult.frontier,
          trade_offs: paretoResult.trade_offs,
          recommendation: paretoResult.recommendation,
        } : null,
        sensitivity: sensitivityResult ? {
          status: sensitivityResult.status,
          risk_ranking: sensitivityResult.risk_ranking,
          parameters: sensitivityResult.parameters?.map(p => ({
            parameter_path: p.parameter_path,
            sensitivity_score: p.sensitivity_score,
            elasticity: p.elasticity,
            critical: p.critical,
            direction: p.direction,
            risk_summary: p.risk_summary,
          })),
        } : null,
        prescriptive: prescriptiveResult ? {
          status: prescriptiveResult.status,
          forecasts: prescriptiveResult.forecasts,
          actions: prescriptiveResult.actions,
          recommendation: prescriptiveResult.recommendation,
        } : null,
      },
    });

  } catch (err) {
    res.status(500).json({
      error: "Pipeline error",
      message: err.message,
      steps_completed: results.steps,
      total_time_ms: Date.now() - t0,
    });
  }
}

function buildStrategies(stochastic, pareto, sensitivity, prescriptive) {
  const strategies = [];

  // Strategy A — Aggressive (maximize edge, accept risk)
  const stratA = {
    id: "A",
    name: "Aggressive — Max Edge",
    description: "Optimizes for maximum return. Accepts higher risk. Best when your probability estimates are confident.",
    risk_level: "high",
    conditions: [],
    metrics: {},
  };
  if (pareto?.frontier) {
    const extreme = pareto.frontier.find(p => p.is_extreme) || pareto.frontier[0];
    stratA.metrics.pareto_point = extreme?.objectives || {};
  }
  if (stochastic?.distribution) {
    stratA.metrics.expected_value = stochastic.distribution?.mean;
    stratA.metrics.best_case = stochastic.distribution?.min;
  }
  if (sensitivity?.parameters) {
    const critical = sensitivity.parameters.filter(p => p.critical);
    stratA.conditions = critical.map(p => `${p.parameter_path} must stay within ±${Math.round(p.sensitivity_score)}% (critical parameter)`);
    stratA.fragility = critical.length > 0 ? "FRAGILE — " + critical.length + " critical parameter(s)" : "ROBUST";
  }
  strategies.push(stratA);

  // Strategy B — Balanced (trade-off risk/return)
  const stratB = {
    id: "B",
    name: "Balanced — Risk-Adjusted",
    description: "Balances return and risk. Uses CVaR-optimized or Pareto-balanced solution. Recommended for most cases.",
    risk_level: "medium",
    conditions: [],
    metrics: {},
  };
  if (pareto?.frontier) {
    const balanced = pareto.frontier.find(p => p.is_balanced) || pareto.frontier[Math.floor(pareto.frontier.length / 2)];
    stratB.metrics.pareto_point = balanced?.objectives || {};
  }
  if (stochastic) {
    stratB.metrics.cvar_objective = stochastic.recommended_objective;
    stratB.metrics.risk_premium = stochastic.risk?.risk_premium_pct;
  }
  if (prescriptive?.recommendation) {
    stratB.recommendation = prescriptive.recommendation;
    stratB.actions = prescriptive.actions?.slice(0, 3);
  }
  strategies.push(stratB);

  // Strategy C — Defensive (minimize downside)
  const stratC = {
    id: "C",
    name: "Defensive — Min Downside",
    description: "Minimizes worst-case exposure. Sacrifices upside for protection. Best when estimates are uncertain.",
    risk_level: "low",
    conditions: [],
    metrics: {},
  };
  if (stochastic?.distribution) {
    stratC.metrics.worst_case = stochastic.distribution?.max; // max makespan = worst for scheduling
    stratC.metrics.cvar_99 = stochastic.risk?.cvar_99;
  }
  if (pareto?.frontier) {
    const defensive = pareto.frontier[pareto.frontier.length - 1];
    stratC.metrics.pareto_point = defensive?.objectives || {};
  }
  if (sensitivity?.risk_ranking) {
    stratC.conditions = [`Monitor top risk: ${sensitivity.risk_ranking[0] || 'N/A'}`];
  }
  strategies.push(stratC);

  return strategies;
}
