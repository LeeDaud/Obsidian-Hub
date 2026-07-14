import type { VaultOverview } from '../domain/vault';

interface LibraryOverviewProps {
  overview: VaultOverview | null;
  refreshing: boolean;
  error: string | null;
  onRefresh(): void;
}

const numberFormat = new Intl.NumberFormat('zh-CN');

function Metric({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="overview-metric">
      <strong>{value === null ? '—' : numberFormat.format(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

export function LibraryOverview({ overview, refreshing, error, onRefresh }: LibraryOverviewProps) {
  const updatedAt = overview
    ? new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(overview.scannedAt)
    : null;
  const skipped = overview ? overview.vaultCount - overview.scannedVaultCount : 0;

  return (
    <section className="library-overview" aria-labelledby="library-overview-title">
      <div className="overview-heading">
        <span className="overview-symbol" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 5.5h10A2.5 2.5 0 0 1 17.5 8v10H7.25A2.25 2.25 0 0 1 5 15.75V5.5Z" />
            <path d="M7.25 18A2.25 2.25 0 0 1 5 15.75m3-6.25h6" />
          </svg>
        </span>
        <div>
          <h2 id="library-overview-title">库概览</h2>
          <span>
            {error
              ? '暂时无法更新'
              : refreshing
                ? '正在后台统计…'
                : skipped > 0
                  ? `${skipped} 个仓库未能访问`
                  : updatedAt
                    ? `更新于 ${updatedAt}`
                    : '等待首次统计'}
          </span>
        </div>
      </div>
      <div className="overview-metrics">
        <Metric value={overview?.vaultCount ?? null} label="仓库" />
        <Metric value={overview?.folderCount ?? null} label="文件夹" />
        <Metric value={overview?.noteCount ?? null} label="笔记" />
      </div>
      <button
        type="button"
        className={`overview-refresh${refreshing ? ' is-refreshing' : ''}`}
        aria-label="重新统计库概览"
        title="重新统计"
        disabled={refreshing}
        onClick={onRefresh}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 8a7 7 0 1 0 1 6M19 4v4h-4" />
        </svg>
      </button>
    </section>
  );
}
