import { describe, expect, it } from "vitest";
import { clampZoom, MAX_ZOOM, wheelFactor, zoomAt } from "./lightbox";

describe("lightbox zoom", () => {
  it("keeps the point under the cursor still", () => {
    const next = zoomAt({ zoom: 1, x: 0, y: 0 }, 2, { x: 100, y: -50 }, 0.5);
    // image point under the cursor was (100, -50) / 1; after zoom it must map back to the cursor
    expect((100 - next!.x) / next!.zoom).toBeCloseTo(100);
    expect((-50 - next!.y) / next!.zoom).toBeCloseTo(-50);
  });

  it("returns to fit (null) rather than a fixed zoom, so a later resize refits", () => {
    expect(zoomAt({ zoom: 1, x: 40, y: 40 }, 0.1, { x: 0, y: 0 }, 0.5)).toBeNull();
  });

  it("clamps between fit (or 100% for small images) and the max", () => {
    expect(clampZoom(0.1, 0.4)).toBe(0.4);
    expect(clampZoom(0.1, 1)).toBe(1);
    expect(clampZoom(50, 0.4)).toBe(MAX_ZOOM);
  });

  it("wheel up zooms in, wheel down zooms out", () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, false)).toBeLessThan(1);
    expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-10, false));
  });

  it("treats line and page wheel deltas like their pixel size", () => {
    expect(wheelFactor(-3, false, 1)).toBeCloseTo(wheelFactor(-48, false, 0));
    expect(wheelFactor(-1, false, 2)).toBeCloseTo(wheelFactor(-800, false, 0));
  });
});
