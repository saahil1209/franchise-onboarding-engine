// Interruptible springs in Apple's terms: damping ratio (1 = no overshoot) and response (seconds).
// Every animation starts from the live value and keeps its velocity when the target changes,
// so a user can grab or redirect anything mid-flight without a jump.
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function spring({ value = 0, damping = 1, response = 0.35, precision = 0.01, onUpdate, onRest }) {
  let x = value, v = 0, target = value, raf = 0, last = 0;
  // Unit mass: response is the undamped period, so k = (2π / response)² and c = 4π·ζ / response.
  const k = (2 * Math.PI / response) ** 2, c = (4 * Math.PI * damping) / response;
  const step = (t) => {
    const dt = Math.min(0.034, (t - last) / 1000); last = t;
    for (let i = 0; i < 4; i++) { const h = dt / 4; v += (-k * (x - target) - c * v) * h; x += v * h; }
    if (Math.abs(v) < precision * 10 && Math.abs(x - target) < precision) { x = target; v = 0; raf = 0; onUpdate(x); onRest?.(x); return; }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  return {
    to(next, { velocity } = {}) {
      target = next;
      if (velocity !== undefined) v = velocity;
      if (reducedMotion) { x = target; v = 0; cancelAnimationFrame(raf); raf = 0; onUpdate(x); onRest?.(x); return; }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
    },
    set(next) { cancelAnimationFrame(raf); raf = 0; x = target = next; v = 0; onUpdate(x); },
    get value() { return x; },
    get target() { return target; },
  };
}

// Where a flick would come to rest (Apple's projection from "Designing Fluid Interfaces").
export const project = (velocity, rate = 0.998) => (velocity / 1000) * rate / (1 - rate);

// Soft boundary: the further past the edge, the less the element follows.
export const rubberband = (overshoot, dimension, constant = 0.55) =>
  (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

// Velocity from the last ~100ms of pointer samples, in px/s.
export function tracker() {
  const samples = [];
  return {
    add(pos) { const t = performance.now(); samples.push({ pos, t }); while (samples.length > 2 && t - samples[0].t > 100) samples.shift(); },
    velocity() { if (samples.length < 2) return 0; const a = samples[0], b = samples.at(-1); return (b.pos - a.pos) / Math.max(1, b.t - a.t) * 1000; },
    reset() { samples.length = 0; },
  };
}

// Press feedback on pointer-down (not click), released with a critically damped spring.
export function pressable(el, scale = 0.97) {
  const s = spring({ value: 1, damping: 1, response: 0.25, precision: 0.0005, onUpdate: (x) => { el.style.transform = `scale(${x})`; } });
  el.addEventListener('pointerdown', () => s.to(scale));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => s.to(1));
}
