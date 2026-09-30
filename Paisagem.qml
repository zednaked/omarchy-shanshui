pragma Singleton

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import qs.Commons

// O rolo sendo pintado da esquerda para a direita, sem fim.
//
// A paisagem e cortada em faixas do tamanho da tela (k = 0, 1, 2...). Cada
// faixa e um quadro pronto mais um mapa de atraso por pixel, gerados fora do
// shell por `nice -n 19 node gerar.js`. Aqui so anda um numero - a frente de
// pintura, em x do mundo - e a camera a acompanha; o shader de cada faixa
// revela o que a frente ja passou.
//
// Na memoria ficam as duas faixas na tela, e a terceira quando a camera se
// aproxima dela. A frente espera se a faixa onde ela esta ainda nao existe.
Singleton {
  id: root

  readonly property string home: Quickshell.env("HOME")
  readonly property string configDir: home + "/.config/zed.shanshui"
  readonly property string configPath: configDir + "/config.json"
  readonly property string stateDir:
    (Quickshell.env("XDG_STATE_HOME") || (home + "/.local/state")) + "/zed.shanshui"
  readonly property string statePath: stateDir + "/estado.json"
  readonly property string cacheDir:
    (Quickshell.env("XDG_CACHE_HOME") || (home + "/.cache")) + "/zed.shanshui"
  readonly property string gerador: decodeURIComponent(String(Qt.resolvedUrl("gerar.js")).replace(/^file:\/\//, ""))

  // Portugues ou ingles: o que o menu escolheu, ou a lingua do sistema.
  readonly property bool pt: opcoes.idioma === "pt"
    || (opcoes.idioma !== "en" && String(Qt.locale().name).indexOf("pt") === 0)
  function t(textoPt, textoEn) { return pt ? textoPt : textoEn }

  // Todo processo roda com ambiente limpo, e o node e achado pelo /usr/bin/env
  // neste PATH fixo: o do sistema primeiro, depois o do mise (que o Omarchy
  // traz; o shim acha o /usr/bin/mise pelo mesmo PATH).
  readonly property var ambiente: ({
    PATH: "/usr/bin:/bin:/usr/local/bin:" + home + "/.local/share/mise/shims:" + home + "/.local/bin",
    HOME: home
  })
  readonly property var node: ["/usr/bin/env", "node"]
  property bool pronto: false      // node achado, pastas criadas
  // "" | "node" | "rsvg" | "gerar": o que impede de pintar, para o menu contar.
  property string erro: ""

  // Opcoes (config.json). tinta/papel: "foreground", "background", "accent",
  // "muted", "urgent" do tema, ou um "#rrggbb" fixo.
  readonly property var padrao: ({
    minPorTela: 5,        // minutos para a frente atravessar uma tela
    fps: 12,
    frenteNaTela: 1.0,    // onde a frente fica na tela (0 esquerda, 1 direita)
    espalha: 140,         // quanto os detalhes vem atras do fundo (mundo)
    suave: 40,            // largura da borda em que a tinta entra (mundo)
    grao: 0.06,
    tinta: "foreground",
    papel: "background",
    inverter: false,
    idioma: "auto"        // "auto" (lingua do sistema), "pt" ou "en"
  })
  property var opcoes: padrao

  property bool ativo: true
  property bool pausado: false
  property string semente: ""
  property real frente: 0

  // Tres lugares fixos (as janelas se ligam por indice, entao uma faixa nao
  // recarrega quando outra muda). Cada um: null ou { k, chave, quadro, ordem }.
  property var faixas: [null, null, null]
  property string pendente: ""
  property bool gerando: false
  property bool carregado: false

  // A camera acompanha a frente. No comeco de uma paisagem ela fica parada
  // em 0 enquanto a abertura (corrida) enche a tela; depois anda junto.
  readonly property real camera: Math.max(0, frente - numero(opcoes.frenteNaTela, 0.3, 1.2, 1.0) * larguraVista)
  // Abertura: ate aqui a frente corre (uma tela em poucos segundos).
  property real corridaAte: -1
  readonly property int kFrente: Math.max(0, Math.floor(frente / larguraVista))

  // Tela cheia em todos os monitores: ninguem ve o fundo, a pintura congela.
  readonly property bool encoberto: {
    var ms = Hyprland.monitors.values
    if (!ms || ms.length === 0) return false
    for (var i = 0; i < ms.length; i++) {
      var w = ms[i].activeWorkspace
      if (!w || !w.hasFullscreen) return false
    }
    return true
  }

  // A vista do mundo tem 700 de altura; a largura segue o maior monitor.
  readonly property size tela: {
    var w = 1920, h = 1080
    var s = Quickshell.screens
    for (var i = 0; i < s.length; i++) {
      var dpr = s[i].devicePixelRatio || 1
      var sw = Math.round(s[i].width * dpr), sh = Math.round(s[i].height * dpr)
      if (i === 0 || sw * sh > w * h) { w = sw; h = sh }
    }
    return Qt.size(w, h)
  }
  readonly property real larguraVista: 700 * tela.width / Math.max(1, tela.height)

  function numero(v, min, max, reserva) {
    var n = Number(v)
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : reserva
  }

  function hex(c) {
    function p(v) { var s = Math.round(v * 255).toString(16); return s.length < 2 ? "0" + s : s }
    return "#" + p(c.r) + p(c.g) + p(c.b)
  }

  function cor(nome, reserva) {
    var n = String(nome || "")
    if (/^#[0-9a-fA-F]{6}$/.test(n)) return n
    if (["foreground", "background", "accent", "muted", "urgent"].indexOf(n) >= 0) return hex(Color[n])
    return hex(Color[reserva])
  }

  // inverter troca tinta e papel, em qualquer paleta.
  readonly property bool invertido: opcoes.inverter === true
  readonly property string tintaAtual: invertido ? cor(opcoes.papel, "background") : cor(opcoes.tinta, "foreground")
  readonly property string papelAtual: invertido ? cor(opcoes.tinta, "foreground") : cor(opcoes.papel, "background")

  // Tudo que muda o desenho de uma faixa; tambem e o nome do arquivo. As
  // cores nao entram: a faixa e cinza e o shader pinta com tinta e papel.
  function chave(k) {
    return [semente, k, tela.width + "x" + tela.height].join("_")
  }

  function faixa(k) {
    for (var i = 0; i < 3; i++) if (faixas[i] && faixas[i].k === k) return faixas[i]
    return null
  }

  function pronta(k) {
    var f = faixa(k)
    return f !== null && f.chave === chave(k)
  }

  // ---- o que precisa estar na memoria

  function necessarias() {
    var kc = Math.floor(camera / larguraVista)
    var ks = [kc, kc + 1]
    if (camera - kc * larguraVista > 0.5 * larguraVista) ks.push(kc + 2)
    return ks.filter(function(k) { return k >= 0 })
  }

  function arrumar() {
    if (!carregado || !ativo || !pronto) return
    var ks = necessarias()
    // Solta o que saiu da tela. Faixa com cor velha fica ate a nova chegar.
    var novo = faixas.slice()
    var mudou = false
    for (var i = 0; i < 3; i++) {
      if (novo[i] && ks.indexOf(novo[i].k) < 0) { novo[i] = null; mudou = true }
    }
    if (mudou) faixas = novo
    if (gerando) return
    // Gera a mais urgente que falta: a da frente primeiro.
    ks.sort(function(a, b) { return Math.abs(a - kFrente) - Math.abs(b - kFrente) })
    for (var j = 0; j < ks.length; j++) {
      if (!pronta(ks[j])) { gerar(ks[j]); return }
    }
  }

  function gerar(k) {
    if (!pronto || erro !== "") return
    var c = chave(k)
    // Os nomes sao montados pelo gerar.js a partir destes numeros; aqui so se
    // repete a regra para saber onde procurar.
    var q = cacheDir + "/q_" + c + ".png"
    var o = cacheDir + "/o_" + c + ".png"
    geradorProc.alvo = { k: k, chave: c, quadro: q, ordem: o }
    geradorProc.command = [
      "/usr/bin/nice", "-n", "19"].concat(node, [gerador, "faixa",
      "--dir", cacheDir, "--seed", semente, "--k", String(k),
      "--w", String(tela.width), "--h", String(tela.height), "--ordem-escala", "0.5"])
    pendente = c
    gerando = true
    geradorProc.running = true
  }

  function colocar(a) {
    var novo = faixas.slice()
    var lugar = -1
    for (var i = 0; i < 3; i++) if (novo[i] && novo[i].k === a.k) lugar = i
    if (lugar < 0) for (i = 0; i < 3; i++) if (!novo[i]) { lugar = i; break }
    if (lugar < 0) return
    novo[lugar] = { k: a.k, chave: a.chave, quadro: a.quadro, ordem: a.ordem }
    faixas = novo
  }

  // ---- acoes

  // Outra paisagem: papel em branco, e a abertura corre ate encher a tela.
  function nova() {
    semente = String(Date.now())
    frente = 0
    corridaAte = numero(opcoes.frenteNaTela, 0.3, 1.2, 1.0) * larguraVista
    faixas = [null, null, null]
    salvar()
    arrumar()
  }

  // Muda uma opcao e grava no config.json (que recarrega sozinho).
  function definir(mudancas) {
    var o = {}
    for (var k in padrao) o[k] = opcoes[k] === undefined ? padrao[k] : opcoes[k]
    for (k in mudancas) o[k] = mudancas[k]
    opcoes = o
    configFile.setText(JSON.stringify(o, null, 2) + "\n")
  }

  function pausar() { pausado = true; salvar() }
  function continuar() { pausado = false; salvar() }
  function ligar() { if (!ativo) { ativo = true; salvar(); arrumar() } }
  function desligar() { if (ativo) { ativo = false; salvar() } }
  function alternar() { if (ativo) desligar(); else ligar() }

  function salvar() {
    if (!carregado) return
    estadoFile.setText(JSON.stringify({
      ativo: ativo, pausado: pausado, semente: semente, frente: Math.round(frente * 10) / 10
    }, null, 2) + "\n")
  }

  // ---- processos e timers

  Process {
    id: geradorProc
    property var alvo: null
    clearEnvironment: true
    environment: root.ambiente
    stderr: StdioCollector { id: erroGerador }
    onExited: function(codigo) {
      root.gerando = false
      root.pendente = ""
      if (codigo === 0) {
        root.colocar(alvo)
        root.limpar()
      } else {
        // 3: falta o rsvg-convert. Outro erro: tenta de novo no proximo
        // arrumar, mas conta no menu.
        root.erro = codigo === 3 ? "rsvg" : "gerar"
        console.warn("zed.shanshui: gerar.js saiu com", codigo, erroGerador.text)
        if (codigo !== 3) erroTimer.restart()
      }
      Qt.callLater(root.arrumar)
    }
  }

  // Um erro passageiro (disco cheio, processo morto) nao trava para sempre.
  Timer {
    id: erroTimer
    interval: 30000
    onTriggered: if (root.erro === "gerar") root.erro = ""
  }

  // Apaga as faixas que nao estao em nenhum lugar (nem sendo geradas); o
  // gerar.js so toca em nomes que ele mesmo cria.
  function limpar() {
    if (!pronto || limparProc.running) return
    var manter = []
    for (var i = 0; i < 3; i++) if (faixas[i]) manter.push("q_" + faixas[i].chave + ".png", "o_" + faixas[i].chave + ".png")
    if (pendente) manter.push("q_" + pendente + ".png", "o_" + pendente + ".png")
    limparProc.command = node.concat([gerador, "limpar", "--dir", cacheDir, "--manter", manter.join(",")])
    limparProc.running = true
  }

  Process {
    id: limparProc
    clearEnvironment: true
    environment: root.ambiente
  }

  property real ultimoTique: 0
  Timer {
    id: anim
    interval: Math.round(1000 / root.numero(root.opcoes.fps, 1, 60, 12))
    running: root.ativo && root.carregado && !root.pausado && !root.encoberto
    repeat: true
    onRunningChanged: root.ultimoTique = Date.now()
    onTriggered: {
      var agora = Date.now()
      var dt = Math.min(1, (agora - root.ultimoTique) / 1000)
      root.ultimoTique = agora
      // A frente so anda sobre papel que ja existe.
      if (!root.pronta(root.kFrente)) return
      var v = root.larguraVista / (root.numero(root.opcoes.minPorTela, 0.1, 120, 5) * 60)
      if (root.frente < root.corridaAte) v = Math.max(v, root.larguraVista / 4)
      else root.corridaAte = -1
      root.frente += v * dt
    }
  }

  // Confere o que precisa estar carregado sem pesar no tique.
  Timer {
    interval: 2000
    running: root.ativo && root.carregado
    repeat: true
    onTriggered: root.arrumar()
  }

  Timer {
    interval: 30000
    running: root.ativo && root.carregado && !root.pausado
    repeat: true
    onTriggered: root.salvar()
  }

  // ---- arquivos

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      var o = {}
      for (var k in root.padrao) o[k] = root.padrao[k]
      try {
        var c = JSON.parse(text())
        for (k in c) o[k] = c[k]
      } catch (e) {
        console.warn("zed.shanshui: config.json invalido, usando o padrao:", e)
      }
      root.opcoes = o
    }
  }

  FileView {
    id: estadoFile
    path: root.statePath
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: {
      var e = {}
      try { e = JSON.parse(text()) } catch (err) {}
      root.iniciar(e)
    }
    onLoadFailed: root.iniciar({})
  }

  // Confere o node e o rsvg-convert e cria as pastas - tudo pelo gerar.js,
  // sem shell. 127: o env nao achou o node.
  Process {
    id: sondaProc
    clearEnvironment: true
    environment: root.ambiente
    command: root.node.concat([root.gerador, "preparar",
                               "--dir", root.configDir, "--dir", root.stateDir, "--dir", root.cacheDir])
    stderr: StdioCollector { id: erroSonda }
    onExited: function(codigo) {
      if (codigo === 127) { root.erro = "node"; return }
      if (codigo !== 0) console.warn("zed.shanshui:", erroSonda.text)
      conferirProc.running = true
    }
  }

  Process {
    id: conferirProc
    clearEnvironment: true
    environment: root.ambiente
    command: root.node.concat([root.gerador, "conferir"])
    onExited: function(codigo) {
      if (codigo === 3) root.erro = "rsvg"
      root.pronto = codigo === 0
      root.arrumar()
      // O config.json pode ter sido lido antes da pasta existir.
      configFile.reload()
    }
  }

  function iniciar(e) {
    if (carregado) return
    ativo = e.ativo !== false
    pausado = e.pausado === true
    // So digitos: a semente vira nome de arquivo.
    var s = String(e.semente || "")
    semente = /^[0-9]{1,20}$/.test(s) ? s : String(Date.now())
    frente = numero(e.frente, 0, 1e9, 0)
    // Primeira vez: abre com a corrida, como uma paisagem nova.
    if (!e.semente) corridaAte = numero(opcoes.frenteNaTela, 0.3, 1.2, 1.0) * larguraVista
    carregado = true
    arrumar()
  }

  Component.onCompleted: sondaProc.running = true

  IpcHandler {
    target: "shanshui"
    function nova(): void { root.nova() }
    function pausar(): void { root.pausar() }
    function continuar(): void { root.continuar() }
    function ligar(): void { root.ligar() }
    function desligar(): void { root.desligar() }
    function alternar(): void { root.alternar() }
    // Anda a frente n telas de uma vez (teste, ou pular um trecho).
    function pular(telas: real): void { root.frente += telas * root.larguraVista; root.salvar(); root.arrumar() }
    function estado(): string {
      return JSON.stringify({
        ativo: root.ativo, pausado: root.pausado, encoberto: root.encoberto,
        pronto: root.pronto, erro: root.erro, corridaAte: root.corridaAte,
        frente: root.frente, camera: root.camera, kFrente: root.kFrente,
        larguraVista: root.larguraVista, gerando: root.gerando, pendente: root.pendente,
        faixas: root.faixas.map(function(f) { return f ? f.k : null }), opcoes: root.opcoes
      })
    }
  }
}
