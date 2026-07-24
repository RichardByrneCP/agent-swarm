import { Cursor } from '@cursor/sdk';
import { log } from './lib/log.js';

/**
 * Resolve the latest available Opus model id for the calling account.
 * Model lists evolve, so we never hardcode an unverified id: we list the
 * account's models and pick the newest one whose id looks like Opus.
 *
 * @param {string} apiKey
 * @param {string} [override] explicit id to use instead of auto-detection
 * @returns {Promise<string>}
 */
export async function resolvePlannerModel(apiKey, override) {
  if (override) return override;

  let models;
  try {
    models = await Cursor.models.list({ apiKey });
  } catch (err) {
    throw new Error(
      `Could not list models to resolve the Opus planner id (${err.message}). ` +
        'Set PLANNER_MODEL in .env or pass --planner-model to bypass detection.',
    );
  }

  const ids = normalizeModelIds(models);
  const opus = pickLatest(ids, 'opus');
  if (!opus) {
    throw new Error(
      `No Opus model available to this account. Available: ${ids.join(', ') || '(none)'}. ` +
        'Set PLANNER_MODEL to a model you have access to.',
    );
  }
  log.info(`Resolved planner model: ${log.color.magenta(opus)}`);
  return opus;
}

/** Verify a worker/reviewer model id exists; warn (do not fail) if not listable. */
export async function verifyModel(apiKey, id) {
  try {
    const models = await Cursor.models.list({ apiKey });
    const ids = normalizeModelIds(models);
    if (ids.length && !ids.includes(id)) {
      log.warn(
        `Model "${id}" not found in your account's model list (${ids.join(', ')}). ` +
          'Continuing anyway; override with the matching env var if this fails.',
      );
    }
  } catch {
    // Non-fatal: listing failed, let the actual run surface any real error.
  }
}

function normalizeModelIds(models) {
  const list = Array.isArray(models) ? models : models?.data || models?.models || [];
  return list
    .map((m) => (typeof m === 'string' ? m : m?.id))
    .filter((id) => typeof id === 'string');
}

function pickLatest(ids, needle) {
  const matches = ids.filter((id) => id.toLowerCase().includes(needle));
  if (matches.length === 0) return null;
  // Sort so the highest version string sorts last; numeric-aware compare.
  matches.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return matches[matches.length - 1];
}
