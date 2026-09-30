import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

// 山 na barra. Clique abre o menu; o botao direito liga e desliga direto.
Panel {
  id: root
  moduleName: "zed.shanshui"
  ipcTarget: "zed.shanshui.menu"

  readonly property color fg: bar ? bar.barForeground : Color.foreground
  readonly property int barSlot: Style.bar.iconFont + Style.space(12)
  implicitWidth: bar && bar.vertical ? (bar ? bar.barSize : Style.bar.sizeHorizontal) : barSlot
  implicitHeight: bar && bar.vertical ? barSlot : (bar ? bar.barSize : Style.bar.sizeHorizontal)

  // Paletas: tinta sobre papel. "Inverter" troca as duas em qualquer uma.
  readonly property var paletas: [
    { value: "tema", label: Paisagem.t("Tema", "Theme"), tinta: "foreground", papel: "background" },
    { value: "acento", label: Paisagem.t("Acento", "Accent"), tinta: "accent", papel: "background" },
    { value: "arroz", label: Paisagem.t("Papel de arroz", "Rice paper"), tinta: "#2b2b2b", papel: "#f2e8d5" }
  ]

  function paletaAtual() {
    for (var i = 0; i < paletas.length; i++) {
      if (paletas[i].tinta === Paisagem.opcoes.tinta && paletas[i].papel === Paisagem.opcoes.papel) return paletas[i].value
    }
    return ""
  }

  function situacao() {
    var t = Paisagem.t
    if (Paisagem.erro === "node") return t("precisa do nodejs", "needs nodejs")
    if (Paisagem.erro === "rsvg") return t("precisa do librsvg", "needs librsvg")
    if (Paisagem.erro === "gerar") return t("erro ao gerar, tentando de novo", "render failed, retrying")
    if (!Paisagem.ativo) return t("desligado", "off")
    var trecho = " · " + t("trecho ", "scroll ") + (Paisagem.kFrente + 1)
    if (Paisagem.pausado) return t("pausado", "paused") + trecho
    if (Paisagem.encoberto) return t("esperando (tela cheia)", "waiting (fullscreen)") + trecho
    if (!Paisagem.pronta(Paisagem.kFrente)) return t("preparando o papel", "preparing the paper") + trecho
    return t("pintando", "painting") + trecho
  }

  // O que falta instalar, quando falta.
  readonly property string ajuda: Paisagem.erro === "node"
    ? Paisagem.t("Falta o pacote nodejs (veja o README).", "The nodejs package is missing (see the README).")
    : Paisagem.erro === "rsvg"
      ? Paisagem.t("Falta o pacote librsvg (veja o README).", "The librsvg package is missing (see the README).")
      : ""

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    slotSize: root.barSlot
    opticalSize: Style.bar.iconFont
    active: root.opened
    tooltipText: root.opened ? "" : "Shan shui · " + root.situacao()

    iconComponent: Component {
      Item {
        Text {
          anchors.centerIn: parent
          text: "山"
          font.pixelSize: Style.bar.iconFont
          color: root.fg
          opacity: Paisagem.ativo && !Paisagem.pausado ? 1 : 0.4
        }
      }
    }

    onPressed: function (b) {
      if (b === Qt.RightButton) Paisagem.alternar()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(440))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(12)

        PanelHero {
          width: parent.width
          foreground: root.fg
          title: "Shan Shui"
          meta: root.situacao()
          iconComponent: Component {
            Text {
              text: "山"
              font.pixelSize: Style.font.display
              color: root.fg
            }
          }
          trailingControl: Component {
            ToggleSwitch {
              checked: Paisagem.ativo
              foreground: root.fg
              onToggled: Paisagem.alternar()
            }
          }
        }

        Text {
          visible: root.ajuda !== ""
          width: parent.width
          wrapMode: Text.WordWrap
          text: root.ajuda
          color: root.fg
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }

        Row {
          spacing: Style.space(8)
          enabled: Paisagem.ativo && Paisagem.erro === ""
          opacity: enabled ? 1 : 0.5

          Button {
            foreground: root.fg
            bordered: true
            iconText: Paisagem.pausado ? "󰐊" : "󰏤"
            text: Paisagem.pausado ? Paisagem.t("Continuar", "Resume") : Paisagem.t("Pausar", "Pause")
            onClicked: Paisagem.pausado ? Paisagem.continuar() : Paisagem.pausar()
          }
          Button {
            foreground: root.fg
            bordered: true
            iconText: "󰒭"
            text: Paisagem.t("Adiantar", "Skip ahead")
            tooltipText: Paisagem.t("Anda meia tela", "Moves half a screen")
            onClicked: { Paisagem.frente += 0.5 * Paisagem.larguraVista; Paisagem.salvar(); Paisagem.arrumar() }
          }
          Button {
            foreground: root.fg
            bordered: true
            iconText: "󰑓"
            text: Paisagem.t("Outra paisagem", "New landscape")
            tooltipText: Paisagem.t("Papel em branco, nova semente", "Blank paper, new seed")
            onClicked: Paisagem.nova()
          }
        }

        PanelSeparator { width: parent.width; foreground: root.fg }

        PanelSectionHeader { text: Paisagem.t("Velocidade · tempo por tela", "Speed · time per screen"); foreground: root.fg }
        ButtonGroup {
          foreground: root.fg
          focusable: false
          options: [
            { value: "10", label: "10 min" },
            { value: "5", label: "5 min" },
            { value: "2", label: "2 min" },
            { value: "1", label: "1 min" },
            { value: "0.5", label: "30 s", tooltip: Paisagem.t("Rápido: combina com fluidez Suave", "Fast: pairs with Smooth motion") },
            { value: "0.25", label: "15 s", tooltip: Paisagem.t("Muito rápido: combina com fluidez Suave", "Very fast: pairs with Smooth motion") }
          ]
          value: String(Paisagem.opcoes.minPorTela)
          onChanged: function(v) { Paisagem.definir({ minPorTela: Number(v) }) }
        }

        PanelSectionHeader { text: Paisagem.t("Fluidez", "Motion"); foreground: root.fg }
        ButtonGroup {
          foreground: root.fg
          focusable: false
          options: [
            { value: "6", label: Paisagem.t("Leve", "Light"), tooltip: Paisagem.t("6 fps, o mais barato", "6 fps, the cheapest") },
            { value: "12", label: "Normal", tooltip: "12 fps" },
            { value: "24", label: Paisagem.t("Suave", "Smooth"), tooltip: Paisagem.t("24 fps, o mais caro", "24 fps, the most expensive") }
          ]
          value: String(Paisagem.opcoes.fps)
          onChanged: function(v) { Paisagem.definir({ fps: Number(v) }) }
        }

        PanelSectionHeader { text: Paisagem.t("Cores", "Colors"); foreground: root.fg }
        ButtonGroup {
          foreground: root.fg
          focusable: false
          options: root.paletas.map(function(p) { return { value: p.value, label: p.label } })
          value: root.paletaAtual()
          onChanged: function(v) {
            for (var i = 0; i < root.paletas.length; i++)
              if (root.paletas[i].value === v) Paisagem.definir({ tinta: root.paletas[i].tinta, papel: root.paletas[i].papel })
          }
        }

        Item {
          width: parent.width
          implicitHeight: inverter.implicitHeight

          Text {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: Paisagem.t("Inverter cores", "Invert colors")
            color: root.fg
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }
          ToggleSwitch {
            id: inverter
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            checked: Paisagem.invertido
            foreground: root.fg
            onToggled: Paisagem.definir({ inverter: !Paisagem.invertido })
          }
        }

        PanelSectionHeader { text: Paisagem.t("Idioma", "Language"); foreground: root.fg }
        ButtonGroup {
          foreground: root.fg
          focusable: false
          options: [
            { value: "pt", label: "Português" },
            { value: "en", label: "English" }
          ]
          value: Paisagem.pt ? "pt" : "en"
          onChanged: function(v) { Paisagem.definir({ idioma: v }) }
        }

        PanelSeparator { width: parent.width; foreground: root.fg }

        // A assinatura, como nos outros plugins do ZeD, e o credito de quem
        // desenhou as montanhas.
        Item {
          width: parent.width
          implicitHeight: Math.max(credito.implicitHeight, assinatura.implicitHeight)

          Text {
            id: credito
            anchors.left: parent.left
            anchors.right: assinatura.left
            anchors.rightMargin: Style.space(8)
            elide: Text.ElideRight
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            color: Util.alpha(root.fg, 0.45)
            text: Paisagem.t("{Shan, Shui}* de LingDong-", "after LingDong-'s {Shan, Shui}*")
          }
          Text {
            id: assinatura
            anchors.right: parent.right
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            font.letterSpacing: 1
            color: Util.alpha(root.fg, 0.45)
            text: "SHAN SHUI · by ZeD"
          }
        }
      }
    }
  }
}
