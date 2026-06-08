import { assertNoSecretLikeValues, detectSecretLikeValues } from "@tracegate/core";

const rawTraceLikePayload = {
  tool: "submitOrder",
  input: {
    apiKey: "sk-proj-1234567890abcdef1234567890abcdef",
    authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
  },
};

const redactedTraceLikePayload = {
  tool: "submitOrder",
  input: {
    apiKey: "[REDACTED]",
    authorization: "<hidden>",
  },
};

const rawFindings = detectSecretLikeValues(rawTraceLikePayload);
if (rawFindings.length === 0) {
  throw new Error("Expected raw secret fixture to fail detection.");
}

assertNoSecretLikeValues(redactedTraceLikePayload, {
  ignoreRedactionPlaceholders: true,
  redactionPlaceholders: ["<hidden>"],
});

console.log(
  JSON.stringify(
    {
      rawSecretFails: rawFindings.length > 0,
      redactedPlaceholderPasses: true,
      rawFindingPaths: rawFindings.map((finding) => finding.path),
    },
    null,
    2,
  ),
);
