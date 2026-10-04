// @vitest-environment node
import { Buffer } from 'node:buffer';
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createUpdateManifest } from './prepareUpdate.mjs';

const input = {
  version: '0.4.0',
  signature: Buffer.from('untrusted comment: fixture signature').toString('base64'),
  installerName: 'Obsidian Hub_0.4.0_x64-setup.exe',
  notes: '更新说明',
  date: '2026-09-30T00:00:00Z',
};
describe('release manifest', () => {
  it('keeps preview packages on immutable version tags with a separate product name', () => {
    const manifest = createUpdateManifest({
      ...input,
      preview: true,
      version: '2.0.0-preview.1',
      installerName: 'Obsidian Hub 2 Preview_2.0.0-preview.1_x64-setup.exe',
    });
    assert.equal(
      manifest.platforms['windows-x86_64'].url,
      'https://github.com/LeeDaud/Obsidian-Hub/releases/download/v2.0.0-preview.1/Obsidian.Hub.2.Preview_2.0.0-preview.1_x64-setup.exe',
    );
  });
  it('rejects mixing stable and preview versions or installers', () => {
    assert.throws(() => createUpdateManifest({ ...input, preview: true }));
    assert.throws(() => createUpdateManifest({ ...input, version: '2.0.0-preview.1' }));
    assert.throws(() =>
      createUpdateManifest({
        ...input,
        preview: true,
        version: '2.0.0-preview.1',
        installerName: 'Obsidian Hub_2.0.0-preview.1_x64-setup.exe',
      }),
    );
  });
  it('uses the matching versioned HTTPS asset and signature content', () => {
    const manifest = createUpdateManifest(input);
    assert.equal(
      manifest.platforms['windows-x86_64'].url,
      'https://github.com/LeeDaud/Obsidian-Hub/releases/download/v0.4.0/Obsidian.Hub_0.4.0_x64-setup.exe',
    );
    assert.equal(manifest.platforms['windows-x86_64'].signature, input.signature);
    assert.equal(manifest.version, '0.4.0');
  });
  it('rejects mismatched installers, unsigned artifacts and prerelease versions', () => {
    assert.throws(() => createUpdateManifest({ ...input, installerName: 'old.exe' }));
    assert.throws(() => createUpdateManifest({ ...input, signature: '' }));
    assert.throws(() =>
      createUpdateManifest({ ...input, signature: 'https://example.com/signature' }),
    );
    assert.throws(() => createUpdateManifest({ ...input, version: '0.4.0-beta' }));
  });
});
