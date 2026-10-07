ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stage_message TEXT NOT NULL DEFAULT 'Waiting to start',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.analyses
SET stage = CASE status
      WHEN 'completed' THEN 'completed'
      WHEN 'failed' THEN 'failed'
      WHEN 'parsing' THEN 'parsing'
      ELSE 'pending'
    END,
    stage_message = CASE status
      WHEN 'completed' THEN 'Analysis complete.'
      WHEN 'failed' THEN COALESCE(error_message, 'Analysis failed.')
      WHEN 'parsing' THEN 'Analysis was already running when progress tracking was added.'
      ELSE 'Waiting to start.'
    END,
    updated_at = COALESCE(completed_at, created_at, NOW());

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT '.',
  ADD COLUMN IF NOT EXISTS module_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'module',
  ADD COLUMN IF NOT EXISTS sha256 TEXT,
  ADD COLUMN IF NOT EXISTS fan_in INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fan_out INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.edges
  ADD COLUMN IF NOT EXISTS import_specifier TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS projects_org_repo_url_unique
  ON public.projects (org_id, repo_url);

CREATE UNIQUE INDEX IF NOT EXISTS files_analysis_path_unique
  ON public.files (analysis_id, path);

CREATE TABLE IF NOT EXISTS public.analysis_artifacts (
  analysis_id UUID PRIMARY KEY REFERENCES public.analyses(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  root TEXT NOT NULL,
  stats JSONB NOT NULL,
  coverage JSONB NOT NULL,
  skipped_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.analysis_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members access analysis artifacts" ON public.analysis_artifacts;
CREATE POLICY "Org members access analysis artifacts" ON public.analysis_artifacts
  FOR ALL USING (org_id = (SELECT COALESCE(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')))
  WITH CHECK (org_id = (SELECT COALESCE(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')));

CREATE INDEX IF NOT EXISTS analysis_artifacts_org_id_idx ON public.analysis_artifacts (org_id);

CREATE OR REPLACE FUNCTION public.prepare_repository_analysis(
  p_project_id UUID,
  p_org_id TEXT,
  p_rerun BOOLEAN DEFAULT FALSE
) RETURNS TABLE(analysis_id UUID, should_run BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing_id UUID;
  existing_status TEXT;
  existing_updated_at TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_project_id::text, 0));

  SELECT id, status, updated_at INTO existing_id, existing_status, existing_updated_at
    FROM public.analyses
    WHERE project_id = p_project_id AND org_id = p_org_id
    ORDER BY created_at DESC
    LIMIT 1;

  IF existing_id IS NOT NULL THEN
    IF NOT p_rerun
      OR existing_status = 'pending'
      OR (existing_status = 'parsing' AND existing_updated_at > NOW() - INTERVAL '5 minutes') THEN
      RETURN QUERY SELECT existing_id, FALSE;
      RETURN;
    END IF;

    UPDATE public.analyses
      SET status = 'pending', error_message = NULL, parsed_files_count = 0,
          commit_sha = NULL, stage = 'pending', stage_message = 'Waiting to start.',
          created_at = NOW(), completed_at = NULL, updated_at = NOW()
      WHERE id = existing_id AND org_id = p_org_id;
    RETURN QUERY SELECT existing_id, TRUE;
    RETURN;
  END IF;

  INSERT INTO public.analyses (project_id, org_id, status, stage, stage_message)
    VALUES (p_project_id, p_org_id, 'pending', 'pending', 'Waiting to start.')
    RETURNING id INTO existing_id;

  RETURN QUERY SELECT existing_id, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_repository_analysis(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_repository_analysis(UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_repository_analysis(
  p_analysis_id UUID,
  p_org_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_analysis_id::text, 0));

  UPDATE public.analyses
    SET status = 'parsing', stage = 'fetching',
        stage_message = 'Fetching the public GitHub repository.',
        error_message = NULL, updated_at = NOW()
    WHERE id = p_analysis_id AND org_id = p_org_id AND status = 'pending';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_repository_analysis(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_repository_analysis(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.store_analysis_result(
  p_analysis_id UUID,
  p_org_id TEXT,
  p_commit_sha TEXT,
  p_artifact JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.files WHERE analysis_id = p_analysis_id AND org_id = p_org_id;

  INSERT INTO public.files (
    analysis_id, org_id, path, language, lines, folder, module_name, kind,
    sha256, fan_in, fan_out
  )
  SELECT
    p_analysis_id,
    p_org_id,
    f.path,
    CASE WHEN lower(f.path) ~ '\.(js|jsx|mjs|cjs)$' THEN 'javascript' ELSE 'typescript' END,
    f.lines,
    f.folder,
    f.module,
    f.kind,
    f.sha256,
    f.fan_in,
    f.fan_out
  FROM jsonb_to_recordset(p_artifact -> 'files') AS f(
    path TEXT, lines INTEGER, folder TEXT, module TEXT, kind TEXT,
    sha256 TEXT, fan_in INTEGER, fan_out INTEGER
  );

  INSERT INTO public.edges (
    analysis_id, org_id, source_file_id, target_file_id, import_specifier, kind
  )
  SELECT
    p_analysis_id,
    p_org_id,
    source.id,
    target.id,
    COALESCE(e.import_specifier, ''),
    e.kind
  FROM jsonb_to_recordset(p_artifact -> 'edges') AS e(
    from_path TEXT, to_path TEXT, kind TEXT, import_specifier TEXT
  )
  JOIN public.files AS source
    ON source.analysis_id = p_analysis_id AND source.org_id = p_org_id AND source.path = e.from_path
  JOIN public.files AS target
    ON target.analysis_id = p_analysis_id AND target.org_id = p_org_id AND target.path = e.to_path;

  INSERT INTO public.analysis_artifacts (
    analysis_id, org_id, schema_version, root, stats, coverage, skipped_files
  ) VALUES (
    p_analysis_id,
    p_org_id,
    (p_artifact ->> 'schemaVersion')::INTEGER,
    p_artifact ->> 'root',
    p_artifact -> 'stats',
    p_artifact -> 'coverage',
    COALESCE(p_artifact -> 'skippedFiles', '[]'::jsonb)
  )
  ON CONFLICT (analysis_id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    schema_version = EXCLUDED.schema_version,
    root = EXCLUDED.root,
    stats = EXCLUDED.stats,
    coverage = EXCLUDED.coverage,
    skipped_files = EXCLUDED.skipped_files,
    created_at = NOW();

  UPDATE public.analyses
    SET commit_sha = p_commit_sha,
        status = 'completed',
        error_message = NULL,
        parsed_files_count = jsonb_array_length(p_artifact -> 'files'),
        stage = 'completed',
        stage_message = 'Analysis parsed and stored.',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_analysis_id AND org_id = p_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.store_analysis_result(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_analysis_result(UUID, TEXT, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_analysis_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, realtime, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage OR NEW.stage_message IS DISTINCT FROM OLD.stage_message THEN
    PERFORM realtime.send(
      jsonb_build_object('stage', NEW.stage, 'message', NEW.stage_message),
      'stage',
      'analysis:' || NEW.id::text,
      TRUE
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_analysis_stage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS analyses_publish_stage ON public.analyses;
CREATE TRIGGER analyses_publish_stage
  AFTER INSERT OR UPDATE OF stage, stage_message ON public.analyses
  FOR EACH ROW EXECUTE FUNCTION public.publish_analysis_stage();

DROP POLICY IF EXISTS "Organization members can receive analysis stages" ON realtime.messages;
CREATE POLICY "Organization members can receive analysis stages" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    extension = 'broadcast'
    AND
    extension.topic() ~ '^analysis:[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.analyses AS a
      WHERE a.id::text = substring(extension.topic() FROM 10)
    )
  );
