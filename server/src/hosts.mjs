// The network hosts the plugin reaches: what `network.hosts` in plugin.json says (scripts/build-manifest.mjs writes it from here).
//
// Claude Code shows the list to anyone who installs the plugin, and the plugin directory asks for it. It is the author's word, not a limit: nothing
// here allows or blocks a host. So it has to be right, and tests/scripts/hosts.test.mjs keeps it right: it reads every host written in the
// plugin's runtime code (the tools, the server, the hooks, PaperMemory, the writing engine) and fails when one is neither here nor in NOT_REACHED,
// and when a host here is no longer written anywhere.
//
// Claude Code itself, and the headless `claude -p` the model route starts, reach Anthropic; that is Claude Code's own network use and is not listed.

/** Scholarly metadata, full text and identifiers (literature_search and the paper tools, PaperMemory). */
export const SCHOLARLY = [
  'aclanthology.org',
  'api.adsabs.harvard.edu',
  'api.biorxiv.org',
  'api.clarivate.com',
  'api.core.ac.uk',
  'api.crossref.org',
  'api.datacite.org',
  'api.elsevier.com',
  'api.figshare.com',
  'api.openalex.org',
  'api.opencitations.net',
  'api.ror.org',
  'api.scite.ai',
  'api.semanticscholar.org',
  'api.springernature.com',
  'api.unpaywall.org',
  'api.wiley.com',
  'api2.openreview.net',
  'arxiv.org',
  'core.ac.uk',
  'doaj.org',
  'doi.org',
  'elicit.com',
  'europepmc.org',
  'eutils.ncbi.nlm.nih.gov',
  'export.arxiv.org',
  'ieeexploreapi.ieee.org',
  'inspirehep.net',
  'openreview.net',
  'pub.orcid.org',
  'pubmed.ncbi.nlm.nih.gov',
  'query.wikidata.org',
  'v2.sherpa.ac.uk',
  'www.biorxiv.org',
  'www.ebi.ac.uk',
  'www.medrxiv.org',
  'www.ncbi.nlm.nih.gov',
  'www.wikidata.org',
  'zenodo.org',
]

/** Trial, drug, grant and patent registries. */
export const REGISTRIES = [
  'api.fda.gov',
  'api.grants.gov',
  'api.nsf.gov',
  'api.reporter.nih.gov',
  'clinicaltrials.gov',
  'reporter.nih.gov',
  'search.patentsview.org',
  'www.grants.gov',
  'www.nsf.gov',
]

/** Structure and molecule databases (science_source, structure_toolkit). */
export const SCIENCE_DATA = [
  'alphafold.ebi.ac.uk',
  'data.rcsb.org',
  'files.rcsb.org',
  'pubchem.ncbi.nlm.nih.gov',
  'rest.uniprot.org',
  'search.rcsb.org',
  'www.rcsb.org',
  'www.uniprot.org',
]

/** The search and fetch providers (each only with its key set): web_search, web_extract, the provider tools and the literature_search sources. */
export const WEB_PROVIDERS = [
  'api.consensus.app',
  'api.exa.ai',
  'api.firecrawl.dev',
  'api.parallel.ai',
  'api.perplexity.ai',
  'api.platform.edisonscientific.com',
  'api.search.brave.com',
  'api.tavily.com',
  'mcp.firecrawl.dev',
  'r.jina.ai',
  's.jina.ai',
]

/** Model services other than Claude (each only with its key): reranking, embeddings and images, and the model router's Jev. */
export const MODELS = [
  'api.cohere.com',
  'api.openai.com',
  'api.typesafe.ai',
  'generativelanguage.googleapis.com',
]

/** Rented compute (modal_run, runpod_run, vastai_run), and only after an approval. */
export const COMPUTE = [
  'api.runpod.io',
  'cloud.vast.ai',
  'console.runpod.io',
  'console.vast.ai',
  'modal.com',
  'rest.runpod.io',
]

/** repo_audit, and the installer's downloads. */
export const DEVELOPER = [
  'api.github.com',
  'github.com',
]

/** What the first start installs: npm packages, Python packages and the Python builds uv fetches. */
export const INSTALL = [
  'files.pythonhosted.org',
  'objects.githubusercontent.com',
  'pypi.org',
  'registry.npmjs.org',
]

/** The declared list: every group, sorted, each host once. */
export const NETWORK_HOSTS = [...new Set([...SCHOLARLY, ...REGISTRIES, ...SCIENCE_DATA, ...WEB_PROVIDERS, ...MODELS, ...COMPUTE, ...DEVELOPER, ...INSTALL])].sort()

/** Hosts the code writes that are never contacted (a link made for the person to open, a namespace, a comment), and why. */
export const NOT_REACHED = {

  '127.0.0.1': 'loopback: a local server the tool starts itself',
  'aclrollingreview.org': 'a reference in a comment',
  'creativecommons.org': 'licence names in text',
  'deepreview.googleapis.com': 'a reference in a comment (the API shape the vendored viewer follows); nothing calls it',
  'docs.astral.sh': 'a link in the doctor\'s advice',
  'docs.consensus.app': 'a link in a comment',
  'docs.scite.ai': 'a link in a comment',
  'ega-archive.org': 'a link built for the person to open',
  'graphml.graphdrawing.org': 'an XML namespace',
  'massive.ucsd.edu': 'a link built for the person to open',
  'openalex.org': 'an identifier prefix that is cut off, never fetched',
  'opencode.ai': 'a $schema string in a config the verifier writes',
  'orcid.org': 'a link built for the person to open (the API host is pub.orcid.org)',
  'patents.google.com': 'a link built for the person to open',
  'pubpeer.com': 'a link for the person to open (PubPeer has no API)',
  'purl.org': 'an XML namespace',
  'ui.adsabs.harvard.edu': 'a link built for the person to open',
  'w3id.org': 'a JSON-LD context identifier',
  'www.w3.org': 'an XML namespace',
  'www.webofscience.com': 'a link built for the person to open',

}
