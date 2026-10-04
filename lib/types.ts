export type AnalysisStatus = 'pending' | 'parsing' | 'completed' | 'failed';

export interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  repo_url: string;
  default_branch: string;
  created_at: string;
}

export interface AnalysisRow {
  id: string;
  project_id: string;
  org_id: string;
  commit_sha: string | null;
  status: AnalysisStatus;
  error_message: string | null;
  parsed_files_count: number;
  created_at: string;
  completed_at: string | null;
  projects?: {
    id: string;
    name: string;
    repo_url: string;
  } | null;
}
