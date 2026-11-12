# Thinking levels

This page gives the rules for the thinking level of each model.
For the short version, see the [README](../README.md#thinking-level-per-model).

- [Keys](#keys)
- [The dot after the level](#the-dot-after-the-level)
- [Levels that each model offers](#levels-that-each-model-offers)
- [Go back to the global default](#go-back-to-the-global-default)
- [Levels from other places](#levels-from-other-places)

## Keys

- `Shift+Tab` moves the level up, and starts again at the bottom after the top level. One key reaches every level. It is the key that pi uses to cycle the thinking level.
- `Shift+Left` and `Shift+Right` move the level one step down or up. They stop at the lowest and the highest level, and tell you so.

The level is saved for the model under the cursor, so each model can have its own level.
Pi applies the level when you switch to that model, from the picker or with `Ctrl+P`.
A new level for the model that you use now applies at once, also when you close the picker with `Esc`.
The session gets the level when the picker closes, not at each key press.

```text
→ · <model-id>  1.0M $5/$25  medium ·      before
→ · <model-id>  1.0M $5/$25  high          after Shift+Tab
```

## The dot after the level

The dot tells you where the level comes from.

| Row | Meaning |
| --- | --- |
| `high ·` | You did not set a level. The model follows your global default. With no global default, it shows the level that pi uses now, because pi keeps that level when you switch models. |
| `high` | You set this level. It stays when the default changes. |
| `-` | The model cannot think. The level keys do nothing. |

## Levels that each model offers

Each model offers its own levels.
One model can offer `off`, `low`, `medium`, `high`, `xhigh`, and `max`.
Another model can offer only `low`, `medium`, and `high`.
A model with one level or with no level ignores the level keys.

## Go back to the global default

To set a model back to your global default, move its level onto the default.
The dot comes back, and the entry goes out of `settings.json`.
If the default changes later, the model follows it.

A level that is equal to the default is always saved as "follow the default".
So you cannot pin one model at the level of the default.
To keep one model apart from the rest, set the levels of the other models, or change your global default with `/thinking`.

The picker does not change your global default.
Use the `/thinking` command of pi to change it.

## Levels from other places

- **`/thinking` for one session.** A level that you set with `/thinking` stays when you open and close the picker. It goes away when you change the level of the model that you use now, or when you switch models.
- **`enabledModels`.** A level in `enabledModels` in `settings.json`, as `<provider>/<model-id>:<level>`, wins over the level from the picker when `Ctrl+P` gets to that model. Pi reads the levels in the same order.

The picker saves each level in the `modelThinkingLevels` field of `~/.pi/agent/settings.json`.
Pi reads this field itself, so a level from the picker works the same as a level set in another way.

```json
{
  "modelThinkingLevels": {
    "<provider>/<model-id>": "xhigh"
  }
}
```
