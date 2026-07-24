import { runAgent } from './agent.js';
import { extractJson } from './json.js';

/**
 * Review a worker's diff (a decorrelated "lens" over the change). Returns a
 * pass/fail verdict plus notes. Fail-closed on infrastructure or parse errors.
 *
 * @returns {Promise<{ pass: boolean, notes: string, usage: any }>}
 */
export async function runReviewer({ leaf, diff, cwd, model, apiKey, shared }) {
  if (!diff || diff.trim() === '') {
    return {
      pass: false,
      notes: 'Empty diff after worker commit (no changes, or git diff failed).',
      usage: null,
    };
  }

  const { text: diffText, truncated } = truncateDiff(diff, 24000);
  const truncationNote = truncated
    ? '\n\nNOTE: The diff was truncated for size. Treat unseen hunks as unverified; fail if completeness cannot be established from the visible portion.\n'
    : '';

  const prompt = `You are a REVIEWER agent. Judge whether the change below correctly and completely satisfies its task, within its declared scope, and respects the shared design decisions.

## TASK: ${leaf.title}
${leaf.spec}

## DECLARED FILE SCOPE
${leaf.fileScope.map((s) => `- ${s}`).join('\n')}

## SHARED DESIGN DECISIONS
${shared.decisions || '(none)'}
${truncationNote}
## DIFF UNDER REVIEW
\`\`\`diff
${diffText}
\`\`\`

Assess: correctness, completeness vs the task, scope discipline (no unjustified out-of-scope edits), and adherence to design decisions. Minor style issues are not grounds for rejection.

Respond with ONLY JSON between <PLAN_JSON> and </PLAN_JSON>:
<PLAN_JSON>
{ "verdict": "pass" | "fail", "notes": "specific, actionable feedback (required when fail)" }
</PLAN_JSON>`;

  const res = await runAgent({ prompt, model, cwd, apiKey, role: 'reviewer' });
  if (!res.ok) {
    return {
      pass: false,
      notes: `reviewer did not complete (${res.error || res.status})`,
      usage: res.usage,
    };
  }

  try {
    const parsed = extractJson(res.text);
    const pass = String(parsed.verdict ?? '')
      .trim()
      .toLowerCase() === 'pass';
    const notes = String(parsed.notes || '').trim();
    return {
      pass,
      notes: truncated && pass ? `${notes} (diff was truncated during review)`.trim() : notes,
      usage: res.usage,
    };
  } catch {
    return {
      pass: false,
      notes: 'reviewer verdict unparseable; treating as fail',
      usage: res.usage,
    };
  }
}

/** Keep head and tail when truncating so late-file hunks are not invisible. */
function truncateDiff(s, max) {
  if (s.length <= max) return { text: s, truncated: false };
  const half = Math.floor((max - 80) / 2);
  const text =
    s.slice(0, half) +
    '\n... [diff truncated: middle omitted] ...\n' +
    s.slice(s.length - half);
  return { text, truncated: true };
}
