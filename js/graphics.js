/**
 * OREGON TRAIL - 1847
 * Procedural canvas graphics. No image files: every pixel is drawn in code.
 *
 * The scene is driven by a small view snapshot supplied by the interface:
 * mileage, turn, prompt type, weather and outcome.
 */

const LANDMARKS = [
  { at: 0, name: 'INDEPENDENCE' },
  { at: 320, name: 'FORT KEARNY' },
  { at: 700, name: 'CHIMNEY ROCK' },
  { at: 950, name: 'FORT LARAMIE' },
  { at: 1150, name: 'SOUTH PASS' },
  { at: 1500, name: 'FORT HALL' },
  { at: 1700, name: 'BLUE MOUNTAINS' },
  { at: 2040, name: 'OREGON CITY' },
];

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function poly(ctx, points, fill) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function makeRidge(width, height, seed, roughness) {
  const points = [];
  const steps = 14;
  for (let i = 0; i <= steps; i += 1) {
    const x = (i / steps) * width;
    const wave = Math.sin(i * 1.7 + seed) * 0.5 + Math.sin(i * 0.6 + seed * 2.3) * 0.5;
    const y = height - height * (0.35 + 0.4 * (0.5 + wave * 0.5)) * roughness;
    points.push([x, y]);
  }
  points.push([width, height]);
  points.push([0, height]);
  return points;
}

export class TrailScene {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = {
      mode: 'title',
      mileage: 0,
      turn: 0,
      weather: 'clear',
      outcome: null,
      deathCause: null,
      promptType: null,
      context: null,
      food: 0,
      oxen: 250,
    };
    this.frame = 0;
    this.running = false;
    this.reducedMotion = reducedMotion;
    this.dust = [];
    this.flakes = [];
    this.ripples = [];
    this.width = 320;
    this.height = 200;

    this.handleResize = this.handleResize.bind(this);
    this.tick = this.tick.bind(this);
    window.addEventListener('resize', this.handleResize);
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(this.handleResize);
      this.observer.observe(canvas.parentElement || canvas);
    }
    this.handleResize();
  }

  setView(patch) {
    Object.assign(this.view, patch);
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
  }

  handleResize() {
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(240, Math.round(rect.width));
    this.height = Math.max(160, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dust = [];
    this.flakes = [];
    this.drawOnce();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  tick(now) {
    if (!this.running) return;
    const delta = Math.min(48, now - (this.last || now));
    this.last = now;
    if (!this.reducedMotion) this.frame += delta / 1000;
    this.updateParticles(delta);
    this.drawOnce();
    this.frameId = requestAnimationFrame(this.tick);
  }

  drawOnce() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const view = this.view;
    const scenery = this.skyFor(view);
    const horizon = Math.round(h * 0.52);

    ctx.clearRect(0, 0, w, h);
    this.drawSky(ctx, w, h, scenery);

    const region = view.mileage < 950 ? 'plains' : view.mileage < 1700 ? 'mountains' : 'forest';
    this.drawRidges(ctx, w, horizon, region, scenery);
    this.drawGround(ctx, w, h, horizon, region, scenery);
    this.drawTrail(ctx, w, h, horizon);

    const mode = this.effectiveMode();
    if (mode === 'gone') this.drawGrave(ctx, w, horizon);
    if (mode === 'win') this.drawOregonCity(ctx, w, horizon);
    if (mode === 'fort') this.drawFort(ctx, w, horizon);
    if (mode === 'camp') this.drawCamp(ctx, w, horizon);
    if (mode === 'hunt') this.drawHunt(ctx, w, horizon);
    if (mode === 'riders' || mode === 'attack') this.drawRiders(ctx, w, horizon);
    if (mode === 'river') this.drawRiver(ctx, w, horizon);
    if (mode !== 'gone' && mode !== 'hunt') this.drawWagon(ctx, w, horizon, mode);

    this.drawWeather(ctx, w, h);
    this.drawVignette(ctx, w, h);
    this.drawMap(ctx, w, h);
  }

  effectiveMode() {
    const view = this.view;
    const type = view.promptType;
    if (view.outcome === 'win') return 'win';
    if (view.outcome === 'dead') return view.deathCause === 'winter' ? 'blizzard' : 'gone';
    if (view.weather === 'snow') return 'blizzard';
    if (type === 'shooting') return view.context === 'riders' ? 'attack' : 'hunt';
    if (type === 'riders') return 'riders';
    if (type === 'fort') return 'fort';
    if (type === 'eating' || type === 'funeral') return 'camp';
    return 'trail';
  }

  updateParticles(delta) {
    if (this.reducedMotion) return;
    const w = this.width;
    const h = this.height;
    const weather = this.view.weather;
    const rate = weather === 'snow' || weather === 'sleet' ? 4 : weather === 'rain' || weather === 'hail' ? 6 : 2;
    if (weather === 'snow' || weather === 'rain' || weather === 'hail' || weather === 'sleet') {
      while (this.flakes.length < rate * 18) {
        this.flakes.push({
          x: Math.random() * w,
          y: Math.random() * h,
          v: 22 + Math.random() * 40,
          s: 1 + Math.random() * 2.4,
          swing: Math.random() * TAU,
        });
      }
      for (const flake of this.flakes) {
        flake.y += (flake.v * delta) / 1000;
        flake.x += Math.sin((this.frame + flake.swing) * 1.6) * (weather === 'snow' ? 0.35 : 0.1);
        if (flake.y > h) {
          flake.y = -4;
          flake.x = Math.random() * w;
        }
      }
    } else if (this.flakes.length) {
      this.flakes.length = 0;
    }

    if (this.frameSinceClean === undefined) this.frameSinceClean = 0;
    this.frameSinceClean += delta;
    if (this.frameSinceClean > 800 && this.dust.length > 40) {
      this.dust.splice(0, 20);
      this.frameSinceClean = 0;
    }
  }

  skyFor(view) {
    if (view.outcome === 'dead' && view.deathCause === 'winter') {
      return { top: '#2b3a55', bottom: '#7c8ba1', tint: 'rgba(220,235,255,0.12)', night: false, storm: true };
    }
    if (view.outcome === 'dead') {
      return { top: '#1a1f2e', bottom: '#4a3f52', tint: 'rgba(20,10,30,0.25)', night: true, storm: false };
    }
    if (view.outcome === 'win') {
      return { top: '#6fb1e8', bottom: '#ffd39a', tint: 'rgba(255,220,150,0.1)', night: false, storm: false };
    }
    const turn = view.turn || 0;
    if (turn <= 6) return { top: '#5aa9e6', bottom: '#cde9ff', tint: 'rgba(255,255,255,0.04)', night: false, storm: false };
    if (turn <= 12) return { top: '#4a7fb5', bottom: '#f0c184', tint: 'rgba(255,180,90,0.10)', night: false, storm: false };
    return { top: '#16233a', bottom: '#3b4c6b', tint: 'rgba(90,120,200,0.12)', night: true, storm: false };
  }

  drawSky(ctx, w, h, sky) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h * 0.72);
    gradient.addColorStop(0, sky.top);
    gradient.addColorStop(1, sky.bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    if (sky.night) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 40; i += 1) {
        const x = ((i * 97) % 100) / 100 * w;
        const y = ((i * 53) % 55) / 100 * h;
        const size = i % 5 === 0 ? 1.6 : 1;
        ctx.fillRect(x, y, size, size);
      }
      ctx.fillStyle = '#f4f1de';
      ctx.beginPath();
      ctx.arc(w * 0.78, h * 0.16, Math.max(9, w * 0.022), 0, TAU);
      ctx.fill();
    } else {
      const sun = ctx.createRadialGradient(w * 0.76, h * 0.2, 2, w * 0.76, h * 0.2, Math.max(26, w * 0.09));
      sun.addColorStop(0, 'rgba(255,246,200,0.95)');
      sun.addColorStop(1, 'rgba(255,246,200,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h * 0.6);
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(w * 0.76, h * 0.2, Math.max(8, w * 0.019), 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 3; i += 1) {
      const x = w * (0.12 + i * 0.34) + Math.sin(this.frame * 0.12 + i) * 6;
      const y = h * (0.16 + (i % 2) * 0.08);
      ctx.beginPath();
      ctx.ellipse(x, y, w * 0.09, h * 0.03, 0, 0, TAU);
      ctx.ellipse(x + w * 0.06, y + 3, w * 0.07, h * 0.024, 0, 0, TAU);
      ctx.fill();
    }
  }

  drawRidges(ctx, w, horizon, region, sky) {
    const far = makeRidge(w, horizon, 1.3, 0.9);
    ctx.globalAlpha = 0.65;
    poly(ctx, far, sky.night ? '#22304a' : '#8fa6bf');
    ctx.globalAlpha = 1;

    const mid = makeRidge(w, horizon + 8, 3.7, 0.7);
    poly(ctx, mid, sky.night ? '#1a2537' : '#6f8aa6');
    if (region !== 'plains') {
      ctx.fillStyle = '#f4f8ff';
      for (let i = 1; i < mid.length - 2; i += 1) {
        const [x, y] = mid[i];
        if (y < horizon * 0.62) {
          ctx.beginPath();
          ctx.moveTo(x - 9, y + 9);
          ctx.lineTo(x, y);
          ctx.lineTo(x + 9, y + 9);
          ctx.lineTo(x + 3, y + 6);
          ctx.lineTo(x - 3, y + 8);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  drawGround(ctx, w, h, horizon, region, sky) {
    const base = region === 'plains'
      ? (sky.night ? '#2f3b2a' : '#8fae63')
      : region === 'mountains'
        ? (sky.night ? '#3a332c' : '#b6a377')
        : (sky.night ? '#22301f' : '#5f8a4a');
    const gradient = ctx.createLinearGradient(0, horizon, 0, h);
    gradient.addColorStop(0, base);
    gradient.addColorStop(1, sky.night ? '#12161d' : '#4c6b38');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, horizon, w, h - horizon);

    const tufts = region === 'plains' ? 70 : 40;
    ctx.strokeStyle = sky.night ? 'rgba(180,200,160,0.25)' : 'rgba(40,70,30,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < tufts; i += 1) {
      const x = ((i * 131) % 997) / 997 * w;
      const y = horizon + 8 + ((i * 71) % 90) / 100 * (h - horizon);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 2, y - 5);
      ctx.moveTo(x + 2, y);
      ctx.lineTo(x + 4, y - 4);
      ctx.stroke();
    }

    if (region === 'plains') {
      ctx.fillStyle = sky.night ? '#243021' : '#3f6b35';
      for (let i = 0; i < 5; i += 1) {
        const x = w * (0.08 + i * 0.21);
        const y = horizon + (i % 2 === 0 ? 12 : 26);
        ctx.fillRect(x - 1.5, y - 14, 3, 14);
        ctx.beginPath();
        ctx.arc(x, y - 16, 5, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = sky.night ? '#4a4230' : '#9a8a6a';
      for (let i = 0; i < 7; i += 1) {
        const x = ((i * 173) % 997) / 997 * w;
        const y = h * (0.72 + ((i * 37) % 20) / 100);
        ctx.beginPath();
        ctx.ellipse(x, y, 8, 5, 0, 0, TAU);
        ctx.fill();
      }
    }

    if (region === 'mountains') {
      ctx.fillStyle = sky.night ? '#3b342b' : '#8d7c5c';
      for (let i = 0; i < 6; i += 1) {
        const x = ((i * 211) % 997) / 997 * w;
        const y = h * (0.7 + ((i * 53) % 22) / 100);
        poly(ctx, [[x - 12, y], [x - 4, y - 10], [x + 3, y - 4], [x + 12, y]], ctx.fillStyle);
      }
    }

    if (region === 'forest') {
      ctx.fillStyle = sky.night ? '#1b2a18' : '#2f5c2a';
      for (let i = 0; i < 9; i += 1) {
        const x = ((i * 149) % 991) / 991 * w;
        const y = horizon + 18 + ((i * 61) % 40) / 100 * (h - horizon - 20);
        const size = 12 + (i % 3) * 5;
        poly(ctx, [[x - size, y], [x, y - size * 1.8], [x + size, y]], ctx.fillStyle);
        ctx.fillStyle = '#5a3b22';
        ctx.fillRect(x - 1.5, y, 3, 7);
        ctx.fillStyle = sky.night ? '#1b2a18' : '#2f5c2a';
      }
    }
  }

  drawTrail(ctx, w, h, horizon) {
    const y0 = horizon + 14;
    const y1 = h * 0.96;
    ctx.beginPath();
    ctx.moveTo(w * 0.16, y0);
    ctx.quadraticCurveTo(w * 0.42, h * 0.78, w * 0.78, y1);
    ctx.lineTo(w * 0.94, y1);
    ctx.quadraticCurveTo(w * 0.56, h * 0.74, w * 0.26, y0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(190,160,110,0.75)';
    ctx.fill();

    ctx.strokeStyle = 'rgba(120,92,58,0.55)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(w * (0.2 + i * 0.02), y0 + 6);
      ctx.quadraticCurveTo(w * (0.44 + i * 0.02), h * (0.76 + i * 0.01), w * (0.76 + i * 0.02), y1 - 6);
      ctx.stroke();
    }
  }

  wagonAt(w, horizon, hop) {
    const x = w * 0.42;
    const y = horizon + 16 + (hop || 0);
    return { x, y, scale: clamp(w / 480, 0.72, 1.5) };
  }

  drawWagon(ctx, w, horizon, mode) {
    const hop = this.reducedMotion ? 0 : Math.abs(Math.sin(this.frame * 3.2)) * 1.8;
    const { x, y, scale } = this.wagonAt(w, horizon, hop);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Oxen
    ctx.fillStyle = '#8a5a3b';
    for (let i = 0; i < 2; i += 1) {
      const ox = -52 - i * 30;
      ctx.beginPath();
      ctx.ellipse(ox, 0, 15, 9, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#6f4529';
      const step = this.reducedMotion ? 0 : Math.sin(this.frame * 6 + i * 1.7) * 3;
      ctx.fillRect(ox - 8 + step, 6, 3, 9);
      ctx.fillRect(ox + 4 - step, 6, 3, 9);
      ctx.fillRect(ox - 8 - step, -14, 3, 8);
      ctx.fillRect(ox + 4 + step, -14, 3, 8);
      ctx.fillStyle = '#e8dcc8';
      ctx.beginPath();
      ctx.arc(ox + 10, -12, 4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#8a5a3b';
    }

    // Wagon body
    ctx.fillStyle = '#7a4f2a';
    ctx.fillRect(-16, -18, 46, 20);
    ctx.fillStyle = '#f5efe2';
    ctx.beginPath();
    ctx.moveTo(-16, -18);
    ctx.quadraticCurveTo(7, -52, 30, -18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#cbbfa4';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.quadraticCurveTo(7, -46, 14, -18);
    ctx.moveTo(-8, -18);
    ctx.quadraticCurveTo(7, -49, 22, -18);
    ctx.stroke();

    // Wheels
    const spin = this.reducedMotion ? 0 : this.frame * 4;
    for (const wheel of [{ x: -8, r: 11 }, { x: 22, r: 11 }]) {
      ctx.save();
      ctx.translate(wheel.x, 4);
      ctx.rotate(spin);
      ctx.strokeStyle = '#4a2f18';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, wheel.r, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 4; i += 1) {
        const angle = (i / 4) * Math.PI;
        ctx.moveTo(Math.cos(angle) * wheel.r, Math.sin(angle) * wheel.r);
        ctx.lineTo(-Math.cos(angle) * wheel.r, -Math.sin(angle) * wheel.r);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    if (!this.reducedMotion && mode !== 'camp') {
      if (Math.random() < 0.5) {
        this.dust.push({ x: x - 60 * scale, y: y + 8 * scale, life: 1, vx: -14 - Math.random() * 12, vy: -4 - Math.random() * 6 });
      }
      ctx.fillStyle = 'rgba(200,175,130,0.5)';
      for (const puff of this.dust) {
        ctx.globalAlpha = Math.max(0, puff.life) * 0.5;
        ctx.beginPath();
        ctx.arc(puff.x, puff.y, 3 + (1 - puff.life) * 7, 0, TAU);
        ctx.fill();
        puff.x += puff.vx / 60;
        puff.y += puff.vy / 60;
        puff.life -= 0.012;
      }
      ctx.globalAlpha = 1;
      this.dust = this.dust.filter((puff) => puff.life > 0).slice(-60);
    }
  }

  drawFort(ctx, w, horizon) {
    const x = w * 0.7;
    const y = horizon + 6;
    ctx.fillStyle = '#8a6437';
    ctx.fillRect(x, y - 34, 92, 34);
    ctx.fillStyle = '#6f4e29';
    for (let i = 0; i < 9; i += 1) {
      ctx.fillRect(x + i * 10, y - 44, 7, 14);
    }
    ctx.fillStyle = '#f0e2c0';
    ctx.fillRect(x + 34, y - 30, 22, 30);
    ctx.fillStyle = '#b23a2f';
    poly(ctx, [[x + 46, y - 60], [x + 76, y - 52], [x + 46, y - 44]], '#b23a2f');
    ctx.fillStyle = '#e8dcc8';
    ctx.fillRect(x + 46, y - 60, 2, 26);
  }

  drawCamp(ctx, w, horizon) {
    const { x, y, scale } = this.wagonAt(w, horizon, 0);
    const fireX = x + 60 * scale;
    const fireY = y + 12 * scale;
    for (let i = 0; i < 3; i += 1) {
      const flicker = this.reducedMotion ? 0 : Math.sin(this.frame * 9 + i) * 2;
      ctx.fillStyle = i === 0 ? 'rgba(255,170,60,0.9)' : i === 1 ? 'rgba(255,120,40,0.8)' : 'rgba(255,220,120,0.8)';
      ctx.beginPath();
      ctx.moveTo(fireX - 8 + i * 3, fireY);
      ctx.quadraticCurveTo(fireX + flicker, fireY - 20 - i * 4, fireX + 8 - i * 3, fireY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#5a3b22';
    ctx.fillRect(fireX - 10, fireY, 20, 3);
    ctx.fillStyle = '#d9d2c1';
    poly(ctx, [[fireX + 26, fireY + 2], [fireX + 46, fireY - 22], [fireX + 66, fireY + 2]], '#d9d2c1');
    ctx.fillStyle = '#8a6437';
    ctx.fillRect(fireX + 44, fireY - 20, 2, 22);
  }

  drawHunt(ctx, w, horizon) {
    const bob = this.reducedMotion ? 0 : Math.sin(this.frame * 1.6) * 2;
    const x = w * 0.66;
    const y = horizon + 34 + bob;
    ctx.fillStyle = '#6b4a2b';
    ctx.beginPath();
    ctx.ellipse(x, y, 22, 12, 0, 0, TAU);
    ctx.fill();
    ctx.fillRect(x - 6, y - 12, 3, 10);
    ctx.fillRect(x + 4, y - 12, 3, 10);
    ctx.fillRect(x - 18, y - 10, 3, 10);
    ctx.fillRect(x + 14, y - 10, 3, 10);
    ctx.beginPath();
    ctx.ellipse(x + 22, y - 10, 7, 5, -0.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#3f2c18';
    ctx.fillRect(x + 16, y - 22, 2, 12);
    ctx.fillRect(x + 26, y - 22, 2, 12);

    const cx = w * 0.62;
    const cy = horizon + 20;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, TAU);
    ctx.moveTo(cx - 24, cy);
    ctx.lineTo(cx - 8, cy);
    ctx.moveTo(cx + 8, cy);
    ctx.lineTo(cx + 24, cy);
    ctx.moveTo(cx, cy - 24);
    ctx.lineTo(cx, cy - 8);
    ctx.moveTo(cx, cy + 8);
    ctx.lineTo(cx, cy + 24);
    ctx.stroke();
  }

  drawRiders(ctx, w, horizon) {
    const gallop = this.reducedMotion ? 0 : this.frame * 9;
    ctx.fillStyle = '#2b2118';
    for (let i = 0; i < 3; i += 1) {
      const x = w * (0.2 + i * 0.16) + Math.sin(gallop + i) * 4;
      const y = horizon + 30 + i * 4;
      ctx.beginPath();
      ctx.ellipse(x, y, 14, 6, 0, 0, TAU);
      ctx.fill();
      const leg = Math.sin(gallop * 2 + i) * 4;
      ctx.fillRect(x - 9 + leg, y + 4, 2.5, 9);
      ctx.fillRect(x + 6 - leg, y + 4, 2.5, 9);
      ctx.fillRect(x - 10 - leg, y - 10, 2.5, 8);
      ctx.fillRect(x + 7 + leg, y - 10, 2.5, 8);
      ctx.beginPath();
      ctx.arc(x + 1, y - 14, 4.5, 0, TAU);
      ctx.fill();
      ctx.fillRect(x - 2, y - 22, 6, 9);
      ctx.fillRect(x + 4, y - 26, 12, 2);
    }
  }

  drawRiver(ctx, w, horizon) {
    const y = horizon + 26;
    const gradient = ctx.createLinearGradient(0, y, 0, y + 40);
    gradient.addColorStop(0, '#4f8fbf');
    gradient.addColorStop(1, '#1f4560');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, w, 40);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 7; i += 1) {
      const offset = this.reducedMotion ? 0 : (this.frame * 14 + i * 31) % w;
      ctx.beginPath();
      ctx.moveTo(offset - 20, y + 8 + i * 4);
      ctx.quadraticCurveTo(offset, y + 5 + i * 4, offset + 20, y + 8 + i * 4);
      ctx.stroke();
    }
  }

  drawOregonCity(ctx, w, horizon) {
    ctx.fillStyle = '#7a6a4f';
    for (let i = 0; i < 4; i += 1) {
      const x = w * (0.62 + i * 0.09);
      const y = horizon + 16 - (i % 2) * 4;
      ctx.fillRect(x, y - 16, 18, 16);
      poly(ctx, [[x - 2, y - 16], [x + 9, y - 26], [x + 20, y - 16]], '#8a5a3b');
    }
  }

  drawGrave(ctx, w, horizon) {
    const x = w * 0.62;
    const y = horizon + 30;
    ctx.fillStyle = '#4a4038';
    ctx.fillRect(x - 2, y - 26, 4, 26);
    ctx.fillRect(x - 12, y - 22, 24, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.round(Math.max(10, w * 0.022))}px monospace`;
    ctx.fillText('R.I.P.', x - 16, y + 14);
  }

  drawWeather(ctx, w, h) {
    const weather = this.view.weather;
    if (weather === 'fog') {
      ctx.fillStyle = 'rgba(220,225,230,0.35)';
      for (let i = 0; i < 3; i += 1) {
        const y = h * (0.35 + i * 0.16);
        ctx.beginPath();
        ctx.ellipse(w * 0.5 + Math.sin(this.frame * 0.4 + i) * 18, y, w * 0.7, h * 0.09, 0, 0, TAU);
        ctx.fill();
      }
      return;
    }

    if (weather === 'rain' || weather === 'hail' || weather === 'snow' || weather === 'sleet') {
      for (const flake of this.flakes) {
        if (weather === 'snow') {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath();
          ctx.arc(flake.x, flake.y, flake.s, 0, TAU);
          ctx.fill();
        } else if (weather === 'hail') {
          ctx.fillStyle = 'rgba(230,245,255,0.9)';
          ctx.fillRect(flake.x, flake.y, flake.s, flake.s * 1.6);
        } else {
          ctx.strokeStyle = 'rgba(180,210,240,0.7)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(flake.x, flake.y);
          ctx.lineTo(flake.x - 2, flake.y + 10);
          ctx.stroke();
        }
      }
    }

    if (this.view.outcome === 'dead' && this.view.deathCause === 'winter') {
      ctx.fillStyle = 'rgba(240,248,255,0.25)';
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawVignette(ctx, w, h) {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  drawMap(ctx, w, h) {
    const pad = 10;
    const y = h - 20;
    const width = w - pad * 2;
    ctx.fillStyle = 'rgba(20,16,12,0.55)';
    ctx.fillRect(pad - 4, y - 12, width + 8, 22);
    ctx.fillStyle = 'rgba(240,225,190,0.35)';
    ctx.fillRect(pad, y - 2, width, 3);

    const progress = clamp((this.view.mileage || 0) / 2040, 0, 1);
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(pad, y - 2, width * progress, 3);

    ctx.font = `${Math.max(8, Math.round(w * 0.013))}px monospace`;
    for (const mark of LANDMARKS) {
      const x = pad + width * (mark.at / 2040);
      ctx.fillStyle = mark.at / 2040 <= progress ? '#f2c14e' : 'rgba(240,225,190,0.4)';
      ctx.beginPath();
      ctx.arc(x, y - 0.5, 2.4, 0, TAU);
      ctx.fill();
      if (mark.at === 0 || mark.at === 2040 || Math.abs(mark.at - this.view.mileage) < 220) {
        ctx.fillStyle = 'rgba(255,245,220,0.85)';
        const label = mark.name;
        const textWidth = ctx.measureText(label).width;
        const lx = clamp(x - textWidth / 2, 2, w - textWidth - 2);
        ctx.fillText(label, lx, y - 7);
      }
    }

    const wagonX = pad + width * progress;
    ctx.fillStyle = '#f5efe2';
    ctx.fillRect(wagonX - 3, y - 7, 6, 4);
    ctx.fillStyle = '#7a4f2a';
    ctx.fillRect(wagonX - 3, y - 3.5, 6, 2);
  }
}
