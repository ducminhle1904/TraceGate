import { TraceGateRuntimeError } from "@tracegate/core";

export function formatRunCaseError(error: unknown): string {
  if (error instanceof TraceGateRuntimeError) {
    const parts = [error.message];
    if (error.toolName) {
      parts.push(`tool=${error.toolName}`);
    }
    if (error.verdict) {
      parts.push(`verdict=${error.verdict.status}`);
    }
    if (error.cause !== undefined) {
      parts.push(`cause=${getErrorMessage(error.cause)}`);
    }
    return parts.join(" ");
  }

  return getErrorMessage(error);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
