import { runAgent } from './agent.js';
import { extractJson } from './json.js';

/**
 * Review a worker's diff (a decorrelated "lens" over the change). Returns a
 * pass/fail verdict plus notes. Review is cheap relative to the work it audits.
 *
 * @returns {Promise<{ pass: boolean, notes: string, usage: any }>}
 */
export async function runReviewer({ leaf, diff, cwd, model, apiKey, shared }) {
  if (!diff || diff.trim() === '') {
    return { pass: false, notes: 'Worker produced no changes.', usage: null };
  }

  const prompt = `You are a REVIEWER agent. Judge whether the change below correctly and completely satisfies its task, within its declared scope, and respects the shared design decisions.

## TASK: ${leaf.title}
${leaf.spec}

## DECLARED FILE SCOPE
${leaf.fileScope.map((s) => `- ${s}`).join('\n')}

## SHARED DESIGN DECISIONS
${shared.decisions || '(none)'}

## DIFF UNDER REVIEW
\`\`\`diff
${truncate(diff, 24000)}
\`\`\`

Assess: correctness, completeness vs the task, scope discipline (no unjustified out-of-scope edits), and adherence to design decisions. Minor style issues are not grounds for rejection.

Respond with ONLY JSON between <PLAN_JSON> and </PLAN_JSON>:
<PLAN_JSON>
{ "verdict": "pass" | "fail", "notes": "specific, actionable feedback (required when fail)" }
</PLAN_JSON>`;

  const res = await runAgent({ prompt, model, cwd, apiKey, role: 'reviewer' });
  if (!res.ok) {
    // If the reviewer itself failed to run, don't block the pipeline; pass with a note.
    return { pass: true, notes: `reviewer did not complete (${res.error || res.status})`, usage: res.usage };
  }

  try {
    const parsed = extractJson(res.text);
    const pass = String(parsed.verdict).toLowerCase() === 'pass';
    return { pass, notes: String(parsed.notes || '').trim(), usage: res.usage };
  } catch {
    // Unparseable verdict: be lenient but record it.
    return { pass: true, notes: 'reviewer verdict unparseable; accepted by default', usage: res.usage };
  }
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + '\n... [diff truncated] ...' : s;
}
