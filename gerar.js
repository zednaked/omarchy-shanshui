#!/usr/bin/env node
// Gera as faixas do {Shan, Shui}* fora do shell, e cuida da pasta delas.
//
//   node gerar.js faixa --dir <cache> --seed 42 --k 3 --w 2560 --h 1440
//       grava q_<seed>_<k>_<w>x<h>.png (o quadro, em cinza: 0 tinta, 1 papel)
//       e o_<...>.png (o mapa de atraso de cada pixel) em <cache>
//   node gerar.js limpar --dir <cache> --manter q_...png,o_...png
//       apaga as faixas que nao estao na lista
//   node gerar.js preparar --dir <a> --dir <b>
//       cria as pastas do plugin (0700)
//   node gerar.js conferir
//       sai com 0 se o rsvg-convert existe
//   node gerar.js png --seed 42 --x 0 --w 1920 --h 1080 [--ink #hex --paper #hex --grain 1] > vista.png
//       uma vista colorida no stdout (previa, testes); nao grava nada
//
// Quem chama so passa numeros: o nome de cada arquivo e montado aqui. Toda
// pasta e aberta descendo do $HOME componente por componente, sem seguir
// symlink em nenhum ponto, e cada arquivo e escrito num temporario de nome
// aleatorio (O_EXCL | O_NOFOLLOW), com fsync, e renomeado pelo mesmo
// descritor. O Node nao tem openat; /proc/self/fd/N/nome e o equivalente:
// resolve o nome a partir do diretorio ja aberto, e nao do caminho de novo.
//
// A paisagem e infinita em x; cada pedaco de 512 unidades tem a propria
// semente (seed|x0), entao qualquer faixa sai igual sem gerar o que veio antes.
// A altura do mundo e 800 e a vista mostra 700 dela (o zoom 1.142 original).

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_DIRECTORY, O_NONBLOCK, O_CLOEXEC } = fs.constants;

function falhar(msg, codigo) {
  process.stderr.write("gerar.js: " + msg + "\n");
  process.exit(codigo || 1);
}

function lerArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
      if (out[k] === undefined) out[k] = v;
      else out[k] = [].concat(out[k], v);
    } else out._.push(argv[i]);
  }
  return out;
}

function inteiro(v, min, max, nome) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) falhar(`${nome} invalido: ${v}`);
  return n;
}

function semente(v) {
  const s = String(v === undefined ? "" : v);
  if (!/^[0-9]{1,20}$/.test(s)) falhar("semente invalida: " + s);
  return s;
}

// ---- pastas e arquivos, por descritor

const EU = process.getuid();

function noFd(fd, nome) {
  return `/proc/self/fd/${fd}/${nome}`;
}

// Abre `abs` descendo do $HOME. Cada componente: O_DIRECTORY | O_NOFOLLOW,
// dono tem que ser quem roda, e ninguem mais pode escrever nele (grupo ou
// outros com w: outro usuario trocaria o que vem abaixo). Criar, se pedido, e
// com 0700.
function abrirPasta(abs, criar) {
  const home = process.env.HOME;
  if (!home || !path.isAbsolute(home)) falhar("HOME ausente");
  if (!path.isAbsolute(abs) || path.normalize(abs) !== abs) falhar("pasta invalida: " + abs);
  const rel = path.relative(home, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) falhar("pasta fora do HOME: " + abs);
  let fd = fs.openSync(home, O_RDONLY | O_DIRECTORY);
  try {
    for (const comp of rel.split("/")) {
      if (!comp || comp === "." || comp === "..") falhar("pasta invalida: " + abs);
      let novo;
      try {
        novo = fs.openSync(noFd(fd, comp), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      } catch (e) {
        if (e.code !== "ENOENT" || !criar) throw e;
        fs.mkdirSync(noFd(fd, comp), 0o700);
        novo = fs.openSync(noFd(fd, comp), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      }
      const st = fs.fstatSync(novo);
      if (!st.isDirectory() || st.uid !== EU) {
        fs.closeSync(novo);
        falhar("pasta recusada (nao e minha): " + abs);
      }
      if (st.mode & 0o022) {
        fs.closeSync(novo);
        falhar("pasta recusada (outros podem escrever nela): " + abs);
      }
      fs.closeSync(fd);
      fd = novo;
    }
    return fd;
  } catch (e) {
    try { fs.closeSync(fd); } catch (_) {}
    if (e.code === "ELOOP" || e.code === "ENOTDIR") falhar("pasta recusada (symlink no caminho): " + abs);
    throw e;
  }
}

// Arquivo regular, meu, sem outro nome (hardlink), aberto sem seguir symlink.
// O_NONBLOCK: um FIFO posto no lugar falha no teste de regular em vez de
// travar a abertura.
function existeValido(dfd, nome) {
  let f;
  try {
    f = fs.openSync(noFd(dfd, nome), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  } catch (e) {
    return false;
  }
  try {
    const st = fs.fstatSync(f);
    return st.isFile() && st.uid === EU && st.nlink === 1 && st.size > 0;
  } finally {
    fs.closeSync(f);
  }
}

function gravar(dfd, nome, dados) {
  const tmp = ".tmp-" + crypto.randomBytes(8).toString("hex");
  const f = fs.openSync(noFd(dfd, tmp), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600);
  try {
    fs.writeSync(f, dados);
    fs.fsyncSync(f);
  } catch (e) {
    fs.closeSync(f);
    try { fs.unlinkSync(noFd(dfd, tmp)); } catch (_) {}
    throw e;
  }
  fs.closeSync(f);
  // rename nao segue symlink no destino: um link posto ali e substituido.
  fs.renameSync(noFd(dfd, tmp), noFd(dfd, nome));
  fs.fsyncSync(dfd);
}

// ---- o desenho

function rsvg() {
  for (const c of ["/usr/bin/rsvg-convert", "/usr/local/bin/rsvg-convert"]) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch (_) {}
  }
  return "";
}

function rasterizar(svg, w, h) {
  const bin = rsvg();
  if (!bin) falhar("rsvg-convert nao encontrado (pacote librsvg)", 3);
  const r = spawnSync(bin, ["-w", String(w), "-h", String(h), "-f", "png"], {
    input: svg,
    env: { PATH: "/usr/bin:/bin" },
    maxBuffer: 512 * 1024 * 1024,
    timeout: 120000,
  });
  if (r.status !== 0 || !r.stdout || r.stdout.length === 0) {
    falhar("rsvg-convert falhou: " + String(r.stderr || r.error || r.signal || ""));
  }
  return r.stdout;
}

function hex(s, reserva) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s || ""));
  const h = m ? m[1] : reserva;
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}

const VIEW_H = 700;

// Monta o SVG de uma vista (e o do mapa de atraso) a partir de x = cursor.
function desenhar(seed, cursor, W, H, opcoes) {
  // O gerador original usa globais soltas (MEM, vtxlist...) e troca Math.random
  // pelo PRNG com semente; roda no contexto global deste processo descartavel.
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "shanshui.js"), "utf8"));
  Math.seed(seed);
  Noise.noise(0); // monta a tabela de Perlin com a semente global
  MEM.onchunk = (x0) => Math.seed(seed + "|" + x0);

  const viewW = (VIEW_H * W) / H;
  const CW = MEM.cwid;
  // Gera 3000 a mais a esquerda so como contexto: a decisao de por morros
  // planos depende das montanhas vizinhas ja plantadas, e duas faixas lado a
  // lado precisam ver exatamente o mesmo mundo para nao ter emenda. Montanhas
  // distantes chegam a 1500 de largura, as outras transbordam uns 500.
  const start = Math.floor((cursor - 3000) / CW) * CW;
  MEM.xmin = MEM.xmax = start;
  chunkloader(start + CW, cursor + viewW + 600);

  let body = "";
  const visiveis = [];
  for (const c of MEM.chunks) {
    if (c.x > cursor - 1600 && c.x < cursor + viewW + 600) {
      body += c.canv;
      visiveis.push(c);
    }
  }

  const ink = hex(opcoes.ink, "000000");
  const paper = hex(opcoes.paper, "ffffff");
  // Tudo no original e cinza sobre papel: a luminancia decide onde a cor cai
  // entre a tinta (preto) e o papel (branco).
  function mix(r, g, b, alpha) {
    const t = Math.min(1, Math.max(0, (0.299 * r + 0.587 * g + 0.114 * b) / 255));
    const c = ink.map((v, i) => Math.round(v + (paper[i] - v) * t));
    return alpha === undefined ? `rgb(${c})` : `rgba(${c},${alpha})`;
  }
  body = body
    .replace(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/g,
      (_, r, g, b, al) => mix(+r, +g, +b, al))
    .replace(/:\s*white\b/g, ":" + mix(255, 255, 255))
    .replace(/:\s*black\b/g, ":" + mix(0, 0, 0))
    .replace(/NaN/g, "-1000");

  const grao = opcoes.grain
    ? `<filter id="g" x="0" y="0" width="100%" height="100%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>` +
      `<feColorMatrix values="0 0 0 0 ${ink[0] / 255} 0 0 0 0 ${ink[1] / 255} 0 0 0 0 ${ink[2] / 255} 0 0 0 0.05 0"/>` +
      `</filter>`
    : "";
  function envolver(corpo, fundo, comGrao, raiz) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ${raiz || ""} ` +
      `viewBox="${cursor} 0 ${viewW} ${VIEW_H}" preserveAspectRatio="xMidYMid slice">` +
      `<defs>${comGrao ? grao : ""}</defs>` +
      `<rect x="${cursor - 10}" y="-10" width="${viewW + 20}" height="${VIEW_H + 20}" fill="${fundo}"/>` +
      `<g>${corpo}</g>` +
      (comGrao ? `<rect x="${cursor}" y="0" width="${viewW}" height="${VIEW_H}" filter="url(#g)"/>` : "") +
      `</svg>`;
  }

  // Mapa de atraso: quanto cada traco vem atras da frente de pintura, que
  // caminha da esquerda para a direita. O pixel e pintado quando a frente
  // passa de (x dele + atraso * espalhamento). O atraso so depende do proprio
  // elemento - profundidade (fundo antes da frente) e a posicao do traco dentro
  // dele (contorno antes da textura) -, entao sai igual em qualquer faixa e as
  // emendas nao aparecem. 16 bits em R (alto) e G (baixo); 0 e o papel.
  // Traco quase transparente nao entra: o pixel fica com o atraso do de baixo.
  function alfa(x) {
    if (!x || /none/.test(x)) return 0;
    const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(x);
    return m ? +m[1] : 1;
  }
  function ordemDe(c) {
    const corpo = c.canv.replace(/NaN/g, "-1000");
    const n = (corpo.match(/style='/g) || []).length || 1;
    // agua vem com y-10000; montanhas distantes ~250, as de perto ~700
    const fundo = c.y < 0 ? 0 : Math.min(1, Math.max(0, (c.y - 200) / 650));
    let i = 0;
    return corpo.replace(/style='([^']*)'/g, (_, st) => {
      const d = 0.6 * fundo + 0.4 * (i++ / n);
      const v = Math.round(d * 65534) + 1;
      const cor = `rgb(${v >> 8},${v & 255},0)`;
      const f = (/fill:([^;]*)/.exec(st) || [])[1];
      const k = (/stroke:([^;]*)/.exec(st) || [])[1];
      const w = (/stroke-width:([^;]*)/.exec(st) || [])[1];
      const fill = alfa(f) >= 0.1 ? cor : "none";
      const stroke = k === undefined ? (fill === "none" ? "none" : cor) : alfa(k) >= 0.1 ? cor : "none";
      return `style='fill:${fill};stroke:${stroke}${w !== undefined ? ";stroke-width:" + w : ""}'`;
    });
  }

  return {
    quadro: envolver(body, `rgb(${paper})`, !!opcoes.grain),
    // Sem antialias: borda misturada viraria um instante que nao existe.
    ordem: () => envolver(visiveis.map(ordemDe).join(""), "rgb(0,0,0)", false,
      'shape-rendering="crispEdges" text-rendering="optimizeSpeed"'),
  };
}

// ---- comandos

function nomes(seed, k, W, H) {
  const base = `${seed}_${k}_${W}x${H}.png`;
  return { q: "q_" + base, o: "o_" + base };
}

function cmdFaixa(a) {
  const seed = semente(a.seed);
  const k = inteiro(a.k, -1e7, 1e7, "k");
  const W = inteiro(a.w, 64, 16384, "largura");
  const H = inteiro(a.h, 64, 16384, "altura");
  const escala = Math.min(1, Math.max(0.1, Number(a["ordem-escala"] || 0.5)));
  const dfd = abrirPasta(String(a.dir || ""), true);
  const n = nomes(seed, k, W, H);
  // Faixa ja pintada antes (mesmo nome = mesma semente, k e tamanho).
  if (existeValido(dfd, n.q) && existeValido(dfd, n.o)) {
    process.stdout.write(n.q + " " + n.o + "\n");
    return;
  }
  const cursor = (k * VIEW_H * W) / H;
  const d = desenhar(seed, cursor, W, H, { grain: false });
  const q = rasterizar(d.quadro, W, H);
  const o = rasterizar(d.ordem(), Math.round(W * escala), Math.round(H * escala));
  gravar(dfd, n.o, o);
  gravar(dfd, n.q, q);
  fs.closeSync(dfd);
  process.stdout.write(n.q + " " + n.o + "\n");
}

const NOME_FAIXA = /^[qo]_[0-9]{1,20}_-?[0-9]{1,8}_[0-9]{2,5}x[0-9]{2,5}\.png$/;

function cmdLimpar(a) {
  const manter = new Set(String(a.manter || "").split(",").filter(Boolean));
  const dfd = abrirPasta(String(a.dir || ""), false);
  const agora = Date.now();
  for (const nome of fs.readdirSync(noFd(dfd, "."))) {
    const faixa = NOME_FAIXA.test(nome);
    const temporario = /^\.tmp-[0-9a-f]{16}$/.test(nome);
    if (!faixa && !temporario) continue; // o que nao e nosso fica
    if (faixa && manter.has(nome)) continue;
    let st;
    try { st = fs.lstatSync(noFd(dfd, nome)); } catch (_) { continue; }
    if (!st.isFile() && !st.isSymbolicLink()) continue;
    // Temporario so sai se abandonado ha uma hora (outro gerar pode estar nele).
    if (temporario && agora - st.mtimeMs < 3600e3) continue;
    try { fs.unlinkSync(noFd(dfd, nome)); } catch (_) {}
  }
  fs.closeSync(dfd);
}

function cmdPreparar(a) {
  for (const d of [].concat(a.dir || [])) fs.closeSync(abrirPasta(String(d), true));
}

function cmdPng(a) {
  const seed = semente(a.seed);
  const W = inteiro(a.w || 1920, 64, 16384, "largura");
  const H = inteiro(a.h || 1080, 64, 16384, "altura");
  const d = desenhar(seed, Number(a.x || 0), W, H, { ink: a.ink, paper: a.paper, grain: a.grain === "1" });
  process.stdout.write(a.ordem ? rasterizar(d.ordem(), W, H) : rasterizar(d.quadro, W, H));
}

const a = lerArgs(process.argv);
const comando = a._[0];
try {
  if (comando === "faixa") cmdFaixa(a);
  else if (comando === "limpar") cmdLimpar(a);
  else if (comando === "preparar") cmdPreparar(a);
  else if (comando === "conferir") { if (!rsvg()) falhar("rsvg-convert nao encontrado (pacote librsvg)", 3); }
  else if (comando === "png") cmdPng(a);
  else falhar("uso: gerar.js faixa|limpar|preparar|conferir|png ...");
} catch (e) {
  falhar(e && e.message ? e.message : String(e));
}
