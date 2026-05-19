import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  RequestUrlParam,
  Setting,
  WorkspaceLeaf,
  requestUrl,
  setIcon,
} from "obsidian";

const MINIFLUX_VIEW_TYPE = "miniflux-rss-view";
const WEB_VIEWER_TYPE = "webviewer";
type RequestUrlResponse = Awaited<ReturnType<typeof requestUrl>>;
type MinifluxFilter = "unread" | "all" | "starred";

interface WorkspaceWithExternalUrl {
  openUrl?: (url: string) => Promise<void> | void;
}

interface MinifluxPluginSettings {
  baseUrl: string;
  apiKey: string;
  pageSize: number;
  debugOpenLinks: boolean;
}

interface MinifluxFeed {
  id?: number;
  title?: string;
  site_url?: string;
}

interface MinifluxEntry {
  id: number;
  user_id?: number;
  feed_id?: number;
  title?: string;
  url?: string;
  comments_url?: string;
  author?: string;
  content?: string;
  hash?: string;
  published_at?: string;
  created_at?: string;
  changed_at?: string;
  status?: "read" | "unread" | "removed" | string;
  starred?: boolean;
  reading_time?: number;
  feed?: MinifluxFeed;
}

interface MinifluxEntriesResponse {
  total?: number;
  entries?: MinifluxEntry[];
}

const DEFAULT_SETTINGS: MinifluxPluginSettings = {
  baseUrl: "",
  apiKey: "",
  pageSize: 30,
  debugOpenLinks: false,
};

export default class MinifluxRssPlugin extends Plugin {
  settings: MinifluxPluginSettings;
  api: MinifluxApiClient;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.api = new MinifluxApiClient(() => this.settings);

    this.registerView(
      MINIFLUX_VIEW_TYPE,
      (leaf) => new MinifluxRssView(leaf, this),
    );

    this.addRibbonIcon("rss", "Open Miniflux RSS", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-miniflux-rss-view",
      name: "Open Miniflux RSS view",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "refresh-miniflux-rss",
      name: "Refresh Miniflux RSS view",
      callback: () => {
        this.refreshOpenViews();
      },
    });

    this.addSettingTab(new MinifluxSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(MINIFLUX_VIEW_TYPE);
  }

  async activateView(): Promise<void> {
    this.app.workspace.detachLeavesOfType(MINIFLUX_VIEW_TYPE);
    const leaf = this.app.workspace.getLeaf("tab");

    await leaf.setViewState({ type: MINIFLUX_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(MINIFLUX_VIEW_TYPE)) {
      if (leaf.view instanceof MinifluxRssView) {
        void leaf.view.reloadFromSettings();
      }
    }
  }

  async openEntry(entry: MinifluxEntry): Promise<void> {
    const url = normalizeArticleUrl(entry.url);
    await openInWebViewer(this.app, url, this.settings.debugOpenLinks);

    if (entry.status === "unread") {
      await this.api.updateEntriesStatus([entry.id], "read");
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.pageSize = normalizePageSize(this.settings.pageSize);
    this.settings.baseUrl = normalizeBaseUrl(this.settings.baseUrl);
  }

  async saveSettings(): Promise<void> {
    this.settings.pageSize = normalizePageSize(this.settings.pageSize);
    this.settings.baseUrl = normalizeBaseUrl(this.settings.baseUrl);
    await this.saveData(this.settings);
  }
}

class MinifluxApiClient {
  constructor(private readonly getSettings: () => MinifluxPluginSettings) {}

  async listEntries(options: {
    filter: MinifluxFilter;
    search: string;
    offset: number;
  }): Promise<MinifluxEntriesResponse> {
    const settings = this.getSettings();
    const query = new URLSearchParams({
      limit: String(settings.pageSize),
      offset: String(options.offset),
      order: "published_at",
      direction: "desc",
    });

    if (options.filter === "unread") {
      query.set("status", "unread");
    }

    if (options.filter === "starred") {
      query.set("starred", "true");
    }

    if (options.search.trim()) {
      query.set("search", options.search.trim());
    }

    return this.requestJson<MinifluxEntriesResponse>({
      url: this.url(`/entries?${query.toString()}`),
      method: "GET",
    });
  }

  async updateEntriesStatus(ids: number[], status: "read" | "unread"): Promise<void> {
    if (!ids.length) {
      return;
    }

    await this.requestNoContent({
      url: this.url("/entries"),
      method: "PUT",
      body: JSON.stringify({
        entry_ids: ids,
        status,
      }),
    });
  }

  private async requestJson<T>(options: RequestUrlParam): Promise<T> {
    const response = await this.requestRaw(options);
    const body = response.text.trim();

    if (!body) {
      throw new Error("Miniflux returned an empty response.");
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error("Miniflux returned invalid JSON.");
    }
  }

  private async requestNoContent(options: RequestUrlParam): Promise<void> {
    await this.requestRaw(options);
  }

  private async requestRaw(options: RequestUrlParam): Promise<RequestUrlResponse> {
    const settings = this.getSettings();

    if (!settings.baseUrl.trim()) {
      throw new Error("Miniflux server URL is not configured.");
    }

    if (!settings.apiKey.trim()) {
      throw new Error("Miniflux API key is not configured.");
    }

    const response = await requestUrl({
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": settings.apiKey.trim(),
        ...(options.headers ?? {}),
      },
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      const body = response.text ? `: ${response.text.slice(0, 200)}` : "";
      throw new Error(`Miniflux request failed (${response.status})${body}`);
    }

    return response;
  }

  private url(path: string): string {
    const safePath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizeBaseUrl(this.getSettings().baseUrl)}${safePath}`;
  }
}

class MinifluxRssView extends ItemView {
  private listEl: HTMLElement;
  private statusEl: HTMLElement;
  private loadMoreEl: HTMLElement;
  private searchInput: HTMLInputElement;
  private filterButtons = new Map<MinifluxFilter, HTMLButtonElement>();
  private entries: MinifluxEntry[] = [];
  private filter: MinifluxFilter = "unread";
  private search = "";
  private offset = 0;
  private total = 0;
  private isLoading = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: MinifluxRssPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return MINIFLUX_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Miniflux RSS";
  }

  getIcon(): string {
    return "rss";
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    await this.loadEntries(true);
  }

  async reloadFromSettings(): Promise<void> {
    await this.loadEntries(true);
  }

  private renderShell(): void {
    this.contentEl.empty();
    this.contentEl.addClass("miniflux-view");

    const toolbar = this.contentEl.createDiv({ cls: "miniflux-toolbar" });
    const titleGroup = toolbar.createDiv({ cls: "miniflux-title-group" });
    const titleIcon = titleGroup.createSpan({ cls: "miniflux-title-icon" });
    setIcon(titleIcon, "rss");
    titleGroup.createEl("h2", { text: "Miniflux RSS" });

    const actions = toolbar.createDiv({ cls: "miniflux-toolbar-actions" });
    this.createActionButton(actions, "refresh-cw", "Refresh", () => {
      void this.loadEntries(true);
    });

    const controls = this.contentEl.createDiv({ cls: "miniflux-controls" });
    const searchRow = controls.createDiv({ cls: "miniflux-search-row" });
    this.searchInput = searchRow.createEl("input", {
      cls: "miniflux-search-input",
      attr: {
        type: "search",
        placeholder: "Search entries",
      },
    });
    this.searchInput.value = this.search;
    this.searchInput.onkeydown = (event) => {
      if (event.key === "Enter") {
        this.search = this.searchInput.value.trim();
        void this.loadEntries(true);
      }
    };
    this.createActionButton(searchRow, "search", "Search", () => {
      this.search = this.searchInput.value.trim();
      void this.loadEntries(true);
    }, "Search");
    this.createActionButton(searchRow, "x", "Clear search", () => {
      this.searchInput.value = "";
      this.search = "";
      void this.loadEntries(true);
    });

    const filters = controls.createDiv({ cls: "miniflux-filters" });
    this.createFilterButton(filters, "unread", "Unread");
    this.createFilterButton(filters, "all", "All");
    this.createFilterButton(filters, "starred", "Starred");
    this.updateFilterButtons();

    this.statusEl = this.contentEl.createDiv({ cls: "miniflux-status" });
    this.listEl = this.contentEl.createDiv({ cls: "miniflux-card-list" });
    this.loadMoreEl = this.contentEl.createDiv({ cls: "miniflux-load-more" });
  }

  private async loadEntries(reset: boolean): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    const nextOffset = reset ? 0 : this.offset;
    this.setStatus(reset ? "Loading RSS entries..." : "Loading more entries...");
    this.renderLoadMore();

    try {
      const response = await this.plugin.api.listEntries({
        filter: this.filter,
        search: this.search,
        offset: nextOffset,
      });
      const incoming = response.entries ?? [];
      this.entries = reset ? incoming : [...this.entries, ...incoming];
      this.offset = nextOffset + incoming.length;
      this.total = response.total ?? this.entries.length;
      this.renderCards();
      this.setStatus(this.statusMessage());
    } catch (error) {
      const message = getErrorMessage(error);
      this.setStatus(message, true);
      new Notice(message);
    } finally {
      this.isLoading = false;
      this.renderLoadMore();
    }
  }

  private renderCards(): void {
    this.listEl.empty();

    for (const entry of this.entries) {
      const card = this.listEl.createDiv({ cls: "miniflux-card" });
      card.toggleClass("is-read", entry.status === "read");

      const header = card.createDiv({ cls: "miniflux-card-header" });
      const main = header.createDiv({ cls: "miniflux-card-main" });
      const title = main.createEl("button", {
        cls: "miniflux-card-title",
        text: entry.title?.trim() || "Untitled entry",
        attr: {
          type: "button",
          title: entry.url ?? "",
        },
      });
      title.onclick = () => {
        void this.openEntry(entry);
      };

      const actions = header.createDiv({ cls: "miniflux-card-actions" });
      this.createActionButton(actions, "external-link", "Open article", () => {
        void this.openEntry(entry);
      });

      const meta = main.createDiv({ cls: "miniflux-card-meta" });
      this.renderMeta(meta, entry);

      const summary = summarizeEntry(entry);
      if (summary) {
        main.createEl("p", { cls: "miniflux-summary", text: summary });
      }
    }
  }

  private renderMeta(parent: HTMLElement, entry: MinifluxEntry): void {
    if (entry.status === "unread") {
      parent.createEl("span", { cls: "miniflux-pill miniflux-pill-unread", text: "Unread" });
    }

    if (entry.starred) {
      parent.createEl("span", { cls: "miniflux-pill", text: "Starred" });
    }

    const feedTitle = entry.feed?.title?.trim();
    if (feedTitle) {
      parent.createEl("span", { text: feedTitle });
    }

    const author = entry.author?.trim();
    if (author) {
      parent.createEl("span", { text: author });
    }

    const date = formatDate(entry.published_at ?? entry.created_at);
    if (date) {
      parent.createEl("span", { text: date });
    }

    if (typeof entry.reading_time === "number" && entry.reading_time > 0) {
      parent.createEl("span", { text: `${entry.reading_time} min` });
    }
  }

  private async openEntry(entry: MinifluxEntry): Promise<void> {
    try {
      await this.plugin.openEntry(entry);
      if (entry.status === "unread") {
        entry.status = "read";
        this.renderCards();
        this.setStatus(this.statusMessage());
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.setStatus(message, true);
      new Notice(message);
    }
  }

  private renderLoadMore(): void {
    this.loadMoreEl.empty();

    if (!this.hasMore()) {
      return;
    }

    const button = this.loadMoreEl.createEl("button", {
      cls: "miniflux-load-more-button",
      attr: { type: "button" },
    });
    setIcon(button, "chevron-down");
    button.createSpan({ text: this.isLoading ? "Loading..." : "Load more" });
    button.disabled = this.isLoading;
    button.onclick = () => {
      void this.loadEntries(false);
    };
  }

  private createFilterButton(
    parent: HTMLElement,
    filter: MinifluxFilter,
    label: string,
  ): void {
    const button = parent.createEl("button", {
      cls: "miniflux-button miniflux-filter-button",
      text: label,
      attr: { type: "button" },
    });
    button.onclick = () => {
      if (this.filter === filter) {
        return;
      }
      this.filter = filter;
      this.updateFilterButtons();
      void this.loadEntries(true);
    };
    this.filterButtons.set(filter, button);
  }

  private updateFilterButtons(): void {
    for (const [filter, button] of this.filterButtons) {
      const active = filter === this.filter;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  private hasMore(): boolean {
    return this.total > 0 && this.entries.length < this.total;
  }

  private statusMessage(): string {
    if (!this.entries.length) {
      return this.search ? "No matching entries found." : "No entries found.";
    }

    return this.hasMore()
      ? `Showing ${this.entries.length} of ${this.total} entries.`
      : `Showing ${this.entries.length} entries.`;
  }

  private setStatus(message: string, isError = false): void {
    this.statusEl.setText(message);
    this.statusEl.toggleClass("is-error", isError);
  }

  private createActionButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
    text?: string,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: text ? "miniflux-button" : "miniflux-icon-button",
      attr: {
        type: "button",
        "aria-label": label,
        title: label,
      },
    });
    setIcon(button, icon);

    if (text) {
      button.createSpan({ text });
    }

    button.onclick = onClick;
    return button;
  }
}

class MinifluxSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: MinifluxRssPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Miniflux RSS View" });

    new Setting(containerEl)
      .setName("Miniflux server URL")
      .setDesc("Base URL of your Miniflux instance. A trailing /v1 is accepted.")
      .addText((text) => {
        text
          .setPlaceholder("https://miniflux.example.com")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.baseUrl = normalizeBaseUrl(value);
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          });
      });

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Stored in Obsidian plugin data and sent as X-Auth-Token.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("Paste your Miniflux API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Page size")
      .setDesc("Number of entries to request per page.")
      .addSlider((slider) => {
        slider
          .setLimits(10, 100, 10)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.pageSize)
          .onChange(async (value) => {
            this.plugin.settings.pageSize = normalizePageSize(value);
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          });
      });

    new Setting(containerEl)
      .setName("Debug link opening")
      .setDesc("Show diagnostic notices when opening RSS entry URLs.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.debugOpenLinks)
          .onChange(async (value) => {
            this.plugin.settings.debugOpenLinks = value;
            await this.plugin.saveSettings();
          });
      });
  }
}

async function openInWebViewer(app: App, url: string, debug: boolean): Promise<void> {
  const externalUrl = normalizeExternalBrowserUrl(url);
  const workspace = app.workspace as typeof app.workspace & WorkspaceWithExternalUrl;

  if (debug) {
    new Notice(`Opening in Web viewer: ${externalUrl}`);
  }

  try {
    if (typeof workspace.openUrl === "function") {
      await workspace.openUrl(externalUrl);
      if (debug) {
        new Notice("workspace.openUrl completed.");
      }
      return;
    }

    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: WEB_VIEWER_TYPE,
      active: true,
      state: {
        url: externalUrl,
        navigate: true,
      },
    });
    await app.workspace.revealLeaf(leaf);
    if (debug) {
      new Notice("Web viewer leaf opened.");
    }
  } catch (error) {
    new Notice(`Unable to open Web viewer. Enable Obsidian core plugin Web viewer, then retry. ${getErrorMessage(error)}`);
  }
}

function normalizeBaseUrl(value: string): string {
  let normalized = value.trim().replace(/\/+$/, "");
  normalized = normalized.replace(/\/api\/v1$/i, "");
  normalized = normalized.replace(/\/v1$/i, "");
  return normalized ? `${normalized}/v1` : "";
}

function normalizeArticleUrl(value: string | undefined): string {
  const url = value?.trim();
  if (!url) {
    throw new Error("RSS entry has no article URL.");
  }
  return url;
}

function normalizeExternalBrowserUrl(value: string): string {
  const url = value.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("RSS entry URL must start with http:// or https://.");
  }

  return url;
}

function normalizePageSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.pageSize;
  }

  return Math.min(100, Math.max(10, Math.round(value)));
}

function summarizeEntry(entry: MinifluxEntry): string {
  const content = entry.content?.trim();
  if (!content) {
    return "";
  }

  const text = normalizeWhitespace(htmlToText(content));
  return text.length > 280 ? `${text.slice(0, 277).trim()}...` : text;
}

function htmlToText(html: string): string {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element.textContent ?? "";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
