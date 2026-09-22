import { describe, expect, it } from 'vitest';
import { findCrossVaultLinks, parseCrossVaultLink, serializeCrossVaultLink } from './index';

describe('cross-vault parser', () => {
  it.each([
    ['@Vault[[Note]]', 'Vault', 'Note'],
    ['@Vault[[Folder/Note]]', 'Vault', 'Folder/Note'],
    ['@My Vault[[中文 路径/笔记]]', 'My Vault', '中文 路径/笔记'],
    ['＠中文仓库【【目录/笔记】】', '中文仓库', '目录/笔记'],
  ])('parses %s', (raw, vaultName, notePath) => {
    expect(parseCrossVaultLink(raw)).toMatchObject({ vaultName, notePath, embed: false });
  });

  it('parses alias, heading and block variants', () => {
    expect(parseCrossVaultLink('@Vault[[Note|Alias]]')?.alias).toBe('Alias');
    expect(parseCrossVaultLink('@Vault[[Note#Heading]]')?.heading).toBe('Heading');
    expect(parseCrossVaultLink('@Vault[[Note^block]]')?.blockId).toBe('block');
  });

  it('ignores native links, email addresses and incomplete links', () => {
    expect(parseCrossVaultLink('[[普通链接]]')).toBeNull();
    expect(parseCrossVaultLink('[[[旧跨仓库语法]]]')).toBeNull();
    expect(findCrossVaultLinks('mail@example.com [[普通]] @A[[一]] x @B[[二|别名]]')).toHaveLength(
      2,
    );
    expect(findCrossVaultLinks('@Vault[[不完整')).toHaveLength(0);
  });

  it('serializes the new scoped wikilink syntax', () => {
    const raw = serializeCrossVaultLink({
      vaultName: 'Vault',
      notePath: 'Folder/Note',
      alias: 'Alias',
      heading: 'H',
      embed: false,
    });
    expect(raw).toBe('@Vault[[Folder/Note#H|Alias]]');
    expect(parseCrossVaultLink(raw)).toMatchObject({ alias: 'Alias', heading: 'H' });
  });

  it('parses and serializes the stable vault id suffix', () => {
    expect(parseCrossVaultLink('@Vault:id[[Note]]')).toMatchObject({
      vaultName: 'Vault',
      vaultId: 'id',
      notePath: 'Note',
    });
    const raw = serializeCrossVaultLink({
      vaultName: 'Vault',
      vaultId: '550e8400-e29b-41d4-a716-446655440000',
      notePath: 'Folder/Note',
      embed: false,
    });
    expect(raw).toBe('@Vault:550e8400-e29b-41d4-a716-446655440000[[Folder/Note]]');
    expect(parseCrossVaultLink(raw)).toMatchObject({
      vaultName: 'Vault',
      vaultId: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('parses legacy name-only links without an id', () => {
    expect(parseCrossVaultLink('@Vault[[Note]]')?.vaultId).toBeUndefined();
  });
});
