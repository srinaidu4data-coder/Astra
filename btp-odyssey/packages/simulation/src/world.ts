import type { SimulationResource } from "@btp-odyssey/shared";
import { createRng } from "./rng.js";
import type { LogEntry, MetricSample, TraceSpan } from "./observability.js";

export interface WorldState {
  seed: number;
  tick: number;
  resources: Map<string, SimulationResource>;
  logs: LogEntry[];
  metrics: MetricSample[];
  traces: TraceSpan[];
  changeHistory: ChangeEvent[];
  costAccumulatorUsd: number;
}

export interface ChangeEvent {
  atTick: number;
  resourceId: string;
  field: string;
  from: unknown;
  to: unknown;
  actor: string;
  reason: string;
}

export function createWorld(seed: number): WorldState {
  return {
    seed,
    tick: 0,
    resources: new Map(),
    logs: [],
    metrics: [],
    traces: [],
    changeHistory: [],
    costAccumulatorUsd: 0,
  };
}

export function upsertResource(
  world: WorldState,
  resource: SimulationResource,
  actor = "system",
  reason = "upsert",
): WorldState {
  const prev = world.resources.get(resource.id);
  const resources = new Map(world.resources);
  resources.set(resource.id, resource);
  const changeHistory = [...world.changeHistory];
  if (prev) {
    changeHistory.push({
      atTick: world.tick,
      resourceId: resource.id,
      field: "*",
      from: prev,
      to: resource,
      actor,
      reason,
    });
  } else {
    changeHistory.push({
      atTick: world.tick,
      resourceId: resource.id,
      field: "created",
      from: null,
      to: resource,
      actor,
      reason,
    });
  }
  return { ...world, resources, changeHistory };
}

export function getResource(
  world: WorldState,
  id: string,
): SimulationResource | undefined {
  return world.resources.get(id);
}

export function listResources(
  world: WorldState,
  kind?: SimulationResource["kind"],
): SimulationResource[] {
  const all = [...world.resources.values()];
  return kind ? all.filter((r) => r.kind === kind) : all;
}

export function setHealth(
  world: WorldState,
  resourceId: string,
  health: SimulationResource["health"],
  actor: string,
  reason: string,
): WorldState {
  const res = world.resources.get(resourceId);
  if (!res) {
    throw new Error(`Unknown resource: ${resourceId}`);
  }
  return upsertResource(
    world,
    { ...res, health },
    actor,
    reason,
  );
}

export function advanceTick(world: WorldState, n = 1): WorldState {
  let tick = world.tick;
  let cost = world.costAccumulatorUsd;
  for (let i = 0; i < n; i++) {
    tick += 1;
    for (const r of world.resources.values()) {
      cost += r.costMonthlyUsd / (30 * 24 * 60); // per-minute approx
    }
  }
  return { ...world, tick, costAccumulatorUsd: cost };
}

export function snapshotWorld(world: WorldState): {
  seed: number;
  tick: number;
  resourceCount: number;
  resources: SimulationResource[];
  logCount: number;
  metricCount: number;
  traceCount: number;
  costAccumulatorUsd: number;
} {
  return {
    seed: world.seed,
    tick: world.tick,
    resourceCount: world.resources.size,
    resources: [...world.resources.values()],
    logCount: world.logs.length,
    metricCount: world.metrics.length,
    traceCount: world.traces.length,
    costAccumulatorUsd: world.costAccumulatorUsd,
  };
}

export function worldFromSeedAndLandscape(
  seed: number,
  resources: SimulationResource[],
): WorldState {
  let world = createWorld(seed);
  const rng = createRng(seed);
  // Touch rng so future expansions can use it deterministically
  void rng();
  for (const r of resources) {
    world = upsertResource(world, r, "seed", "landscape_bootstrap");
  }
  return world;
}
