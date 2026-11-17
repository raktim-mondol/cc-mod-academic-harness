# Keys and credentials

There is one place for every key, token and account the tools use: the plugin's own options in Claude Code. You do not create a `.env` file, and nothing is stored in the plugin's folder. No key is needed to start; each one unlocks a source or a tool.

## Save a key

Outside a session:

```
claude plugin configure academic-harness@academic-harness-mod
```

lists every option and says which are set. To save values, pass them as JSON on standard input, so they never appear in the command line or the shell history:

```
claude plugin configure academic-harness@academic-harness-mod --values-stdin
{"s2_api_key": "...", "unpaywall_email": "you@example.org"}
```

(type or paste the JSON, then Ctrl-D). Options you leave out keep their values. Inside a session, `/plugin` opens the same options in a form. Restart Claude Code afterwards: a running session keeps the keys it started with.

The name after `@` is the marketplace the plugin was installed from; `claude plugin list` shows it if yours differs.

## Where it is stored

| What | Where | Notes |
|---|---|---|
| Keys and tokens (every option marked *sensitive*) | Claude Code's secure store: the system keychain on macOS, `~/.claude/.credentials.json` (readable by you only, mode 600) elsewhere, under `pluginSecrets` | The same store that holds your Claude login. Never in `settings.json`, never in the plugin folder, never in a project |
| Addresses and tuning (`unpaywall_email`, `compute_session_cap_usd`, ...) | `~/.claude/settings.json`, under `pluginConfigs` | Not secrets |

The values belong to this installed plugin on this machine and this login. They survive updates of the plugin. **Uninstalling the plugin deletes its stored keys**; after a reinstall, save them again. Another computer needs its own.

An option with no value is not written anywhere: it stays listed as "not set" until you give it one.

## How a key reaches a tool

Claude Code hands each saved option to the plugin's tool server as `AH_KEY_<NAME>` when the server starts. The server copies it to `<NAME>` (for example `S2_API_KEY`) only if your shell has not already set `<NAME>`. So:

- **A variable exported in your shell wins** over a saved key, for that session.
- Keys go to the tool that reads them and to the service they belong to, and nowhere else. They are not printed, logged, or written to job records.
- Saved keys belong to the installed plugin. A session that loads a development checkout with `--plugin-dir` may not receive them; export the keys in the shell there.

## Check, change, remove

- **Check:** `/academic doctor` lists the *names* of the keys the server received, never a value. `claude plugin configure ...` shows set or not set for each option.
- **Did it arrive?** Start a session with `AH_KEYS_REPORT=<file>` and the server writes the name, length and a short hash of each key it got.
- **Change:** save the new value the same way; it replaces the old one.
- **Remove:** the command line cannot blank a single key (an empty value means "leave as it is"). Replace it with another value, or uninstall the plugin, which removes all of them. Revoking the key with its provider is what makes it useless.
- **A key shown in a chat is exposed.** If you paste a key into a conversation, it is in that conversation's transcript; rotate it with the provider.

## Connectors (MCP) are separate

Services you connect in Claude Code itself, such as the Consensus, Scite or Firecrawl connectors, sign in with their own OAuth flow and Claude Code keeps those tokens. The plugin never reads them and they cannot be used as the keys below: `consensus_api_key` is a Consensus *API* key, a different credential from a Consensus connector login. You can use both: the connector as its own tools, the key as a source inside `literature_search`.

## Every key

Option names are lower case; the environment variable of the same name in upper case does the same from the shell.

### Literature search and papers

| Option | Unlocks |
|---|---|
| `s2_api_key` | Semantic Scholar: a dedicated rate limit (the plugin stays at one request every two seconds, under the key's one per second). **Worth setting first** |
| `openalex_api_key` | OpenAlex: higher limits |
| `unpaywall_email` | Open-access PDFs for `paper_download` (an address, not a secret). **Worth setting first** |
| `crossref_mailto` | Crossref's faster, steadier pool (an address). **Worth setting first** |
| `ncbi_api_key`, `ncbi_email` | PubMed: a higher rate limit, and the contact address NCBI asks for |
| `core_api_key` | CORE search and full texts |
| `consensus_api_key` | `consensus` as a source of `literature_search` |
| `scite_api_key` | `scite` as a source of `literature_search` |
| `firecrawl_api_key` | `firecrawl` as a source of `literature_search` |
| `parallel_api_key` | `parallel` as a source of `literature_search` |
| `jina_api_key` | `jina_read`: higher limits for reading pages and PDFs |
| `typesafe_api_key` | Routing a query to the right sources, reranking results, and choosing the model for each prompt ([the model router](model-router.md)) |
| `cohere_api_key` | Reranking with Cohere |
| `futurehouse_api_key` | The FutureHouse research agents |

### Publishers and indexes (usually through an institution)

| Option | Unlocks |
|---|---|
| `scopus_api_key`, `elsevier_insttoken` | Scopus search, Elsevier full text |
| `wos_api_key` | Web of Science |
| `springer_api_key` | Springer Nature search and full text |
| `ieee_api_key` | IEEE Xplore |
| `wiley_tdm_token` | Wiley full text (text and data mining) |
| `ads_api_token` | NASA ADS (astrophysics) |

### Data, policy and people

| Option | Unlocks |
|---|---|
| `datacite_api_key`, `zenodo_api_key`, `figshare_api_key` | Dataset search; Zenodo also for publishing a reproduction package |
| `osf_token` | Preregistration on the Open Science Framework |
| `orcid_token` | Author lookup through ORCID |
| `sherpa_romero_api_key` | Journal and funder open-access policies |
| `openfda_api_key` | openFDA: a higher rate limit |
| `patentsview_api_key` | Patent search |
| `github_token` | `repo_audit`: a higher GitHub rate limit, and private repositories |

### Images and rented compute

| Option | Unlocks |
|---|---|
| `gemini_api_key` | `image_generate`, and embeddings for the co-scientist |
| `image_api_key` | `image_generate` through an OpenAI-compatible Images API instead (`IMAGE_PROVIDER=openai`) |
| `modal_token_id`, `modal_token_secret` | `modal_run` |
| `runpod_api_key` | `runpod_run` |
| `vast_api_key` | `vastai_run` |

Rented compute asks before every run and is capped by `compute_session_cap_usd`; see [State and privacy](state-and-privacy.md).

### Tools that are off until you bring them back

These general web-search tools are left out because Claude Code searches the web itself. Their keys can be saved ahead of time; the tool appears when its name is in `restore_tools` ([Settings](settings.md)).

| Option | Tool |
|---|---|
| `brave_api_key` | `brave_search` |
| `tavily_api_key` | `tavily_search` |
| `exa_api_key` | `exa_search` |
| `perplexity_api_key` | `perplexity_search` |
| `elicit_api_key` | `elicit_search` |

## For people changing the plugin

A key gets a place here by being a plugin option, and in no other way. The options are generated (`scripts/build-manifest.mjs`) from the engine's own list of settings plus `EXTRA_KEY_FIELDS` in `server/src/fit.mjs`, for a credential a tool reads that the list does not name. A tool that needs a new credential adds its variable there; never a file of its own, and never a default value in the repository. A test fails if an option is missing from this page.

Next: [State and privacy](state-and-privacy.md).
