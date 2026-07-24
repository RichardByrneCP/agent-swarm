import { runAgent } from './agent.js';

const NOTES_MARKER = 'FIELD GUIDE NOTES';

/**
 * Execute one leaf task with a worker (Composer) agent in its own worktree.
 *
 * @param {object} params
 * @param {object} params.leaf leaf node { id, title, spec, fileScope }
 * @param {string} params.cwd leaf worktree path
 * @param {string} params.model worker model id
 * @param {string} params.apiKey
 * @param {{ decisions: string, fieldGuide: string }} params.shared shared context
 * @param {string} [params.reviewNotes] feedback from a failed review, for a retry
 * @returns {Promise<{ ok: boolean, notes: string, usage: any, status: string, error?: string }>}
 */
export async function runWorker({ leaf, cwd, model, apiKey, shared, reviewNotes }) {
  const prompt = buildWorkerPrompt(leaf, shared, reviewNotes);
  const res = await runAgent({ prompt, model, cwd, apiKey, role: 'worker' });
  return {
    ok: res.ok,
    status: res.status,
    error: res.error,
    usage: res.usage,
    notes: extractNotes(res.text),
  };
}

function buildWorkerPrompt(leaf, shared, reviewNotes) {
  return `You are a WORKER agent in a planner/worker swarm. Implement exactly ONE task. Do not plan or expand scope.

## TASK: ${leaf.title}
${leaf.spec}

## FILE SCOPE (only edit files within this scope)
${leaf.fileScope.map((s) => `- ${s}`).join('\n')}

Rules:
- Implement the task completely and correctly within your file scope.
- Do NOT edit files outside your scope. If you believe an out-of-scope change is essential, make the smallest possible change and add a code comment starting with "SWARM-BREAKING:" explaining why.
- Follow the shared design decisions below exactly. Do not re-decide settled questions.
- Keep files focused; do not create "megafiles".

## SHARED DESIGN DECISIONS (authoritative)
${shared.decisions || '(none)'}

## FIELD GUIDE (accumulated team knowledge)
${shared.fieldGuide || '(empty)'}
${reviewNotes ? `\n## REVIEW FEEDBACK TO ADDRESS (a prior attempt was rejected)\n${reviewNotes}\n` : ''}
When finished, end your response with a section titled "${NOTES_MARKER}" containing 0-5 short bullet points capturing anything surprising or useful for teammates (conventions, gotchas, decisions you had to infer). If nothing is worth noting, write "${NOTES_MARKER}: none".`;
}

function extractNotes(text) {
  if (typeof text !== 'string') return '';
  const idx = text.lastIndexOf(NOTES_MARKER);
  if (idx === -1) return '';
  const after = text.slice(idx + NOTES_MARKER.length).replace(/^[:\s]+/, '');
  if (/^none\b/i.test(after)) return '';
  return after.trim();
}
