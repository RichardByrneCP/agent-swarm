/**
 * Extract a JSON object/array from a model's free-form text response.
 *
 * Prefers content wrapped in <PLAN_JSON>...</PLAN_JSON> markers, then a fenced
 * ```json block, then falls back to balanced {...} or [...] spans (trying each
 * candidate until one parses).
 *
 * @param {string} text
 * @returns {any} parsed JSON
 */
export function extractJson(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Cannot extract JSON from empty model response');
  }

  const marker = matchBetween(text, '<PLAN_JSON>', '</PLAN_JSON>');
  if (marker) {
    const parsed = tryParseJson(stripFence(marker));
    if (parsed.ok) return parsed.value;
  }

  const fenced = matchFence(text);
  if (fenced) {
    const parsed = tryParseJson(fenced);
    if (parsed.ok) return parsed.value;
  }

  for (const span of matchBalancedCandidates(text)) {
    const parsed = tryParseJson(span);
    if (parsed.ok) return parsed.value;
  }

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

/** Strip a surrounding markdown fence if the model nested one inside markers. */
function stripFence(raw) {
  const trimmed = String(raw).trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

/**
 * Yield every balanced `{...}` / `[...]` span in document order so a prose
 * brace/bracket before the real payload does not abort extraction.
 */
function* matchBalancedCandidates(text) {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const span = scanBalanced(text, i);
    if (span) {
      yield span;
      // Continue after this opening char so nested / later candidates are tried.
    }
  }
}

function scanBalanced(text, start) {
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

function tryParseJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: null };
  }
}
