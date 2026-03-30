// /schedule-robust — Pipeline: Scheduling + Stochastic
// Optimizes scheduling with Monte Carlo risk analysis under uncertainty

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

export async function scheduleRobust(req, res) {
  const t0 = Date.now();
  const input = req.body;

  if (!input.solver_request) {
    return res.status(400).json({
      error: "Missing required field: solver_request",
      hint: "Provide a scheduling problem with solver_request (jobs, machines)"
    });
  }

  const results = { steps: [] };

  try {
    // Step 1 — Scheduling (optimal plan)
    const t1 = Date.now();
    const scheduleResult = await callSolver("/optimize_schedule", input.solver_request);
    results.steps.push({ step: "scheduling", time_ms: Date.now() - t1, status: scheduleResult.status || "error" });

    // Step 2 — Stochastic (risk under uncertainty)
    let stochasticResult = null;
    if (input.stochastic_parameters) {
      const t2 = Date.now();
      stochasticResult = await callSolver("/optimize_stochastic", {
        solver_type: "scheduling",
        num_scenarios: input.num_scenarios || 30,
        optimize_for: input.optimize_for || "cvar_95",
        solver_request: input.solver_request,
        stochastic_parameters: input.stochastic_parameters,
        seed: input.seed || 42,
      });
      results.steps.push({ step: "stochastic", time_ms: Date.now() - t2, status: stochasticResult.status || "error" });
    }

    const totalMs = Date.now() - t0;
    const strategies = [];

    // Strategy A — Nominal (optimistic, no uncertainty)
    strategies.push({
      id: "A",
      name: "Nominal — Optimistic Plan",
      description: "Schedule optimized assuming all durations at nominal values. Best case.",
      risk_level: "high",
      metrics: {
        makespan: scheduleResult.metrics?.makespan,
        jobs_on_time: scheduleResult.job_summaries?.filter(j => j.on_time).length,
        total_jobs: scheduleResult.job_summaries?.length,
        avg_utilization: scheduleResult.machine_utilization ? Math.round(scheduleResult.machine_utilization.reduce((s,m) => s + m.utilization_pct, 0) / scheduleResult.machine_utilization.length) : null,
      },
      schedule: scheduleResult.schedule,
    });

    if (stochasticResult) {
      // Strategy B — CVaR Protected
      strategies.push({
        id: "B",
        name: "Protected — CVaR Optimized",
        description: "Schedule optimized for worst-case risk (CVaR). Sacrifices makespan for resilience.",
        risk_level: "low",
        metrics: {
          cvar_objective: stochasticResult.recommended_objective,
          expected_value: stochasticResult.distribution?.mean,
          worst_case: stochasticResult.distribution?.max,
          risk_premium_pct: stochasticResult.risk?.risk_premium_pct,
          feasibility_rate: stochasticResult.distribution ? Math.round(100 * stochasticResult.scenarios.filter(s => s.feasible).length / stochasticResult.scenarios.length) : null,
        },
        recommendation: stochasticResult.recommendation,
      });

      // Strategy C — Balanced
      const nominal = stochasticResult.distribution?.mean;
      const cvar = stochasticResult.recommended_objective;
      strategies.push({
        id: "C",
        name: "Balanced — Risk-Adjusted",
        description: "Middle ground between nominal and CVaR-protected. Moderate risk tolerance.",
        risk_level: "medium",
        metrics: {
          nominal_makespan: scheduleResult.metrics?.makespan,
          expected_stochastic: nominal,
          cvar_value: cvar,
          gap_pct: nominal && cvar ? Math.round(100 * Math.abs(cvar - nominal) / Math.max(nominal, 1)) : null,
        },
        recommendation: "Use nominal schedule but add buffer time on critical-path tasks. Monitor parameters identified as uncertain.",
      });
    }

    res.json({
      success: true,
      pipeline: "schedule-robust",
      total_time_ms: totalMs,
      steps: results.steps,
      strategies,
      raw_results: {
        scheduling: {
          status: scheduleResult.status,
          makespan: scheduleResult.metrics?.makespan,
          jobs: scheduleResult.job_summaries?.length,
          on_time: scheduleResult.job_summaries?.filter(j => j.on_time).length,
        },
        stochastic: stochasticResult ? {
          status: stochasticResult.status,
          scenarios: stochasticResult.scenarios?.length,
          cvar: stochasticResult.recommended_objective,
          recommendation: stochasticResult.recommendation,
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
