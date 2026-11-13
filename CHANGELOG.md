# Changelog

All releases of `@lazco/pi-rich-model-selector` are in this file.
The newest release is at the top.
Releases up to `0.4.0` shipped under the old name `@lazco-studio/pi-rich-model-selector`.

## [0.7.1] - 2026-11-14

### Docs

- The README is a public product page, with a demo GIF and screenshots of the picker, the thinking level, and the starred models.
- The demo video in the README and in the pi package manifest is new, and the manifest has an image.

## [0.7.0] - 2026-10-03

### Added

- `/models bind <action> <key>` binds the star, hide, `levelDown`, or `levelUp` key, for example `/models bind star alt+s`.
  `/models bind <action> default` hands one bind back to its default.
  The key hint follows the bind.
- `/models keys` shows the four custom key binds.
  The binds live in `rich-model-selector.json`.

### Changed

- The star key moves from `Ctrl+T` to `Ctrl+R`.
  `Ctrl+T` is pi's own thinking toggle, and `Ctrl+R` is the one `Ctrl` letter that pi leaves free.

## [0.6.0] - 2026-10-02

> [!IMPORTANT]
> This release moves keys that you know from earlier releases.
> The star moves from `Ctrl+S` to `Ctrl+T`, hide moves from `Ctrl+E` to `Ctrl+X`, and the startup model moves from `Ctrl+D` to `Ctrl+S`.
> The thinking level moves from `Tab` to `Shift+Tab`, and the view moves from `Shift+Tab` to `Tab`.
> Reorder keeps only `Alt+Up` and `Alt+Down`.

### Added

- The picker keys follow your `keybindings.json`.
  Each key uses the pi action that means the same thing in pi's own pickers, and the key hint shows the key that you really have.
- `PageUp` and `PageDown` move the cursor one page.
- `Shift+Left` and `Shift+Right` move the thinking level one step down or up, and stop at the lowest and the highest level.
- On macOS, the key hint says `Option` for the `Alt` key.

### Changed

- `Shift+Tab` moves the thinking level, as in pi.
  `Tab` changes the view, as in pi's own `/model` picker.
- The startup model key is `Ctrl+S`, pi's save key.
  A second press still clears the startup model.
- The star key is `Ctrl+T`, and the hide key is `Ctrl+X`.
- `Ctrl+E` and `Ctrl+D` go back to the search box, to jump to the end and to delete the character under the cursor.
  No picker key now takes an editing key that pi binds by default.

### Removed

- The `Alt+M` shortcut.
  Press `Ctrl+L`, or the key that you bound to pi's `app.model.select` action.
- `Ctrl+Up` and `Ctrl+Down` to reorder.
  macOS takes them for Mission Control, and fullscreen pi on Windows takes them for the transcript.
  Use `Alt+Up` and `Alt+Down`.

### Fixed

- The session runs at the thinking level that the picker shows.
  Before this fix, `Enter`, `Ctrl+P`, and a change to the model in use kept the old level, because pi did not see a level set in the picker.
  `Esc` applies a changed level of the model in use, and keeps a level that you set with `/thinking` when you change nothing.
- With no global default level, a row shows the level that pi runs at now, not `medium`.

## [0.5.0] - 2026-09-21

### Changed

- The package name is now `@lazco/pi-rich-model-selector`.
  The old name `@lazco-studio/pi-rich-model-selector` stops at `0.4.0`.
  To switch, run `pi uninstall npm:@lazco-studio/pi-rich-model-selector`, then `pi install npm:@lazco/pi-rich-model-selector`.
- The copyright holder in `LICENSE` is Lazco Corporation.
  The license stays AGPL-3.0-or-later.

## [0.4.0] - 2026-09-06

### Added

- Each model can hold its own thinking level.
  `Tab` moves the level of the model under the cursor to the next one, and starts again at the bottom after the top level.
  The level goes into `modelThinkingLevels` in `settings.json`, the field that pi reads when you switch model.
- A row shows the level that the model runs at.
  A dot after the level means that it comes from your global default, and a `-` means that the model cannot think.

### Changed

- `Shift+Tab` changes the view.
- The picker opens and changes the view faster with a large catalog.
- The catalog refresh in the background stops when you close the picker, and it stops after 15 seconds.

## [0.3.2] - 2026-09-06

This release has no change in the package.

## [0.3.1] - 2026-09-05

### Added

- The pi package manifest has a demo video.

### Docs

- The README has a new structure, with a table of contents, a list of the commands, and a FAQ.

## [0.3.0] - 2026-09-05

### Added

- `Ctrl+D` makes the model under the cursor the startup model, or clears it.
  The picker writes `defaultProvider` and `defaultModel` into `settings.json`.

### Changed

- The picker writes `settings.json` through pi, with a file lock.
  A change from pi, from another session, or from a hand edit now stays.
- The picker writes the star file with a file lock, and changes only the fields that you changed.
  A star set in one session and a model hidden in another session both stay.
- The picker reads both files each time it opens.
  The command menu follows `/models hide` and `/models show` from another session without a restart.
- `/models unsync` reads `settings.json`.

### Removed

- The `syncEnabledModels` field in the star file.
  Nothing read it.

### Fixed

- A star or a hide from another session no longer goes away when this session writes.
  Two writes within about a sixth of a second still keep only the later one.
- A failed write tries again by itself when the file lock is busy.
  When a write cannot work, the picker says so when it closes, and drops that message after a later write works.

## [0.2.0] - 2026-08-28

This is the first release.

### Added

- A model picker that shows the context size, the price, the thinking levels, and the key state of each model.
- `/model`, `/models`, `Ctrl+L`, and `Alt+M` open the picker.
  Text after the command filters the list, for example `/model opus`.
- `Ctrl+S` stars a model, and `Ctrl+Up` and `Ctrl+Down` or `Alt+Up` and `Alt+Down` sort the starred models.
- `Ctrl+E` hides a model, and `Tab` changes the view between the starred, all, and hidden models.
- `/models sync` writes the star order into `enabledModels`, so `Ctrl+P` follows it.
  `/models unsync` undoes it.
- `/models hide` removes the `/model` line from the command menu, and `/models show` puts it back.
- The stars live in `~/.pi/agent/rich-model-selector.json`.

[0.7.1]: https://github.com/Lazco-Corporation/pi-rich-model-selector/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Lazco-Corporation/pi-rich-model-selector/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Lazco-Corporation/pi-rich-model-selector/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Lazco-Corporation/pi-rich-model-selector/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Lazco-Corporation/pi-rich-model-selector/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/Lazco-Corporation/pi-rich-model-selector/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Lazco-Corporation/pi-rich-model-selector/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Lazco-Corporation/pi-rich-model-selector/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Lazco-Corporation/pi-rich-model-selector/releases/tag/v0.2.0
