import type { CSSProperties } from "react";
import { DISTRICT_LAYOUT, MAP_EDGES } from "./districtLayout";

export function Starfield({ count = 60 }: { count?: number }) {
  const stars = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${(i * 47) % 100}%`,
    top: `${(i * 31) % 100}%`,
    d: `${3 + (i % 5)}s`,
    delay: `${(i % 10) * 0.2}s`,
    size: i % 5 === 0 ? 2.5 : 1.5,
  }));
  return (
    <div className="stars" aria-hidden>
      {stars.map((s) => (
        <span
          key={s.id}
          className="star"
          style={
            {
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              "--d": s.d,
              animationDelay: s.delay,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function UniverseMap({
  domains,
  selectedId,
  completedDomainIds,
  onSelect,
}: {
  domains: { id: string; districtName: string; title: string }[];
  selectedId: string | null;
  completedDomainIds: Set<string>;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="universe" role="img" aria-label="Interactive universe map of learning districts">
      {/* decorative game terrain layers injected via CSS :: optional sibling from parent */}
      <div className="game-map-decor" aria-hidden>
        <div className="terrain t1" />
        <div className="terrain t2" />
        <div className="terrain t3" />
        <div className="fog" />
      </div>
      <svg className="map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {MAP_EDGES.map(([a, b]) => {
          const A = DISTRICT_LAYOUT[a];
          const B = DISTRICT_LAYOUT[b];
          if (!A || !B) return null;
          const active = selectedId === a || selectedId === b;
          return (
            <line
              key={`${a}-${b}`}
              className={`map-edge${active ? " active" : ""}`}
              x1={A.x}
              y1={A.y}
              x2={B.x}
              y2={B.y}
            />
          );
        })}
      </svg>
      {domains.map((d) => {
        const layout = DISTRICT_LAYOUT[d.id] ?? {
          x: 50,
          y: 50,
          hue: 200,
          glyph: "•",
        };
        const selected = selectedId === d.id;
        const progress = completedDomainIds.has(d.id);
        return (
          <button
            key={d.id}
            type="button"
            className={`district-node${selected ? " selected" : ""}${progress ? " has-progress" : ""}`}
            style={
              {
                left: `${layout.x}%`,
                top: `${layout.y}%`,
                "--h": layout.hue,
              } as CSSProperties
            }
            onClick={() => onSelect(selected ? null : d.id)}
            aria-pressed={selected}
            title={d.title}
          >
            <span className="glyph">{layout.glyph}</span>
            <span className="dot" />
            <span className="district-tooltip">{d.districtName}</span>
          </button>
        );
      })}
      <div className="map-legend">Click a district · edges = learning adjacency</div>
    </div>
  );
}

const KIND_LAYER: Record<string, number> = {
  global_account: 0,
  directory: 0,
  subaccount: 1,
  environment: 1,
  service_instance: 2,
  identity: 2,
  role_collection: 2,
  database: 2,
  application: 3,
  api: 3,
  destination: 4,
  integration_flow: 4,
  event_topic: 4,
  workflow: 4,
  pipeline: 4,
  dashboard: 5,
  deployment: 5,
  certificate: 5,
};

function shortLabel(name: string, max = 16): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + "…";
}

function healthColor(health: string): string {
  if (health === "healthy") return "#34d399";
  if (health === "degraded") return "#fbbf24";
  if (health === "down") return "#fb7185";
  return "#94a3b8";
}

/** Layered architecture layout — no overlapping labels. */
export function ArchitectureGraph({
  resources,
}: {
  resources: {
    id: string;
    name: string;
    health: string;
    dependencies: string[];
    kind: string;
  }[];
}) {
  const n = resources.length;
  if (!n) return <p className="muted">No resources loaded.</p>;

  // Group by layer
  const layers = new Map<number, typeof resources>();
  for (const r of resources) {
    const layer = KIND_LAYER[r.kind] ?? 3;
    const list = layers.get(layer) ?? [];
    list.push(r);
    layers.set(layer, list);
  }
  const layerKeys = [...layers.keys()].sort((a, b) => a - b);
  const layerCount = Math.max(layerKeys.length, 1);

  // ViewBox in px-ish units for readable labels
  const W = 360;
  const H = Math.max(280, 56 + layerCount * 72);
  const padX = 28;
  const padY = 36;
  const usableW = W - padX * 2;
  const usableH = H - padY * 2;

  type Pos = {
    id: string;
    x: number;
    y: number;
    r: (typeof resources)[0];
    labelSide: "bottom" | "top";
  };

  const positions: Pos[] = [];
  layerKeys.forEach((layer, li) => {
    const row = layers.get(layer)!;
    const y =
      layerCount === 1
        ? H / 2
        : padY + (li / Math.max(layerCount - 1, 1)) * usableH;
    row.forEach((r, i) => {
      const x =
        row.length === 1
          ? W / 2
          : padX + (i / Math.max(row.length - 1, 1)) * usableW;
      positions.push({
        id: r.id,
        x,
        y,
        r,
        labelSide: li === 0 ? "top" : "bottom",
      });
    });
  });

  // Mild horizontal jitter separation if two nodes too close on same row
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        if (Math.abs(a.y - b.y) > 8) continue;
        const dx = b.x - a.x;
        const minDist = 72;
        if (Math.abs(dx) < minDist && Math.abs(dx) > 0.01) {
          const push = ((minDist - Math.abs(dx)) / 2) * (dx > 0 ? 1 : -1);
          a.x = Math.max(padX, Math.min(W - padX, a.x - push));
          b.x = Math.max(padX, Math.min(W - padX, b.x + push));
        } else if (Math.abs(dx) < 0.01) {
          a.x = Math.max(padX, a.x - minDist / 2);
          b.x = Math.min(W - padX, b.x + minDist / 2);
        }
      }
    }
  }

  const byId = new Map(positions.map((p) => [p.id, p]));
  const degraded = resources.filter((r) => r.health !== "healthy").length;

  return (
    <div className="arch-wrap">
      <svg
        className="arch-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Architecture dependency graph"
      >
        <defs>
          <marker
            id="arch-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="rgba(125,180,255,0.45)" />
          </marker>
          <marker
            id="arch-arrow-bad"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="rgba(251,113,133,0.7)" />
          </marker>
        </defs>

        {/* Layer guide lines */}
        {layerKeys.map((layer, li) => {
          const y =
            layerCount === 1
              ? H / 2
              : padY + (li / Math.max(layerCount - 1, 1)) * usableH;
          return (
            <line
              key={`guide-${layer}`}
              x1={padX - 8}
              y1={y}
              x2={W - padX + 8}
              y2={y}
              stroke="rgba(148,163,184,0.08)"
              strokeDasharray="4 6"
            />
          );
        })}

        {/* Edges — curved to reduce collisions */}
        {resources.flatMap((r) =>
          r.dependencies.map((dep) => {
            const a = byId.get(r.id);
            const b = byId.get(dep);
            if (!a || !b) return null;
            const bad =
              r.health !== "healthy" ||
              resources.find((x) => x.id === dep)?.health !== "healthy";
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - 12;
            const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
            return (
              <path
                key={`${r.id}-${dep}`}
                className={`link${bad ? " bad" : ""}`}
                d={d}
                fill="none"
                markerEnd={bad ? "url(#arch-arrow-bad)" : "url(#arch-arrow)"}
              />
            );
          }),
        )}

        {/* Nodes + labels */}
        {positions.map((p) => {
          const fill = healthColor(p.r.health);
          const labelY = p.labelSide === "top" ? p.y - 16 : p.y + 20;
          const kindY = p.labelSide === "top" ? p.y - 28 : p.y + 32;
          return (
            <g key={p.id} className="arch-node">
              {/* Halo for degraded */}
              {p.r.health !== "healthy" && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={14}
                  fill="none"
                  stroke={fill}
                  strokeOpacity={0.35}
                  strokeWidth={2}
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={9}
                fill={fill}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1.5}
              >
                <title>
                  {p.r.name} · {p.r.kind} · {p.r.health}
                  {p.r.dependencies.length
                    ? `\nDepends on: ${p.r.dependencies.join(", ")}`
                    : ""}
                </title>
              </circle>
              <text
                className="node-label"
                x={p.x}
                y={labelY}
                textAnchor="middle"
              >
                {shortLabel(p.r.name, 18)}
              </text>
              <text
                className="node-kind"
                x={p.x}
                y={kindY}
                textAnchor="middle"
              >
                {p.r.kind.replace(/_/g, " ")}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="arch-legend" aria-hidden>
        <span>
          <i style={{ background: "#34d399" }} /> healthy
        </span>
        <span>
          <i style={{ background: "#fbbf24" }} /> degraded
        </span>
        <span>
          <i style={{ background: "#fb7185" }} /> down
        </span>
        <span className="muted">
          {resources.length} nodes · {degraded} unhealthy · hover for full name
        </span>
      </div>
    </div>
  );
}

export function CompetencyConstellation({
  order,
  competencies,
  demonstrated,
}: {
  order: string[];
  competencies: { id: string; title: string; level: string }[];
  demonstrated: Set<string>;
}) {
  const items = order
    .map((id, i) => {
      const c = competencies.find((x) => x.id === id);
      if (!c) return null;
      const col = i % 8;
      const row = Math.floor(i / 8);
      return {
        ...c,
        x: 8 + col * 12,
        y: 12 + row * 18,
        done: demonstrated.has(id),
      };
    })
    .filter(Boolean) as {
    id: string;
    title: string;
    level: string;
    x: number;
    y: number;
    done: boolean;
  }[];

  return (
    <div className="constellation-wrap">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {items.map((a, i) => {
          const b = items[i + 1];
          if (!b || Math.abs(a.y - b.y) > 1) return null;
          return (
            <line
              key={`e-${a.id}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={a.done && b.done ? "rgba(52,211,153,0.35)" : "rgba(125,180,255,0.12)"}
              strokeWidth="0.4"
            />
          );
        })}
        {items.map((c) => (
          <g key={c.id}>
            <circle
              cx={c.x}
              cy={c.y}
              r={c.done ? 2.2 : 1.6}
              fill={c.done ? "#34d399" : c.level === "expert" ? "#f472b6" : c.level === "advanced" ? "#fbbf24" : "#60a5fa"}
              opacity={c.done ? 1 : 0.55}
            >
              <title>
                {c.title} ({c.level})
              </title>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}
