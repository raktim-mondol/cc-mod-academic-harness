---
name: using-science-superpowers
description: "Use when a research task begins (an analysis, a paper, a review, a literature search, a result that looks wrong) to find the skill that fits it and load it before acting. Not for greetings, one-line factual questions or edits the person fully specified."
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

When a task matches a skill's description, load that skill with the `Skill` tool before you act on the task, without waiting to be asked: the person will not name skills. If nothing matches, or the message is a greeting, a one-line factual question or a small edit that is fully specified, answer it directly. Do not load a skill "to be safe".

## Instruction Priority

Science Superpowers skills override default system prompt behavior, but **your human partner's instructions always take precedence**:

1. **Your human partner's explicit instructions** (CLAUDE.md, GEMINI.md, AGENTS.md, direct requests) — highest priority
2. **Science Superpowers skills** — override default system behavior where they conflict
3. **Default system prompt** — lowest priority

If CLAUDE.md, GEMINI.md, or AGENTS.md says "skip pre-registration" and a skill says "always pre-register," follow your human partner's instructions. They are in control.

## How to Access Skills

**In Claude Code:** Use the `Skill` tool. When you invoke a skill, its content is loaded and presented to you—follow it directly. Never use the Read tool on skill files.

**In Copilot CLI:** Use the `skill` tool. Skills are auto-discovered from installed plugins. The `skill` tool works the same as Claude Code's `Skill` tool.

**In Gemini CLI:** Skills activate via the `activate_skill` tool. Gemini loads skill metadata at session start and activates the full content on demand.

**In Google Antigravity:** Skills are Antigravity Agent Skills (same `SKILL.md` format). Antigravity equips a skill automatically when your request matches its `description`. The always-on bootstrap rule keeps the discipline active from the first message, before any skill is equipped. See `references/antigravity-tools.md`.

**In Pi:** Skills are discovered natively (same `SKILL.md` format) and listed in your system prompt; when a task matches, `read` the skill's `SKILL.md` and follow it. Pi also exposes each skill as a `/skill:name` command. The bootstrap extension keeps the discipline active from the first message. Pi ships without sub-agents and a to-do tool — see `references/pi-tools.md`.

**In other environments:** Check your platform's documentation for how skills are loaded.

## Platform Adaptation

Skills use Claude Code tool names. Non-CC platforms: see `references/copilot-tools.md` (Copilot CLI), `references/codex-tools.md` (Codex), `references/antigravity-tools.md` (Google Antigravity), `references/pi-tools.md` (Pi) for tool equivalents. Gemini CLI users get the tool mapping loaded automatically via GEMINI.md.

# Using Skills

## The Rule

**Load the skill that fits the task before you act on it.** Decide from the skill descriptions you can see; if one clearly covers what you are about to do, load it. If a loaded skill turns out to be wrong for the situation, drop it.

```dot
digraph skill_flow {
    "User message received" [shape=doublecircle];
    "About to investigate/analyze?" [shape=doublecircle];
    "Already framed the question?" [shape=diamond];
    "Invoke framing-research-questions skill" [shape=box];
    "Might any skill apply?" [shape=diamond];
    "Invoke Skill tool" [shape=box];
    "Announce: 'Using [skill] to [purpose]'" [shape=box];
    "Has checklist?" [shape=diamond];
    "Create TodoWrite todo per item" [shape=box];
    "Follow skill exactly" [shape=box];
    "Respond (including clarifications)" [shape=doublecircle];

    "About to investigate/analyze?" -> "Already framed the question?";
    "Already framed the question?" -> "Invoke framing-research-questions skill" [label="no"];
    "Already framed the question?" -> "Might any skill apply?" [label="yes"];
    "Invoke framing-research-questions skill" -> "Might any skill apply?";

    "User message received" -> "Might any skill apply?";
    "Might any skill apply?" -> "Invoke Skill tool" [label="yes, it matches"];
    "Might any skill apply?" -> "Respond (including clarifications)" [label="definitely not"];
    "Invoke Skill tool" -> "Announce: 'Using [skill] to [purpose]'";
    "Announce: 'Using [skill] to [purpose]'" -> "Has checklist?";
    "Has checklist?" -> "Create TodoWrite todo per item" [label="yes"];
    "Has checklist?" -> "Follow skill exactly" [label="no"];
    "Create TodoWrite todo per item" -> "Follow skill exactly";
}
```

## Red Flags

These thoughts, on a research task a skill covers, mean stop and load it:

| Thought | Reality |
|---------|---------|
| "This is just a quick data peek" | A peek can poison a confirmatory analysis. Load the skill that says when looking is safe. |
| "I'll frame the question after I explore" | Framing comes before exploration. |
| "Let me just run the analysis" | The skill says how to run it honestly. |
| "The skill is overkill" | Simple analyses become p-hacked papers. |
| "I remember this skill" | Skills evolve. Read the current version. |

A greeting, a one-line factual answer or a fully specified small edit is not a research task: no skill is needed.

## Skill Priority

When multiple skills could apply, use this order:

1. **Process skills first** (framing-research-questions, investigating-anomalous-results) - these determine HOW to approach the task
2. **Execution skills second** (designing-the-analysis, subagent-driven-analysis) - these guide carrying it out

"Let's investigate X" → framing-research-questions first, then execution skills.
"This result looks wrong" → investigating-anomalous-results first.

**Feasibility mode is the one opt-in branch.** If whether the computation can run at all is unknown, framing-research-questions offers `establishing-feasibility-first`. Only your human partner can choose it, and only they can end it. Never enter or leave that mode on your own initiative — and never enter it to avoid pre-registration.

## Skill Types

**Rigid** (pre-registration, anomaly investigation, verification): Follow exactly. Don't adapt away discipline.

**Flexible** (patterns): Adapt principles to context.

The skill itself tells you which.

## User Instructions

Instructions say WHAT, not HOW. "Analyze X" or "Check whether Y" doesn't mean skip workflows.
