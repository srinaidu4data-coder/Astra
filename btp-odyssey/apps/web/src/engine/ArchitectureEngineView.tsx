import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ArchitectureGraph } from "../Visuals";
import { GraphicsCanvas } from "./GraphicsCanvas";
import type { GraphicsEngine } from "./core";
import { buildArchitectureScene, type ArchResource } from "./scenes";

type Res = ArchResource;

function GraphStage({
  resources,
  selectedId,
  onlyUnhealthy,
  spacious,
  height,
  onSelect,
  engRef,
}: {
  resources: Res[];
  selectedId: string | null;
  onlyUnhealthy: boolean;
  spacious: boolean;
  height: number | string;
  onSelect: (id: string | null) => void;
  engRef?: MutableRefObject<GraphicsEngine | null>;
}) {
  const key = `${resources.map((r) => `${r.id}:${r.health}`).join("|")}|${onlyUnhealthy}|${selectedId ?? ""}|${spacious}`;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  return (
    <GraphicsCanvas
      key={key}
      height={height}
      onReady={(eng) => {
        if (engRef) engRef.current = eng;
        buildArchitectureScene(eng, resources, {
          selectedId,
          onlyUnhealthy,
          spacious,
          onSelect: (id) => onSelectRef.current(id),
        });
      }}
    />
  );
}

export function ArchitectureEngineView({ resources }: { resources: Res[] }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlyUnhealthy, setOnlyUnhealthy] = useState(false);
  const engRef = useRef<GraphicsEngine | null>(null);

  const selected = useMemo(
    () => resources.find((r) => r.id === selectedId) ?? null,
    [resources, selectedId],
  );

  const unhealthyCount = resources.filter((r) => r.health !== "healthy").length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Prevent body scroll when modal open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <div className="arch-preview">
        <div className="arch-preview-toolbar">
          <span className="muted" style={{ fontSize: "0.75rem" }}>
            {resources.length} nodes · {unhealthyCount} unhealthy
          </span>
          <button type="button" className="btn primary" onClick={() => setOpen(true)}>
            Expand graph
          </button>
        </div>
        <div className="gfx-arch-wrap arch-preview-canvas" onClick={() => setOpen(true)} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(true); }}
          aria-label="Open architecture graph fullscreen"
        >
          <GraphStage
            resources={resources}
            selectedId={null}
            onlyUnhealthy={false}
            spacious={false}
            height={220}
            onSelect={() => setOpen(true)}
          />
          <div className="gfx-badge">Click to expand</div>
          <div className="gfx-caption">Preview · open analyzer for pan/zoom + inspector</div>
        </div>
      </div>

      {open && (
        <div className="graph-modal" role="dialog" aria-modal="true" aria-label="Architecture analyzer">
          <div className="graph-modal-backdrop" onClick={() => setOpen(false)} />
          <div
            className="graph-modal-panel"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <header className="graph-modal-header">
              <div>
                <p className="hero-kicker" style={{ margin: 0 }}>
                  Architecture analyzer
                </p>
                <h2 style={{ margin: "0.15rem 0 0", fontSize: "1.2rem" }}>
                  Landscape topology
                </h2>
              </div>
              <div className="graph-modal-actions">
                <button
                  type="button"
                  className={`btn${onlyUnhealthy ? " violet" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOnlyUnhealthy((v) => !v);
                  }}
                >
                  {onlyUnhealthy ? "Show all" : "Unhealthy paths"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    engRef.current?.zoomBy(1.15);
                  }}
                >
                  Zoom +
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    engRef.current?.zoomBy(0.87);
                  }}
                >
                  Zoom −
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(null);
                    engRef.current?.resetView();
                  }}
                >
                  Reset view
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                  }}
                >
                  Close
                </button>
              </div>
            </header>

            <div className="graph-modal-body">
              <aside className="graph-side">
                <h3>Resources</h3>
                <p className="muted" style={{ fontSize: "0.78rem" }}>
                  Select a node to inspect. Drag canvas to pan · wheel to zoom.
                </p>
                <ul className="graph-res-list">
                  {resources.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={`graph-res-item health-${r.health}${selectedId === r.id ? " selected" : ""}`}
                        onClick={() => {
                          setSelectedId(r.id);
                          const eng = engRef.current;
                          if (eng) {
                            buildArchitectureScene(eng, resources, {
                              selectedId: r.id,
                              onlyUnhealthy,
                              spacious: true,
                              onSelect: setSelectedId,
                            });
                          }
                        }}
                      >
                        <span className={`health-dot ${r.health}`} />
                        <span>
                          <strong>{r.name}</strong>
                          <em>
                            {r.kind.replace(/_/g, " ")}
                            {r.region ? ` · ${r.region}` : ""}
                          </em>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                {selected && (
                  <div className="graph-inspector">
                    <h4>Inspector</h4>
                    <dl>
                      <dt>Name</dt>
                      <dd>{selected.name}</dd>
                      <dt>Kind</dt>
                      <dd>{selected.kind}</dd>
                      <dt>Health</dt>
                      <dd className={`health ${selected.health}`}>{selected.health}</dd>
                      {selected.owner && (
                        <>
                          <dt>Owner</dt>
                          <dd>{selected.owner}</dd>
                        </>
                      )}
                      {selected.region && (
                        <>
                          <dt>Region</dt>
                          <dd>{selected.region}</dd>
                        </>
                      )}
                      <dt>Dependencies</dt>
                      <dd>
                        {selected.dependencies.length
                          ? selected.dependencies.join(", ")
                          : "—"}
                      </dd>
                      <dt>Dependents</dt>
                      <dd>
                        {resources
                          .filter((r) => r.dependencies.includes(selected.id))
                          .map((r) => r.name)
                          .join(", ") || "—"}
                      </dd>
                    </dl>
                    {selected.configuration &&
                      Object.keys(selected.configuration).length > 0 && (
                        <>
                          <h4>Configuration</h4>
                          <pre className="graph-config">
                            {JSON.stringify(selected.configuration, null, 2)}
                          </pre>
                        </>
                      )}
                  </div>
                )}
              </aside>

              <div className="graph-main">
                <GraphStage
                  resources={resources}
                  selectedId={selectedId}
                  onlyUnhealthy={onlyUnhealthy}
                  spacious
                  height="100%"
                  engRef={engRef}
                  onSelect={setSelectedId}
                />
                <div className="graph-legend-bar">
                  <span>
                    <i className="health-dot healthy" /> healthy
                  </span>
                  <span>
                    <i className="health-dot degraded" /> degraded
                  </span>
                  <span>
                    <i className="health-dot down" /> down
                  </span>
                  <span className="muted">Drag to pan · scroll to zoom · Esc to close</span>
                </div>
              </div>
            </div>

            <details className="graph-a11y">
              <summary>Accessible table fallback</summary>
              <ArchitectureGraph resources={resources} />
            </details>
          </div>
        </div>
      )}
    </>
  );
}
