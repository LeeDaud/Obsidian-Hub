export interface IndexedNote {
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
}
export interface SearchResponse {
  items: IndexedNote[];
}
export interface HubVault {
  id: string;
  name: string;
}
export interface VaultsResponse {
  items: HubVault[];
}
export interface BridgeHeartbeat {
  vaultId: string;
  vaultName: string;
  pluginVersion: string;
  obsidianVersion: string;
}
export type BridgeConnectionStatus =
  | 'connected'
  | 'hub-unavailable'
  | 'unauthorized'
  | 'index-not-ready';
