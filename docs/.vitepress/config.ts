import { defineConfig } from "vitepress";

export default defineConfig({
  title: "TraceGate",
  description: "Contract, replay, and policy harness for tool-using AI agents.",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guides/getting-started" },
      { text: "Reference", link: "/reference/core-contracts" },
      { text: "Examples", link: "/guides/framework-adapters" },
      { text: "GitHub", link: "https://github.com/ducminhle1904/TraceGate" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Overview", link: "/" },
          { text: "Getting Started", link: "/guides/getting-started" },
          { text: "CI", link: "/guides/ci" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Harness Engineering", link: "/concepts/harness-engineering" },
          { text: "Tool-Call Contracts", link: "/concepts/tool-call-contracts" },
          { text: "Replay", link: "/concepts/replay" },
          { text: "Side-Effect Boundaries", link: "/concepts/side-effect-boundaries" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Policy Cookbook", link: "/guides/policy-cookbook" },
          { text: "Redaction", link: "/guides/redaction" },
          { text: "Runtime Integration", link: "/guides/runtime-integration" },
          { text: "Framework Adapters", link: "/guides/framework-adapters" },
          { text: "Agent Stack Templates", link: "/guides/agent-stack-templates" },
          { text: "Release Checklist", link: "/guides/release-checklist" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Core Contracts", link: "/reference/core-contracts" },
          { text: "Configuration", link: "/reference/configuration" },
          { text: "Matrix File", link: "/reference/matrix-file" },
          { text: "Replay Fixtures", link: "/reference/replay-fixtures" },
          { text: "Runtime Semantics", link: "/reference/runtime-semantics" },
          { text: "Trace Schema", link: "/reference/trace-schema" },
        ],
      },
      {
        text: "Integrations",
        items: [
          { text: "Observability", link: "/integrations/observability" },
          { text: "Comparisons", link: "/comparisons" },
        ],
      },
      {
        text: "Agent Skills",
        items: [
          { text: "Codex", link: "/agent-skills/codex" },
          { text: "Claude Code", link: "/agent-skills/claude-code" },
          { text: "Generate Matrix Cases", link: "/agent-skills/generate-matrix-cases" },
          { text: "Review Policy", link: "/agent-skills/review-policy" },
        ],
      },
    ],
    search: {
      provider: "local",
    },
  },
});
