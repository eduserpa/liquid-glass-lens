/*!
 * liquid-glass-lens: botões de vidro líquido com refração (aumento, torção da borda e dispersão R/G/B) em WebGL.
 * Licença MIT. Sem dependências. Veja o README.md.
 *
 * Uso mínimo:
 *   <link rel="stylesheet" href="liquid-glass.css">
 *   <button class="lg-btn" data-liquid-glass>...</button>
 *   <script src="liquid-glass-lens.js"></script>
 *
 * Como funciona: um único canvas WebGL compartilhado desenha, para cada elemento, a imagem (<img>) que está atrás dele
 * com aumento no centro, torção na faixa da borda e dispersão (R, G e B lidos em pontos levemente diferentes), tudo no
 * fragment shader. O resultado é copiado para um canvas 2D dentro do elemento. A cada quadro só mudam posição e escala
 * da imagem (uniforms); quando ela para de se mover, o laço para. Sem WebGL ou com movimento reduzido, o elemento fica
 * com a versão simples do CSS.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    selector: '[data-liquid-glass]', // elementos que ganham a lente
    magnify: 1.3, // aumento no centro (1 = sem aumento)
    edgeBend: 0.56, // quanto a borda "escorre" (torção)
    dispersion: 4.4, // separação das cores na borda, em px
    band: 0.55, // onde a curvatura começa, fração do raio (0 = lente toda, 0.9 = só uma fita)
    textureUrl: function (img) { return img.currentSrc || img.src; }, // troque para pedir uma versão menor/CORS da imagem
    onFallback: null // function (motivo) chamada quando a lente não é usada
  };

  var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  // p em px CSS a partir do centro. Cápsula (círculo se for quadrado). e = intensidade da borda (0 no miolo, 1 no limite).
  var FS = [
    'precision highp float;',
    'uniform sampler2D t;uniform vec4 rect;uniform vec2 size;uniform float dpr,has,k,M,BEND,DISP,BAND;',
    'void main(){',
    '  vec2 hs=size*.5, p=vec2(gl_FragCoord.x,size.y*dpr-gl_FragCoord.y)/dpr-hs;',
    '  float r=min(hs.x,hs.y);',
    '  vec2 q=abs(p)-(hs-r), o=max(q,0.);',
    '  float d=length(o)+min(max(q.x,q.y),0.)-r;', // negativo dentro
    '  float a=clamp(-d*dpr+.5,0.,1.);',
    '  vec2 n=length(o)>.001?normalize(o)*sign(p):(q.x>q.y?vec2(sign(p.x),0.):vec2(0.,sign(p.y)));',
    '  float rho=clamp(1.+d/r,0.,1.);', // 0 no centro, 1 na borda
    '  float e=clamp((rho-BAND)/(1.-BAND),0.,1.);e*=e;',
    '  vec2 base=p/M+n*BEND*e*r;',
    '  float disp=DISP/r*e;',
    '  vec3 col=vec3(0.);',
    '  if(has>.5){',
    '    col.r=texture2D(t,(hs+base*(1.+disp)-rect.xy)/rect.zw).r;',
    '    col.g=texture2D(t,(hs+base-rect.xy)/rect.zw).g;',
    '    col.b=texture2D(t,(hs+base*(1.-disp)-rect.xy)/rect.zw).b;',
    '  }',
    '  float lit=smoothstep(.55,1.,rho)*.07*k, sh=smoothstep(0.,1.,p.y/hs.y)*.1*k;', // luz e sombra leves, sem contorno
    '  if(has>.5){gl_FragColor=vec4(mix(col,vec3(1.),lit)*(1.-sh)*a,a);}',
    '  else{gl_FragColor=vec4(vec3(lit)*a,(lit+sh*(1.-lit))*a);}',
    '}'
  ].join('\n');

  function LiquidGlass(options) {
    var opt = Object.assign({}, DEFAULTS, options || {});
    var doc = document, html = doc.documentElement;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var visible = new Set(), lenses = new Map(), pics = new Map();
    var gl, prog, loc, glc, io, raf = 0, still = 0, last = 0, timer = 0, dead = false;

    function clamp(v) { return Math.max(0, Math.min(1, v)); }
    function fallback(why) { if (opt.onFallback) opt.onFallback(why); return false; }

    // ---- decisão: sem WebGL ou com movimento reduzido, fica a versão simples ----------------------------------------------
    function allowed() {
      if (!root.WebGLRenderingContext) return fallback('sem WebGL');
      if (reduce) return fallback('movimento reduzido');
      return true;
    }

    // ---- WebGL ----------------------------------------------------------------------------------------------------------
    function initGL() {
      glc = doc.createElement('canvas');
      gl = glc.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
      if (!gl) return fallback('WebGL indisponível');
      function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
      var v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
      if (!v || !f) return fallback('shader não compilou');
      prog = gl.createProgram();
      gl.attachShader(prog, v);
      gl.attachShader(prog, f);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return fallback('programa não ligou');
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var a = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      loc = {};
      ['t', 'rect', 'size', 'dpr', 'has', 'k', 'M', 'BEND', 'DISP', 'BAND'].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      glc.addEventListener('webglcontextlost', function (e) { e.preventDefault(); destroy(); fallback('contexto WebGL perdido'); });
      return true;
    }

    // Textura: o WebGL só aceita imagem same-origin ou com CORS. Pedimos a imagem de novo com crossOrigin="anonymous".
    function picFor(img) {
      var src = opt.textureUrl(img), hit = pics.get(src);
      if (hit) return hit === 'wait' || hit === 'fail' ? null : hit;
      pics.set(src, 'wait');
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () {
        if (dead) return;
        try {
          var tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
          [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]
            .forEach(function (kv) { gl.texParameteri(gl.TEXTURE_2D, kv[0], kv[1]); });
          pics.set(src, { img: im, tex: tex });
          lenses.forEach(function (L) { L.sig = ''; });
          wake();
        } catch (e) { pics.set(src, 'fail'); }
      };
      im.onerror = function () { pics.set(src, 'fail'); };
      im.src = src;
      return null;
    }

    // ---- geometria da imagem atrás (object-fit cover/contain/fill) -------------------------------------------------------
    function content(img) {
      var r = img.getBoundingClientRect(), nw = img.naturalWidth, nh = img.naturalHeight;
      var cs = getComputedStyle(img), fit = cs.objectFit;
      if (fit !== 'cover' && fit !== 'contain') return [r.left, r.top, r.width, r.height];
      var s = (fit === 'cover' ? Math.max : Math.min)(r.width / nw, r.height / nh);
      var pos = cs.objectPosition.split(' ').map(function (v) { return v.slice(-1) === '%' ? parseFloat(v) / 100 : 0.5; });
      return [r.left + (r.width - nw * s) * pos[0], r.top + (r.height - nh * s) * (pos[1] === undefined ? 0.5 : pos[1]), nw * s, nh * s];
    }

    // Luminância média atrás do elemento (16x16, só quando a imagem muda): grava data-lg-ink="dark|light" para o ícone/texto.
    function ink(L, pic, geo, r) {
      try {
        var S = 16, cv = (L.ink = L.ink || doc.createElement('canvas')), c = cv.getContext('2d', { willReadFrequently: true });
        cv.width = cv.height = S;
        c.drawImage(pic.img, ((geo[0] - r.left) / r.width) * S, ((geo[1] - r.top) / r.height) * S, (geo[2] / r.width) * S, (geo[3] / r.height) * S);
        var d = c.getImageData(0, 0, S, S).data, sum = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) {
          var lin = [d[i], d[i + 1], d[i + 2]].map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
          sum += 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
          n++;
        }
        L.el.setAttribute('data-lg-ink', sum / n > 0.24 ? 'dark' : 'light'); // 0,24 = ponto em que #303136 e #fff têm o mesmo contraste
      } catch (e) { /* imagem marcada: mantém a cor do CSS */ }
    }

    // ---- por elemento -----------------------------------------------------------------------------------------------------
    function make(el) {
      var canvas = doc.createElement('canvas');
      canvas.className = 'lg-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.insertBefore(canvas, el.firstChild);
      el.classList.add('is-lens');
      var num = function (n, d) { var v = parseFloat(el.getAttribute('data-lg-' + n)); return isNaN(v) ? d : v; };
      if (el.hasAttribute('data-lg-draggable')) draggable(el);
      return { el: el, canvas: canvas, ctx: canvas.getContext('2d'), img: null, sig: '', src: null,
        M: num('magnify', opt.magnify), BEND: num('edge-bend', opt.edgeBend), DISP: num('dispersion', opt.dispersion), BAND: num('band', opt.band) };
    }

    // Arrastável (opcional, data-lg-draggable): estica na direção do movimento e volta com mola ao soltar.
    function draggable(el) {
      var x = 0, y = 0, ox = 0, oy = 0, px = 0, py = 0, id = null;
      el.style.touchAction = 'none';
      el.style.cursor = 'grab';
      function place(sx, sy) { el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + sx + ',' + sy + ')'; wake(); }
      el.addEventListener('pointerdown', function (e) {
        id = e.pointerId; el.setPointerCapture(id);
        ox = e.clientX - x; oy = e.clientY - y; px = e.clientX; py = e.clientY;
        el.style.transition = 'none'; el.style.cursor = 'grabbing';
      });
      el.addEventListener('pointermove', function (e) {
        if (e.pointerId !== id) return;
        var vx = e.clientX - px, vy = e.clientY - py, v = Math.hypot(vx, vy) || 1, s = reduce ? 0 : Math.min(v / 45, 0.22);
        px = e.clientX; py = e.clientY; x = e.clientX - ox; y = e.clientY - oy;
        var cx = Math.abs(vx) / v, cy = Math.abs(vy) / v; // estica no eixo do movimento, afina no outro
        place(1 + s * cx - s * 0.6 * cy, 1 + s * cy - s * 0.6 * cx);
      });
      function up(e) {
        if (e.pointerId !== id) return;
        id = null; el.style.cursor = 'grab';
        el.style.transition = reduce ? 'none' : 'transform .5s cubic-bezier(.34,1.56,.64,1)';
        place(1, 1);
        var t0 = performance.now();
        (function follow(now) { wake(); if (now - t0 < 550) requestAnimationFrame(follow); })(t0);
      }
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }

    // Um quadro de um elemento: acha a imagem atrás (a cada 250 ms), sobe os uniforms e desenha na GPU. true = algo mudou.
    function frame(L, recheck) {
      var el = L.el, r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      if (recheck || !L.img || !L.img.isConnected) {
        L.img = Array.prototype.find.call(doc.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2), function (e) {
          return e.tagName === 'IMG' && e.complete && e.naturalWidth && !el.contains(e);
        }) || null;
      }
      var dpr = Math.min(root.devicePixelRatio || 1, 2), pic = L.img && picFor(L.img);
      var geo = pic ? content(L.img) : null;
      var sig = pic ? [L.img.currentSrc, geo.map(function (v) { return v.toFixed(1); }).join(','), r.left.toFixed(1), r.top.toFixed(1), r.width, r.height, dpr].join('|') : 'x' + r.width + 'x' + r.height + dpr;
      if (sig === L.sig) return false;
      var srcChanged = L.src !== (L.img && L.img.currentSrc);
      L.src = L.img && L.img.currentSrc;
      L.sig = sig;
      var W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (glc.width !== W || glc.height !== H) { glc.width = W; glc.height = H; }
      if (L.canvas.width !== W || L.canvas.height !== H) { L.canvas.width = W; L.canvas.height = H; }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(loc.size, r.width, r.height);
      gl.uniform1f(loc.dpr, W / r.width);
      gl.uniform1f(loc.has, pic ? 1 : 0);
      gl.uniform1f(loc.k, pic ? 1 : 2.2);
      gl.uniform1f(loc.M, L.M);
      gl.uniform1f(loc.BEND, L.BEND);
      gl.uniform1f(loc.DISP, L.DISP);
      gl.uniform1f(loc.BAND, L.BAND);
      if (pic) {
        gl.bindTexture(gl.TEXTURE_2D, pic.tex);
        gl.uniform1i(loc.t, 0);
        gl.uniform4f(loc.rect, geo[0] - r.left, geo[1] - r.top, geo[2], geo[3]);
        if (srcChanged || !el.hasAttribute('data-lg-ink')) ink(L, pic, geo, r);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      L.ctx.clearRect(0, 0, W, H);
      L.ctx.drawImage(glc, 0, 0);
      return true;
    }

    // ---- laço: roda enquanto a imagem se move e para sozinho ---------------------------------------------------------------
    function loop(now) {
      raf = 0;
      if (dead || doc.hidden) return;
      var recheck = now - last > 250, moved = false;
      if (recheck) last = now;
      visible.forEach(function (el) { var L = lenses.get(el); if (L && frame(L, recheck)) moved = true; });
      still = moved ? 0 : still + 1;
      if (still < 30) raf = requestAnimationFrame(loop);
    }
    function wake() { still = 0; if (!raf && !dead) raf = requestAnimationFrame(loop); }

    function destroy() {
      dead = true;
      if (io) io.disconnect();
      clearInterval(timer);
      lenses.forEach(function (L) { L.el.classList.remove('is-lens'); L.el.removeAttribute('data-lg-ink'); L.canvas.remove(); });
      lenses.clear();
      visible.clear();
      html.classList.remove('lg-on');
    }

    function start() {
      if (!allowed() || !initGL()) return;
      html.classList.add('lg-on');
      io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { if (!lenses.has(e.target)) lenses.set(e.target, make(e.target)); visible.add(e.target); } else visible.delete(e.target);
        });
        wake();
      });
      function scan() { doc.querySelectorAll(opt.selector).forEach(function (el) { if (!el.__lg) { el.__lg = 1; io.observe(el); } }); }
      scan();
      root.addEventListener('load', function () { scan(); wake(); });
      root.addEventListener('resize', wake);
      doc.addEventListener('visibilitychange', wake);
      ['click', 'transitionrun', 'transitionend', 'animationstart', 'animationend', 'load'].forEach(function (t) { doc.addEventListener(t, wake, true); });
      // uma animação de CSS sem evento (zoom lento) é percebida por esta conferência, 2 vezes por segundo
      timer = setInterval(function () { if (!doc.hidden && !raf) wake(); }, 500);
    }

    // só depois do load e com o navegador ocioso: a lente nunca pesa na abertura da página
    function later() { (root.requestIdleCallback || function (fn) { setTimeout(fn, 400); })(start, { timeout: 3000 }); }
    if (doc.readyState === 'complete') later(); else root.addEventListener('load', later);

    return { destroy: destroy, refresh: wake };
  }

  root.LiquidGlass = LiquidGlass;
  // Carrega sozinho com <script src="liquid-glass-lens.js" data-auto></script>; sem data-auto chame LiquidGlass({...}).
  var cs = document.currentScript;
  if (cs && cs.hasAttribute('data-auto')) LiquidGlass();
})(window);
