/**
 * Turn an expanded task tree into an executable schedule of leaves grouped into
 * dependency waves. Subtree dependencies are resolved down to their descendant
 * leaves, and every leaf inherits its ancestors' dependencies.
 *
 * @param {object[]} tree expanded tree from expand.js
 * @returns {{ leaves: object[], depsMap: Map<string, Set<string>>, waves: string[][] }}
 */
export function buildSchedule(tree) {
  if (!Array.isArray(tree)) {
    throw new Error('buildSchedule expects a tree array');
  }
  const idx = indexTree(tree);
  const depsMap = new Map();
  for (const leaf of idx.leaves) {
    depsMap.set(leaf.id, resolveLeafDeps(leaf, idx));
  }
  validateResolvedDeps(depsMap, idx);
  const waves = planWaves(idx.leaves, depsMap);
  return { leaves: idx.leaves, depsMap, waves };
}

function indexTree(tree) {
  const byId = new Map();
  const descendants = new Map();
  const parentChain = new Map();
  const leaves = [];

  const walk = (nodes, chain) => {
    for (const n of nodes) {
      byId.set(n.id, n);
      const nextChain = [...chain, n];
      if (n.type === 'subtree' && (!n.children || n.children.length === 0) && !n.coerced) {
        throw new Error(
          `Subtree node "${n.id}" has no children and cannot be scheduled as a leaf. ` +
            'Re-plan, or ensure the deepest planner level emits only leaves.',
        );
      }
      if (n.type === 'leaf' || !n.children || n.children.length === 0) {
        leaves.push(n);
        parentChain.set(n.id, nextChain);
      } else {
        walk(n.children, nextChain);
      }
    }
  };
  walk(tree, []);

  const computeDesc = (n) => {
    if (n.type === 'leaf' || !n.children || n.children.length === 0) {
      descendants.set(n.id, [n.id]);
      return [n.id];
    }
    let acc = [];
    for (const c of n.children) acc = acc.concat(computeDesc(c));
    descendants.set(n.id, acc);
    return acc;
  };
  for (const n of tree) computeDesc(n);

  return { byId, descendants, parentChain, leaves };
}

function resolveLeafDeps(leaf, idx) {
  const deps = new Set();
  const chain = idx.parentChain.get(leaf.id) || [leaf];
  for (const node of chain) {
    for (const depId of node.dependsOn || []) {
      if (!idx.descendants.has(depId) && !idx.byId.has(depId)) {
        throw new Error(
          `Node "${node.id}" depends on unknown id "${depId}" ` +
            `(referenced while scheduling leaf "${leaf.id}")`,
        );
      }
      const targets = idx.descendants.get(depId) || [depId];
      for (const t of targets) if (t !== leaf.id) deps.add(t);
    }
  }
  return deps;
}

function validateResolvedDeps(depsMap, idx) {
  const leafIds = new Set(idx.leaves.map((l) => l.id));
  for (const [leafId, deps] of depsMap) {
    for (const d of deps) {
      if (!leafIds.has(d)) {
        throw new Error(`Leaf "${leafId}" depends on unknown leaf id "${d}"`);
      }
    }
  }
}

function planWaves(leaves, depsMap) {
  const ids = leaves.map((l) => l.id);
  const remaining = new Set(ids);
  const done = new Set();
  const waves = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => {
      const deps = depsMap.get(id) || new Set();
      return [...deps].every((d) => done.has(d));
    });

    if (ready.length === 0) {
      const blocked = [...remaining].map((id) => {
        const deps = [...(depsMap.get(id) || [])].filter((d) => !done.has(d));
        return `${id} -> [${deps.join(', ')}]`;
      });
      throw new Error(
        `Unsatisfiable leaf dependencies (cycle or missing targets): ${blocked.join('; ')}`,
      );
    }

    for (const id of ready) remaining.delete(id);
    for (const id of ready) done.add(id);
    waves.push(ready);
  }

  return waves;
}
