"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
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
function splitVaultPart(part) {
  const colon = part.lastIndexOf(":");
  if (colon > 0 && colon < part.length - 1) {
    return { name: part.slice(0, colon).trim(), id: part.slice(colon + 1).trim() };
  }
  return { name: part.trim() };
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
  const { name, id } = splitVaultPart(raw.slice(1, open));
  const parsed = parseTarget(raw, name, raw.slice(open + 2, -2));
  if (parsed) parsed.vaultId = id ? unescape(id) : void 0;
  return parsed;
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
  const vault = link.vaultId ? `${link.vaultName}:${link.vaultId}` : link.vaultName;
  return `@${vault}[[${link.notePath}${suffix}${alias}]]`;
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
    const content = tail.slice(separator + contentOffset).replace(/\\/g, "/");
    const lastSlash = content.lastIndexOf("/");
    return {
      opener,
      from,
      stage: {
        kind: "note",
        vaultName,
        directory: lastSlash < 0 ? "" : content.slice(0, lastSlash),
        query: content.slice(lastSlash + 1)
      }
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
  limits = /* @__PURE__ */ new Map();
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
      const cacheKey = `${vault.id}
${noteStage.directory}
${noteStage.query}`;
      const pageSize = Math.max(20, this.client.resultLimit());
      const limit = this.limits.get(cacheKey) ?? pageSize;
      const response = await this.client.browse(
        vault.id,
        noteStage.directory,
        noteStage.query,
        limit
      );
      const items = response.items.map(
        (item) => item.kind === "folder" ? {
          kind: "folder",
          vaultName: vault.name,
          name: item.name,
          path: item.path
        } : { kind: "note", note: item.note }
      );
      if (noteStage.directory && !noteStage.query) {
        const parent = noteStage.directory.split("/").slice(0, -1).join("/");
        items.unshift({ kind: "back", vaultName: vault.name, path: parent });
      }
      if (response.hasMore) {
        items.push({ kind: "more", cacheKey, nextLimit: limit + pageSize });
      }
      return items;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("VAULT_OFFLINE:")) {
        new import_obsidian.Notice(
          `\u4ED3\u5E93\u300C${error.message.slice("VAULT_OFFLINE:".length)}\u300D\u8DEF\u5F84\u4E0D\u53EF\u8BBF\u95EE\uFF0C\u53EF\u80FD\u5DF2\u79BB\u7EBF\u6216\u79FB\u52A8\u3002`
        );
      } else {
        new import_obsidian.Notice("\u8DE8\u4ED3\u5E93\u7D22\u5F15\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002");
      }
      return [];
    }
  }
  renderSuggestion(item, element) {
    if (item.kind === "vault") {
      element.createDiv({ text: item.vault.name, cls: "obsidian-hub-suggestion-vault" });
      element.createDiv({ text: "\u4ED3\u5E93 \xB7 \u56DE\u8F66\u540E\u9009\u62E9\u7B14\u8BB0", cls: "obsidian-hub-suggestion-path" });
      return;
    }
    if (item.kind === "folder") {
      element.createDiv({ text: item.name, cls: "obsidian-hub-suggestion-folder" });
      element.createDiv({ text: `${item.path}/`, cls: "obsidian-hub-suggestion-path" });
      return;
    }
    if (item.kind === "back") {
      element.createDiv({ text: "\u8FD4\u56DE\u4E0A\u4E00\u7EA7", cls: "obsidian-hub-suggestion-folder" });
      element.createDiv({ text: item.path || "\u4ED3\u5E93\u6839\u76EE\u5F55", cls: "obsidian-hub-suggestion-path" });
      return;
    }
    if (item.kind === "more") {
      element.createDiv({ text: "\u52A0\u8F7D\u66F4\u591A\u2026", cls: "obsidian-hub-suggestion-more" });
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
    if (item.kind === "folder" || item.kind === "back") {
      const start = this.context.start;
      const suffix = item.path ? `${item.path}/` : "";
      const insert2 = `@${item.vaultName}/${suffix}`;
      this.context.editor.replaceRange(insert2, start, this.context.end);
      this.context.editor.setCursor({ line: start.line, ch: start.ch + insert2.length });
      window.setTimeout(() => this.open(), 0);
      return;
    }
    if (item.kind === "more") {
      this.limits.set(item.cacheKey, item.nextLimit);
      window.setTimeout(() => this.open(), 0);
      return;
    }
    const path3 = item.note.relativePath.replace(/\.md$/i, "");
    const fileTitle = item.note.fileName.replace(/\.md$/i, "");
    const insert = serializeCrossVaultLink({
      vaultName: item.note.vaultName,
      vaultId: item.note.vaultId,
      notePath: path3,
      alias: item.note.title !== fileTitle ? item.note.title : void 0,
      embed: false
    });
    this.context.editor.replaceRange(insert, this.context.start, this.context.end);
  }
};
function createCrossVaultSuggest(app, client) {
  return new CrossVaultSuggest(app, client);
}

// src/localClient.ts
var import_fs2 = require("fs");
var path2 = __toESM(require("path"), 1);

// src/localIndex.ts
var import_fs = require("fs");
var path = __toESM(require("path"), 1);
var IGNORED_DIRECTORIES = [".obsidian", ".git", ".trash", "node_modules", "target", "dist"];
function frontmatterValues(contents, key) {
  if (!contents.startsWith("---\n")) return [];
  const end = contents.indexOf("\n---", 4);
  if (end < 0) return [];
  const frontmatter = contents.slice(4, end);
  const line = frontmatter.split("\n").find((candidate) => candidate.trimStart().startsWith(`${key}:`));
  if (!line) return [];
  const colon = line.indexOf(":");
  const value = line.slice(colon + 1).trim();
  return value.replace(/^\[|\]$/g, "").split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter((item) => item.length > 0);
}
function firstHeading(contents) {
  for (const line of contents.split("\n")) {
    if (line.startsWith("# ")) {
      const title = line.slice(2).trim();
      if (title) return title;
    }
  }
  return void 0;
}
async function buildNote(vault, root, fullPath, fileName) {
  const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
  let contents = "";
  try {
    contents = await import_fs.promises.readFile(fullPath, "utf8");
  } catch {
  }
  let modifiedAt = 0;
  let size = 0;
  try {
    const stats = await import_fs.promises.stat(fullPath);
    modifiedAt = Math.floor(stats.mtimeMs);
    size = stats.size;
  } catch {
  }
  return {
    id: `${vault.id}:${relativePath.toLowerCase()}`,
    vaultId: vault.id,
    vaultName: vault.name,
    relativePath,
    fileName,
    title: firstHeading(contents) ?? fileName.replace(/\.md$/i, ""),
    aliases: frontmatterValues(contents, "aliases"),
    tags: frontmatterValues(contents, "tags"),
    modifiedAt,
    size
  };
}
async function scanDirectory(root, directory, vault, notes) {
  let entries;
  try {
    entries = await import_fs.promises.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.some((name) => name.toLowerCase() === entry.name.toLowerCase())) {
        continue;
      }
      await scanDirectory(root, fullPath, vault, notes);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      notes.push(await buildNote(vault, root, fullPath, entry.name));
    }
  }
}
async function scanVault(vault) {
  const notes = [];
  try {
    const stats = await import_fs.promises.stat(vault.path);
    if (stats.isDirectory()) {
      await scanDirectory(vault.path, vault.path, vault, notes);
    }
  } catch {
  }
  return notes;
}
async function scanDirectoryLevel(vault, directory) {
  const normalized = directory.replace(/^\/+|\/+$/g, "");
  const root = vault.path;
  const targetDirectory = normalized ? path.join(root, ...normalized.split("/")) : root;
  let entries;
  try {
    entries = await import_fs.promises.readdir(targetDirectory, { withFileTypes: true });
  } catch {
    return { folders: [], notes: [] };
  }
  const folders = [];
  const notes = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.some((name) => name.toLowerCase() === entry.name.toLowerCase())) {
        continue;
      }
      const childPath = normalized ? `${normalized}/${entry.name}` : entry.name;
      folders.push({ name: entry.name, path: childPath });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      notes.push(await buildNote(vault, root, fullPath, entry.name));
    }
  }
  folders.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  notes.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  return { folders, notes };
}
function folderName(item) {
  return item.kind === "folder" ? item.name : "";
}
function noteTitle(item) {
  return item.kind === "note" ? item.note.title : "";
}
function browseNotes(notes, vaultId, directory, query, limit) {
  const trimmed = directory.replace(/^\/+|\/+$/g, "");
  const prefix = trimmed ? `${trimmed}/` : "";
  const normalizedQuery = query.trim().toLowerCase();
  let items;
  if (!normalizedQuery) {
    const folders = /* @__PURE__ */ new Map();
    const files = [];
    for (const note of notes) {
      if (note.vaultId !== vaultId || !note.relativePath.startsWith(prefix)) continue;
      const remainder = note.relativePath.slice(prefix.length);
      const slash = remainder.indexOf("/");
      if (slash >= 0) {
        const folder = remainder.slice(0, slash);
        const key = folder.toLowerCase();
        if (!folders.has(key)) {
          folders.set(key, {
            kind: "folder",
            name: folder,
            path: trimmed ? `${trimmed}/${folder}` : folder
          });
        }
      } else {
        files.push({ kind: "note", note });
      }
    }
    const folderList = [...folders.values()].sort(
      (a, b) => folderName(a).localeCompare(folderName(b))
    );
    files.sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)));
    items = [...folderList, ...files];
  } else {
    const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 0);
    items = notes.filter((note) => note.vaultId === vaultId && note.relativePath.startsWith(prefix)).filter((note) => {
      const haystack = `${note.fileName} ${note.title} ${note.relativePath} ${note.aliases.join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }).map((note) => ({ kind: "note", note })).sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)));
  }
  const total = items.length;
  const limited = items.slice(0, Math.max(1, Math.min(limit, 5e3)));
  return { items: limited, total, hasMore: limited.length < total };
}

// src/localClient.ts
var MAX_CONTENT_BYTES = 2 * 1024 * 1024;
var SCAN_CACHE_TTL_MS = 3e3;
var LocalClient = class {
  constructor(settings) {
    this.settings = settings;
  }
  registeredVaults = [];
  scanCache = /* @__PURE__ */ new Map();
  currentVaultId() {
    return this.settings().vaultId;
  }
  resultLimit() {
    return this.settings().resultLimit;
  }
  async load() {
    const registryPath = this.settings().registryPath;
    this.registeredVaults = registryPath ? readRegistry(registryPath) : [];
    this.scanCache.clear();
  }
  async vaults() {
    return this.registeredVaults.map(({ id, name }) => ({ id, name }));
  }
  async browse(vaultId, directory, query, limit) {
    const vault = this.registeredVaults.find((candidate) => candidate.id === vaultId);
    if (!vault) return { items: [], total: 0, hasMore: false };
    await this.assertVaultAccessible(vault);
    if (!query.trim()) {
      return this.browseLevel(vault, directory, limit);
    }
    const notes = await this.scanVaultCached(vaultId);
    return browseNotes(notes, vaultId, directory, query, limit);
  }
  async browseLevel(vault, directory, limit) {
    const level = await scanDirectoryLevel(vault, directory);
    const items = [
      ...level.folders.map((folder) => ({ kind: "folder", ...folder })),
      ...level.notes.map((note) => ({ kind: "note", note }))
    ];
    const total = items.length;
    const limited = items.slice(0, Math.max(1, Math.min(limit, 5e3)));
    return { items: limited, total, hasMore: limited.length < total };
  }
  async resolve(vault, notePath, vaultId) {
    let targetVault;
    if (vaultId) {
      targetVault = this.registeredVaults.find((candidate) => candidate.id === vaultId);
    } else {
      const matches = this.registeredVaults.filter(
        (candidate) => candidate.name.toLowerCase() === vault.toLowerCase()
      );
      if (matches.length > 1) throw new Error("VAULT_AMBIGUOUS");
      targetVault = matches[0];
    }
    if (!targetVault) throw new Error("NOTE_NOT_FOUND");
    await this.assertVaultAccessible(targetVault);
    const notes = await this.scanVaultCached(targetVault.id);
    const targetPath = notePath.replace(/\.md$/i, "").replace(/\\/g, "/").toLowerCase();
    const note = notes.find(
      (candidate) => candidate.relativePath.replace(/\.md$/i, "").toLowerCase() === targetPath
    );
    if (!note) throw new Error("NOTE_NOT_FOUND");
    return note;
  }
  async content(note) {
    const vault = this.registeredVaults.find((candidate) => candidate.id === note.vaultId);
    if (!vault) throw new Error("VAULT_NOT_FOUND");
    const relativePath = note.relativePath;
    if (!relativePath.toLowerCase().endsWith(".md") || relativePath.split("/").some((segment) => segment === "..")) {
      throw new Error("INVALID_LINK");
    }
    let root;
    let target;
    try {
      root = await import_fs2.promises.realpath(vault.path);
      target = await import_fs2.promises.realpath(path2.join(vault.path, relativePath));
    } catch {
      throw new Error("NOTE_NOT_FOUND");
    }
    const relative3 = path2.relative(root, target);
    if (relative3.startsWith("..") || path2.isAbsolute(relative3)) {
      throw new Error("INVALID_LINK");
    }
    const stats = await import_fs2.promises.stat(target).catch(() => {
      throw new Error("NOTE_NOT_FOUND");
    });
    if (stats.size > MAX_CONTENT_BYTES) throw new Error("NOTE_TOO_LARGE");
    const content = await import_fs2.promises.readFile(target, "utf8").catch(() => {
      throw new Error("NOTE_READ_FAILED");
    });
    return { note, content: this.resolveEmbeddedAssets(vault, note, content) };
  }
  resolveEmbeddedAssets(vault, note, content) {
    const noteDir = path2.dirname(path2.join(vault.path, note.relativePath));
    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"];
    const isImage = (target) => imageExtensions.some((extension) => target.toLowerCase().endsWith(extension));
    const isExternal = (target) => /^(https?:|file:|data:|app:|\/|[a-zA-Z]:)/.test(target.trim());
    const toFileUrl = (target) => {
      if (isExternal(target)) return null;
      const absolute = path2.resolve(noteDir, target);
      const relative3 = path2.relative(vault.path, absolute);
      if (relative3.startsWith("..") || path2.isAbsolute(relative3)) return null;
      return `file:///${absolute.replace(/\\/g, "/")}`;
    };
    const resolvedMarkdownImages = content.replace(
      /!\[([^\]]*)\]\(([^)\n]+)\)/g,
      (full, alt, target) => {
        const cleanTarget = target.split("#")[0].split("|")[0].trim();
        if (!isImage(cleanTarget)) return full;
        const fileUrl = toFileUrl(cleanTarget);
        return fileUrl ? `![${alt}](${fileUrl})` : full;
      }
    );
    return resolvedMarkdownImages.replace(/!\[\[([^\]]+)\]\]/g, (full, target) => {
      const cleanTarget = target.split("|")[0].split("#")[0].split("^")[0].trim();
      if (!isImage(cleanTarget)) return full;
      const fileUrl = toFileUrl(cleanTarget);
      return fileUrl ? `![](${fileUrl})` : full;
    });
  }
  async open(note, heading, blockId) {
    const params = new URLSearchParams({
      vault: note.vaultName,
      file: note.relativePath.replace(/\.md$/i, "")
    });
    if (heading) params.set("heading", heading);
    if (blockId) params.set("block", blockId);
    const uri = `obsidian://open?${params.toString()}`;
    window.open(uri, "_blank");
    return { uri };
  }
  async health() {
    return { status: "ok" };
  }
  async assertVaultAccessible(vault) {
    try {
      const stats = await import_fs2.promises.stat(vault.path);
      if (!stats.isDirectory()) throw new Error();
    } catch {
      throw new Error(`VAULT_OFFLINE:${vault.name}`);
    }
  }
  async scanVaultCached(vaultId) {
    const cached = this.scanCache.get(vaultId);
    const now = Date.now();
    if (cached && now - cached.at < SCAN_CACHE_TTL_MS) {
      return cached.notes;
    }
    const vault = this.registeredVaults.find((candidate) => candidate.id === vaultId);
    if (!vault) return [];
    const notes = await scanVault(vault);
    this.scanCache.set(vaultId, { notes, at: now });
    return notes;
  }
};
function readRegistry(registryPath) {
  let registry;
  try {
    registry = JSON.parse((0, import_fs2.readFileSync)(registryPath, "utf8"));
  } catch {
    return [];
  }
  return (registry.vaults ?? []).filter((vault) => vault.id && vault.name && vault.path).map(({ id, name, path: vaultPath }) => ({ id, name, path: vaultPath }));
}

// src/previewModal.ts
var import_obsidian2 = require("obsidian");
var CrossVaultPreviewModal = class extends import_obsidian2.Modal {
  constructor(app, preview, openInVault) {
    super(app);
    this.preview = preview;
    this.openInVault = openInVault;
  }
  renderer;
  onOpen() {
    this.modalEl.addClass("obsidian-hub-preview-modal");
    this.setTitle(this.preview.note.title || this.preview.note.fileName);
    this.contentEl.createDiv({
      cls: "obsidian-hub-preview-vault",
      text: `${this.preview.note.vaultName} \xB7 ${this.preview.note.relativePath}`
    });
    const body = this.contentEl.createDiv({ cls: "markdown-preview-view" });
    this.renderer = new import_obsidian2.Component();
    this.renderer.load();
    void import_obsidian2.MarkdownRenderer.render(
      this.app,
      this.preview.content,
      body,
      this.preview.note.relativePath,
      this.renderer
    ).catch(() => new import_obsidian2.Notice("\u65E0\u6CD5\u6E32\u67D3\u8DE8\u4ED3\u5E93\u7B14\u8BB0\u9884\u89C8\u3002"));
    const actions = this.contentEl.createDiv({ cls: "obsidian-hub-preview-actions" });
    const openButton = actions.createEl("button", {
      cls: "mod-cta",
      text: "\u5728\u76EE\u6807\u4ED3\u5E93\u6253\u5F00"
    });
    openButton.addEventListener("click", () => {
      openButton.disabled = true;
      void this.openInVault().then(() => this.close()).catch(() => {
        openButton.disabled = false;
        new import_obsidian2.Notice("\u65E0\u6CD5\u5728\u76EE\u6807\u4ED3\u5E93\u6253\u5F00\u7B14\u8BB0\u3002");
      });
    });
    const closeButton = actions.createEl("button", { text: "\u5173\u95ED" });
    closeButton.addEventListener("click", () => this.close());
  }
  onClose() {
    this.renderer?.unload();
    this.renderer = void 0;
    this.contentEl.empty();
  }
};

// src/types.ts
var DEFAULT_SETTINGS = {
  registryPath: "",
  vaultId: "",
  excludeCurrentVault: true,
  showCrossVaultIcon: true,
  resultLimit: 20
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
              () => onOpen(link.vaultName, link.vaultId, link.notePath)
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
  client = new LocalClient(() => this.settings);
  previewModal;
  async onload() {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...await this.loadData()
    };
    this.registerEditorExtension(
      createCrossVaultDecorations((vaultName, vaultId, notePath) => {
        void this.openLink(vaultName, vaultId, notePath);
      }).extension
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
  renderReadingLinks(element) {
    for (const anchor of element.querySelectorAll("a.internal-link")) {
      const previous = anchor.previousSibling;
      if (!(previous instanceof Text)) continue;
      const match = previous.data.match(/(?:^|\s)([@＠])([^@\n]+)$/);
      if (!match) continue;
      const { name: vaultName, id: vaultId } = splitVaultPart(match[2]);
      const notePath = anchor.dataset.href ?? anchor.getAttribute("data-href") ?? anchor.textContent;
      if (!vaultName || !notePath) continue;
      previous.data = previous.data.slice(0, previous.data.length - match[0].length) + (match[0].startsWith(" ") ? " " : "");
      anchor.classList.add("obsidian-hub-cross-vault-link");
      anchor.classList.remove("external-link");
      anchor.title = `${vaultName}
${notePath}`;
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.openLink(vaultName, vaultId, notePath);
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
        const renderedLink = document.createElement("span");
        renderedLink.className = "internal-link obsidian-hub-cross-vault-link";
        renderedLink.textContent = displayLabel(link.alias, link.notePath);
        renderedLink.title = `${link.vaultName}
${link.notePath}`;
        renderedLink.addEventListener("click", (event) => {
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
  async openLink(vault, vaultId, path3) {
    try {
      const note = await this.client.resolve(vault, path3, vaultId);
      const preview = await this.client.content(note);
      this.previewModal?.close();
      this.previewModal = new CrossVaultPreviewModal(
        this.app,
        preview,
        () => this.client.open(note).then(() => void 0)
      );
      this.previewModal.open();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("VAULT_OFFLINE:")) {
        new import_obsidian3.Notice(
          `\u4ED3\u5E93\u300C${error.message.slice("VAULT_OFFLINE:".length)}\u300D\u8DEF\u5F84\u4E0D\u53EF\u8BBF\u95EE\uFF0C\u53EF\u80FD\u5DF2\u79BB\u7EBF\u6216\u79FB\u52A8\u3002`
        );
      } else {
        new import_obsidian3.Notice("\u65E0\u6CD5\u52A0\u8F7D\u8DE8\u4ED3\u5E93\u7B14\u8BB0\u9884\u89C8\uFF0C\u8BF7\u786E\u8BA4\u76EE\u6807\u7B14\u8BB0\u5B58\u5728\u4E14\u53EF\u8BFB\u53D6\u3002");
      }
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
    new import_obsidian3.Setting(containerEl).setName("\u767B\u8BB0\u8868\u8DEF\u5F84").setDesc("Hub \u4ED3\u5E93\u767B\u8BB0\u8868 config.json \u7684\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u7531 Hub \u5B89\u88C5\u65F6\u5199\u5165\u3002").addText(
      (text) => text.setValue(this.plugin.settings.registryPath).onChange(async (value) => {
        this.plugin.settings.registryPath = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u5F53\u524D\u4ED3\u5E93 ID").addText(
      (text) => text.setValue(this.plugin.settings.vaultId).onChange(async (value) => {
        this.plugin.settings.vaultId = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u6392\u9664\u5F53\u524D\u4ED3\u5E93").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.excludeCurrentVault).onChange(async (value) => {
        this.plugin.settings.excludeCurrentVault = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u91CD\u65B0\u626B\u63CF\u7D22\u5F15").addButton(
      (button) => button.setButtonText("\u626B\u63CF").onClick(async () => {
        button.setDisabled(true);
        await this.plugin["client"].load();
        button.setDisabled(false);
        new import_obsidian3.Notice("\u8DE8\u4ED3\u5E93\u7D22\u5F15\u5DF2\u5237\u65B0\u3002");
      })
    );
  }
};
