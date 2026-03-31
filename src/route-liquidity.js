// /route-liquidity — Pipeline: Routing + Robust
// Optimizes routing with worst-case protection under uncertainty

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

export async function routeLiquidity(req, res) {
  const t0 = Date.now();
  const input = req.body;

  if (!input.solver_request) {
    return res.status(400).json({
      error: "Missing required field: solver_request",
      hint: "Provide a routing problem with solver_request (depot_id, locations, vehicles, distance_matrix)"
    });
  }

  const results = { steps: [] };

  try {
    // Step 1 — Routing (optimal route)
    const t1 = Date.now();
    const routingResult = await callSolver("/optimize_routing", {
      allow_drop_visits: true, max_solve_time_seconds: 5,
      ...input.solver_request,
    });
    results.steps.push({ step: "routing", time_ms: Date.now() - t1, status: routingResult.status || "error" });

    // Step 2 — Robust (worst-case protection)
    let robustResult = null;
    if (input.uncertain_parameters) {
      const t2 = Date.now();
      robustResult = await callSolver("/optimize_robust", {
        solver_type: "routing",
        mode: input.mode || "percentile_95",
        num_scenarios: input.num_scenarios || 15,
        solver_request: input.solver_request,
        uncertain_parameters: input.uncertain_parameters,
      });
      results.steps.push({ step: "robust", time_ms: Date.now() - t2, status: robustResult.status || "error" });
    }

    // === AGGREGATION ===
    const totalMs = Date.now() - t0;

    const strategies = [];

    // Strategy A — Optimal (best case, no protection)
    strategies.push({
      id: "A",
      name: "Optimal — Max Efficiency",
      description: "Best routing assuming all parameters at nominal values. No downside protection.",
      risk_level: "high",
      metrics: {
        routes: routingResult.routes?.length || 0,
        total_distance: routingResult.metrics?.total_distance || routingResult.routes?.reduce((s, r) => s + (r.total_distance || 0), 0) || 0,
        dropped: routingResult.dropped_locations?.length || 0,
      },
      route_summary: routingResult.routes?.map(r => ({
        vehicle: r.vehicle_id,
        stops: r.num_stops,
        distance: r.total_distance,
        load: r.total_load,
      })),
    });

    // Strategy B — Robust (protected)
    if (robustResult) {
      const nominalScenario = robustResult.scenarios?.find(s => s.is_nominal);
      const worstScenario = robustResult.scenarios?.find(s => s.is_worst_case);

      strategies.push({
        id: "B",
        name: "Robust — Protected",
        description: "Routing optimized for worst-case or 95th percentile scenarios. Sacrifices efficiency for resilience.",
        risk_level: "low",
        metrics: {
          nominal_objective: nominalScenario?.objective_value,
          worst_case_objective: worstScenario?.objective_value,
          scenarios_tested: robustResult.scenarios?.length || 0,
          feasible_pct: robustResult.scenarios ? Math.round(100 * robustResult.scenarios.filter(s => s.feasible).length / robustResult.scenarios.length) : 0,
        },
        recommendation: robustResult.recommendation,
      });

      // Strategy C — Balanced (average of nominal and robust)
      strategies.push({
        id: "C",
        name: "Balanced — Risk-Adjusted",
        description: "Middle ground between optimal and robust. Use when uncertainty is moderate.",
        risk_level: "medium",
        metrics: {
          nominal: nominalScenario?.objective_value,
          worst: worstScenario?.objective_value,
          gap_pct: nominalScenario && worstScenario ? Math.round(100 * Math.abs(worstScenario.objective_value - nominalScenario.objective_value) / Math.max(nominalScenario.objective_value, 1)) : null,
        },
        recommendation: "Use nominal routing but monitor parameters identified as uncertain. Switch to robust if conditions deteriorate.",
      });
    }

    res.json({
      success: true,
      pipeline: "route-liquidity",
      total_time_ms: totalMs,
      steps: results.steps,
      strategies,
      raw_results: {
        routing: {
          status: routingResult.status,
          routes: routingResult.routes?.length,
          dropped: routingResult.dropped_locations,
          metrics: routingResult.metrics,
        },
        robust: robustResult ? {
          status: robustResult.status,
          scenarios: robustResult.scenarios?.length,
          recommendation: robustResult.recommendation,
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
