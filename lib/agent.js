import { Agent, CursorAgentError } from '@cursor/sdk';

/**
 * Run a one-shot local agent and return a normalized result.
 *
 * Distinguishes the two failure modes the SDK exposes:
 *  - a thrown CursorAgentError means the run never started (auth/config/network)
 *  - a returned status of "error" means it started and failed mid-flight
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {string} params.model model id
 * @param {string} params.cwd working directory for the local agent
 * @param {string} params.apiKey
 * @param {string} [params.role] label for usage tracking
 * @returns {Promise<{ ok: boolean, text: string, status: string, agentId?: string, usage?: any, error?: string, startupError?: boolean }>}
 */
export async function runAgent({ prompt, model, cwd, apiKey, role = 'agent' }) {
  try {
    const result = await Agent.prompt(prompt, {
      apiKey,
      model: { id: model },
      local: { cwd, settingSources: [] },
    });

    const text = extractText(result);
    const ok = result.status === 'finished' || result.status === 'completed';
    return {
      ok,
      status: result.status || 'unknown',
      text,
      agentId: result.agentId || result.id,
      usage: normalizeUsage(result, role, model),
      error: ok ? undefined : `run status: ${result.status}`,
    };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      return {
        ok: false,
        status: 'startup_error',
        text: '',
        startupError: true,
        error: `${err.message}${err.isRetryable ? ' (retryable)' : ''}`,
      };
    }
    throw err;
  }
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
  const num = (v) => (typeof v === 'number' ? v : 0);
  const inputTokens = num(u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens);
  const outputTokens = num(
    u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens,
  );
  const costUsd = num(
    result?.costUsd ?? result?.cost ?? u.costUsd ?? u.cost_usd ?? u.totalCostUsd,
  );
  return {
    role,
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens || num(u.totalTokens ?? u.total_tokens),
    costUsd,
    runs: 1,
  };
}
