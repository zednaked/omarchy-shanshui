import QtQuick
import Quickshell
import Quickshell.Wayland

// Uma janela por monitor na camada Bottom: acima do fundo do Omarchy, abaixo
// das janelas. Nao recebe clique (mascara vazia), entao o fundo de baixo
// continua respondendo. Desligar so esconde a camada; o wallpaper nunca e
// tocado.
//
// Cada janela tem os lugares fixos das faixas carregadas (tres por camada);
// cada faixa e um ShaderEffect posto na tela conforme a camera da camada dela.
Item {
  id: root
  property var shell: null

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: janela
      required property var modelData

      screen: modelData
      visible: Paisagem.ativo
      anchors { top: true; bottom: true; left: true; right: true }
      color: Paisagem.papelAtual
      exclusionMode: ExclusionMode.Ignore
      mask: Region {}

      WlrLayershell.namespace: "zed-shanshui"
      WlrLayershell.layer: WlrLayer.Bottom
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

      // px logicos por unidade do mundo (a vista tem 700 de altura)
      readonly property real escala: height / 700

      Repeater {
        model: Paisagem.camadas * 3

        Item {
          id: lugar
          required property int index
          readonly property var f: Paisagem.faixas[index]
          readonly property int camada: f ? f.c : 0
          anchors.fill: parent

          // Texturas do shader; nunca desenhadas direto. A ordem e amostrada
          // sem filtro: interpolar dois atrasos inventaria um terceiro.
          Image {
            id: q; visible: false; asynchronous: true; cache: false; smooth: true
            source: lugar.f ? "file://" + lugar.f.quadro : ""
          }
          Image {
            id: o; visible: false; asynchronous: true; cache: false; smooth: false
            source: lugar.f ? "file://" + lugar.f.ordem : ""
          }

          ShaderEffect {
            readonly property real inicioMundo: lugar.f ? lugar.f.k * Paisagem.larguraVista : 0
            readonly property real fator: Paisagem.fatores[lugar.camada] === undefined ? 1 : Paisagem.fatores[lugar.camada]
            x: (inicioMundo - Paisagem.camera * fator) * janela.escala
            y: 0
            width: Paisagem.larguraVista * janela.escala
            height: janela.height
            visible: lugar.f !== null && lugar.f !== undefined
                     && q.status === Image.Ready && o.status === Image.Ready
                     && x < janela.width && x + width > 0

            property var quadro: q
            property var ordem: o
            property real frente: Paisagem.frente - (1 - fator) * Paisagem.camera
            property real inicio: inicioMundo
            property real largura: Paisagem.larguraVista
            property real espalha: Number(Paisagem.opcoes.espalha) || 140
            property real suave: Number(Paisagem.opcoes.suave) || 40
            property real grao: Paisagem.opcoes.grao === undefined ? 0.06 : Number(Paisagem.opcoes.grao)
            property real fundo: lugar.camada === 0 ? 1 : 0
            property real bruma: Paisagem.brumas[lugar.camada] === undefined ? 0 : Paisagem.brumas[lugar.camada]
            property real desloc: (1 - fator) * Paisagem.camera
            property color papel: Paisagem.papelAtual
            property color tinta: Paisagem.tintaAtual
            fragmentShader: Qt.resolvedUrl("pintura.frag.qsb")
          }
        }
      }
    }
  }
}
