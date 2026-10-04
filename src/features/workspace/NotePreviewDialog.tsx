import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { WorkspaceNote, WorkspaceNotePreview } from '../../domain/workspace';
import type { VaultGateway } from '../../services/vaultGateway';
import { toAppError } from '../../domain/appError';
import { WorkspaceDialog } from './WorkspaceDialog';
import { findCrossVaultLinks, type CrossVaultLink } from '@obsidian-hub/cross-vault-parser';

function inline(text: string, onLink: (link: CrossVaultLink) => void): ReactNode[] {
  const links = findCrossVaultLinks(text);
  if (!links.length) return [text];
  const output: ReactNode[] = [];
  let cursor = 0;
  links.forEach((link, index) => {
    output.push(text.slice(cursor, link.from));
    output.push(
      <button
        className="note-preview-link"
        type="button"
        key={`link-${index}`}
        onClick={() => onLink(link)}
      >
        {link.alias ?? `${link.vaultName} / ${link.notePath}`}
      </button>,
    );
    cursor = link.to;
  });
  output.push(text.slice(cursor));
  return output;
}

function renderMarkdown(source: string, onLink: (link: CrossVaultLink) => void): ReactNode[] {
  const output: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let code: string[] | null = null;
  let codeLanguage = '';
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(' ');
    output.push(<p key={`p-${output.length}`}>{inline(text, onLink)}</p>);
    paragraph = [];
  };
  lines.forEach((line) => {
    const fence = line.match(/^\s*```\s*([^\s`]*)/);
    if (fence) {
      flushParagraph();
      if (code) {
        output.push(
          <pre key={`code-${output.length}`} data-language={codeLanguage || undefined}>
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = null;
        codeLanguage = '';
      } else {
        code = [];
        codeLanguage = fence[1];
      }
      return;
    }
    if (code) {
      code.push(line);
      return;
    }
    if (!line.trim()) {
      flushParagraph();
      return;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      output.push(<Tag key={`h-${output.length}`}>{inline(heading[2], onLink)}</Tag>);
      return;
    }
    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      output.push(<hr key={`hr-${output.length}`} />);
      return;
    }
    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      flushParagraph();
      output.push(
        <div className="preview-task" key={`task-${output.length}`}>
          <input type="checkbox" checked={task[1] !== ' '} readOnly aria-label={task[2]} />
          <span>{inline(task[2], onLink)}</span>
        </div>,
      );
      return;
    }
    const list = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (list) {
      flushParagraph();
      output.push(
        <div className="preview-list-item" key={`li-${output.length}`}>
          • {inline(list[1], onLink)}
        </div>,
      );
      return;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      output.push(<blockquote key={`q-${output.length}`}>{inline(quote[1], onLink)}</blockquote>);
      return;
    }
    paragraph.push(line.trim());
  });
  flushParagraph();
  const danglingCode = code as string[] | null;
  if (danglingCode) {
    output.push(
      <pre key={`code-${output.length}`} data-language={codeLanguage || undefined}>
        <code>{danglingCode.join('\n')}</code>
      </pre>,
    );
  }
  return output;
}

export function NotePreviewDialog({
  note,
  gateway,
  onClose,
  onOpen,
  onLink,
  actions,
}: {
  note: WorkspaceNote;
  gateway: VaultGateway;
  onClose(): void;
  onOpen(): void;
  onLink(link: CrossVaultLink): void;
  actions?: ReactNode;
}) {
  const [preview, setPreview] = useState<WorkspaceNotePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!gateway.readWorkspaceNote) return;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await gateway.readWorkspaceNote(
        note.vaultId,
        note.relativePath,
        note.contentHash,
      );
      if (request === generation.current) setPreview(result);
    } catch (reason) {
      if (request === generation.current) setError(toAppError(reason).message);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [gateway, note.contentHash, note.relativePath, note.vaultId]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  return (
    <WorkspaceDialog title={note.title} onClose={onClose} busy={loading}>
      <div className="note-preview">
        <div className="note-preview-meta">
          <span>
            {note.vaultName} / {note.relativePath}
          </span>
          {preview?.changed && <strong>文件已变化，当前显示磁盘最新内容</strong>}
        </div>
        {loading && <p className="workspace-subtle">正在读取笔记…</p>}
        {error && (
          <p className="workspace-alert" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && (
          <article className="note-preview-content">
            {preview?.content.trim() ? (
              renderMarkdown(preview.content, onLink)
            ) : (
              <p className="workspace-subtle">这是一篇空笔记。</p>
            )}
          </article>
        )}
        <footer>
          {!loading && !error ? actions : null}
          <button type="button" disabled={loading} onClick={() => void load()}>
            刷新
          </button>
          <button type="button" className="workspace-primary" onClick={onOpen}>
            在 Obsidian 中打开
          </button>
        </footer>
      </div>
    </WorkspaceDialog>
  );
}
