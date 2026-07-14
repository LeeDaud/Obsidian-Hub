interface QuickActionDockProps {
  canOpen: boolean;
  canPickRandom: boolean;
  refreshing: boolean;
  onAdd(): void;
  onRefresh(): void;
  onPickRandom(): void;
  onOpenSelected(): void;
}

const ACTIONS = [
  {
    key: 'add',
    label: '添加仓库',
    hint: '新的空间入口',
    path: 'M12 5v14M5 12h14',
  },
  {
    key: 'refresh',
    label: '刷新概览',
    hint: '重新统计本地内容',
    path: 'M19 8a7 7 0 1 0 1 6M19 4v4h-4',
  },
  {
    key: 'random',
    label: '随便看看',
    hint: '随机选中一个仓库',
    path: 'M4 7h3c4 0 6 10 10 10h3M17 4l3 3-3 3M4 17h3c1.4 0 2.5-1.2 3.5-2.8M16 7.5c.3-.3.6-.5 1-.5h3M17 14l3 3-3 3',
  },
  {
    key: 'open',
    label: '打开所选',
    hint: '进入当前空间',
    path: 'M5 12h14M14 7l5 5-5 5',
  },
] as const;

export function QuickActionDock({
  canOpen,
  canPickRandom,
  refreshing,
  onAdd,
  onRefresh,
  onPickRandom,
  onOpenSelected,
}: QuickActionDockProps) {
  const handlers = {
    add: onAdd,
    refresh: onRefresh,
    random: onPickRandom,
    open: onOpenSelected,
  };
  const disabled = {
    add: false,
    refresh: refreshing,
    random: !canPickRandom,
    open: !canOpen,
  };

  return (
    <nav className="quick-action-dock" aria-label="快捷入口">
      <header>
        <span>快捷入口</span>
        <small>QUICK ACTIONS</small>
      </header>
      <div>
        {ACTIONS.map((action) => (
          <button
            key={action.key}
            type="button"
            disabled={disabled[action.key]}
            onClick={handlers[action.key]}
          >
            <span className="quick-action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d={action.path} />
              </svg>
            </span>
            <span>
              <strong>{action.label}</strong>
              <small>{action.hint}</small>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
