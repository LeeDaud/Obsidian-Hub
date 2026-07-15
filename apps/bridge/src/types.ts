export interface BridgeSettings {
  apiBaseUrl: string;
  token: string;
  vaultId: string;
  excludeCurrentVault: boolean;
  showCrossVaultIcon: boolean;
  resultLimit: number;
  requestTimeoutMs: number;
}
export const DEFAULT_SETTINGS: BridgeSettings = {
  apiBaseUrl: 'http://127.0.0.1:27124',
  token: '',
  vaultId: '',
  excludeCurrentVault: true,
  showCrossVaultIcon: true,
  resultLimit: 20,
  requestTimeoutMs: 1500,
};
