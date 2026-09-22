export interface BridgeSettings {
  registryPath: string;
  vaultId: string;
  excludeCurrentVault: boolean;
  showCrossVaultIcon: boolean;
  resultLimit: number;
}
export const DEFAULT_SETTINGS: BridgeSettings = {
  registryPath: '',
  vaultId: '',
  excludeCurrentVault: true,
  showCrossVaultIcon: true,
  resultLimit: 20,
};
