import type { Model } from "@earendil-works/pi-ai";
import { modelsAreEqual } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { Container, fuzzyFilter, Input, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { buildFacts, formatPricePair, formatTokens } from "./model-facts.ts";
import { modelKey, type StarStore } from "./store.ts";
import { computeWindowLayout, WindowFrame } from "./window.ts";

/** Below this width the fact pane moves under the list instead of beside it. */
const TWO_PANE_MIN_WIDTH = 100;
const MAX_VISIBLE_ROWS = 12;
const SIDE_PANE_WIDTH = 46;

export interface PickerTheme {
  fg(color: string, text: string): string;
}

export interface ModelItem {
  key: string;
  provider: string;
  id: string;
  model: Model<any>;
}

export interface PickerOptions {
  tui: TUI;
  theme: PickerTheme;
  store: StarStore;
  registry: ModelRegistry;
  currentModel: Model<any> | undefined;
  defaultModel: { provider: string; id: string } | undefined;
  contextTokens: number | null;
  initialSearch?: string;
  onSelect(model: Model<any>): void;
  onCancel(): void;
  /**
   * Set or clear the startup default model. Both arguments set it, both
   * undefined clear it. Returns an error message on failure, or undefined on
   * success.
   */
  onSetDefaultModel(provider: string | undefined, id: string | undefined): string | undefined;
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
  private filtered: ModelItem[] = [];
  private selectedIndex = 0;
  private scope: Scope = "all";
  private status = "";
  private statusTone: "muted" | "error" | "success" = "muted";
  private lastWidth = 0;
  private closed = false;

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
    }));
    this.options.store.prune(new Set(this.allItems.map((item) => item.key)));
  }

  /** Pull fresh model catalogs, then redraw. Never throws into the UI. */
  private async refreshCatalog(): Promise<void> {
    try {
      await this.options.registry.refresh();
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
    }
  }

  private isCurrent(item: ModelItem): boolean {
    return modelsAreEqual(this.options.currentModel, item.model);
  }

  private isDefault(item: ModelItem): boolean {
    const fallback = this.options.defaultModel;
    return fallback?.provider === item.provider && fallback.id === item.id;
  }

  /** Starred models first in star order, then current, default, provider, id. */
  private sortItems(items: ModelItem[]): ModelItem[] {
    const store = this.options.store;
    return [...items].sort((left, right) => {
      const leftRank = store.starRank(left.key);
      const rightRank = store.starRank(right.key);
      if (leftRank >= 0 || rightRank >= 0) {
        if (leftRank < 0) return 1;
        if (rightRank < 0) return -1;
        return leftRank - rightRank;
      }
      if (this.isCurrent(left) !== this.isCurrent(right)) return this.isCurrent(left) ? -1 : 1;
      if (this.isDefault(left) !== this.isDefault(right)) return this.isDefault(left) ? -1 : 1;
      const byProvider = left.provider.localeCompare(right.provider);
      return byProvider !== 0 ? byProvider : left.id.localeCompare(right.id);
    });
  }

  private scopeItems(): ModelItem[] {
    const store = this.options.store;
    let pool: ModelItem[];
    if (this.scope === "starred") pool = this.allItems.filter((item) => store.isStarred(item.key));
    else if (this.scope === "hidden") pool = this.allItems.filter((item) => store.isHidden(item.key));
    // The "all" view is the working list, so hidden models stay out of it.
    else pool = this.allItems.filter((item) => !store.isHidden(item.key));
    return this.sortItems(pool);
  }

  private applyFilter(): void {
    const query = this.searchInput.getValue().trim();
    const pool = this.scopeItems();
    this.filtered = query
      ? fuzzyFilter(pool, query, (item) => `${item.id} ${item.provider} ${item.model.name ?? ""}`)
      : pool;
    if (query) this.selectedIndex = 0;
    else this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    this.updateScopeLine();
    this.updateList();
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
    const { theme, store } = this.options;

    if (this.filtered.length === 0) {
      let message = "No model matches the search.";
      if (this.scope === "starred" && store.getStarred().length === 0) {
        message = "No starred models yet. Press Tab for all, then Ctrl+S to star one.";
      } else if (this.scope === "hidden" && store.getHidden().length === 0) {
        message = "No hidden models. Press Ctrl+E on a model to hide it.";
      }
      this.listContainer.addChild(new Text(theme.fg("muted", message), 0, 0));
      this.renderFacts();
      return;
    }

    const total = this.filtered.length;
    const half = Math.floor(MAX_VISIBLE_ROWS / 2);
    const start = Math.max(0, Math.min(this.selectedIndex - half, total - MAX_VISIBLE_ROWS));
    const end = Math.min(start + MAX_VISIBLE_ROWS, total);

    // Widths come from the whole list, not the visible slice. Slice widths would
    // change while the user scrolls, and the columns would jump sideways.
    const idWidth = Math.min(38, Math.max(...this.filtered.map((item) => visibleWidth(item.id))));
    const contextWidth = Math.max(
      ...this.filtered.map((item) => visibleWidth(formatTokens(item.model.contextWindow ?? 0))),
    );
    const priceWidth = Math.max(...this.filtered.map((item) => visibleWidth(formatPricePair(item.model))));

    for (let index = start; index < end; index++) {
      const item = this.filtered[index];
      if (!item) continue;
      const isSelected = index === this.selectedIndex;
      const starred = store.isStarred(item.key);

      const cursor = isSelected ? theme.fg("accent", "→") : " ";
      let star = starred ? theme.fg("warning", "★") : theme.fg("dim", "·");
      if (store.isHidden(item.key)) star = theme.fg("dim", "✗");
      const id = padPlain(item.id, idWidth);
      const context = padPlain(formatTokens(item.model.contextWindow ?? 0), contextWidth);
      const price = padPlain(formatPricePair(item.model), priceWidth);

      const marks =
        (this.isCurrent(item) ? theme.fg("success", " ✓") : "") +
        (this.isDefault(item) ? theme.fg("muted", " ·default") : "") +
        (this.options.registry.hasConfiguredAuth(item.model) ? "" : theme.fg("error", " ·no key"));

      const body =
        `${isSelected ? theme.fg("accent", id) : id} ` +
        `${theme.fg("muted", context)} ${theme.fg("muted", price)}` +
        `${theme.fg("dim", ` ${item.model.reasoning ? "think" : "     "}`)}${marks}`;

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
  private toggleDefault(): void {
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    const wasDefault = this.isDefault(item);
    const error = this.options.onSetDefaultModel(wasDefault ? undefined : item.provider, wasDefault ? undefined : item.id);
    if (error) {
      this.setStatus(error, "error");
      return;
    }
    this.options.defaultModel = wasDefault ? undefined : { provider: item.provider, id: item.id };
    this.setStatus(
      wasDefault ? "Cleared the startup default model." : `${item.id} is now the startup default. Restart pi to use it.`,
      "success",
    );
    // The sort puts the default model near the front, so the write moves the
    // row. Re-filter and re-find the row, like toggleStar does.
    this.applyFilter();
    const index = this.filtered.findIndex((entry) => entry.key === item.key);
    if (index >= 0) this.selectedIndex = index;
    else this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filtered.length - 1));
    this.updateList();
  }

  private setStatus(message: string, tone: "muted" | "error" | "success" = "muted"): void {
    this.status = message;
    this.statusTone = tone;
    this.statusText.setText(message ? this.options.theme.fg(this.statusTone, this.status) : "");
  }

  /**
   * Fits the key hints to the right of the title, in the top border.
   *
   * The full hint text does not fit a narrow window, and a plain cut would leave
   * a half word plus an ellipsis. Instead the hint drops whole items from the
   * right, least useful first, and then falls back to short labels.
   */
  private updateHint(): void {
    let hints: HintItem[];
    if (this.scope === "starred") {
      hints = [
        { long: "Enter pick", short: "↵" },
        { long: "Ctrl+S star", short: "^S★" },
        { long: "Ctrl+↑/↓ reorder", short: "^↑↓" },
        { long: "Ctrl+D default", short: "^D" },
        { long: "Ctrl+E hide", short: "^E" },
        { long: "Tab all", short: "⇥" },
        { long: "Esc close", short: "esc" },
      ];
    } else if (this.scope === "hidden") {
      hints = [
        { long: "Enter pick", short: "↵" },
        { long: "Ctrl+E restore", short: "^E" },
        { long: "Ctrl+D default", short: "^D" },
        { long: "Tab starred", short: "⇥" },
        { long: "Esc close", short: "esc" },
      ];
    } else {
      hints = [
        { long: "Enter pick", short: "↵" },
        { long: "Ctrl+S star", short: "^S★" },
        { long: "Ctrl+D default", short: "^D" },
        { long: "Ctrl+E hide", short: "^E" },
        { long: "Tab hidden", short: "⇥" },
        { long: "Esc close", short: "esc" },
      ];
    }

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

  private toggleStar(): void {
    const item = this.filtered[this.selectedIndex];
    if (!item) return;
    const nowStarred = this.options.store.toggleStar(item.key);
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
      this.setStatus("Star the model first with Ctrl+S, then move it.", "error");
      return;
    }
    if (this.scope !== "starred") {
      this.setStatus("Press Tab to open the starred view, then move the model.", "error");
      return;
    }
    if (!this.options.store.move(item.key, direction)) return;
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
    this.options.store.flush();
  }

  dispose(): void {
    this.close();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.close();
      this.options.onCancel();
      return;
    }
    if (matchesKey(data, "up")) {
      this.moveCursor(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.moveCursor(1);
      return;
    }
    // Alt stays as a second path. macOS binds Ctrl+Up to Mission Control and
    // Ctrl+Down to App Windows, so those two keys never reach the terminal
    // until the user turns the system shortcuts off.
    if (matchesKey(data, "ctrl+up") || matchesKey(data, "alt+up")) {
      this.reorder(-1);
      return;
    }
    if (matchesKey(data, "ctrl+down") || matchesKey(data, "alt+down")) {
      this.reorder(1);
      return;
    }
    if (matchesKey(data, "ctrl+s")) {
      this.toggleStar();
      return;
    }
    // Not ctrl+h: raw byte 0x08 means Ctrl+H on some terminals and Backspace on
    // others, so ctrl+h would delete search text on the wrong terminal.
    if (matchesKey(data, "ctrl+e")) {
      this.toggleHidden();
      return;
    }
    if (matchesKey(data, "ctrl+d")) {
      this.toggleDefault();
      return;
    }
    if (matchesKey(data, "tab")) {
      const next = SCOPE_ORDER[(SCOPE_ORDER.indexOf(this.scope) + 1) % SCOPE_ORDER.length];
      if (next) this.scope = next;
      this.selectedIndex = 0;
      this.setStatus("", "muted");
      this.applyFilter();
      this.updateHint();
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.confirmSelection();
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
