import { log } from './log.js';

/** Accumulates per-role token/cost usage across all agent runs in a swarm run. */
export function createCostTracker() {
  const roles = new Map();

  const add = (usage) => {
    if (!usage) return;
    const key = usage.role || 'unknown';
    const cur = roles.get(key) || {
      role: key,
      models: new Set(),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      runs: 0,
    };
    const inputTokens = finiteOrZero(usage.inputTokens);
    const outputTokens = finiteOrZero(usage.outputTokens);
    const reportedTotal = finiteOrZero(usage.totalTokens);
    cur.inputTokens += inputTokens;
    cur.outputTokens += outputTokens;
    cur.totalTokens += reportedTotal || inputTokens + outputTokens;
    cur.costUsd += finiteOrZero(usage.costUsd);
    cur.runs += usage.runs ?? 1;
    if (usage.model) cur.models.add(usage.model);
    roles.set(key, cur);
  };

  const summary = () => {
    const rows = [...roles.values()].map((r) => ({
      role: r.role,
      model: formatModels(r.models),
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      costUsd: r.costUsd,
      runs: r.runs,
    }));
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

function formatModels(models) {
  const list = [...models];
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `mixed(${list.join(', ')})`;
}

function finiteOrZero(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function fmt(n) {
  const v = finiteOrZero(n);
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k`.padStart(7) : String(Math.round(v)).padStart(7);
}
