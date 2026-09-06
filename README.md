# @lazco-studio/pi-rich-model-selector

**A model picker for pi. It shows model facts, and it keeps your starred models in the order you set.**

The picker in pi shows the model id, the provider, and the name.
This extension also shows the context size, the price, the thinking levels, and the key state.
You can star a model, hide a model, and sort your starred models.

<video src="https://github.com/user-attachments/assets/5fd65f9e-ef06-4577-9c7e-793d5c7d6f58" controls></video>

## Table of contents

- [Install](#install)
- [Open the picker](#open-the-picker)
- [Keys](#keys)
- [Commands](#commands)
- [What a row shows](#what-a-row-shows)
- [The three views](#the-three-views)
- [Star and sort your models](#star-and-sort-your-models)
- [Hide a model you do not use](#hide-a-model-you-do-not-use)
- [Set the model pi starts with](#set-the-model-pi-starts-with)
- [Make Ctrl+P follow your star order](#make-ctrlp-follow-your-star-order)
- [Hide the built-in /model menu entry](#hide-the-built-in-model-menu-entry)
- [Where your data goes](#where-your-data-goes)
- [Limits](#limits)
- [FAQ](#faq)
- [License](#license)

## Install

```bash
pi install npm:@lazco-studio/pi-rich-model-selector
```

To try it for one session only:

```bash
pi -e npm:@lazco-studio/pi-rich-model-selector
```

## Open the picker

There are three ways.
All three open the same picker.

1. Type `/model`.
   This extension takes over the built-in command.
2. Type `/models`.
3. Press `Ctrl+L`, or press `Alt+M`.

To open the picker with a filter, add a word:

```text
/model opus
```

## Keys

| Key | Action |
|---|---|
| Type text | Filter the list |
| `Up` / `Down` | Move the cursor |
| `Ctrl+S` | Star the model, or remove the star |
| `Ctrl+D` | Make the model the startup model, or clear it |
| `Ctrl+E` | Hide the model, or show it again |
| `Ctrl+Up` / `Ctrl+Down` | Move a starred model up or down |
| `Alt+Up` / `Alt+Down` | Move a starred model up or down (second key) |
| `Tab` | Change the view |
| `Enter` | Use the model under the cursor |
| `Esc` or `Ctrl+C` | Close the picker and change nothing |

## Commands

| Command | What it does |
|---|---|
| `/model` | Open the picker |
| `/model <text>` | Open the picker with `<text>` in the filter |
| `/models` | Open the picker |
| `/models sync` | Copy your star order into the `Ctrl+P` cycle |
| `/models unsync` | Undo `/models sync` |
| `/models hide` | Remove the `/model` line from the command menu |
| `/models show` | Put the `/model` line back |

## What a row shows

```text
→ ★ <model-id>  1.0M $5/$25  think ✓ ·default
```

- `→` is the cursor.
- `★` means the model is starred.
- `·` means the model is not starred.
- `✗` means the model is hidden.
- `1.0M` is the context size.
- `$5/$25` is the price for 1M input tokens and 1M output tokens.
- `think` means the model accepts thinking levels.
- `✓` means pi uses this model now.
- `·default` means pi starts with this model.
- `·no key` means there is no API key.
  Run `/login` to add one.

The panel on the right shows more facts about the model under the cursor.
On a narrow terminal, that panel moves below the list.

```text
╭─ Select a model ── ↵ · ^S★ · ^↑↓ · ^D · ^E · ⇥ · esc ─╮
│ View: starred | all | hidden  2 starred, 1 hidden, 3 total │
│ >                                                          │
├───────────────────────┬────────────────────────────────────┤
│ → ★ <model-id>        │ <model-id>…                        │
│   ★ <other-model-id>  │ Name    …                          │
╰───────────────────────┴────────────────────────────────────╯
```

## The three views

Press `Tab` to go to the next view.

| View | What it lists |
|---|---|
| `starred` | Your starred models, in your order |
| `all` | Every model, except the hidden ones |
| `hidden` | Only the hidden models |

## Star and sort your models

1. Move the cursor to a model.
2. Press `Ctrl+S` to star it.
3. Press `Tab` until the view shows `starred`.
4. Press `Ctrl+Up` or `Ctrl+Down` to move the model.

The order applies to starred models only.

## Hide a model you do not use

Press `Ctrl+E` to hide the model under the cursor.
A hidden model leaves the `all` view.

To get it back:

1. Press `Tab` until the view shows `hidden`.
2. Move the cursor to the model.
3. Press `Ctrl+E`.

Three rules apply:

1. A star wins over a hide.
   If you star a hidden model, the model becomes visible again.
2. If you hide a starred model, the star goes away.
3. You cannot hide the model you use now.
   Change to another model first.

## Set the model pi starts with

1. Move the cursor to the model.
2. Press `Ctrl+D`.

The row shows `·default` at once.
Pi opens with that model the next time it starts.

To clear it, move the cursor to the default model and press `Ctrl+D` again.
Pi then goes back to its own defaults.
Restart pi to apply the change.

## Make Ctrl+P follow your star order

`Ctrl+P` steps through models in pi.
It reads the `enabledModels` list in `settings.json`.
This extension can write your star order into that list.

1. Star the models you want, in the order you want.
2. Run `/models sync`.
3. Restart pi.

To undo this, run `/models unsync` and restart pi.

> Warning: `enabledModels` limits which models pi can reach.
> After a sync, only your starred models stay available.

## Hide the built-in /model menu entry

Pi defines `/model` inside its own code, so no setting can remove that command.
This extension takes the command over, so `/model` opens this picker.

You can still remove the extra `/model` line from the command menu.

- Run `/models hide` to remove it.
  Only `/models` stays in the menu.
  Both commands still work.
- Run `/models show` to put the line back.

## Where your data goes

The extension writes two files in your pi agent directory.

| File | What it holds |
|---|---|
| `~/.pi/agent/rich-model-selector.json` | Your stars, your star order, your hidden models, and the menu setting |
| `~/.pi/agent/settings.json` | The startup model, and the `enabledModels` list after a sync |

You can edit both files by hand.
You can also run more than one pi session at a time.
The picker reads both files each time it opens.
A write keeps the fields it does not own, because it locks the file first.

## Limits

1. An open picker does not follow file changes.
   Close the picker and open it again to see an edit made somewhere else.
2. `Ctrl+Up` and `Ctrl+Down` save the order that the picker loaded at open time.
   A star added by another session after that point can go away.
3. If two sessions write at the same moment, the last write wins.

## FAQ

#### Why do Ctrl+Up and Ctrl+Down do nothing on macOS?

macOS takes `Ctrl+Up` for Mission Control and `Ctrl+Down` for Application Windows.
Those keys never reach pi.

You have two options:

1. Use `Alt+Up` and `Alt+Down`.
   They do the same thing.
2. Turn the macOS shortcuts off.
   Go to System Settings, then Keyboard, then Keyboard Shortcuts, then Mission Control.
   Clear the Mission Control box and the Application Windows box.

#### Does this break my other editor extensions?

No.
Pi runs one editor only, but this extension adds to the editor instead of replacing it.
An extension such as `@xynogen/pix-display` keeps working.
The load order in `settings.json` does not matter.

#### I changed a file while pi was running. What happens?

Open the picker again to see the change.
A `/models hide` or `/models show` in one session reaches the other sessions on the next key press.

## License

AGPL-3.0-or-later.
See [LICENSE](./LICENSE).
