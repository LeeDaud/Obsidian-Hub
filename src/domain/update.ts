export interface UpdateProgress {
  phase: 'downloading' | 'installing';
  downloaded: number;
  total?: number;
}

export interface AvailableUpdate {
  version: string;
  notes: string;
  install(onProgress: (progress: UpdateProgress) => void): Promise<void>;
  close(): Promise<void>;
}

export interface UpdateCheckResult {
  currentVersion: string;
  update: AvailableUpdate | null;
}

export interface UpdateGateway {
  check(): Promise<UpdateCheckResult>;
  restart(): Promise<void>;
}
