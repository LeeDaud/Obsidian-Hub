export interface WorkspaceNote {
  id: string;
  vaultId: string;
  vaultName: string;
  relativePath: string;
  fileName: string;
  title: string;
  aliases: string[];
  tags: string[];
  modifiedAt: number;
  size: number;
  contentHash: string;
}

export interface WorkspaceTask {
  id: string;
  vaultId: string;
  vaultName: string;
  relativePath: string;
  lineNumber: number;
  text: string;
  complete: boolean;
  contentHash: string;
}

export interface WorkspaceSnapshot {
  notes: WorkspaceNote[];
  tasks: WorkspaceTask[];
  vaultStatuses: Array<{ vaultId: string; online: boolean; readErrors: number }>;
  scannedAt: number;
  fromCache: boolean;
}

export interface WorkspaceState {
  schemaVersion: 1;
  todayPlan: Record<string, string[]>;
  reviewed: string[];
}

export interface WorkspaceFileResult {
  vaultId: string;
  relativePath: string;
  contentHash: string;
}

export interface WorkspaceNotePreview {
  vaultId: string;
  vaultName: string;
  relativePath: string;
  content: string;
  contentHash: string;
  changed: boolean;
}

export interface WorkspaceNoteSource {
  vaultId: string;
  relativePath: string;
  contentHash: string;
}

export interface CreateWorkspaceNoteRequest {
  kind: 'cognition' | 'output';
  title: string;
  source: WorkspaceNoteSource;
  references: WorkspaceNoteSource[];
}
