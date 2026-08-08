/**
 * Maps the stable backup-directory error codes (Rust adapter + BackupStore)
 * onto localized user-facing messages. Archive-validation failures reuse
 * `describeArchiveError`. UI-locale axis.
 */

import { m } from "$lib/paraglide/messages";
import {
  archiveErrorCode,
  describeArchiveError,
} from "./archiveErrorMessage.ts";

export function describeBackupError(error: unknown): string {
  const code = archiveErrorCode(error);
  switch (code) {
    case "folder_unavailable":
      return m.bk_err_folder_unavailable();
    case "inside_app_data":
      return m.bk_err_inside_app_data();
    case "symlink_rejected":
      return m.bk_err_symlink();
    case "name_taken":
      return m.bk_err_name_taken();
    case "not_configured":
    case "pending_missing":
      return m.bk_err_not_configured();
    case "io":
    case "hash_mismatch":
    case "invalid_file_name":
    case "backup_failed":
      return m.bk_err_io();
    default:
      break;
  }
  // Packaging/validation failures carry archive-family codes.
  if (code.includes("/")) return describeArchiveError(error);
  return m.bk_err_generic({ code });
}
