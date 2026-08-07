import { useEffect, useRef } from "react";
import { GraphicsEngine } from "./core";

export function GraphicsCanvas({
  className,
  height = 420,
  onReady,
  onResize,
}: {
  className?: string;
  height?: number | string;
  onReady?: (eng: GraphicsEngine) => void;
  onResize?: (eng: GraphicsEngine) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const engRef = useRef<GraphicsEngine | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const eng = new GraphicsEngine({ canvas });
    engRef.current = eng;
    eng.start();
    onReady?.(eng);

    const ro = new ResizeObserver(() => {
      eng.resize();
      onResize?.(eng);
    });
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    return () => {
      ro.disconnect();
      eng.dispose();
      engRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`gfx-host ${className ?? ""}`} style={{ height, width: "100%", position: "relative" }}>
      <canvas ref={ref} className="gfx-canvas" />
    </div>
  );
}
