import { describe, expect, it } from 'vitest';
import type { VaultListItem } from '../../domain/vault';
import { formatLastOpened, matchesVault, sortVaults } from './vaultSelectors';

function vault(overrides: Partial<VaultListItem> = {}): VaultListItem {
  return {
    id: 'one',
    name: 'Main Vault',
    path: 'D:\\Notes\\Main',
    description: '长期知识库',
    tags: ['knowledge'],
    obsidianVaultId: null,
    favorite: false,
    favoriteOrder: null,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    lastOpenedAt: null,
    pathStatus: 'valid',
    ...overrides,
  };
}

describe('vaultSelectors', () => {
  it('searches name, path, description and tags', () => {
    const item = vault();
    expect(matchesVault(item, 'main')).toBe(true);
    expect(matchesVault(item, 'notes')).toBe(true);
    expect(matchesVault(item, '长期')).toBe(true);
    expect(matchesVault(item, 'knowledge')).toBe(true);
    expect(matchesVault(item, 'missing')).toBe(false);
  });

  it('sorts favorites before recent vaults', () => {
    const items = [
      vault({ id: 'recent', name: 'Recent', lastOpenedAt: '2026-07-14T10:00:00.000Z' }),
      vault({ id: 'favorite', name: 'Favorite', favorite: true, favoriteOrder: 0 }),
    ];
    expect(sortVaults(items, 'favoriteThenRecent').map((item) => item.id)).toEqual([
      'favorite',
      'recent',
    ]);
  });

  it('formats relative opened time', () => {
    expect(
      formatLastOpened('2026-07-14T09:59:00.000Z', Date.parse('2026-07-14T10:00:00.000Z')),
    ).toBe('1 分钟前');
  });
});
