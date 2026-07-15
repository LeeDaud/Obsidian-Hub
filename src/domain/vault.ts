export type ThemeMode = 'system' | 'light' | 'dark';
export type SortMode = 'favoriteThenRecent' | 'recent' | 'name';
export type VaultPathStatus = 'checking' | 'valid' | 'invalid';
export type BridgeState =
  | 'checking'
  | 'not-installed'
  | 'installed-disabled'
  | 'connected'
  | 'outdated'
  | 'unknown';

export interface BridgeStatus {
  state: Exclude<BridgeState, 'checking' | 'unknown'>;
  installedVersion: string | null;
  bundledVersion: string;
}

export interface VaultEntry {
  id: string;
  name: string;
  path: string;
  description: string;
  tags: string[];
  obsidianVaultId: string | null;
  favorite: boolean;
  favoriteOrder: number | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface Preferences {
  theme: ThemeMode;
  sortMode: SortMode;
  closeAfterLaunch: boolean;
}

export interface AppConfigV1 {
  schemaVersion: 1;
  preferences: Preferences;
  vaults: VaultEntry[];
}

export interface VaultListItem extends VaultEntry {
  pathStatus: VaultPathStatus;
}

export interface VaultValidationResult {
  canonicalPath: string;
  suggestedName: string;
}

export interface VaultOverview {
  vaultCount: number;
  scannedVaultCount: number;
  noteCount: number;
  folderCount: number;
  scannedAt: number;
}

export type LaunchTarget = Pick<VaultEntry, 'name' | 'obsidianVaultId'>;

export interface NewVaultInput {
  name: string;
  path: string;
  description: string;
  tags: string[];
  obsidianVaultId: string | null;
}
