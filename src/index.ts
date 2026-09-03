import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor, getAgentDir } from "@earendil-works/pi-coding-agent";
import { RichModelPicker } from "./picker.ts";
import { hasEnabledModels, readDefaultModel, StarStore, writeDefaultModel, writeEnabledModels } from "./store.ts";

const STORE_FILE = "rich-model-selector.json";

let store: StarStore | undefined;

function getStore(): StarStore {
  if (!store) store = new StarStore(join(getAgentDir(), STORE_FILE));
  return store;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openPicker(pi: ExtensionAPI, ctx: ExtensionContext, initialSearch?: string): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("The model picker needs the terminal UI.", "warning");
    return;
  }

  // Both files may have changed since this session started, by hand or from
  // another pi session. Read them now, so the picker opens on what is true.
  const activeStore = getStore();
  activeStore.reload();

  const usage = ctx.getContextUsage();
  const selected = await ctx.ui.custom<Model<any> | undefined>((tui, theme, _keybindings, done) => {
    return new RichModelPicker({
      tui,
      theme,
      store: activeStore,
      registry: ctx.modelRegistry,
      currentModel: ctx.model,
      defaultModel: readDefaultModel(ctx.cwd, getAgentDir()),
      contextTokens: usage?.tokens ?? null,
      initialSearch,
      onSelect: (model) => done(model),
      onCancel: () => done(undefined),
      onSetDefaultModel: async (provider, id) => {
        try {
          await writeDefaultModel(ctx.cwd, getAgentDir(), provider, id);
          return undefined;
        } catch (error) {
          return `Could not update settings.json: ${describeError(error)}`;
        }
      },
    });
  });

  if (!selected) return;

  const applied = await pi.setModel(selected);
  if (!applied) {
    ctx.ui.notify(`Could not switch to ${selected.id}. Check the API key with /login.`, "error");
    return;
  }
  ctx.ui.notify(`Model is now ${selected.id}.`, "info");
}

/**
 * Editor that takes over the built-in model picker.
 *
 * Pi copies its own onSubmit onto this editor. That copied function holds the
 * hardcoded `/model` branch, so this class must check `/model` before it calls
 * the copy. The same idea applies to the `app.model.select` key action.
 */
type SubmitHandler = (text: string) => void;

type EditorFactory = (
  tui: ConstructorParameters<typeof CustomEditor>[0],
  theme: ConstructorParameters<typeof CustomEditor>[1],
  keybindings: ConstructorParameters<typeof CustomEditor>[2],
) => CustomEditor;

function matchesAction(editor: CustomEditor, data: string, action: string): boolean {
  const owner = editor as unknown as { keybindings?: { matches(data: string, action: string): boolean } };
  try {
    return owner.keybindings?.matches(data, action) ?? false;
  } catch {
    return false;
  }
}

/**
 * Adds the model picker hooks to an editor that already exists.
 *
 * Pi holds one editor only, so two extensions that both call
 * setEditorComponent overwrite each other. Patching the instance leaves the
 * other extension in charge of its own editor, and still claims the two paths
 * that open the picker: the `/model` command and the `app.model.select` key.
 */
function attachModelPicker(editor: CustomEditor, open: (search?: string) => void): CustomEditor {
  let innerSubmit: SubmitHandler | undefined = editor.onSubmit;

  // Pi assigns its own onSubmit after this runs, and that copy holds the
  // hardcoded /model branch. The accessor keeps the /model check in front of
  // whatever pi assigns later.
  Object.defineProperty(editor, "onSubmit", {
    configurable: true,
    get: () => (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "/model" || trimmed.startsWith("/model ")) {
        editor.setText("");
        open(trimmed.startsWith("/model ") ? trimmed.slice(7).trim() || undefined : undefined);
        return;
      }
      innerSubmit?.(text);
    },
    set: (handler: SubmitHandler | undefined) => {
      innerSubmit = handler;
    },
  });

  const innerHandleInput = editor.handleInput.bind(editor);
  editor.handleInput = (data: string) => {
    if (matchesAction(editor, data, "app.model.select")) {
      open();
      return;
    }
    innerHandleInput(data);
  };

  return editor;
}

export default function (pi: ExtensionAPI) {
  // The editor outlives a session switch, but an ExtensionContext does not: the
  // runner marks the old one stale and every read throws. So the editor reads
  // the newest context through this box instead of capturing one.
  let liveContext: ExtensionContext | undefined;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    liveContext = ctx;
    getStore();
    const open = (search?: string) => {
      const active = liveContext;
      if (active) void openPicker(pi, active, search);
    };
    // Pi holds one editor only, so the last extension to call
    // setEditorComponent wins. This extension cannot rely on start order, and a
    // timer loses the race when another extension starts after the timer fires.
    // Wrapping the setter instead makes every later factory pass through here,
    // so the other editor keeps its behavior and this one keeps its keys.
    const ui = ctx.ui as typeof ctx.ui & { richModelSelectorPatched?: boolean };

    const wrapFactory = (inner: EditorFactory | undefined): EditorFactory => {
      // A reload re-runs this handler, and the stored factory is already ours.
      // Wrapping it again would stack a new layer on every reload.
      if ((inner as (EditorFactory & { richModelSelector?: boolean }) | undefined)?.richModelSelector) {
        return inner as EditorFactory;
      }
      const factory: EditorFactory & { richModelSelector?: boolean } = (tui, theme, keybindings) => {
        const base = inner ? inner(tui, theme, keybindings) : new CustomEditor(tui, theme, keybindings);
        return attachModelPicker(base, open);
      };
      factory.richModelSelector = true;
      return factory;
    };

    if (!ui.richModelSelectorPatched) {
      const setEditorComponent = ui.setEditorComponent.bind(ui);
      ui.setEditorComponent = (inner: EditorFactory | undefined) => {
        // undefined restores the built-in editor, which still needs the hooks.
        setEditorComponent(wrapFactory(inner));
      };
      ui.richModelSelectorPatched = true;
    }

    ctx.ui.setEditorComponent(ctx.ui.getEditorComponent());

    // Pi hardcodes the /model branch in its editor, so the command cannot be
    // unregistered. This extension already intercepts it. Dropping the entry
    // from the menu is the remaining half: the name stops being offered.
    ctx.ui.addAutocompleteProvider((current) => ({
      ...current,
      triggerCharacters: current.triggerCharacters,
      getSuggestions: async (lines, cursorLine, cursorCol, options) => {
        const result = await current.getSuggestions(lines, cursorLine, cursorCol, options);
        if (!result) return result;
        // This runs on a keystroke, and the setting may have changed since the
        // last one, from a hand edit or from another pi session. Re-read only
        // when the file moved, so the common keystroke costs one stat.
        getStore().reloadIfChanged();
        if (!getStore().getHideBuiltinModelCommand()) return result;
        const items = result.items.filter((item) => item.value !== "model" && item.label !== "/model");
        return { ...result, items };
      },
      applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
        current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
      shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current),
    }));
  });

  pi.registerCommand("models", {
    description: "Pick a model with full model facts, stars, and star order",
    handler: async (args, ctx) => {
      const argument = args.trim();

      if (argument === "sync") {
        // Another session or a hand edit may have changed the stars.
        getStore().reload();
        const starred = getStore().getStarred();
        if (starred.length === 0) {
          ctx.ui.notify("Star at least one model first.", "warning");
          return;
        }
        try {
          await writeEnabledModels(ctx.cwd, getAgentDir(), starred);
          ctx.ui.notify(`Wrote ${starred.length} starred models to settings.json. Restart pi to use the new cycle order.`, "info");
        } catch (error) {
          ctx.ui.notify(`Could not write settings.json: ${describeError(error)}`, "error");
        }
        return;
      }

      if (argument === "hide" || argument === "show") {
        const hide = argument === "hide";
        getStore().setHideBuiltinModelCommand(hide);
        getStore().flush();
        ctx.ui.notify(
          hide
            ? "The /model entry is hidden from the command menu. Type /models to open the picker."
            : "The /model entry is back in the command menu.",
          "info",
        );
        return;
      }

      if (argument === "unsync") {
        // Read the file, not a remembered flag. The user may have removed
        // enabledModels by hand since this session started.
        if (!hasEnabledModels(ctx.cwd, getAgentDir())) {
          ctx.ui.notify("settings.json has no enabledModels list. Nothing to undo.", "warning");
          return;
        }
        try {
          await writeEnabledModels(ctx.cwd, getAgentDir(), []);
          ctx.ui.notify("Removed enabledModels from settings.json. Restart pi to apply.", "info");
        } catch (error) {
          ctx.ui.notify(`Could not write settings.json: ${describeError(error)}`, "error");
        }
        return;
      }

      await openPicker(pi, ctx, argument || undefined);
    },
  });

  pi.registerShortcut("alt+m", {
    description: "Open the rich model picker",
    handler: async (ctx) => {
      await openPicker(pi, ctx);
    },
  });
}
