-- Problems on the app's side (an AI service out of credit, a key rejected,
-- the worker out of date), recorded for the app's owner: customers see a
-- friendly message instead (src/lib/service-problems.ts). One row per
-- service and problem, counted, with when it was first and last seen. Only
-- the server reads and writes it.
CREATE TABLE IF NOT EXISTS public.service_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  problem text NOT NULL,
  message text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service, problem)
);
ALTER TABLE public.service_alerts ENABLE ROW LEVEL SECURITY;

-- Records one more time a problem happened (a new row, or the count and
-- latest message on the existing one).
CREATE OR REPLACE FUNCTION public.report_service_alert(
  p_service text,
  p_problem text,
  p_message text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.service_alerts (service, problem, message)
  VALUES (left(p_service, 60), left(p_problem, 120), left(p_message, 600))
  ON CONFLICT (service, problem) DO UPDATE
  SET count = service_alerts.count + 1,
      message = excluded.message,
      last_at = now();
$$;

REVOKE ALL ON FUNCTION public.report_service_alert(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_service_alert(text, text, text) TO service_role;
