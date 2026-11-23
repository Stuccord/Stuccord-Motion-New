// A story scene's picture, or its animated clip. The looks draw scene
// pictures with this in place of Remotion's Img: given a link to a still it
// is exactly Img; given a link to an MP4 (the picture brought to life on
// Higgsfield, see story-clips) it plays the clip, muted, filling the same
// box, and loops it when the scene outlasts it. No app imports: the worker
// bundles src/motion on its own.

import React from "react";
import { Img, Loop, OffthreadVideo, useVideoConfig } from "remotion";

/** How long one pass of a clip runs before it loops (s): the clips are 5 s. */
const CLIP_S = 4.9;

/** True for a link to a video clip (a signed storage link keeps the file's extension). */
const isClipUrl =(src: string | undefined) => !!src && /\.mp4(?:[?#]|$)/i.test(src);

type Props = React.ComponentProps<typeof Img>;

export function SceneImg(props: Props) {
  const { fps } = useVideoConfig();
  if (!isClipUrl(props.src)) return <Img {...props} />;
  const { src, style, className } = props;
  return (
    <Loop durationInFrames={Math.max(1, Math.round(CLIP_S * fps))} layout="none">
      <OffthreadVideo src={src as string} muted style={style} className={className} />
    </Loop>
  );
}
