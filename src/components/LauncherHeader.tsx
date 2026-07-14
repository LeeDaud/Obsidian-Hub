import { useEffect, useRef } from 'react';
import hubIcon from '../../assets/obsidian-hub.svg';
import type { SortMode } from '../domain/vault';
import { SortMenu } from './SortMenu';

interface LauncherHeaderProps {
  query: string;
  sortMode: SortMode;
  onQueryChange(value: string): void;
  onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void;
  onSortChange(mode: SortMode): void;
  onAdd(): void;
}

export function LauncherHeader({
  query,
  sortMode,
  onQueryChange,
  onSearchKeyDown,
  onSortChange,
  onAdd,
}: LauncherHeaderProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    function handleGlobalShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        onAdd();
      } else if (
        event.key === '/' &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, [onAdd]);

  return (
    <header className="launcher-header">
      <div className="brand" aria-label="Obsidian Hub">
        <span className="brand-mark" aria-hidden="true">
          <img src={hubIcon} alt="" />
        </span>
        <strong>Obsidian Hub</strong>
      </div>

      <label className="search-box">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <span className="sr-only">搜索仓库</span>
        <input
          ref={searchRef}
          type="search"
          aria-label="搜索仓库"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="搜索仓库、路径、描述或标签"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>Ctrl K</kbd>
      </label>

      <div className="header-actions">
        <SortMenu value={sortMode} onChange={onSortChange} />
        <button className="icon-button" type="button" aria-label="设置（即将开放）" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19 14.5v-5l-2-.7-.8-1.8.9-1.9-3.6-2.1-1.4 1.5H10L8.5 3 4.9 5.1 5.8 7 5 8.8l-2 .7v5l2 .7.8 1.8-.9 1.9L8.5 21l1.4-1.5h2.2l1.4 1.5 3.6-2.1-.9-1.9.8-1.8 2-.7Z" />
          </svg>
        </button>
        <button className="add-button" type="button" onClick={onAdd}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加仓库
        </button>
      </div>
    </header>
  );
}
