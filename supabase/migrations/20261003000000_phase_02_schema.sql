-- Migration: 20261003000000_phase_02_schema.sql
-- Description: Phase 02 Database Schema & Row Level Security Policies

CREATE TABLE IF NOT EXISTS public.organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  commit_sha TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  parsed_files_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'typescript',
  lines INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  target_file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  import_specifier TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'import',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.explanations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  cache_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.file_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.explanations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

-- RLS Policies checking auth.jwt() ->> 'org_id'
DROP POLICY IF EXISTS "Org members access organization" ON public.organizations;
CREATE POLICY "Org members access organization" ON public.organizations
  FOR ALL USING (id = (auth.jwt() ->> 'org_id')) WITH CHECK (id = (auth.jwt() ->> 'org_id'));

DROP POLICY IF EXISTS "Org members access projects" ON public.projects;
CREATE POLICY "Org members access projects" ON public.projects
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')) WITH CHECK (org_id = (auth.jwt() ->> 'org_id'));

DROP POLICY IF EXISTS "Org members access analyses" ON public.analyses;
CREATE POLICY "Org members access analyses" ON public.analyses
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')) WITH CHECK (org_id = (auth.jwt() ->> 'org_id'));

DROP POLICY IF EXISTS "Org members access files" ON public.files;
CREATE POLICY "Org members access files" ON public.files
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')) WITH CHECK (org_id = (auth.jwt() ->> 'org_id'));

DROP POLICY IF EXISTS "Org members access edges" ON public.edges;
CREATE POLICY "Org members access edges" ON public.edges
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')) WITH CHECK (org_id = (auth.jwt() ->> 'org_id'));

DROP POLICY IF EXISTS "Org members access routes" ON public.routes;
CREATE POLICY "Org members access routes" ON public.routes
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')) WITH CHECK (org_id = (auth.jwt() ->> 'org_id'));

DROP POLICY IF EXISTS "Org members access explanations" ON public.explanations;
CREATE POLICY "Org members access explanations" ON public.explanations
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')) WITH CHECK (org_id = (auth.jwt() ->> 'org_id'));

DROP POLICY IF EXISTS "Org members access file_roles" ON public.file_roles;
CREATE POLICY "Org members access file_roles" ON public.file_roles
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')) WITH CHECK (org_id = (auth.jwt() ->> 'org_id'));

DROP POLICY IF EXISTS "Org members access insights" ON public.insights;
CREATE POLICY "Org members access insights" ON public.insights
  FOR ALL USING (org_id = (auth.jwt() ->> 'org_id')) WITH CHECK (org_id = (auth.jwt() ->> 'org_id'));
