const [mode, directory = "apps/desktop/build"] = Deno.args;
if (mode !== "production" && mode !== "proof") {
  throw new Error(
    "usage: verify-spelling-experience-containment.ts production|proof [directory]",
  );
}

let output = "";
const pending = [directory];
while (pending.length > 0) {
  const current = pending.pop()!;
  for await (const entry of Deno.readDir(current)) {
    const path = `${current}/${entry.name}`;
    if (entry.isDirectory) pending.push(path);
    else if (/\.(?:js|css|html)$/.test(entry.name)) {
      output += await Deno.readTextFile(path);
    }
  }
}

const markers = [
  "data-spelling-experience-proof",
  "tesina-spelling-issue",
  "spelling_capability",
  "spelling_check",
  "Spelling suggestions",
];
const present = markers.filter((marker) => output.includes(marker));
if (mode === "production" && present.length > 0) {
  throw new Error(
    `production bundle contains spelling proof markers: ${present.join(", ")}`,
  );
}
if (mode === "proof" && present.length !== markers.length) {
  throw new Error(
    `proof bundle is missing markers: ${
      markers.filter((marker) => !present.includes(marker)).join(", ")
    }`,
  );
}
console.log(
  `${mode} spelling-experience containment passed (${output.length} text bytes)`,
);
