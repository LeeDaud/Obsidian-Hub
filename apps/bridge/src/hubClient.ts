import type {
  BridgeHeartbeat,
  HubVault,
  IndexedNote,
  SearchResponse,
  VaultsResponse,
} from '@obsidian-hub/protocol';
import { requestUrl } from 'obsidian';
import type { BridgeSettings } from './types';

export class HubClient {
  constructor(private readonly settings: () => BridgeSettings) {}
  currentVaultId(): string {
    return this.settings().vaultId;
  }
  private async request<T>(
    path: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<T> {
    const settings = this.settings();
    let timeoutId = 0;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error('HUB_REQUEST_TIMEOUT')),
        settings.requestTimeoutMs,
      );
    });
    try {
      const response = await Promise.race([
        requestUrl({
          url: `${settings.apiBaseUrl}${path}`,
          method: init?.method ?? 'GET',
          body: init?.body,
          throw: false,
          headers: {
            Authorization: `Bearer ${settings.token}`,
            'Content-Type': 'application/json',
            ...init?.headers,
          },
        }),
        timeout,
      ]);
      if (response.status >= 400) {
        throw new Error(response.status === 401 ? 'UNAUTHORIZED' : 'HUB_REQUEST_FAILED');
      }
      return response.json as T;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  health() {
    return this.request<{ status: string }>('/api/v1/health');
  }
  async vaults(): Promise<HubVault[]> {
    return (await this.request<VaultsResponse>('/api/v1/vaults')).items;
  }
  async search(query: string, vaultId?: string): Promise<IndexedNote[]> {
    const settings = this.settings();
    const params = new URLSearchParams({ q: query, limit: String(settings.resultLimit) });
    if (settings.excludeCurrentVault && settings.vaultId)
      params.set('excludeVaultId', settings.vaultId);
    if (vaultId) params.set('vaultId', vaultId);
    return (await this.request<SearchResponse>(`/api/v1/search?${params}`)).items;
  }
  resolve(vault: string, path: string) {
    return this.request<IndexedNote>(
      `/api/v1/notes/resolve?vault=${encodeURIComponent(vault)}&path=${encodeURIComponent(path)}`,
    );
  }
  heartbeat(payload: BridgeHeartbeat) {
    return this.request<{ status: string }>('/api/v1/bridge/heartbeat', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
  open(note: IndexedNote, heading?: string, blockId?: string) {
    return this.request<{ uri: string }>('/api/v1/open', {
      method: 'POST',
      body: JSON.stringify({
        vaultId: note.vaultId,
        relativePath: note.relativePath,
        heading: heading ?? null,
        blockId: blockId ?? null,
      }),
    });
  }
}
