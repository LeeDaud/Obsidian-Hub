import { App, Component, MarkdownRenderer, Modal, Notice } from 'obsidian';
import type { NoteContentResponse } from '@obsidian-hub/protocol';

export class CrossVaultPreviewModal extends Modal {
  private renderer?: Component;

  constructor(
    app: App,
    private readonly preview: NoteContentResponse,
    private readonly openInVault: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('obsidian-hub-preview-modal');
    this.setTitle(this.preview.note.title || this.preview.note.fileName);
    this.contentEl.createDiv({
      cls: 'obsidian-hub-preview-vault',
      text: `${this.preview.note.vaultName} · ${this.preview.note.relativePath}`,
    });
    const body = this.contentEl.createDiv({ cls: 'markdown-preview-view' });
    this.renderer = new Component();
    this.renderer.load();
    void MarkdownRenderer.render(
      this.app,
      this.preview.content,
      body,
      this.preview.note.relativePath,
      this.renderer,
    ).catch(() => new Notice('无法渲染跨仓库笔记预览。'));

    const actions = this.contentEl.createDiv({ cls: 'obsidian-hub-preview-actions' });
    const openButton = actions.createEl('button', {
      cls: 'mod-cta',
      text: '在目标仓库打开',
    });
    openButton.addEventListener('click', () => {
      openButton.disabled = true;
      void this.openInVault()
        .then(() => this.close())
        .catch(() => {
          openButton.disabled = false;
          new Notice('无法在目标仓库打开笔记。');
        });
    });
    const closeButton = actions.createEl('button', { text: '关闭' });
    closeButton.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.renderer?.unload();
    this.renderer = undefined;
    this.contentEl.empty();
  }
}
