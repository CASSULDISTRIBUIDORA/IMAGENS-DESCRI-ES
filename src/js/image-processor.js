/**
 * ImageProcessor - Processamento de imagens para o MultiPic
 * Inclui remoção de fundo, ajustes visuais e transformações
 */
class ImageProcessor {
  constructor() {
    this.bgRemovalModule = null;
    this.bgRemovalConfig = {
      progress: (key, current, total) => {
        const progressEvent = new CustomEvent('bgRemovalProgress', { 
          detail: { key, current, total } 
        });
        window.dispatchEvent(progressEvent);
      }
    };
  }

  /**
   * Remove o fundo da imagem usando @imgly/background-removal
   * @param {string|Blob} imageSource - URL, blob ou base64
   * @returns {Promise<Blob>}
   */
  async removeBg(imageSource) {
    try {
      if (!this.bgRemovalModule) {
        this.bgRemovalModule = await import('@imgly/background-removal');
      }
      const removeBackground = this.bgRemovalModule.default || this.bgRemovalModule.removeBackground;
      const blob = await removeBackground(imageSource, this.bgRemovalConfig);
      return blob;
    } catch (error) {
      console.error('Erro ao remover fundo:', error);
      throw error;
    }
  }

  /**
   * Aplica ajustes visuais na imagem via manipulação de pixels
   * @param {HTMLCanvasElement} canvas 
   * @param {Object} adj - { brightness, contrast, saturation, temperature, hue, highlights, shadows, whites, blacks }
   * @returns {HTMLCanvasElement}
   */
  applyAdjustments(canvas, adj) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    const brightness = adj.brightness || 0;
    const contrastVal = adj.contrast || 0;
    const saturation = adj.saturation || 0;
    const temperature = adj.temperature || 0;
    const hue = adj.hue || 0;
    const highlights = adj.highlights || 0;
    const shadows = adj.shadows || 0;
    const whites = adj.whites || 0;
    const blacks = adj.blacks || 0;

    // Se tudo é zero, não precisa processar
    if (brightness === 0 && contrastVal === 0 && saturation === 0 && 
        temperature === 0 && hue === 0 && highlights === 0 && 
        shadows === 0 && whites === 0 && blacks === 0) {
      return canvas;
    }

    // Fator de contraste: mapeia -100..100 para C = -255..255
    // Fórmula padrão: cf = (259*(C+255)) / (255*(259-C))
    // Quando C=0 → cf=1.0 (sem mudança)
    const C = contrastVal * 2.55;
    const cf = (259 * (C + 255)) / (255 * (259 - C));

    for (let i = 0; i < data.length; i += 4) {
      // Ignora pixels totalmente transparentes
      if (data[i + 3] === 0) continue;

      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // 1. Brilho
      r += brightness * 2.55;
      g += brightness * 2.55;
      b += brightness * 2.55;

      // 2. Contraste
      r = cf * (r - 128) + 128;
      g = cf * (g - 128) + 128;
      b = cf * (b - 128) + 128;

      // 3. Temperatura (quente = +R -B, frio = -R +B)
      if (temperature !== 0) {
        r += temperature * 1.5;
        b -= temperature * 1.5;
      }

      // 4. Calcular luminosidade para ajustes por faixa
      let lum = (r * 0.299 + g * 0.587 + b * 0.114);

      // 5. Sombras (afeta tons escuros, lum < 85)
      if (shadows !== 0 && lum < 85) {
        const factor = (85 - lum) / 85;
        r += shadows * factor * 1.5;
        g += shadows * factor * 1.5;
        b += shadows * factor * 1.5;
      }

      // 6. Destaques (afeta tons claros, lum > 170)
      if (highlights !== 0 && lum > 170) {
        const factor = (lum - 170) / 85;
        r += highlights * factor * 1.5;
        g += highlights * factor * 1.5;
        b += highlights * factor * 1.5;
      }

      // 7. Pretos (afeta tons muito escuros, lum < 50)
      if (blacks !== 0 && lum < 50) {
        const factor = (50 - lum) / 50;
        r += blacks * factor * 1.2;
        g += blacks * factor * 1.2;
        b += blacks * factor * 1.2;
      }

      // 8. Brancos (afeta tons muito claros, lum > 200)
      if (whites !== 0 && lum > 200) {
        const factor = (lum - 200) / 55;
        r += whites * factor * 1.2;
        g += whites * factor * 1.2;
        b += whites * factor * 1.2;
      }

      // 9. Saturação e Matiz via HSL
      if (saturation !== 0 || hue !== 0) {
        let [h, s, l] = this._rgbToHsl(
          Math.max(0, Math.min(255, r)),
          Math.max(0, Math.min(255, g)),
          Math.max(0, Math.min(255, b))
        );

        // Saturação: mapeia -100..100 para 0..2x
        if (saturation !== 0) {
          s = s * (1 + saturation / 100);
          s = Math.max(0, Math.min(1, s));
        }

        // Matiz: rotaciona o ângulo
        if (hue !== 0) {
          h = (h + hue / 360 + 1) % 1;
        }

        const rgb = this._hslToRgb(h, s, l);
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
      }

      // Clamp final
      data[i]     = Math.max(0, Math.min(255, Math.round(r)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Calcula ajustes automáticos analisando o histograma da imagem
   * @param {HTMLCanvasElement} canvas 
   * @returns {Object}
   */
  autoAdjust(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    let totalLum = 0;
    let minLum = 255;
    let maxLum = 0;
    let pixelCount = 0;
    let totalSat = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      totalLum += lum;
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
      
      // Calcular saturação média
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      totalSat += sat;
      
      pixelCount++;
    }

    if (pixelCount === 0) {
      return { brightness: 0, contrast: 0, saturation: 0, temperature: 0, hue: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
    }

    const avgLum = totalLum / pixelCount;
    const avgSat = totalSat / pixelCount;
    const lumRange = maxLum - minLum;

    // Brilho: ajustar suavemente para luminosidade média de ~128
    let brightness = Math.round((128 - avgLum) * 0.15);
    brightness = Math.max(-15, Math.min(15, brightness));

    // Contraste: se o range é baixo, aumentar levemente
    let contrast = 0;
    if (lumRange < 160) {
      contrast = Math.round((180 - lumRange) * 0.08);
      contrast = Math.max(0, Math.min(15, contrast));
    }

    // Saturação: apenas se muito dessaturada
    let satAdj = 0;
    if (avgSat < 0.2) {
      satAdj = Math.round((0.3 - avgSat) * 20);
      satAdj = Math.max(0, Math.min(10, satAdj));
    }

    return {
      brightness,
      contrast,
      saturation: satAdj,
      temperature: 0,
      hue: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0
    };
  }

  /**
   * Aplica transformações: zoom, rotação e posição
   * @param {HTMLCanvasElement} sourceCanvas 
   * @param {Object} transform - { zoom, posX, posY, rotation }
   * @returns {HTMLCanvasElement}
   */
  applyTransform(sourceCanvas, { zoom = 1, posX = 0, posY = 0, rotation = 0 }) {
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.translate(canvas.width / 2 + posX, canvas.height / 2 + posY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    
    ctx.drawImage(sourceCanvas, 0, 0);
    
    return canvas;
  }

  /**
   * Gera base64 da imagem a partir do canvas
   * @param {HTMLCanvasElement} canvas 
   * @param {string} format - 'png' ou 'jpeg'
   * @returns {string} data URL completo
   */
  canvasToBase64(canvas, format = 'jpeg') {
    return canvas.toDataURL(`image/${format}`, 0.92);
  }

  // --- Helpers de conversão de cor ---

  _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h, s, l];
  }

  _hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
}

window.ImageProcessor = ImageProcessor;
