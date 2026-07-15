import { apiVersion, App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { findCrossVaultLinks } from '@obsidian-hub/cross-vault-parser';
import { createCrossVaultSuggest } from './completion';
import { HubClient } from './hubClient';
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
  onOpen: (vaultName: string, notePath: string) => void,
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
              onOpen(link.vaultName, link.notePath),
            ),
          }).range(from, to),
        );
      }
    }
  }
  return Decoration.set(ranges, true);
}

function createCrossVaultDecorations(
  onOpen: (vaultName: string, notePath: string) => void,
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
  private client = new HubClient(() => this.settings);
  private heartbeatId?: number;
  private previewModal?: CrossVaultPreviewModal;

  async onload() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...((await this.loadData()) as Partial<BridgeSettings> | null),
    };
    this.registerEditorExtension(
      createCrossVaultDecorations((vaultName, notePath) => {
        void this.openLink(vaultName, notePath);
      }).extension,
    );
    this.registerEditorSuggest(createCrossVaultSuggest(this.app, this.client));
    this.registerMarkdownPostProcessor((element) => this.renderReadingLinks(element));
    this.addSettingTab(new BridgeSettingTab(this.app, this));
    void this.sendHeartbeat();
    this.heartbeatId = window.setInterval(() => void this.sendHeartbeat(), 45_000);
    this.register(() => {
      if (this.heartbeatId) window.clearInterval(this.heartbeatId);
      this.previewModal?.close();
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async sendHeartbeat() {
    if (!this.settings.vaultId || !this.settings.token) return;
    try {
      await this.client.heartbeat({
        vaultId: this.settings.vaultId,
        vaultName: this.app.vault.getName(),
        pluginVersion: this.manifest.version,
        obsidianVersion: apiVersion,
      });
    } catch {
      // The next heartbeat retries without blocking Obsidian.
    }
  }

  private renderReadingLinks(element: HTMLElement) {
    for (const anchor of element.querySelectorAll<HTMLAnchorElement>('a.internal-link')) {
      const previous = anchor.previousSibling;
      if (!(previous instanceof Text)) continue;
      const match = previous.data.match(/(?:^|\s)([@＠])([^@\n]+)$/);
      if (!match) continue;
      const vaultName = match[2].trim();
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
        void this.openLink(vaultName, notePath);
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
          void this.openLink(link.vaultName, link.notePath);
        });
        fragment.append(renderedLink);
        cursor = link.to;
      }
      fragment.append(node.data.slice(cursor));
      node.replaceWith(fragment);
    }
  }

  private async openLink(vault: string, path: string) {
    try {
      const note = await this.client.resolve(vault, path);
      const preview = await this.client.content(note);
      this.previewModal?.close();
      this.previewModal = new CrossVaultPreviewModal(this.app, preview, () =>
        this.client.open(note).then(() => undefined),
      );
      this.previewModal.open();
    } catch {
      new Notice('无法加载跨仓库笔记预览，请确认 Hub 正在运行且目标笔记存在。');
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
    new Setting(containerEl).setName('Hub 服务地址').addText((text) =>
      text.setValue(this.plugin.settings.apiBaseUrl).onChange(async (value) => {
        this.plugin.settings.apiBaseUrl = value;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName('当前仓库 ID').addText((text) =>
      text.setValue(this.plugin.settings.vaultId).onChange(async (value) => {
        this.plugin.settings.vaultId = value;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl)
      .setName('访问令牌')
      .setDesc(this.plugin.settings.token ? '已配置' : '未配置');
    new Setting(containerEl).setName('排除当前仓库').addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.excludeCurrentVault).onChange(async (value) => {
        this.plugin.settings.excludeCurrentVault = value;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName('测试连接').addButton((button) =>
      button.setButtonText('测试').onClick(async () => {
        try {
          await this.plugin['client'].health();
          new Notice('已连接到 Obsidian Hub。');
        } catch {
          new Notice('Obsidian Hub 未运行或认证失败。');
        }
      }),
    );
  }
}
