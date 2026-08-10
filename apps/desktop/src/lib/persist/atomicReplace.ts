interface ReplaceOps {
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

function previousPath(target: string): string {
  return `${target}.previous`;
}

/** Restores or cleans up a Windows fallback interrupted by process exit. */
export async function recoverInterruptedReplacement(
  target: string,
  ops: ReplaceOps,
): Promise<void> {
  const previous = previousPath(target);
  if (!(await ops.exists(previous))) return;
  if (await ops.exists(target)) {
    await ops.remove(previous);
  } else {
    await ops.rename(previous, target);
  }
}

/**
 * Installs a prepared sibling file over an existing target. Unix rename
 * replaces directly; the Windows fallback moves the old destination to a
 * deterministic recovery sibling until the new file is installed.
 */
export async function installReplacement(
  tmp: string,
  target: string,
  ops: ReplaceOps,
  windowsReplace = false,
): Promise<void> {
  if (windowsReplace) await recoverInterruptedReplacement(target, ops);
  try {
    await ops.rename(tmp, target);
  } catch (error) {
    if (!windowsReplace || !(await ops.exists(target))) throw error;
    const previous = previousPath(target);
    await ops.rename(target, previous);
    try {
      await ops.rename(tmp, target);
    } catch (installError) {
      try {
        if (!(await ops.exists(target)) && await ops.exists(previous)) {
          await ops.rename(previous, target);
        }
      } catch {
        // The recoverable previous file remains for the next read/startup.
      }
      throw installError;
    }
    try {
      await ops.remove(previous);
    } catch {
      // The installed target is authoritative; the next access cleans this.
    }
  }
}

export function isWindowsWebView(): boolean {
  return typeof navigator !== "undefined" &&
    /Windows/i.test(navigator.userAgent);
}
