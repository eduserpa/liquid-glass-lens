# liquid-glass-lens

Botões de **vidro líquido** com refração de verdade: a imagem que está atrás do botão aparece **aumentada no centro**, **torcida na borda** e com as cores **separadas** (dispersão vermelho/azul), sem contorno desenhado. A borda existe só por luz e sombra.

Tudo roda na GPU (WebGL, um fragment shader pequeno). Aparelho fraco não baixa nem roda nada: fica com um botão simples de CSS.

- Sem dependências, um arquivo JS (~12 KB) e um CSS.
- Funciona igual em Chrome, Safari e Firefox (não usa `backdrop-filter: url()`).
- Licença MIT.

## Como funciona

1. O script acha, atrás de cada elemento `[data-liquid-glass]`, a `<img>` que o cobre.
2. Carrega essa imagem como textura WebGL (precisa ser da mesma origem ou ter CORS, veja Limites).
3. Um canvas WebGL compartilhado desenha o "vidro" do elemento: cápsula (círculo se for quadrado), aumento no centro, faixa de borda que "escorre" para dentro e leitura de R, G e B em pontos levemente diferentes (dispersão).
4. O resultado é copiado para um canvas 2D dentro do elemento. O CSS (`liquid-glass.css`) acrescenta as sombras internas claras e escuras que dão volume.
5. A cada quadro só mudam a posição e a escala da imagem (uniforms). Quando ela para de se mover, o laço para sozinho. Uma conferência a cada 0,5 s religa o laço se uma animação de CSS voltar a mexer a imagem.
6. A cor do ícone/texto se adapta: o script mede a luminância média da área atrás e grava `data-lg-ink="dark"` ou `"light"`.

## Uso

```html
<link rel="stylesheet" href="liquid-glass.css">

<div class="stage">
  <img src="foto.jpg" alt="">
  <button class="lg-btn" data-liquid-glass aria-label="Próximo">
    <svg viewBox="0 0 14 14" width="14" height="14" fill="none"><path d="m5 2 5 5-5 5" stroke="currentColor" stroke-width="1.5"/></svg>
  </button>
</div>

<script src="liquid-glass-lens.js" data-auto></script>
```

Sem `data-auto`, chame você mesmo:

```js
const lg = LiquidGlass({ magnify: 1.3, edgeBend: 0.56, dispersion: 4.4 });
lg.refresh(); // pede um redesenho
lg.destroy(); // remove as lentes e volta ao CSS simples
```

Veja `demo/index.html` (autocontido: a imagem é gerada por SVG).

Elementos precisam ter o texto/ícone em um filho (`<span>`, `<svg>`); o script insere um `<canvas class="lg-canvas">` como primeiro filho.

## Parâmetros

Objeto passado a `LiquidGlass({...})`:

| Opção | Padrão | O que faz |
|---|---|---|
| `selector` | `[data-liquid-glass]` | elementos que ganham a lente |
| `magnify` | `1.3` | aumento no centro (1 = nenhum) |
| `edgeBend` | `0.56` | quanto a borda "escorre" (torção) |
| `dispersion` | `4.4` | separação das cores na borda, em px |
| `band` | `0.55` | onde a curvatura começa, fração do raio (0 = lente toda) |
| `param` | `glass` | nome do parâmetro de URL de teste |
| `minCores` | `6` | núcleos mínimos (`hardwareConcurrency`) |
| `minMemory` | `4` | GB mínimos (`deviceMemory`, só quando o navegador informa) |
| `weakGpu` | regex | placas tratadas como fracas (SwiftShader, llvmpipe, Intel integrada, Radeon integrada...) |
| `maxFrameMs` | `20` | trava: média por quadro nos 30 primeiros quadros em movimento |
| `textureUrl` | `img.currentSrc` | função `(img) => url`; use para pedir uma versão menor ou com CORS |
| `onFallback` | `null` | função `(motivo)` chamada quando a lente não é usada |

Por elemento, atributos `data-` sobrepõem o objeto: `data-lg-magnify`, `data-lg-edge-bend`, `data-lg-dispersion`, `data-lg-band`.

No CSS: `--lg-size` (tamanho do botão redondo), `--lg-fallback-bg`, `--lg-fallback-border`, `--lg-ink`, `--lg-ink-dark`, `--lg-ink-light`, `--glass-reflex-light` e `--glass-reflex-dark` (0 a 2, força dos reflexos de luz e sombra).

## Quando a lente liga (e quando não)

O botão simples (`.lg-btn`: círculo cinza translúcido, borda de 1 px, texto branco, hover com aumento de 1,06x) é sempre o padrão. A lente só entra, depois do `load` e com o navegador ocioso, se **todos** os testes passam:

- WebGL disponível e shader compilado;
- `navigator.hardwareConcurrency >= minCores`;
- `navigator.deviceMemory >= minMemory` (Safari não informa: vale só os núcleos);
- placa que não seja software nem integrada (lida por `WEBGL_debug_renderer_info`);
- sem `prefers-reduced-motion: reduce` e sem `navigator.connection.saveData`;
- **trava em tempo real**: se a média dos primeiros 30 quadros passar de `maxFrameMs`, a lente se desliga sozinha e a decisão fica na sessão (`sessionStorage`).

Para testar: `?glass=1` força a lente (ignora placa e trava) e `?glass=0` força a versão simples. O valor fica na sessão.

## Limites

- **Imagem com CORS**: o WebGL recusa textura de outra origem sem `Access-Control-Allow-Origin`. O script pede a imagem de novo com `crossOrigin="anonymous"`. Imagem de CDN sem CORS cai na versão simples.
- A lente só refrata uma `<img>` (não `background-image`, vídeo ou texto) que fique **atrás** do elemento. Sem imagem atrás, o botão fica só com a luz e a sombra suaves.
- Uma segunda `<img>` com CORS é baixada por imagem de fundo (por padrão a mesma URL). Use `textureUrl` para apontar uma versão menor (1000 a 1500 px bastam).
- O canvas WebGL é compartilhado e redimensionado a cada elemento; centenas de lentes visíveis ao mesmo tempo não são o alvo (o script só desenha as que estão na tela).
- Máquinas sem GPU (headless, VMs) renderizam por software: lento por definição, por isso ficam na versão simples.
- `color-mix()` no CSS exige navegador de 2023 em diante; antes disso o botão perde só as sombras internas.

## Estrutura

```
liquid-glass-lens.js   a lente (WebGL, teste de aparelho, trava de quadros)
liquid-glass.css       versão simples + sombras da gotinha (variáveis)
demo/index.html        demonstração autocontida
```

## Licença

MIT. Veja o texto abaixo.

```
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
