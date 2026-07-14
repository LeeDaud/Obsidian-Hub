function greetingForHour(hour: number): string {
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

const DAILY_PROMPTS = [
  '今天准备进入哪个空间？',
  '这次想把注意力放在哪里？',
  '为此刻的想法，选择一个合适的空间。',
  '今天从哪个入口开始？',
  '不同的思考，值得拥有不同的空间。',
  '选择一个仓库，然后进入状态。',
] as const;

const DAILY_CLOSINGS = [
  '为不同的思考，保留不同的空间。',
  '每个仓库，都保存着一段独立的上下文。',
  '选择一个入口，进入一段完整的专注。',
  '你的内容没有消失，只是住在不同的地方。',
  '打开空间之前，先决定把注意力放在哪里。',
  '让每一次进入，都有清晰的方向。',
] as const;

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000);
}

function TimeOfDayIcon({ hour }: { hour: number }) {
  if (hour >= 18 || hour < 6) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 15.2A8 8 0 0 1 8.8 5a8 8 0 1 0 10.2 10.2Z" />
        <path d="m17.5 4 .4 1.1L19 5.5l-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </svg>
  );
}

export function GreetingHeader() {
  const now = new Date();
  const prompt = DAILY_PROMPTS[dayOfYear(now) % DAILY_PROMPTS.length];
  const date = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now);
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  const monday = new Date(now);
  const weekdayIndex = (now.getDay() + 6) % 7;
  monday.setDate(now.getDate() - weekdayIndex);
  const week = Array.from({ length: 7 }, (_, index) => {
    const value = new Date(monday);
    value.setDate(monday.getDate() + index);
    return value;
  });

  return (
    <header className="greeting-header">
      <div>
        <span className="greeting-kicker">{greetingForHour(now.getHours())}</span>
        <h1>{prompt}</h1>
        <p>所有仓库都在这里，选择权始终属于你。</p>
      </div>
      <div className="local-time" aria-label={`${date} ${time}`}>
        <strong>
          <TimeOfDayIcon hour={now.getHours()} />
          {time}
        </strong>
        <span>{date}</span>
        <div className="week-strip" aria-label="本周日期">
          {week.map((value, index) => (
            <span key={value.toISOString()} className={index === weekdayIndex ? 'is-today' : ''}>
              <small>{'一二三四五六日'[index]}</small>
              <b>{value.getDate()}</b>
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}

export function DailyClosing() {
  const today = new Date();
  const closing = DAILY_CLOSINGS[dayOfYear(today) % DAILY_CLOSINGS.length];

  return (
    <footer className="daily-closing">
      <span className="closing-mark" aria-hidden="true">
        ◇
      </span>
      <p>{closing}</p>
      <span>CHOOSE A SPACE · KEEP THE CONTEXT</span>
    </footer>
  );
}
