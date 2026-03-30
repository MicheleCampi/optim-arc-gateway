// /pack-resources — Pipeline: Packing + Pareto
// Optimizes resource allocation with multi-objective trade-offs

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

export async function packResources(req, res) {
  const t0 = Date.now();
  const input = req.body;

  if (!input.solver_request) {
    return res.status(400).json({
      error: "Missing required field: solver_request",
      hint: "Provide a packing problem with solver_request (bins, items)"
    });
  }

  const results = { steps: [] };

  try {
    // Step 1 — Packing (optimal allocation)
    const t1 = Date.now();
    const packingResult = await callSolver("/optimize_packing", input.solver_request);
    results.steps.push({ step: "packing", time_ms: Date.now() - t1, status: packingResult.status || "error" });

    // Step 2 — Pareto (multi-objective trade-off)
    let paretoResult = null;
    if (input.objectives) {
      const t2 = Date.now();
      paretoResult = await callSolver("/optimize_pareto", {
        solver_type: "packing",
        num_points: input.num_points || 6,
        objectives: input.objectives,
        solver_request: input.solver_request,
      });
      results.steps.push({ step: "pareto", time_ms: Date.now() - t2, status: paretoResult.status || "error" });
    }

    const totalMs = Date.now() - t0;
    const strategies = [];

    // Strategy A — Max Efficiency (minimize bins)
    strategies.push({
      id: "A",
      name: "Efficient — Min Resources",
      description: "Pack into fewest resources possible. Maximizes utilization per resource.",
      risk_level: "high",
      metrics: {
        bins_used: packingResult.bin_summaries?.filter(b => b.is_used).length || 0,
        items_packed: packingResult.assignments?.length || 0,
        unpacked: packingResult.unpacked_items?.length || 0,
        avg_utilization: packingResult.bin_summaries?.filter(b => b.is_used).length > 0 ?
          Math.round(packingResult.bin_summaries.filter(b => b.is_used).reduce((s, b) => s + b.weight_utilization_pct, 0) / packingResult.bin_summaries.filter(b => b.is_used).length) : 0,
      },
    });

    if (paretoResult?.frontier) {
      // Strategy B — Balanced (Pareto balanced point)
      const balanced = paretoResult.frontier.find(p => p.is_balanced) || paretoResult.frontier[Math.floor(paretoResult.frontier.length / 2)];
      strategies.push({
        id: "B",
        name: "Balanced — Trade-off Optimized",
        description: "Best trade-off between competing objectives on the Pareto frontier.",
        risk_level: "medium",
        metrics: {
          pareto_point: balanced?.objectives || {},
          frontier_size: paretoResult.frontier.length,
        },
        trade_offs: paretoResult.trade_offs,
        recommendation: paretoResult.recommendation,
      });

      // Strategy C — Max Coverage (maximize items/value)
      const maxCoverage = paretoResult.frontier.find(p => p.is_extreme) || paretoResult.frontier[paretoResult.frontier.length - 1];
      strategies.push({
        id: "C",
        name: "Coverage — Max Items/Value",
        description: "Maximize items packed or total value. Uses more resources but covers everything.",
        risk_level: "low",
        metrics: {
          pareto_point: maxCoverage?.objectives || {},
        },
      });
    }

    res.json({
      success: true,
      pipeline: "pack-resources",
      total_time_ms: totalMs,
      steps: results.steps,
      strategies,
      raw_results: {
        packing: {
          status: packingResult.status,
          bins_used: packingResult.bin_summaries?.filter(b => b.is_used).length,
          items_packed: packingResult.assignments?.length,
          unpacked: packingResult.unpacked_items,
        },
        pareto: paretoResult ? {
          status: paretoResult.status,
          frontier_points: paretoResult.frontier?.length,
          trade_offs: paretoResult.trade_offs,
          recommendation: paretoResult.recommendation,
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
