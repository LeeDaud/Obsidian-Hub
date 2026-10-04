import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  AppConfigV2,
  BridgeStatus,
  LaunchTarget,
  ObsidianVaultEntry,
  VaultOverview,
  VaultValidationResult,
} from '../domain/vault';
import { AppError, toAppError } from '../domain/appError';
import type {
  CreateWorkspaceNoteRequest,
  WorkspaceFileResult,
  WorkspaceNotePreview,
  WorkspaceSnapshot,
  WorkspaceState,
} from '../domain/workspace';

export interface VaultGateway {
  loadConfig(): Promise<AppConfigV2>;
  saveConfig(config: AppConfigV2): Promise<AppConfigV2>;
  chooseDirectory(): Promise<string | null>;
  chooseDirectories(): Promise<string[] | null>;
  validateDirectory(path: string): Promise<VaultValidationResult>;
  listObsidianVaults(): Promise<ObsidianVaultEntry[]>;
  loadOverviewCache(paths: string[]): Promise<VaultOverview | null>;
  scanOverview(paths: string[]): Promise<VaultOverview>;
  launch(target: LaunchTarget): Promise<string>;
  installBridge?(vaultPath: string, vaultId: string): Promise<string>;
  getBridgeStatus?(vaultPath: string, vaultId: string): Promise<BridgeStatus>;
  closeWindow(): Promise<void>;
  scanWorkspace?(): Promise<WorkspaceSnapshot>;
  loadWorkspaceCache?(): Promise<WorkspaceSnapshot | null>;
  createWorkspaceNote?(request: CreateWorkspaceNoteRequest): Promise<WorkspaceFileResult>;
  setWorkspaceTaskComplete?(
    vaultId: string,
    relativePath: string,
    lineNumber: number,
    expectedHash: string,
    complete: boolean,
  ): Promise<WorkspaceFileResult>;
  openWorkspaceNote?(vaultId: string, relativePath: string): Promise<string>;
  readWorkspaceNote?(
    vaultId: string,
    relativePath: string,
    expectedHash?: string,
  ): Promise<WorkspaceNotePreview>;
  loadWorkspaceState?(): Promise<WorkspaceState>;
  setTodayTask?(date: string, taskId: string, selected: boolean): Promise<WorkspaceState>;
  setEchoReviewed?(noteId: string, reviewed: boolean): Promise<WorkspaceState>;
}

export const tauriVaultGateway: VaultGateway = {
  async loadConfig() {
    try {
      return await invoke<AppConfigV2>('load_config');
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async saveConfig(config) {
    try {
      return await invoke<AppConfigV2>('save_config', { config });
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async chooseDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择 Obsidian 仓库',
      });
      return selected;
    } catch (reason) {
      throw new AppError({ code: 'DIALOG_FAILED', message: toAppError(reason).message });
    }
  },

  async chooseDirectories() {
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: '选择 Obsidian 仓库',
      });
      return selected;
    } catch (reason) {
      throw new AppError({ code: 'DIALOG_FAILED', message: toAppError(reason).message });
    }
  },

  async validateDirectory(path) {
    try {
      return await invoke<VaultValidationResult>('validate_vault_directory', { path });
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async listObsidianVaults() {
    try {
      return await invoke<ObsidianVaultEntry[]>('list_obsidian_vaults');
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async loadOverviewCache(paths) {
    try {
      return await invoke<VaultOverview | null>('load_overview_cache', { paths });
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async scanOverview(paths) {
    try {
      return await invoke<VaultOverview>('scan_vault_overview', { paths });
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async launch(target) {
    try {
      return await invoke<string>('launch_obsidian_vault', { target });
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async installBridge(vaultPath, vaultId) {
    try {
      return await invoke<string>('install_bridge_plugin', { vaultPath, vaultId });
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async getBridgeStatus(vaultPath, vaultId) {
    try {
      return await invoke<BridgeStatus>('get_bridge_status', { vaultPath, vaultId });
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async closeWindow() {
    await getCurrentWindow().close();
  },
  async scanWorkspace() {
    try {
      return await invoke<WorkspaceSnapshot>('scan_workspace');
    } catch (reason) {
      throw toAppError(reason);
    }
  },
  async loadWorkspaceCache() {
    try {
      return await invoke<WorkspaceSnapshot | null>('load_workspace_cache');
    } catch (reason) {
      throw toAppError(reason);
    }
  },
  async createWorkspaceNote(request) {
    try {
      return await invoke<WorkspaceFileResult>('create_workspace_note', { request });
    } catch (reason) {
      throw toAppError(reason);
    }
  },
  async setWorkspaceTaskComplete(vaultId, relativePath, lineNumber, expectedHash, complete) {
    try {
      return await invoke<WorkspaceFileResult>('set_workspace_task_complete', {
        vaultId,
        relativePath,
        lineNumber,
        expectedHash,
        complete,
      });
    } catch (reason) {
      throw toAppError(reason);
    }
  },
  async openWorkspaceNote(vaultId, relativePath) {
    try {
      return await invoke<string>('open_workspace_note', { vaultId, relativePath });
    } catch (reason) {
      throw toAppError(reason);
    }
  },
  async readWorkspaceNote(vaultId, relativePath, expectedHash) {
    try {
      return await invoke<WorkspaceNotePreview>('read_workspace_note', {
        vaultId,
        relativePath,
        expectedHash,
      });
    } catch (reason) {
      throw toAppError(reason);
    }
  },
  async loadWorkspaceState() {
    try {
      return await invoke<WorkspaceState>('load_workspace_state');
    } catch (reason) {
      throw toAppError(reason);
    }
  },
  async setTodayTask(date, taskId, selected) {
    try {
      return await invoke<WorkspaceState>('set_today_task', { date, taskId, selected });
    } catch (reason) {
      throw toAppError(reason);
    }
  },
  async setEchoReviewed(noteId, reviewed) {
    try {
      return await invoke<WorkspaceState>('set_echo_reviewed', { noteId, reviewed });
    } catch (reason) {
      throw toAppError(reason);
    }
  },
};
