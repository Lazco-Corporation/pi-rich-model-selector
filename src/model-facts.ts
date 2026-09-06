import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";

/** Short token count. 1000000 becomes "1.0M", 262144 becomes "262K". */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "-";
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (count >= 1000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

/** Price for 1M tokens. Trailing zeros are dropped so the column stays narrow. */
export function formatPrice(amount: number | undefined): string {
  if (amount === undefined || !Number.isFinite(amount)) return "-";
  if (amount === 0) return "free";
  if (amount < 0.01) return `$${amount.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
  if (amount < 1) return `$${amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatPricePair(model: Model<any>): string {
  return `${formatPrice(model.cost?.input)}/${formatPrice(model.cost?.output)}`;
}

/**
 * Thinking levels the model really accepts, in order.
 *
 * This asks pi rather than reading `thinkingLevelMap` here, because pi's rule
 * is not uniform: `xhigh` and `max` must be written out to count, while the
 * other levels count unless the map sets them to null. A second copy of that
 * rule would offer levels pi then refuses, and the arrow keys would step onto
 * a level the model cannot use.
 */
export function supportedThinkingLevels(model: Model<any>): ModelThinkingLevel[] {
  return getSupportedThinkingLevels(model);
}

/**
 * The level a model would use, and whether the user pinned it.
 *
 * `pinned: false` means the level came from the global default, so the row
 * follows that default and changes with it. The picker marks that with a dot.
 */
export interface EffectiveThinkingLevel {
  level: ModelThinkingLevel;
  pinned: boolean;
}

/**
 * Work out the level pi would use for a model.
 *
 * Mirrors pi's own order on a model switch: a per-model entry wins, otherwise
 * the global default applies. Either way the answer is clamped, because a
 * default of `xhigh` means nothing to a model that stops at `high`.
 */
export function effectiveThinkingLevel(
  model: Model<any>,
  pinnedLevel: ModelThinkingLevel | undefined,
  globalDefault: ModelThinkingLevel,
): EffectiveThinkingLevel {
  if (!model.reasoning) return { level: "off", pinned: false };
  const requested = pinnedLevel ?? globalDefault;
  return { level: clampThinkingLevel(model, requested), pinned: pinnedLevel !== undefined };
}

export function formatHost(baseUrl: string | undefined): string {
  if (!baseUrl) return "-";
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export interface FactRow {
  label: string;
  value: string;
  /** Warn rows render in the warning color. */
  tone?: "normal" | "warn";
  /** Each part carries its own color, so one row can hold many colors. */
  parts?: FactPart[];
}

export interface FactPart {
  text: string;
  /** Theme color name. The picker maps it and falls back when a theme lacks it. */
  color: string;
}

/** Theme color for one thinking level, like "low" -> "thinkingLow". */
export function thinkingLevelColor(level: string): string {
  const name = level.charAt(0).toUpperCase() + level.slice(1);
  return `thinking${name}`;
}

export interface FactInput {
  model: Model<any>;
  providerName: string;
  hasAuth: boolean;
  usingOAuth: boolean;
  contextTokens: number | null;
}

/** Build the fact list for the detail pane. */
export function buildFacts(input: FactInput): FactRow[] {
  const { model } = input;
  const rows: FactRow[] = [];

  rows.push({ label: "Name", value: model.name || model.id });
  rows.push({ label: "Provider", value: `${input.providerName} (${model.provider})` });
  rows.push({ label: "API", value: model.api });
  rows.push({ label: "Host", value: formatHost(model.baseUrl) });

  const contextWindow = model.contextWindow ?? 0;
  let contextValue = formatTokens(contextWindow);
  if (input.contextTokens !== null && contextWindow > 0) {
    const percent = Math.round((input.contextTokens / contextWindow) * 100);
    contextValue += `  (this chat uses ${formatTokens(input.contextTokens)}, ${percent}%)`;
  }
  rows.push({ label: "Context", value: contextValue });
  rows.push({ label: "Max output", value: formatTokens(model.maxTokens ?? 0) });

  rows.push({ label: "In / Out", value: `${formatPrice(model.cost?.input)} / ${formatPrice(model.cost?.output)} per 1M` });
  rows.push({
    label: "Cache r/w",
    value: `${formatPrice(model.cost?.cacheRead)} / ${formatPrice(model.cost?.cacheWrite)} per 1M`,
  });

  for (const tier of model.cost?.tiers ?? []) {
    rows.push({
      label: `Above ${formatTokens(tier.inputTokensAbove)}`,
      value: `${formatPrice(tier.input)} / ${formatPrice(tier.output)} per 1M`,
    });
  }

  // pi answers ["off"] for a model that cannot think, so ask the model itself
  // rather than reading a one-entry list as a real choice.
  const levels = model.reasoning ? supportedThinkingLevels(model) : [];
  if (!model.reasoning) {
    rows.push({ label: "Thinking", value: "no" });
  } else if (levels.length === 0) {
    rows.push({ label: "Thinking", value: "yes" });
  } else {
    // Each level gets its own color, the same color pi uses for that level.
    const parts: FactPart[] = [];
    for (const level of levels) {
      if (parts.length > 0) parts.push({ text: ", ", color: "muted" });
      parts.push({ text: level, color: thinkingLevelColor(level) });
    }
    rows.push({ label: "Thinking", value: levels.join(", "), parts });
  }

  rows.push({ label: "Input", value: (model.input ?? ["text"]).join(", ") });

  if (input.hasAuth) {
    rows.push({ label: "Key", value: input.usingOAuth ? "ready (OAuth)" : "ready" });
  } else {
    rows.push({ label: "Key", value: "missing. Run /login", tone: "warn" });
  }

  return rows;
}
