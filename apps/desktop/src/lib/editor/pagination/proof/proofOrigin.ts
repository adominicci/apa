export interface ProofOriginReadinessOptions {
  timeoutMs: number;
  retryIntervalMs: number;
}

export interface ProofOriginReadiness {
  url: string;
  attempts: number;
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" ||
      url.hostname === "[::1]");
}

export async function waitForProofOrigin(
  url: URL,
  options: ProofOriginReadinessOptions,
): Promise<ProofOriginReadiness> {
  if (!isLoopback(url)) {
    throw new Error(`Native proof URL must use a loopback HTTP origin: ${url}`);
  }
  const deadline = performance.now() + options.timeoutMs;
  let attempts = 0;
  let lastFailure = "no response";

  while (performance.now() < deadline) {
    attempts += 1;
    const remaining = Math.max(1, deadline - performance.now());
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(remaining, 1_000)),
      });
      if (response.ok) return { url: url.href, attempts };
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    const delay = Math.min(
      options.retryIntervalMs,
      Math.max(0, deadline - performance.now()),
    );
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(
    `Native proof origin was not ready after ${attempts} attempts: ${lastFailure}`,
  );
}
