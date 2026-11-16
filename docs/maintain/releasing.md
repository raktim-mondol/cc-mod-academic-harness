# Releasing

A release is a tagged commit of the private repository. Nothing here publishes anything outside it.

## Before a tag

1. `node scripts/update-upstream.mjs` reports nothing you have not decided (or you chose to hold at the commit in the lock).
2. The checks in [Testing](testing.md): types, `validate`, `plugin test`, the node suites, the parity check.
3. **The live scripts**, at least `p1`, `p3`, `p5`, `p6`, `fit` and `install`, and the tmux ones if the interface changed. They are the only checks that see a real session.
4. `node scripts/check-upstream-clean.mjs`.
5. A secret scan of the files that would be committed: copy `git ls-files -co --exclude-standard` to a scratch folder and scan that (the snapshot would otherwise be scanned too). No personal address in committed files.
6. `CHANGELOG.md` has the entry; `.claude-plugin/plugin.json` has the version.

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

## Not done, on purpose

No GitHub Action runs the tests: the live ones need a login, and the rest are seconds on a laptop. If the repository ever goes public, the licences of what it ships need the review noted in [the architecture page](../design/architecture.md) first.
