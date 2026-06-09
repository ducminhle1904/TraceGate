# Human Approval

TraceGate treats human approval as a runtime decision at the tool boundary. Your app owns the
approval request, storage, UI, approver identity, and audit trail. TraceGate records the resulting
approval state in policy diagnostics and replay fixtures.

## Approval Handler Pattern

```ts
import { createRuntimeGate } from "@tracegate/core";

const gate = createRuntimeGate({
  mode: "enforce",
  context: {
    sessionId,
    userId,
    metadata: {
      approvalRequestId,
      policyDecisionId,
    },
  },
  approvalHandler: async ({ contract, input, verdict }) => {
    const request = await approvalStore.create({
      toolName: contract.name,
      riskTier: contract.riskTier,
      input,
      reasons: verdict.reasons,
    });

    const decision = await approvalStore.waitForDecision(request.id);
    if (decision.status === "approved") {
      return { status: "approved", reason: decision.reason, metadata: { requestId: request.id } };
    }
    if (decision.status === "denied") {
      return { status: "denied", reason: decision.reason, metadata: { requestId: request.id } };
    }
    return { status: "missing", reason: "No approval decision was available." };
  },
});
```

## Replay Cases To Keep

Keep runtime replay fixtures for the approval lifecycle:

- review required: policy returns `review` before a human decision exists
- approval approved: final verdict becomes `allow` and the handler executes
- approval denied: final verdict becomes `block` and the handler does not execute
- missing handler: final verdict remains review-required and the handler does not execute

For denied approval, diagnostics should make the transition explicit:

```json
[
  "policy:approval-denied",
  "approval-handler:approval-denied",
  "runtime:execution-skipped"
]
```

## Boundaries

TraceGate does not replace your approval database, identity provider, authorization model, broker
permission checks, or business workflow. Store approval IDs in `context.metadata` so runtime
summaries, logs, and replay fixtures can be joined back to your app-owned audit trail.
