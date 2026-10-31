// easing.ts — VERBATIM from Pulse Core src/core/easing.ts.
// Already pure (no browser deps). Reused as-is in headless build.
// (Source: D:\Projects\pulse-core\src\core\easing.ts)
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;
export const Easing = {
    linear: (t) => t,
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
    easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
    easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeInQuart: (t) => t * t * t * t,
    easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
    easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
    easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    easeInOutExpo: (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
    easeInBack: (t) => c3 * t * t * t - c1 * t * t,
    easeOutBack: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
    easeInOutBack: (t) => t < 0.5
        ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
    easeInElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)),
    easeOutElastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
    easeInOutElastic: (t) => t === 0 ? 0 : t === 1 ? 1 : t < 0.5
        ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
        : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2,
    easeInBounce: (t) => 1 - Easing.easeOutBounce(1 - t),
    easeOutBounce: (t) => {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (t < 1 / d1)
            return n1 * t * t;
        if (t < 2 / d1)
            return n1 * (t -= 1.5 / d1) * t + 0.75;
        if (t < 2.5 / d1)
            return n1 * (t -= 2.25 / d1) * t + 0.9375;
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
    easeInOutBounce: (t) => (t < 0.5 ? (1 - Easing.easeOutBounce(1 - 2 * t)) / 2 : (1 + Easing.easeOutBounce(2 * t - 1)) / 2),
    wobble: (t, amp = 1, freq = 1) => Math.sin(t * Math.PI * 2 * freq) * amp,
};
const aliases = {
    linear: 'linear', inQuad: 'easeInQuad', outQuad: 'easeOutQuad', inOutQuad: 'easeInOutQuad',
    inSine: 'easeInSine', outSine: 'easeOutSine', inOutSine: 'easeInOutSine',
    inCubic: 'easeInCubic', outCubic: 'easeOutCubic', inOutCubic: 'easeInOutCubic',
    inQuart: 'easeInQuart', outQuart: 'easeOutQuart', inOutQuart: 'easeInOutQuart',
    inExpo: 'easeInExpo', outExpo: 'easeOutExpo', inOutExpo: 'easeInOutExpo',
    inBack: 'easeInBack', outBack: 'easeOutBack', inOutBack: 'easeInOutBack',
    inElastic: 'easeInElastic', outElastic: 'easeOutElastic', inOutElastic: 'easeInOutElastic',
    inBounce: 'easeInBounce', outBounce: 'easeOutBounce', inOutBounce: 'easeInOutBounce',
};
export function resolveEase(ease) {
    if (typeof ease === 'function')
        return ease;
    if (!ease)
        return Easing.easeOutCubic;
    const key = aliases[ease] ?? ease;
    return Easing[key] ?? Easing.easeOutCubic;
}
//# sourceMappingURL=easing.js.map