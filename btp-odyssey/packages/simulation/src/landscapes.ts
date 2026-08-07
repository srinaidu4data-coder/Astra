import type { SimulationResource } from "@btp-odyssey/shared";

type R = SimulationResource;

function baseAccount(prefix: string, name: string): R[] {
  return [
    {
      id: `${prefix}-ga`,
      kind: "global_account",
      name: `${name} Global`,
      owner: "platform-ops",
      configuration: {},
      health: "healthy",
      dependencies: [],
      costMonthlyUsd: 0,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["account"],
    },
    {
      id: `${prefix}-sa`,
      kind: "subaccount",
      name: `${prefix}-eu10`,
      region: "eu10",
      owner: "platform-ops",
      configuration: { environment: "Cloud Foundry" },
      health: "healthy",
      dependencies: [`${prefix}-ga`],
      costMonthlyUsd: 0,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["subaccount"],
    },
  ];
}

export function buildLandscape(landscapeId: string): SimulationResource[] {
  switch (landscapeId) {
    case "clean-core-enterprise":
      return buildCleanCore();
    case "integration-sprawl":
      return buildIntegrationSprawl();
    case "data-galaxy":
      return buildDataGalaxy();
    case "saas-multitenant":
      return buildSaas();
    case "inherited-messy":
      return buildInherited();
    case "regulated-global":
      return buildRegulated();
    case "grand-enterprise":
      return buildGrand();
    case "startup-northwind":
    default:
      return buildNorthwind();
  }
}

export function buildNorthwind(): R[] {
  return [
    ...baseAccount("nw", "Northwind"),
    {
      id: "svc-xsuaa",
      kind: "service_instance",
      name: "northwind-xsuaa",
      region: "eu10",
      owner: "security",
      configuration: {
        plan: "application",
        scopes: ["Order.Read", "Order.Write", "Analytics.View"],
        roleCollections: ["OrderViewer", "OrderManager", "Analyst"],
      },
      health: "healthy",
      dependencies: ["nw-sa"],
      costMonthlyUsd: 0,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["identity", "xsuaa"],
    },
    {
      id: "svc-hana",
      kind: "database",
      name: "northwind-hana-sim",
      region: "eu10",
      owner: "data-team",
      configuration: { engine: "hana_cloud_simulated", schema: "ORDERS", hdi: true },
      health: "healthy",
      dependencies: ["nw-sa"],
      costMonthlyUsd: 420,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["hana"],
    },
    {
      id: "app-cap-orders",
      kind: "application",
      name: "order-service",
      region: "eu10",
      owner: "cap-team",
      configuration: {
        runtime: "nodejs_cap_simulated",
        odata: "v4",
        boundServices: ["svc-xsuaa", "svc-hana"],
      },
      health: "degraded",
      dependencies: ["nw-sa", "svc-xsuaa", "svc-hana"],
      costMonthlyUsd: 80,
      securityPosture: "weak",
      fidelityStatus: "tier2_behavioral",
      tags: ["cap"],
    },
    {
      id: "app-ui5-orders",
      kind: "application",
      name: "order-insights-ui",
      region: "eu10",
      owner: "ui5-team",
      configuration: { framework: "sapui5_simulated", destination: "dest-orders-api" },
      health: "degraded",
      dependencies: ["app-cap-orders", "dest-orders-api"],
      costMonthlyUsd: 20,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["ui5"],
    },
    {
      id: "dest-orders-api",
      kind: "destination",
      name: "orders-api",
      region: "eu10",
      owner: "integration",
      configuration: {
        type: "HTTP",
        authentication: "OAuth2UserTokenExchange",
        url: "https://order-service.sim.local",
        audience: "wrong-audience-legacy",
      },
      health: "degraded",
      dependencies: ["svc-xsuaa", "app-cap-orders"],
      costMonthlyUsd: 0,
      securityPosture: "weak",
      fidelityStatus: "tier2_behavioral",
      tags: ["destination", "defect:audience"],
    },
    {
      id: "iflow-order-sync",
      kind: "integration_flow",
      name: "ERP_Order_Sync",
      region: "eu10",
      owner: "integration",
      configuration: {
        adapter: "HTTPS",
        retry: { max: 3, backoff: "exponential" },
        idempotencyKey: "orderId",
      },
      health: "healthy",
      dependencies: ["app-cap-orders"],
      costMonthlyUsd: 50,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["cpi"],
    },
    {
      id: "topic-order-events",
      kind: "event_topic",
      name: "sales/orders/v1",
      region: "eu10",
      owner: "event-arch",
      configuration: { broker: "event_mesh_simulated", schema: "OrderCreated" },
      health: "healthy",
      dependencies: ["app-cap-orders"],
      costMonthlyUsd: 30,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["events"],
    },
  ];
}

function buildCleanCore(): R[] {
  return [
    ...baseAccount("cc", "Contoso Clean Core"),
    {
      id: "svc-xsuaa",
      kind: "service_instance",
      name: "contoso-xsuaa",
      owner: "security",
      configuration: {
        scopes: ["Discount.Read", "Discount.Approve"],
        roleCollections: {
          BusinessUser: ["Discount.Read"],
          // defect: missing Discount.Approve
          Approver: ["Discount.Read"],
        },
      },
      health: "degraded",
      dependencies: ["cc-sa"],
      costMonthlyUsd: 0,
      securityPosture: "weak",
      fidelityStatus: "tier2_behavioral",
      tags: ["identity", "defect:scope"],
    },
    {
      id: "app-rap-discount",
      kind: "application",
      name: "discount-rap-onstack",
      owner: "abap-team",
      configuration: { pattern: "rap_managed_simulated", draft: true },
      health: "healthy",
      dependencies: ["cc-sa"],
      costMonthlyUsd: 0,
      securityPosture: "adequate",
      fidelityStatus: "tier1_conceptual",
      tags: ["rap"],
    },
    {
      id: "app-cap-discount",
      kind: "application",
      name: "discount-cap-sidebyside",
      owner: "cap-team",
      configuration: { pattern: "cap_side_by_side", action: "approveDiscount" },
      health: "degraded",
      dependencies: ["cc-sa", "svc-xsuaa"],
      costMonthlyUsd: 90,
      securityPosture: "weak",
      fidelityStatus: "tier2_behavioral",
      tags: ["cap"],
    },
    {
      id: "app-ui5-discount",
      kind: "application",
      name: "discount-approval-ui",
      owner: "ui5-team",
      configuration: { destination: "dest-discount" },
      health: "degraded",
      dependencies: ["app-cap-discount", "dest-discount"],
      costMonthlyUsd: 15,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["ui5"],
    },
    {
      id: "dest-discount",
      kind: "destination",
      name: "discount-api",
      owner: "integration",
      configuration: { authentication: "OAuth2UserTokenExchange", audience: "discount-cap!t1" },
      health: "healthy",
      dependencies: ["svc-xsuaa", "app-cap-discount"],
      costMonthlyUsd: 0,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["destination"],
    },
  ];
}

function buildIntegrationSprawl(): R[] {
  return [
    ...baseAccount("ig", "Global Intake"),
    {
      id: "iflow-partner-a",
      kind: "integration_flow",
      name: "PartnerA_Orders",
      owner: "unknown",
      configuration: {
        idempotencyKey: null,
        retry: { max: 10, backoff: "immediate" },
        certExpiry: "2025-01-01",
      },
      health: "degraded",
      dependencies: ["ig-sa"],
      costMonthlyUsd: 70,
      securityPosture: "critical",
      fidelityStatus: "tier2_behavioral",
      tags: ["cpi", "defect:dup", "defect:cert"],
    },
    {
      id: "iflow-partner-b",
      kind: "integration_flow",
      name: "PartnerB_Orders_Legacy",
      owner: "integration",
      configuration: { mapping: "undocumented_v0", duplicateOf: "iflow-partner-a" },
      health: "degraded",
      dependencies: ["ig-sa"],
      costMonthlyUsd: 55,
      securityPosture: "weak",
      fidelityStatus: "tier2_behavioral",
      tags: ["cpi", "duplicate-api"],
    },
    {
      id: "topic-orders",
      kind: "event_topic",
      name: "commerce/orders",
      owner: "event-arch",
      configuration: { dlq: false, consumers: ["order-projector"] },
      health: "degraded",
      dependencies: ["iflow-partner-a"],
      costMonthlyUsd: 40,
      securityPosture: "weak",
      fidelityStatus: "tier2_behavioral",
      tags: ["events", "defect:dup"],
    },
    {
      id: "dest-partner",
      kind: "destination",
      name: "partner-a-api",
      owner: "integration",
      configuration: { certificateExpires: "2025-01-01", tls: "degraded" },
      health: "degraded",
      dependencies: ["ig-sa"],
      costMonthlyUsd: 0,
      securityPosture: "critical",
      fidelityStatus: "tier2_behavioral",
      tags: ["destination", "defect:cert"],
    },
    {
      id: "app-order-api",
      kind: "application",
      name: "order-intake-api",
      owner: "cap-team",
      configuration: {},
      health: "degraded",
      dependencies: ["topic-orders"],
      costMonthlyUsd: 100,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["cap"],
    },
  ];
}

function buildDataGalaxy(): R[] {
  return [
    ...baseAccount("dg", "Data Galaxy"),
    {
      id: "svc-hana",
      kind: "database",
      name: "commercial-hana",
      region: "eu10",
      owner: "data-platform",
      configuration: { hdi: true },
      health: "healthy",
      dependencies: ["dg-sa"],
      costMonthlyUsd: 800,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["hana"],
    },
    {
      id: "pipe-replica",
      kind: "pipeline",
      name: "sales-replica",
      owner: "data-eng",
      configuration: { stale: true, lastSuccessHoursAgo: 36, schedule: "hourly" },
      health: "degraded",
      dependencies: ["svc-hana"],
      costMonthlyUsd: 120,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["pipeline", "defect:metric"],
    },
    {
      id: "semantic-net-revenue-finance",
      kind: "dashboard",
      name: "NetRevenue Finance Definition",
      owner: "finance",
      configuration: { formula: "gross - returns - tax", product: "dp-net-revenue-finance" },
      health: "healthy",
      dependencies: ["pipe-replica"],
      costMonthlyUsd: 10,
      securityPosture: "adequate",
      fidelityStatus: "tier1_conceptual",
      tags: ["semantic", "defect:metric"],
    },
    {
      id: "semantic-net-revenue-sales",
      kind: "dashboard",
      name: "NetRevenue Sales Definition",
      owner: "sales-ops",
      configuration: { formula: "gross - returns", product: "dp-net-revenue-sales" },
      health: "degraded",
      dependencies: ["pipe-replica"],
      costMonthlyUsd: 10,
      securityPosture: "weak",
      fidelityStatus: "tier1_conceptual",
      tags: ["semantic", "defect:metric"],
    },
    {
      id: "dash-sac",
      kind: "dashboard",
      name: "Exec KPI Story",
      owner: "analytics",
      configuration: { source: "mixed_unofficial" },
      health: "degraded",
      dependencies: ["semantic-net-revenue-finance", "semantic-net-revenue-sales"],
      costMonthlyUsd: 200,
      securityPosture: "weak",
      fidelityStatus: "tier1_conceptual",
      tags: ["sac"],
    },
  ];
}

function buildSaas(): R[] {
  return [
    ...baseAccount("saas", "Multi-Tenant SaaS"),
    {
      id: "app-cap-saas",
      kind: "application",
      name: "tenant-app",
      owner: "product",
      configuration: {
        multitenant: true,
        tenantGuard: false,
        adminApi: "/admin/export",
      },
      health: "degraded",
      dependencies: ["saas-sa"],
      costMonthlyUsd: 300,
      securityPosture: "critical",
      fidelityStatus: "tier2_behavioral",
      tags: ["cap", "defect:tenant"],
    },
    {
      id: "svc-xsuaa",
      kind: "service_instance",
      name: "saas-xsuaa",
      owner: "security",
      configuration: {
        roleCollections: { Support: ["Admin.All", "Tenant.Impersonate"] },
      },
      health: "degraded",
      dependencies: ["saas-sa"],
      costMonthlyUsd: 0,
      securityPosture: "critical",
      fidelityStatus: "tier2_behavioral",
      tags: ["identity", "defect:tenant"],
    },
    {
      id: "db-tenant",
      kind: "database",
      name: "saas-db",
      owner: "data",
      configuration: { isolation: "shared_schema_discriminator" },
      health: "healthy",
      dependencies: ["app-cap-saas"],
      costMonthlyUsd: 500,
      securityPosture: "weak",
      fidelityStatus: "tier2_behavioral",
      tags: ["hana"],
    },
  ];
}

function buildInherited(): R[] {
  return [
    ...baseAccount("inh", "Inherited Co"),
    {
      id: "job-nightly",
      kind: "pipeline",
      name: "nightly-reconciliation",
      owner: "unknown",
      configuration: { manualFolder: "\\\\files\\drop\\orders", schedule: "02:00" },
      health: "degraded",
      dependencies: ["inh-sa"],
      costMonthlyUsd: 5,
      securityPosture: "critical",
      fidelityStatus: "tier2_behavioral",
      tags: ["batch", "defect:coupling"],
    },
    {
      id: "iflow-legacy",
      kind: "integration_flow",
      name: "Legacy_File_Pickup",
      owner: "unknown",
      configuration: { folder: "\\\\files\\drop\\orders", race: true },
      health: "degraded",
      dependencies: ["job-nightly"],
      costMonthlyUsd: 40,
      securityPosture: "weak",
      fidelityStatus: "tier2_behavioral",
      tags: ["cpi", "defect:coupling"],
    },
    {
      id: "api-dup-1",
      kind: "api",
      name: "OrdersAPI_v1",
      owner: "unknown",
      configuration: {},
      health: "unknown",
      dependencies: [],
      costMonthlyUsd: 20,
      securityPosture: "unknown",
      fidelityStatus: "tier1_conceptual",
      tags: ["duplicate-api"],
    },
    {
      id: "api-dup-2",
      kind: "api",
      name: "OrdersService_Old",
      owner: "unknown",
      configuration: { overlaps: "api-dup-1" },
      health: "unknown",
      dependencies: [],
      costMonthlyUsd: 20,
      securityPosture: "unknown",
      fidelityStatus: "tier1_conceptual",
      tags: ["duplicate-api"],
    },
  ];
}

function buildRegulated(): R[] {
  return [
    ...baseAccount("reg", "Regulated Global"),
    {
      id: "db-eu",
      kind: "database",
      name: "pii-eu10",
      region: "eu10",
      owner: "data-privacy",
      configuration: { pii: true, residency: "EU" },
      health: "healthy",
      dependencies: ["reg-sa"],
      costMonthlyUsd: 600,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["hana", "pii"],
    },
    {
      id: "db-us-replica",
      kind: "database",
      name: "pii-us10-replica",
      region: "us10",
      owner: "analytics",
      configuration: { pii: true, residency: "US", enabled: true, approved: false },
      health: "degraded",
      dependencies: ["db-eu"],
      costMonthlyUsd: 400,
      securityPosture: "critical",
      fidelityStatus: "tier2_behavioral",
      tags: ["replica", "defect:residency"],
    },
    {
      id: "app-regional",
      kind: "application",
      name: "order-insights-regional",
      owner: "product",
      configuration: {},
      health: "healthy",
      dependencies: ["db-eu"],
      costMonthlyUsd: 100,
      securityPosture: "adequate",
      fidelityStatus: "tier2_behavioral",
      tags: ["cap"],
    },
  ];
}

function buildGrand(): R[] {
  return [
    ...buildNorthwind(),
    ...buildIntegrationSprawl().filter((r) => !r.id.endsWith("-ga") && !r.id.endsWith("-sa")),
    {
      id: "alert-noise",
      kind: "dashboard",
      name: "Pager Storm Board",
      owner: "sre",
      configuration: { falsePositiveRate: 0.7, slo: null },
      health: "degraded",
      dependencies: ["app-cap-orders", "iflow-partner-a"],
      costMonthlyUsd: 15,
      securityPosture: "weak",
      fidelityStatus: "tier1_conceptual",
      tags: ["observability", "defect:compound"],
    },
  ];
}

/** @deprecated use buildLandscape */
export function buildStartupLandscape(): SimulationResource[] {
  return buildNorthwind();
}
