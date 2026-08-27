import type { Component } from "@earendil-works/pi-tui";
import { Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface WindowTheme {
  fg(color: string, text: string): string;
}

const TOP_LEFT = "╭";
const TOP_RIGHT = "╮";
const BOTTOM_LEFT = "╰";
const BOTTOM_RIGHT = "╯";
const TEE_LEFT = "├";
const TEE_RIGHT = "┤";
const TEE_DOWN = "┬";
const TEE_UP = "┴";
const HORIZONTAL = "─";
const VERTICAL = "│";

/** A full-width row spends 2 columns on borders and 2 on padding. */
const FULL_ROW_OVERHEAD = 4;
/** A split row adds a middle border and a pad on each side of it. */
const SPLIT_ROW_OVERHEAD = 7;
/** Below this the list gets too thin, so the panes stack instead. */
const MIN_LEFT_WIDTH = 24;
/** Columns a label keeps clear on its outer side: corner, dash, space. */
const LABEL_MARGIN = 3;

export interface WindowLayout {
  mode: "split" | "stacked";
  /** Content width of a row that spans the whole window. */
  innerWidth: number;
  leftWidth: number;
  rightWidth: number;
  /** Column of the vertical border. -1 when the panes stack. */
  separatorColumn: number;
}

/**
 * Works out the pane widths for one outer width.
 *
 * The frame and its content both need these numbers, so they come from one
 * function. Two copies of this math would drift apart.
 */
export function computeWindowLayout(outerWidth: number, rightPaneWidth: number, minSplitWidth: number): WindowLayout {
  const outer = Math.max(FULL_ROW_OVERHEAD + 1, outerWidth);
  const innerWidth = outer - FULL_ROW_OVERHEAD;
  const leftWidth = outer - rightPaneWidth - SPLIT_ROW_OVERHEAD;

  if (outer < minSplitWidth || leftWidth < MIN_LEFT_WIDTH) {
    return { mode: "stacked", innerWidth, leftWidth: innerWidth, rightWidth: innerWidth, separatorColumn: -1 };
  }
  return { mode: "split", innerWidth, leftWidth, rightWidth: rightPaneWidth, separatorColumn: leftWidth + 3 };
}

export interface WindowFrameOptions {
  rightPaneWidth: number;
  minSplitWidth: number;
}

/** A piece of text sunk into a horizontal border. */
interface EdgeLabel {
  text: string;
  color: string;
  align: "left" | "right";
}

/**
 * Draws a window in a "T" shape.
 *
 * The top border carries the title on the left and the key hints on the right.
 * A horizontal line sits under the header. A vertical line splits the body into
 * a left pane and a right pane. The two lines meet at a `┬` junction.
 *
 * When the terminal is too narrow the vertical line goes away, and the right
 * pane moves under the left one.
 */
export class WindowFrame implements Component {
  readonly header = new Container();
  readonly left = new Container();
  readonly right = new Container();

  private title = "";
  private titleColor = "accent";
  private hint = "";
  private hintColor = "dim";

  constructor(
    private readonly theme: WindowTheme,
    private readonly options: WindowFrameOptions,
  ) {}

  setTitle(title: string, color = "accent"): void {
    this.title = title;
    this.titleColor = color;
  }

  /** Text laid into the right side of the top border. */
  setHint(hint: string, color = "dim"): void {
    this.hint = hint;
    this.hintColor = color;
  }

  /**
   * Columns the hint can use at this width, with the title already placed.
   *
   * The caller needs this to fit its own text. Without it the caller would
   * guess, and the border would cut the text with an ellipsis.
   */
  hintBudget(width: number): number {
    const outer = Math.max(FULL_ROW_OVERHEAD + 1, width);
    const limit = this.labelLimit(outer);
    const titleWidth = visibleWidth(this.fitLabel(this.title, limit));
    if (titleWidth === 0) return limit;
    // After the title come a space, at least one dash, and a space. That is the
    // same count as LABEL_MARGIN.
    return Math.max(0, limit - titleWidth - LABEL_MARGIN);
  }

  invalidate(): void {
    this.header.invalidate();
    this.left.invalidate();
    this.right.invalidate();
  }

  private border(text: string): string {
    return this.theme.fg("border", text);
  }

  /** Widest a single label can be before it hits a corner. */
  private labelLimit(width: number): number {
    return Math.max(0, width - 2 * LABEL_MARGIN);
  }

  private fitLabel(text: string, limit: number): string {
    if (!text || limit <= 0) return "";
    return truncateToWidth(text, limit, "…");
  }

  /**
   * Builds one horizontal border, like `╭─ Select a model ─── Esc close ─╮`.
   *
   * The border starts as a plain row of characters. Each label then claims a
   * span of columns, and a junction claims one. Rendering walks the columns
   * once, so a label and a junction can never overwrite each other.
   */
  private edge(
    leftCorner: string,
    rightCorner: string,
    width: number,
    labels: EdgeLabel[],
    junction: string,
    junctionColumn: number,
  ): string {
    const cells: string[] = [leftCorner];
    for (let column = 1; column < width - 1; column++) cells.push(HORIZONTAL);
    cells.push(rightCorner);
    if (junctionColumn > 0 && junctionColumn < width - 1) cells[junctionColumn] = junction;

    const owners = new Map<number, EdgeLabel>();
    for (const label of labels) {
      const labelWidth = visibleWidth(label.text);
      if (labelWidth === 0) continue;
      const start = label.align === "left" ? LABEL_MARGIN : width - LABEL_MARGIN - labelWidth;
      // Keep one dash and one space outside the label on both sides.
      if (start - 1 < 1 || start + labelWidth > width - 2) continue;
      cells[start - 1] = " ";
      cells[start + labelWidth] = " ";
      owners.set(start, label);
    }

    let out = "";
    let run = "";
    for (let column = 0; column < width; column++) {
      const label = owners.get(column);
      if (!label) {
        run += cells[column];
        continue;
      }
      if (run) {
        out += this.border(run);
        run = "";
      }
      out += this.theme.fg(label.color, label.text);
      column += visibleWidth(label.text) - 1;
    }
    if (run) out += this.border(run);
    return out;
  }

  private topEdge(width: number): string {
    const labels: EdgeLabel[] = [];

    const title = this.fitLabel(this.title, this.labelLimit(width));
    if (title) labels.push({ text: title, color: this.titleColor, align: "left" });

    const hint = this.fitLabel(this.hint, this.hintBudget(width));
    if (hint) labels.push({ text: hint, color: this.hintColor, align: "right" });

    return this.edge(TOP_LEFT, TOP_RIGHT, width, labels, HORIZONTAL, -1);
  }

  private pad(line: string, width: number): string {
    const clamped = visibleWidth(line) > width ? truncateToWidth(line, width, "…") : line;
    return clamped + " ".repeat(Math.max(0, width - visibleWidth(clamped)));
  }

  private fullRow(line: string, innerWidth: number): string {
    return `${this.border(VERTICAL)} ${this.pad(line, innerWidth)} ${this.border(VERTICAL)}`;
  }

  private splitRow(leftLine: string, rightLine: string, layout: WindowLayout): string {
    const bar = this.border(VERTICAL);
    return `${bar} ${this.pad(leftLine, layout.leftWidth)} ${bar} ${this.pad(rightLine, layout.rightWidth)} ${bar}`;
  }

  render(width: number): string[] {
    const outer = Math.max(FULL_ROW_OVERHEAD + 1, width);
    const layout = computeWindowLayout(outer, this.options.rightPaneWidth, this.options.minSplitWidth);
    const junctionColumn = layout.mode === "split" ? layout.separatorColumn : -1;

    const lines = [this.topEdge(outer)];

    for (const line of this.header.render(layout.innerWidth)) lines.push(this.fullRow(line, layout.innerWidth));

    // The crossbar of the T. Below it the vertical line starts.
    lines.push(this.edge(TEE_LEFT, TEE_RIGHT, outer, [], TEE_DOWN, junctionColumn));

    if (layout.mode === "split") {
      const leftLines = this.left.render(layout.leftWidth);
      const rightLines = this.right.render(layout.rightWidth);
      const height = Math.max(leftLines.length, rightLines.length);
      for (let row = 0; row < height; row++) {
        lines.push(this.splitRow(leftLines[row] ?? "", rightLines[row] ?? "", layout));
      }
    } else {
      for (const line of this.left.render(layout.innerWidth)) lines.push(this.fullRow(line, layout.innerWidth));
      lines.push(this.edge(TEE_LEFT, TEE_RIGHT, outer, [], HORIZONTAL, -1));
      for (const line of this.right.render(layout.innerWidth)) lines.push(this.fullRow(line, layout.innerWidth));
    }

    lines.push(this.edge(BOTTOM_LEFT, BOTTOM_RIGHT, outer, [], TEE_UP, junctionColumn));
    return lines;
  }
}

export type { Component };
