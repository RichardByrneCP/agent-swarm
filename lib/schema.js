import { log } from './log.js';

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate and normalize one planner invocation's output (a single tree level).
 *
 * @param {any} raw parsed JSON from the planner
 * @param {object} [ctx]
 * @param {string[]} [ctx.parentScope] parent node's fileScope, for containment checks
 * @param {string} [ctx.parentId] parent id, for error messages
 * @returns {{ designDecisions: string[], nodes: object[] }}
 */
export function validatePlannerLevel(raw, ctx = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Planner output must be a JSON object with a "nodes" array');
  }
  const nodes = raw.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('Planner output "nodes" must be a non-empty array');
  }

  const designDecisions = normalizeStringArray(raw.designDecisions);
  const seen = new Set();
  const normalized = nodes.map((node, i) => normalizeNode(node, i, seen));

  validateDeps(normalized);
  validateSiblingScopes(normalized, ctx);

  return { designDecisions, nodes: normalized };
}

function normalizeNode(node, index, seen) {
  if (!node || typeof node !== 'object') {
    throw new Error(`Node #${index} is not an object`);
  }
  const id = String(node.id || '').trim();
  if (!ID_RE.test(id)) {
    throw new Error(`Node #${index} has invalid id "${node.id}" (use kebab-case: a-z, 0-9, hyphens)`);
  }
  if (seen.has(id)) throw new Error(`Duplicate node id "${id}"`);
  seen.add(id);

  const type = String(node.type || '').trim();
  if (type !== 'leaf' && type !== 'subtree') {
    throw new Error(`Node "${id}" has invalid type "${node.type}" (expected "leaf" or "subtree")`);
  }

  const title = String(node.title || '').trim();
  const spec = String(node.spec || '').trim();
  if (!spec) throw new Error(`Node "${id}" is missing a "spec"`);

  const fileScope = normalizeStringArray(node.fileScope);
  if (fileScope.length === 0) {
    throw new Error(`Node "${id}" must declare a non-empty "fileScope"`);
  }

  const dependsOn = normalizeStringArray(node.dependsOn);

  return { id, title: title || id, type, spec, fileScope, dependsOn };
}

function validateDeps(nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!ids.has(dep)) {
        throw new Error(`Node "${node.id}" depends on unknown sibling "${dep}"`);
      }
      if (dep === node.id) throw new Error(`Node "${node.id}" cannot depend on itself`);
    }
  }
  detectCycle(nodes);
}

function detectCycle(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map(); // id -> 0 visiting, 1 done
  const visit = (id, path) => {
    if (state.get(id) === 1) return;
    if (state.get(id) === 0) {
      throw new Error(`Dependency cycle detected: ${[...path, id].join(' -> ')}`);
    }
    state.set(id, 0);
    for (const dep of byId.get(id).dependsOn) visit(dep, [...path, id]);
    state.set(id, 1);
  };
  for (const node of nodes) visit(node.id, []);
}

function validateSiblingScopes(nodes, ctx) {
  // Hard-fail on exact duplicate scope paths across siblings (split-brain risk).
  const owner = new Map();
  for (const node of nodes) {
    for (const path of node.fileScope) {
      const key = normPath(path);
      if (owner.has(key)) {
        throw new Error(
          `File scope "${path}" is claimed by both "${owner.get(key)}" and "${node.id}". ` +
            'Sibling scopes must be disjoint to avoid split-brain edits.',
        );
      }
      owner.set(key, node.id);
    }
  }

  // Soft-warn on nested overlaps between siblings, and on breaking out of parent scope.
  const keys = [...owner.keys()];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      if (isPrefix(keys[i], keys[j]) || isPrefix(keys[j], keys[i])) {
        log.warn(
          `Sibling scopes overlap: "${keys[i]}" vs "${keys[j]}" (owners ` +
            `${owner.get(keys[i])} / ${owner.get(keys[j])}). Workers may collide.`,
        );
      }
    }
  }

  if (Array.isArray(ctx.parentScope) && ctx.parentScope.length) {
    const parents = ctx.parentScope.map(normPath);
    for (const node of nodes) {
      for (const path of node.fileScope) {
        const key = normPath(path);
        const contained = parents.some((p) => key === p || isPrefix(p, key));
        if (!contained) {
          log.warn(
            `Node "${node.id}" scope "${path}" is outside parent "${ctx.parentId}" scope ` +
              `[${ctx.parentScope.join(', ')}].`,
          );
        }
      }
    }
  }
}

function normalizeStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function normPath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isPrefix(a, b) {
  // True when directory-path `a` is an ancestor of `b`. Ignores glob segments.
  const clean = (s) => s.replace(/\/?\*+.*$/, '');
  const pa = clean(a);
  const pb = clean(b);
  if (!pa || !pb || pa === pb) return false;
  return pb.startsWith(pa.endsWith('/') ? pa : pa + '/');
}
