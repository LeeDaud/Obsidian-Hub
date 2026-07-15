"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ObsidianHubBridge
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");
var import_view = require("@codemirror/view");

// ../../packages/cross-vault-parser/src/index.ts
function splitUnescaped(value, separator) {
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === separator) return [value.slice(0, index), value.slice(index + 1)];
  }
  return [value];
}
function unescape(value) {
  return value.replace(/\\([\\|#^\]])/g, "$1");
}
function parseTarget(raw, vaultName, target) {
  const [destination, aliasPart] = splitUnescaped(target, "|");
  let noteTarget = destination;
  let heading;
  let blockId;
  const [withoutHeading, headingPart] = splitUnescaped(noteTarget, "#");
  if (headingPart !== void 0) {
    noteTarget = withoutHeading;
    heading = unescape(headingPart).trim() || void 0;
  } else {
    const [withoutBlock, blockPart] = splitUnescaped(noteTarget, "^");
    noteTarget = withoutBlock;
    blockId = blockPart === void 0 ? void 0 : unescape(blockPart).trim() || void 0;
  }
  const notePath = unescape(noteTarget).trim().replace(/\\/g, "/");
  const normalizedVault = unescape(vaultName).trim();
  if (!normalizedVault || !notePath || notePath.split("/").some((segment) => segment === "..")) {
    return null;
  }
  const alias = aliasPart === void 0 ? void 0 : unescape(aliasPart).trim() || void 0;
  return {
    raw,
    vaultName: normalizedVault,
    notePath,
    alias,
    heading,
    blockId,
    embed: false
  };
}
function parseAtLink(raw) {
  if (!raw.startsWith("@") && !raw.startsWith("\uFF20")) return null;
  const ascii = raw.indexOf("[[", 1);
  const fullWidth = raw.indexOf("\u3010\u3010", 1);
  const open = ascii < 0 ? fullWidth : fullWidth < 0 ? ascii : Math.min(ascii, fullWidth);
  if (open <= 1) return null;
  const usesFullWidth = open === fullWidth;
  const closer = usesFullWidth ? "\u3011\u3011" : "]]";
  if (!raw.endsWith(closer)) return null;
  return parseTarget(raw, raw.slice(1, open), raw.slice(open + 2, -2));
}
function findClosing(text, from, closer) {
  let escaped = false;
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (escaped) escaped = false;
    else if (text[cursor] === "\\") escaped = true;
    else if (text.startsWith(closer, cursor)) return cursor + closer.length;
  }
  return -1;
}
function findCrossVaultLinks(text) {
  const matches = [];
  for (let from = 0; from < text.length; from += 1) {
    const character = text[from];
    if ((character === "@" || character === "\uFF20") && (from === 0 || /\s/.test(text[from - 1]))) {
      let open = from + 1;
      while (open < text.length && text[open] !== "\n") {
        if (text.startsWith("[[", open) || text.startsWith("\u3010\u3010", open)) break;
        open += 1;
      }
      if (open >= text.length || text[open] === "\n") continue;
      const closer = text.startsWith("\u3010\u3010", open) ? "\u3011\u3011" : "]]";
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
function serializeCrossVaultLink(link) {
  const suffix = link.heading ? `#${link.heading}` : link.blockId ? `^${link.blockId}` : "";
  const alias = link.alias ? `|${link.alias}` : "";
  return `@${link.vaultName}[[${link.notePath}${suffix}${alias}]]`;
}

// src/completion.ts
var import_obsidian = require("obsidian");

// src/completionContext.ts
function findCompletionTrigger(textBeforeCursor) {
  for (let from = textBeforeCursor.length - 1; from >= 0; from -= 1) {
    const opener = textBeforeCursor[from];
    if (opener !== "@" && opener !== "\uFF20") continue;
    if (from > 0 && !/\s/.test(textBeforeCursor[from - 1])) continue;
    const tail = textBeforeCursor.slice(from + 1);
    if (tail.includes("\n") || tail.includes("]]") || tail.includes("\u3011\u3011")) return null;
    const ascii = tail.indexOf("[[");
    const fullWidth = tail.indexOf("\u3010\u3010");
    const slash = tail.indexOf("/");
    const bracket = ascii < 0 ? fullWidth : fullWidth < 0 ? ascii : Math.min(ascii, fullWidth);
    const separator = slash >= 0 && (bracket < 0 || slash < bracket) ? slash : bracket;
    if (separator < 0) {
      return { opener, from, stage: { kind: "vault", query: tail } };
    }
    const vaultName = tail.slice(0, separator).trim();
    if (!vaultName) return null;
    const contentOffset = separator === slash ? 1 : 2;
    return {
      opener,
      from,
      stage: { kind: "note", vaultName, query: tail.slice(separator + contentOffset) }
    };
  }
  return null;
}

// src/completion.ts
var CrossVaultSuggest = class extends import_obsidian.EditorSuggest {
  constructor(app, client) {
    super(app);
    this.client = client;
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "\u9009\u62E9" },
      { command: "Enter/Tab", purpose: "\u786E\u8BA4" },
      { command: "Esc", purpose: "\u5173\u95ED" }
    ]);
  }
  onTrigger(cursor, editor) {
    const textBeforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
    const trigger = findCompletionTrigger(textBeforeCursor);
    if (!trigger) return null;
    return {
      start: { line: cursor.line, ch: trigger.from },
      end: cursor,
      query: textBeforeCursor.slice(trigger.from)
    };
  }
  async getSuggestions(context) {
    const trigger = findCompletionTrigger(context.query);
    if (!trigger) return [];
    try {
      if (trigger.stage.kind === "vault") {
        const query = trigger.stage.query.toLocaleLowerCase();
        return (await this.client.vaults()).filter((vault2) => vault2.id !== this.client.currentVaultId()).filter((vault2) => !query || vault2.name.toLocaleLowerCase().includes(query)).map((vault2) => ({ kind: "vault", vault: vault2 }));
      }
      const noteStage = trigger.stage;
      const vault = (await this.client.vaults()).find(
        (candidate) => candidate.name.toLocaleLowerCase() === noteStage.vaultName.toLocaleLowerCase()
      );
      if (!vault) return [];
      return (await this.client.search(noteStage.query, vault.id)).map((note) => ({
        kind: "note",
        note
      }));
    } catch {
      new import_obsidian.Notice("Obsidian Hub \u6682\u4E0D\u53EF\u7528\u3002");
      return [];
    }
  }
  renderSuggestion(item, element) {
    if (item.kind === "vault") {
      element.createDiv({ text: item.vault.name, cls: "obsidian-hub-suggestion-vault" });
      element.createDiv({ text: "\u4ED3\u5E93 \xB7 \u56DE\u8F66\u540E\u9009\u62E9\u7B14\u8BB0", cls: "obsidian-hub-suggestion-path" });
      return;
    }
    element.createDiv({ text: item.note.title });
    element.createDiv({ text: item.note.relativePath, cls: "obsidian-hub-suggestion-path" });
  }
  selectSuggestion(item) {
    if (!this.context) return;
    if (item.kind === "vault") {
      const start = this.context.start;
      const insert2 = `@${item.vault.name}/`;
      this.context.editor.replaceRange(insert2, start, this.context.end);
      this.context.editor.setCursor({ line: start.line, ch: start.ch + insert2.length });
      window.setTimeout(() => this.open(), 0);
      return;
    }
    const path = item.note.relativePath.replace(/\.md$/i, "");
    const fileTitle = item.note.fileName.replace(/\.md$/i, "");
    const insert = serializeCrossVaultLink({
      vaultName: item.note.vaultName,
      notePath: path,
      alias: item.note.title !== fileTitle ? item.note.title : void 0,
      embed: false
    });
    this.context.editor.replaceRange(insert, this.context.start, this.context.end);
  }
};
function createCrossVaultSuggest(app, client) {
  return new CrossVaultSuggest(app, client);
}

// src/hubClient.ts
var import_obsidian2 = require("obsidian");
var HubClient = class {
  constructor(settings) {
    this.settings = settings;
  }
  currentVaultId() {
    return this.settings().vaultId;
  }
  async request(path, init) {
    const settings = this.settings();
    let timeoutId = 0;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error("HUB_REQUEST_TIMEOUT")),
        settings.requestTimeoutMs
      );
    });
    try {
      const response = await Promise.race([
        (0, import_obsidian2.requestUrl)({
          url: `${settings.apiBaseUrl}${path}`,
          method: init?.method ?? "GET",
          body: init?.body,
          throw: false,
          headers: {
            Authorization: `Bearer ${settings.token}`,
            "Content-Type": "application/json",
            ...init?.headers
          }
        }),
        timeout
      ]);
      if (response.status >= 400) {
        throw new Error(response.status === 401 ? "UNAUTHORIZED" : "HUB_REQUEST_FAILED");
      }
      return response.json;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  health() {
    return this.request("/api/v1/health");
  }
  async vaults() {
    return (await this.request("/api/v1/vaults")).items;
  }
  async search(query, vaultId) {
    const settings = this.settings();
    const params = new URLSearchParams({ q: query, limit: String(settings.resultLimit) });
    if (settings.excludeCurrentVault && settings.vaultId)
      params.set("excludeVaultId", settings.vaultId);
    if (vaultId) params.set("vaultId", vaultId);
    return (await this.request(`/api/v1/search?${params}`)).items;
  }
  resolve(vault, path) {
    return this.request(
      `/api/v1/notes/resolve?vault=${encodeURIComponent(vault)}&path=${encodeURIComponent(path)}`
    );
  }
  heartbeat(payload) {
    return this.request("/api/v1/bridge/heartbeat", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
  open(note, heading, blockId) {
    return this.request("/api/v1/open", {
      method: "POST",
      body: JSON.stringify({
        vaultId: note.vaultId,
        relativePath: note.relativePath,
        heading: heading ?? null,
        blockId: blockId ?? null
      })
    });
  }
};

// src/types.ts
var DEFAULT_SETTINGS = {
  apiBaseUrl: "http://127.0.0.1:27124",
  token: "",
  vaultId: "",
  excludeCurrentVault: true,
  showCrossVaultIcon: true,
  resultLimit: 20,
  requestTimeoutMs: 1500
};

// src/main.ts
function displayLabel(alias, notePath) {
  if (alias) return alias;
  const fileName = notePath.split("/").pop() ?? notePath;
  return fileName.replace(/\.md$/i, "");
}
var CrossVaultLinkWidget = class extends import_view.WidgetType {
  constructor(label, title, onOpen) {
    super();
    this.label = label;
    this.title = title;
    this.onOpen = onOpen;
  }
  eq(other) {
    return this.label === other.label && this.title === other.title;
  }
  toDOM() {
    const link = document.createElement("span");
    link.className = "internal-link obsidian-hub-cross-vault-link";
    link.textContent = this.label;
    link.title = this.title;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onOpen();
    });
    return link;
  }
};
function selectionTouchesLink(view, from, to) {
  return view.state.selection.ranges.some(
    (selection) => selection.from <= to && selection.to >= from
  );
}
function decorations(view, onOpen) {
  const ranges = [];
  for (const range of view.visibleRanges) {
    const text = view.state.doc.sliceString(range.from, range.to);
    for (const link of findCrossVaultLinks(text)) {
      const from = range.from + link.from;
      const to = range.from + link.to;
      const title = `${link.vaultName}
${link.notePath}`;
      if (selectionTouchesLink(view, from, to)) {
        ranges.push(
          import_view.Decoration.mark({
            class: "internal-link obsidian-hub-cross-vault-link-source",
            attributes: { title }
          }).range(from, to)
        );
      } else {
        ranges.push(
          import_view.Decoration.replace({
            widget: new CrossVaultLinkWidget(
              displayLabel(link.alias, link.notePath),
              title,
              () => onOpen(link.vaultName, link.notePath)
            )
          }).range(from, to)
        );
      }
    }
  }
  return import_view.Decoration.set(ranges, true);
}
function createCrossVaultDecorations(onOpen) {
  return import_view.ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view) {
        this.decorations = decorations(view, onOpen);
      }
      update(update) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = decorations(update.view, onOpen);
        }
      }
    },
    { decorations: (value) => value.decorations }
  );
}
var ObsidianHubBridge = class extends import_obsidian3.Plugin {
  settings = DEFAULT_SETTINGS;
  client = new HubClient(() => this.settings);
  heartbeatId;
  async onload() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...await this.loadData()
    };
    this.registerEditorExtension(
      createCrossVaultDecorations((vaultName, notePath) => {
        void this.openLink(vaultName, notePath);
      }).extension
    );
    this.registerEditorSuggest(createCrossVaultSuggest(this.app, this.client));
    this.registerMarkdownPostProcessor((element) => this.renderReadingLinks(element));
    this.addSettingTab(new BridgeSettingTab(this.app, this));
    void this.sendHeartbeat();
    this.heartbeatId = window.setInterval(() => void this.sendHeartbeat(), 45e3);
    this.register(() => {
      if (this.heartbeatId) window.clearInterval(this.heartbeatId);
    });
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async sendHeartbeat() {
    if (!this.settings.vaultId || !this.settings.token) return;
    try {
      await this.client.heartbeat({
        vaultId: this.settings.vaultId,
        vaultName: this.app.vault.getName(),
        pluginVersion: this.manifest.version,
        obsidianVersion: import_obsidian3.apiVersion
      });
    } catch {
    }
  }
  renderReadingLinks(element) {
    for (const anchor of element.querySelectorAll("a.internal-link")) {
      const previous = anchor.previousSibling;
      if (!(previous instanceof Text)) continue;
      const match = previous.data.match(/(?:^|\s)([@＠])([^@\n]+)$/);
      if (!match) continue;
      const vaultName = match[2].trim();
      const notePath = anchor.dataset.href ?? anchor.getAttribute("data-href") ?? anchor.textContent;
      if (!vaultName || !notePath) continue;
      previous.data = previous.data.slice(0, previous.data.length - match[0].length) + (match[0].startsWith(" ") ? " " : "");
      anchor.classList.add("obsidian-hub-cross-vault-link");
      anchor.title = `${vaultName}
${notePath}`;
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.openLink(vaultName, notePath);
      });
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const links = findCrossVaultLinks(node.data);
      if (!links.length || !node.parentElement) continue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const link of links) {
        fragment.append(node.data.slice(cursor, link.from));
        const anchor = document.createElement("a");
        anchor.className = "internal-link obsidian-hub-cross-vault-link";
        anchor.textContent = displayLabel(link.alias, link.notePath);
        anchor.title = `${link.vaultName}
${link.notePath}`;
        anchor.addEventListener("click", (event) => {
          event.preventDefault();
          void this.openLink(link.vaultName, link.notePath);
        });
        fragment.append(anchor);
        cursor = link.to;
      }
      fragment.append(node.data.slice(cursor));
      node.replaceWith(fragment);
    }
  }
  async openLink(vault, path) {
    try {
      const note = await this.client.resolve(vault, path);
      await this.client.open(note);
    } catch {
      window.open(
        `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path)}`
      );
      new import_obsidian3.Notice("Hub \u4E0D\u53EF\u7528\uFF0C\u5DF2\u5C1D\u8BD5\u901A\u8FC7 Obsidian URI \u6253\u5F00\u76EE\u6807\u3002");
    }
  }
};
var BridgeSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian Hub Bridge" });
    new import_obsidian3.Setting(containerEl).setName("Hub \u670D\u52A1\u5730\u5740").addText(
      (text) => text.setValue(this.plugin.settings.apiBaseUrl).onChange(async (value) => {
        this.plugin.settings.apiBaseUrl = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u5F53\u524D\u4ED3\u5E93 ID").addText(
      (text) => text.setValue(this.plugin.settings.vaultId).onChange(async (value) => {
        this.plugin.settings.vaultId = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u8BBF\u95EE\u4EE4\u724C").setDesc(this.plugin.settings.token ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E");
    new import_obsidian3.Setting(containerEl).setName("\u6392\u9664\u5F53\u524D\u4ED3\u5E93").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.excludeCurrentVault).onChange(async (value) => {
        this.plugin.settings.excludeCurrentVault = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u6D4B\u8BD5\u8FDE\u63A5").addButton(
      (button) => button.setButtonText("\u6D4B\u8BD5").onClick(async () => {
        try {
          await this.plugin["client"].health();
          new import_obsidian3.Notice("\u5DF2\u8FDE\u63A5\u5230 Obsidian Hub\u3002");
        } catch {
          new import_obsidian3.Notice("Obsidian Hub \u672A\u8FD0\u884C\u6216\u8BA4\u8BC1\u5931\u8D25\u3002");
        }
      })
    );
  }
};
