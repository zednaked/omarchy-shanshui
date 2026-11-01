#version 440
// Uma faixa do rolo sendo pintada da esquerda para a direita.
//
// `ordem` guarda, por pixel, o atraso (0..1, 16 bits em R/G) do traco que
// ficou por cima ali; 0 e o papel. O pixel e pintado quando a frente passa
// de x + atraso * espalha: o fundo vai na dianteira, os detalhes atras.
// Tudo em coordenadas do mundo, entao faixas vizinhas casam sem emenda. Um
// ruido lento deixa a frente irregular, como pincel, e o grao do papel e
// posto aqui para ser igual no pintado e no vazio.
//
// Com profundidade ligada cada camada e uma faixa propria, com alfa (o que
// nao tem traco e transparente), e anda numa velocidade diferente; `frente`
// ja chega convertida para o mundo da camada, entao a frente de pintura fica
// no mesmo lugar da tela em todas. So a camada de tras poe o papel; `bruma`
// clareia as de longe em direcao ao papel.

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float frente;    // x da frente de pintura, no mundo
    float inicio;    // x do lado esquerdo desta faixa, no mundo
    float largura;   // largura da faixa, no mundo (a altura e 700)
    float espalha;   // quanto o atraso maximo empurra um traco para tras
    float suave;     // largura, no mundo, da borda em que a tinta entra
    float grao;      // intensidade do grao do papel
    float fundo;     // 1 na camada de tras: ela poe o papel (e o grao) por baixo
    float bruma;     // 0..1: quanto o traco desbota em direcao ao papel
    float desloc;    // mundo da camada -> mundo da camera, para o grao ficar na tela
    vec4 papel;
    vec4 tinta;
};

layout(binding = 1) uniform sampler2D quadro;
layout(binding = 2) uniform sampler2D ordem;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float ruido(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
    vec2 mundo = vec2(inicio + qt_TexCoord0.x * largura, qt_TexCoord0.y * 700.0);
    // O quadro vem em cinza neutro (0 tinta, 1 papel); a cor e posta aqui,
    // entao trocar tema, paleta ou inverter nao regenera nada.
    // O quadro chega com alfa pre-multiplicado, entao o cinza (r) ja vem
    // vezes o alfa: tinta * a + (papel - tinta) * r e a mistura pre-multiplicada.
    vec4 q = texture(quadro, qt_TexCoord0);
    vec3 c = tinta.rgb * q.a + (papel.rgb - tinta.rgb) * q.rgb;
    c = mix(c, papel.rgb * q.a, bruma);

    // A frente e igual para a faixa toda, entao as faixas que ela ja deixou
    // para tras (tudo pintado) ou ainda nao alcancou (nada pintado) pulam o
    // ruido e a leitura do mapa. A folga cobre a onda (+-75) e a borda.
    float a = 1.0;
    if (frente < inicio + largura + espalha + suave + 120.0) {
        vec4 o = texture(ordem, qt_TexCoord0);
        float cod = floor(o.r * 255.0 + 0.5) * 256.0 + floor(o.g * 255.0 + 0.5);
        if (cod > 0.0) {
            if (frente <= inicio - 120.0) {
                a = 0.0;
            } else {
                float atraso = (cod - 1.0) / 65534.0;
                float onda = (ruido(mundo / 90.0) - 0.5) * 120.0 + (ruido(mundo / 23.0) - 0.5) * 30.0;
                float quando = mundo.x + atraso * espalha + onda;
                a = smoothstep(quando, quando + suave, frente);
            }
        }
    }
    // Sobre o papel (so na camada de tras) ou sobre o nada.
    vec4 cor = vec4(c * a, q.a * a);
    cor += (1.0 - cor.a) * vec4(papel.rgb, 1.0) * fundo;
    float g = (hash(floor((mundo + vec2(desloc, 0.0)) * 3.0)) - 0.5) * grao;
    cor.rgb = mix(cor.rgb, tinta.rgb * cor.a, max(g, 0.0));
    fragColor = cor * qt_Opacity;
}
