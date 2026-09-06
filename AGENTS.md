# AGENTS.md

A pi extension. It gives a model picker with model facts, stars, and a star
order the user sets.

## Commands

| Command | What it does |
|---|---|
| `bun install` | Install the dependencies. |
| `npm run check` | Type-check. This is the only gate. There is no test runner. |
| `npm run verify` | Drive the real picker through every list action and check the result. |
| `npm run bench` | Time the picker's hot paths over the full built-in catalog. |
| `npm run release -- <bump>` | Cut a release. See **Release** below. |

The package ships TypeScript source, so there is no build step.

## Layout

All source sits under `src/`.

| File | What it holds |
|---|---|
| `index.ts` | the command, the shortcut, and the editor that takes over `/model` |
| `picker.ts` | the picker component |
| `window.ts` | the window frame that draws the border, the title, and the hint |
| `model-facts.ts` | turns a model into the text the user sees |
| `store.ts` | reads and writes the star file and the pi settings file |

`scripts/release.sh` cuts a release.
`.github/workflows/release-npm.yml` publishes one.
`scripts/verify/` holds scripts that drive the exported picker and check what
it shows. `scripts/bench-picker.ts` and `scripts/bench-open.ts` time it.
`scripts/run-node-bench.mjs` runs a TypeScript script under node through
jiti, the loader pi uses, so a timing taken there is the timing the user gets.

## Dependencies

Read `docs/packages.md` in the installed `@earendil-works/pi-coding-agent`
before you add a dependency. The rules that matter here:

- A package that pi bundles goes in `peerDependencies` with a `"*"` range.
  Never bundle one.
- Any other runtime dependency goes in `dependencies`. Pi runs `npm install`
  for a package it installs, and gives each package its own module root.
  So a dependency of pi is not reachable from here. Declare it.
- Pin a dependency that pi also uses to the version pi resolves. The two then
  share one copy.

## Editing the two state files

The extension writes two files in the pi agent directory:

- The pi settings file. Pi owns it.
- The star file. This extension owns it.

Rules for both:

- Never write the pi settings file by hand. Go through pi's `SettingsManager`.
  It takes a file lock, re-reads inside that lock, and writes back only the
  fields the caller changed.
- Never cache a `SettingsManager`. Build one per call and drop it. A cached one
  holds an old copy of the file.
- Hold the file lock across a read-modify-write on the star file. A merge
  without a lock still drops a field.
- Merge onto the file as it is on disk, not onto the copy this process read at
  start. Track which fields this process changed and apply only those.
- Write through a temporary file that carries the process id, then rename.
- Assume the user edits both files by hand while pi runs, and that a second pi
  session writes them at the same time. Both are normal.

Retry rules:

- Retry a write only when the lock is busy. That state ends by itself.
- Never retry a failure that cannot change, such as a read-only disk. It would
  spin for as long as pi runs.
- Bound the retries, and call `unref()` on the retry timer. A pending retry must
  never hold pi open.
- Report a failure no retry can fix. Clear it once a write lands, or the user
  sees a failure after the save worked.

## Style

Read the design principles and code style in the global `AGENTS.md`. On top of
those, for this repo:

- Comments say **why**, never what or how. A comment that repeats the code is
  noise.
- Write a comment where the reason is not obvious from the code: a lock, a
  retry bound, a merge rule, a workaround for pi's own behavior.
- Prefer one clear name for one thing across the whole repo.
- Keep the README honest. When behavior changes, change the README in the same
  commit. Do not claim a limit is gone until a test shows it is gone.

## Test

There is no test framework. Verify a change against a real scenario before you
call it done:

1. Reproduce the fault first, and keep the output.
2. Drive the real exported code, not a copy of its logic.
3. For anything about two sessions, run two real processes at once.
4. Run the same case several times. A race that passes once proves nothing.
5. Run `npm run check` and `npm run verify`.

A scenario worth keeping goes in `scripts/verify/`. Each script there prints
one line per check and exits non-zero on a failure.

## Performance

The picker holds every model pi knows, which is over a thousand rows. The
search box, the cursor, and the tab key each redraw the list, so a pass over
every row on each key press is what makes the picker feel slow.

Rules that keep it fast:

- Sort once, and only when the order can change: a star, a hide, a reorder,
  the startup default, or a catalog refresh. A key press in the search box
  never re-sorts. Set `orderDirty` after any store call that can write.
- The sort comparator reads strings and a map only. Never call into a model
  object or the store from inside it. It runs tens of thousands of times.
- Format a row cell once, at load, and keep it on the `ModelItem`. A level
  cell needs pi to list the levels a model accepts, so refresh only the row
  the arrow key changed.
- Measure column widths once per filtered list, not once per redraw.
- Cancel the catalog refresh when the picker closes, and bound it. Pi's own
  picker does the same.

Run `npm run bench` before and after a change to a hot path, and keep both
numbers in the commit body.

## Commits

- Subject in the imperative, under 72 characters.
- Explain what and why in the body. Wrap the body at 72 characters.
- Never add a co-author trailer or a tool attribution line.

## Release

`npm version` owns the version number. Never edit the `version` field in
`package.json` by hand.

One command cuts a release from `main`:

```bash
npm run release -- <bump>
```

`<bump>` is `patch`, `minor`, `major`, `prepatch`, `preminor`, `premajor`,
`prerelease`, or an exact version such as `<MAJOR>.<MINOR>.<PATCH>`.

Add `--dry-run` to run every check and print the plan without changing
anything:

```bash
npm run release -- <bump> --dry-run
```

### What the script does

It refuses to start unless:

1. the current branch is `main`,
2. the working tree is clean,
3. `main` and its upstream agree,
4. `npm run check` passes.

Then it runs `npm version <bump>`, which writes `package.json`, commits, and
creates the `v<version>` tag in one step. So the tag and `package.json` can
never disagree.

It then refuses to continue if that version is already on the npm registry,
because an npm version is immutable. A duplicate would waste the version
number.

Last, it pushes `main` and the tag.

If any step after the bump fails, the script resets to the starting commit and
deletes only the tag this run created. Nothing reaches the remote.

### What the tag does

A push of a `v*` tag starts `.github/workflows/release-npm.yml`. That workflow
installs, type-checks, reads the npm token from the secret store, publishes
with provenance, and creates the GitHub release with generated notes.

A version that holds a `-`, such as `<MAJOR>.<MINOR>.<PATCH>-beta.<N>`, goes to
the `next` dist-tag. A normal version goes to `latest`.

### Pick the bump

- `patch` for a fix only.
- `minor` for new user-facing behavior, such as a new key or command.
- `major` for a change that breaks a user's setup.

Check what reached `main` since the last tag before choosing. A release that
carries a new key is not a patch.
