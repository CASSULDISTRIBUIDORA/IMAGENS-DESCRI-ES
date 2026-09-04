"""
Chroma Key Background Remover - Scale-Adaptive v3
Preserva buracos internos (alças, espaços entre objetos).
Suavização adaptativa ao tamanho da imagem.

Uso: python chroma_key.py <chroma_input> <original_input> <output_path> [chroma_hex] [tolerance]
"""

import sys
import cv2
import numpy as np
from collections import Counter


def hex_to_bgr(hex_color):
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return (b, g, r)


def bgr_to_hex(bgr):
    return f'#{bgr[2]:02X}{bgr[1]:02X}{bgr[0]:02X}'


def detect_chroma_color(img, sample_size=30):
    """Detecta a cor dominante do fundo analisando os 4 cantos."""
    h, w = img.shape[:2]
    s = min(sample_size, h // 4, w // 4)
    
    corners = [
        img[0:s, 0:s],
        img[0:s, w-s:w],
        img[h-s:h, 0:s],
        img[h-s:h, w-s:w],
    ]
    
    all_pixels = np.vstack([c.reshape(-1, 3) for c in corners])
    quantized = (all_pixels // 8) * 8
    color_tuples = [tuple(c) for c in quantized]
    counter = Counter(color_tuples)
    dominant_quantized = counter.most_common(1)[0][0]
    mask_sel = np.all(quantized == dominant_quantized, axis=1)
    dominant_bgr = np.mean(all_pixels[mask_sel], axis=0).astype(int)
    
    return tuple(dominant_bgr)


def create_alpha_mask(chroma_img, chroma_bgr, tolerance=35):
    """Cria máscara alpha da imagem chroma. Preserva buracos internos."""
    chroma_pixel = np.uint8([[list(chroma_bgr)]])
    chroma_hsv = cv2.cvtColor(chroma_pixel, cv2.COLOR_BGR2HSV)[0][0]
    
    h_tol = int(tolerance * 0.6)
    s_tol = int(tolerance * 2.8)
    v_tol = int(tolerance * 2.8)
    
    lower = np.array([
        max(0, int(chroma_hsv[0]) - h_tol),
        max(0, int(chroma_hsv[1]) - s_tol),
        max(0, int(chroma_hsv[2]) - v_tol)
    ])
    upper = np.array([
        min(179, int(chroma_hsv[0]) + h_tol),
        min(255, int(chroma_hsv[1]) + s_tol),
        min(255, int(chroma_hsv[2]) + v_tol)
    ])
    
    hsv = cv2.cvtColor(chroma_img, cv2.COLOR_BGR2HSV)
    chroma_mask = cv2.inRange(hsv, lower, upper)
    
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    # Limpar ruído sem fechar buracos internos
    chroma_mask = cv2.morphologyEx(chroma_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    # Dilatar para pegar bordas residuais do chroma
    chroma_mask = cv2.dilate(chroma_mask, kernel, iterations=2)
    
    # Inverter: produto = 255, fundo (incluindo buracos) = 0
    return cv2.bitwise_not(chroma_mask)


def smooth_mask(mask, scale_factor):
    """
    Suaviza a máscara sem redesenhar contornos (preserva buracos internos).
    Usa operações morfológicas + blur adaptativo na zona de borda.
    """
    # Parâmetros adaptativos ao scale
    morph_size = max(3, int(2 * scale_factor + 1))
    if morph_size % 2 == 0:
        morph_size += 1  # Precisa ser ímpar para kernel
    
    blur_radius = max(1, int(1.5 * scale_factor + 0.5))
    blur_size = blur_radius * 2 + 1
    
    border_width = max(3, int(3 * scale_factor))
    
    # 1. Suavizar serrilhado com CLOSE + OPEN morfológico
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (morph_size, morph_size))
    smoothed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    smoothed = cv2.morphologyEx(smoothed, cv2.MORPH_OPEN, kernel, iterations=1)
    
    # 2. Criar zona de borda
    kernel_border = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, 
                                               (border_width, border_width))
    dilated = cv2.dilate(smoothed, kernel_border, iterations=1)
    eroded = cv2.erode(smoothed, kernel_border, iterations=1)
    border_zone = cv2.subtract(dilated, eroded)
    
    # 3. Aplicar blur APENAS na zona de borda (anti-aliasing)
    blurred = cv2.GaussianBlur(smoothed, (blur_size, blur_size), 0)
    result = np.where(border_zone > 0, blurred, smoothed)
    
    return result.astype(np.uint8)


def despill_fast(img, alpha_mask, chroma_bgr):
    """Remove color spill nos pixels de borda."""
    result = img.copy().astype(np.float32)
    
    chroma_channel = int(np.argmax(chroma_bgr))
    other_channels = [i for i in range(3) if i != chroma_channel]
    
    edge_mask = ((alpha_mask > 5) & (alpha_mask < 250)).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    edge_expanded = cv2.dilate(edge_mask, kernel, iterations=1)
    edge_zone = edge_expanded > 0
    
    max_other = np.maximum(result[:, :, other_channels[0]], result[:, :, other_channels[1]])
    spill_mask = edge_zone & (result[:, :, chroma_channel] > max_other)
    result[:, :, chroma_channel] = np.where(spill_mask, max_other, result[:, :, chroma_channel])
    
    return result.astype(np.uint8)


def remove_chroma(chroma_path, original_path, output_path, chroma_hex='auto', tolerance=35):
    """Remove fundo usando máscara do chroma, aplicada na imagem original."""
    chroma_img = cv2.imread(chroma_path, cv2.IMREAD_COLOR)
    original_img = cv2.imread(original_path, cv2.IMREAD_COLOR)
    
    if chroma_img is None:
        print(f"ERRO: Não foi possível ler chroma: {chroma_path}", file=sys.stderr)
        sys.exit(1)
    if original_img is None:
        print(f"ERRO: Não foi possível ler original: {original_path}", file=sys.stderr)
        sys.exit(1)
    
    # Detectar cor chroma
    if chroma_hex.lower() == 'auto':
        chroma_bgr = detect_chroma_color(chroma_img)
        chroma_hex = bgr_to_hex(chroma_bgr)
    else:
        chroma_bgr = hex_to_bgr(chroma_hex)
    
    # Criar máscara na resolução do chroma (preserva buracos)
    alpha_mask = create_alpha_mask(chroma_img, chroma_bgr, tolerance)
    
    # Calcular fator de escala
    orig_h, orig_w = original_img.shape[:2]
    chroma_h, chroma_w = chroma_img.shape[:2]
    scale_factor = max(orig_w / chroma_w, orig_h / chroma_h)
    
    # Escalar máscara com INTER_CUBIC
    if alpha_mask.shape[:2] != (orig_h, orig_w):
        alpha_mask = cv2.resize(alpha_mask, (orig_w, orig_h), interpolation=cv2.INTER_CUBIC)
        alpha_mask = np.clip(alpha_mask, 0, 255).astype(np.uint8)
    
    # Suavizar máscara (scale-adaptive, preserva buracos)
    alpha_mask = smooth_mask(alpha_mask, scale_factor)
    
    # Despill
    original_despilled = despill_fast(original_img, alpha_mask, chroma_bgr)
    
    # Criar BGRA
    b, g, r = cv2.split(original_despilled)
    result = cv2.merge([b, g, r, alpha_mask])
    
    cv2.imwrite(output_path, result)
    
    print(f"OK|{orig_w}|{orig_h}|{chroma_hex}|scale:{scale_factor:.1f}")


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Uso: python chroma_key.py <chroma_img> <original_img> <output> [chroma_hex|auto] [tolerance]")
        sys.exit(1)
    
    chroma_path = sys.argv[1]
    original_path = sys.argv[2]
    output_path = sys.argv[3]
    chroma_hex = sys.argv[4] if len(sys.argv) > 4 else 'auto'
    tolerance = int(sys.argv[5]) if len(sys.argv) > 5 else 35
    
    remove_chroma(chroma_path, original_path, output_path, chroma_hex, tolerance)
