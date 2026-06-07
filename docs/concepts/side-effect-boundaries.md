# Side-Effect Boundaries

Prompt-only guardrails are not enough for tools that mutate real systems. TraceGate treats side effects as contracts around tool execution.

## Boundary Model

- The agent may decide which tool to call.
- TraceGate validates the tool input contract.
- Policy decides whether the call is allowed, blocked, or needs review.
- The wrapped tool executes only after policy allows it.
- Trace events record the decision, redacted inputs, outputs, and evidence.

## Common Side Effects

- External communication: email, chat, tickets.
- Money movement: refunds, credits, payouts.
- Account changes: roles, credentials, billing state.
- Production writes: database updates, deploys, file edits.
- Privileged shell commands.

## Non-Goals

TraceGate does not replace app authorization, IAM, database permissions, gateway guardrails, or incident response. It gives developers a testable harness around agent tool behavior.
