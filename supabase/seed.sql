-- Seed script for Codegraph Phase 2

INSERT INTO public.organizations (id, name)
VALUES 
  ('org_sample_alpha', 'Alpha Team'),
  ('org_sample_beta', 'Beta Team')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.projects (id, org_id, name, repo_url, default_branch)
VALUES 
  ('a1111111-1111-1111-1111-111111111111', 'org_sample_alpha', 'vercel/next.js', 'https://github.com/vercel/next.js', 'canary'),
  ('b2222222-2222-2222-2222-222222222222', 'org_sample_beta', 'facebook/react', 'https://github.com/facebook/react', 'main')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.analyses (id, project_id, org_id, commit_sha, status, error_message, parsed_files_count, created_at, completed_at)
VALUES
  ('a1111111-2222-3333-4444-555555555555', 'a1111111-1111-1111-1111-111111111111', 'org_sample_alpha', '7f8a9b0c', 'completed', NULL, 1420, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour'),
  ('a1111111-2222-3333-4444-666666666666', 'a1111111-1111-1111-1111-111111111111', 'org_sample_alpha', '3e2d1c0a', 'parsing', NULL, 350, NOW() - INTERVAL '10 minutes', NULL),
  ('b2222222-3333-4444-5555-666666666666', 'b2222222-2222-2222-2222-222222222222', 'org_sample_beta', '9a8b7c6d', 'completed', NULL, 890, NOW() - INTERVAL '1 day', NOW() - INTERVAL '23 hours')
ON CONFLICT (id) DO NOTHING;
