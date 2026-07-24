import { log } from './log.js';

/** Accumulates per-role token/cost usage across all agent runs in a swarm run. */
export function createCostTracker() {
  const roles = new Map();

  const add = (usage) => {
    if (!usage) return;
    const key = usage.role || 'unknown';
    const cur = roles.get(key) || {
      role: key,
      model: usage.model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      runs: 0,
    };
    cur.inputTokens += usage.inputTokens || 0;
    cur.outputTokens += usage.outputTokens || 0;
    cur.totalTokens += usage.totalTokens || 0;
    cur.costUsd += usage.costUsd || 0;
    cur.runs += usage.runs || 1;
    cur.model = usage.model || cur.model;
    roles.set(key, cur);
  };

  const summary = () => {
    const rows = [...roles.values()];
    const totals = rows.reduce(
      (t, r) => ({
        totalTokens: t.totalTokens + r.totalTokens,
        costUsd: t.costUsd + r.costUsd,
        runs: t.runs + r.runs,
      }),
      { totalTokens: 0, costUsd: 0, runs: 0 },
    );
    return { rows, totals };
  };

  const print = () => {
    const { rows, totals } = summary();
    log.heading('Cost / usage by role');
    if (rows.length === 0) {
      log.info('No usage data reported by the SDK for this run.');
      return;
    }
    for (const r of rows) {
      const pct = totals.costUsd > 0 ? ` (${((r.costUsd / totals.costUsd) * 100).toFixed(0)}% of cost)` : '';
      log.info(
        `${r.role.padEnd(11)} ${String(r.runs).padStart(3)} run(s)  ` +
          `${fmt(r.totalTokens)} tok  $${r.costUsd.toFixed(4)}${pct}  ${log.color.dim(r.model || '')}`,
      );
    }
    log.info(
      log.color.bold(
        `TOTAL       ${String(totals.runs).padStart(3)} run(s)  ${fmt(totals.totalTokens)} tok  ` +
          `$${totals.costUsd.toFixed(4)}`,
      ),
    );
    if (totals.costUsd === 0) {
      log.info(log.color.dim('(cost is $0 if your SDK/plan does not report per-run cost; token counts may still be shown)'));
    }
  };

  return { add, summary, print };
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k`.padStart(7) : String(n).padStart(7);
}
