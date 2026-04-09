-- API performance telemetry table for timing-heavy routes.

CREATE TABLE IF NOT EXISTS public.api_performance_metrics (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  total_ms INTEGER NOT NULL CHECK (total_ms >= 0),
  item_count INTEGER,
  stages JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_performance_metrics_route_created
  ON public.api_performance_metrics(route, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_performance_metrics_created_at
  ON public.api_performance_metrics(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_performance_metrics_status_code
  ON public.api_performance_metrics(status_code);

CREATE INDEX IF NOT EXISTS idx_api_performance_metrics_user_id
  ON public.api_performance_metrics(user_id);
