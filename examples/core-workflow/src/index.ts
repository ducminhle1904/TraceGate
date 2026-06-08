import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHarness,
  createJsonlFileTraceSink,
  createPolicyEvaluator,
  definePolicy,
  defineToolContract,
} from "@tracegate/core";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const tracePath = join(here, "..", "traces", "core-workflow.jsonl");

const lookupPolicy = defineToolContract({
  name: "lookupPolicy",
  riskTier: "read",
  inputSchema: z.object({
    topic: z.string(),
  }),
});

const sendNotification = defineToolContract({
  name: "sendNotification",
  riskTier: "high",
  requiresApproval: true,
  inputSchema: z.object({
    email: z.string().email(),
    message: z.string(),
    apiKey: z.string(),
  }),
});

await rm(tracePath, { force: true });
await mkdir(dirname(tracePath), { recursive: true });

const harness = createHarness({
  traceSink: createJsonlFileTraceSink(tracePath),
  approvalHandler: () => "denied",
  policyEvaluator: createPolicyEvaluator(
    definePolicy({
      requireApprovalForRiskTiers: ["high", "critical"],
    }),
  ),
});

const readPolicy = harness.wrapTool(lookupPolicy, async (input) => ({
  topic: input.topic,
  result: "Notification requires approval before execution.",
}));
let sideEffectExecutions = 0;
const notify = harness.wrapTool(sendNotification, async () => {
  sideEffectExecutions += 1;
  return { sent: true };
});

const policy = await readPolicy({ topic: "notification approvals" });
let validationBlocked = false;
try {
  await notify({ email: "not-email", message: "Invalid input should fail first" } as never);
} catch {
  validationBlocked = true;
}
let blocked = false;
try {
  await notify({
    email: "customer@example.com",
    message: "A risky side effect should not execute without approval.",
    apiKey: "sk-proj-1234567890abcdef1234567890abcdef",
  });
} catch {
  blocked = true;
}
await harness.finishRun(blocked ? "blocked" : "succeeded");

const trace = await readFile(tracePath, "utf8");
const events = trace
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { type: string });

console.log(
  JSON.stringify(
    {
      policy: policy.result,
      blocked,
      validationBlocked,
      sideEffectExecutions,
      sideEffectPrevented: blocked && sideEffectExecutions === 0,
      tracePath,
      events: events.map((event) => event.type),
      redacted: !trace.includes("sk-proj-1234567890abcdef1234567890abcdef"),
    },
    null,
    2,
  ),
);
