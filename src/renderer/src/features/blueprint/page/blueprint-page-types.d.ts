import type {
  BlueprintAgentConfig,
  BlueprintBranchStatus,
  BranchFreshness,
} from '@/lib/api';
import type { BlueprintEntry } from '@/features/blueprint/hooks/latex-parser';

/** Mutable API payload shared by the page's orchestration hooks. */
export interface BlueprintData {
  id: string;
  name?: string;
  description?: string;
  blueprint_file?: string;
  blueprint_content?: string;
  included_files?: string[];
  chapter_titles?: Record<string, string>;
  chapter_contents?: Record<string, string>;
  chapter_references?: Record<string, string>;
  entries?: BlueprintEntry[];
  latex_macros?: Record<string, string>;
  source_type?: string;
  source_content?: string;
  source_file_url?: string;
  source_pdf_url?: string;
  ocr_phase?: string | null;
  is_merged?: boolean;
  can_edit?: boolean;
  open_pr_number?: number | null;
  pr_mode?: 'off' | 'draft' | 'ready';
  auto_commit?: boolean;
  orchestrator_child_concurrency?: number;
  project_subdir?: string;
  all_lean_files?: string[];
  lean_files?: string[];
  file_diff_stats?: Record<string, unknown>;
  branch_status?: BlueprintBranchStatus | null;
  branch_freshness?: BranchFreshness | null;
  runtime_route_tag?: string | null;
  agent?: BlueprintAgentConfig | null;
}

export interface BlueprintRouteIdentity {
  owner: string;
  repo: string;
  blueprintId: string;
}
