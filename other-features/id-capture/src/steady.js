/** Steady-frame detector: auto-capture fires when the outline has stayed put for N frames and the checks pass. */
import { quadShift } from './geometry.js';

export const DEFAULTS = { framesNeeded: 12, maxShift: 0.012 }; // 1.2% of the diagonal between frames

export class SteadyDetector {
  constructor({ framesNeeded = DEFAULTS.framesNeeded, maxShift = DEFAULTS.maxShift } = {}) {
    this.framesNeeded = framesNeeded; this.maxShift = maxShift; this.reset();
  }

  reset() { this.last = null; this.count = 0; }

  /** Feed one frame's quad (or null) and whether the quick checks passed. Returns { steady, progress }. */
  push(quad, checksPass, frame) {
    if (!quad || !checksPass) { this.reset(); return { steady: false, progress: 0 }; }
    if (this.last && quadShift(this.last, quad, frame) <= this.maxShift) this.count += 1; else this.count = 1;
    this.last = quad;
    const progress = Math.min(1, this.count / this.framesNeeded);
    return { steady: this.count >= this.framesNeeded, progress };
  }
}
