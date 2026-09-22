export interface CrossVaultLink {
  raw: string;
  vaultName: string;
  vaultId?: string;
  notePath: string;
  alias?: string;
  heading?: string;
  blockId?: string;
  embed: boolean;
}

export interface CrossVaultLinkMatch extends CrossVaultLink {
  from: number;
  to: number;
}

function splitUnescaped(value: string, separator: string): [string, string?] {
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === separator) return [value.slice(0, index), value.slice(index + 1)];
  }
  return [value];
}

function unescape(value: string): string {
  return value.replace(/\\([\\|#^\]])/g, '$1');
}

function parseTarget(raw: string, vaultName: string, target: string): CrossVaultLink | null {
  const [destination, aliasPart] = splitUnescaped(target, '|');
  let noteTarget = destination;
  let heading: string | undefined;
  let blockId: string | undefined;
  const [withoutHeading, headingPart] = splitUnescaped(noteTarget, '#');
  if (headingPart !== undefined) {
    noteTarget = withoutHeading;
    heading = unescape(headingPart).trim() || undefined;
  } else {
    const [withoutBlock, blockPart] = splitUnescaped(noteTarget, '^');
    noteTarget = withoutBlock;
    blockId = blockPart === undefined ? undefined : unescape(blockPart).trim() || undefined;
  }
  const notePath = unescape(noteTarget).trim().replace(/\\/g, '/');
  const normalizedVault = unescape(vaultName).trim();
  if (!normalizedVault || !notePath || notePath.split('/').some((segment) => segment === '..')) {
    return null;
  }
  const alias = aliasPart === undefined ? undefined : unescape(aliasPart).trim() || undefined;
  return {
    raw,
    vaultName: normalizedVault,
    notePath,
    alias,
    heading,
    blockId,
    embed: false,
  };
}

export function splitVaultPart(part: string): { name: string; id?: string } {
  const colon = part.lastIndexOf(':');
  if (colon > 0 && colon < part.length - 1) {
    return { name: part.slice(0, colon).trim(), id: part.slice(colon + 1).trim() };
  }
  return { name: part.trim() };
}

function parseAtLink(raw: string): CrossVaultLink | null {
  if (!raw.startsWith('@') && !raw.startsWith('＠')) return null;
  const ascii = raw.indexOf('[[', 1);
  const fullWidth = raw.indexOf('【【', 1);
  const open = ascii < 0 ? fullWidth : fullWidth < 0 ? ascii : Math.min(ascii, fullWidth);
  if (open <= 1) return null;
  const usesFullWidth = open === fullWidth;
  const closer = usesFullWidth ? '】】' : ']]';
  if (!raw.endsWith(closer)) return null;
  const { name, id } = splitVaultPart(raw.slice(1, open));
  const parsed = parseTarget(raw, name, raw.slice(open + 2, -2));
  if (parsed) parsed.vaultId = id ? unescape(id) : undefined;
  return parsed;
}

export function parseCrossVaultLink(raw: string): CrossVaultLink | null {
  return parseAtLink(raw);
}

function findClosing(text: string, from: number, closer: string): number {
  let escaped = false;
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (escaped) escaped = false;
    else if (text[cursor] === '\\') escaped = true;
    else if (text.startsWith(closer, cursor)) return cursor + closer.length;
  }
  return -1;
}

export function findCrossVaultLinks(text: string): CrossVaultLinkMatch[] {
  const matches: CrossVaultLinkMatch[] = [];
  for (let from = 0; from < text.length; from += 1) {
    const character = text[from];
    if ((character === '@' || character === '＠') && (from === 0 || /\s/.test(text[from - 1]))) {
      let open = from + 1;
      while (open < text.length && text[open] !== '\n') {
        if (text.startsWith('[[', open) || text.startsWith('【【', open)) break;
        open += 1;
      }
      if (open >= text.length || text[open] === '\n') continue;
      const closer = text.startsWith('【【', open) ? '】】' : ']]';
      const to = findClosing(text, open + 2, closer);
      if (to < 0) continue;
      const parsed = parseAtLink(text.slice(from, to));
      if (parsed) matches.push({ ...parsed, from, to });
      from = to - 1;
      continue;
    }
  }
  return matches;
}

export function serializeCrossVaultLink(link: Omit<CrossVaultLink, 'raw'>): string {
  const suffix = link.heading ? `#${link.heading}` : link.blockId ? `^${link.blockId}` : '';
  const alias = link.alias ? `|${link.alias}` : '';
  const vault = link.vaultId ? `${link.vaultName}:${link.vaultId}` : link.vaultName;
  return `@${vault}[[${link.notePath}${suffix}${alias}]]`;
}
