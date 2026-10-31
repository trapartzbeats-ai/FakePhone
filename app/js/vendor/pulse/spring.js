// spring.ts — VERBATIM from Pulse Core src/core/spring.ts.
// Already pure (semi-implicit Euler). Reused as-is in headless build.
// (Source: D:\Projects\pulse-core\src\core\spring.ts)
export class Spring {
    k;
    c;
    m;
    v;
    restX;
    restV;
    constructor(opts = {}) {
        this.k = opts.stiffness ?? 170;
        this.c = opts.damping ?? 22;
        this.m = opts.mass ?? 1;
        this.v = opts.velocity ?? 0;
        this.restX = opts.restDisplacement ?? 0.001;
        this.restV = opts.restVelocity ?? 0.001;
    }
    step(x, dt) {
        const h = Math.min(dt, 1 / 60);
        const fSpring = -this.k * (x - 1);
        const fDamp = -this.c * this.v;
        const a = (fSpring + fDamp) / this.m;
        this.v += a * h;
        return x + this.v * h;
    }
    settled(x) {
        return Math.abs(1 - x) < this.restX && Math.abs(this.v) < this.restV;
    }
}
//# sourceMappingURL=spring.js.map