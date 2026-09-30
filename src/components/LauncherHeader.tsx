import { useEffect, useRef } from 'react';
import hubIcon from '../../assets/obsidian-hub.svg';
import type { SortMode } from '../domain/vault';
import { SortMenu } from './SortMenu';
import { UpdateControl } from './UpdateControl';

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
        <UpdateControl />
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
