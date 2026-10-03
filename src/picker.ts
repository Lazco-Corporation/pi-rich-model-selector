import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { KeybindingsManager, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, Keybinding, TUI } from "@earendil-works/pi-tui";
import { Container, fuzzyFilter, Input, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatKeys, type KeyLabel } from "./keys.ts";
import {
  buildFacts,
  effectiveThinkingLevel,
  formatPricePair,
  formatTokens,
  supportedThinkingLevels,
  thinkingLevelColor,
} from "./model-facts.ts";
import { type CustomKeys, type ModelThinkingStore, modelKey, type StarStore } from "./store.ts";
import { computeWindowLayout, WindowFrame } from "./window.ts";

/** Below this width the fact pane moves under the list instead of beside it. */
const TWO_PANE_MIN_WIDTH = 100;
const MAX_VISIBLE_ROWS = 12;
const SIDE_PANE_WIDTH = 46;
/**
 * How long a catalog refresh may run before the picker gives up on it. The
 * same bound pi's own picker uses. A refresh asks every provider for its
 * catalog and its auth state, so a slow one would otherwise run for minutes.
 */
const CATALOG_REFRESH_TIMEOUT_MS = 15_000;

/*
 * The actions pi has no keybinding action for read their keys from the
 * store, so the user rebinds them with `/models bind`. Every other key comes
 * from pi's keybindings, so a key the user rebinds there moves here too.
 *
 * A custom key that names a key the picker already claims keeps the old
 * meaning: pi's actions are checked first, the filter box last. So the
 * defaults avoid pi's editing keys. That matters most for Ctrl+E: fullscreen
 * mode gives Home and End to the transcript, which leaves Ctrl+E the only
 * way to the end of the search text.
 *
 * Shift+Tab only climbs, as it does in pi, so going one level down takes a
 * full lap. The level-down and level-up keys step either way. Plain Left and
 * Right stay with the search box, which needs them more.
 */

export interface PickerTheme {
  fg(color: string, text: string): string;
}

export interface ModelItem {
  key: string;
  provider: string;
  id: string;
  model: Model<any>;
  /** Row cells that depend on the model alone, formatted once at load. */
  idWidth: number;
  contextText: string;
  priceText: string;
  /** What the search box matches against. Built once, not per key press. */
  searchText: string;
  /**
   * The level column, as text and as columns. Set at load, and again for the
   * one row a level key changes. Working it out means asking pi which levels
   * the model accepts, and that is too slow to repeat for a thousand rows on
   * every key press.
   */
  thinkingText: string;
  thinkingWidth: number;
}

/** Column widths for one filtered list. Cached, because they cost a pass over every row. */
interface ColumnWidths {
  id: number;
  context: number;
  price: number;
  thinking: number;
}

export interface PickerOptions {
  tui: TUI;
  theme: PickerTheme;
  store: StarStore;
  /** Per-model thinking levels. The level keys write through this. */
  thinkingStore: ModelThinkingStore;
  /** Pi's keybindings, with the user's keybindings.json applied. */
  keybindings: KeybindingsManager;
  /**
   * The level a model without an entry of its own switches to: the global
   * default, or the level the session runs at when there is none.
   */
  defaultThinkingLevel: ModelThinkingLevel;
  registry: ModelRegistry;
  currentModel: Model<any> | undefined;
  defaultModel: { provider: string; id: string } | undefined;
  contextTokens: number | null;
  initialSearch?: string;
  onSelect(model: Model<any>): void;
  onCancel(): void;
  /**
   * Set or clear the startup default model. Both arguments set it, both
   * undefined clear it. Resolves to an error message on failure, or to
   * undefined on success.
   */
  onSetDefaultModel(provider: string | undefined, id: string | undefined): Promise<string | undefined>;
}

type Scope = "starred" | "all" | "hidden";

const SCOPE_ORDER: Scope[] = ["starred", "all", "hidden"];

/** One key hint, in a long form and a short form. */
interface HintItem {
  long: string;
  short: string;
}

/** Pads a plain string. ANSI color codes would break String.padEnd. */
function padPlain(text: string, width: number): string {
  const length = visibleWidth(text);
  return length >= width ? truncateToWidth(text, width, "…") : text + " ".repeat(width - length);
}

/** Wrap plain text on word breaks. Used for fact values in a narrow pane. */
function wrapPlain(text: string, width: number): string[] {
  if (visibleWidth(text) <= width) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (visibleWidth(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = visibleWidth(word) > width ? truncateToWidth(word, width, "…") : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Model picker with facts, stars, and star re-order.
 *
 * Layout is one HStack. The fact pane hides itself on a narrow terminal, and a
 * second copy of the facts renders under the list instead.
 */
export class RichModelPicker extends Container implements Focusable {
  private readonly frame: WindowFrame;
  private readonly searchInput = new Input();
  private readonly listContainer = new Container();
  private readonly factPane = new Container();
  private readonly statusText: Text;
  private readonly scopeText: Text;

  private allItems: ModelItem[] = [];
  /**
   * Every model in the order the list shows them. Sorting a thousand rows is
   * the single biggest cost in the picker, and a key press in the search box
   * cannot change the order, so the sort runs only when the order can change.
   *
   * Every star, hide, and reorder goes through the store, and the store may
   * also pull in another session's change on the way. So any store call that
   * can write sets the flag, rather than the picker guessing which field
   * moved. The startup default and the catalog set it too.
   */
  private sortedItems: ModelItem[] = [];
  private orderDirty = true;
  private filtered: ModelItem[] = [];
  /** The list the cached widths were measured on. Identity, not content. */
  private widthsFor: ModelItem[] | undefined;
  private widths: ColumnWidths | undefined;
  /**
   * Bumped on every thinking level change. The thinking column width depends
   * on the level text, so a cached width is only valid for one revision.
   */
  private thinkingRevision = 0;
  private widthsThinkingRevision = -1;
  private selectedIndex = 0;
  private scope: Scope = "all";
  private status = "";
  private statusTone: "muted" | "error" | "success" = "muted";
  private lastWidth = 0;
  private closed = false;
  /** True while a startup-default write is on its way to settings.json. */
  private defaultWriteInFlight = false;
  /** Cancels the catalog refresh when the picker closes before it finishes. */
  private readonly refreshAbort = new AbortController();
  /** The key of the model in use, so the sort compares strings, not models. */
  private readonly currentKey: string | undefined;
  private readonly keyLabels = new Map<string, KeyLabel | undefined>();

  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(private readonly options: PickerOptions) {
    super();
    const { theme } = options;
    this.currentKey = options.currentModel
      ? modelKey(options.currentModel.provider, options.currentModel.id)
      : undefined;

    this.scopeText = new Text("", 0, 0);
    this.statusText = new Text("", 0, 0);

    this.frame = new WindowFrame(theme, {
      rightPaneWidth: SIDE_PANE_WIDTH,
      minSplitWidth: TWO_PANE_MIN_WIDTH,
    });
    this.frame.setTitle("Select a model");
    super.addChild(this.frame);

    // Header sits above the crossbar of the T. The two panes sit below it.
    this.frame.header.addChild(this.scopeText);
    this.frame.header.addChild(this.searchInput);
    this.frame.left.addChild(this.listContainer);
    this.frame.left.addChild(this.statusText);
    this.frame.right.addChild(this.factPane);

    this.searchInput.onSubmit = () => this.confirmSelection();

    this.loadModels();
    if (options.initialSearch) this.searchInput.setValue(options.initialSearch);
    this.scope = this.options.store.getStarred().length > 0 ? "starred" : "all";
    this.applyFilter();
    if (options.initialSearch) this.widenScopeIfEmpty();
    else this.selectCurrentModel();
    void this.refreshCatalog();
  }

  /**
   * A search from the command line must never open on an empty list. The
   * starred view is the default, and the wanted model is often not starred.
   */
  private widenScopeIfEmpty(): void {
    if (this.filtered.length > 0 || this.scope !== "starred") return;
    this.scope = "all";
    this.applyFilter();
  }

  /**
   * Start on the model in use, not on row one. A search query means the user
   * looks for something else, so the query wins.
   */
  private selectCurrentModel(): void {
    if (!this.options.currentModel) return;
    const inScope = this.filtered.findIndex((item) => this.isCurrent(item));
    if (inScope >= 0) {
      this.selectedIndex = inScope;
      this.updateList();
      return;
    }
    // The model in use is not starred, so show the view that holds it.
    if (this.scope !== "all" && this.allItems.some((item) => this.isCurrent(item))) {
      this.scope = "all";
      this.applyFilter();
      const index = this.filtered.findIndex((item) => this.isCurrent(item));
      if (index >= 0) this.selectedIndex = index;
      this.updateList();
    }
  }

  private loadModels(): void {
    const available = this.options.registry.getAvailable();
    this.allItems = available.map((model) => ({
      key: modelKey(model.provider, model.id),
      provider: model.provider,
      id: model.id,
      model,
      idWidth: visibleWidth(model.id),
      contextText: formatTokens(model.contextWindow ?? 0),
      priceText: formatPricePair(model),
      searchText: `${model.id} ${model.provider} ${model.name ?? ""}`,
      thinkingText: "",
      thinkingWidth: 0,
    }));
    this.orderDirty = true;
    const availableKeys = new Set(this.allItems.map((item) => item.key));
    this.options.store.prune(availableKeys);
    this.options.thinkingStore.prune(availableKeys);
    // After the prune, so a level for a model that is gone cannot leak in.
    for (const item of this.allItems) this.setThinkingCell(item);
  }

  /**
   * Pull fresh model catalogs, then redraw. Never throws into the UI.
   *
   * The refresh stops when the picker closes, and after a bound. Without
   * either, a user who opens and closes the picker leaves a refresh running
   * behind it, and that refresh talks to every provider.
   */
  private async refreshCatalog(): Promise<void> {
    const timeout = setTimeout(() => this.refreshAbort.abort(), CATALOG_REFRESH_TIMEOUT_MS);
    // A pending timeout must never hold pi open on the way out.
    timeout.unref?.();
    try {
      await this.options.registry.refresh({ signal: this.refreshAbort.signal });
      if (this.closed) return;
      const selectedKey = this.filtered[this.selectedIndex]?.key;
      this.loadModels();
      this.applyFilter();
      if (selectedKey) {
        const index = this.filtered.findIndex((item) => item.key === selectedKey);
        if (index >= 0) {
          this.selectedIndex = index;
          this.updateList();
        }
      }
      this.options.tui.requestRender();
    } catch {
      // Cached models are already on screen, so a refresh failure is not fatal.
    } finally {
      clearTimeout(timeout);
    }
  }

  private isCurrent(item: ModelItem): boolean {
    return item.key === this.currentKey;
  }

  /** The level this model would run at, and whether the user pinned it. */
  private levelOf(item: ModelItem): { level: ModelThinkingLevel; pinned: boolean } {
    return effectiveThinkingLevel(
      item.model,
      this.options.thinkingStore.get(item.key),
      this.options.defaultThinkingLevel,
    );
  }

  /**
   * Refresh the level cell of one row. The column is sized from these cells,
   * so the text and its width are kept together.
   */
  private setThinkingCell(item: ModelItem): void {
    if (!item.model.reasoning) {
      item.thinkingText = "-";
      item.thinkingWidth = 1;
      return;
    }
    const { level, pinned } = this.levelOf(item);
    item.thinkingText = pinned ? level : `${level} ·`;
    // The level names are plain ASCII, so the width is the length. The dot is
    // one column wide, plus the space before it.
    item.thinkingWidth = level.length + (pinned ? 0 : 2);
  }

  /** The level column, colored. A dot means the level follows the global default. */
  private renderLevelCell(item: ModelItem, width: number): string {
    const { theme } = this.options;
    const padding = " ".repeat(Math.max(0, width - item.thinkingWidth));
    if (!item.model.reasoning) return theme.fg("dim", item.thinkingText) + padding;
    const { level, pinned } = this.levelOf(item);
    const colored = this.safeColor(thinkingLevelColor(level), level);
    return `${colored}${pinned ? "" : theme.fg("dim", " ·")}${padding}`;
  }

  /**
   * The model under the cursor and the levels it accepts, or undefined after
   * telling the user why its level cannot move.
   */
  private levelTarget(): { item: ModelItem; levels: ModelThinkingLevel[]; index: number } | undefined {
    const item = this.filtered[this.selectedIndex];
    if (!item) return undefined;
    if (!item.model.reasoning) {
      this.setStatus(`${item.id} does not support thinking.`, "error");
      return undefined;
    }
    const levels = supportedThinkingLevels(item.model);
    if (levels.length < 2) {
      this.setStatus(`${item.id} has one thinking level only (${levels[0] ?? "none"}).`, "muted");
      return undefined;
    }
    return { item, levels, index: levels.indexOf(this.levelOf(item).level) };
  }

  /**
   * Step the level of the model under the cursor to the next one it supports.
   *
   * Wraps at the top, as pi's own Shift+Tab does. One key has to reach every
   * level, so stopping at the end would strand a user at `max`.
   */
  private cycleThinkingLevel(): void {
    const target = this.levelTarget();
    if (!target) return;
    const { item, levels, index } = target;
    // An unknown level means the row is out of step with the model. Starting at
    // the bottom still moves, instead of leaving the key looking broken.
    const next = levels[index < 0 ? 0 : (index + 1) % levels.length];
    if (next) this.setThinkingLevel(item, next);
  }

  /** Step the level one way, and stop at the end of the scale. */
  private stepThinkingLevel(direction: -1 | 1): void {
    const target = this.levelTarget();
    if (!target) return;
    const { item, levels, index } = target;
    const next = levels[index < 0 ? 0 : index + direction];
    if (!next) {
      // Say so, rather than leave the key looking broken.
      const end = direction > 0 ? "highest" : "lowest";
      this.setStatus(`${item.id} is at its ${end} thinking level (${levels[index]}).`, "muted");
      return;
    }
    this.setThinkingLevel(item, next);
  }

  /**
   * The level is saved against the model, not the session, so a row far from
   * the model in use can still be set. Pi applies it when it switches there.
   */
  private setThinkingLevel(item: ModelItem, next: ModelThinkingLevel): void {
    // A pin equal to the inherited level only repeats it, and would then stop
    // following a later change to that level. Clearing keeps one meaning for
    // the dot: this row follows the default.
    const inherited = effectiveThinkingLevel(item.model, undefined, this.options.defaultThinkingLevel).level;
    if (next === inherited) {
      this.options.thinkingStore.clear(item.key);
      this.setStatus(`${item.id} follows the default thinking level (${next}).`, "success");
    } else {
      this.options.thinkingStore.set(item.key, next);
      this.setStatus(`${item.id} thinking level is ${next}.`, "success");
    }
    this.setThinkingCell(item);
    this.thinkingRevision += 1;
    this.updateList();
  }

  private isDefault(item: ModelItem): boolean {
    const fallback = this.options.defaultModel;
    return fallback?.provider === item.provider && fallback.id === item.id;
  }

  /**
   * Starred models first in star order, then current, default, provider, id.
   *
   * The comparator runs tens of thousands of times for a thousand rows, so it
   * reads only strings and a map. Star rank is a map, not an indexOf per call,
   * and the current and default models are keys, not model objects.
   */
  private sortItems(items: ModelItem[]): ModelItem[] {
    const starRank = new Map(this.options.store.getStarred().map((key, index) => [key, index]));
    const currentKey = this.currentKey;
    const fallback = this.options.defaultModel;
    const defaultKey = fallback ? modelKey(fallback.provider, fallback.id) : undefined;
    return [...items].sort((left, right) => {
      const leftRank = starRank.get(left.key);
      const rightRank = starRank.get(right.key);
      if (leftRank !== undefined || rightRank !== undefined) {
        if (leftRank === undefined) return 1;
        if (rightRank === undefined) return -1;
        return leftRank - rightRank;
      }
      const leftCurrent = left.key === currentKey;
      if (leftCurrent !== (right.key === currentKey)) return leftCurrent ? -1 : 1;
      const leftDefault = left.key === defaultKey;
      if (leftDefault !== (right.key === defaultKey)) return leftDefault ? -1 : 1;
      const byProvider = left.provider.localeCompare(right.provider);
      return byProvider !== 0 ? byProvider : left.id.localeCompare(right.id);
    });
  }

  private scopeItems(): ModelItem[] {
    if (this.orderDirty) {
      this.sortedItems = this.sortItems(this.allItems);
      this.orderDirty = false;
    }
    const store = this.options.store;
    // A Set per call. The hidden list is short, but a thousand includes() calls
    // on it still add up, and this runs on every key press in the search box.
    if (this.scope === "starred") {
      const starred = new Set(store.getStarred());
      return this.sortedItems.filter((item) => starred.has(item.key));
    }
    const hidden = new Set(store.getHidden());
    if (this.scope === "hidden") return this.sortedItems.filter((item) => hidden.has(item.key));
    // The "all" view is the working list, so hidden models stay out of it.
    return this.sortedItems.filter((item) => !hidden.has(item.key));
  }

  private applyFilter(): void {
    const query = this.searchInput.getValue().trim();
    const pool = this.scopeItems();
    this.filtered = query ? fuzzyFilter(pool, query, (item) => item.searchText) : pool;
    if (query) this.selectedIndex = 0;
    else this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    this.updateScopeLine();
    this.updateList();
  }

  /**
   * Column widths come from the whole list, not the visible slice. Slice widths
   * would change while the user scrolls, and the columns would jump sideways.
   *
   * Measured once per filtered list. A cursor move keeps the same list, so it
   * must not pay for a pass over every row again.
   */
  private columnWidths(): ColumnWidths {
    if (this.widths && this.widthsFor === this.filtered && this.widthsThinkingRevision === this.thinkingRevision) {
      return this.widths;
    }
    let id = 0;
    let context = 0;
    let price = 0;
    let thinking = 0;
    for (const item of this.filtered) {
      if (item.idWidth > id) id = item.idWidth;
      if (item.contextText.length > context) context = item.contextText.length;
      if (item.priceText.length > price) price = item.priceText.length;
      // The dot that marks an inherited level sits inside this width, so a
      // pinned row and an inherited row start at the same column.
      if (item.thinkingWidth > thinking) thinking = item.thinkingWidth;
    }
    this.widths = { id: Math.min(38, id), context, price, thinking };
    this.widthsFor = this.filtered;
    this.widthsThinkingRevision = this.thinkingRevision;
    return this.widths;
  }

  private updateScopeLine(): void {
    const { theme, store } = this.options;
    const starredCount = store.getStarred().length;
    const hiddenCount = store.getHidden().length;
    const label = (scope: Scope, text: string) =>
      this.scope === scope ? theme.fg("accent", text) : theme.fg("muted", text);
    const separator = theme.fg("muted", " | ");
    const views = [label("starred", "starred"), label("all", "all"), label("hidden", "hidden")].join(separator);
    const counts = `   ${starredCount} starred, ${hiddenCount} hidden, ${this.allItems.length} total`;
    this.scopeText.setText(`${theme.fg("muted", "View: ")}${views}${theme.fg("muted", counts)}`);
  }

  /**
   * Column widths come from the real rows, so the columns line up whatever the
   * model names are.
   */
  private updateList(): void {
    this.listContainer.clear();
    const { theme, store, registry } = this.options;

    if (this.filtered.length === 0) {
      let message = "No model matches the search.";
      if (this.scope === "starred" && store.getStarred().length === 0) {
        const view = this.keyName(this.actionKey("tui.input.tab"));
        message = `No starred models yet. Press ${view} for all, then ${this.keyName(this.customKeys().star)} to star one.`;
      } else if (this.scope === "hidden" && store.getHidden().length === 0) {
        message = `No hidden models. Press ${this.keyName(this.customKeys().hide)} on a model to hide it.`;
      }
      this.listContainer.addChild(new Text(theme.fg("muted", message), 0, 0));
      this.renderFacts();
      return;
    }

    const total = this.filtered.length;
    const half = Math.floor(MAX_VISIBLE_ROWS / 2);
    const start = Math.max(0, Math.min(this.selectedIndex - half, total - MAX_VISIBLE_ROWS));
    const end = Math.min(start + MAX_VISIBLE_ROWS, total);
    const widths = this.columnWidths();

    for (let index = start; index < end; index++) {
      const item = this.filtered[index];
      if (!item) continue;
      const isSelected = index === this.selectedIndex;
      const starred = store.isStarred(item.key);

      const cursor = isSelected ? theme.fg("accent", "→") : " ";
      let star = starred ? theme.fg("warning", "★") : theme.fg("dim", "·");
      if (store.isHidden(item.key)) star = theme.fg("dim", "✗");
      const id = padPlain(item.id, widths.id);
      const context = padPlain(item.contextText, widths.context);
      const price = padPlain(item.priceText, widths.price);

      const marks =
        (this.isCurrent(item) ? theme.fg("success", " ✓") : "") +
        (this.isDefault(item) ? theme.fg("muted", " ·default") : "") +
        (registry.hasConfiguredAuth(item.model) ? "" : theme.fg("error", " ·no key"));

      const body =
        `${isSelected ? theme.fg("accent", id) : id} ` +
        `${theme.fg("muted", context)} ${theme.fg("muted", price)}` +
        ` ${this.renderLevelCell(item, widths.thinking)}${marks}`;

      this.listContainer.addChild(new Text(`${cursor} ${star} ${body}`, 0, 0));
    }

    if (total > MAX_VISIBLE_ROWS) {
      this.listContainer.addChild(new Text(theme.fg("muted", `  ${this.selectedIndex + 1}/${total}`), 0, 0));
    }

    this.renderFacts();
  }

  private renderFacts(): void {
    this.factPane.clear();
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    for (const line of this.factLines(item, this.factPaneWidth())) {
      this.factPane.addChild(new Text(line, 0, 0));
    }
  }

  /** Width the frame gives the fact pane, split or stacked. */
  private factPaneWidth(): number {
    const layout = computeWindowLayout(this.lastWidth, SIDE_PANE_WIDTH, TWO_PANE_MIN_WIDTH);
    return layout.rightWidth;
  }

  private factLines(item: ModelItem, paneWidth: number): string[] {
    const { theme, registry } = this.options;
    const facts = buildFacts({
      model: item.model,
      providerName: registry.getProviderDisplayName(item.provider),
      hasAuth: registry.hasConfiguredAuth(item.model),
      usingOAuth: registry.isUsingOAuth(item.model),
      contextTokens: this.options.contextTokens,
    });

    const labelWidth = Math.max(...facts.map((fact) => fact.label.length));
    const valueWidth = Math.max(12, paneWidth - labelWidth - 2);
    const lines = [theme.fg("accent", truncateToWidth(item.id, paneWidth, "…"))];
    const indent = " ".repeat(labelWidth + 2);

    for (const fact of facts) {
      const label = theme.fg("muted", padPlain(fact.label, labelWidth));

      if (fact.parts && visibleWidth(fact.value) <= valueWidth) {
        const colored = fact.parts.map((part) => this.safeColor(part.color, part.text)).join("");
        lines.push(`${label}  ${colored}`);
        continue;
      }

      const color = fact.tone === "warn" ? "warning" : "text";
      const [first, ...rest] = wrapPlain(fact.value, valueWidth);
      lines.push(`${label}  ${theme.fg(color, first ?? "")}`);
      // Continuation lines line up under the value, not under the label.
      for (const extra of rest) lines.push(`${indent}${theme.fg(color, extra)}`);
    }
    return lines;
  }

  /**
   * Colors text, and falls back when the theme lacks the color.
   *
   * `thinkingMax` is optional in a theme, and `theme.fg` throws on an unknown
   * color name. A missing color must not take down the picker.
   */
  private safeColor(color: string, text: string): string {
    try {
      return this.options.theme.fg(color, text);
    } catch {
      return this.options.theme.fg("text", text);
    }
  }

  /** Make the model under the cursor the model pi starts with, or undo it. */
  private async toggleDefault(): Promise<void> {
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    // The write is not instant, so a second press can arrive while the first
    // one runs. Two writes in flight would fight over the same two fields.
    if (this.defaultWriteInFlight) return;
    const wasDefault = this.isDefault(item);

    this.defaultWriteInFlight = true;
    let error: string | undefined;
    try {
      error = await this.options.onSetDefaultModel(
        wasDefault ? undefined : item.provider,
        wasDefault ? undefined : item.id,
      );
    } finally {
      this.defaultWriteInFlight = false;
    }

    // The user may have closed the picker while the write ran.
    if (this.closed) return;
    // The row only moves after the file says so, so a failure leaves the
    // picker exactly as it was.
    if (error) {
      this.setStatus(error, "error");
      this.options.tui.requestRender();
      return;
    }

    this.options.defaultModel = wasDefault ? undefined : { provider: item.provider, id: item.id };
    this.setStatus(
      wasDefault ? "Cleared the startup default model." : `${item.id} is now the startup default. Restart pi to use it.`,
      "success",
    );
    // The sort puts the default model near the front, so the write moves the
    // row. Re-filter and re-find the row, like toggleStar does.
    this.orderDirty = true;
    this.applyFilter();
    const index = this.filtered.findIndex((entry) => entry.key === item.key);
    if (index >= 0) this.selectedIndex = index;
    else this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    this.updateList();
    // handleInput already returned, so the render loop needs telling.
    this.options.tui.requestRender();
  }

  private setStatus(message: string, tone: "muted" | "error" | "success" = "muted"): void {
    this.status = message;
    this.statusTone = tone;
    this.statusText.setText(message ? this.options.theme.fg(this.statusTone, this.status) : "");
  }

  /** The first key of a pi action. Undefined when the user unbound it. */
  private actionKey(action: Keybinding): string | undefined {
    return this.options.keybindings.getKeys(action)[0];
  }

  /** The four custom keys as the user bound them. Read fresh each time, so a
   * `/models bind` between two opens shows on the next open. */
  private customKeys(): CustomKeys {
    return this.options.store.getKeys();
  }

  /** Label for a group of keys. An unbound one drops out. */
  private keyLabel(...keyIds: (string | undefined)[]): KeyLabel | undefined {
    const bound = keyIds.filter((keyId): keyId is string => keyId !== undefined);
    // The hint redraws on every resize and view change, and the bindings cannot
    // change while the picker is open: a /reload builds a new picker.
    const cacheKey = bound.join(" ");
    if (this.keyLabels.has(cacheKey)) return this.keyLabels.get(cacheKey);
    const label = formatKeys(bound);
    this.keyLabels.set(cacheKey, label);
    return label;
  }

  /** A key name for a message. A user can unbind any action, so say so. */
  private keyName(keyId: string | undefined): string {
    return this.keyLabel(keyId)?.long ?? "(no key bound)";
  }

  /**
   * Fits the key hints to the right of the title, in the top border.
   *
   * The full hint text does not fit a narrow window, and a plain cut would leave
   * a half word plus an ellipsis. Instead the hint drops whole items from the
   * right, least useful first, and then falls back to short labels.
   */
  private updateHint(): void {
    const hint = (label: KeyLabel | undefined, word: string, mark = ""): HintItem | undefined =>
      label && { long: `${label.long} ${word}`, short: label.short + mark };
    const pick = hint(this.keyLabel(this.actionKey("tui.select.confirm")), "pick");
    const custom = this.customKeys();
    const thinkingKeys = this.keyLabel(this.actionKey("app.thinking.cycle"), custom.levelDown, custom.levelUp);
    const thinking = hint(thinkingKeys, "thinking");
    const star = hint(this.keyLabel(custom.star), "star", "★");
    const hide = hint(this.keyLabel(custom.hide), "hide");
    const restore = hint(this.keyLabel(custom.hide), "restore");
    const reorderKeys = this.keyLabel(this.actionKey("app.models.reorderUp"), this.actionKey("app.models.reorderDown"));
    const reorder = hint(reorderKeys, "reorder");
    const setDefault = hint(this.keyLabel(this.actionKey("app.models.save")), "default");
    const followingView = SCOPE_ORDER[(SCOPE_ORDER.indexOf(this.scope) + 1) % SCOPE_ORDER.length] ?? "all";
    const view = hint(this.keyLabel(this.actionKey("tui.input.tab")), followingView);
    const close = hint(this.keyLabel(this.actionKey("tui.select.cancel")), "close");

    let candidates: (HintItem | undefined)[];
    if (this.scope === "starred") {
      candidates = [pick, thinking, star, reorder, setDefault, hide, view, close];
    } else if (this.scope === "hidden") {
      candidates = [pick, thinking, restore, setDefault, view, close];
    } else {
      candidates = [pick, thinking, star, setDefault, hide, view, close];
    }
    const hints = candidates.filter((item): item is HintItem => item !== undefined);

    const budget = this.frame.hintBudget(this.lastWidth);
    const join = (items: string[]) => items.join(" · ");

    const long = join(hints.map((hint) => hint.long));
    if (visibleWidth(long) <= budget) {
      this.frame.setHint(long);
      return;
    }

    const short = join(hints.map((hint) => hint.short));
    if (visibleWidth(short) <= budget) {
      this.frame.setHint(short);
      return;
    }

    // Even short labels overflow, so drop items from the right. Enter and Esc
    // matter most, so keep the first item and the last item as long as possible.
    for (let count = hints.length - 1; count >= 2; count--) {
      const kept = [...hints.slice(0, count - 1), hints[hints.length - 1]];
      const text = join(kept.filter((hint): hint is HintItem => hint !== undefined).map((hint) => hint.short));
      if (visibleWidth(text) <= budget) {
        this.frame.setHint(text);
        return;
      }
    }

    const last = hints[hints.length - 1]?.short ?? "";
    this.frame.setHint(visibleWidth(last) <= budget ? last : "");
  }

  private moveCursor(delta: number): void {
    if (this.filtered.length === 0) return;
    const total = this.filtered.length;
    this.selectedIndex = (this.selectedIndex + delta + total) % total;
    this.updateList();
  }

  /** A page stops at the ends instead of wrapping, as in pi's own lists. */
  private moveCursorByPage(direction: -1 | 1): void {
    if (this.filtered.length === 0) return;
    const last = this.filtered.length - 1;
    this.selectedIndex = Math.max(0, Math.min(last, this.selectedIndex + direction * MAX_VISIBLE_ROWS));
    this.updateList();
  }

  private toggleStar(): void {
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    const nowStarred = this.options.store.toggleStar(item.key);
    this.orderDirty = true;
    this.setStatus(nowStarred ? `Starred ${item.id}` : `Removed star from ${item.id}`, "success");
    this.applyFilter();
    const index = this.filtered.findIndex((entry) => entry.key === item.key);
    if (index >= 0) this.selectedIndex = index;
    else this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    this.updateList();
  }

  private toggleHidden(): void {
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    if (this.isCurrent(item)) {
      this.setStatus("This model is in use. Switch model first, then hide it.", "error");
      return;
    }
    const wasStarred = this.options.store.isStarred(item.key);
    const nowHidden = this.options.store.toggleHidden(item.key);
    this.orderDirty = true;
    const note = nowHidden && wasStarred ? " Star removed." : "";
    this.setStatus(nowHidden ? `Hid ${item.id}.${note}` : `Restored ${item.id}`, "success");
    this.applyFilter();
    const index = this.filtered.findIndex((entry) => entry.key === item.key);
    if (index >= 0) this.selectedIndex = index;
    else this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    this.updateList();
  }

  /** Re-order works on the star list, so it needs the starred view. */
  private reorder(direction: -1 | 1): void {
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    if (!this.options.store.isStarred(item.key)) {
      this.setStatus(`Star the model first with ${this.keyName(this.customKeys().star)}, then move it.`, "error");
      return;
    }
    if (this.scope !== "starred") {
      const view = this.keyName(this.actionKey("tui.input.tab"));
      this.setStatus(`Press ${view} until the view shows starred, then move the model.`, "error");
      return;
    }
    if (!this.options.store.move(item.key, direction)) return;
    this.orderDirty = true;
    this.setStatus("", "muted");
    this.applyFilter();
    const index = this.filtered.findIndex((entry) => entry.key === item.key);
    if (index >= 0) this.selectedIndex = index;
    this.updateList();
  }

  private confirmSelection(): void {
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    if (!this.options.registry.hasConfiguredAuth(item.model)) {
      this.setStatus(`${item.id} has no API key. Run /login first.`, "error");
      return;
    }
    this.close();
    this.options.onSelect(item.model);
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    // A refresh still running would go on talking to every provider after
    // the picker is gone, and then redraw a picker nobody can see.
    this.refreshAbort.abort();
    this.options.store.flush();
  }

  dispose(): void {
    this.close();
  }

  private nextView(): void {
    const next = SCOPE_ORDER[(SCOPE_ORDER.indexOf(this.scope) + 1) % SCOPE_ORDER.length];
    if (next) this.scope = next;
    this.selectedIndex = 0;
    this.setStatus("", "muted");
    this.applyFilter();
    this.updateHint();
  }

  /**
   * Each key goes through the pi action that means the same thing in pi's own
   * pickers: Tab and Ctrl+S as in /model, the reorder keys as in
   * /scoped-models, Shift+Tab as in the editor.
   */
  handleInput(data: string): void {
    const keys = this.options.keybindings;
    if (keys.matches(data, "tui.select.cancel")) {
      this.close();
      this.options.onCancel();
      return;
    }
    if (keys.matches(data, "tui.select.up")) {
      this.moveCursor(-1);
      return;
    }
    if (keys.matches(data, "tui.select.down")) {
      this.moveCursor(1);
      return;
    }
    // Fullscreen mode gives PageUp and PageDown to the transcript before the
    // picker sees them, as it does in pi's own pickers. A user who binds
    // these actions to other keys can page there too.
    if (keys.matches(data, "tui.select.pageUp")) {
      this.moveCursorByPage(-1);
      return;
    }
    if (keys.matches(data, "tui.select.pageDown")) {
      this.moveCursorByPage(1);
      return;
    }
    if (keys.matches(data, "app.models.reorderUp")) {
      this.reorder(-1);
      return;
    }
    if (keys.matches(data, "app.models.reorderDown")) {
      this.reorder(1);
      return;
    }
    if (keys.matches(data, "app.models.save")) {
      // handleInput is synchronous. toggleDefault redraws on its own when the
      // write finishes, and reports its own failure, so nothing awaits it.
      void this.toggleDefault();
      return;
    }
    // Before Tab. Shift+Tab arrives as its own sequence (CSI Z), so the two
    // cannot be confused, but the order keeps that plain to a reader.
    if (keys.matches(data, "app.thinking.cycle")) {
      this.cycleThinkingLevel();
      return;
    }
    if (keys.matches(data, "tui.input.tab")) {
      this.nextView();
      return;
    }
    if (keys.matches(data, "tui.select.confirm")) {
      this.confirmSelection();
      return;
    }
    // Custom keys come after pi's actions, so a custom key that names a key
    // the picker already claims keeps the old meaning. The filter box takes
    // whatever is left.
    const custom = this.customKeys();
    if (matchesKey(data, custom.star)) {
      this.toggleStar();
      return;
    }
    if (matchesKey(data, custom.hide)) {
      this.toggleHidden();
      return;
    }
    if (matchesKey(data, custom.levelDown)) {
      this.stepThinkingLevel(-1);
      return;
    }
    if (matchesKey(data, custom.levelUp)) {
      this.stepThinkingLevel(1);
      return;
    }

    this.searchInput.handleInput(data);
    this.applyFilter();
  }

  render(width: number): string[] {
    // Fact text wraps to the pane width, which is only known at render time.
    if (width !== this.lastWidth) {
      this.lastWidth = width;
      this.renderFacts();
      this.updateHint();
    }
    return super.render(width);
  }
}

export type { Component };
