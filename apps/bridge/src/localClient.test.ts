import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalClient } from './localClient';
import { DEFAULT_SETTINGS } from './types';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('LocalClient registry compatibility', () => {
  it.each([1, 2])(
    'reads only registered vault identity from schema version %i',
    async (schemaVersion) => {
      const directory = mkdtempSync(path.join(tmpdir(), 'hub-bridge-registry-'));
      temporaryDirectories.push(directory);
      const registryPath = path.join(directory, 'config.json');
      writeFileSync(
        registryPath,
        JSON.stringify({
          schemaVersion,
          workspace: { hubVaultId: 'hub', initializedAt: '2026-10-02T00:00:00Z' },
          vaults: [{ id: 'main', name: 'Main', path: path.join(directory, 'Main'), role: 'main' }],
        }),
      );
      const client = new LocalClient(() => ({ ...DEFAULT_SETTINGS, registryPath }));
      await client.load();
      expect(await client.vaults()).toEqual([{ id: 'main', name: 'Main' }]);
    },
  );
});
