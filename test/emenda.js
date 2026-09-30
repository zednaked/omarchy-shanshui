// Duas faixas vizinhas, lado a lado, tem que ser a mesma imagem que uma vista
// so do mesmo trecho: e isso que deixa o rolo sem emenda. Compara pixel a
// pixel (ImageMagick, que o Omarchy ja traz), em tres sementes.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { homeTemporario, gerar, confere, fim } = require("./comum");

const W = 640, H = 360, V = (700 * W) / H;
const dir = homeTemporario();

for (const seed of ["7", "42", "1790809173301"]) {
  const png = (x, w, nome) => {
    const r = gerar(dir, ["png", "--seed", seed, "--x", String(x), "--w", String(w), "--h", String(H)]);
    fs.writeFileSync(path.join(dir, nome), r.stdout);
    return r.status === 0;
  };
  const ok = png(0, W, "a.png") && png(V, W, "b.png") && png(0, 2 * W, "larga.png");
  spawnSync("magick", [path.join(dir, "a.png"), path.join(dir, "b.png"), "+append", path.join(dir, "par.png")]);
  const c = spawnSync("magick", ["compare", "-metric", "AE", "-fuzz", "2%",
    path.join(dir, "par.png"), path.join(dir, "larga.png"), "null:"]);
  const diferentes = parseFloat(String(c.stderr));
  confere(ok && diferentes === 0, `semente ${seed}: ${isNaN(diferentes) ? "?" : diferentes} pixels diferentes na emenda`);
}

fs.rmSync(dir, { recursive: true, force: true });
fim("emenda");
