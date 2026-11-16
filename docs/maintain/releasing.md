# Releasing

A release is a tagged commit of the private repository. Nothing here publishes anything outside it.

## Before a tag

1. `node scripts/update-upstream.mjs` reports nothing you have not decided (or you chose to hold at the commit in the lock).
2. The checks in [Testing](testing.md): types, `validate`, `plugin test`, the node suites, the parity check.
3. **The live scripts**: the whole matrix in [Testing](testing.md), on the final code. They are the only checks that see a real session. Rerun a failure once before calling it a defect, and fix a defect in its own change. The evidence goes in the release notes, not in a commit: the Claude Code version, the Node version, the scripts run and what each said. No live output is committed; it can hold paths and prompts.
4. `node scripts/check-upstream-clean.mjs`.
5. A secret scan of the files that would be committed: copy `git ls-files -co --exclude-standard` to a scratch folder and scan that (the snapshot would otherwise be scanned too). No personal address in committed files.
6. `CHANGELOG.md` has the entry; `.claude-plugin/plugin.json` has the version.
7. The CI workflow is green on the commit to tag ([Testing](testing.md)), and `TESTED_VERSIONS` in `server/src/compat.mjs` lists the Claude Code versions the live scripts were run on for this release. A version added to or removed from `TESTED_VERSIONS` renames a CI check (`Claude Code <version>`), so update the required status checks of `main` (below) in the same step; otherwise a pull request waits on a check that never reports.

## Repository settings

Set once by the owner, in GitHub; they are not files. Check them again when the list of CI jobs or `TESTED_VERSIONS` changes.

- **Rules for `main`** (a branch ruleset): require a pull request; require conversation resolution; require branches to be up to date; require the status checks `Node 22`, `Node 24`, `Claude Code versions` and `Claude Code <each tested version>` (today `Claude Code 2.1.325`). Do **not** require `Claude Code latest`: it is advisory by design. Require **no approvals** while the owner is the only maintainer, because GitHub does not let an author approve their own pull request; `.github/CODEOWNERS` is in place, and the approval is switched on when a second maintainer joins. Leave the administrator bypass for an emergency and say so in the release notes when it is used.
- **A tag ruleset** for `v*` that blocks updating and deleting, so a release tag cannot be moved or removed silently. A ruleset, not the older tag protection rules, which GitHub has retired.
- **Private vulnerability reporting**, deferred: GitHub offers it on public repositories only. When the repository is made public (after the licence review below), enable *Settings → Code security → Private vulnerability reporting*, confirm `https://github.com/raktim-mondol/cc-mod-academic-harness/security/advisories/new` loads, and point `SECURITY.md` and the issue form's security link back to it.

## Tag

```
git tag -a v0.4.0 -m "0.4.0"
git push origin v0.4.0
```

A GitHub release for the tag is optional: `gh release create v0.4.0 --notes-file <the CHANGELOG entry>`. The repository is private, so a release is seen only by people with access.

## Marketplace

`.claude-plugin/marketplace.json` names the plugin with `"source": "./"`, so the repository is its own marketplace:

```
/plugin install academic-harness --marketplace raktim-mondol/cc-mod-academic-harness
```

The installed copy has no snapshot; its first start fetches the one in `UPSTREAM.lock.json` ([Getting started](../guide/getting-started.md)). Changing what the repository ships means changing the lock too, which `sync-upstream` and `update-upstream` do.

## What CI does not run

`.github/workflows/ci.yml` runs the fast gate (`npm run check`) and the plugin tests on each tested Claude Code version; [Testing](testing.md) lists them. The **live scripts** are not run there: they need a signed-in Claude Code and cost money, so they stay step 3 above. The type check stays local too: its types exist only after a real session has loaded the mod.

If the repository ever goes public, the licences of what it ships need the review noted in [the architecture page](../design/architecture.md) first.
