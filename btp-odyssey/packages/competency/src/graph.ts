import type { Competency } from "@btp-odyssey/shared";

export interface CompetencyNode {
  competency: Competency;
  prerequisites: string[];
  dependents: string[];
}

export interface CompetencyGraph {
  nodes: Map<string, CompetencyNode>;
}

export function buildCompetencyGraph(competencies: Competency[]): CompetencyGraph {
  const nodes = new Map<string, CompetencyNode>();
  for (const c of competencies) {
    nodes.set(c.id, {
      competency: c,
      prerequisites: [...c.prerequisites],
      dependents: [],
    });
  }
  for (const c of competencies) {
    for (const pre of c.prerequisites) {
      const parent = nodes.get(pre);
      if (parent) parent.dependents.push(c.id);
    }
  }
  return { nodes };
}

export function topologicalOrder(graph: CompetencyGraph): string[] {
  const indeg = new Map<string, number>();
  for (const [id, node] of graph.nodes) {
    indeg.set(id, node.prerequisites.filter((p) => graph.nodes.has(p)).length);
  }
  const queue = [...indeg.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    const node = graph.nodes.get(id)!;
    for (const dep of node.dependents) {
      const next = (indeg.get(dep) ?? 1) - 1;
      indeg.set(dep, next);
      if (next === 0) {
        queue.push(dep);
        queue.sort();
      }
    }
  }
  if (order.length !== graph.nodes.size) {
    throw new Error("Competency graph contains a cycle");
  }
  return order;
}

export function unlockedCompetencies(
  graph: CompetencyGraph,
  demonstrated: Set<string>,
): string[] {
  const unlocked: string[] = [];
  for (const [id, node] of graph.nodes) {
    if (demonstrated.has(id)) continue;
    const ready = node.prerequisites.every(
      (p) => !graph.nodes.has(p) || demonstrated.has(p),
    );
    if (ready) unlocked.push(id);
  }
  return unlocked.sort();
}
