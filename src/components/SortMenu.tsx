import { useEffect, useRef, useState } from 'react';
import type { SortMode } from '../domain/vault';

interface SortMenuProps {
  value: SortMode;
  onChange(value: SortMode): void;
}

const OPTIONS: ReadonlyArray<{ value: SortMode; label: string; description: string }> = [
  { value: 'favoriteThenRecent', label: '智能排序', description: '收藏优先，其次按最近使用' },
  { value: 'recent', label: '最近使用', description: '最近打开的仓库排在前面' },
  { value: 'name', label: '按名称', description: '按仓库名称排列' },
];

export function SortMenu({ value, onChange }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('.sort-trigger')?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape, true);
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-sort-value="${value}"]`)?.focus();
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [open, value]);

  return (
    <div className="sort-menu" ref={rootRef}>
      <button
        type="button"
        className={`sort-trigger${open ? ' is-open' : ''}`}
        aria-label={`仓库排序：${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 6h10M9 12h6M11 18h2" />
        </svg>
        <span>{current.label}</span>
        <svg className="sort-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m8 10 4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div className="sort-popover" role="menu" aria-label="选择仓库排序方式">
          <span className="sort-popover-label">排序方式</span>
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              data-sort-value={option.value}
              className={option.value === value ? 'is-selected' : ''}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="sort-option-check" aria-hidden="true">
                {option.value === value ? '✓' : ''}
              </span>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
