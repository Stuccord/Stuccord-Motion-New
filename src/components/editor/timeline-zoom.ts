// Timeline zoom in pixels per second of video. Steps multiply, so each
// press of + or - changes the view by the same proportion at any zoom.
export const ZOOM_MIN = 2;
export const ZOOM_MAX = 400;
export const ZOOM_STEP = 1.25;

export function clampZoom(pxPerSec: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pxPerSec));
}

// The zoom slider is logarithmic (0–100) so it also moves proportionally.
export const zoomToSlider = (px: number) =>
  (Math.log(px / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * 100;
export const sliderToZoom = (v: number) => ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** (v / 100);
