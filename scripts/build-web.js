// Construit dist/ à partir de src/ (page complète + polices embarquées hors ligne)
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), src = path.join(root, "src"), dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "fonts"), { recursive: true });
const body = fs.readFileSync(path.join(src, "index.html"), "utf8")
  .replace(/<link rel="preconnect"[^>]*>\n?/, "")
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis[^>]*>\n?/, "");
const [head, rest] = body.split('<div id="app"');
fs.writeFileSync(path.join(dist, "index.html"), `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}</head>
<body>
<div id="app"${rest}
</body>
</html>
`);
fs.copyFileSync(path.join(src, "app.js"), path.join(dist, "app.js"));
const nm = path.join(root, "node_modules");
const fonts = [
  ["@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2", "space-grotesk.woff2"],
  ["@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "inter.woff2"]
];
for (const [from, to] of fonts) {
  const f = path.join(nm, from);
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dist, "fonts", to));
  else console.warn("Police absente :", from);
}
console.log("dist/ prêt");
