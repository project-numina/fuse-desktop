import type { RepositorySource } from '@/lib/api';

export interface SourceUploadModalProps {
  open: boolean;
  owner?: string;
  repository?: string;
  blueprintId?: string;
  mode?: 'upload' | 'write';
  existingNames?: string[];
  onOpenChange: (open: boolean) => void;
  onUploaded: (source: RepositorySource) => void;
}

export type SourceUploadStep = 'select' | 'name';
