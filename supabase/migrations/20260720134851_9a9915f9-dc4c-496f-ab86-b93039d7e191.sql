CREATE POLICY "render own write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "render own update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "render own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'renders' AND auth.uid()::text = (storage.foldername(name))[1]);