ALTER TABLE public.explanations
  ALTER COLUMN file_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS subject_type TEXT NOT NULL DEFAULT 'file',
  ADD COLUMN IF NOT EXISTS subject_key TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'legacy';

UPDATE public.explanations AS explanation
SET subject_key = file.path
FROM public.files AS file
WHERE explanation.file_id = file.id AND explanation.subject_key IS NULL;

UPDATE public.explanations
SET subject_key = 'legacy:' || id::text
WHERE subject_key IS NULL;

ALTER TABLE public.explanations
  ALTER COLUMN subject_key SET NOT NULL;

WITH ranked AS (
  SELECT ctid, row_number() OVER (
    PARTITION BY analysis_id, subject_type, subject_key, cache_hash, model
    ORDER BY created_at DESC, id DESC
  ) AS position
  FROM public.explanations
)
DELETE FROM public.explanations AS explanation
USING ranked
WHERE explanation.ctid = ranked.ctid AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS explanations_content_cache_unique
  ON public.explanations (analysis_id, subject_type, subject_key, cache_hash, model);

ALTER TABLE public.file_roles
  ALTER COLUMN role DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS cache_hash TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'legacy';

WITH ranked AS (
  SELECT ctid, row_number() OVER (
    PARTITION BY analysis_id, file_id, cache_hash, model
    ORDER BY created_at DESC, id DESC
  ) AS position
  FROM public.file_roles
)
DELETE FROM public.file_roles AS file_role
USING ranked
WHERE file_role.ctid = ranked.ctid AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS file_roles_content_cache_unique
  ON public.file_roles (analysis_id, file_id, cache_hash, model);
