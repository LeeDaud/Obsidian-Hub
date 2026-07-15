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

type CompletionItem = { kind: 'vault'; vault: HubVault } | { kind: 'note'; note: IndexedNote };

class CrossVaultSuggest extends EditorSuggest<CompletionItem> {
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
      return (await this.client.search(noteStage.query, vault.id)).map((note) => ({
        kind: 'note' as const,
        note,
      }));
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
