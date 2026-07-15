import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  Notice,
} from 'obsidian';
import { serializeCrossVaultLink } from '@obsidian-hub/cross-vault-parser';
import type { HubVault, IndexedNote } from '@obsidian-hub/protocol';
import { findCompletionTrigger } from './completionContext';
import type { HubClient } from './hubClient';

type CompletionItem =
  | { kind: 'vault'; vault: HubVault }
  | { kind: 'folder'; vaultName: string; name: string; path: string }
  | { kind: 'back'; vaultName: string; path: string }
  | { kind: 'note'; note: IndexedNote }
  | { kind: 'more'; cacheKey: string; nextLimit: number };

class CrossVaultSuggest extends EditorSuggest<CompletionItem> {
  private readonly limits = new Map<string, number>();

  constructor(
    app: App,
    private readonly client: HubClient,
  ) {
    super(app);
    this.setInstructions([
      { command: '↑↓', purpose: '选择' },
      { command: 'Enter/Tab', purpose: '确认' },
      { command: 'Esc', purpose: '关闭' },
    ]);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const textBeforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
    const trigger = findCompletionTrigger(textBeforeCursor);
    if (!trigger) return null;
    return {
      start: { line: cursor.line, ch: trigger.from },
      end: cursor,
      query: textBeforeCursor.slice(trigger.from),
    };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<CompletionItem[]> {
    const trigger = findCompletionTrigger(context.query);
    if (!trigger) return [];
    try {
      if (trigger.stage.kind === 'vault') {
        const query = trigger.stage.query.toLocaleLowerCase();
        return (await this.client.vaults())
          .filter((vault) => vault.id !== this.client.currentVaultId())
          .filter((vault) => !query || vault.name.toLocaleLowerCase().includes(query))
          .map((vault) => ({ kind: 'vault' as const, vault }));
      }
      const noteStage = trigger.stage;
      const vault = (await this.client.vaults()).find(
        (candidate) =>
          candidate.name.toLocaleLowerCase() === noteStage.vaultName.toLocaleLowerCase(),
      );
      if (!vault) return [];
      const cacheKey = `${vault.id}\n${noteStage.directory}\n${noteStage.query}`;
      const pageSize = Math.max(20, this.client.resultLimit());
      const limit = this.limits.get(cacheKey) ?? pageSize;
      const response = await this.client.browse(
        vault.id,
        noteStage.directory,
        noteStage.query,
        limit,
      );
      const items: CompletionItem[] = response.items.map((item) =>
        item.kind === 'folder'
          ? {
              kind: 'folder',
              vaultName: vault.name,
              name: item.name,
              path: item.path,
            }
          : { kind: 'note', note: item.note },
      );
      if (noteStage.directory && !noteStage.query) {
        const parent = noteStage.directory.split('/').slice(0, -1).join('/');
        items.unshift({ kind: 'back', vaultName: vault.name, path: parent });
      }
      if (response.hasMore) {
        items.push({ kind: 'more', cacheKey, nextLimit: limit + pageSize });
      }
      return items;
    } catch {
      new Notice('Obsidian Hub 暂不可用。');
      return [];
    }
  }

  renderSuggestion(item: CompletionItem, element: HTMLElement) {
    if (item.kind === 'vault') {
      element.createDiv({ text: item.vault.name, cls: 'obsidian-hub-suggestion-vault' });
      element.createDiv({ text: '仓库 · 回车后选择笔记', cls: 'obsidian-hub-suggestion-path' });
      return;
    }
    if (item.kind === 'folder') {
      element.createDiv({ text: item.name, cls: 'obsidian-hub-suggestion-folder' });
      element.createDiv({ text: `${item.path}/`, cls: 'obsidian-hub-suggestion-path' });
      return;
    }
    if (item.kind === 'back') {
      element.createDiv({ text: '返回上一级', cls: 'obsidian-hub-suggestion-folder' });
      element.createDiv({ text: item.path || '仓库根目录', cls: 'obsidian-hub-suggestion-path' });
      return;
    }
    if (item.kind === 'more') {
      element.createDiv({ text: '加载更多…', cls: 'obsidian-hub-suggestion-more' });
      return;
    }
    element.createDiv({ text: item.note.title });
    element.createDiv({ text: item.note.relativePath, cls: 'obsidian-hub-suggestion-path' });
  }

  selectSuggestion(item: CompletionItem) {
    if (!this.context) return;
    if (item.kind === 'vault') {
      const start = this.context.start;
      const insert = `@${item.vault.name}/`;
      this.context.editor.replaceRange(insert, start, this.context.end);
      this.context.editor.setCursor({ line: start.line, ch: start.ch + insert.length });
      window.setTimeout(() => this.open(), 0);
      return;
    }
    if (item.kind === 'folder' || item.kind === 'back') {
      const start = this.context.start;
      const suffix = item.path ? `${item.path}/` : '';
      const insert = `@${item.vaultName}/${suffix}`;
      this.context.editor.replaceRange(insert, start, this.context.end);
      this.context.editor.setCursor({ line: start.line, ch: start.ch + insert.length });
      window.setTimeout(() => this.open(), 0);
      return;
    }
    if (item.kind === 'more') {
      this.limits.set(item.cacheKey, item.nextLimit);
      window.setTimeout(() => this.open(), 0);
      return;
    }
    const path = item.note.relativePath.replace(/\.md$/i, '');
    const fileTitle = item.note.fileName.replace(/\.md$/i, '');
    const insert = serializeCrossVaultLink({
      vaultName: item.note.vaultName,
      notePath: path,
      alias: item.note.title !== fileTitle ? item.note.title : undefined,
      embed: false,
    });
    this.context.editor.replaceRange(insert, this.context.start, this.context.end);
  }
}

export function createCrossVaultSuggest(app: App, client: HubClient) {
  return new CrossVaultSuggest(app, client);
}
