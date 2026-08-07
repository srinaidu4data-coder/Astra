/**
 * Odyssey Graphics Engine — lightweight real-time 2D engine.
 * Canvas-based: scenes, layers, camera, particles, post-process glow.
 * Respects prefers-reduced-motion / data-reduced-motion.
 */

export type Vec2 = { x: number; y: number };

export function v2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function dist(a: Vec2, b: Vec2) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  dpr?: number;
  background?: string;
  reducedMotion?: boolean;
}

export interface Drawable {
  z?: number;
  visible?: boolean;
  update?(dt: number, eng: GraphicsEngine): void;
  draw(ctx: CanvasRenderingContext2D, eng: GraphicsEngine): void;
  dispose?(): void;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  targetX = 0;
  targetY = 0;
  targetZoom = 1;
  shake = 0;

  follow(dt: number, smooth = 6) {
    const t = 1 - Math.exp(-smooth * dt);
    this.x = lerp(this.x, this.targetX, t);
    this.y = lerp(this.y, this.targetY, t);
    this.zoom = lerp(this.zoom, this.targetZoom, t);
    this.shake = Math.max(0, this.shake - dt * 8);
  }

  apply(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 6 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 6 : 0;
    ctx.setTransform(this.zoom, 0, 0, this.zoom, w / 2 - this.x * this.zoom + sx, h / 2 - this.y * this.zoom + sy);
  }

  screenToWorld(sx: number, sy: number, w: number, h: number): Vec2 {
    return {
      x: (sx - w / 2) / this.zoom + this.x,
      y: (sy - h / 2) / this.zoom + this.y,
    };
  }
}

export class GraphicsEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr: number;
  width = 0;
  height = 0;
  camera = new Camera();
  objects: Drawable[] = [];
  running = false;
  last = 0;
  time = 0;
  reducedMotion: boolean;
  background: string;
  private raf = 0;
  private glowCanvas: HTMLCanvasElement | null = null;
  enableGlow = true;
  pointer: Vec2 = { x: 0, y: 0 };
  pointerWorld: Vec2 = { x: 0, y: 0 };
  onClickWorld?: (p: Vec2) => void;
  enablePanZoom = true;
  private dragging = false;
  private lastDrag: Vec2 = { x: 0, y: 0 };
  private dragStart: Vec2 = { x: 0, y: 0 };
  private unbindInput: (() => void) | null = null;

  constructor(opts: EngineOptions) {
    this.canvas = opts.canvas;
    const ctx = this.canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
    this.reducedMotion =
      opts.reducedMotion ??
      (document.documentElement.dataset.reducedMotion === "true" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.background = opts.background ?? "#050814";
    this.resize();
    this.bindInput();
  }

  private bindInput() {
    const move = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointerWorld = this.camera.screenToWorld(
        this.pointer.x,
        this.pointer.y,
        this.width,
        this.height,
      );
      if (this.dragging && this.enablePanZoom) {
        const dx = this.pointer.x - this.lastDrag.x;
        const dy = this.pointer.y - this.lastDrag.y;
        this.lastDrag = { x: this.pointer.x, y: this.pointer.y };
        this.camera.targetX -= dx / this.camera.zoom;
        this.camera.targetY -= dy / this.camera.zoom;
        this.camera.x = this.camera.targetX;
        this.camera.y = this.camera.targetY;
      }
    };
    const down = (e: PointerEvent) => {
      move(e);
      if (e.button === 0 || e.pointerType === "touch") {
        this.dragging = true;
        this.lastDrag = { x: this.pointer.x, y: this.pointer.y };
        this.dragStart = { x: this.pointer.x, y: this.pointer.y };
        this.canvas.setPointerCapture(e.pointerId);
      }
    };
    const up = (e: PointerEvent) => {
      move(e);
      const wasDrag =
        Math.hypot(this.pointer.x - this.dragStart.x, this.pointer.y - this.dragStart.y) > 6;
      this.dragging = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!wasDrag) this.onClickWorld?.(this.pointerWorld);
    };
    const wheel = (e: WheelEvent) => {
      if (!this.enablePanZoom) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      this.camera.targetZoom = clamp(this.camera.targetZoom * factor, 0.45, 2.8);
      this.camera.zoom = this.camera.targetZoom;
    };
    this.canvas.addEventListener("pointermove", move);
    this.canvas.addEventListener("pointerdown", down);
    this.canvas.addEventListener("pointerup", up);
    this.canvas.addEventListener("pointercancel", up);
    this.canvas.addEventListener("wheel", wheel, { passive: false });
    this.unbindInput = () => {
      this.canvas.removeEventListener("pointermove", move);
      this.canvas.removeEventListener("pointerdown", down);
      this.canvas.removeEventListener("pointerup", up);
      this.canvas.removeEventListener("pointercancel", up);
      this.canvas.removeEventListener("wheel", wheel);
    };
  }

  zoomBy(factor: number) {
    this.camera.targetZoom = clamp(this.camera.targetZoom * factor, 0.45, 2.8);
    this.camera.zoom = this.camera.targetZoom;
  }

  resetView() {
    this.camera.targetX = 0;
    this.camera.targetY = 0;
    this.camera.targetZoom = 1;
    this.camera.x = 0;
    this.camera.y = 0;
    this.camera.zoom = 1;
  }

  focusWorld(x: number, y: number, zoom = 1.25) {
    this.camera.targetX = x;
    this.camera.targetY = y;
    this.camera.targetZoom = clamp(zoom, 0.45, 2.8);
    if (this.reducedMotion) {
      this.camera.x = x;
      this.camera.y = y;
      this.camera.zoom = this.camera.targetZoom;
    }
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || this.canvas.clientWidth || 800;
    const h = parent?.clientHeight || this.canvas.clientHeight || 420;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (this.enableGlow && !this.reducedMotion) {
      if (!this.glowCanvas) {
        this.glowCanvas = document.createElement("canvas");
      }
      this.glowCanvas.width = Math.floor(w * this.dpr);
      this.glowCanvas.height = Math.floor(h * this.dpr);
    }
  }

  add(obj: Drawable) {
    this.objects.push(obj);
    this.objects.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    return obj;
  }

  clear() {
    for (const o of this.objects) o.dispose?.();
    this.objects = [];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.time += dt;
      this.tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.clear();
    this.unbindInput?.();
    this.unbindInput = null;
  }

  private tick(dt: number) {
    if (!this.reducedMotion) this.camera.follow(dt);
    else {
      this.camera.x = this.camera.targetX;
      this.camera.y = this.camera.targetY;
      this.camera.zoom = this.camera.targetZoom;
    }

    for (const o of this.objects) {
      if (o.visible === false) continue;
      o.update?.(this.reducedMotion ? 0 : dt, this);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    // deep space background
    const g = ctx.createRadialGradient(
      this.width * 0.3,
      this.height * 0.2,
      0,
      this.width * 0.5,
      this.height * 0.5,
      Math.max(this.width, this.height),
    );
    g.addColorStop(0, "#0b1a3a");
    g.addColorStop(0.45, this.background);
    g.addColorStop(1, "#02040a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);

    // nebula accents
    if (!this.reducedMotion) {
      ctx.globalAlpha = 0.35;
      const n1 = ctx.createRadialGradient(
        this.width * 0.15 + Math.sin(this.time * 0.2) * 20,
        this.height * 0.25,
        10,
        this.width * 0.15,
        this.height * 0.25,
        this.width * 0.35,
      );
      n1.addColorStop(0, "rgba(59,130,246,0.35)");
      n1.addColorStop(1, "transparent");
      ctx.fillStyle = n1;
      ctx.fillRect(0, 0, this.width, this.height);

      const n2 = ctx.createRadialGradient(
        this.width * 0.85,
        this.height * 0.7 + Math.cos(this.time * 0.15) * 15,
        10,
        this.width * 0.85,
        this.height * 0.7,
        this.width * 0.3,
      );
      n2.addColorStop(0, "rgba(167,139,250,0.28)");
      n2.addColorStop(1, "transparent");
      ctx.fillStyle = n2;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }

    ctx.save();
    this.camera.apply(ctx, this.width, this.height);
    for (const o of this.objects) {
      if (o.visible === false) continue;
      o.draw(ctx, this);
    }
    ctx.restore();

    // subtle vignette
    const vig = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.25,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.7,
    );
    vig.addColorStop(0, "transparent");
    vig.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }
}
