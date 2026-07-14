interface EmptyStateProps {
  searching: boolean;
  onAdd(): void;
  onClear(): void;
}

export function EmptyState({ searching, onAdd, onClear }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
        </svg>
      </span>
      <strong>{searching ? '未找到匹配的仓库' : '还没有添加 Obsidian 仓库'}</strong>
      <p>
        {searching
          ? '换个关键词，或清空搜索查看全部仓库。'
          : '手动添加一个已有仓库，即可从这里快速启动。'}
      </p>
      <div>
        {searching ? (
          <button type="button" className="secondary-button" onClick={onClear}>
            清空搜索
          </button>
        ) : null}
        <button type="button" className="primary-button" onClick={onAdd}>
          添加仓库
        </button>
        {!searching ? (
          <button
            type="button"
            className="secondary-button"
            disabled
            title="自动扫描将在后续版本开放"
          >
            扫描目录
          </button>
        ) : null}
      </div>
    </div>
  );
}
