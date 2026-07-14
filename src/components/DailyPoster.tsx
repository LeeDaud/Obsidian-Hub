import type { VaultOverview } from '../domain/vault';

interface DailyPosterProps {
  overview: VaultOverview | null;
}

const numberFormat = new Intl.NumberFormat('zh-CN');

export function DailyPoster({ overview }: DailyPosterProps) {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(today).toUpperCase();

  return (
    <aside className="daily-poster" aria-label="今日空间海报">
      <span className="poster-orbit" aria-hidden="true" />
      <span className="poster-kicker">TODAY · SPACES</span>
      <strong className="poster-date">
        {month}
        <i>/</i>
        {day}
      </strong>
      <span className="poster-weekday">{weekday}</span>
      <div className="poster-summary">
        <span>{overview ? numberFormat.format(overview.vaultCount) : '—'} VAULTS</span>
        <span>{overview ? numberFormat.format(overview.noteCount) : '—'} NOTES</span>
      </div>
    </aside>
  );
}
