import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  AppConfigV1,
  BridgeStatus,
  LaunchTarget,
  ObsidianVaultEntry,
  VaultOverview,
  VaultValidationResult,
} from '../domain/vault';
import { AppError, toAppError } from '../domain/appError';

export interface VaultGateway {
  loadConfig(): Promise<AppConfigV1>;
  saveConfig(config: AppConfigV1): Promise<AppConfigV1>;
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
}

export const tauriVaultGateway: VaultGateway = {
  async loadConfig() {
    try {
      return await invoke<AppConfigV1>('load_config');
    } catch (reason) {
      throw toAppError(reason);
    }
  },

  async saveConfig(config) {
    try {
      return await invoke<AppConfigV1>('save_config', { config });
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
};
