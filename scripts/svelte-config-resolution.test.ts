import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const decoder = new TextDecoder();
const root = fileURLToPath(new URL("../", import.meta.url));
const svelteConfigSource = await Deno.readTextFile(
  `${root}apps/desktop/svelte.config.js`,
);
const desktopPackage = JSON.parse(
  await Deno.readTextFile(`${root}apps/desktop/package.json`),
) as { devDependencies: Record<string, string> };
const configDependencies = [
  "@sveltejs/adapter-static",
  "@sveltejs/vite-plugin-svelte",
] as const;

async function loadConfigOutsideWorkspace(): Promise<{
  code: number;
  stderr: string;
}> {
  const directory = await Deno.makeTempDir({
    prefix: "tesina-svelte-config-resolution-",
  });
  const configPath = `${directory}/svelte.config.js`;

  try {
    await Deno.writeTextFile(configPath, svelteConfigSource);

    const configUrl = pathToFileURL(configPath).href;
    const probe = `const config = (await import(${
      JSON.stringify(configUrl)
    })).default;
if (!config?.preprocess || !config?.kit?.adapter) {
  throw new Error("Svelte config did not load its preprocess and adapter");
}`;
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        "--cached-only",
        "--config",
        `${root}deno.json`,
        "--lock",
        `${root}deno.lock`,
        probe,
      ],
      cwd: directory,
      stdout: "piped",
      stderr: "piped",
    }).output();

    return {
      code: output.code,
      stderr: decoder.decode(output.stderr),
    };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

describe("Svelte config dependency resolution", () => {
  it("keeps explicit npm imports aligned with both declared dependencies", () => {
    for (const dependency of configDependencies) {
      const declaredVersion = desktopPackage.devDependencies[dependency];

      expect(svelteConfigSource).toContain(
        `npm:${dependency}@${declaredVersion}`,
      );
    }
  });

  it("loads both real dependencies without workspace or import-map lookup", async () => {
    const result = await loadConfigOutsideWorkspace();

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });
});
