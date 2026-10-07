ALTER TABLE public.analysis_artifacts
  ADD COLUMN IF NOT EXISTS framework TEXT NOT NULL DEFAULT 'Generic';

CREATE INDEX IF NOT EXISTS routes_analysis_id_idx ON public.routes (analysis_id);

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

  DELETE FROM public.routes WHERE analysis_id = p_analysis_id AND org_id = p_org_id;
  INSERT INTO public.routes (analysis_id, org_id, file_id, method, path)
  SELECT p_analysis_id, p_org_id, f.id, r.method, r.path
  FROM jsonb_to_recordset(COALESCE(p_artifact -> 'routes', '[]'::jsonb)) AS r(
    file TEXT, method TEXT, path TEXT
  )
  JOIN public.files AS f
    ON f.analysis_id = p_analysis_id AND f.org_id = p_org_id AND f.path = r.file;

  INSERT INTO public.analysis_artifacts (
    analysis_id, org_id, schema_version, root, framework, stats, coverage, skipped_files
  ) VALUES (
    p_analysis_id,
    p_org_id,
    (p_artifact ->> 'schemaVersion')::INTEGER,
    p_artifact ->> 'root',
    COALESCE(p_artifact ->> 'framework', 'Generic'),
    p_artifact -> 'stats',
    p_artifact -> 'coverage',
    COALESCE(p_artifact -> 'skippedFiles', '[]'::jsonb)
  )
  ON CONFLICT (analysis_id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    schema_version = EXCLUDED.schema_version,
    root = EXCLUDED.root,
    framework = EXCLUDED.framework,
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
