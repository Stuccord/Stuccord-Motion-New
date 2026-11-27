// The editor preview's pictures drawn through the export's grade (see
// lib/grade-gl.ts): a canvas laid over a video or an image, the same size
// and fit, redrawn whenever the video shows a new frame. The video or image
// underneath stays (it plays the sound and keeps its place) but is hidden
// once the graded canvas has drawn.

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { GradeRenderer, gradeGlSupported, type GradeTable } from "@/lib/grade-gl";

/** The longest side a graded picture is drawn at (px): the preview is small. */
const MAX_SIDE = 1280;

/** Fits w x h within MAX_SIDE. */
export function gradedSize(w: number, h: number) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * The canvas's renderer, made the first time it's asked for (once the
 * canvas is on the page); null when WebGL2 isn't there or failed.
 */
export function useGradeRenderer(canvas: React.RefObject<HTMLCanvasElement | null>) {
  const renderer = useRef<GradeRenderer | null>(null);
  const failed = useRef(false);
  return () => {
    if (renderer.current || failed.current || !canvas.current || !gradeGlSupported()) {
      return renderer.current;
    }
    try {
      renderer.current = new GradeRenderer(canvas.current);
    } catch (e) {
      failed.current = true;
      console.warn("[preview] The graded preview isn't available here:", e);
    }
    return renderer.current;
  };
}

/** A video's frames through the grade, over the video. */
export function GradedVideo({
  video,
  table,
  fit,
  onDrawn,
  canvasRef,
}: {
  video: HTMLVideoElement | null;
  table: GradeTable;
  fit: string;
  /** Called once the first graded frame is on screen (the video can hide). */
  onDrawn: (drawn: boolean) => void;
  /** The canvas, for copying the graded picture (the blurred copy behind). */
  canvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const getRenderer = useGradeRenderer(canvas);
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  useEffect(() => {
    const r = getRenderer();
    if (!video || !r) {
      onDrawnRef.current(false);
      return;
    }
    r.setTable(table);
    let shown = false;
    const draw = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      const { w, h } = gradedSize(video.videoWidth, video.videoHeight);
      if (r.draw(video, w, h) && !shown) {
        shown = true;
        onDrawnRef.current(true);
      }
    };
    let handle: number | null = null;
    let raf = 0;
    if ("requestVideoFrameCallback" in video) {
      const onFrame = () => {
        draw();
        handle = video.requestVideoFrameCallback(onFrame);
      };
      handle = video.requestVideoFrameCallback(onFrame);
    } else {
      const loop = () => {
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    const events = ["seeked", "loadeddata", "canplay"];
    for (const ev of events) video.addEventListener(ev, draw);
    draw();
    return () => {
      if (handle != null) video.cancelVideoFrameCallback(handle);
      cancelAnimationFrame(raf);
      for (const ev of events) video.removeEventListener(ev, draw);
      onDrawnRef.current(false);
    };
    // renderer is a ref; table changes are picked up via setTable above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, table.key]);
  return (
    <canvas
      ref={(c) => {
        canvas.current = c;
        if (canvasRef) canvasRef.current = c;
      }}
      aria-hidden
      className={cn("absolute inset-0 w-full h-full pointer-events-none", fit)}
    />
  );
}

/** An image through the grade, over the image (drawn once it's loaded). */
export function GradedImage({
  image,
  table,
  fit,
  style,
  onDrawn,
}: {
  image: HTMLImageElement | null;
  table: GradeTable;
  fit: string;
  style?: React.CSSProperties;
  onDrawn: (drawn: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const getRenderer = useGradeRenderer(canvas);
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  useEffect(() => {
    const r = getRenderer();
    if (!image || !r) {
      onDrawnRef.current(false);
      return;
    }
    r.setTable(table);
    const draw = () => {
      if (!image.complete || !image.naturalWidth) return;
      const { w, h } = gradedSize(image.naturalWidth, image.naturalHeight);
      onDrawnRef.current(r.draw(image, w, h));
    };
    image.addEventListener("load", draw);
    draw();
    return () => {
      image.removeEventListener("load", draw);
      onDrawnRef.current(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, table.key]);
  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn("absolute inset-0 w-full h-full pointer-events-none", fit)}
      style={style}
    />
  );
}
