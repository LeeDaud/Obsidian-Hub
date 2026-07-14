interface StatusBarProps {
  count: number;
  message: string;
  error: string | null;
}

export function StatusBar({ count, message, error }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>{count} 个仓库</span>
      <span className={error ? 'status-error' : undefined}>{error ?? message}</span>
      <span>↑↓ 选择 · Enter 打开 · Esc 清空</span>
    </footer>
  );
}
