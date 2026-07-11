import { fetch } from "@tauri-apps/plugin-http";
import type { Reference } from "@tesina/engine";
import { type CrossrefWork, mapCrossrefWork } from "./crossref.ts";
import { mapOpenLibraryBook, type OpenLibraryBook } from "./openlibrary.ts";

export type AutofillError = "offline" | "not-found" | "unsupported" | "parse";

export type AutofillResult =
  | { ok: true; ref: Reference }
  | { ok: false; error: AutofillError };

const TIMEOUT_MS = 10_000;
// TODO: add a mailto/URL for CrossRef's polite pool once the repo is public.
// Deliberately no personal data in the UA string.
const USER_AGENT = "Tesina/0.1 (academic writing app)";

/** Goes through the Tauri http plugin (Rust reqwest) — no webview CORS. */
async function getJson(url: string): Promise<
  { ok: true; body: unknown } | { ok: false; error: AutofillError }
> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "offline" };
  }
  if (res.status === 404 || res.status === 410) {
    return { ok: false, error: "not-found" };
  }
  if (!res.ok) return { ok: false, error: "offline" };
  try {
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, error: "parse" };
  }
}

export async function lookupDoi(doi: string): Promise<AutofillResult> {
  const res = await getJson(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
  );
  if (!res.ok) return res;
  const message = (res.body as { message?: CrossrefWork }).message;
  if (!message) return { ok: false, error: "parse" };
  const ref = mapCrossrefWork(message, crypto.randomUUID());
  return ref ? { ok: true, ref } : { ok: false, error: "unsupported" };
}

interface OpenLibraryIsbnResponse extends OpenLibraryBook {
  authors?: { key?: string }[];
}

export async function lookupIsbn(isbn: string): Promise<AutofillResult> {
  const res = await getJson(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!res.ok) return res;
  const data = res.body as OpenLibraryIsbnResponse;

  const names: string[] = [];
  for (const author of (data.authors ?? []).slice(0, 5)) {
    if (!author.key) continue;
    const authorRes = await getJson(
      `https://openlibrary.org${author.key}.json`,
    );
    if (authorRes.ok) {
      const info = authorRes.body as {
        name?: string;
        personal_name?: string;
      };
      const name = info.name ?? info.personal_name;
      if (name) names.push(name);
    }
  }

  const ref = mapOpenLibraryBook(data, names, crypto.randomUUID());
  return ref ? { ok: true, ref } : { ok: false, error: "parse" };
}
