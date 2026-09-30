import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import type { UpdateGateway } from '../domain/update';

export const tauriUpdateGateway: UpdateGateway = {
  async check() {
    const currentVersion = await getVersion();
    const update = await check({ timeout: 15000 });
    return {
      currentVersion,
      update: update
        ? {
            version: update.version,
            notes: update.body?.trim() || '此版本未提供更新说明。',
            async install(onProgress) {
              let downloaded = 0;
              let total: number | undefined;
              await update.downloadAndInstall(
                (event) => {
                  if (event.event === 'Started') {
                    downloaded = 0;
                    total = event.data.contentLength;
                  } else if (event.event === 'Progress') {
                    downloaded += event.data.chunkLength;
                  }
                  onProgress({
                    phase: event.event === 'Finished' ? 'installing' : 'downloading',
                    downloaded,
                    total,
                  });
                },
                { timeout: 60000 },
              );
            },
            close: () => update.close(),
          }
        : null,
    };
  },
  restart: relaunch,
};
