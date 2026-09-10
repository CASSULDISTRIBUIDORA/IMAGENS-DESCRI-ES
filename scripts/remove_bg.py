"""
Background Remover - Servidor persistente com Cascata Inteligente de Modelos
Tenta os melhores modelos em ordem de qualidade:
  1. BEN v2 (ben_custom) - Melhor bordas, Confidence Guided Matting
  2. BRIA RMBG-2.0 (bria-rmbg) - Melhor para produtos/e-commerce
  3. BiRefNet (birefnet-general) - Robusto, uso geral

Mantém os modelos na memória para processamento rápido.
Comunica via stdin/stdout com o Electron.

Protocolo:
  INPUT:  <input_path>|<output_path>
  OUTPUT: OK|<width>|<height>|<model_used>
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

# Modelos em ordem de preferência (melhor primeiro)
MODEL_CASCADE = [
    ("bria-rmbg", "BRIA RMBG-2.0"),
    ("birefnet-general", "BiRefNet"),
]

# Carregar modelos na inicialização
print("LOADING", flush=True)

sessions = {}
for model_id, model_name in MODEL_CASCADE:
    try:
        sys.stderr.write(f"Carregando {model_name} ({model_id})...\n")
        sys.stderr.flush()
        sessions[model_id] = new_session(model_id)
        sys.stderr.write(f"{model_name} carregado com sucesso!\n")
        sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"Aviso: {model_name} indisponível ({e})\n")
        sys.stderr.flush()

if not sessions:
    sys.stderr.write("ERRO: Nenhum modelo disponível!\n")
    sys.exit(1)

# Reportar modelos disponíveis
available = [name for mid, name in MODEL_CASCADE if mid in sessions]
sys.stderr.write(f"Modelos prontos: {', '.join(available)}\n")
sys.stderr.flush()
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

        max_c = np.maximum(r, np.maximum(g, b))
        min_c = np.minimum(r, np.minimum(g, b))
        sat = max_c - min_c

        is_white_bg = (min_c > 220) & (sat < 25) & (alpha > 50)
        is_foreground = (alpha > 50) & ~is_white_bg

        if np.sum(is_white_bg) == 0 or np.sum(is_foreground) == 0:
            return result_rgba

        num, labels, stats, centroids = cv2.connectedComponentsWithStats(is_white_bg.astype(np.uint8), connectivity=8)
        cleaned_alpha = alpha.copy()
        cleaned_count = 0

        for i in range(1, num):
            area = stats[i, cv2.CC_STAT_AREA]
            if area < 30:
                continue

            comp_mask = (labels == i).astype(np.uint8)
            dilated = cv2.dilate(comp_mask, np.ones((5, 5), np.uint8))
            boundary = (dilated - comp_mask) > 0

            total_boundary = np.sum(boundary)
            if total_boundary == 0:
                continue

            foreground_touch = np.sum(boundary & is_foreground)
            trans_touch = np.sum(boundary & (alpha == 0))

            fg_ratio = foreground_touch / total_boundary
            trans_ratio = trans_touch / total_boundary

            if fg_ratio > 0.70 and trans_ratio < 0.15:
                cleaned_alpha[comp_mask > 0] = 0
                cleaned_count += 1

        if cleaned_count > 0:
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


def refine_alpha_edges(result_rgba, erode_px=1, blur_px=3):
    """
    Pós-processamento anti-halo: erode levemente o canal alpha
    e suaviza as bordas para eliminar franjas brancas/cinzas.
    """
    try:
        arr = np.array(result_rgba)
        if arr.ndim < 3 or arr.shape[2] < 4:
            return result_rgba

        alpha = arr[:, :, 3]

        # Erosão leve para remover pixels de borda semi-transparentes (halos)
        if erode_px > 0:
            kernel = np.ones((erode_px * 2 + 1, erode_px * 2 + 1), np.uint8)
            alpha = cv2.erode(alpha, kernel, iterations=1)

        # Suavização das bordas
        if blur_px > 0:
            # Criar máscara de borda
            edge_mask = cv2.dilate(alpha, np.ones((3, 3), np.uint8)) - cv2.erode(alpha, np.ones((3, 3), np.uint8))
            blurred = cv2.GaussianBlur(alpha, (blur_px, blur_px), 0)
            # Aplicar suavização apenas nas bordas
            alpha = np.where(edge_mask > 0, blurred, alpha)

        arr[:, :, 3] = alpha
        return Image.fromarray(arr)
    except Exception as e:
        sys.stderr.write(f"Alpha refinement error: {e}\n")
        return result_rgba


def process_image(input_path, output_path):
    """Remove o fundo usando cascata inteligente de modelos."""
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

    # Cascata: tentar cada modelo em ordem de qualidade
    result = None
    model_used = "none"

    for model_id, model_name in MODEL_CASCADE:
        if model_id not in sessions:
            continue
        try:
            sys.stderr.write(f"Processando com {model_name}...\n")
            sys.stderr.flush()
            output_data = remove(input_data, session=sessions[model_id], alpha_matting=False)
            result = Image.open(io.BytesIO(output_data))
            model_used = model_name
            sys.stderr.write(f"{model_name} concluído com sucesso!\n")
            sys.stderr.flush()
            break  # Sucesso, não precisa tentar o próximo
        except Exception as e:
            sys.stderr.write(f"{model_name} falhou: {e}. Tentando próximo...\n")
            sys.stderr.flush()
            continue

    if result is None:
        raise Exception("Todos os modelos falharam")

    if needs_resize:
        alpha = result.split()[-1]
        alpha_full = alpha.resize((orig_w, orig_h), Image.LANCZOS)
        original = original.convert('RGBA')
        original.putalpha(alpha_full)
        result = original

    # Pós-processamento desativado — BRIA/BiRefNet já produzem resultados limpos
    # result = clean_enclosed_cavities(result)
    # result = refine_alpha_edges(result, erode_px=1, blur_px=3)

    result.save(output_path, 'PNG')
    return result.size, model_used


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

        (w, h), model = process_image(input_path, output_path)
        print(f"OK|{w}|{h}|{model}", flush=True)
    except Exception as e:
        print(f"ERROR|{str(e)}", flush=True)
