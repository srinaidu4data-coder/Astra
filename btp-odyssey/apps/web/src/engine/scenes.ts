import { Camera, GraphicsEngine, type Vec2 } from "./core";
import {
  LinkArcs,
  NodeSprite,
  ParticleSystem,
  StarFieldLayer,
  healthToColor,
  v2,
} from "./particles";
import { DISTRICT_LAYOUT, MAP_EDGES } from "../districtLayout";

export interface UniverseNode {
  id: string;
  title: string;
  subtitle?: string;
  hue?: number;
}

const HUE_COLOR = (h: number) => {
  // simple HSL to hex-ish via canvas-friendly css color
  return `hsl(${h} 80% 58%)`;
};

export function buildUniverseScene(
  eng: GraphicsEngine,
  domains: UniverseNode[],
  selectedId: string | null,
  onSelect: (id: string | null) => void,
) {
  eng.clear();
  eng.camera.targetZoom = 1;
  eng.camera.targetX = 0;
  eng.camera.targetY = 0;

  eng.add(new StarFieldLayer(160, 2400));
  const particles = new ParticleSystem();
  eng.add(particles);

  const scale = 3.2;
  const nodes = new Map<string, NodeSprite>();

  for (const d of domains) {
    const layout = DISTRICT_LAYOUT[d.id] ?? { x: 50, y: 50, hue: 200, glyph: "•" };
    // layout is 0-100 percent → world coords centered
    const x = (layout.x - 50) * scale * 4;
    const y = (layout.y - 50) * scale * 3.2;
    const color = HUE_COLOR(layout.hue);
    const node = new NodeSprite(
      v2(x, y),
      d.title,
      d.subtitle ?? d.id,
      color,
      selectedId === d.id ? 22 : 18,
      d.id,
    );
    node.z = 20;
    nodes.set(d.id, node);
    eng.add(node);
  }

  const edges = MAP_EDGES.map(([a, b], i) => {
    const A = nodes.get(a)?.pos ?? v2();
    const B = nodes.get(b)?.pos ?? v2();
    return { a: A, b: B, bad: false, pulse: i * 0.07 };
  }).filter((e) => e.a && e.b);
  eng.add(new LinkArcs(edges));

  // ambient dust
  if (!eng.reducedMotion) {
    eng.add({
      z: 2,
      update(_dt, e) {
        if (Math.random() < 0.08) {
          particles.emit(
            (Math.random() - 0.5) * 900,
            (Math.random() - 0.5) * 600,
            1,
            { color: "#60a5fa", speed: 8, life: 2.5, size: 1.2, glow: true },
          );
        }
        // slight idle camera drift
        e.camera.targetX = Math.sin(e.time * 0.12) * 18;
        e.camera.targetY = Math.cos(e.time * 0.1) * 12;
      },
      draw() {},
    });
  }

  eng.onClickWorld = (p) => {
    let hit: string | null = null;
    for (const [id, n] of nodes) {
      n.hover = n.contains(p);
      if (n.hover) hit = id;
    }
    if (hit) {
      particles.burstSuccess(nodes.get(hit)!.pos);
      eng.camera.shake = 0.35;
      onSelect(selectedId === hit ? null : hit);
    } else {
      onSelect(null);
    }
  };

  // hover tracking via pointer
  eng.add({
    z: 1000,
    update() {
      for (const n of nodes.values()) {
        n.hover = n.contains(eng.pointerWorld);
      }
    },
    draw() {},
  });
}

export type ArchResource = {
  id: string;
  name: string;
  health: string;
  dependencies: string[];
  kind: string;
  configuration?: Record<string, unknown>;
  owner?: string;
  region?: string;
};

export function buildArchitectureScene(
  eng: GraphicsEngine,
  resources: ArchResource[],
  opts: {
    selectedId?: string | null;
    onlyUnhealthy?: boolean;
    spacious?: boolean;
    onSelect?: (id: string | null) => void;
  } = {},
) {
  eng.clear();
  eng.enablePanZoom = true;
  if (!opts.selectedId) {
    eng.camera.targetX = 0;
    eng.camera.targetY = 0;
    eng.camera.targetZoom = opts.spacious ? 0.95 : 1;
  }
  eng.add(new StarFieldLayer(opts.spacious ? 140 : 80, opts.spacious ? 1800 : 1200));
  const particles = new ParticleSystem();
  eng.add(particles);

  const KIND_LAYER: Record<string, number> = {
    global_account: 0,
    directory: 0,
    subaccount: 1,
    environment: 1,
    service_instance: 2,
    identity: 2,
    database: 2,
    application: 3,
    api: 3,
    destination: 4,
    integration_flow: 4,
    event_topic: 4,
    pipeline: 4,
    dashboard: 5,
  };

  const filtered = opts.onlyUnhealthy
    ? resources.filter(
        (r) =>
          r.health !== "healthy" ||
          r.dependencies.some(
            (d) => resources.find((x) => x.id === d)?.health !== "healthy",
          ),
      )
    : resources;

  const layers = new Map<number, ArchResource[]>();
  for (const r of filtered) {
    const L = KIND_LAYER[r.kind] ?? 3;
    const list = layers.get(L) ?? [];
    list.push(r);
    layers.set(L, list);
  }
  const keys = [...layers.keys()].sort((a, b) => a - b);
  const nodes = new Map<string, NodeSprite>();
  const spread = opts.spacious ? 1.45 : 1;
  const W = 560 * spread;
  const H = Math.max(300, keys.length * 100) * spread;
  const minSep = opts.spacious ? 120 : 96;
  const nodeR = opts.spacious ? 18 : 14;

  keys.forEach((layer, li) => {
    const row = layers.get(layer)!;
    const y = -H / 2 + 50 + (li / Math.max(keys.length - 1, 1)) * (H - 100);
    row.forEach((r, i) => {
      const x =
        row.length === 1
          ? 0
          : -W / 2 + 50 + (i / Math.max(row.length - 1, 1)) * (W - 100);
      const color = healthToColor(r.health);
      const selected = opts.selectedId === r.id;
      const n = new NodeSprite(
        v2(x, y),
        r.name.length > (opts.spacious ? 22 : 16)
          ? r.name.slice(0, opts.spacious ? 21 : 15) + "…"
          : r.name,
        r.kind.replace(/_/g, " "),
        color,
        selected ? nodeR + 4 : r.health === "healthy" ? nodeR : nodeR + 2,
        r.id,
      );
      n.hover = selected;
      nodes.set(r.id, n);
      eng.add(n);
      if (r.health !== "healthy" && !eng.reducedMotion) {
        particles.emit(x, y, 2, { color, speed: 12, life: 1.1, size: 1.4 });
      }
    });
  });

  for (let pass = 0; pass < 5; pass++) {
    const arr = [...nodes.values()];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i]!;
        const b = arr[j]!;
        if (Math.abs(a.pos.y - b.pos.y) > 28) continue;
        const dx = b.pos.x - a.pos.x;
        if (Math.abs(dx) < minSep) {
          const push = (minSep - Math.abs(dx)) / 2;
          const s = dx >= 0 ? 1 : -1;
          a.pos.x -= push * s;
          b.pos.x += push * s;
        }
      }
    }
  }

  const edges: { a: Vec2; b: Vec2; bad?: boolean; pulse?: number }[] = [];
  let ei = 0;
  const idSet = new Set(filtered.map((r) => r.id));
  for (const r of filtered) {
    for (const dep of r.dependencies) {
      if (!idSet.has(dep) && !nodes.has(dep)) continue;
      const a = nodes.get(r.id);
      const b = nodes.get(dep);
      if (!a || !b) continue;
      const bad =
        r.health !== "healthy" ||
        resources.find((x) => x.id === dep)?.health !== "healthy";
      edges.push({ a: a.pos, b: b.pos, bad, pulse: ei++ * 0.05 });
    }
  }
  eng.add(new LinkArcs(edges));

  // dim non-selected neighbors when a node is selected
  if (opts.selectedId) {
    const selected = resources.find((r) => r.id === opts.selectedId);
    const related = new Set<string>([opts.selectedId]);
    selected?.dependencies.forEach((d) => related.add(d));
    for (const r of resources) {
      if (r.dependencies.includes(opts.selectedId)) related.add(r.id);
    }
    eng.add({
      z: 15,
      draw(ctx) {
        for (const [id, n] of nodes) {
          if (!related.has(id)) {
            // fade by drawing overlay circle - NodeSprite always full; skip
            n.z = 12;
          } else {
            n.z = 25;
          }
        }
        void ctx;
      },
    });
    const sn = nodes.get(opts.selectedId);
    if (sn) eng.focusWorld(sn.pos.x, sn.pos.y, opts.spacious ? 1.35 : 1.2);
  }

  eng.add({
    z: 1,
    update(_dt, e) {
      if (!e.reducedMotion && Math.random() < 0.04) {
        const unhealthy = filtered.filter((r) => r.health !== "healthy");
        if (unhealthy.length) {
          const u = unhealthy[Math.floor(Math.random() * unhealthy.length)]!;
          const n = nodes.get(u.id);
          if (n)
            particles.emit(n.pos.x, n.pos.y, 2, {
              color: healthToColor(u.health),
              speed: 18,
              life: 0.75,
            });
        }
      }
      for (const n of nodes.values()) {
        n.hover = n.id === opts.selectedId || n.contains(e.pointerWorld);
      }
    },
    draw() {},
  });

  eng.onClickWorld = (p) => {
    let hit: string | null = null;
    for (const [id, n] of nodes) {
      if (n.contains(p)) {
        hit = id;
        particles.burstAlert(n.pos);
        eng.camera.shake = 0.2;
        eng.focusWorld(n.pos.x, n.pos.y, opts.spacious ? 1.4 : 1.25);
        break;
      }
    }
    opts.onSelect?.(hit);
  };
}

export function buildHeroScene(eng: GraphicsEngine) {
  eng.clear();
  eng.add(new StarFieldLayer(100, 1600));
  const particles = new ParticleSystem();
  eng.add(particles);
  eng.camera.targetZoom = 1;

  // floating orbs as drawables
  const orbs = [
    { p: v2(-120, -40), c: "#3b82f6", r: 40, s: 0.7 },
    { p: v2(140, 30), c: "#a78bfa", r: 28, s: 1.1 },
    { p: v2(20, 60), c: "#34d399", r: 18, s: 0.9 },
  ];
  eng.add({
    z: 10,
    update(dt) {
      if (eng.reducedMotion) return;
      for (const o of orbs) {
        o.p.y += Math.sin(eng.time * o.s) * dt * 6;
      }
      if (Math.random() < 0.1) {
        particles.emit((Math.random() - 0.5) * 400, (Math.random() - 0.5) * 200, 2, {
          color: "#60a5fa",
          speed: 12,
          life: 2,
          size: 1.4,
        });
      }
    },
    draw(ctx) {
      for (const o of orbs) {
        const g = ctx.createRadialGradient(o.p.x, o.p.y, 2, o.p.x, o.p.y, o.r);
        g.addColorStop(0, o.c);
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(o.p.x, o.p.y, o.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // title plate is HTML; draw subtle ring
      ctx.strokeStyle = "rgba(125,211,252,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 70 + Math.sin(eng.time) * 4, 0, Math.PI * 2);
      ctx.stroke();
    },
  });
}

// silence unused Camera import warning by re-export pattern
export type { Camera };
