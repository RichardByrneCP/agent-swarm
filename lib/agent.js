import { Agent, CursorAgentError } from '@cursor/sdk';

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.SWARM_AGENT_TIMEOUT_MS || '', 10) || 15 * 60 * 1000;

/**
 * Run a one-shot local agent and return a normalized result.
 *
 * Distinguishes the two failure modes the SDK exposes:
 *  - a thrown CursorAgentError means the run never started (auth/config/network)
 *  - a returned status of "error" means it started and failed mid-flight
 * All other exceptions are normalized into `{ ok: false }` so parallel waves
 * do not reject the entire Promise.all.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {string} params.model model id
 * @param {string} params.cwd working directory for the local agent
 * @param {string} params.apiKey
 * @param {string} [params.role] label for usage tracking
 * @param {boolean} [params.allowEmptyText] treat finished+empty text as success
 * @param {number} [params.timeoutMs] override default agent timeout
 * @returns {Promise<{ ok: boolean, text: string, status: string, agentId?: string, usage?: any, error?: string, startupError?: boolean }>}
 */
export async function runAgent({
  prompt,
  model,
  cwd,
  apiKey,
  role = 'agent',
  allowEmptyText = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const emptyUsage = () => normalizeUsage({}, role, model);
  try {
    const result = await withTimeout(
      Agent.prompt(prompt, {
        apiKey,
        model: { id: model },
        local: { cwd, settingSources: [] },
      }),
      timeoutMs,
      `Agent.prompt timed out after ${timeoutMs}ms`,
    );

    const text = extractText(result);
    const status = result.status || 'unknown';
    const finished = status === 'finished' || status === 'completed';
    const ok = finished && (allowEmptyText || text.trim().length > 0);
    return {
      ok,
      status,
      text,
      agentId: result.agentId || result.id,
      usage: normalizeUsage(result, role, model),
      error: ok
        ? undefined
        : finished
          ? 'empty model output'
          : `run status: ${status}`,
    };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      return {
        ok: false,
        status: 'startup_error',
        text: '',
        startupError: true,
        usage: emptyUsage(),
        error: `${err.message}${err.isRetryable ? ' (retryable)' : ''}`,
      };
    }
    if (err && err.code === 'SWARM_AGENT_TIMEOUT') {
      return {
        ok: false,
        status: 'timeout',
        text: '',
        usage: emptyUsage(),
        error: err.message,
      };
    }
    return {
      ok: false,
      status: 'error',
      text: '',
      usage: emptyUsage(),
      error: err?.message || String(err),
    };
  }
}

function withTimeout(promise, ms, message) {
  if (!ms || ms <= 0) return promise;
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.code = 'SWARM_AGENT_TIMEOUT';
      reject(err);
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function extractText(result) {
  if (typeof result?.result === 'string') return result.result;
  if (typeof result?.text === 'string') return result.text;
  // Fall back to concatenating assistant text blocks if present.
  const messages = result?.messages || [];
  const parts = [];
  for (const msg of messages) {
    const content = msg?.message?.content || msg?.content || [];
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * Pull whatever usage/cost fields the SDK provides into a stable shape. Fields
 * are read defensively because the exact schema can evolve.
 */
function normalizeUsage(result, role, model) {
  const u = result?.usage || result?.tokenUsage || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const inputTokens = num(u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens);
  const outputTokens = num(
    u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens,
  );
  const reportedTotal = num(u.totalTokens ?? u.total_tokens);
  const sum = inputTokens + outputTokens;
  const costUsd = num(
    result?.costUsd ?? result?.cost ?? u.costUsd ?? u.cost_usd ?? u.totalCostUsd,
  );
  return {
    role,
    model,
    inputTokens,
    outputTokens,
    totalTokens: Math.max(sum, reportedTotal),
    costUsd,
    runs: 1,
  };
}
