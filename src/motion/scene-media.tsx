// A story scene's picture, or its animated clip. The looks draw scene
// pictures with this in place of Remotion's Img:
// - a link to a still: exactly Img;
// - "frames:<folder>:<count>": the export's clip, cut into still frames by
//   the worker (render-worker/motion.js prepareStoryClips): the frame for
//   this moment, looped, which draws as quickly as a still picture;
// - a link to an MP4 (the editor's preview): the clip played, muted, looped.
// The clip fills the same box as the picture would. No app imports: the
// worker bundles src/motion on its own.

import React from "react";
import { Img, Loop, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

/** How long one pass of a clip runs before it loops (s): the clips are 5 s. */
const CLIP_S = 4.9;

/** True for a link to a video clip (a signed storage link keeps the file's extension). */
const isClipUrl = (src: string | undefined) => !!src && /\.mp4(?:[?#]|$)/i.test(src);

type Props = React.ComponentProps<typeof Img>;

/** A clip as numbered frames in the bundle ("frames:<folder>:<count>"), or null. */
function framesOf(src: string | undefined) {
  const m = src?.match(/^frames:(.+):(\d+)$/);
  return m ? { folder: m[1], count: Math.max(1, Number(m[2])) } : null;
}

export function SceneImg(props: Props) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const frames = framesOf(props.src);
  if (frames) {
    const n = (Math.max(0, frame) % frames.count) + 1;
    return (
      <Img {...props} src={staticFile(`${frames.folder}/${String(n).padStart(4, "0")}.jpg`)} />
    );
  }
  if (!isClipUrl(props.src)) return <Img {...props} />;
  const { src, style, className } = props;
  return (
    <Loop durationInFrames={Math.max(1, Math.round(CLIP_S * fps))} layout="none">
      <OffthreadVideo src={src as string} muted style={style} className={className} />
    </Loop>
  );
}
