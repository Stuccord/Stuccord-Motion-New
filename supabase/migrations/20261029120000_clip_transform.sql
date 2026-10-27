-- Where a clip sits in the frame: moved, resized or rotated in the preview.
--
-- JSON like {"x": 0.1, "y": -0.2, "scale": 0.5, "rotation": 15}:
--   x, y      how far the clip's centre is from the frame's centre, as a
--             share of the frame's width and height (0 = centred)
--   scale     size compared with the clip's default fit (1 = default)
--   rotation  degrees, clockwise
-- NULL means the default fit (how every clip was shown before), so existing
-- projects are unchanged.
--
-- Additive and safe to run more than once.

ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS transform JSONB;
