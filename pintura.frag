#version 440
// Uma faixa do rolo sendo pintada da esquerda para a direita.
//
// `ordem` guarda, por pixel, o atraso (0..1, 16 bits em R/G) do traco que
// ficou por cima ali; 0 e o papel. O pixel e pintado quando a frente passa
// de x + atraso * espalha: o fundo vai na dianteira, os detalhes atras.
// Tudo em coordenadas do mundo, entao faixas vizinhas casam sem emenda. Um
// ruido lento deixa a frente irregular, como pincel, e o grao do papel e
// posto aqui para ser igual no pintado e no vazio.

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
    vec4 o = texture(ordem, qt_TexCoord0);
    float cod = floor(o.r * 255.0 + 0.5) * 256.0 + floor(o.g * 255.0 + 0.5);
    // O quadro vem em cinza neutro (0 tinta, 1 papel); a cor e posta aqui,
    // entao trocar tema, paleta ou inverter nao regenera nada.
    vec3 c = mix(tinta.rgb, papel.rgb, texture(quadro, qt_TexCoord0).r);

    float a = 1.0;
    if (cod > 0.0) {
        float atraso = (cod - 1.0) / 65534.0;
        float onda = (ruido(mundo / 90.0) - 0.5) * 120.0 + (ruido(mundo / 23.0) - 0.5) * 30.0;
        float quando = mundo.x + atraso * espalha + onda;
        a = smoothstep(quando, quando + suave, frente);
    }
    vec4 cor = vec4(mix(papel.rgb, c, a), 1.0);
    float g = (hash(floor(mundo * 3.0)) - 0.5) * grao;
    cor.rgb = mix(cor.rgb, tinta.rgb, max(g, 0.0));
    fragColor = vec4(cor.rgb, 1.0) * qt_Opacity;
}
