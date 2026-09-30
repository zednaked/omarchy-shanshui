# Publicar no marketplace de plugins do Omarchy

O caminho é o mesmo do Ganja e do Omahold (ver o `PUBLISHING.md` do
`omarchy-ganja`, levantado em 12/09/2026 a partir de
<https://plugins.omarchy.org/publish.html> e do repo
<https://github.com/omacom/omarchy-plugin-marketplace>). Aqui fica só o que é
deste plugin.

## Checklist — 30/09/2026

| requisito | aqui |
|---|---|
| `omarchy plugin validate .` sai com 0 | ✅ |
| repo público no GitHub, `manifest.json` na raiz | ✅ <https://github.com/zednaked/omarchy-shanshui> |
| README na raiz com instalar **e** remover | ✅ `README.md` (inglês), `README.pt-BR.md` |
| licença na raiz, dependências documentadas | ✅ `LICENSE`: MIT, mais a licença do {Shan, Shui}* (MIT, Lingdong Huang), a nota do ruído do p5.js (LGPL-2.1), e node/librsvg como dependências de runtime não empacotadas |
| `author`, `license`, `description` no manifest | ✅ |
| nenhum symlink dentro da pasta | ✅ |
| preview (≤ 50 MB, ≤ 40 MP) | ✅ `preview.png`, 1440×808, 1,1 MB, print real da máquina |
| não sobrescreve config do usuário | ✅ escreve só em `~/.config/zed.shanshui`, `~/.local/state/zed.shanshui`, `~/.cache/zed.shanshui`; o wallpaper nunca é tocado |

## O que a revisão humana olhou no Ganja, e como está aqui

O revisor (`HANCORE-linux`) bloqueou o Ganja três vezes. Os três achados, e onde
este plugin já nasce atendendo:

1. **Caminho interpolado em shell, leitura sem limite.** Aqui não há `sh`
   nenhum. Todo `Process` recebe argv, e o QML só passa números (semente, k,
   largura, altura) e as três pastas. O nome de cada arquivo é montado no
   `gerar.js`. A semente lida do estado é validada como só dígitos antes de
   virar nome.
2. **Temporário previsível, symlink no caminho, checagem separada do uso.** No
   `gerar.js`:
   - a pasta é aberta descendo do `$HOME` por descritor
     (`O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC` em cada componente; dono conferido
     no fd, e componente com escrita para grupo ou outros é recusado, como o
     revisor pediu no Omahold);
   - o arquivo é criado com `O_CREAT | O_EXCL | O_NOFOLLOW` e nome aleatório,
     com `fsync`, depois `rename` pelo mesmo fd e `fsync` do diretório;
   - o reaproveitamento confere o arquivo no fd (`regular`, dono, `nlink == 1`),
     aberto com `O_NONBLOCK` para que um FIFO falhe em vez de travar.

   O Node não tem `openat`: `/proc/self/fd/N/nome` resolve o nome a partir do
   diretório já aberto, que é a mesma garantia. O `make hostil` cobre symlink no
   meio do caminho, pasta final que é link, link, hardlink e FIFO no lugar da
   faixa, pasta com escrita para grupo ou outros, pasta fora do `$HOME`, e `..`
   — 22 verificações.
3. **Lançamento com ambiente herdado.** Todo `Process` tem
   `clearEnvironment: true` e `environment: { PATH, HOME }`. Não há
   `execDetached`. O `rsvg-convert` é chamado pelo caminho absoluto, com
   `PATH=/usr/bin:/bin`.

O que o scan vai ver, e está explicado no código: o plugin lança
`/usr/bin/nice -n 19 /usr/bin/env node gerar.js …` (gerar faixa),
`/usr/bin/env node gerar.js limpar|preparar|conferir`, e o `gerar.js` lança o
`rsvg-convert`. São três `Process` supervisionados, sem rede, sem binário no
repo, sem instalador, sem systemd e sem sudo. Nenhuma das capacidades de revisão
manual (`installer`, `package-manager`, `privilege`,
`bundled-executable-binary`, `service-management`…) se aplica.

O ponto que um revisor pode levantar: o PATH do `env` inclui
`~/.local/share/mise/shims` e `~/.local/bin`, depois dos do sistema, para
achar um node instalado pelo mise (o Omarchy não traz node global). São pastas
do próprio usuário, e as do sistema vêm primeiro.

## O formulário

Issue em <https://github.com/omacom/omarchy-plugin-marketplace/issues/new/choose>,
template de submissão. O título começa com `[Plugin]:`. Os cabeçalhos `###` não
podem ser reordenados nem removidos.

- **Title:** `[Plugin]: Shan Shui`
- **Repository URL:** `https://github.com/zednaked/omarchy-shanshui`
- **Category:** `Appearance`. É um fundo de tela vivo, que é o que a pessoa
  procura quando acha isto. `Desktop` seria a segunda opção.
- **Tags** (de 1 a 3, grafia exata): `Quickshell`, `Hyprland`, `Media`
- **Maintainer notes:**
  > Pure QML plus one Node script run outside the shell at `nice 19`; no
  > network, no bundled binary, no installer. The landscape generator is
  > LingDong-'s {Shan, Shui}* (MIT), vendored in `shanshui.js` with the browser
  > parts removed; its license is reproduced in `LICENSE`. Runtime
  > dependencies: `nodejs` (not in Omarchy base; the menu tells the user how to
  > install it) and `librsvg` (already in base). Writes only to
  > `~/.config/zed.shanshui`, `~/.local/state/zed.shanshui` and
  > `~/.cache/zed.shanshui`, through fd-pinned, O_EXCL|O_NOFOLLOW writes;
  > `make hostil` shows what it refuses. The wallpaper is never touched: the
  > painting is a Bottom-layer surface above it.
- **Submission checklist:** as cinco caixas. Todas são verdade:
  1. repo público com instalar e remover;
  2. licença e dependências documentadas;
  3. o código e a imagem de preview são nossos (o print é da nossa máquina, e a
     paisagem vem do gerador MIT);
  4. não sobrescreve configuração do usuário;
  5. aprovação é para listagem, não revisão de segurança.

## Depois de abrir

A validação e a baseline de segurança ficam presas ao commit exato. **Não
empurre nada até a decisão do mantenedor.** Se precisar, edite o corpo da issue
para re-disparar as checagens no HEAD novo. Atualização de plugin já listado é
pelo formulário `[Verify]:`.
