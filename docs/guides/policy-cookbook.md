# Policy Cookbook

TraceGate policy rules are contract checks around tool execution. They are not a replacement for application authorization, IAM, provider gateway guardrails, or human review for irreversible operations.

## High-Risk Tools

```ts
import { createPolicyEvaluator, definePolicy } from "@tracegate/core";

const policyEvaluator = createPolicyEvaluator(
  definePolicy({
    requireApprovalForRiskTiers: ["high", "critical"],
    requiredEvidence: {
      issueRefund: ["manager"],
      sendEmail: ["approval"],
    },
  }),
);
```

Use this for refunds, external email, production database writes, file edits, shell commands, and deploys.

## Production Overrides

```ts
definePolicy({
  requireApprovalForRiskTiers: ["high"],
  environmentOverrides: {
    production: {
      blockRiskTiers: ["critical"],
      requireApprovalForRiskTiers: ["medium", "high", "critical"],
    },
  },
});
```

Use environment overrides to make production stricter without changing local tests.

## Tool Overrides

```ts
definePolicy({
  requireApprovalForRiskTiers: ["high"],
  toolOverrides: {
    lookupOrder: {
      requireApprovalForRiskTiers: [],
    },
  },
});
```

Tool overrides are the highest-precedence policy layer. Keep them narrow and reviewed.

## Verification

Add matrix cases that require policy verdicts, evidence, and redaction checks:

```ts
{
  id: "blocks-refund-without-approval",
  prompt: "Refund order-1",
  expect: {
    requiredPolicyVerdict: "review",
    forbiddenTools: ["issueRefund"],
    requiredEvidence: ["manager"],
  },
}
```
