export type LightboxView = { readonly zoom: number; readonly x: number; readonly y: number };

export const MAX_ZOOM = 8;

const LINE_PX = 16;
const PAGE_PX = 800;

export function clampZoom(zoom: number, fit: number): number {
  return Math.min(MAX_ZOOM, Math.max(Math.min(fit, 1), zoom));
}

/**
 * Zooms by `factor` keeping the image point under `at` still; `at` and x/y are offsets from the stage centre.
 * Returns null at fit so the view follows the stage when it is resized.
 */
export function zoomAt(view: LightboxView, factor: number, at: { x: number; y: number }, fit: number): LightboxView | null {
  const zoom = clampZoom(view.zoom * factor, fit);
  if (zoom <= fit) return null;
  const ratio = zoom / view.zoom;
  return { zoom, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

/** Wheel delta to zoom factor; trackpad pinch arrives as a ctrl+wheel with small deltas. `deltaMode` 1 = lines, 2 = pages. */
export function wheelFactor(deltaY: number, pinch: boolean, deltaMode = 0): number {
  const px = deltaY * (deltaMode === 1 ? LINE_PX : deltaMode === 2 ? PAGE_PX : 1);
  return Math.exp(-px * (pinch ? 0.01 : 0.0015));
}
