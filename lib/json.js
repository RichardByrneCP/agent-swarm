/**
 * Extract a JSON object/array from a model's free-form text response.
 *
 * Prefers content wrapped in <PLAN_JSON>...</PLAN_JSON> markers, then a fenced
 * ```json block, then falls back to the first balanced {...} or [...] span.
 *
 * @param {string} text
 * @returns {any} parsed JSON
 */
export function extractJson(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Cannot extract JSON from empty model response');
  }

  const marker = matchBetween(text, '<PLAN_JSON>', '</PLAN_JSON>');
  if (marker) return parseOrThrow(marker);

  const fenced = matchFence(text);
  if (fenced) return parseOrThrow(fenced);

  const balanced = matchBalanced(text);
  if (balanced) return parseOrThrow(balanced);

  throw new Error('No JSON found in model response');
}

function matchBetween(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return null;
  const end = text.indexOf(close, start + open.length);
  if (end === -1) return null;
  return text.slice(start + open.length, end).trim();
}

function matchFence(text) {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return fence ? fence[1].trim() : null;
}

function matchBalanced(text) {
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  const candidates = [startObj, startArr].filter((i) => i !== -1);
  if (candidates.length === 0) return null;
  const start = Math.min(...candidates);
  const open = text[start];
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseOrThrow(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON from model response: ${err.message}`);
  }
}
