"""
Background Remover - Servidor persistente com BiRefNet + Detecção de Cavidades/Buracos Internos
Mantém o modelo na memória para processamento rápido.
Comunica via stdin/stdout com o Electron.

Protocolo:
  INPUT:  <input_path>|<output_path>
  OUTPUT: OK|<width>|<height>
  QUIT:   EXIT
"""

import sys
import os
import io
import cv2
import numpy as np
from rembg import remove, new_session
from PIL import Image

MAX_PROCESS_SIZE = 1024

# Carregar modelo na inicialização (uma vez só)
print("LOADING", flush=True)
session = new_session("birefnet-general")
print("READY", flush=True)


def clean_enclosed_cavities(result_rgba):
    """
    Detecta e limpa cavidades e buracos fechados internos (como aros de tesouras,
    alças de canecas, vazados de ferramentas) onde o fundo original ficou retido.
    """
    try:
        arr = np.array(result_rgba)
        if arr.ndim < 3 or arr.shape[2] < 4:
            return result_rgba

        alpha = arr[:, :, 3]
        h, w = alpha.shape

        r = arr[:, :, 0].astype(int)
        g = arr[:, :, 1].astype(int)
        b = arr[:, :, 2].astype(int)

        # Critério de fundo branco/neutro claro:
        # Alto brilho em todos os canais e baixa saturação de cor
        max_c = np.maximum(r, np.maximum(g, b))
        min_c = np.minimum(r, np.minimum(g, b))
        sat = max_c - min_c

        # Pixels que correspondem a fundo branco retido
        is_white_bg = (min_c > 220) & (sat < 25) & (alpha > 50)
        # Pixels que são o objeto real (opaco e não-branco)
        is_foreground = (alpha > 50) & ~is_white_bg

        if np.sum(is_white_bg) == 0 or np.sum(is_foreground) == 0:
            return result_rgba

        # Componentes conexos dos pixels brancos
        num, labels, stats, centroids = cv2.connectedComponentsWithStats(is_white_bg.astype(np.uint8), connectivity=8)
        cleaned_alpha = alpha.copy()
        cleaned_count = 0

        for i in range(1, num):
            area = stats[i, cv2.CC_STAT_AREA]
            # Buracos perceptíveis têm pelo menos 30 pixels
            if area < 30:
                continue

            comp_mask = (labels == i).astype(np.uint8)

            # Dilatação de 5 pixels para verificar o contorno que cerca essa área branca
            dilated = cv2.dilate(comp_mask, np.ones((5, 5), np.uint8))
            boundary = (dilated - comp_mask) > 0

            total_boundary = np.sum(boundary)
            if total_boundary == 0:
                continue

            foreground_touch = np.sum(boundary & is_foreground)
            trans_touch = np.sum(boundary & (alpha == 0))

            fg_ratio = foreground_touch / total_boundary
            trans_ratio = trans_touch / total_boundary

            # Se mais de 70% da borda toca o objeto e quase nada toca o fundo transparente externo:
            # É uma cavidade/buraco interno cercado pelo objeto!
            if fg_ratio > 0.70 and trans_ratio < 0.15:
                cleaned_alpha[comp_mask > 0] = 0
                cleaned_count += 1

        if cleaned_count > 0:
            # Suavizar levemente as bordas internas do corte para anti-aliasing perfeito
            mask_diff = (alpha > 0) & (cleaned_alpha == 0)
            dilated_diff = cv2.dilate(mask_diff.astype(np.uint8), np.ones((3, 3), np.uint8))
            blurred_alpha = cv2.GaussianBlur(cleaned_alpha, (3, 3), 0)
            edge_zone = (dilated_diff > 0) & (cleaned_alpha > 0) & (cleaned_alpha < 255)
            cleaned_alpha[edge_zone] = blurred_alpha[edge_zone]

            arr[:, :, 3] = cleaned_alpha
            return Image.fromarray(arr)

        return result_rgba
    except Exception as e:
        sys.stderr.write(f"Cavity cleaning error: {e}\n")
        return result_rgba


def process_image(input_path, output_path):
    """Remove o fundo de uma imagem e limpa cavidades internas."""
    original = Image.open(input_path)
    orig_w, orig_h = original.size

    needs_resize = max(orig_w, orig_h) > MAX_PROCESS_SIZE

    if needs_resize:
        ratio = MAX_PROCESS_SIZE / max(orig_w, orig_h)
        new_w = int(orig_w * ratio)
        new_h = int(orig_h * ratio)
        process_img = original.resize((new_w, new_h), Image.LANCZOS)

        buf = io.BytesIO()
        process_img.save(buf, format='PNG')
        input_data = buf.getvalue()
    else:
        with open(input_path, 'rb') as f:
            input_data = f.read()

    output_data = remove(input_data, session=session, alpha_matting=False)
    result = Image.open(io.BytesIO(output_data))

    if needs_resize:
        alpha = result.split()[-1]
        alpha_full = alpha.resize((orig_w, orig_h), Image.LANCZOS)
        original = original.convert('RGBA')
        original.putalpha(alpha_full)
        result = original

    # Limpar buracos e cavidades internas (aros da tesoura)
    result = clean_enclosed_cavities(result)

    result.save(output_path, 'PNG')
    return result.size


# Loop principal - lê comandos do stdin
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    if line == 'EXIT':
        break

    try:
        parts = line.split('|')
        input_path = parts[0]
        output_path = parts[1]

        w, h = process_image(input_path, output_path)
        print(f"OK|{w}|{h}", flush=True)
    except Exception as e:
        print(f"ERROR|{str(e)}", flush=True)
