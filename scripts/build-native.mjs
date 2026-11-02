// Build a self-contained native web bundle without modifying the PWA.
import { mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const output = join(root, "www");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const name of ["config.js", "admin.js", "charts.js", "manifest.webmanifest"]) {
  await cp(join(root, name), join(output, name));
}
for (const folder of ["audio", "icons"]) {
  await cp(join(root, folder), join(output, folder), { recursive: true });
}
let html = await readFile(join(root, "index.html"), "utf8");

// The native app uses Firebase/APNs, not browser Web Push. Keep the existing
// website untouched and only swap the notification module in the native copy.
html = html.replace(
  /<script\s+type="module"\s+src="\.\/notifications\.js[^"]*"><\/script>/,
  '<script type="module" src="./native-push.bundle.js"></script>'
);
if (!html.includes("native-push.bundle.js") || html.includes('src="./notifications.js')) {
  throw new Error("Could not replace web notifications script in native bundle");
}
// A local file webview must not register a browser service worker.
await writeFile(join(output, "index.html"), html, "utf8");

await build({
  entryPoints: [join(root, "native", "native-push.js")],
  outfile: join(output, "native-push.bundle.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: false,
  legalComments: "none"
});
console.log("Native web bundle ready in www/");
