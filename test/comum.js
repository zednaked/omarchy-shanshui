// O que os testes dividem: um $HOME descartavel e rodar o gerar.js nele.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const GERAR = path.join(__dirname, "..", "gerar.js");

function homeTemporario() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shanshui-teste-"));
}

function gerar(home, args, opts) {
  return spawnSync(process.execPath, [GERAR].concat(args), Object.assign({
    env: { PATH: "/usr/bin:/bin", HOME: home },
    maxBuffer: 256 * 1024 * 1024,
  }, opts || {}));
}

let falhas = 0;
function confere(ok, oque) {
  console.log((ok ? "  ok   " : "  FALHA ") + oque);
  if (!ok) falhas++;
}
function fim(nome) {
  console.log(falhas ? `${nome}: ${falhas} falha(s)` : `${nome}: tudo certo`);
  process.exit(falhas ? 1 : 0);
}

module.exports = { GERAR, homeTemporario, gerar, confere, fim };
