# O que um revisor roda sem instalar nada (so node, librsvg e ImageMagick).
#
#   make test       tudo abaixo
#   make hostil     o que o gerar.js recusa, num $HOME descartavel
#   make emenda     duas faixas vizinhas = uma vista so, pixel a pixel
#   make determ     a mesma faixa sai igual em dois $HOME, e e reaproveitada
#   make validate   omarchy plugin validate .
#   make shader     recompila pintura.frag -> pintura.frag.qsb

QSB ?= /usr/lib/qt6/bin/qsb

.PHONY: test hostil emenda determ validate shader

test: hostil determ emenda

hostil:
	@echo "== gerar.js, hostil =="
	@node test/hostil.js

emenda:
	@echo "== emenda =="
	@node test/emenda.js

determ:
	@echo "== determinismo =="
	@node test/determinismo.js

validate:
	@omarchy plugin validate .

shader: pintura.frag.qsb

pintura.frag.qsb: pintura.frag
	$(QSB) --glsl "100 es,120,150" --hlsl 50 --msl 12 -o $@ $<
