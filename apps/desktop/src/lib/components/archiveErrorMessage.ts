/**
 * Maps the stable error codes thrown across the portable-archive stack
 * (zip/*, archive/*, validate/*, limits/*, portable/*, import/*,
 * snapshot/*) onto localized user-facing messages. UI-locale axis.
 */

import { m } from "$lib/paraglide/messages";

export function archiveErrorCode(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const withCode = error as { code?: unknown };
    if (typeof withCode.code === "string") return withCode.code;
  }
  return "unknown";
}

export function archiveErrorDetail(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const withDetail = error as { detail?: unknown };
    if (typeof withDetail.detail === "string") return withDetail.detail;
  }
  return "";
}

export function describeArchiveError(error: unknown): string {
  const code = archiveErrorCode(error);
  switch (code) {
    case "archive/manifest-kind":
    case "archive/manifest-missing":
    case "archive/manifest-json":
    case "zip/eocd-missing":
      return m.err_not_tesina();
    case "zip/archive-bytes":
    case "portable/file-too-large":
      return m.err_too_large();
    case "archive/format-version":
      return m.err_future_version();
    case "import/stale-plan":
    case "snapshot/unstable":
      return m.err_stale_plan();
    case "import/recovery-required":
      return m.err_recovery_required();
    case "archive/invalid-source-essay":
    case "archive/invalid-source-library":
    case "archive/missing-source-asset":
      return m.err_source_invalid({ detail: archiveErrorDetail(error) });
    default:
      break;
  }
  const family = code.split("/")[0];
  switch (family) {
    case "zip":
    case "archive":
      return m.err_corrupted();
    case "validate":
    case "limits":
    case "path":
    case "image":
      return m.err_invalid_content();
    case "import":
      return m.err_recovery_required();
    default:
      return m.err_unknown({ code });
  }
}
