/**
 * Master curriculum spine: every concept sequenced, 100s of challenges.
 * Order: What is BTP → structure → admin/security → domain fluency paths.
 * No concept left out; unlock chain is strictly linear.
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const conceptsDir = join(root, "content/concepts");

const DOMAIN_ORDER = [
  "operations", // includes btp-* beginner
  "architecture",
  "security",
  "cap",
  "rap-abap",
  "ui5-fiori",
  "integration",
  "events",
  "bpa",
  "workzone",
  "hana-cloud",
  "datasphere",
  "bdc",
  "sac",
  "ai",
  "incident",
];

const LEVEL_RANK = { starter: 0, basic: 1, beginner: 1, intermediate: 2, advanced: 3, expert: 4 };

const BIOME_BY_DOMAIN = {
  operations: "space",
  architecture: "chess",
  security: "war",
  cap: "neural",
  "rap-abap": "chess",
  "ui5-fiori": "film",
  integration: "neural",
  events: "neural",
  bpa: "farm",
  workzone: "roblox",
  "hana-cloud": "farm",
  datasphere: "farm",
  bdc: "farm",
  sac: "market",
  ai: "neural",
  incident: "war",
};

const FORCE_FIRST = [
  "btp-what",
  "btp-services-map",
  "btp-platform-structure",
  "ops-accounts",
  "c-global-account",
  "c-subaccount",
  "ops-entitlements",
  "c-service-plan",
  "c-cf-space",
  "ops-cf",
  "c-mta",
  "c-binding",
  "btp-security-admin",
  "sec-shared-resp",
  "c-shared-responsibility",
  "sec-authn-authz",
  "sec-oauth-oidc",
  "sec-ias-ips",
  "sec-destinations",
  "c-destination",
  "sec-xsuaa-roles",
  "c-xsuaa-roles",
  "c-least-privilege",
  "c-scope-403",
  "sec-jwt-claims",
  "c-jwt-audience",
  "sec-principal-prop",
  "c-principal-propagation",
  "principal-hybrid",
  "cloud-connector",
  "sec-secrets",
  "c-csrf",
  "sec-threat-model",
  "c-threat-model",
  "sec-tenant-isolation",
  "c-tenant-isolation",
  "sec-zero-trust",
  "sec-supply-chain",
  "c-residency",
  "c-audit-log",
  "sec-incident-ir",
];

function loadConcepts() {
  return readdirSync(conceptsDir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => JSON.parse(readFileSync(join(conceptsDir, f), "utf8")))
    .filter((c) => c && c.id);
}

function sortConcepts(concepts) {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const used = new Set();
  const ordered = [];

  for (const id of FORCE_FIRST) {
    if (byId.has(id) && !used.has(id)) {
      ordered.push(byId.get(id));
      used.add(id);
    }
  }

  const rest = concepts
    .filter((c) => !used.has(c.id))
    .sort((a, b) => {
      const da = DOMAIN_ORDER.indexOf(a.domainId);
      const db = DOMAIN_ORDER.indexOf(b.domainId);
      const dord = (da < 0 ? 99 : da) - (db < 0 ? 99 : db);
      if (dord !== 0) return dord;
      const la = LEVEL_RANK[a.level] ?? 2;
      const lb = LEVEL_RANK[b.level] ?? 2;
      if (la !== lb) return la - lb;
      return String(a.title).localeCompare(String(b.title));
    });

  for (const c of rest) {
    ordered.push(c);
    used.add(c.id);
  }
  return ordered;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tools() {
  return [
    { id: "tool-alert", label: "ALERT", icon: "⚠", color: "#fbbf24" },
    { id: "tool-check", label: "CHECK", icon: "✓", color: "#34d399" },
    { id: "tool-rap", label: "RAP", icon: "▣", color: "#38bdf8" },
    { id: "tool-cap", label: "CAP", icon: "⬡", color: "#a78bfa" },
    { id: "tool-scope", label: "SCOPE", icon: "⛨", color: "#f472b6" },
    { id: "tool-idem", label: "IDEM", icon: "∞", color: "#22d3ee" },
    { id: "tool-tenant", label: "TENANT", icon: "⌂", color: "#fb7185" },
    { id: "tool-event", label: "EVENT", icon: "⚡", color: "#fbbf24" },
    { id: "tool-ai", label: "GROUND", icon: "✦", color: "#c4b5fd" },
    { id: "tool-product", label: "PRODUCT", icon: "◈", color: "#34d399" },
    { id: "tool-slo", label: "SLO", icon: "⏱", color: "#38bdf8" },
    { id: "tool-platform", label: "BTP", icon: "Ω", color: "#38bdf8" },
    { id: "tool-account", label: "ACCT", icon: "⌂", color: "#a78bfa" },
    { id: "tool-admin", label: "ADMIN", icon: "⚿", color: "#fbbf24" },
    { id: "tool-seed", label: "SEED", icon: "🌱", color: "#4ade80" },
    { id: "tool-block", label: "BLOCK", icon: "▣", color: "#f97316" },
    { id: "tool-fix", label: "FIX", icon: "🔧", color: "#38bdf8" },
    { id: "tool-doc", label: "DOC", icon: "📄", color: "#94a3b8" },
  ];
}

function pickTool(c, h) {
  const s = `${c.id} ${c.title} ${c.domainId}`.toLowerCase();
  if (/jwt|auth|scope|role|xsuaa|oauth|sec-/.test(s)) return "tool-scope";
  if (/tenant|isolat/.test(s)) return "tool-tenant";
  if (/event|mesh|async/.test(s)) return "tool-event";
  if (/idempot|retry|dlq/.test(s)) return "tool-idem";
  if (/ai|rag|hallucin|joule|prompt|agent/.test(s)) return "tool-ai";
  if (/data.?product|bdc|lineage|semantic/.test(s)) return "tool-product";
  if (/slo|sre|observ|finops/.test(s)) return "tool-slo";
  if (/rap|clean.?core|abap/.test(s)) return "tool-rap";
  if (/cap|odata|cds/.test(s)) return "tool-cap";
  if (/account|subaccount|entitle|global|mta|binding|cf/.test(s)) return "tool-account";
  if (/btp-what|platform/.test(s)) return "tool-platform";
  if (/admin|secret|threat/.test(s)) return "tool-admin";
  const pool = ["tool-check", "tool-fix", "tool-doc", "tool-seed", "tool-block"];
  return pool[h % pool.length];
}

function mapLayout(kind, h) {
  const layouts = {
    chain: {
      nodes: [
        { id: "a", label: "Start", x: 15, y: 48, kind: "app" },
        { id: "b", label: "Middle", x: 40, y: 48, kind: "flow", broken: true },
        { id: "c", label: "Service", x: 65, y: 48, kind: "api" },
        { id: "d", label: "Data", x: 88, y: 48, kind: "data" },
      ],
      edges: [
        ["a", "b"],
        ["b", "c"],
        ["c", "d"],
      ],
      dropTarget: "b",
    },
    hub: {
      nodes: [
        { id: "hub", label: "Hub", x: 50, y: 48, kind: "api", broken: true },
        { id: "n1", label: "Node A", x: 20, y: 30, kind: "app" },
        { id: "n2", label: "Node B", x: 20, y: 70, kind: "partner" },
        { id: "n3", label: "Node C", x: 80, y: 48, kind: "data" },
      ],
      edges: [
        ["n1", "hub"],
        ["n2", "hub"],
        ["hub", "n3"],
      ],
      dropTarget: "hub",
    },
    layers: {
      nodes: [
        { id: "xp", label: "Experience", x: 50, y: 22, kind: "app" },
        { id: "plat", label: "Platform", x: 50, y: 48, kind: "api", broken: true },
        { id: "core", label: "Core SoR", x: 50, y: 75, kind: "core" },
      ],
      edges: [
        ["xp", "plat"],
        ["plat", "core"],
      ],
      dropTarget: "plat",
    },
    security: {
      nodes: [
        { id: "user", label: "User", x: 15, y: 48, kind: "app" },
        { id: "idp", label: "IdP", x: 38, y: 48, kind: "dest" },
        { id: "api", label: "API", x: 62, y: 48, kind: "api", broken: true },
        { id: "db", label: "Data", x: 86, y: 48, kind: "data" },
      ],
      edges: [
        ["user", "idp"],
        ["idp", "api"],
        ["api", "db"],
      ],
      dropTarget: "api",
    },
  };
  const keys = Object.keys(layouts);
  return layouts[keys[h % keys.length]];
}

function wrongOpts(title) {
  return [
    {
      id: "w1",
      label: `Ignore ${title} and hope production is fine`,
      correct: false,
      why: "Skipping foundations creates silent debt. Name the control and verify it.",
    },
    {
      id: "w2",
      label: "Disable security / governance to unblock demo",
      correct: false,
      why: "Demo shortcuts become production incidents. Never remove controls as a 'fix'.",
    },
    {
      id: "w3",
      label: "Memorize the buzzword only",
      correct: false,
      why: "Recall without mechanism fails under board pressure. Explain how it works.",
    },
  ];
}

function teachBlurb(c) {
  const exp = (c.explain || c.summary || c.title).replace(/\s+/g, " ").slice(0, 280);
  return exp;
}

function buildIntroChallenge(c, index, prevId, seq) {
  const h = hash(c.id + ":intro");
  const biome = BIOME_BY_DOMAIN[c.domainId] || "space";
  const layout = mapLayout("layers", h);
  const tool = pickTool(c, h);
  const summary = c.summary || c.title;
  const points = Array.isArray(c.formalPoints) && c.formalPoints.length ? c.formalPoints : [summary];

  return {
    id: `ch-${c.id}-intro`,
    title: `${seq}. ${c.title}`,
    tier: c.level || "basic",
    domain: c.domainId || "operations",
    biome,
    challengeType: biome === "war" ? "war_board" : biome,
    mapStyle: biome,
    brief: `Curriculum step ${seq}/${/* filled later */ 0}: ${summary}`,
    unlockAfter: prevId,
    concepts: [c.id],
    curriculumIndex: seq,
    conceptId: c.id,
    variant: "intro",
    mapNodes: layout.nodes.map((n, i) =>
      i === 1 ? { ...n, label: c.title.slice(0, 18), broken: true } : n,
    ),
    edges: layout.edges,
    steps: [
      {
        id: "s1",
        title: "Recognize the idea",
        teach: teachBlurb(c),
        prompt: `What best captures “${c.title}”?`,
        mode: "choose",
        hint: points[0] || summary,
        cinema: "film_setup",
        formula: `Concept: ${c.id}`,
        options: [
          {
            id: "c1",
            label: summary.slice(0, 120) || c.title,
            correct: true,
            why: `Correct — ${summary}`,
          },
          ...wrongOpts(c.title).slice(0, 2),
        ],
      },
      {
        id: "s2",
        title: "Avoid the trap",
        teach:
          (c.commonMistakes && c.commonMistakes[0]) ||
          "Common trap: treating the name as the design. Mechanism and failure mode matter.",
        prompt: "Which approach is the mistake to reject?",
        mode: "choose",
        hint: "Reject shortcuts that remove controls or skip verification.",
        cinema: "film_tension",
        options: [
          {
            id: "m1",
            label:
              (c.commonMistakes && c.commonMistakes[0]) ||
              `Treat “${c.title}” as optional decoration`,
            correct: true,
            why: "Correct rejection — this is the anti-pattern to avoid.",
          },
          {
            id: "m2",
            label: "Design with constraints and verify the control",
            correct: false,
            why: "That is the good path — not the reject target.",
          },
          {
            id: "m3",
            label: "Document ownership and test negative cases",
            correct: false,
            why: "Healthy practice — not the mistake.",
          },
        ],
      },
      {
        id: "s3",
        title: "Place the control",
        teach: (c.howToApply && c.howToApply[0]) || `Apply ${c.title} on the active hop of the landscape.`,
        prompt: "Drag the highlighted tool onto the broken/active node.",
        mode: "drop",
        hint: "Broken/highlighted middle hop is usually the lesson focus.",
        toolId: tool,
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, `Not this node for “${c.title}”. Re-read the teach beat.`]),
        ),
        successWhy: `Placed control for ${c.title}.`,
        cinema: "film_climax",
      },
      {
        id: "s4",
        title: "Verify",
        teach:
          (c.whyItMatters || `Without ${c.title}, designs fail under pressure.`) +
          " Close the loop with verification.",
        prompt: "Drag CHECK onto the service/data node that proves health.",
        mode: "drop",
        hint: "Verify the downstream resource or hub.",
        toolId: "tool-check",
        targetNodeId: layout.nodes[layout.nodes.length - 1].id,
        wrongTargets: Object.fromEntries(
          layout.nodes.slice(0, -1).map((n) => [
            n.id,
            "Useful later — this step wants the verification target.",
          ]),
        ),
        successWhy: `${c.title} intro cleared. Next curriculum step unlocks.`,
        cinema: "film_end",
      },
    ],
  };
}

function useCaseLine(c, i = 0) {
  const u = Array.isArray(c.useCases) && c.useCases[i] ? c.useCases[i] : null;
  if (u) return String(u).slice(0, 160);
  return `Use ${c.title} when the landscape decision hinges on this control.`;
}

function howLine(c, i = 0) {
  const h = Array.isArray(c.howToApply) && c.howToApply[i] ? c.howToApply[i] : null;
  if (h) return String(h).slice(0, 160);
  return `Apply ${c.title} on the active hop, then verify with evidence.`;
}

function trapLine(c) {
  const m = Array.isArray(c.commonMistakes) && c.commonMistakes[0] ? c.commonMistakes[0] : null;
  if (m) return String(m).slice(0, 160);
  return `Treating “${c.title}” as optional decoration instead of a designed control.`;
}

/** WHEN TO USE — scenario timing game */
function buildWhenChallenge(c, index, prevId, seq) {
  const h = hash(c.id + ":when");
  const biome = BIOME_BY_DOMAIN[c.domainId] || "space";
  const layout = mapLayout("chain", h + 1);
  const tool = pickTool(c, h);
  const uc0 = useCaseLine(c, 0);
  const uc1 = useCaseLine(c, 1);
  const why = c.whyItMatters || `Without ${c.title}, designs fail under pressure.`;

  return {
    id: `ch-${c.id}-when`,
    title: `${seq}⏱ When: ${c.title}`,
    tier: c.level || "basic",
    domain: c.domainId || "operations",
    biome,
    challengeType: "when_to_use",
    mapStyle: biome,
    brief: `When-to-use game for ${c.title}. Pick the right moment; reject vanity timing.`,
    unlockAfter: prevId,
    concepts: [c.id],
    curriculumIndex: seq,
    conceptId: c.id,
    variant: "when",
    mapNodes: layout.nodes.map((n, i) =>
      i === 1 ? { ...n, label: "Decision", broken: true } : n,
    ),
    edges: layout.edges,
    steps: [
      {
        id: "s1",
        title: "Spot the trigger",
        teach: `WHEN to reach for “${c.title}”: ${uc0}`,
        prompt: `Which situation is the right moment to apply ${c.title}?`,
        mode: "choose",
        hint: "Match a real trigger: landing zone, incident, design review, go-live.",
        cinema: "when_radar",
        formula: "WHEN = trigger + constraint + failure cost",
        options: [
          { id: "t", label: uc0, correct: true, why: "Correct trigger — use the concept here." },
          {
            id: "f1",
            label: "Only after production is already on fire for weeks",
            correct: false,
            why: "Too late. Design-time and early ops use this concept before blast radius grows.",
          },
          {
            id: "f2",
            label: "Never — buzzwords belong only on marketing slides",
            correct: false,
            why: "This is an operational design control, not decoration.",
          },
        ],
      },
      {
        id: "s2",
        title: "Reject wrong timing",
        teach: `Wrong timing wastes effort or misses risk. ${why}`.slice(0, 280),
        prompt: "Which timing is a trap for this concept?",
        mode: "choose",
        hint: "Reject “skip until certification” and “only after outage”.",
        cinema: "when_clock",
        options: [
          {
            id: "t",
            label: "Defer until after go-live with no residual-risk note",
            correct: true,
            why: "Trap identified — silent deferral is how debt becomes incidents.",
          },
          {
            id: "f1",
            label: uc1,
            correct: false,
            why: "That is a legitimate use window — not the trap.",
          },
          {
            id: "f2",
            label: "During architecture review when constraints are still cheap to change",
            correct: false,
            why: "That is excellent timing — not the trap.",
          },
        ],
      },
      {
        id: "s3",
        title: "Arm the decision hop",
        teach: `On the timeline, the decision hop is where “${c.title}” enters the design.`,
        prompt: "Drop the tool onto the Decision hop to mark WHEN you engage.",
        mode: "drop",
        hint: "Broken middle node = decision moment.",
        toolId: tool,
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, "Not the decision hop — arm the moment you choose the control."]),
        ),
        successWhy: `When-to-use armed for ${c.title}.`,
        cinema: "when_lock",
      },
      {
        id: "s4",
        title: "Confirm window",
        teach: "Close the loop: the team can restate WHEN this concept is mandatory.",
        prompt: "CHECK the decision hop — proof you can explain the use window.",
        mode: "drop",
        hint: "Verify the same decision node.",
        toolId: "tool-check",
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, "Verify the decision hop you armed."]),
        ),
        successWhy: `When-game cleared: ${c.title}.`,
        cinema: "when_seal",
      },
    ],
  };
}

/** HOW TO USE — procedural apply game */
function buildHowChallenge(c, index, prevId, seq) {
  const h = hash(c.id + ":how");
  const biome = BIOME_BY_DOMAIN[c.domainId] || "space";
  const layout = mapLayout("layers", h + 2);
  const tool = pickTool(c, h + 2);
  const h0 = howLine(c, 0);
  const h1 = howLine(c, 1);
  const points = Array.isArray(c.formalPoints) ? c.formalPoints : [];

  return {
    id: `ch-${c.id}-how`,
    title: `${seq}⚙ How: ${c.title}`,
    tier: c.level || "basic",
    domain: c.domainId || "operations",
    biome,
    challengeType: "how_to_use",
    mapStyle: biome,
    brief: `How-to-use game for ${c.title}. Sequence, place, verify — mechanism not buzzword.`,
    unlockAfter: prevId,
    concepts: [c.id],
    curriculumIndex: seq,
    conceptId: c.id,
    variant: "how",
    mapNodes: layout.nodes.map((n, i) =>
      i === 1 ? { ...n, label: c.title.slice(0, 16), broken: true } : n,
    ),
    edges: layout.edges,
    steps: [
      {
        id: "s1",
        title: "Name the move",
        teach: `HOW to use “${c.title}”: ${h0}`,
        prompt: `Which action is the correct first move when using ${c.title}?`,
        mode: "choose",
        hint: points[0] || h0,
        cinema: "how_pipeline",
        formula: "HOW = locate hop → apply control → verify evidence",
        options: [
          { id: "t", label: h0, correct: true, why: "Correct procedure — this is how you use it." },
          {
            id: "f1",
            label: "Skip design, paste a screenshot from another project",
            correct: false,
            why: "Copy-paste without landscape context fails under review.",
          },
          {
            id: "f2",
            label: "Grant Admin.All so you never need this concept",
            correct: false,
            why: "Privilege inflation is not a how-to — it is a trap.",
          },
        ],
      },
      {
        id: "s2",
        title: "Order the steps",
        teach: `Second beat: ${h1}`,
        prompt: "Which follow-through is correct after the first apply?",
        mode: "choose",
        hint: "Evidence, negative test, or ownership — not “hope”.",
        cinema: "how_steps",
        options: [
          {
            id: "t",
            label: h1,
            correct: true,
            why: "Correct how-sequence.",
          },
          {
            id: "f1",
            label: "Ship to prod with no check and no owner",
            correct: false,
            why: "Missing verify + ownership is how silent debt ships.",
          },
          {
            id: "f2",
            label: "Delete logs so nobody can challenge the design",
            correct: false,
            why: "Never. Observability is part of how you use platform controls.",
          },
        ],
      },
      {
        id: "s3",
        title: "Place on the platform hop",
        teach: `Drag the control onto the hop where ${c.title} actually lives in the stack.`,
        prompt: "Drop the highlighted tool onto the broken platform/control node.",
        mode: "drop",
        hint: "Broken middle layer is the apply target.",
        toolId: tool,
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, `Wrong layer for “${c.title}” apply.`]),
        ),
        successWhy: `How-to placement for ${c.title}.`,
        cinema: "how_place",
      },
      {
        id: "s4",
        title: "Prove it",
        teach: "HOW is incomplete without verification evidence.",
        prompt: "CHECK the service/data node that proves the control works.",
        mode: "drop",
        hint: "Downstream verification target.",
        toolId: "tool-check",
        targetNodeId: layout.nodes[layout.nodes.length - 1].id,
        wrongTargets: Object.fromEntries(
          layout.nodes.slice(0, -1).map((n) => [
            n.id,
            "Useful later — this beat wants verification evidence.",
          ]),
        ),
        successWhy: `How-game cleared: ${c.title}.`,
        cinema: "how_prove",
      },
    ],
  };
}

/** TRAP / WHEN NOT — misuse game */
function buildTrapChallenge(c, index, prevId, seq) {
  const h = hash(c.id + ":trap");
  const biome = BIOME_BY_DOMAIN[c.domainId] || "war";
  const layout = mapLayout("security", h + 5);
  const tool = pickTool(c, h + 5);
  const trap = trapLine(c);
  const good = howLine(c, 0);

  return {
    id: `ch-${c.id}-trap`,
    title: `${seq}⚠ Trap: ${c.title}`,
    tier: c.level === "basic" ? "advanced" : c.level || "advanced",
    domain: c.domainId || "operations",
    biome: biome === "farm" ? "war" : biome,
    challengeType: "trap_misuse",
    mapStyle: biome === "farm" ? "war" : biome,
    brief: `Trap game for ${c.title}. Name the misuse, reject it, re-arm the control.`,
    unlockAfter: prevId,
    concepts: [c.id],
    curriculumIndex: seq,
    conceptId: c.id,
    variant: "trap",
    mapNodes: layout.nodes,
    edges: layout.edges,
    steps: [
      {
        id: "s1",
        title: "Name the anti-pattern",
        teach: `Misuse of “${c.title}”: ${trap}`,
        prompt: "Which option is the misuse to reject?",
        mode: "choose",
        hint: "Anti-pattern language — disable, skip, over-privilege, buzzword-only.",
        cinema: "trap_alert",
        formula: "TRAP = looks fast · hides risk · fails audit/incident",
        options: [
          { id: "t", label: trap, correct: true, why: "Correct — this is the trap to reject." },
          {
            id: "f1",
            label: good,
            correct: false,
            why: "That is the good path — not the trap.",
          },
          {
            id: "f2",
            label: "Document residual risk when deferring with an owner and date",
            correct: false,
            why: "Healthy deferral practice — not a trap.",
          },
        ],
      },
      {
        id: "s2",
        title: "Why the trap fails",
        teach: c.whyItMatters || `Skipping ${c.title} turns design debt into customer pain.`,
        prompt: "Why does the trap fail under real pressure?",
        mode: "choose",
        hint: "Blast radius, audit, upgrade, or customer impact.",
        cinema: "trap_blast",
        options: [
          {
            id: "t",
            label: (c.whyItMatters || `Silent failure until production proves you wrong.`).slice(
              0,
              140,
            ),
            correct: true,
            why: "Risk framing locked.",
          },
          {
            id: "f1",
            label: "Traps only matter for exam questions",
            correct: false,
            why: "Operational failure, not exams.",
          },
          {
            id: "f2",
            label: "Nothing fails if you never look at logs",
            correct: false,
            why: "Customers and auditors still notice.",
          },
        ],
      },
      {
        id: "s3",
        title: "Re-arm the control",
        teach: `Replace the trap with a real apply of ${c.title}.`,
        prompt: "Drop the tool onto the broken API hop to re-arm the control.",
        mode: "drop",
        hint: "Broken API/control node.",
        toolId: tool,
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, "Wrong hop — re-arm the broken control node."]),
        ),
        successWhy: `Trap rejected; control re-armed for ${c.title}.`,
        cinema: "trap_rearm",
      },
      {
        id: "s4",
        title: "Seal against relapse",
        teach: "Peak-end: verify so the trap memory includes the fix path.",
        prompt: "CHECK the data/service end to prove the trap is gone.",
        mode: "drop",
        hint: "Downstream proof node.",
        toolId: "tool-check",
        targetNodeId: layout.nodes[layout.nodes.length - 1].id,
        wrongTargets: Object.fromEntries(
          layout.nodes.slice(0, -1).map((n) => [n.id, "Verify the end of the chain."]),
        ),
        successWhy: `Trap-game cleared: ${c.title}.`,
        cinema: "trap_seal",
      },
    ],
  };
}

/** SCENARIO — live project story: pick how/when in context */
function buildScenarioChallenge(c, index, prevId, seq) {
  const h = hash(c.id + ":scenario");
  const biome = BIOME_BY_DOMAIN[c.domainId] || "film";
  const layout = mapLayout("hub", h + 7);
  const tool = pickTool(c, h + 7);
  const uc0 = useCaseLine(c, 0);
  const uc1 = useCaseLine(c, 1);
  const how = howLine(c, 0);

  return {
    id: `ch-${c.id}-scenario`,
    title: `${seq}🎬 Scenario: ${c.title}`,
    tier: c.level || "basic",
    domain: c.domainId || "operations",
    biome: biome === "chess" ? "film" : biome,
    challengeType: "scenario_story",
    mapStyle: biome === "chess" ? "film" : biome,
    brief: `Scenario theater for ${c.title} — real project story: when to engage, how to act.`,
    unlockAfter: prevId,
    concepts: [c.id],
    curriculumIndex: seq,
    conceptId: c.id,
    variant: "scenario",
    mapNodes: layout.nodes.map((n, i) =>
      i === 0 ? { ...n, label: "Story", broken: false } : n,
    ),
    edges: layout.edges,
    steps: [
      {
        id: "s1",
        title: "Read the room",
        teach: `Project scene: ${uc0}`,
        prompt: `In this story, when is “${c.title}” the right control?`,
        mode: "choose",
        hint: "Match the use case to the trigger in the scene.",
        cinema: "scenario_open",
        formula: "SCENE → TRIGGER → CONTROL → PROOF",
        options: [
          { id: "t", label: uc0, correct: true, why: "Scene trigger matched — engage now." },
          {
            id: "f1",
            label: "After every status meeting, regardless of risk",
            correct: false,
            why: "Cargo-cult timing wastes capacity.",
          },
          {
            id: "f2",
            label: "Never in this landscape — only on paper",
            correct: false,
            why: "The scene exists so you apply the control for real.",
          },
        ],
      },
      {
        id: "s2",
        title: "Act in the scene",
        teach: `How the team should move: ${how}`,
        prompt: "Which action plays correctly in this scenario?",
        mode: "choose",
        hint: how,
        cinema: "scenario_act",
        options: [
          { id: "t", label: how, correct: true, why: "Correct scene action." },
          {
            id: "f1",
            label: "Ignore the hub and only update slides",
            correct: false,
            why: "Theater without landscape change is not apply.",
          },
          {
            id: "f2",
            label: "Disable monitoring so the story looks green",
            correct: false,
            why: "Hiding signals is a trap.",
          },
        ],
      },
      {
        id: "s3",
        title: "Stage the hub",
        teach: `Second window: ${uc1}`,
        prompt: "Drop the tool on the hub — the scene’s control point.",
        mode: "drop",
        hint: "Hub is the active center.",
        toolId: tool,
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, "Wrong stage mark — use the hub."]),
        ),
        successWhy: `Scenario apply for ${c.title}.`,
        cinema: "scenario_stage",
      },
      {
        id: "s4",
        title: "Cut — verify",
        teach: "Scene ends only when evidence proves the control held.",
        prompt: "CHECK the hub — proof for the debrief.",
        mode: "drop",
        hint: "Hub again for seal.",
        toolId: "tool-check",
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, "Verify the hub."]),
        ),
        successWhy: `Scenario cleared: ${c.title}.`,
        cinema: "scenario_cut",
      },
    ],
  };
}

/** COMPARE — when this concept vs alternatives */
function buildCompareChallenge(c, index, prevId, seq) {
  const h = hash(c.id + ":compare");
  const biome = BIOME_BY_DOMAIN[c.domainId] || "market";
  const layout = mapLayout("layers", h + 11);
  const tool = pickTool(c, h + 11);
  const title = c.title;
  const why = c.whyItMatters || `Prefer ${title} when the failure mode is material.`;
  const trade =
    Array.isArray(c.designTradeoffs) && c.designTradeoffs[0]
      ? c.designTradeoffs[0]
      : null;
  const chooseA = trade?.whenChooseA || `Choose ${title} when constraints make it the safer control.`;
  const chooseB = trade?.whenChooseB || `Defer ${title} only with residual risk, owner, and date.`;

  return {
    id: `ch-${c.id}-compare`,
    title: `${seq}⚖ Compare: ${c.title}`,
    tier: c.level === "basic" ? "advanced" : c.level || "advanced",
    domain: c.domainId || "operations",
    biome: biome === "farm" ? "market" : biome,
    challengeType: "compare_tradeoff",
    mapStyle: biome === "farm" ? "market" : biome,
    brief: `Compare game for ${title} — when this control vs defer/alternative.`,
    unlockAfter: prevId,
    concepts: [c.id],
    curriculumIndex: seq,
    conceptId: c.id,
    variant: "compare",
    mapNodes: layout.nodes.map((n, i) =>
      i === 1 ? { ...n, label: "Tradeoff", broken: true } : n,
    ),
    edges: layout.edges,
    steps: [
      {
        id: "s1",
        title: "Pick the control",
        teach: why.slice(0, 280),
        prompt: `When should you choose “${title}” over deferring it?`,
        mode: "choose",
        hint: String(chooseA).slice(0, 120),
        cinema: "compare_scales",
        formula: "COMPARE = risk × cost × reversibility",
        options: [
          {
            id: "t",
            label: String(chooseA).slice(0, 150),
            correct: true,
            why: "Correct window for choosing this control.",
          },
          {
            id: "f1",
            label: "Always pick the newest brand name regardless of fit",
            correct: false,
            why: "Brand ≠ fit. Compare on risk and landscape.",
          },
          {
            id: "f2",
            label: "Never choose it — complexity is always wrong",
            correct: false,
            why: "Under-engineering is also a risk.",
          },
        ],
      },
      {
        id: "s2",
        title: "Know the alternate",
        teach: `Defer window: ${String(chooseB).slice(0, 200)}`,
        prompt: "Which deferral is disciplined (not a trap)?",
        mode: "choose",
        hint: "Owner + date + residual risk — not silent skip.",
        cinema: "compare_fork",
        options: [
          {
            id: "t",
            label: String(chooseB).slice(0, 150),
            correct: true,
            why: "Disciplined alternate path.",
          },
          {
            id: "f1",
            label: "Skip forever and hope no one audits",
            correct: false,
            why: "Silent skip is the trap.",
          },
          {
            id: "f2",
            label: "Ship with Admin.All so you need no design",
            correct: false,
            why: "Privilege inflation is never the alternate.",
          },
        ],
      },
      {
        id: "s3",
        title: "Commit the hop",
        teach: `Lock the chosen path for ${title} onto the tradeoff hop.`,
        prompt: "Drop the tool on the Tradeoff node to commit.",
        mode: "drop",
        hint: "Broken middle hop.",
        toolId: tool,
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, "Commit on the tradeoff hop."]),
        ),
        successWhy: `Compare commit for ${title}.`,
        cinema: "compare_lock",
      },
      {
        id: "s4",
        title: "Prove the fork",
        teach: "Close with verification so the compare memory sticks.",
        prompt: "CHECK the end node — evidence for the chosen path.",
        mode: "drop",
        hint: "Downstream proof.",
        toolId: "tool-check",
        targetNodeId: layout.nodes[layout.nodes.length - 1].id,
        wrongTargets: Object.fromEntries(
          layout.nodes.slice(0, -1).map((n) => [n.id, "Verify the end of the path."]),
        ),
        successWhy: `Compare cleared: ${title}.`,
        cinema: "compare_prove",
      },
    ],
  };
}

function buildMasteryChallenge(c, index, prevId, seq) {
  const h = hash(c.id + ":mastery");
  const biome = BIOME_BY_DOMAIN[c.domainId] || "space";
  const layout = mapLayout("hub", h + 3);
  const tool = pickTool(c, h + 1);
  const points = Array.isArray(c.formalPoints) ? c.formalPoints : [];
  const p0 = points[0] || c.summary || c.title;
  const p1 = points[1] || c.whyItMatters || `Apply ${c.title} under constraints.`;

  return {
    id: `ch-${c.id}-mastery`,
    title: `${seq}★ Mastery: ${c.title}`,
    tier: c.level === "basic" ? "advanced" : c.level || "advanced",
    domain: c.domainId || "operations",
    biome,
    challengeType: biome,
    mapStyle: biome,
    brief: `Mastery check for ${c.title}. Wrong moves teach; right moves unlock the path.`,
    unlockAfter: prevId,
    concepts: [c.id],
    curriculumIndex: seq,
    conceptId: c.id,
    variant: "mastery",
    mapNodes: layout.nodes,
    edges: layout.edges,
    steps: [
      {
        id: "s1",
        title: "Mechanism under pressure",
        teach: teachBlurb(c),
        prompt: `Board asks: which statement is true about ${c.title}?`,
        mode: "choose",
        hint: p0,
        cinema: "war_brief",
        options: [
          { id: "t", label: p0.slice(0, 140), correct: true, why: "Mechanism-aligned answer." },
          {
            id: "f1",
            label: "It never matters in production landscapes",
            correct: false,
            why: "It matters — that is why it is in the spine.",
          },
          {
            id: "f2",
            label: "Bypass it with Admin.All / no auth in prod",
            correct: false,
            why: "Forbidden shortcut.",
          },
        ],
      },
      {
        id: "s2",
        title: "Why it matters",
        teach: c.whyItMatters || p1,
        prompt: "Select the business-risk reason to care.",
        mode: "choose",
        hint: "Link to failure, audit, upgrade, or customer impact.",
        cinema: "war_move",
        options: [
          {
            id: "t",
            label: (c.whyItMatters || p1).slice(0, 140),
            correct: true,
            why: "Correct risk framing.",
          },
          {
            id: "f1",
            label: "Only for certification trivia",
            correct: false,
            why: "Not trivia — operational judgment.",
          },
          {
            id: "f2",
            label: "Only marketing slides",
            correct: false,
            why: "Design-time control.",
          },
        ],
      },
      {
        id: "s3",
        title: "Apply on the hub",
        teach: (c.howToApply && c.howToApply[0]) || `Wire ${c.title} into the hub node.`,
        prompt: "Drop the tool on the hub.",
        mode: "drop",
        hint: "Hub is the broken/active center.",
        toolId: tool,
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, "Wrong node for this mastery apply."]),
        ),
        successWhy: `Mastery placement for ${c.title}.`,
        cinema: "war_strike",
      },
      {
        id: "s4",
        title: "Seal",
        teach: "Peak-end: verify so memory encodes the correct model.",
        prompt: "CHECK the hub after apply.",
        mode: "drop",
        hint: "Hub again for proof.",
        toolId: "tool-check",
        targetNodeId: layout.dropTarget,
        wrongTargets: Object.fromEntries(
          layout.nodes
            .filter((n) => n.id !== layout.dropTarget)
            .map((n) => [n.id, "Verify the hub."]),
        ),
        successWhy: `Mastery sealed: ${c.title}.`,
        cinema: "war_win",
      },
    ],
  };
}

function main() {
  const concepts = loadConcepts();
  const ordered = sortConcepts(concepts);
  const challenges = [];
  let prev = null;
  let seq = 0;

  // Per concept: intro → when → how → trap → scenario → compare → mastery (7 games)
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i];
    const builders = [
      buildIntroChallenge,
      buildWhenChallenge,
      buildHowChallenge,
      buildTrapChallenge,
      buildScenarioChallenge,
      buildCompareChallenge,
      buildMasteryChallenge,
    ];
    for (const build of builders) {
      seq += 1;
      const ch = build(c, i, prev, seq);
      challenges.push(ch);
      prev = ch.id;
    }
  }

  // Fill brief totals
  const total = challenges.length;
  for (const ch of challenges) {
    ch.brief = ch.brief.replace(/\/\$\{.*\}|\/0/, `/${total}`) || ch.brief;
    if (ch.brief.includes("/0")) {
      ch.brief = ch.brief.replace("/0", `/${total}`);
    }
    // fix template if any
    ch.brief = `Curriculum ${ch.curriculumIndex}/${total} · ${ch.concepts[0]} · ${ch.variant}. ${
      concepts.find((x) => x.id === ch.conceptId)?.summary || ""
    }`.slice(0, 280);
  }

  // Strict chain repair
  for (let i = 0; i < challenges.length; i++) {
    challenges[i].unlockAfter = i === 0 ? null : challenges[i - 1].id;
  }

  const pack = {
    version: "7.0.0",
    title: "Odyssey Full Curriculum Campaign",
    intro:
      "Every concept has seven games: Intro → When → How → Trap → Scenario → Compare → Mastery. How/when-to-use is drilled across multiple formats. Wrong = RED + why. Right = unlock next.",
    biomes: ["war", "chess", "farm", "roblox", "neural", "space", "market", "film"],
    ethics:
      "Linear mastery path for learning integrity. No FOMO punishment — progress saves; missing a day never costs.",
    tools: tools(),
    totalChallenges: challenges.length,
    totalConcepts: ordered.length,
    gamesPerConcept: 7,
    variants: ["intro", "when", "how", "trap", "scenario", "compare", "mastery"],
    challenges,
  };

  const chOut = join(root, "content/challenges/index.json");
  writeFileSync(chOut, JSON.stringify(pack, null, 2));

  const sequence = ordered.map((c, i) => ({
    index: i + 1,
    id: c.id,
    title: c.title,
    domainId: c.domainId,
    level: c.level,
    introChallengeId: `ch-${c.id}-intro`,
    whenChallengeId: `ch-${c.id}-when`,
    howChallengeId: `ch-${c.id}-how`,
    trapChallengeId: `ch-${c.id}-trap`,
    scenarioChallengeId: `ch-${c.id}-scenario`,
    compareChallengeId: `ch-${c.id}-compare`,
    masteryChallengeId: `ch-${c.id}-mastery`,
    games: [
      `ch-${c.id}-intro`,
      `ch-${c.id}-when`,
      `ch-${c.id}-how`,
      `ch-${c.id}-trap`,
      `ch-${c.id}-scenario`,
      `ch-${c.id}-compare`,
      `ch-${c.id}-mastery`,
    ],
  }));

  const curDir = join(root, "content/curriculum");
  mkdirSync(curDir, { recursive: true });
  writeFileSync(
    join(curDir, "master-sequence.json"),
    JSON.stringify(
      {
        version: "7.0.0",
        title: "Master concept sequence",
        description:
          "Pedagogical order: BTP intro → structure → security/admin → CAP → RAP → UI → Integration → Events → BPA → Work Zone → Data → AI. Seven games per concept (what / when / how / trap / scenario / compare / mastery).",
        conceptCount: sequence.length,
        gamesPerConcept: 7,
        challengeCount: challenges.length,
        sequence,
      },
      null,
      2,
    ),
  );

  // Quests: one quest per domain phase + beginner
  const phases = [];
  let phaseConcepts = [];
  let lastDomain = null;
  let phaseNum = 0;
  for (const c of ordered) {
    if (c.domainId !== lastDomain && phaseConcepts.length) {
      phaseNum++;
      phases.push({ domainId: lastDomain, concepts: phaseConcepts, order: phaseNum });
      phaseConcepts = [];
    }
    lastDomain = c.domainId;
    phaseConcepts.push(c.id);
  }
  if (phaseConcepts.length) {
    phaseNum++;
    phases.push({ domainId: lastDomain, concepts: phaseConcepts, order: phaseNum });
  }

  const quests = phases.map((p, i) => {
    const first = p.concepts[0];
    const last = p.concepts[p.concepts.length - 1];
    return {
      id: `q-phase-${i + 1}-${p.domainId}`,
      title: `${i + 1}. ${p.domainId} path (${p.concepts.length} concepts)`,
      tier: i < 3 ? "starter" : i < 8 ? "basic" : i < 12 ? "advanced" : "expert",
      order: i + 1,
      objective: `Clear all 5 games per concept (intro→when→how→trap→mastery) in ${p.domainId} (${first} → ${last}).`,
      challengeId: `ch-${last}-mastery`,
      conceptIds: p.concepts,
      rewardLabel: i + 1 < phases.length ? `Unlock ${phases[i + 1].domainId}` : "Curriculum complete",
      nextQuestId: i + 1 < phases.length ? `q-phase-${i + 2}-${phases[i + 1].domainId}` : null,
    };
  });

  writeFileSync(
    join(root, "content/quests/index.json"),
    JSON.stringify(
      {
        version: "5.0.0",
        ethics:
          "Full-spine quests track domain phases. Progress is mastery of sequenced challenges — no shame streaks.",
        quests,
      },
      null,
      2,
    ),
  );

  // Single mega learning path + domain paths
  const paths = [
    {
      id: "path-full-spine",
      title: "Full BTP Odyssey · every concept in order",
      domainId: "operations",
      levels: ["basic", "advanced", "expert"],
      conceptIds: ordered.map((c) => c.id),
      nextHint: "Do not skip. After each Atlas card, clear its intro + mastery PLAY challenges.",
    },
    ...phases.map((p) => ({
      id: `path-${p.domainId}`,
      title: `${p.domainId} · sequenced (${p.concepts.length})`,
      domainId: p.domainId,
      levels: ["basic", "advanced", "expert"],
      conceptIds: p.concepts,
      nextHint: "Follow order; each concept has intro then mastery game.",
    })),
  ];

  writeFileSync(
    join(root, "content/learning-paths/index.json"),
    JSON.stringify({ version: "5.0.0", paths }, null, 2),
  );

  // concept index
  const ids = ordered.map((c) => c.id);
  writeFileSync(
    join(conceptsDir, "index.json"),
    JSON.stringify({ version: "5.0.0", count: ids.length, ids }, null, 2),
  );

  // coverage report
  const covered = new Set(challenges.flatMap((ch) => ch.concepts));
  const missing = concepts.filter((c) => !covered.has(c.id)).map((c) => c.id);
  writeFileSync(
    join(curDir, "coverage-report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        concepts: concepts.length,
        sequenced: ordered.length,
        challenges: challenges.length,
        missingFromChallenges: missing,
        first: ordered[0]?.id,
        last: ordered[ordered.length - 1]?.id,
        domainOrder: DOMAIN_ORDER,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        concepts: ordered.length,
        challenges: challenges.length,
        quests: quests.length,
        paths: paths.length,
        missing: missing.length,
        first: ordered[0]?.id,
        last: ordered[ordered.length - 1]?.id,
      },
      null,
      2,
    ),
  );
}

main();
