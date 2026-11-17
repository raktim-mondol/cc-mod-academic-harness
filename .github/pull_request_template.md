## What and why

<!-- What changes, and what problem it fixes. Link the issue when there is one. -->

## Checks

- [ ] `npm run check`
- [ ] `npm run typecheck` (if `hooks/` changed; needs a session that has loaded the mod)
- [ ] `npm run test:plugin` (if `hooks/` or the manifests changed)
- [ ] The relevant live script (if the guard, the commands, the pane or job notices changed)

## Notes

- [ ] No generated file was edited by hand (`skills/`, `agents/`, `hooks/generated/`); `npm run build` produced any change there.
- [ ] A user-visible change has a line in `CHANGELOG.md`.
- [ ] A new documentation page is linked from the index of its folder.
- [ ] Nothing in this change prints a key, a token or a private file.
