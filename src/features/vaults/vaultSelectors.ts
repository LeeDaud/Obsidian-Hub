import type { SortMode, VaultListItem } from '../../domain/vault';

function timestamp(value: string | null): number {
  return value ? Date.parse(value) || 0 : 0;
}

export function matchesVault(vault: VaultListItem, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return true;

  return [vault.name, vault.path, vault.description, ...vault.tags].some((value) =>
    value.toLocaleLowerCase().includes(query),
  );
}

export function sortVaults(vaults: VaultListItem[], mode: SortMode): VaultListItem[] {
  return [...vaults].sort((left, right) => {
    if (mode === 'name') return left.name.localeCompare(right.name, 'zh-CN');
    if (mode === 'recent') return timestamp(right.lastOpenedAt) - timestamp(left.lastOpenedAt);

    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
    if (left.favorite && right.favorite) {
      const order =
        (left.favoriteOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.favoriteOrder ?? Number.MAX_SAFE_INTEGER);
      if (order !== 0) return order;
    }
    const recent = timestamp(right.lastOpenedAt) - timestamp(left.lastOpenedAt);
    return recent || left.name.localeCompare(right.name, 'zh-CN');
  });
}

export function formatLastOpened(value: string | null, now = Date.now()): string {
  if (!value) return '尚未打开';
  const elapsed = Math.max(0, now - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚打开';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}
