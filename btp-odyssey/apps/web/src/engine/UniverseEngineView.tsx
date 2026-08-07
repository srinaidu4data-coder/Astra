import { useEffect, useRef } from "react";
import { GraphicsCanvas } from "./GraphicsCanvas";
import type { GraphicsEngine } from "./core";
import { buildUniverseScene, type UniverseNode } from "./scenes";

export function UniverseEngineView({
  domains,
  selectedId,
  onSelect,
}: {
  domains: UniverseNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const engRef = useRef<GraphicsEngine | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const eng = engRef.current;
    if (!eng || domains.length === 0) return;
    buildUniverseScene(eng, domains, selectedId, (id) => onSelectRef.current(id));
  }, [domains, selectedId]);

  return (
    <div className="gfx-universe-wrap">
      <GraphicsCanvas
        height="min(520px, 70vh)"
        className="gfx-universe-wrap"
        onReady={(eng) => {
          engRef.current = eng;
          if (domains.length) {
            buildUniverseScene(eng, domains, selectedId, (id) => onSelectRef.current(id));
          }
        }}
      />
      <div className="gfx-badge">Universe realtime</div>
      <div className="gfx-caption">
        Click districts · animated data packets · starfield ·{" "}
        {selectedId ? `filter: ${selectedId}` : "all districts"}
      </div>
    </div>
  );
}
