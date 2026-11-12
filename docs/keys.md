# Keys

This page lists every key of the picker and tells you how to change a key.
For the main use of each key, see the [README](../README.md).

- [Picker keys](#picker-keys)
- [Filter box keys](#filter-box-keys)
- [Change a key](#change-a-key)
- [Page the list in fullscreen mode](#page-the-list-in-fullscreen-mode)

## Picker keys

| Key | Pi action | Custom bind | Action |
| --- | --- | --- | --- |
| Type text | | | Filter the list |
| `Up` / `Down` | `tui.select.up` / `tui.select.down` | | Move the cursor |
| `PageUp` / `PageDown` | `tui.select.pageUp` / `tui.select.pageDown` | | Move the cursor one page |
| `Shift+Tab` | `app.thinking.cycle` | | Move the thinking level up, and start again at the bottom after the top |
| `Shift+Left` / `Shift+Right` | | `levelDown` / `levelUp` | Move the thinking level one step down or up |
| `Ctrl+R` | | `star` | Star the model, or remove the star |
| `Ctrl+S` | `app.models.save` | | Make the model the startup model, or clear it |
| `Ctrl+X` | | `hide` | Hide the model, or show it again |
| `Alt+Up` / `Alt+Down` | `app.models.reorderUp` / `app.models.reorderDown` | | Move a starred model up or down |
| `Tab` | `tui.input.tab` | | Change the view |
| `Enter` | `tui.select.confirm` | | Use the model under the cursor |
| `Esc` or `Ctrl+C` | `tui.select.cancel` | | Close the picker and keep the model that you use now |

On macOS, `Alt` is the `Option` key, and the key hint says `Option`.

## Filter box keys

The filter box gets every key that the picker does not use.
The picker uses none of the text keys of pi's editor, so the filter box edits text the same way as pi's editor.
This includes each text key that you change in `keybindings.json`.

| Key | Action |
| --- | --- |
| `Left` / `Right` | Move the cursor one character |
| `Ctrl+B` / `Ctrl+F` | Move the cursor one character |
| `Alt+Left` / `Alt+Right` | Move the cursor one word |
| `Home` / `Ctrl+A` | Go to the start |
| `End` / `Ctrl+E` | Go to the end |
| `Ctrl+D` | Delete the character under the cursor |
| `Ctrl+W` / `Ctrl+U` / `Ctrl+K` | Delete a word, the text to the start, or the text to the end |

In fullscreen mode, pi keeps `Home` and `End` for the transcript.
Use `Ctrl+A` and `Ctrl+E` there.

## Change a key

There are two kinds of keys, and each kind changes in a different way.

### A key with a pi action

A key with a pi action is the key that pi uses for the same action in its own pickers.
It follows `~/.pi/agent/keybindings.json`.
Add the action to that file, then run `/reload`:

```json
{
  "app.models.reorderUp": "<key>",
  "app.models.reorderDown": "<key>"
}
```

The change applies in pi's own pickers too, because they use the same action.
The key hint of this picker shows the new key.
For the key syntax, see the keybindings documentation of pi.

### A key with a custom bind

A key with a custom bind follows the `/models bind` command.

| Command | What it does |
| --- | --- |
| `/models keys` | Show the 4 custom binds |
| `/models bind <action> <key>` | Bind `star`, `hide`, `levelDown`, or `levelUp` to `<key>` |
| `/models bind <action> default` | Set one bind back to its default |

For example, this command moves the star key to `Alt+S`:

```text
/models bind star alt+s
```

The key hint shows the new key.
A bind to a key that the picker already uses never fires, and the command tells you so.

## Page the list in fullscreen mode

In fullscreen mode, pi gives `PageUp` and `PageDown` to the transcript before the picker gets them.
Pi's own pickers work the same way.
To page the list, bind the page actions to a second key that the transcript does not use, in `~/.pi/agent/keybindings.json`:

```json
{
  "tui.select.pageUp": ["pageUp", "shift+up"],
  "tui.select.pageDown": ["pageDown", "shift+down"]
}
```

This change pages every list in pi, not only this picker.
