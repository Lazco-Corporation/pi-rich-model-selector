# @lazco/pi-rich-model-selector

**A model picker for pi. It shows model facts, and it keeps your starred models in the order you set.**

The picker in pi shows the model id, the provider, and the name.
This extension also shows the context size, the price, the thinking level, and the key state.
You can set the thinking level of each model, star a model, hide a model, and sort your starred models.

<video src="https://github.com/user-attachments/assets/5fd65f9e-ef06-4577-9c7e-793d5c7d6f58" controls></video>

## Table of contents

- [Install](#install)
- [Open the picker](#open-the-picker)
- [Keys](#keys)
- [Commands](#commands)
- [What a row shows](#what-a-row-shows)
- [The three views](#the-three-views)
- [Set the thinking level of a model](#set-the-thinking-level-of-a-model)
- [Keys the filter box keeps](#keys-the-filter-box-keeps)
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
pi install npm:@lazco/pi-rich-model-selector
```

> [!IMPORTANT]
> This package was named `@lazco-studio/pi-rich-model-selector`.
> That name stopped at `0.4.0` and gets no further release.
> Every release after it ships under `@lazco/pi-rich-model-selector`.
> To switch, uninstall the old name first:
>
> ```bash
> pi uninstall npm:@lazco-studio/pi-rich-model-selector
> pi install npm:@lazco/pi-rich-model-selector
> ```

To try it for one session only:

```bash
pi -e npm:@lazco/pi-rich-model-selector
```

## Open the picker

There are three ways.
All three open the same picker.

1. Type `/model`.
   This extension takes over the built-in command.
2. Type `/models`.
3. Press `Ctrl+L`, or the key you bound to pi's `app.model.select` action.

To open the picker with a filter, add a word:

```text
/model opus
```

The picker opens at once on the models pi already knows.
It then asks each provider for a fresh catalog in the background, and the list updates when the answer comes.
That refresh stops when you close the picker, and it gives up after 15 seconds.
Either way you keep the models pi already had.

## Keys

| Key | Action | Pi action |
|---|---|---|
| Type text | Filter the list | |
| `Up` / `Down` | Move the cursor | `tui.select.up` / `tui.select.down` |
| `PageUp` / `PageDown` | Move the cursor one page | `tui.select.pageUp` / `tui.select.pageDown` |
| `Shift+Tab` | Move the thinking level up, and start again at the bottom after the top | `app.thinking.cycle` |
| `Shift+Left` / `Shift+Right` | Move the thinking level one step down or up | |
| `Ctrl+T` | Star the model, or remove the star | |
| `Ctrl+S` | Make the model the startup model, or clear it | `app.models.save` |
| `Ctrl+X` | Hide the model, or show it again | |
| `Alt+Up` / `Alt+Down` | Move a starred model up or down | `app.models.reorderUp` / `app.models.reorderDown` |
| `Tab` | Change the view | `tui.input.tab` |
| `Enter` | Use the model under the cursor | `tui.select.confirm` |
| `Esc` or `Ctrl+C` | Close the picker and keep the model you use now | `tui.select.cancel` |

A key with a pi action is the key pi uses for the same action in its own pickers.
It follows your `keybindings.json`, so a key you rebind moves in the picker and in its key hint too.
The keys without a pi action are fixed.
On macOS, `Alt` is the `Option` key, and the key hint says `Option`.

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
→ ★ <model-id>  1.0M $5/$25  xhigh ✓ ·default
```

- `→` is the cursor.
- `★` means the model is starred.
- `·` means the model is not starred.
- `✗` means the model is hidden.
- `1.0M` is the context size.
- `$5/$25` is the price for 1M input tokens and 1M output tokens.
- `xhigh` is the thinking level this model runs at.
  A dot after it, as in `xhigh ·`, means the level comes from your global default.
  With no global default set, the dot shows the level pi runs at now, because pi keeps that level when you switch.
  No dot means you set the level for this model.
  A `-` means the model cannot think.
- `✓` means pi uses this model now.
- `·default` means pi starts with this model.
- `·no key` means there is no API key.
  Run `/login` to add one.

The panel on the right shows more facts about the model under the cursor.
On a narrow terminal, that panel moves below the list.

```text
╭─ Select a model ── ↵ · ⇧⇥←→ · ^T★ · ⌥↑↓ · ^S · ^X · ⇥ · esc ─╮
│ View: starred | all | hidden  2 starred, 1 hidden, 3 total   │
│ >                                                            │
├───────────────────────┬──────────────────────────────────────┤
│ → ★ <model-id>        │ <model-id>…                          │
│   ★ <other-model-id>  │ Name    …                            │
╰───────────────────────┴──────────────────────────────────────╯
```

## The three views

Press `Tab` to go to the next view.

| View | What it lists |
|---|---|
| `starred` | Your starred models, in your order |
| `all` | Every model, except the hidden ones |
| `hidden` | Only the hidden models |

## Set the thinking level of a model

Press `Shift+Tab` to move the level of the model under the cursor.
It is the key pi itself uses to cycle the thinking level.
Press `Shift+Left` or `Shift+Right` to move the level one step down or up.
The level is saved against the model, so every model can hold its own.
Pi applies it when you switch to that model, from the picker or with `Ctrl+P`.
A new level for the model in use applies at once, even when you close the picker with `Esc`.

A level you set with `/thinking` for this session only stays when you open the picker and close it.
It gives way once you change the level of the model in use, or switch model.

```text
→ · <model-id>  1.0M $5/$25  medium ·      before
→ · <model-id>  1.0M $5/$25  high          after Shift+Tab
```

`Shift+Tab` goes up, and starts again at the bottom after the top level.
One key reaches every level that way.
`Shift+Left` and `Shift+Right` stop at the lowest and the highest level, and say so.

The dot tells you where the level came from.

| Row | Meaning |
|---|---|
| `high ·` | No level set. The model follows your global default, or the level pi runs at now when you have no default. |
| `high` | You set this level. It stays, whatever the default becomes. |
| `-` | The model cannot think. The level keys do nothing. |

Each model offers its own levels.
A model may go `off`, `low`, `medium`, `high`, `xhigh`, `max`, and another may
only go `low`, `medium`, `high`.
A model with one level, or with none, ignores the level keys.

To hand a model back to your global default, step the level onto the default.
The dot comes back, and the entry leaves `settings.json`.

Your global default stays where it is.
Use pi's own `/thinking` command to change that.

A level written into `enabledModels` in `settings.json`, as `<provider>/<model-id>:<level>`, wins over the level you set here when `Ctrl+P` reaches that model.
Pi reads it in that order too.

## Keys the filter box keeps

The filter box takes every key the picker does not claim.
The picker claims none of the keys pi's editor uses for text, so the box edits the way pi's editor does.
That includes any editing key you rebind in `keybindings.json`.

| Key | What it does |
|---|---|
| `Left` / `Right` | Move the cursor one character |
| `Ctrl+B` / `Ctrl+F` | Move the cursor one character |
| `Alt+Left` / `Alt+Right` | Move the cursor one word |
| `Home` / `Ctrl+A` | Jump to the start |
| `End` / `Ctrl+E` | Jump to the end |
| `Ctrl+D` | Delete the character under the cursor |
| `Ctrl+W` / `Ctrl+U` / `Ctrl+K` | Delete a word, to the start, or to the end |

In fullscreen mode, pi keeps `Home` and `End` for the transcript.
Use `Ctrl+A` and `Ctrl+E` there.

## Star and sort your models

1. Move the cursor to a model.
2. Press `Ctrl+T` to star it.
3. Press `Tab` until the view shows `starred`.
4. Press `Alt+Up` or `Alt+Down` to move the model.

These are the keys pi's own `/scoped-models` picker uses to sort models.

The order applies to starred models only.

## Hide a model you do not use

Press `Ctrl+X` to hide the model under the cursor.
A hidden model leaves the `all` view.

To get it back:

1. Press `Tab` until the view shows `hidden`.
2. Move the cursor to the model.
3. Press `Ctrl+X`.

Three rules apply:

1. A star wins over a hide.
   If you star a hidden model, the model becomes visible again.
2. If you hide a starred model, the star goes away.
3. You cannot hide the model you use now.
   Change to another model first.

## Set the model pi starts with

1. Move the cursor to the model.
2. Press `Ctrl+S`.

The row shows `·default` at once.
Pi opens with that model the next time it starts.

`Ctrl+S` saves the startup model in pi's own picker too.
Pi's picker also switches to the model and closes.
This picker stays open and keeps the model you use now, so you can set the default without leaving the model you are on.

To clear it, move the cursor to the default model and press `Ctrl+S` again.
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
| `~/.pi/agent/settings.json` | The thinking level of each model, the startup model, and the `enabledModels` list after a sync |

The thinking levels go into the `modelThinkingLevels` field, which pi reads by
itself. So a level set here works the same as one set any other way.

```json
{
  "modelThinkingLevels": {
    "<provider>/<model-id>": "xhigh"
  }
}
```

You can edit both files by hand.
You can also run more than one pi session at a time.
The picker reads both files each time it opens.
A write keeps the fields it does not own, because it locks the file first.

## Limits

1. An open picker does not follow file changes.
   Close the picker and open it again to see an edit made somewhere else.
2. `Alt+Up` and `Alt+Down` save the order that the picker loaded at open time.
   A star added by another session after that point can go away.
3. If two sessions write at the same moment, the last write wins.
4. A level you set for the model in use reaches the session when the picker closes, not on each key press.
5. In fullscreen mode, `PageUp` and `PageDown` scroll the transcript and do not reach the picker.
   Pi's own pickers work the same way.
   See the FAQ to page the list there.

## FAQ

#### How do I change a key?

Add the pi action from the [Keys](#keys) table to `~/.pi/agent/keybindings.json`, then run `/reload`.
The change applies in pi's own pickers too, because they use the same action.

```json
{
  "app.models.reorderUp": "<key>",
  "app.models.reorderDown": "<key>"
}
```

See pi's keybindings documentation for the key syntax.
The keys without a pi action cannot be changed.

#### How do I page the list in fullscreen mode?

Fullscreen mode takes `PageUp` and `PageDown` for the transcript before the picker sees them.
Bind the page actions to a second key that the transcript leaves alone:

```json
{
  "tui.select.pageUp": ["pageUp", "shift+up"],
  "tui.select.pageDown": ["pageDown", "shift+down"]
}
```

This pages every list in pi, not only this picker.

#### Does this break my other editor extensions?

No.
Pi runs one editor only, but this extension adds to the editor instead of replacing it.
An extension such as `@xynogen/pix-display` keeps working.
The load order in `settings.json` does not matter.

#### Why did my level lose its dot, or get one back?

The dot means the row follows your global default.
With no global default set, it follows the level pi runs at now.

When you step a level onto the default, the picker removes the entry instead of
saving one that only repeats the default.
The dot comes back to show that.
If the default later changes, that model follows it.

#### Can I pin a level that equals my global default?

No.
A level equal to the default is stored as "follow the default".
To pin one model apart from the rest, set the other models instead, or change
your global default with `/thinking`.

#### I changed a file while pi was running. What happens?

Open the picker again to see the change.
A `/models hide` or `/models show` in one session reaches the other sessions on the next key press.

## License

AGPL-3.0-or-later.
See [LICENSE](./LICENSE).
