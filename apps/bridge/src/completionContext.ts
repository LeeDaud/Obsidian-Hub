export type CompletionStage =
  | { kind: 'vault'; query: string }
  | { kind: 'note'; vaultName: string; directory: string; query: string };

export interface CompletionTrigger {
  opener: '@' | '＠';
  from: number;
  stage: CompletionStage;
}

export function findCompletionTrigger(textBeforeCursor: string): CompletionTrigger | null {
  for (let from = textBeforeCursor.length - 1; from >= 0; from -= 1) {
    const opener = textBeforeCursor[from];
    if (opener !== '@' && opener !== '＠') continue;
    if (from > 0 && !/\s/.test(textBeforeCursor[from - 1])) continue;
    const tail = textBeforeCursor.slice(from + 1);
    if (tail.includes('\n') || tail.includes(']]') || tail.includes('】】')) return null;
    const ascii = tail.indexOf('[[');
    const fullWidth = tail.indexOf('【【');
    const slash = tail.indexOf('/');
    const bracket = ascii < 0 ? fullWidth : fullWidth < 0 ? ascii : Math.min(ascii, fullWidth);
    const separator = slash >= 0 && (bracket < 0 || slash < bracket) ? slash : bracket;
    if (separator < 0) {
      return { opener, from, stage: { kind: 'vault', query: tail } };
    }
    const vaultName = tail.slice(0, separator).trim();
    if (!vaultName) return null;
    const contentOffset = separator === slash ? 1 : 2;
    const content = tail.slice(separator + contentOffset).replace(/\\/g, '/');
    const lastSlash = content.lastIndexOf('/');
    return {
      opener,
      from,
      stage: {
        kind: 'note',
        vaultName,
        directory: lastSlash < 0 ? '' : content.slice(0, lastSlash),
        query: content.slice(lastSlash + 1),
      },
    };
  }
  return null;
}
