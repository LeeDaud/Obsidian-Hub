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

export interface WorkflowNoteRef {
  vaultId: string;
  relativePath: string;
}
export interface WorkflowLink {
  source: WorkflowNoteRef;
  target: WorkflowNoteRef;
  kind: 'origin' | 'reference';
}
export interface WorkflowLinkStore {
  schemaVersion: 1;
  links: WorkflowLink[];
}
export interface WorkflowLinkRequest {
  link: WorkflowLink;
  sourceHash: string;
  targetHash: string;
  linked: boolean;
}

export interface WorkspaceSnapshot {
  relations?: WorkflowLink[];
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
  eventWarning?: string;
}

export interface WorkspaceFileResult {
  vaultId: string;
  relativePath: string;
  contentHash: string;
  eventWarning?: string;
}

export interface WorkflowEventNoteRef {
  vaultId: string;
  relativePath: string;
}

export interface WorkflowEvent {
  schemaVersion: 1;
  id: string;
  occurredAt: string;
  kind: 'noteCreated' | 'taskUpdated' | 'echoReviewUpdated';
  outcome: 'succeeded' | 'failed';
  source?: WorkflowEventNoteRef;
  target?: WorkflowEventNoteRef;
  detail?: { noteKind?: string; complete?: boolean; reviewed?: boolean };
  errorCode?: string;
}

export interface WorkflowEventQuery {
  events: WorkflowEvent[];
  hasWarnings: boolean;
  skippedLines: number;
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
