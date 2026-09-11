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

# Modelos principais carregados na inicialização rápida (~3s)
PRIMARY_MODELS = [
    ("bria-rmbg", "BRIA RMBG-2.0"),
    ("u2net", "U2Net (Universal / Embalagens)"),
]

# Cascatas por modo de produto
CASCADES = {
    "packaging": [
        ("u2net", "U2Net (Universal / Embalagens)"),
        ("bria-rmbg", "BRIA RMBG-2.0"),
        ("isnet-general-use", "IS-Net"),
    ],
    "object": [
        ("bria-rmbg", "BRIA RMBG-2.0"),
        ("birefnet-general", "BiRefNet"),
        ("u2net", "U2Net (Universal / Embalagens)"),
    ],
    "auto": [
        ("bria-rmbg", "BRIA RMBG-2.0"),
        ("u2net", "U2Net (Universal / Embalagens)"),
        ("isnet-general-use", "IS-Net"),
        ("birefnet-general", "BiRefNet"),
    ],
}

# Carregar modelos principais na inicialização
print("LOADING", flush=True)

sessions = {}
for model_id, model_name in PRIMARY_MODELS:
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

def get_model_session(model_id, model_name):
    """Retorna a sessão do modelo, carregando sob demanda se ainda não estiver na memória."""
    if model_id not in sessions:
        try:
            sys.stderr.write(f"Carregando {model_name} ({model_id}) sob demanda...\n")
            sys.stderr.flush()
            sessions[model_id] = new_session(model_id)
            sys.stderr.write(f"{model_name} pronto!\n")
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"Falha ao carregar {model_name}: {e}\n")
            sys.stderr.flush()
    return sessions.get(model_id)

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


def refine_edges_advanced(result_rgba, min_threshold=70, erode_px=1):
    """
    Acabamento firme, nítido e comercial:
    1. Descontaminação de borda branca (Defringe) nos pixels semi-transparentes.
    2. Eliminação do esfumaçado: corta os pixels de alpha fraco (< min_threshold) que criam névoa/fumaça.
    3. Rampa rápida e estreita de transição: borda firme e sólida em vez de degradê esfumaçado.
    4. Erosão rente de 1px para evitar rebarbas.
    5. Anti-aliasing sub-pixel estreito de 1px, evitando serrilhados sem espalhar blur.
    """
    try:
        arr = np.array(result_rgba)
        if arr.ndim < 3 or arr.shape[2] < 4:
            return result_rgba

        rgb = arr[:, :, :3].astype(float)
        alpha = arr[:, :, 3].astype(float)

        # 1. Descontaminação de borda branca (Defringe)
        a_norm = np.clip(alpha / 255.0, 0.001, 1.0)[:, :, np.newaxis]
        unmixed = np.clip((rgb - 255.0 * (1.0 - a_norm)) / a_norm, 0, 255)
        transition_zone = (alpha > 5) & (alpha < 245)
        rgb[transition_zone] = unmixed[transition_zone]
        arr[:, :, :3] = rgb.astype(np.uint8)

        # 2. Borda Firme e Rígida (Elimina a penumbra/esfumaçado)
        a = alpha.copy()
        a[a < min_threshold] = 0.0

        # Rampa rápida de transição entre min_threshold e 185
        ramp = (a >= min_threshold) & (a < 185.0)
        a[ramp] = ((a[ramp] - min_threshold) / (185.0 - min_threshold)) * 255.0
        a[a >= 185.0] = 255.0

        a_uint = a.astype(np.uint8)

        # 3. Erosão precisa de 1px para acabamento rente
        if erode_px > 0:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_px * 2 + 1, erode_px * 2 + 1))
            a_uint = cv2.erode(a_uint, kernel, iterations=1)

        # 4. Anti-aliasing sub-pixel estrito de 1px (elimina serrilhado sem criar névoa)
        kernel_aa = np.array([[0, 1, 0], [1, 4, 1], [0, 1, 0]], dtype=float) / 8.0
        edge_mask = (cv2.dilate(a_uint, np.ones((3, 3), np.uint8)) - cv2.erode(a_uint, np.ones((3, 3), np.uint8))) > 0
        a_aa = cv2.filter2D(a_uint.astype(float), -1, kernel_aa)
        a_final = np.where(edge_mask, a_aa, a_uint).astype(np.uint8)

        arr[:, :, 3] = a_final
        return Image.fromarray(arr)
    except Exception as e:
        sys.stderr.write(f"Refine edges error: {e}\n")
        return result_rgba


def process_image(input_path, output_path, mode="auto"):
    """Remove o fundo usando cascata inteligente de modelos conforme o modo selecionado."""
    original = Image.open(input_path)
    orig_w, orig_h = original.size

    needs_resize = max(orig_w, orig_h) > MAX_PROCESS_SIZE

    if needs_resize:
        ratio = MAX_PROCESS_SIZE / max(orig_w, orig_h)
        new_w = int(orig_w * ratio)
        new_h = int(orig_h * ratio)
        process_img = original.resize((new_w, new_h), Image.BILINEAR)

        buf = io.BytesIO()
        process_img.save(buf, format='PNG')
        input_data = buf.getvalue()
    else:
        with open(input_path, 'rb') as f:
            input_data = f.read()

    # Selecionar cascata conforme o modo (packaging, object, auto)
    cascade = CASCADES.get(str(mode).lower(), CASCADES["auto"])

    result = None
    model_used = "none"

    for model_id, model_name in cascade:
        sess = get_model_session(model_id, model_name)
        if sess is None:
            continue
        try:
            sys.stderr.write(f"Processando (modo={mode}) com {model_name}...\n")
            sys.stderr.flush()
            output_data = remove(input_data, session=sess, alpha_matting=False)
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
        raise Exception("Todos os modelos da cascata falharam")

    if needs_resize:
        alpha = result.split()[-1]
        alpha_full = alpha.resize((orig_w, orig_h), Image.BILINEAR)
        alpha_arr = np.clip(np.array(alpha_full), 0, 255).astype(np.uint8)
        alpha_full = Image.fromarray(alpha_arr)
        original = original.convert('RGBA')
        original.putalpha(alpha_full)
        result = original

    # Pós-processamento de acabamento da IA: bordas mais firmes e nítidas (sem esfumaçado)
    result = refine_edges_advanced(result, min_threshold=70, erode_px=1)

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
        mode = parts[2] if len(parts) > 2 and parts[2] else "auto"

        (w, h), model = process_image(input_path, output_path, mode)
        print(f"OK|{w}|{h}|{model}", flush=True)
    except Exception as e:
        print(f"ERROR|{str(e)}", flush=True)
