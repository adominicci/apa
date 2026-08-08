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

async function loadConfigOutsideWorkspace(): Promise<{
  code: number;
  stderr: string;
}> {
  const directory = await Deno.makeTempDir({
    prefix: "tesina-svelte-config-resolution-",
  });
  const configPath = `${directory}/svelte.config.js`;
  const adapterPath = `${directory}/adapter.js`;
  const importMapPath = `${directory}/import-map.json`;

  try {
    await Deno.writeTextFile(configPath, svelteConfigSource);
    await Deno.writeTextFile(
      adapterPath,
      `export default function adapter() {
  return { name: "test-adapter", adapt() {} };
}
`,
    );
    await Deno.writeTextFile(
      importMapPath,
      JSON.stringify({
        imports: {
          "@sveltejs/adapter-static": pathToFileURL(adapterPath).href,
        },
      }),
    );

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
        "--import-map",
        importMapPath,
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
  it("keeps the explicit npm import aligned with the declared dependency", () => {
    const declaredVersion =
      desktopPackage.devDependencies["@sveltejs/vite-plugin-svelte"];

    expect(svelteConfigSource).toContain(
      `npm:@sveltejs/vite-plugin-svelte@${declaredVersion}`,
    );
  });

  it("loads without relying on workspace bare-import lookup", async () => {
    const result = await loadConfigOutsideWorkspace();

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });
});
