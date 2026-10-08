import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import type { WorkspaceChangeNotice } from '../domain/workspace';
import { tauriVaultGateway } from './vaultGateway';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

type Notice = WorkspaceChangeNotice & { sessionId: string };
let callback: EventCallback<Notice>;
const unlisten = vi.fn();
const notice = (sessionId = 'current'): Notice => ({
  sessionId,
  changes: [{ vaultId: 'v', relativePath: 'a.md' }],
  warningCodes: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    callback = handler as EventCallback<Notice>;
    return unlisten;
  });
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === 'start_workspace_watch' ? { sessionId: 'current', warningCodes: [] } : undefined,
  );
});

describe('workspace watch gateway', () => {
  it('subscribes before starting and filters stale sessions, with idempotent cleanup', async () => {
    const onChange = vi.fn();
    const stop = await tauriVaultGateway.watchWorkspace!(onChange);
    expect(vi.mocked(listen).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(invoke).mock.invocationCallOrder[0],
    );
    callback({ event: 'workspace-changed', id: 1, payload: notice('old') });
    expect(onChange).toHaveBeenCalledTimes(1);
    callback({ event: 'workspace-changed', id: 1, payload: notice() });
    expect(onChange).toHaveBeenLastCalledWith(notice());
    await stop();
    await stop();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenLastCalledWith('stop_workspace_watch', { sessionId: 'current' });
    callback({ event: 'workspace-changed', id: 1, payload: notice() });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('buffers notifications received before the native start response', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onChange = vi.fn();
    const starting = tauriVaultGateway.watchWorkspace!(onChange);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    callback({ event: 'workspace-changed', id: 1, payload: notice() });
    expect(onChange).not.toHaveBeenCalled();
    resolve({ sessionId: 'current', warningCodes: ['WORKSPACE_WATCH_NETWORK'] });
    const stop = await starting;
    expect(onChange).toHaveBeenNthCalledWith(1, {
      changes: [],
      warningCodes: ['WORKSPACE_WATCH_NETWORK'],
    });
    expect(onChange).toHaveBeenNthCalledWith(2, notice());
    await stop();
  });

  it('removes the event listener if native setup fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({
      code: 'WORKSPACE_WATCH_FAILED',
      message: 'Unavailable',
    });
    await expect(tauriVaultGateway.watchWorkspace!(vi.fn())).rejects.toMatchObject({
      code: 'WORKSPACE_WATCH_FAILED',
    });
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('passes only registered-relative scopes through the incremental command adapter', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    const changes = notice().changes;
    expect(await tauriVaultGateway.refreshWorkspacePaths!(changes)).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('refresh_workspace_paths', { changes });
  });
});
