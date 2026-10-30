// A small live wallpaper for the project page: dusk over the sea, with
// parallax that follows the pointer, the same way scene wallpapers do.
// SPDX-License-Identifier: GPL-3.0-or-later

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function rng(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

// a ridge line as a sum of sines, sampled across the width
function ridge(random, octaves) {
    const waves = Array.from({length: octaves}, (_, i) => ({
        f: (i + 1) * (1.3 + random()),
        a: 1 / (i + 1.4),
        p: random() * Math.PI * 2,
    }));
    const total = waves.reduce((s, w) => s + w.a, 0);
    return x => waves.reduce((s, w) => s + Math.sin(x * w.f * Math.PI * 2 + w.p) * w.a, 0) / total;
}

export class Dusk {
    constructor(canvas, {onFrame, pointerTarget = window, seed = 7} = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onFrame = onFrame;
        this.frames = 0;
        this.playing = false;
        this.visible = true;
        this.wanted = true;
        this.time = 0;
        this.pointer = {x: 0, y: 0};
        this.eased = {x: 0, y: 0};

        const random = rng(seed);
        this.stars = Array.from({length: 140}, () => ({
            x: random(), y: random() * 0.55, r: random() * 1.1 + 0.3,
            tw: random() * Math.PI * 2, sp: 0.6 + random() * 1.8,
        }));
        this.clouds = Array.from({length: 7}, () => ({
            x: random(), y: 0.12 + random() * 0.3, w: 0.18 + random() * 0.25,
            h: 0.012 + random() * 0.02, v: 0.004 + random() * 0.008, a: 0.08 + random() * 0.12,
        }));
        this.ranges = [
            {fn: ridge(random, 4), base: 0.6, amp: 0.07, depth: 0.25, color: '#6a5a96'},
            {fn: ridge(random, 5), base: 0.635, amp: 0.05, depth: 0.5, color: '#3f3a6e'},
            {fn: ridge(random, 6), base: 0.66, amp: 0.035, depth: 0.8, color: '#262650'},
        ];
        this.motes = Array.from({length: 46}, () => ({
            x: random(), y: random(), r: 0.6 + random() * 1.6,
            v: 0.01 + random() * 0.03, sway: random() * Math.PI * 2, depth: 0.6 + random() * 0.8,
        }));
        this.glints = Array.from({length: 140}, () => ({
            y: random(), w: 0.2 + random() * 0.8, ph: random() * Math.PI * 2, sp: 1 + random() * 2,
        }));

        this._tick = this._tick.bind(this);
        this._resize = this._resize.bind(this);
        new ResizeObserver(this._resize).observe(canvas);
        this._resize();

        pointerTarget.addEventListener('pointermove', e => {
            const rect = canvas.getBoundingClientRect();
            this.pointer.x = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
            this.pointer.y = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
            if (!this.playing)
                this._draw(true);
        });

        // like the real thing: nothing is drawn while nobody can see it
        new IntersectionObserver(([entry]) => {
            this.visible = entry.isIntersecting;
            this._update();
        }).observe(canvas);
        document.addEventListener('visibilitychange', () => this._update());
        reducedMotion.addEventListener('change', () => this._update());
        this._update();
    }

    play() {
        this.wanted = true;
        this._update();
    }

    pause() {
        this.wanted = false;
        this._update();
    }

    _update() {
        const run = this.wanted && this.visible && !document.hidden && !reducedMotion.matches;
        if (run && !this.playing) {
            this.playing = true;
            this.last = performance.now();
            requestAnimationFrame(this._tick);
        } else if (!run) {
            this.playing = false;
        }
    }

    _resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const {width, height} = this.canvas.getBoundingClientRect();
        this.w = width;
        this.h = height;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._draw(true);
    }

    _tick(now) {
        if (!this.playing)
            return;
        const dt = Math.min((now - this.last) / 1000, 0.1);
        this.last = now;
        this.time += dt;
        this._draw(false, dt);
        this.frames++;
        this.onFrame?.(this.frames);
        requestAnimationFrame(this._tick);
    }

    _draw(still, dt = 0) {
        const {ctx, w, h} = this;
        if (!w || !h)
            return;
        const k = still ? 1 : 1 - Math.pow(0.02, dt);
        this.eased.x += (this.pointer.x - this.eased.x) * k;
        this.eased.y += (this.pointer.y - this.eased.y) * k;
        const shift = Math.min(w, 1400) * 0.03;
        const px = d => -this.eased.x * shift * d;
        const py = d => -this.eased.y * shift * 0.5 * d;
        const t = this.time;
        const horizon = h * 0.68;

        // sky
        const sky = ctx.createLinearGradient(0, 0, 0, horizon);
        sky.addColorStop(0, '#15173a');
        sky.addColorStop(0.45, '#3b3470');
        sky.addColorStop(0.78, '#8a5d8e');
        sky.addColorStop(1, '#e09a86');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, horizon + 2);

        // stars
        for (const s of this.stars) {
            const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.sp + s.tw));
            ctx.globalAlpha = a * (1 - s.y * 1.4);
            ctx.fillStyle = '#eef0ff';
            ctx.beginPath();
            ctx.arc(s.x * w + px(0.08), s.y * h + py(0.08), s.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // sun, low over the water
        const sx = w * 0.7 + px(0.15);
        const sy = h * 0.5 + py(0.15);
        const sr = Math.max(28, Math.min(w, h) * 0.07);
        const glow = ctx.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 6);
        glow.addColorStop(0, 'rgba(255, 196, 120, 0.55)');
        glow.addColorStop(1, 'rgba(255, 160, 110, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, horizon);
        ctx.fillStyle = '#f7c27a';
        ctx.beginPath();
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        ctx.fill();

        // clouds
        for (const c of this.clouds) {
            const x = ((c.x + t * c.v) % 1.4 - 0.2) * w + px(0.2);
            const rx = c.w * w * 0.5;
            ctx.save();
            ctx.translate(x, c.y * h + py(0.2));
            ctx.scale(1, (c.h * h) / rx);
            const soft = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
            soft.addColorStop(0, `rgba(255, 210, 220, ${c.a * 1.6})`);
            soft.addColorStop(1, 'rgba(255, 210, 220, 0)');
            ctx.fillStyle = soft;
            ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
            ctx.restore();
        }

        // mountains
        for (const r of this.ranges) {
            ctx.fillStyle = r.color;
            ctx.beginPath();
            ctx.moveTo(-shift * 2, horizon + 2);
            const step = Math.max(4, w / 160);
            for (let x = -shift * 2; x <= w + shift * 2; x += step) {
                const u = (x - px(r.depth)) / w;
                ctx.lineTo(x, h * r.base + py(r.depth) - r.fn(u * 0.9) * h * r.amp - h * r.amp);
            }
            ctx.lineTo(w + shift * 2, horizon + 2);
            ctx.closePath();
            ctx.fill();
        }

        // sea
        const sea = ctx.createLinearGradient(0, horizon, 0, h);
        sea.addColorStop(0, '#3a4f7e');
        sea.addColorStop(0.35, '#1f4a63');
        sea.addColorStop(1, '#0e2236');
        ctx.fillStyle = sea;
        ctx.fillRect(0, horizon, w, h - horizon);

        // the sun's path on the water
        const column = ctx.createLinearGradient(0, horizon, 0, h);
        column.addColorStop(0, 'rgba(255, 190, 130, 0.35)');
        column.addColorStop(1, 'rgba(255, 190, 130, 0)');
        ctx.fillStyle = column;
        ctx.beginPath();
        ctx.moveTo(sx + px(0.3) - sr * 0.9, horizon);
        ctx.lineTo(sx + px(0.3) + sr * 0.9, horizon);
        ctx.lineTo(sx + px(0.9) + sr * 2.6, h);
        ctx.lineTo(sx + px(0.9) - sr * 2.6, h);
        ctx.closePath();
        ctx.fill();
        for (const g of this.glints) {
            const y = horizon + g.y * g.y * (h - horizon);
            const spread = 0.25 + g.y * 1.6;
            const a = Math.max(0, Math.sin(t * g.sp + g.ph)) * (1 - g.y * 0.5);
            const len = sr * spread * g.w * 1.4;
            const x = sx + px(0.9 * g.y) + Math.sin(g.ph * 3) * sr * spread * 0.9;
            ctx.strokeStyle = `rgba(255, 214, 160, ${a})`;
            ctx.lineWidth = 1 + g.y * 2;
            ctx.beginPath();
            ctx.moveTo(x - len / 2, y);
            ctx.lineTo(x + len / 2, y);
            ctx.stroke();
        }

        // drifting motes
        for (const m of this.motes) {
            const y = ((m.y - t * m.v) % 1 + 1) % 1;
            const x = m.x * w + Math.sin(t * 0.6 + m.sway) * 14 + px(m.depth * 1.2);
            ctx.fillStyle = `rgba(255, 226, 170, ${0.25 + 0.5 * Math.sin(t + m.sway) ** 2})`;
            ctx.beginPath();
            ctx.arc(x, y * h + py(m.depth * 1.2), m.r * m.depth, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
