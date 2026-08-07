import type { Drawable, GraphicsEngine, Vec2 } from "./core";
import { v2 } from "./core";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  glow?: boolean;
}

export class ParticleSystem implements Drawable {
  z = 50;
  particles: Particle[] = [];
  private pool: Particle[] = [];

  emit(
    x: number,
    y: number,
    count: number,
    opts: {
      color?: string;
      speed?: number;
      life?: number;
      size?: number;
      glow?: boolean;
      spread?: number;
    } = {},
  ) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 40) * (0.3 + Math.random());
      const p = this.pool.pop() ?? ({} as Particle);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp * (opts.spread ?? 1);
      p.vy = Math.sin(a) * sp * (opts.spread ?? 1);
      p.life = opts.life ?? 0.6 + Math.random() * 0.5;
      p.maxLife = p.life;
      p.size = (opts.size ?? 2) * (0.5 + Math.random());
      p.color = opts.color ?? "#7dd3fc";
      p.glow = opts.glow ?? true;
      this.particles.push(p);
    }
  }

  burstSuccess(at: Vec2) {
    this.emit(at.x, at.y, 24, { color: "#34d399", speed: 90, life: 0.7, size: 3 });
    this.emit(at.x, at.y, 12, { color: "#a7f3d0", speed: 50, life: 0.9, size: 2 });
  }

  burstAlert(at: Vec2) {
    this.emit(at.x, at.y, 18, { color: "#fbbf24", speed: 70, life: 0.55, size: 2.5 });
    this.emit(at.x, at.y, 10, { color: "#fb7185", speed: 40, life: 0.7, size: 2 });
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        this.pool.push(p);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, t);
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + t * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
}

export class StarFieldLayer implements Drawable {
  z = -100;
  stars: { x: number; y: number; r: number; phase: number; speed: number }[] = [];

  constructor(count = 120, span = 2000) {
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: (Math.random() - 0.5) * span,
        y: (Math.random() - 0.5) * span,
        r: Math.random() * 1.6 + 0.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 2,
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, eng: GraphicsEngine) {
    for (const s of this.stars) {
      const tw = eng.reducedMotion
        ? 0.55
        : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(eng.time * s.speed + s.phase));
      ctx.globalAlpha = tw;
      ctx.fillStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

export class LinkArcs implements Drawable {
  z = 5;
  constructor(
    public edges: { a: Vec2; b: Vec2; bad?: boolean; pulse?: number }[],
  ) {}

  draw(ctx: CanvasRenderingContext2D, eng: GraphicsEngine) {
    for (const e of this.edges) {
      const mx = (e.a.x + e.b.x) / 2;
      const my = (e.a.y + e.b.y) / 2 - 40;
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.quadraticCurveTo(mx, my, e.b.x, e.b.y);
      ctx.strokeStyle = e.bad ? "rgba(251,113,133,0.55)" : "rgba(125,211,252,0.28)";
      ctx.lineWidth = e.bad ? 2.2 : 1.4;
      ctx.stroke();

      // traveling packet
      if (!eng.reducedMotion) {
        const t = ((eng.time * 0.35 + (e.pulse ?? 0)) % 1);
        const it = 1 - t;
        const px = it * it * e.a.x + 2 * it * t * mx + t * t * e.b.x;
        const py = it * it * e.a.y + 2 * it * t * my + t * t * e.b.y;
        ctx.fillStyle = e.bad ? "#fb7185" : "#7dd3fc";
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }
}

export class NodeSprite implements Drawable {
  z = 20;
  hover = false;
  pulse = Math.random() * Math.PI * 2;

  constructor(
    public pos: Vec2,
    public label: string,
    public sub: string,
    public color: string,
    public radius = 18,
    public id = "",
  ) {}

  contains(p: Vec2) {
    return Math.hypot(p.x - this.pos.x, p.y - this.pos.y) <= this.radius + 8;
  }

  draw(ctx: CanvasRenderingContext2D, eng: GraphicsEngine) {
    const breathe = eng.reducedMotion
      ? 0
      : Math.sin(eng.time * 2 + this.pulse) * 2;
    const r = this.radius + breathe + (this.hover ? 4 : 0);

    // outer glow ring
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, r + 10, 0, Math.PI * 2);
    const glow = ctx.createRadialGradient(
      this.pos.x,
      this.pos.y,
      r * 0.2,
      this.pos.x,
      this.pos.y,
      r + 14,
    );
    glow.addColorStop(0, this.color + "66");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fill();

    // core
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, r, 0, Math.PI * 2);
    const core = ctx.createRadialGradient(
      this.pos.x - r * 0.3,
      this.pos.y - r * 0.3,
      2,
      this.pos.x,
      this.pos.y,
      r,
    );
    core.addColorStop(0, "#ffffff");
    core.addColorStop(0.15, this.color);
    core.addColorStop(1, "#0b1220");
    ctx.fillStyle = core;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();

    // label plate
    ctx.font = "600 12px Outfit, system-ui, sans-serif";
    const tw = ctx.measureText(this.label).width;
    const px = this.pos.x;
    const py = this.pos.y + r + 18;
    const pad = 8;
    ctx.fillStyle = "rgba(5,8,20,0.82)";
    ctx.strokeStyle = "rgba(125,180,255,0.25)";
    ctx.lineWidth = 1;
    roundRect(ctx, px - tw / 2 - pad, py - 11, tw + pad * 2, 22, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e8eef9";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.label, px, py);

    if (this.sub) {
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillStyle = "#93a4c3";
      ctx.fillText(this.sub, px, py + 16);
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function healthToColor(h: string) {
  if (h === "healthy") return "#34d399";
  if (h === "degraded") return "#fbbf24";
  if (h === "down") return "#fb7185";
  return "#94a3b8";
}

export { v2 };
