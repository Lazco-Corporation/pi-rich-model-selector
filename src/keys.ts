/**
 * Turns key ids, such as `shift+tab`, into the text the key hint shows.
 *
 * The hint names the keys the user really has. Pi reads keybindings.json, so
 * a rebound action shows its new key, not the default.
 */

/** A key or a group of keys, written in full and in symbols. */
export interface KeyLabel {
  long: string;
  short: string;
}

// macOS keyboards print Option and Command, and pi's own hints say option.
const IS_MAC = process.platform === "darwin";

/** The order a modifier prints in, whatever order the key id uses. */
const MODIFIER_ORDER = ["ctrl", "alt", "shift", "super"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_LONG: Record<Modifier, string> = {
  ctrl: "Ctrl+",
  alt: IS_MAC ? "Option+" : "Alt+",
  shift: "Shift+",
  super: IS_MAC ? "Cmd+" : "Super+",
};

const MODIFIER_SHORT: Record<Modifier, string> = {
  ctrl: "^",
  alt: IS_MAC ? "⌥" : "Alt+",
  shift: "⇧",
  super: IS_MAC ? "⌘" : "Super+",
};

const BASE_LONG: Record<string, string> = {
  tab: "Tab",
  enter: "Enter",
  return: "Enter",
  escape: "Esc",
  esc: "Esc",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  clear: "Clear",
  home: "Home",
  end: "End",
  pageUp: "PageUp",
  pageDown: "PageDown",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

const BASE_SHORT: Record<string, string> = {
  ...BASE_LONG,
  tab: "⇥",
  enter: "↵",
  return: "↵",
  escape: "esc",
  esc: "esc",
  space: "␣",
  backspace: "⌫",
  delete: "⌦",
  pageUp: "PgUp",
  pageDown: "PgDn",
};

interface ParsedKey {
  modifiers: string;
  modifiersShort: string;
  base: string;
  baseShort: string;
}

function parseKey(keyId: string): ParsedKey {
  const parts = keyId.split("+");
  let base = parts.pop() ?? "";
  // The plus key itself splits into empty parts, as in `ctrl++`.
  if (base === "") {
    base = "+";
    parts.pop();
  }
  const present = new Set(parts.map((part) => part.toLowerCase()));
  const modifiers = MODIFIER_ORDER.filter((modifier) => present.has(modifier));
  const plain = base.length === 1 || /^f\d+$/i.test(base) ? base.toUpperCase() : base;
  return {
    modifiers: modifiers.map((modifier) => MODIFIER_LONG[modifier]).join(""),
    modifiersShort: modifiers.map((modifier) => MODIFIER_SHORT[modifier]).join(""),
    base: BASE_LONG[base] ?? plain,
    baseShort: BASE_SHORT[base] ?? plain,
  };
}

/**
 * Label a group of keys that share one hint, such as the two reorder keys.
 *
 * Keys with the same modifiers print the modifiers once, as `Alt+↑/↓`. That
 * keeps the hint short enough for the top border. Undefined means no key is
 * bound, so the hint leaves the action out.
 */
export function formatKeys(keyIds: readonly string[]): KeyLabel | undefined {
  const keys = keyIds.map(parseKey);
  const first = keys[0];
  if (!first) return undefined;
  if (keys.every((key) => key.modifiers === first.modifiers)) {
    return {
      long: first.modifiers + keys.map((key) => key.base).join("/"),
      short: first.modifiersShort + keys.map((key) => key.baseShort).join(""),
    };
  }
  return {
    long: keys.map((key) => key.modifiers + key.base).join("/"),
    short: keys.map((key) => key.modifiersShort + key.baseShort).join("/"),
  };
}
