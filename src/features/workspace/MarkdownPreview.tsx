import { Fragment, type ReactNode } from 'react';
import { findCrossVaultLinks, type CrossVaultLink } from '@obsidian-hub/cross-vault-parser';

interface MarkdownPreviewProps {
  source: string;
  onLink(link: CrossVaultLink): void;
}

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function inline(text: string, onLink: (link: CrossVaultLink) => void, key: string): ReactNode[] {
  const vaultLinks = findCrossVaultLinks(text);
  const markdown =
    /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
  const output: ReactNode[] = [];
  let cursor = 0;
  let vaultIndex = 0;
  let match = markdown.exec(text);

  while (match || vaultIndex < vaultLinks.length) {
    const vaultLink = vaultLinks[vaultIndex];
    const useVault = vaultLink && (!match || vaultLink.from <= match.index);
    const start = useVault ? vaultLink.from : match!.index;
    if (start < cursor) {
      if (useVault) vaultIndex += 1;
      else match = markdown.exec(text);
      continue;
    }
    if (start > cursor) output.push(text.slice(cursor, start));
    if (useVault) {
      output.push(
        <button
          className="note-preview-link"
          type="button"
          key={`${key}-vault-${start}`}
          onClick={() => onLink(vaultLink)}
        >
          {vaultLink.alias ?? `${vaultLink.vaultName} / ${vaultLink.notePath}`}
        </button>,
      );
      cursor = vaultLink.to;
      vaultIndex += 1;
    } else if (match) {
      const raw = match[0];
      const children = match[1];
      const target = match[2];
      const tokenKey = `${key}-inline-${match.index}`;
      if (raw.startsWith('![')) {
        output.push(
          <span className="note-preview-image" key={tokenKey} title={target}>
            图片：{children || target}
          </span>,
        );
      } else if (raw.startsWith('[')) {
        const href = safeExternalUrl(target);
        output.push(
          href ? (
            <a key={tokenKey} href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ) : (
            <span className="note-preview-unresolved-link" key={tokenKey} title={target}>
              {children || target}
            </span>
          ),
        );
      } else if (match[3] !== undefined) output.push(<code key={tokenKey}>{match[3]}</code>);
      else if (match[4] !== undefined || match[5] !== undefined)
        output.push(<strong key={tokenKey}>{match[4] ?? match[5]}</strong>);
      else if (match[6] !== undefined) output.push(<del key={tokenKey}>{match[6]}</del>);
      else output.push(<em key={tokenKey}>{match[7] ?? match[8]}</em>);
      cursor = match.index + raw.length;
      match = markdown.exec(text);
    }
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function isTableDivider(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? '';
  return (
    /^\s*```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*(?:[-+*]|\d+[.)])\s+/.test(line) ||
    (line.includes('|') && isTableDivider(lines[index + 1] ?? ''))
  );
}

interface ListItem {
  text: string;
  checked?: boolean;
  children: ReactNode[];
}

function parseList(
  lines: string[],
  start: number,
  onLink: (link: CrossVaultLink) => void,
  key: string,
): { node: ReactNode; next: number } {
  const first = lines[start].match(/^(\s*)([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/)!;
  const baseIndent = first[1].replace(/\t/g, '    ').length;
  const ordered = /^\d/.test(first[2]);
  const items: ListItem[] = [];
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(/^(\s*)([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (!match) break;
    const indent = match[1].replace(/\t/g, '    ').length;
    if (indent < baseIndent) break;
    if (indent > baseIndent && items.length) {
      const nested = parseList(lines, index, onLink, `${key}-nested-${items.length}`);
      items.at(-1)!.children.push(nested.node);
      index = nested.next;
      continue;
    }
    if (indent !== baseIndent || /^\d/.test(match[2]) !== ordered) break;
    items.push({
      text: match[4],
      checked: match[3] === undefined ? undefined : match[3] !== ' ',
      children: [],
    });
    index += 1;
  }
  const Tag = ordered ? 'ol' : 'ul';
  return {
    node: (
      <Tag className="note-preview-list" key={key}>
        {items.map((item, itemIndex) => (
          <li className={item.checked === undefined ? undefined : 'preview-task'} key={itemIndex}>
            {item.checked !== undefined && (
              <input type="checkbox" checked={item.checked} readOnly aria-label={item.text} />
            )}
            <span>{inline(item.text, onLink, `${key}-${itemIndex}`)}</span>
            {item.children}
          </li>
        ))}
      </Tag>
    ),
    next: index,
  };
}

export function MarkdownPreview({ source, onLink }: MarkdownPreviewProps) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const output: ReactNode[] = [];
  let index = 0;

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, lineIndex) => lineIndex > 0 && line.trim() === '---');
    if (end > 0) {
      output.push(
        <section className="note-preview-frontmatter" key="frontmatter" aria-label="笔记属性">
          {lines.slice(1, end).map((line, lineIndex) => (
            <div key={lineIndex}>{line}</div>
          ))}
        </section>,
      );
      index = end + 1;
    }
  }

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^\s*```\s*([^\s`]*)/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      output.push(
        <pre key={`code-${index}`} data-language={fence[1] || undefined}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const Tag = `h${heading[1].length}` as keyof React.JSX.IntrinsicElements;
      output.push(<Tag key={`h-${index}`}>{inline(heading[2], onLink, `h-${index}`)}</Tag>);
      index += 1;
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      output.push(<hr key={`hr-${index++}`} />);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      output.push(
        <blockquote key={`quote-${index}`}>
          <MarkdownPreview source={quoted.join('\n')} onLink={onLink} />
        </blockquote>,
      );
      continue;
    }
    if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) {
      const list = parseList(lines, index, onLink, `list-${index}`);
      output.push(list.node);
      index = list.next;
      continue;
    }
    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      const header = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index++]));
      }
      output.push(
        <div className="note-preview-table-wrap" key={`table-${index}`}>
          <table>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={cellIndex}>{inline(cell, onLink, `th-${cellIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex}>
                      {inline(row[cellIndex] ?? '', onLink, `td-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index++].trim());
    }
    if (!paragraph.length) {
      paragraph.push(lines[index++]);
    }
    output.push(
      <p key={`p-${index}`}>
        {paragraph.map((part, partIndex) => (
          <Fragment key={partIndex}>
            {partIndex > 0 && <br />}
            {inline(part, onLink, `p-${index}-${partIndex}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <>{output}</>;
}
