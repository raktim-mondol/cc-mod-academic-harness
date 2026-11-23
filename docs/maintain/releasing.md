# Releasing

A release is a tagged commit of the repository, which is public: a tag and a GitHub release are seen by everyone.

## Before a tag

1. The checks in [Testing](testing.md): types, `validate`, `plugin test`, the node suites, the parity check.
2. **The live scripts**: the whole matrix in [Testing](testing.md), on the final code. They are the only checks that see a real session. Rerun a failure once before calling it a defect, and fix a defect in its own change; a `BLOCKED` run (no login, usage limit, the model declined to exercise the guard) is not a failure and does not count as either run. The evidence goes in the release notes, not in a commit: the Claude Code version, the Node version, the scripts run and what each said. No live output is committed; it can hold paths and prompts.
3. A secret scan of the files that would be committed, `core/` included: copy `git ls-files -co --exclude-standard` to a scratch folder and scan that. No personal address in committed files. A change to `core/` that adds or changes a skill or a vendored project also needs `NOTICE` kept in step (the licence of what is added, named).
4. `CHANGELOG.md` has the entry; `.claude-plugin/plugin.json`, `package.json` and the README have the version.
5. The CI workflow is green on the commit to tag ([Testing](testing.md)), and `TESTED_VERSIONS` in `server/src/compat.mjs` lists the Claude Code versions the live scripts were run on for this release. A version added to or removed from `TESTED_VERSIONS` renames a CI check (`Claude Code <version>`), so update the required status checks of `main` (below) in the same step; otherwise a pull request waits on a check that never reports.

## Repository settings

Set once by the owner, in GitHub; they are not files. Check them again when the list of CI jobs or `TESTED_VERSIONS` changes.

- **Rules for `main`** (a branch ruleset): require a pull request; require conversation resolution; require branches to be up to date; require the status checks `Node 22`, `Node 24`, `Claude Code versions` and `Claude Code <each tested version>` (today `Claude Code 2.1.330`). Do **not** require `Claude Code latest`: it is advisory by design. Require **no approvals** while the owner is the only maintainer, because GitHub does not let an author approve their own pull request; `.github/CODEOWNERS` is in place, and the approval is switched on when a second maintainer joins. Leave the administrator bypass for an emergency and say so in the release notes when it is used.
- **A tag ruleset** for `v*` that blocks updating and deleting, so a release tag cannot be moved or removed silently. A ruleset, not the older tag protection rules, which GitHub has retired.
- **Private vulnerability reporting**: on (*Settings → Code security*), since the repository became public on 2026-11-16. `SECURITY.md` and the issue form's security link point at `https://github.com/raktim-mondol/cc-mod-academic-harness/security/advisories/new`. If the repository is ever made private again, GitHub switches the feature off, and those two links need the owner's contact instead.

## Tag

```
git tag -a v0.4.0 -m "0.4.0"
git push origin v0.4.0
```

A GitHub release for the tag: `gh release create v0.4.0 --notes-file <the notes>`. The notes carry the live-script evidence (Claude Code and Node versions, each script and its verdict).

## Marketplace

`.claude-plugin/marketplace.json` names the plugin with `"source": "./"`, so the repository is its own marketplace:

```
/plugin install academic-harness --marketplace raktim-mondol/cc-mod-academic-harness
```

The installed copy holds the whole source (`core/`); its first start copies it to the mod's home and installs its dependencies ([Getting started](../guide/getting-started.md)). Nothing is fetched from another repository.

## What CI does not run

`.github/workflows/ci.yml` runs the fast gate (`npm run check`) and the plugin tests on each tested Claude Code version; [Testing](testing.md) lists them. The **live scripts** are not run there: they need a signed-in Claude Code and cost money, so they stay step 3 above. The type check stays local too: its types exist only after a real session has loaded the mod.

The licences of what the repository ships were reviewed when it went public ([the architecture page](../design/architecture.md)). A change to what `skills/` copies (an update of Academic Harness that adds a skill, or a new third-party source) needs `NOTICE` kept in step; `tests/scripts/repo.test.mjs` fails when it is not.
