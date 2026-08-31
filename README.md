# Rich Model Selector

A model picker for pi that shows the full facts about each model.
You can star a model and put the starred models in the order you want.

The built-in picker shows the model id, the provider, and the model name.
This picker also shows the context size, the price, the thinking levels, and the key state.

<video src="https://github.com/user-attachments/assets/5fd65f9e-ef06-4577-9c7e-793d5c7d6f58" controls></video>

## Install

```bash
pi install npm:@lazco-studio/pi-rich-model-selector
```

To try it for one run only:

```bash
pi -e npm:@lazco-studio/pi-rich-model-selector
```

## How to open it

There are three ways. All three open the same picker.

1. Type `/model`. This extension takes over the built-in command.
2. Type `/models`.
3. Press `Ctrl+L`, or press `Alt+M`.

You can also type a search word with the command, for example `/model opus`.

## Hide the built-in /model entry

Pi writes the `/model` branch straight into its editor code.
No setting can unregister that command.
This extension already takes the command over, so `/model` opens this picker.

What you can still change is the command menu.
Run `/models hide` to drop the `/model` line from the menu.
Only `/models` stays in the list. Both keep working.

## Other extensions that hold the editor

Pi keeps one editor only.
Two extensions that both call `setEditorComponent` overwrite each other.
The extension that starts last wins.

This extension does not replace the editor.
It wraps `setEditorComponent` itself.
Every later factory passes through the wrapper and gets the key checks added.
So `@xynogen/pix-display` and this extension both work at the same time.

The order in the `packages` list of `settings.json` does not matter.
A later extension cannot take the keys away.

Run `/models show` to put the line back.
The choice lives in `~/.pi/agent/rich-model-selector.json`.

## Keys inside the picker

| Key | What it does |
|---|---|
| type any text | filter the list |
| `Up` / `Down` | move the cursor |
| `Ctrl+S` | star the model, or remove the star |
| `Ctrl+D` | make this model the startup default, or clear the default |
| `Ctrl+E` | hide the model, or bring it back |
| `Ctrl+Up` / `Ctrl+Down` | move a starred model up or down |
| `Alt+Up` / `Alt+Down` | move a starred model up or down (backup) |
| `Tab` | change the view: starred, all, hidden |
| `Enter` | use this model |
| `Esc` | close and change nothing |

To change the order, first press `Tab` to open the starred view.
The order only applies to starred models.

## Ctrl+Up and Ctrl+Down on macOS

macOS takes `Ctrl+Up` for Mission Control.
It takes `Ctrl+Down` for App Windows.
The key never reaches pi while these system shortcuts stay on.

You have two choices:

1. Use `Alt+Up` and `Alt+Down`. They do the same job and always work.
2. Turn the two macOS shortcuts off.
   Open System Settings, then Keyboard, then Keyboard Shortcuts, then Mission Control.
   Clear the check box for Mission Control and for Application windows.

The picker opens with the cursor on the model you use now.

## Set the model pi starts with

Press `Ctrl+D` on the model under the cursor.
The picker writes `defaultProvider` and `defaultModel` into `~/.pi/agent/settings.json`,
so the next `pi` run opens with that model.

Press `Ctrl+D` again on the model that is the default now.
The picker clears both fields, and pi falls back to its own per-provider defaults.

A change needs a restart to take effect, because pi reads the setting at start.
The row in the picker updates at once.

## Hide a model you never use

Press `Ctrl+E` to hide the model under the cursor.
A hidden model leaves the `all` view, so the list gets shorter.

Press `Tab` until the view says `hidden` to see them again.
Press `Ctrl+E` there to bring one back.

Three rules keep the state simple:

1. A star wins over a hide. If you star a hidden model, it comes back.
2. If you hide a starred model, the star goes away.
3. You cannot hide the model you use now. Change model first.

## What each row shows

```
→ ★ <model-id>  1.0M $5/$25  think ✓ ·default
```

- `→` is the cursor.
- `★` means the model is starred. `·` means it is not. `✗` means it is hidden.
- `1.0M` is the context size.
- `$5/$25` is the price for 1M input tokens and 1M output tokens.
- `think` means the model can think.
- `✓` means you use this model now.
- `·default` means pi starts with this model.
- `·no key` means there is no API key. Run `/login` to add one.

The panel on the right shows more facts about the model under the cursor.

The window splits in a "T" shape.
A line runs under the search box.
A second line runs down between the list and the facts.

The title sits on the left of the top border.
The key hints sit on the right of the same line.

```
╭─ Select a model ── ↵ · ^S★ · ^↑↓ · ^E · ⇥ · esc ─╮
│ View: starred | all | hidden  2 starred, 1 hidden, 3 total │
│ >                                         │
├───────────────────────┬─────────────────┤
│ → ★ <model-id>           │ <model-id>…     │
│   ★ <other-model-id>     │ Name    …       │
╰───────────────────────┴─────────────────╯
```

A wide window shows the long hints, like `Enter pick · Ctrl+S star`.
A narrow window shows short keys, then drops the least used keys.

On a narrow terminal the down line goes away.
The facts then move under the list, with a line between them.

## Where the stars are kept

The file is `~/.pi/agent/rich-model-selector.json`.

```json
{
  "version": 1,
  "starred": ["<provider>/<model-id>"],
  "hidden": ["<provider>/<another-model-id>"],
  "syncEnabledModels": false,
  "hideBuiltinModelCommand": false
}
```

The `starred` list is in your chosen order.
The `hidden` list has no order.

If a model leaves your catalog, the picker drops it from both lists.

## Make Ctrl+P follow your star order

Pi changes model with `Ctrl+P`. It uses the `enabledModels` list in `settings.json`.
This extension can write your star order into that list.

1. Star the models you want, in the order you want.
2. Run `/models sync`.
3. Restart pi.

After this, `Ctrl+P` walks your starred models in your order.

To undo it, run `/models unsync` and restart pi.

Note: `enabledModels` also limits which models pi can use.
Only your starred models stay available after a sync.

## Files

| File | What it holds |
|---|---|
| `index.ts` | the command, the shortcut, and the editor that takes over `/model` |
| `picker.ts` | the picker component |
| `window.ts` | the window frame that draws the border, the title, and the hint |
| `model-facts.ts` | turns a model into the text you see |
| `store.ts` | reads and writes the star file |

All files sit under `src/`.

## Release

`npm version` owns the version number. Never edit the `version` field in
`package.json` by hand.

Cut a release from a clean `main`:

```sh
npm run release patch          # 0.1.0 -> 0.1.1
npm run release minor          # 0.1.0 -> 0.2.0
npm run release prerelease     # 0.1.0 -> 0.1.1-0, goes to the `next` dist-tag
npm run release 1.0.0          # an explicit version
npm run release patch -- --dry-run
```

The script type-checks, runs `npm version`, and pushes the branch plus the new
`v<version>` tag. That tag starts `.github/workflows/release-npm.yml`, which
publishes to npm with provenance and opens the GitHub release.

Because `npm version` writes `package.json` and the tag in one step, the two can
never disagree. The workflow re-checks them anyway and fails on a mismatch.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
