import type { WorldState } from "./world.js";

export interface LogEntry {
  id: string;
  tick: number;
  resourceId: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields?: Record<string, unknown>;
}

export interface MetricSample {
  id: string;
  tick: number;
  resourceId: string;
  name: string;
  value: number;
  unit: string;
}

export interface TraceSpan {
  id: string;
  tick: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  resourceId: string;
  name: string;
  durationMs: number;
  status: "ok" | "error";
  attributes?: Record<string, unknown>;
}

export function appendLog(
  world: WorldState,
  entry: Omit<LogEntry, "id" | "tick"> & { id?: string },
): WorldState {
  const log: LogEntry = {
    id: entry.id ?? `log-${world.logs.length + 1}`,
    tick: world.tick,
    resourceId: entry.resourceId,
    level: entry.level,
    message: entry.message,
    fields: entry.fields,
  };
  return { ...world, logs: [...world.logs, log] };
}

export function appendMetric(
  world: WorldState,
  sample: Omit<MetricSample, "id" | "tick"> & { id?: string },
): WorldState {
  const metric: MetricSample = {
    id: sample.id ?? `m-${world.metrics.length + 1}`,
    tick: world.tick,
    resourceId: sample.resourceId,
    name: sample.name,
    value: sample.value,
    unit: sample.unit,
  };
  return { ...world, metrics: [...world.metrics, metric] };
}

export function appendTrace(
  world: WorldState,
  span: Omit<TraceSpan, "id" | "tick"> & { id?: string },
): WorldState {
  const trace: TraceSpan = {
    id: span.id ?? `t-${world.traces.length + 1}`,
    tick: world.tick,
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    resourceId: span.resourceId,
    name: span.name,
    durationMs: span.durationMs,
    status: span.status,
    attributes: span.attributes,
  };
  return { ...world, traces: [...world.traces, trace] };
}

/**
 * Seed realistic-looking observability evidence for the R1 audience defect.
 */
export function injectAudienceMismatchEvidence(world: WorldState): WorldState {
  let w = world;
  w = appendLog(w, {
    resourceId: "app-ui5-orders",
    level: "error",
    message: "OData request failed with HTTP 401 Unauthorized",
    fields: { path: "/odata/v4/orders/Orders", destination: "orders-api" },
  });
  w = appendLog(w, {
    resourceId: "dest-orders-api",
    level: "warn",
    message: "Token exchange succeeded but resource rejected token",
    fields: {
      expectedAudience: "order-service!t1",
      configuredAudience: "wrong-audience-legacy",
    },
  });
  w = appendLog(w, {
    resourceId: "app-cap-orders",
    level: "error",
    message: "JWT audience validation failed",
    fields: { claim_aud: "wrong-audience-legacy", accepted: ["order-service!t1"] },
  });
  w = appendMetric(w, {
    resourceId: "app-ui5-orders",
    name: "http_4xx_rate",
    value: 0.82,
    unit: "ratio",
  });
  w = appendMetric(w, {
    resourceId: "app-cap-orders",
    name: "auth_failure_count",
    value: 47,
    unit: "count",
  });
  w = appendTrace(w, {
    traceId: "tr-audience-001",
    spanId: "sp-ui",
    resourceId: "app-ui5-orders",
    name: "GET Orders",
    durationMs: 210,
    status: "error",
    attributes: { httpStatus: 401 },
  });
  w = appendTrace(w, {
    traceId: "tr-audience-001",
    spanId: "sp-dest",
    parentSpanId: "sp-ui",
    resourceId: "dest-orders-api",
    name: "destination.call",
    durationMs: 180,
    status: "error",
    attributes: { auth: "OAuth2UserTokenExchange" },
  });
  w = appendTrace(w, {
    traceId: "tr-audience-001",
    spanId: "sp-cap",
    parentSpanId: "sp-dest",
    resourceId: "app-cap-orders",
    name: "xsuaa.validate",
    durationMs: 12,
    status: "error",
    attributes: { reason: "audience_mismatch" },
  });
  // Distractor evidence (not root cause)
  w = appendLog(w, {
    resourceId: "svc-hana",
    level: "info",
    message: "HDI container healthy; last deploy 2h ago",
  });
  w = appendLog(w, {
    resourceId: "iflow-order-sync",
    level: "info",
    message: "Last message processed successfully 3 minutes ago",
  });
  return w;
}
