-- Animated story scenes: the motion-images bucket also holds each scene's
-- AI clip (an MP4 made from its picture on Higgsfield), so it takes MP4
-- video and files up to 50 MB. AI clips are counted in motion_image_runs
-- (model "minimax/h3/image-to-video"), apart from the picture allowance.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
    file_size_limit = 52428800
WHERE id = 'motion-images';
