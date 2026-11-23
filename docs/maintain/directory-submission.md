# Submitting to Anthropic's plugin directory

The repository is already its own marketplace ([Releasing](releasing.md#marketplace)), so anyone can install it from GitHub. The directory is a second route: people add it on claude.ai or in Cowork, and it loads in their Claude Code sessions through account sync. **Only the owner can submit it**: it needs a paid claude.ai plan and the owner's GitHub account connected to claude.ai, in the developer portal at <https://claude.ai/directory/manage> (Submit new, then Plugin bundle). The checks below are Anthropic's own published ones (<https://claude.com/docs/plugins/pre-submission-checklist>), read against this repository for 0.7.1 (the plugin is the same as in 0.7.0).

## What was checked

| Check | Result for 0.7.1 |
|---|---|
| `claude plugin validate . --profile directory --strict` | Passes. It is a subset of what the directory runs and does not apply the directory's own rules for a hooks module |
| `plugin.json`: name, description, author, version, license, `network.hosts` | Set. The name `academic-harness` is lowercase ASCII, and the 83 hosts the plugin reaches are declared (`server/src/hosts.mjs`, kept true by `tests/scripts/hosts.test.mjs`) |
| README of at least 40 words, `LICENSE` | Present (MIT; `NOTICE` names the third-party material in `core/`) |
| Layout | about 3,660 files in about 1,380 folders (limits: 10,000 together), an archive of 16 MB (limit 50 MiB), no file over 5 MiB, no symbolic link, submodule, LFS pointer, `.gitattributes`, package-manager configuration file, macOS or Windows system file, minified file, name that is invalid on Windows or macOS, or two names that differ only in capitals |
| Files | No binary file other than 8 images (6 PNG, 1 JPEG, 1 GIF) |
| MCP servers and hooks | `node ${CLAUDE_PLUGIN_ROOT}/server/bin/ah-mcp.mjs` and `papermemory-mcp.mjs`: a plain file, a path from `${CLAUDE_PLUGIN_ROOT}`, no launcher; `hooks/hooks.json` is valid with a `modules` array |
| Credentials | Every key is a `sensitive` `userConfig` option; none is committed (secret scan of `git ls-files -co`, 0.7.1) |
| Dependencies | `npm audit` reports no advisory in the core's dependencies, production or development |

## What a reviewer is likely to hold, and why (not a rejection)

The directory holds a plugin for a reviewer, rather than refusing it, for the things below, and this plugin does each of them. Each is by design and is described in the README under "What it runs, sends and fetches":

- **Size.** More than 512 files, and four text files over 256 KiB (`core/python-helpers/uv.lock`, `core/skills/bids/references/bids_schema.json`, `core/workflows.json`, `core/skills/aer-skills/assets/aer-cover-official.svg`). The plugin is the whole source on purpose: nothing is fetched from another repository.
- **A first start that installs packages.** The server copies `core/` to the mod's home and runs `npm ci` there, and builds the writing engine's Python environment (`uv` or `pip`). No package launcher (`npx`, `uvx`) is used and no registry is configured.
- **Programs the validator cannot read through.** `ah-mcp.mjs` and the hook helpers are Node files, not shell scripts.
- **A credential read from the environment.** `GITHUB_TOKEN` is used by `repo_audit` when it is set, and every provider key can come from its environment variable as well as from the plugin option; the options are the way the README tells people to set them.
- **Things the plugin can do only after the person confirms:** rented compute (`modal_run`, `runpod_run`, `vastai_run`), author-only acts, and registering a Paper2MCP server (it writes `.mcp.json`; Claude Code asks again before it starts the server).
- **The self-improvement loop**, which is off unless the person turns it on, and never runs headless.

## Answers for the portal's data handling step

| Question | Answer |
|---|---|
| Does it read or store personal data? | It reads the files of the folder the person works in (manuscripts, data, which can hold personal data) only when the person asks a tool to. It stores, on the person's machine only: a notebook and research ledgers in the project (`.dsh/`), job records, usage counts (names and numbers, never what a tool was used for), a library of papers the person ingests (PaperMemory), and, only if the person turns the loop on, task kinds, hashes and the preferences they state. The author keeps nothing and runs no server. |
| Does it send data to services other than its declared connectors? | Yes, only to the hosts in `plugin.json` `network.hosts`: public scholarly and registry APIs for the queries the person makes, and the search or fetch providers the person has saved a key for. A tool sends what it needs (a query, a DOI, a URL). Files are sent only to rented compute the person approved. Tools that call a model use the person's own Claude Code login. No telemetry. |
| How long does it keep data? | On the person's machine, until they delete it: job records and clipped tool output 30 days, usage counts one year, the hooks module's start record one week, the loop's store (if on) bounded and rotated, the project's ledgers and the PaperMemory library until the person removes them. |
| Is it intended for people under 18? | No. It is a research and academic writing tool. |

## Before you submit

1. Make sure the version in `plugin.json` is the one you want listed, and that `main` holds it (the directory follows the tracked branch or tag).
2. Connect your GitHub account to claude.ai in the organization you submit from; the account needs push access to the repository.
3. In the portal: Submit new, Plugin bundle; Repository `raktim-mondol/cc-mod-academic-harness`; leave Plugin path empty (the plugin is at the root); Branch or tag: `main` or a release tag. Select Validate, then check the Listing details (they are read from `plugin.json` and the README), answer the data handling questions with the table above, confirm the contact email, and select the four acknowledgements.
4. Expect the result to be **held for a reviewer** (above) rather than an immediate pass, and keep the repository public. If the scan reports a finding, the report names it; the checklist page says what each kind means.
5. Choose how new versions arrive (GitHub push webhook, which needs admin access to the repository, or a scheduled check). A new version is validated again, and one that the scan flags can be held.

The directory's terms and policy are the Anthropic Software Directory Terms and Policy (linked from <https://claude.com/docs/plugins/submit>); read them before you accept the acknowledgements.
