import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { findCrossVaultLinks, splitVaultPart } from '@obsidian-hub/cross-vault-parser';
import { createCrossVaultSuggest } from './completion';
import { LocalClient } from './localClient';
import { CrossVaultPreviewModal } from './previewModal';
import { DEFAULT_SETTINGS, type BridgeSettings } from './types';

function displayLabel(alias: string | undefined, notePath: string): string {
  if (alias) return alias;
  const fileName = notePath.split('/').pop() ?? notePath;
  return fileName.replace(/\.md$/i, '');
}

class CrossVaultLinkWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly title: string,
    private readonly onOpen: () => void,
  ) {
    super();
  }

  eq(other: CrossVaultLinkWidget): boolean {
    return this.label === other.label && this.title === other.title;
  }

  toDOM(): HTMLElement {
    const link = document.createElement('span');
    link.className = 'internal-link obsidian-hub-cross-vault-link';
    link.textContent = this.label;
    link.title = this.title;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onOpen();
    });
    return link;
  }
}

function selectionTouchesLink(view: EditorView, from: number, to: number): boolean {
  return view.state.selection.ranges.some(
    (selection) => selection.from <= to && selection.to >= from,
  );
}

function decorations(
  view: EditorView,
  onOpen: (vaultName: string, vaultId: string | undefined, notePath: string) => void,
): DecorationSet {
  const ranges = [];
  for (const range of view.visibleRanges) {
    const text = view.state.doc.sliceString(range.from, range.to);
    for (const link of findCrossVaultLinks(text)) {
      const from = range.from + link.from;
      const to = range.from + link.to;
      const title = `${link.vaultName}\n${link.notePath}`;
      if (selectionTouchesLink(view, from, to)) {
        ranges.push(
          Decoration.mark({
            class: 'internal-link obsidian-hub-cross-vault-link-source',
            attributes: { title },
          }).range(from, to),
        );
      } else {
        ranges.push(
          Decoration.replace({
            widget: new CrossVaultLinkWidget(displayLabel(link.alias, link.notePath), title, () =>
              onOpen(link.vaultName, link.vaultId, link.notePath),
            ),
          }).range(from, to),
        );
      }
    }
  }
  return Decoration.set(ranges, true);
}

function createCrossVaultDecorations(
  onOpen: (vaultName: string, vaultId: string | undefined, notePath: string) => void,
): ViewPlugin<{
  decorations: DecorationSet;
  update(update: ViewUpdate): void;
}> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorations(view, onOpen);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = decorations(update.view, onOpen);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
}

export default class ObsidianHubBridge extends Plugin {
  settings: BridgeSettings = DEFAULT_SETTINGS;
  private client = new LocalClient(() => this.settings);
  private previewModal?: CrossVaultPreviewModal;

  async onload() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...((await this.loadData()) as Partial<BridgeSettings> | null),
    };
    this.registerEditorExtension(
      createCrossVaultDecorations((vaultName, vaultId, notePath) => {
        void this.openLink(vaultName, vaultId, notePath);
      }).extension,
    );
    this.registerEditorSuggest(createCrossVaultSuggest(this.app, this.client));
    this.registerMarkdownPostProcessor((element) => this.renderReadingLinks(element));
    this.addSettingTab(new BridgeSettingTab(this.app, this));
    void this.client.load();
    this.register(() => {
      this.previewModal?.close();
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private renderReadingLinks(element: HTMLElement) {
    for (const anchor of element.querySelectorAll<HTMLAnchorElement>('a.internal-link')) {
      const previous = anchor.previousSibling;
      if (!(previous instanceof Text)) continue;
      const match = previous.data.match(/(?:^|\s)([@＠])([^@\n]+)$/);
      if (!match) continue;
      const { name: vaultName, id: vaultId } = splitVaultPart(match[2]);
      const notePath =
        anchor.dataset.href ?? anchor.getAttribute('data-href') ?? anchor.textContent;
      if (!vaultName || !notePath) continue;
      previous.data =
        previous.data.slice(0, previous.data.length - match[0].length) +
        (match[0].startsWith(' ') ? ' ' : '');
      anchor.classList.add('obsidian-hub-cross-vault-link');
      anchor.classList.remove('external-link');
      anchor.title = `${vaultName}\n${notePath}`;
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.openLink(vaultName, vaultId, notePath);
      });
    }

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const links = findCrossVaultLinks(node.data);
      if (!links.length || !node.parentElement) continue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const link of links) {
        fragment.append(node.data.slice(cursor, link.from));
        const renderedLink = document.createElement('span');
        renderedLink.className = 'internal-link obsidian-hub-cross-vault-link';
        renderedLink.textContent = displayLabel(link.alias, link.notePath);
        renderedLink.title = `${link.vaultName}\n${link.notePath}`;
        renderedLink.addEventListener('click', (event) => {
          event.preventDefault();
          void this.openLink(link.vaultName, link.vaultId, link.notePath);
        });
        fragment.append(renderedLink);
        cursor = link.to;
      }
      fragment.append(node.data.slice(cursor));
      node.replaceWith(fragment);
    }
  }

  private async openLink(vault: string, vaultId: string | undefined, path: string) {
    try {
      const note = await this.client.resolve(vault, path, vaultId);
      const preview = await this.client.content(note);
      this.previewModal?.close();
      this.previewModal = new CrossVaultPreviewModal(this.app, preview, () =>
        this.client.open(note).then(() => undefined),
      );
      this.previewModal.open();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VAULT_OFFLINE:')) {
        new Notice(
          `仓库「${error.message.slice('VAULT_OFFLINE:'.length)}」路径不可访问，可能已离线或移动。`,
        );
      } else {
        new Notice('无法加载跨仓库笔记预览，请确认目标笔记存在且可读取。');
      }
    }
  }
}

class BridgeSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ObsidianHubBridge,
  ) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Obsidian Hub Bridge' });
    new Setting(containerEl)
      .setName('登记表路径')
      .setDesc('Hub 仓库登记表 config.json 的绝对路径，由 Hub 安装时写入。')
      .addText((text) =>
        text.setValue(this.plugin.settings.registryPath).onChange(async (value) => {
          this.plugin.settings.registryPath = value;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl).setName('当前仓库 ID').addText((text) =>
      text.setValue(this.plugin.settings.vaultId).onChange(async (value) => {
        this.plugin.settings.vaultId = value;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName('排除当前仓库').addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.excludeCurrentVault).onChange(async (value) => {
        this.plugin.settings.excludeCurrentVault = value;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName('重新扫描索引').addButton((button) =>
      button.setButtonText('扫描').onClick(async () => {
        button.setDisabled(true);
        await this.plugin['client'].load();
        button.setDisabled(false);
        new Notice('跨仓库索引已刷新。');
      }),
    );
  }
}
