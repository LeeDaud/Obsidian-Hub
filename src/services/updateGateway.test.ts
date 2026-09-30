import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getVersion } from '@tauri-apps/api/app';
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { tauriUpdateGateway } from './updateGateway';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVersion).mockResolvedValue('0.4.0');
});

describe('updateGateway', () => {
  it('preserves no-update and bounds the check timeout', async () => {
    vi.mocked(check).mockResolvedValue(null);
    expect(await tauriUpdateGateway.check()).toEqual({ currentVersion: '0.4.0', update: null });
    expect(check).toHaveBeenCalledWith({ timeout: 15000 });
  });

  it('propagates failures instead of claiming the app is current', async () => {
    vi.mocked(check).mockRejectedValue(new Error('network failure'));
    await expect(tauriUpdateGateway.check()).rejects.toThrow('network failure');
  });

  it.each([100, undefined])(
    'adapts download progress and closes native resources (length %s)',
    async (total) => {
      const native = {
        version: '0.5.0',
        body: '  更新说明  ',
        close: vi.fn().mockResolvedValue(undefined),
        downloadAndInstall: vi
          .fn()
          .mockImplementation(async (report: (event: DownloadEvent) => void) => {
            report({ event: 'Started', data: { contentLength: total } });
            report({ event: 'Progress', data: { chunkLength: 20 } });
            report({ event: 'Progress', data: { chunkLength: 30 } });
            report({ event: 'Finished' });
          }),
      };
      vi.mocked(check).mockResolvedValue(native as unknown as Update);
      const { update } = await tauriUpdateGateway.check();
      expect(update?.notes).toBe('更新说明');
      const report = vi.fn();
      await update!.install(report);
      expect(report).toHaveBeenNthCalledWith(3, { phase: 'downloading', downloaded: 50, total });
      expect(report).toHaveBeenLastCalledWith({ phase: 'installing', downloaded: 50, total });
      await update!.close();
      expect(native.close).toHaveBeenCalledOnce();
    },
  );

  it('delegates process restart', async () => {
    await tauriUpdateGateway.restart();
    expect(relaunch).toHaveBeenCalledOnce();
  });
});
