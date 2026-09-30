// A mesma faixa (semente, k, tamanho) sai identica em duas maquinas - aqui,
// dois $HOME - e a segunda chamada reaproveita sem desenhar de novo.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { homeTemporario, gerar, confere, fim } = require("./comum");

const hash = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const args = ["--seed", "42", "--k", "3", "--w", "640", "--h", "360"];
const nomes = ["q_42_3_640x360.png", "o_42_3_640x360.png"];

const h1 = homeTemporario(), h2 = homeTemporario();
const r1 = gerar(h1, ["faixa", "--dir", path.join(h1, ".cache/zed.shanshui")].concat(args));
const r2 = gerar(h2, ["faixa", "--dir", path.join(h2, ".cache/zed.shanshui")].concat(args));
confere(r1.status === 0 && r2.status === 0, "as duas geracoes terminam");
for (const n of nomes) {
  confere(hash(path.join(h1, ".cache/zed.shanshui", n)) === hash(path.join(h2, ".cache/zed.shanshui", n)), n + " identico nos dois");
}
const t0 = Date.now();
const r3 = gerar(h1, ["faixa", "--dir", path.join(h1, ".cache/zed.shanshui")].concat(args));
confere(r3.status === 0 && Date.now() - t0 < 1000, "a segunda vez reaproveita (" + (Date.now() - t0) + " ms)");

for (const h of [h1, h2]) fs.rmSync(h, { recursive: true, force: true });
fim("determinismo");
