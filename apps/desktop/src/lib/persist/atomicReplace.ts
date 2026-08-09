interface ReplaceOps {
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/**
 * Installs a prepared sibling file over an existing target. Unix rename
 * replaces directly; Windows requires the existing destination removed
 * first. Callers must provide an independently recoverable write protocol
 * when using the Windows fallback.
 */
export async function installReplacement(
  tmp: string,
  target: string,
  ops: ReplaceOps,
  windowsReplace = false,
): Promise<void> {
  try {
    await ops.rename(tmp, target);
  } catch (error) {
    if (!windowsReplace || !(await ops.exists(target))) throw error;
    await ops.remove(target);
    await ops.rename(tmp, target);
  }
}

export function isWindowsWebView(): boolean {
  return typeof navigator !== "undefined" &&
    /Windows/i.test(navigator.userAgent);
}
