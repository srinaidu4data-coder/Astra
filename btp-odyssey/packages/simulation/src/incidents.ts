import type { WorldState } from "./world.js";
import {
  appendLog,
  appendMetric,
  appendTrace,
} from "./observability.js";
import { setHealth, upsertResource } from "./world.js";

export interface IncidentDefinition {
  id: string;
  title: string;
  businessImpact: string;
  technicalImpact: string;
  rootCause: string;
  contributingFactors: string[];
  preventionControls: string[];
  diagnoseKeywords: string[];
  fixAction: string;
  apply: (world: WorldState) => WorldState;
  fix: (world: WorldState) => WorldState;
}

function evidence(
  world: WorldState,
  items: {
    resourceId: string;
    level: "info" | "warn" | "error";
    message: string;
    fields?: Record<string, unknown>;
  }[],
): WorldState {
  let w = world;
  for (const it of items) {
    w = appendLog(w, it);
  }
  return w;
}

export const INCIDENTS: Record<string, IncidentDefinition> = {
  "inc-audience-mismatch": {
    id: "inc-audience-mismatch",
    title: "Order Insights UI 401 cascade",
    businessImpact: "EU sales analysts blocked from order KPIs.",
    technicalImpact: "UI OData 401; CAP rejects JWT audience.",
    rootCause:
      "Destination orders-api audience is wrong-audience-legacy instead of order-service!t1.",
    contributingFactors: [
      "Client id rename without destination update",
      "No CI contract test for audience",
    ],
    preventionControls: [
      "Validate destination audience in CI",
      "Alert on auth_failure_count",
    ],
    diagnoseKeywords: ["audience", "destination", "jwt", "token", "aud", "xsuaa"],
    fixAction: "fix_audience",
    apply(world) {
      let w = evidence(world, [
        {
          resourceId: "app-ui5-orders",
          level: "error",
          message: "OData request failed with HTTP 401 Unauthorized",
          fields: { path: "/odata/v4/orders/Orders" },
        },
        {
          resourceId: "dest-orders-api",
          level: "warn",
          message: "Token exchange succeeded but resource rejected token",
          fields: {
            expectedAudience: "order-service!t1",
            configuredAudience: "wrong-audience-legacy",
          },
        },
        {
          resourceId: "app-cap-orders",
          level: "error",
          message: "JWT audience validation failed",
          fields: { claim_aud: "wrong-audience-legacy" },
        },
        {
          resourceId: "svc-hana",
          level: "info",
          message: "HDI container healthy; last deploy 2h ago",
        },
      ]);
      w = appendMetric(w, {
        resourceId: "app-cap-orders",
        name: "auth_failure_count",
        value: 47,
        unit: "count",
      });
      w = appendTrace(w, {
        traceId: "tr-aud-1",
        spanId: "sp1",
        resourceId: "app-ui5-orders",
        name: "GET Orders",
        durationMs: 210,
        status: "error",
        attributes: { httpStatus: 401 },
      });
      w = setHealth(w, "app-ui5-orders", "degraded", "incident", "401");
      w = setHealth(w, "app-cap-orders", "degraded", "incident", "auth");
      w = setHealth(w, "dest-orders-api", "degraded", "incident", "audience");
      return w;
    },
    fix(world) {
      const dest = world.resources.get("dest-orders-api");
      if (!dest) return world;
      let w = upsertResource(
        world,
        {
          ...dest,
          health: "healthy",
          securityPosture: "adequate",
          configuration: { ...dest.configuration, audience: "order-service!t1" },
          tags: dest.tags.filter((t) => t !== "defect:audience"),
        },
        "learner",
        "fix_audience",
      );
      w = setHealth(w, "app-ui5-orders", "healthy", "learner", "restored");
      w = setHealth(w, "app-cap-orders", "healthy", "learner", "restored");
      return w;
    },
  },

  "inc-scope-missing": {
    id: "inc-scope-missing",
    title: "Discount approve returns 403",
    businessImpact: "Approvers cannot approve discounts; promotions stalled.",
    technicalImpact: "Authenticated users lack Discount.Approve scope.",
    rootCause: "Approver role collection missing Discount.Approve scope.",
    contributingFactors: ["Redesign of role model without regression test"],
    preventionControls: ["Role-scope matrix tests", "Least privilege reviews"],
    diagnoseKeywords: ["scope", "403", "role", "authorization", "approve", "privilege"],
    fixAction: "fix_scope",
    apply(world) {
      let w = evidence(world, [
        {
          resourceId: "app-cap-discount",
          level: "error",
          message: "HTTP 403 Forbidden on action approveDiscount",
          fields: { requiredScope: "Discount.Approve", granted: ["Discount.Read"] },
        },
        {
          resourceId: "svc-xsuaa",
          level: "warn",
          message: "Role collection Approver missing Discount.Approve",
        },
        {
          resourceId: "app-ui5-discount",
          level: "info",
          message: "UI binding paths resolve; action button visible",
        },
      ]);
      w = appendMetric(w, {
        resourceId: "app-cap-discount",
        name: "http_403_rate",
        value: 0.91,
        unit: "ratio",
      });
      return w;
    },
    fix(world) {
      const xs = world.resources.get("svc-xsuaa");
      if (!xs) return world;
      let w = upsertResource(
        world,
        {
          ...xs,
          health: "healthy",
          securityPosture: "adequate",
          configuration: {
            ...xs.configuration,
            roleCollections: {
              BusinessUser: ["Discount.Read"],
              Approver: ["Discount.Read", "Discount.Approve"],
            },
          },
          tags: xs.tags.filter((t) => t !== "defect:scope"),
        },
        "learner",
        "fix_scope",
      );
      w = setHealth(w, "app-cap-discount", "healthy", "learner", "scope_fixed");
      w = setHealth(w, "app-ui5-discount", "healthy", "learner", "scope_fixed");
      return w;
    },
  },

  "inc-duplicate-events": {
    id: "inc-duplicate-events",
    title: "Duplicate orders and TLS warnings",
    businessImpact: "Customers charged/duplicated orders; partner trust risk.",
    technicalImpact: "Retries without idempotency; expired partner certificate.",
    rootCause: "Missing idempotency key plus expired partner cert on destination.",
    contributingFactors: ["Immediate retry storm", "No cert expiry alert"],
    preventionControls: ["Idempotency required", "Cert expiry monitors", "DLQ"],
    diagnoseKeywords: [
      "idempoten",
      "duplicate",
      "retry",
      "certificate",
      "cert",
      "tls",
      "dlq",
    ],
    fixAction: "fix_integration",
    apply(world) {
      let w = evidence(world, [
        {
          resourceId: "iflow-partner-a",
          level: "error",
          message: "Duplicate message processing detected for orderId",
          fields: { idempotencyKey: null },
        },
        {
          resourceId: "dest-partner",
          level: "warn",
          message: "TLS certificate expired on 2025-01-01",
        },
        {
          resourceId: "topic-orders",
          level: "warn",
          message: "Consumer crash loop; DLQ not configured",
        },
      ]);
      w = appendMetric(w, {
        resourceId: "topic-orders",
        name: "duplicate_rate",
        value: 0.18,
        unit: "ratio",
      });
      return w;
    },
    fix(world) {
      let w = world;
      const iflow = w.resources.get("iflow-partner-a");
      if (iflow) {
        w = upsertResource(
          w,
          {
            ...iflow,
            health: "healthy",
            securityPosture: "adequate",
            configuration: {
              ...iflow.configuration,
              idempotencyKey: "orderId",
              retry: { max: 5, backoff: "exponential" },
              certExpiry: "2027-01-01",
            },
            tags: iflow.tags.filter((t) => !t.startsWith("defect:")),
          },
          "learner",
          "fix_integration",
        );
      }
      const dest = w.resources.get("dest-partner");
      if (dest) {
        w = upsertResource(
          w,
          {
            ...dest,
            health: "healthy",
            securityPosture: "adequate",
            configuration: {
              ...dest.configuration,
              certificateExpires: "2027-01-01",
              tls: "ok",
            },
          },
          "learner",
          "rotate_cert",
        );
      }
      const topic = w.resources.get("topic-orders");
      if (topic) {
        w = upsertResource(
          w,
          {
            ...topic,
            health: "healthy",
            configuration: { ...topic.configuration, dlq: true },
          },
          "learner",
          "enable_dlq",
        );
      }
      return w;
    },
  },

  "inc-metric-conflict": {
    id: "inc-metric-conflict",
    title: "Contradictory Net Revenue KPIs",
    businessImpact: "Leadership distrusts dashboards; planning blocked.",
    technicalImpact: "Two semantic definitions; stale replica.",
    rootCause: "Semantic mismatch on Net Revenue plus stale replication flag.",
    contributingFactors: ["No data product owner", "Refresh job skipped"],
    preventionControls: ["Single metric owner", "Lineage checks", "Freshness SLOs"],
    diagnoseKeywords: [
      "semantic",
      "definition",
      "lineage",
      "stale",
      "replica",
      "metric",
      "revenue",
      "formula",
    ],
    fixAction: "fix_metrics",
    apply(world) {
      return evidence(world, [
        {
          resourceId: "semantic-net-revenue-finance",
          level: "warn",
          message: "Definition includes tax deduction",
        },
        {
          resourceId: "semantic-net-revenue-sales",
          level: "warn",
          message: "Definition excludes tax deduction",
        },
        {
          resourceId: "pipe-replica",
          level: "error",
          message: "Replica stale: last success 36h ago",
          fields: { stale: true },
        },
        {
          resourceId: "dash-sac",
          level: "error",
          message: "Exec KPI Story mixes unofficial sources",
        },
      ]);
    },
    fix(world) {
      let w = world;
      const pipe = w.resources.get("pipe-replica");
      if (pipe) {
        w = upsertResource(
          w,
          {
            ...pipe,
            health: "healthy",
            configuration: {
              ...pipe.configuration,
              stale: false,
              lastSuccessHoursAgo: 0,
            },
          },
          "learner",
          "refresh_replica",
        );
      }
      const sales = w.resources.get("semantic-net-revenue-sales");
      if (sales) {
        w = upsertResource(
          w,
          {
            ...sales,
            health: "healthy",
            configuration: {
              formula: "gross - returns - tax",
              product: "dp-net-revenue-official",
              owner: "finance",
            },
            securityPosture: "adequate",
          },
          "learner",
          "align_semantic",
        );
      }
      const dash = w.resources.get("dash-sac");
      if (dash) {
        w = upsertResource(
          w,
          {
            ...dash,
            health: "healthy",
            configuration: { source: "dp-net-revenue-official" },
          },
          "learner",
          "bind_official_product",
        );
      }
      return w;
    },
  },

  "inc-tenant-leak-attempt": {
    id: "inc-tenant-leak-attempt",
    title: "Cross-tenant access attempt",
    businessImpact: "Customer trust and compliance risk.",
    technicalImpact: "Admin API missing tenant guard; overbroad support role.",
    rootCause: "tenantGuard=false on admin API; Support has Admin.All.",
    contributingFactors: ["Support convenience privileges", "Missing isolation tests"],
    preventionControls: ["Tenant guard middleware", "Least privilege", "Isolation tests"],
    diagnoseKeywords: [
      "tenant",
      "isolation",
      "cross-tenant",
      "privilege",
      "admin",
      "guard",
      "multitenant",
    ],
    fixAction: "fix_tenant",
    apply(world) {
      return evidence(world, [
        {
          resourceId: "app-cap-saas",
          level: "error",
          message: "Audit: cross-tenant export attempt on /admin/export",
          fields: { tenantGuard: false },
        },
        {
          resourceId: "svc-xsuaa",
          level: "warn",
          message: "Support role includes Admin.All and Tenant.Impersonate",
        },
      ]);
    },
    fix(world) {
      let w = world;
      const app = w.resources.get("app-cap-saas");
      if (app) {
        w = upsertResource(
          w,
          {
            ...app,
            health: "healthy",
            securityPosture: "strong",
            configuration: { ...app.configuration, tenantGuard: true },
            tags: app.tags.filter((t) => t !== "defect:tenant"),
          },
          "learner",
          "enable_tenant_guard",
        );
      }
      const xs = w.resources.get("svc-xsuaa");
      if (xs) {
        w = upsertResource(
          w,
          {
            ...xs,
            health: "healthy",
            securityPosture: "adequate",
            configuration: {
              roleCollections: { Support: ["Ticket.Read", "Ticket.Write"] },
            },
          },
          "learner",
          "least_privilege",
        );
      }
      return w;
    },
  },

  "inc-hidden-coupling": {
    id: "inc-hidden-coupling",
    title: "Nightly batch intermittent failure",
    businessImpact: "Reconciliation late; finance close risk.",
    technicalImpact: "Hidden file-drop race between job and iflow.",
    rootCause: "Undocumented shared folder contract with race condition; no owner.",
    contributingFactors: ["Unknown ownership", "No monitoring on folder lag"],
    preventionControls: ["Document contracts", "Assign owners", "Replace file drop with events"],
    diagnoseKeywords: [
      "coupling",
      "folder",
      "race",
      "owner",
      "nightly",
      "batch",
      "hidden",
      "undocumented",
    ],
    fixAction: "fix_coupling",
    apply(world) {
      return evidence(world, [
        {
          resourceId: "job-nightly",
          level: "error",
          message: "Intermittent failure: file not ready",
          fields: { folder: "\\\\files\\drop\\orders", owner: "unknown" },
        },
        {
          resourceId: "iflow-legacy",
          level: "warn",
          message: "Pickup race with nightly job on same folder",
        },
      ]);
    },
    fix(world) {
      let w = world;
      const job = w.resources.get("job-nightly");
      if (job) {
        w = upsertResource(
          w,
          {
            ...job,
            health: "healthy",
            owner: "finance-ops",
            securityPosture: "adequate",
            configuration: {
              ...job.configuration,
              handshake: "ready.flag",
              monitored: true,
            },
          },
          "learner",
          "assign_owner_handshake",
        );
      }
      const iflow = w.resources.get("iflow-legacy");
      if (iflow) {
        w = upsertResource(
          w,
          {
            ...iflow,
            health: "healthy",
            owner: "integration",
            configuration: { ...iflow.configuration, race: false, waitForReadyFlag: true },
          },
          "learner",
          "fix_race",
        );
      }
      return w;
    },
  },

  "inc-residency-violation": {
    id: "inc-residency-violation",
    title: "PII replica in non-approved region",
    businessImpact: "Regulatory audit finding; expansion blocked.",
    technicalImpact: "US replica of EU PII enabled without approval.",
    rootCause: "Analytics replica job enabled with pii=true outside approved residency.",
    contributingFactors: ["No residency gate in pipeline CI"],
    preventionControls: ["Residency policy as code", "Data flow reviews"],
    diagnoseKeywords: [
      "residency",
      "pii",
      "region",
      "replica",
      "privacy",
      "gdpr",
      "jurisdiction",
    ],
    fixAction: "fix_residency",
    apply(world) {
      return evidence(world, [
        {
          resourceId: "db-us-replica",
          level: "error",
          message: "Audit: PII replica enabled in us10 without approval",
          fields: { pii: true, approved: false },
        },
        {
          resourceId: "db-eu",
          level: "info",
          message: "Primary PII store residency EU ok",
        },
      ]);
    },
    fix(world) {
      const rep = world.resources.get("db-us-replica");
      if (!rep) return world;
      return upsertResource(
        world,
        {
          ...rep,
          health: "healthy",
          securityPosture: "adequate",
          configuration: {
            ...rep.configuration,
            enabled: false,
            pii: false,
            approved: false,
            note: "Disabled pending residency approval",
          },
          tags: rep.tags.filter((t) => t !== "defect:residency"),
        },
        "learner",
        "disable_noncompliant_replica",
      );
    },
  },

  "inc-compound-outage": {
    id: "inc-compound-outage",
    title: "Compound outage: auth + backlog + alert noise",
    businessImpact: "Customer escalation; board pressure.",
    technicalImpact: "Audience mismatch, integration backlog, false-positive paging.",
    rootCause: "Uncoordinated change window across identity and integration.",
    contributingFactors: ["No change freeze", "Missing SLOs"],
    preventionControls: ["Change calendar", "Idempotent reprocess", "SLO-based alerting"],
    diagnoseKeywords: [
      "audience",
      "backlog",
      "alert",
      "compound",
      "identity",
      "integration",
      "slo",
    ],
    fixAction: "fix_compound",
    apply(world) {
      let w = INCIDENTS["inc-audience-mismatch"]!.apply(world);
      w = evidence(w, [
        {
          resourceId: "iflow-partner-a",
          level: "error",
          message: "Queue depth elevated; processing backlog",
          fields: { depth: 12000 },
        },
        {
          resourceId: "alert-noise",
          level: "warn",
          message: "Pager storm: falsePositiveRate 0.7; no SLO configured",
        },
      ]);
      return w;
    },
    fix(world) {
      let w = INCIDENTS["inc-audience-mismatch"]!.fix(world);
      const iflow = w.resources.get("iflow-partner-a");
      if (iflow) {
        w = upsertResource(
          w,
          {
            ...iflow,
            health: "healthy",
            configuration: {
              ...iflow.configuration,
              idempotencyKey: "orderId",
              backlogDrained: true,
            },
          },
          "learner",
          "drain_backlog",
        );
      }
      const alerts = w.resources.get("alert-noise");
      if (alerts) {
        w = upsertResource(
          w,
          {
            ...alerts,
            health: "healthy",
            configuration: { falsePositiveRate: 0.05, slo: "auth_success >= 99%" },
          },
          "learner",
          "fix_slo_alerts",
        );
      }
      return w;
    },
  },
};

/** Default R1 export for backward compatibility */
export const R1_AUDIENCE_INCIDENT = INCIDENTS["inc-audience-mismatch"]!;

export function getIncident(id: string): IncidentDefinition {
  const inc = INCIDENTS[id];
  if (!inc) throw new Error(`Unknown incident: ${id}`);
  return inc;
}

export function applyIncident(
  world: WorldState,
  incident: IncidentDefinition,
): WorldState {
  return incident.apply(world);
}

export function fixIncident(world: WorldState, incidentId: string): WorldState {
  return getIncident(incidentId).fix(world);
}

export function diagnoseIncident(
  world: WorldState,
  incidentId: string,
  hypothesis: string,
): { correct: boolean; feedback: string; evidenceIds: string[]; rootCause: string } {
  const incident = getIncident(incidentId);
  const normalized = hypothesis.toLowerCase();
  const hits = incident.diagnoseKeywords.filter((k) => normalized.includes(k.toLowerCase()));
  const correct = hits.length >= 2 || (hits.length >= 1 && normalized.length > 40);
  const evidenceIds = world.logs.filter((l) => l.level === "error" || l.level === "warn").map((l) => l.id);

  if (correct) {
    return {
      correct: true,
      feedback: `Strong diagnosis aligned with evidence. Root cause: ${incident.rootCause} Apply the remediation without disabling security controls.`,
      evidenceIds,
      rootCause: incident.rootCause,
    };
  }
  return {
    correct: false,
    feedback: `Not yet aligned. Re-check logs/metrics/traces. Prevention themes: ${incident.preventionControls.join("; ")}. Avoid fixing distractors first.`,
    evidenceIds,
    rootCause: incident.rootCause,
  };
}

/** @deprecated */
export function diagnoseAudience(world: WorldState, hypothesis: string) {
  return diagnoseIncident(world, "inc-audience-mismatch", hypothesis);
}

/** @deprecated */
export function fixAudienceMismatch(world: WorldState) {
  return fixIncident(world, "inc-audience-mismatch");
}

export const MISSION_RUNTIME: Record<
  string,
  { landscapeId: string; incidentId: string }
> = {
  "r1-northwind-order-insights": {
    landscapeId: "startup-northwind",
    incidentId: "inc-audience-mismatch",
  },
  "r2-cap-rap-extension-lab": {
    landscapeId: "clean-core-enterprise",
    incidentId: "inc-scope-missing",
  },
  "r3-integration-crisis": {
    landscapeId: "integration-sprawl",
    incidentId: "inc-duplicate-events",
  },
  "r4-data-galaxy": {
    landscapeId: "data-galaxy",
    incidentId: "inc-metric-conflict",
  },
  "r5-security-siege": {
    landscapeId: "saas-multitenant",
    incidentId: "inc-tenant-leak-attempt",
  },
  "r6-inherited-landscape": {
    landscapeId: "inherited-messy",
    incidentId: "inc-hidden-coupling",
  },
  "r6-regulated-expansion": {
    landscapeId: "regulated-global",
    incidentId: "inc-residency-violation",
  },
  "r-grand-enterprise": {
    landscapeId: "grand-enterprise",
    incidentId: "inc-compound-outage",
  },
};
