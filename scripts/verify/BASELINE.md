# What the `verify:` scripts reported before the refactor pass

Recorded 8 August 2026, against the development database and the `marcy-lms-test` organization, immediately before the shared harness was extracted. Every phase of the refactor is gated on reproducing these numbers rather than merely exiting zero — a script that silently stops checking something exits zero too.

| Script | `ok` | Needs |
| --- | --- | --- |
| `verify:sandbox` | 41 | nothing |
| `verify:grade` | 101 | nothing |
| `verify:modules` | 35 | the database |
| `verify:groups` | 46 | the database |
| `verify:resources` | 64 | the database |
| `verify:staff` | 50 | the database |
| `verify:approve` | 48 | the database |
| `verify:uploads` | 88 | the database, and the storage bucket |
| `verify:authoring` | 156 | the database, and GitHub |
| `verify:enrollment` | 200 | the database |
| `verify:app` | 16 | GitHub |
| `verify:assets` | 62 | GitHub |
| `verify:e2b` | 8 | a real E2B sandbox |

`verify:resubmission` is not in the table because it takes a repository substring as an argument and refuses without one. It also has no fixed count: **it fails unless the repository it is pointed at holds a commit newer than the one it was graded on**, which is state a person stages by pushing and letting the webhook record it — the script says so in its own header, since item 4 is checked here rather than performed. A run reporting `FAIL the new commit was recorded  head X, graded X` is that missing fixture and not a regression. The way to tell them apart is to run the same command on the previous commit; a real regression fails there too.

`calibrate` is not a check script: it grades a sample and prints a comparison for a person to read.

**The README's figures are older than these.** It records 43 for groups and 61 for resources where they now report 46 and 64 — the scripts grew and the prose did not. That is the whole reason this file exists: the number to compare against is the one the script prints today, not the one somebody wrote down once.

## Re-running the set

The database-backed scripts are slow enough that `npm run` adds a wrapper it is easier to do without:

```sh
npx tsx --conditions=react-server scripts/verify-groups.ts
```

`--conditions=react-server` is required by anything reaching a module marked `server-only`, which is most of them.
