// O que o gerar.js recusa, num $HOME descartavel. Ele e o unico codigo do
// plugin que escreve no disco.
"use strict";
const fs = require("fs");
const path = require("path");
const { homeTemporario, gerar, confere, fim } = require("./comum");

const home = homeTemporario();
const cache = path.join(home, ".cache/zed.shanshui");
const faixa = (dir, extra) => gerar(home, ["faixa", "--dir", dir, "--seed", "1", "--k", "0", "--w", "64", "--h", "64"].concat(extra || []));

// Pasta nova nasce 0700, arquivo nasce 0600.
confere(faixa(cache).status === 0, "gera no lugar certo");
confere((fs.statSync(cache).mode & 0o777) === 0o700, "pasta criada com 0700");
confere((fs.statSync(path.join(cache, "q_1_0_64x64.png")).mode & 0o777) === 0o600, "arquivo criado com 0600");

// Symlink no meio do caminho: recusa e nao escreve do outro lado.
const alvo = path.join(home, "alvo");
fs.mkdirSync(alvo);
fs.symlinkSync(alvo, path.join(home, ".cache/atalho"));
confere(faixa(path.join(home, ".cache/atalho/zed.shanshui")).status !== 0, "symlink no meio do caminho: recusa");
confere(fs.readdirSync(alvo).length === 0, "e nada aparece no destino do link");

// A propria pasta final sendo um link.
fs.symlinkSync(alvo, path.join(home, ".cache/zed.link"));
confere(faixa(path.join(home, ".cache/zed.link")).status !== 0, "pasta final que e link: recusa");

// Fora do $HOME, caminho relativo, e com "..".
confere(gerar(home, ["preparar", "--dir", "/tmp/shanshui-fora"]).status !== 0, "fora do HOME: recusa");
confere(!fs.existsSync("/tmp/shanshui-fora"), "e nao cria nada fora");
confere(gerar(home, ["preparar", "--dir", "relativo/x"]).status !== 0, "caminho relativo: recusa");
confere(gerar(home, ["preparar", "--dir", home + "/.cache/../fora"]).status !== 0, "caminho com '..': recusa");

// O nome do arquivo e montado com numeros; nada de fora entra nele.
confere(faixa(cache, []).status === 0 && gerar(home, ["faixa", "--dir", cache, "--seed", "1/../../x", "--k", "0", "--w", "64", "--h", "64"]).status !== 0, "semente com barra: recusa");
confere(gerar(home, ["faixa", "--dir", cache, "--seed", "1", "--k", "0.5", "--w", "64", "--h", "64"]).status !== 0, "k fracionario: recusa");
confere(gerar(home, ["faixa", "--dir", cache, "--seed", "1", "--k", "0", "--w", "99999", "--h", "64"]).status !== 0, "tamanho absurdo: recusa");

// Um link posto no lugar da faixa e substituido, nao seguido.
const vitima = path.join(home, "vitima.txt");
fs.writeFileSync(vitima, "intacto");
fs.symlinkSync(vitima, path.join(cache, "q_2_0_64x64.png"));
gerar(home, ["faixa", "--dir", cache, "--seed", "2", "--k", "0", "--w", "64", "--h", "64"]);
confere(fs.readFileSync(vitima, "utf8") === "intacto", "link no lugar da faixa: o alvo fica intacto");
confere(!fs.lstatSync(path.join(cache, "q_2_0_64x64.png")).isSymbolicLink(), "e o link vira a faixa");

// Hardlink no lugar da faixa nao e reaproveitado (pode ser de outro arquivo).
fs.linkSync(vitima, path.join(cache, "q_3_0_64x64.png"));
fs.writeFileSync(path.join(cache, "o_3_0_64x64.png"), "x");
gerar(home, ["faixa", "--dir", cache, "--seed", "3", "--k", "0", "--w", "64", "--h", "64"]);
confere(fs.readFileSync(vitima, "utf8") === "intacto", "hardlink no lugar da faixa: o outro nome fica intacto");

// Limpar so apaga o que tem cara de faixa; o resto da pasta fica.
fs.writeFileSync(path.join(cache, "meu.txt"), "meu");
gerar(home, ["limpar", "--dir", cache, "--manter", "q_1_0_64x64.png,o_1_0_64x64.png"]);
const sobrou = fs.readdirSync(cache).sort();
confere(sobrou.join(",") === "meu.txt,o_1_0_64x64.png,q_1_0_64x64.png", "limpar: so faixas fora da lista saem (" + sobrou.join(" ") + ")");
confere(fs.readFileSync(vitima, "utf8") === "intacto", "limpar nao segue link");

// FIFO no lugar da faixa: nao trava (O_NONBLOCK) e a faixa e refeita.
const { spawnSync } = require("child_process");
spawnSync("mkfifo", [path.join(cache, "q_4_0_64x64.png")]);
fs.writeFileSync(path.join(cache, "o_4_0_64x64.png"), "x");
const t0 = Date.now();
const rf = gerar(home, ["faixa", "--dir", cache, "--seed", "4", "--k", "0", "--w", "64", "--h", "64"], { timeout: 30000 });
confere(rf.status === 0 && fs.statSync(path.join(cache, "q_4_0_64x64.png")).isFile(), "FIFO no lugar da faixa: nao trava, e vira a faixa (" + (Date.now() - t0) + " ms)");

// Componente do caminho em que outros podem escrever: recusa.
const aberta = path.join(home, "aberta");
fs.mkdirSync(aberta);
fs.chmodSync(aberta, 0o777);
confere(gerar(home, ["preparar", "--dir", path.join(aberta, "zed.shanshui")]).status !== 0, "pasta com escrita para outros no caminho: recusa");
confere(!fs.existsSync(path.join(aberta, "zed.shanshui")), "e nao cria nada dentro dela");
fs.chmodSync(aberta, 0o770);
confere(gerar(home, ["preparar", "--dir", path.join(aberta, "zed.shanshui")]).status !== 0, "pasta com escrita para o grupo: recusa");

fs.rmSync(home, { recursive: true, force: true });
fim("hostil");
