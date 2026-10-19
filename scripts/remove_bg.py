"""
Background Remover - Servidor persistente com orquestração inteligente
Integração:
  1. Florence-2 (Localização Semântica do Produto Físico)
  2. SAM 2.1 (Segmentação Precisa Guiada por Prompt)
  3. Remoção Conectada Chroma Key (Laranja do Upscale / Verde de Estúdio)
  4. Cascata Resiliente de Modelos Legados (BRIA, BiRefNet, IS-Net, U2Net)

Mantém os modelos na memória para processamento rápido sob demanda.
Comunica via stdin/stdout com o Electron.
"""

import sys
import os
import io
import json
import traceback
import cv2
import numpy as np
from rembg import remove, new_session
from PIL import Image

# Importação dos módulos especializados
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import florence_ai
except ImportError as e:
    sys.stderr.write(f"Aviso: Módulo florence_ai indisponível: {e}\n")
    florence_ai = None

try:
    import sam2_ai
except ImportError as e:
    sys.stderr.write(f"Aviso: Módulo sam2_ai indisponível: {e}\n")
    sam2_ai = None

MAX_PROCESS_SIZE = 1024
MAX_SEGMENTATION_RETRIES = 3

import onnxruntime as ort

# Modelos principais legados carregados na inicialização rápida (~3s)
PRIMARY_MODELS = [
    ("isnet-general-use", "IS-Net (Ultra Rápido / E-commerce)"),
    ("bria-rmbg", "BRIA RMBG-2.0"),
    ("birefnet-general", "BiRefNet"),
]

CASCADES = {
    "packaging": [
        ("isnet-general-use", "IS-Net"),
        ("bria-rmbg", "BRIA RMBG-2.0"),
        ("birefnet-general", "BiRefNet"),
        ("u2net", "U2Net (Universal / Embalagens)"),
    ],
    "object": [
        ("isnet-general-use", "IS-Net"),
        ("bria-rmbg", "BRIA RMBG-2.0"),
        ("birefnet-general", "BiRefNet"),
        ("u2net", "U2Net (Universal / Embalagens)"),
    ],
    "auto": [
        ("birefnet-general", "BiRefNet"),
        ("isnet-general-use", "IS-Net"),
        ("bria-rmbg", "BRIA RMBG-2.0"),
        ("u2net", "U2Net (Universal / Embalagens)"),
    ],
}

sessions = {}


def get_model_session(model_id, model_name):
    """Retorna a sessão do modelo configurada com multi-threading para máximo desempenho na CPU."""
    if model_id not in sessions:
        try:
            sys.stderr.write(f"Carregando {model_name} ({model_id}) otimizado para CPU multi-core...\n")
            sys.stderr.flush()
            opts = ort.SessionOptions()
            cpu_count = os.cpu_count() or 4
            opts.intra_op_num_threads = min(14, cpu_count)
            opts.inter_op_num_threads = 2
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            sessions[model_id] = new_session(model_id, session_options=opts)
            sys.stderr.write(f"{model_name} pronto!\n")
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"Falha ao carregar {model_name}: {e}\n")
            sys.stderr.flush()
    return sessions.get(model_id)


def get_bg_info(pil_img):
    """
    Amostra as 4 bordas para identificar a cor de fundo média, variação e tipo de estúdio
    (laranja chroma do upscale, verde chroma, branco ou cinza de estúdio).
    """
    try:
        arr = np.array(pil_img.convert('RGB'))
        h, w, _ = arr.shape
        b = max(4, min(w, h) // 100)
        c_tl = arr[0:b, 0:b].reshape(-1, 3)
        c_tr = arr[0:b, max(0, w-b):w].reshape(-1, 3)
        c_bl = arr[max(0, h-b):h, 0:b].reshape(-1, 3)
        c_br = arr[max(0, h-b):h, max(0, w-b):w].reshape(-1, 3)
        samples = np.vstack([c_tl, c_tr, c_bl, c_br])
        bg_color = np.median(samples, axis=0).astype(float)
        bg_std = np.std(samples, axis=0)
        max_std = float(np.max(bg_std))

        is_orange_chroma = (bg_color[0] > 170 and bg_color[0] > bg_color[1] + 25 and bg_color[2] < 110 and max_std < 35)
        is_green_chroma = (bg_color[1] > 135 and bg_color[1] > bg_color[0] + 30 and max_std < 35)
        color_range = float(np.max(bg_color) - np.min(bg_color))
        is_chroma = is_orange_chroma or is_green_chroma or (color_range > 45 and max_std < 35)

        is_white_studio = (bg_color[0] >= 225 and bg_color[1] >= 225 and bg_color[2] >= 225 and max_std < 25)
        is_uniform = max_std < 25.0 or is_chroma

        return {
            'color': bg_color,
            'std': max_std,
            'is_chroma': is_chroma,
            'is_orange_chroma': is_orange_chroma,
            'is_green_chroma': is_green_chroma,
            'is_white_studio': is_white_studio,
            'is_uniform': is_uniform
        }
    except Exception:
        return {
            'color': np.array([255.0, 255.0, 255.0]),
            'std': 0.0,
            'is_chroma': False,
            'is_orange_chroma': False,
            'is_green_chroma': False,
            'is_white_studio': True,
            'is_uniform': True
        }


def remove_connected_bg(pil_img, bg_info, tolerance=None):
    """
    Remove fundo uniforme por flood-fill conectado a partir das 4 bordas:
    - 100% à prova de falhas para embalagens, envelopes e cartelas em estúdio ou chroma.
    - Elimina 100% da borda colorida residual (laranja ou verde) com erosão precisa de 1px e defringe.
    """
    img_rgb = np.array(pil_img.convert('RGB'))
    h, w, _ = img_rgb.shape
    bg_color = bg_info['color']
    max_std = bg_info['std']

    if tolerance is None:
        if bg_info['is_chroma']:
            tol = max(45.0, max_std * 3.5)
        elif bg_info['is_white_studio']:
            tol = max(30.0, max_std * 3.0)
        else:
            tol = max(35.0, max_std * 3.5)
    else:
        tol = tolerance

    diff = img_rgb.astype(float) - bg_color.astype(float)
    dist = np.sqrt(np.sum(diff**2, axis=2))
    is_bg = (dist <= tol).astype(np.uint8)

    mask = np.zeros((h + 2, w + 2), dtype=np.uint8)
    mask[1:h+1, 1:w+1] = (is_bg == 0).astype(np.uint8)
    flood_img = is_bg.copy()

    step = max(5, min(w, h) // 100)
    for x in range(0, w, step):
        if is_bg[0, x] and mask[1, x + 1] == 0:
            cv2.floodFill(flood_img, mask, (x, 0), 2, flags=8 | (2 << 8))
        if is_bg[h - 1, x] and mask[h, x + 1] == 0:
            cv2.floodFill(flood_img, mask, (x, h - 1), 2, flags=8 | (2 << 8))

    for y in range(0, h, step):
        if is_bg[y, 0] and mask[y + 1, 1] == 0:
            cv2.floodFill(flood_img, mask, (0, y), 2, flags=8 | (2 << 8))
        if is_bg[y, w - 1] and mask[y + 1, w] == 0:
            cv2.floodFill(flood_img, mask, (w - 1, y), 2, flags=8 | (2 << 8))

    bg_connected = (mask[1:h+1, 1:w+1] == 2)
    alpha = np.where(bg_connected, 0, 255).astype(np.uint8)

    if bg_info['is_chroma']:
        kernel_erode = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        alpha = cv2.erode(alpha, kernel_erode, iterations=1)

    kernel_aa = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edge_zone = (cv2.dilate((alpha > 0).astype(np.uint8), kernel_aa) - 
                 cv2.erode((alpha > 0).astype(np.uint8), kernel_aa)) > 0

    alpha_float = alpha.astype(float)
    blurred_alpha = cv2.GaussianBlur(alpha_float, (3, 3), 0.5)
    alpha_final = np.where(edge_zone, blurred_alpha, alpha_float)
    alpha_uint = np.clip(alpha_final, 0, 255).astype(np.uint8)

    k_defringe = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    dilated_fg = cv2.dilate((alpha_uint > 0).astype(np.uint8), k_defringe)
    eroded_fg = cv2.erode((alpha_uint == 255).astype(np.uint8), k_defringe)
    defringe_zone = (dilated_fg > 0) & (eroded_fg == 0)

    rgb = img_rgb.copy().astype(float)
    a_norm = np.clip(alpha_uint / 255.0, 0.001, 1.0)[:, :, np.newaxis]
    unmixed = (rgb - bg_color * (1.0 - a_norm)) / np.maximum(a_norm, 0.20)
    unmixed = np.clip(unmixed, 0, 255)
    rgb[defringe_zone] = unmixed[defringe_zone]

    if bg_info.get('is_orange_chroma'):
        hsv = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2HSV).astype(float)
        is_orange = (hsv[:, :, 0] >= 4) & (hsv[:, :, 0] <= 28) & (hsv[:, :, 1] > 35)
        halo_pixels = defringe_zone & is_orange
        hsv[halo_pixels, 1] = hsv[halo_pixels, 1] * 0.15
        rgb = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB).astype(float)

    res_rgba = np.dstack([rgb.astype(np.uint8), alpha_uint])
    return Image.fromarray(res_rgba)


# ==============================================================================
# PIPELINE INTELIGENTE: FLORENCE-2 + SAM 2.1
# ==============================================================================

def include_attached_objects(rgb_np, alpha_float, bg_info, max_gap_frac=0.10, min_area_frac=0.0015, texture_min=8.0):
    """
    Inclui no recorte objetos PROXIMOS do produto que fazem parte dele visualmente
    (ex.: pilha de sementes ao lado do saco, que ilustra o conteudo).
    Criterios (fundo uniforme): contraste forte com o fundo + textura alta (graos/itens) +
    proximidade da mascara principal. Sombras (lisas e de baixo contraste) NAO sao incluidas.
    """
    try:
        if not bg_info.get('is_uniform'):
            return alpha_float
        import math
        h, w = alpha_float.shape[:2]
        main = (alpha_float > 0.5).astype(np.uint8)
        main_area = int(main.sum())
        if main_area < 500:
            return alpha_float

        bg = np.asarray(bg_info['color'], dtype=np.float32)
        dist = np.sqrt(((rgb_np.astype(np.float32) - bg) ** 2).sum(axis=2))
        gray = cv2.cvtColor(rgb_np, cv2.COLOR_RGB2GRAY).astype(np.float32)
        mean = cv2.blur(gray, (7, 7))
        sq = cv2.blur(gray * gray, (7, 7))
        texture = np.sqrt(np.maximum(sq - mean * mean, 0.0))

        strong = ((dist > 70) & (main == 0)).astype(np.uint8)
        k = max(5, int(min(h, w) * 0.012)) | 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        closed = cv2.morphologyEx(strong, cv2.MORPH_CLOSE, kernel)
        closed[main > 0] = 0

        num, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
        if num <= 1:
            return alpha_float

        ys, xs = np.where(main > 0)
        diag = math.hypot(float(xs.max() - xs.min()), float(ys.max() - ys.min()))
        gap = diag * max_gap_frac
        dt = cv2.distanceTransform((main == 0).astype(np.uint8), cv2.DIST_L2, 5)

        out = alpha_float.astype(np.float32).copy()
        added = 0
        for i in range(1, num):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area < min_area_frac * h * w or area > 0.6 * main_area:
                continue
            comp = (labels == i)
            near = float(dt[comp].min())
            tex = float(texture[comp].mean())
            sys.stderr.write(f"[Attached] comp#{i} area={area} dist_main={near:.0f}px (max {gap:.0f}) textura={tex:.1f} (min {texture_min})\n")
            if near > gap or tex < texture_min:
                continue
            comp_u8 = comp.astype(np.uint8) * 255
            contours, _ = cv2.findContours(comp_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            filled = np.zeros_like(comp_u8)
            cv2.drawContours(filled, contours, -1, 255, cv2.FILLED)
            soft = cv2.GaussianBlur(filled.astype(np.float32) / 255.0, (3, 3), 0.7)
            out = np.maximum(out, soft)
            added += 1
        if added:
            sys.stderr.write(f"[RemoveBG] {added} objeto(s) proximo(s) incluido(s) no recorte (ex.: conteudo ilustrado do produto).\n")
            sys.stderr.flush()
        return np.clip(out, 0.0, 1.0)
    except Exception as e:
        sys.stderr.write(f"[RemoveBG] include_attached_objects falhou: {e}\n")
        sys.stderr.flush()
        return alpha_float


def remove_background_ai(
    image_pil,
    product_name=None,
    product_category=None,
    keywords=None,
    save_mask_path=None,
    force_packaging=False
):
    """
    Pipeline inteligente de ponta a ponta:
    Florence-2 (Detecção do Produto Físico) → Ranking BBox → Expansão 3% →
    SAM 2.1 (Segmentação Precisa) → Validação de Máscara → Retry Automático →
    Preservação de Furos Estruturais → Aplicação de Máscara Alpha no RGB Original.
    """
    if florence_ai is None or sam2_ai is None:
        raise RuntimeError("Módulos florence_ai ou sam2_ai não disponíveis.")

    image_rgb = image_pil.convert("RGB")
    w, h = image_rgb.size
    img_area = float(w * h)

    sys.stderr.write(f"\n[RemoveBG] Iniciando Pipeline Florence-2 + SAM 2.1...\n")
    sys.stderr.write(f"[Florence] Product: {product_name or 'não informado'} (categoria: {product_category or 'não informada'})\n")
    sys.stderr.flush()

    # 1. Localização semântica de candidatos via Florence-2
    physical_info = florence_ai.infer_physical_object_type(product_name, product_category, keywords)
    is_packaging = physical_info.get("is_packaging", False) or bool(force_packaging)

    candidates = florence_ai.detect_product(image_rgb, product_name, product_category, keywords)
    sys.stderr.write(f"[Florence] Candidates found: {len(candidates)} (tipo físico: {physical_info['physical_type']})\n")
    sys.stderr.flush()

    # 2. Ranking de candidatos priorizando o produto completo
    ranked = florence_ai.rank_candidates(candidates, (w, h), product_name, product_category, keywords)
    if not ranked:
        ranked = [{"box": [0, 0, w, h], "score": 0.5, "label": "fallback"}]

    # 3. Validação estrutural do candidato selecionado (Pontos 6 e 7)
    selected_candidate = None
    if is_packaging:
        for c in ranked:
            val_box = florence_ai.validate_packaging_box(c["box"], (w, h), physical_info)
            if val_box["valid"]:
                selected_candidate = c
                break
            else:
                sys.stderr.write(f"[Florence] Candidato '{c.get('label')}' rejeitado na validação de embalagem: {', '.join(val_box['reasons'])}\n")

        # Ponto 8: Retry orientado por categoria caso nenhum candidato atenda aos critérios
        if selected_candidate is None:
            sys.stderr.write(f"[Florence] Nenhum candidato atendeu à estrutura física. Executando retry orientado por categoria...\n")
            retry_prompts = physical_info.get("retry_prompts", [])
            retry_cands = florence_ai.detect_product(
                image_rgb, product_name, product_category, keywords,
                prompts_override=retry_prompts
            )
            ranked_retry = florence_ai.rank_candidates(retry_cands, (w, h), product_name, product_category, keywords)
            for c in ranked_retry:
                val_box = florence_ai.validate_packaging_box(c["box"], (w, h), physical_info)
                if val_box["valid"]:
                    selected_candidate = c
                    break
            if selected_candidate is None and ranked_retry:
                selected_candidate = ranked_retry[0]

    if selected_candidate is None:
        selected_candidate = ranked[0]

    sys.stderr.write(
        f"[Florence] Selected Candidate: label='{selected_candidate['label']}', "
        f"score={selected_candidate.get('ranking_score', 0):.2f}, "
        f"area={selected_candidate.get('area_ratio', 0)*100:.1f}%\n"
    )
    sys.stderr.flush()

    # 3b. Embalagem que ocupa o quadro INTEIRO (imagem ja recortada, sem fundo): nao ha o que remover.
    if is_packaging and selected_candidate.get("label") != "fallback":
        _bx1, _by1, _bx2, _by2 = selected_candidate["box"]
        _box_ratio = ((_bx2 - _bx1) * (_by2 - _by1)) / img_area
        _mx, _my = w * 0.02, h * 0.02
        if _box_ratio >= 0.92 and _bx1 <= _mx and _by1 <= _my and _bx2 >= w - _mx and _by2 >= h - _my:
            sys.stderr.write(f"[RemoveBG] Embalagem ocupa o quadro inteiro ({_box_ratio*100:.1f}%). Mantendo imagem sem recorte.\n")
            sys.stderr.flush()
            _rgba = np.dstack([np.array(image_rgb), np.full((h, w), 255, dtype=np.uint8)])
            return {
                "success": True,
                "result_image": Image.fromarray(_rgba, mode="RGBA"),
                "mask": np.ones((h, w), dtype=np.float32),
                "metrics": {},
                "strategy": "packaging_full_frame",
                "best_box": [0, 0, w, h]
            }

    # 4. Execução do SAM 2.1 com retry automático
    best_mask = None
    best_validation = None
    strategy_used = "initial_box_expand_3%"
    target_box = selected_candidate["box"]

    for attempt in range(MAX_SEGMENTATION_RETRIES):
        sys.stderr.write(f"[SAM] Running segmentation (tentativa {attempt + 1}/{MAX_SEGMENTATION_RETRIES})...\n")
        sys.stderr.flush()

        if attempt == 0:
            # Estratégia 1: expansão padrão 3%
            current_box = florence_ai.expand_box(target_box, (w, h), percentage=0.03)
            positive_pts = None
            strategy_used = "florence_top1_expand_3%"
        elif attempt == 1:
            # Estratégia 2: expandir para 5% e reajustar ponto central
            sys.stderr.write("[Retry 1/3] Expanding bbox to 5% e retestando SAM.\n")
            current_box = florence_ai.expand_box(target_box, (w, h), percentage=0.05)
            strategy_used = "florence_top1_expand_5%"
            cx = (current_box[0] + current_box[2]) / 2.0
            cy = (current_box[1] + current_box[3]) / 2.0
            positive_pts = None if is_packaging else [[cx, cy]]
        elif attempt == 2 and len(ranked) > 1:
            # Estratégia 3: testar o segundo melhor candidato do Florence
            sys.stderr.write(f"[Retry 2/3] Testando 2ª melhor Bounding Box do Florence (label='{ranked[1]['label']}').\n")
            target_box = ranked[1]["box"]
            current_box = florence_ai.expand_box(target_box, (w, h), percentage=0.04)
            strategy_used = "florence_top2_expand_4%"
            positive_pts = None
        else:
            # Estratégia 4: caixa inteira com margem de segurança
            current_box = [int(w * 0.02), int(h * 0.02), int(w * 0.98), int(h * 0.98)]
            strategy_used = "fallback_safe_boundary"
            positive_pts = None if is_packaging else [[w / 2.0, h / 2.0]]

        # Inferência SAM 2.1
        mask_candidates = sam2_ai.segment_with_box(image_rgb, current_box, positive_points=positive_pts, use_center_point=not is_packaging)
        sys.stderr.write(f"[SAM] Masks generated: {len(mask_candidates)}\n")
        sys.stderr.flush()

        # Seleção da melhor máscara
        cand_mask, mask_meta = sam2_ai.select_best_mask(mask_candidates, current_box, (w, h), prefer_whole=is_packaging)

        # Validação automática da máscara
        val = sam2_ai.validate_mask(cand_mask, current_box, (w, h), mask_meta.get("sam_score"), min_bbox_ratio=0.60 if is_packaging else 0.22)

        if val["valid"]:
            sys.stderr.write(f"[Validation] Mask accepted (confidence={val['confidence']:.2f}).\n")
            sys.stderr.flush()
            best_mask = cand_mask
            best_validation = val
            break
        else:
            sys.stderr.write(f"[Validation] Mask rejected: {', '.join(val['reasons'])}\n")
            sys.stderr.flush()
            # Guarda a máscara caso todas as tentativas falhem
            if best_mask is None or val["confidence"] > (best_validation["confidence"] if best_validation else 0):
                best_mask = cand_mask
                best_validation = val

    if best_mask is None:
        raise RuntimeError("SAM 2.1 não conseguiu produzir uma máscara utilizável.")

    # 4. Redimensionamento suave para resolução original via Lanczos (sem NEAREST)
    soft_mask = sam2_ai.resize_mask_soft(best_mask, (w, h))

    # 5. Limpeza e preenchimento inteligente preservando furos estruturais
    cleaned_mask = sam2_ai.remove_small_components(soft_mask, min_area=25)
    if is_packaging:
        cleaned_mask = sam2_ai.clean_packaging_mask(cleaned_mask)
    if is_packaging:
        filled_mask = sam2_ai.fill_packaging_internal_holes(cleaned_mask, current_box, preserve_hanging_slot=True)
    else:
        filled_mask = sam2_ai.fill_tiny_holes(cleaned_mask, max_area=40)

    # 6. Construção do miolo sólido e faixa estreita de borda (edge band)
    bin_mask = (filled_mask >= 0.50).astype(np.uint8)
    inner_core, edge_band, outer_bound = sam2_ai.build_edge_band(bin_mask, inner_px=2, outer_px=2)

    # 7. Descontaminação de cor na borda (elimina halos escuros/acinzentados sem alterar o interior original)
    clean_rgb = sam2_ai.decontaminate_edge_colors(np.array(image_rgb), inner_core, edge_band)

    # 8. Refinamento de matting no canal Alpha (miolo 100% sólido, borda com feather sutil 0.8px)
    refined_alpha = sam2_ai.refine_alpha_matting(filled_mask, inner_core, edge_band, outer_bound, radius=0.8)

    # 8b. Inclui objetos proximos que fazem parte do produto (ex.: conteudo ilustrado ao lado da embalagem)
    refined_alpha = include_attached_objects(np.array(image_rgb), refined_alpha, get_bg_info(image_rgb))

    # 9. Salvar máscara separada se requisitado
    if save_mask_path:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(save_mask_path)), exist_ok=True)
            mask_uint8 = np.clip(refined_alpha * 255.0, 0, 255).astype(np.uint8)
            Image.fromarray(mask_uint8, mode="L").save(save_mask_path)
            sys.stderr.write(f"[RemoveBG] Máscara separada salva em: {save_mask_path}\n")
        except Exception as e:
            sys.stderr.write(f"[RemoveBG] Erro ao salvar máscara separada: {e}\n")

    # 10. Gerar PNG transparente com RGB original intacto no miolo e borda descontaminada
    result_rgba = sam2_ai.apply_alpha_mask(clean_rgb, refined_alpha)
    sys.stderr.write(f"[RemoveBG] Completed successfully (estratégia: {strategy_used}).\n\n")
    sys.stderr.flush()

    return {
        "success": True,
        "result_image": result_rgba,
        "mask": refined_alpha,
        "metrics": best_validation["metrics"] if best_validation else {},
        "strategy": strategy_used,
        "best_box": current_box
    }


def classify_product_for_cutout(product_name, product_category):
    """
    Classificador inteligente de produto para roteamento de recorte (~0ms).
    Analisa nome e categoria do produto para determinar:
    - Tipo físico do objeto (sachê, spray, garrafa, caixa, etc.)
    - Estratégia de recorte ideal
    - Se possui partes translúcidas que devem ser preservadas

    Retorna dict com:
      type: str - tipo do produto
      strategy: 'flood_fill' | 'neural_cascade'
      has_translucent: bool - se tem partes translúcidas (tampas, vidro)
      description: str - descrição legível da decisão
    """
    import re
    corpus = f"{product_name or ''} {product_category or ''}".lower()

    # --- EMBALAGENS ILUSTRADAS (sachês, sementes, cartelas, envelopes) ---
    # O modelo neural confunde a ilustração (ex: alface) com o produto.
    # Flood-fill remove SÓ o fundo conectado às bordas, preservando 100% do pacote.
    illustrated_keywords = [
        "semente", "sementes", "sem.", "horta", "garden",
        "seed packet", "seed", "seeds", "envelopinho",
        "cartela", "blister", "sachê", "sache",
    ]
    if any(re.search(r'(?:^|\s|/)' + re.escape(w), corpus) for w in illustrated_keywords):
        return {
            'type': 'illustrated_packet',
            'strategy': 'flood_fill',
            'has_translucent': False,
            'description': 'Embalagem ilustrada (sachê/semente/cartela) → flood-fill preserva pacote inteiro',
        }

    # --- SPRAYS / BORRIFADORES (têm tampa/nozzle translúcido) ---
    spray_keywords = [
        "spray", "borrifador", "gatilho", "pulverizador",
        "trigger", "aerossol", "aerosol", "nebulizador",
    ]
    if any(re.search(r'(?:^|\s)' + re.escape(w), corpus) for w in spray_keywords):
        return {
            'type': 'spray_bottle',
            'strategy': 'neural_cascade',
            'has_translucent': True,
            'description': 'Spray/borrifador → preserva tampa/nozzle translúcido',
        }

    # --- FRASCOS TRANSPARENTES / VIDRO ---
    clear_keywords = [
        "transparente", "vidro", "glass", "clear", "cristal",
    ]
    if any(re.search(r'(?:^|\s)' + re.escape(w), corpus) for w in clear_keywords):
        return {
            'type': 'clear_container',
            'strategy': 'neural_cascade',
            'has_translucent': True,
            'description': 'Frasco transparente/vidro → preserva translucidez',
        }

    # --- LÍQUIDOS EM EMBALAGEM COM MEDIDOR (dosadores, tampas translúcidas) ---
    dosador_keywords = [
        "dosador", "medidor", "pump", "válvula", "valvula",
        "conta.gotas", "conta-gotas", "contagotas", "pipeta",
    ]
    if any(re.search(r'(?:^|\s)' + re.escape(w), corpus) for w in dosador_keywords):
        return {
            'type': 'dosing_container',
            'strategy': 'neural_cascade',
            'has_translucent': True,
            'description': 'Embalagem com dosador/válvula → preserva peças translúcidas',
        }

    # --- PRODUTO PADRÃO (garrafas opacas, caixas, potes, latas, tubos, ferramentas) ---
    return {
        'type': 'standard',
        'strategy': 'neural_cascade',
        'has_translucent': False,
        'description': 'Produto padrão → recorte neural com solidificação total',
    }


def validate_extracted_alpha(alpha_img):
    """Quality Gate rápido (2ms): valida se a máscara do recorte é consistente e cobriu o objeto."""
    try:
        a_arr = np.array(alpha_img)
        h, w = a_arr.shape[:2]
        total_pixels = h * w
        fg_pixels = np.count_nonzero(a_arr > 30)
        coverage = fg_pixels / float(total_pixels)
        # O objeto deve cobrir pelo menos 2.5% da tela e menos de 98%
        if 0.025 <= coverage <= 0.98:
            return True, coverage
        return False, coverage
    except Exception:
        return True, 0.5


def solidify_and_defringe(rgba_img, bg_color=None, preserve_corners=False):
    """
    Pós-processamento para recorte limpo (~10ms):

    O IS-Net produz uma máscara com bordas suaves, MAS os pixels semi-transparentes
    nas bordas têm o RGB "contaminado" (escurecido) pela mistura com o fundo.
    Isso cria uma borda escura visível quando exibido em fundos diferentes.

    A solução é "color propagation com blend": para cada pixel semi-transparente,
    propagar a cor do pixel opaco mais próximo COM BLEND baseado no alpha.
    Pixels com alpha baixo (borda externa, mais contaminados) → cor propagada.
    Pixels com alpha alto (borda interna, menos contaminados) → cor original preservada.
    """
    arr = np.array(rgba_img).copy()
    if arr.ndim < 3 or arr.shape[2] < 4:
        return rgba_img
    rgb = arr[:, :, :3].astype(np.float64)
    alpha = arr[:, :, 3].astype(np.float64)

    # ── 1. Normalização do alpha comprimido ───────────────────────────
    fg_pixels = alpha[alpha > 5]
    if len(fg_pixels) == 0:
        return rgba_img

    alpha_top = float(np.percentile(fg_pixels, 98))
    if alpha_top < 15:
        return rgba_img

    scale = 255.0 / max(alpha_top, 1.0)
    alpha_norm = np.clip(alpha * scale, 0, 255)

    # ── 2. Corte binário (tesoura) com contorno LISO ────────────────────
    import cv2
    from scipy.ndimage import gaussian_filter1d, distance_transform_edt

    # Binarizar (threshold 190 — corte apertado)
    # preserve_corners (embalagens): limiar mais baixo para nao encolher a borda
    alpha_bin = np.where(alpha_norm >= (128 if preserve_corners else 190), 255, 0).astype(np.uint8)

    # PASSO 1: Contour smoothing sigma=8 (suaviza serrilhado preservando curvas)
    contours, _ = cv2.findContours(alpha_bin, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_NONE)
    smooth_mask = np.zeros(alpha_bin.shape, dtype=np.uint8)
    for contour in ([] if preserve_corners else contours):
        if len(contour) < 20:
            continue
        x = contour[:, 0, 0].astype(np.float64)
        y = contour[:, 0, 1].astype(np.float64)
        x_s = gaussian_filter1d(x, sigma=8, mode='wrap')
        y_s = gaussian_filter1d(y, sigma=8, mode='wrap')
        smooth_c = np.stack([x_s, y_s], axis=1).astype(np.int32).reshape(-1, 1, 2)
        cv2.drawContours(smooth_mask, [smooth_c], -1, 255, cv2.FILLED)

    if preserve_corners:
        # Embalagens: sem suavizacao de contorno (ela arredonda os cantos retos)
        smooth_mask = alpha_bin.copy()

    # PASSO 2: Proteção — não corta mais que ~3px para dentro do produto
    protect_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    protected = cv2.erode(alpha_bin, protect_kernel)
    smooth_mask = np.maximum(smooth_mask, protected)

    # PASSO 3: CLOSE + OPEN suaviza staircase sem encolher/expandir
    morph_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3) if preserve_corners else (7, 7))
    smooth_mask = cv2.morphologyEx(smooth_mask, cv2.MORPH_CLOSE, morph_k)
    if not preserve_corners:
        # OPEN arredonda cantos: nao usar em embalagens
        smooth_mask = cv2.morphologyEx(smooth_mask, cv2.MORPH_OPEN, morph_k)

    # PASSO 4: Color propagation para borda (erode 15x15)
    erode_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5) if preserve_corners else (15, 15))
    interior_mask = cv2.erode(smooth_mask, erode_kernel)
    edge_mask = (smooth_mask == 255) & (interior_mask == 0)

    if np.any(edge_mask) and np.any(interior_mask > 0):
        inv_interior = (interior_mask == 0)
        _, indices = distance_transform_edt(inv_interior, return_indices=True)
        for ch in range(3):
            nearest_color = rgb[:, :, ch][indices[0], indices[1]]
            rgb[edge_mask, ch] = nearest_color[edge_mask]
        arr[:, :, :3] = rgb.astype(np.uint8)

    alpha_final = smooth_mask.astype(np.float64)
    if preserve_corners:
        # Anti-aliasing minimo da borda (sem mexer nos cantos)
        alpha_final = cv2.GaussianBlur(alpha_final, (3, 3), 0.6)

    arr[:, :, 3] = alpha_final.astype(np.uint8)
    return Image.fromarray(arr)


def neural_silhouette(original):
    """
    Silhueta SOLIDA (sem furos internos) do primeiro plano via IS-Net.
    Retorna array uint8 (0/255) no tamanho original, ou None se indisponivel.
    Usada apenas como rede de seguranca contra vazamento do flood-fill em embalagens brancas.
    """
    try:
        sess = get_model_session("isnet-general-use", "IS-Net")
        if sess is None:
            return None
        w, h = original.size
        proc = original.convert('RGB')
        if max(w, h) > MAX_PROCESS_SIZE:
            r = MAX_PROCESS_SIZE / float(max(w, h))
            proc = proc.resize((max(1, int(w * r)), max(1, int(h * r))), Image.BILINEAR)
        out = remove(proc, session=sess)
        a = np.array(out.split()[-1])
        binm = (a > 128).astype(np.uint8) * 255
        contours, _ = cv2.findContours(binm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        solid = np.zeros_like(binm)
        cv2.drawContours(solid, contours, -1, 255, cv2.FILLED)
        if solid.shape[:2] != (h, w):
            solid = cv2.resize(solid, (w, h), interpolation=cv2.INTER_NEAREST)
        return solid
    except Exception as e:
        sys.stderr.write(f"[RemoveBG] Silhueta neural indisponivel: {e}\n")
        sys.stderr.flush()
        return None


def guard_packaging_alpha(original, ff_result, bg_info):
    """
    Rede de seguranca para embalagens BRANCAS em fundo branco: o flood-fill pode vazar
    pelas bordas brancas da embalagem. Une o resultado do flood-fill com o miolo da
    silhueta neural preenchida (erodida 3px para nao criar halo), restaurando as areas vazadas.
    Nunca remove pixels que o flood-fill ja manteve.
    """
    if not bg_info.get('is_white_studio'):
        return ff_result
    sil = neural_silhouette(original)
    if sil is None:
        return ff_result
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    sil_core = cv2.erode(sil, k)
    arr = np.array(ff_result)
    alpha = arr[:, :, 3]
    restored = int(np.count_nonzero((sil_core > 0) & (alpha < 255)))
    if restored == 0:
        return ff_result
    arr[:, :, 3] = np.maximum(alpha, sil_core)
    sys.stderr.write(f"[RemoveBG] Guarda de embalagem: {restored}px restaurados (vazamento do flood-fill).\n")
    sys.stderr.flush()
    return Image.fromarray(arr)


def process_image(input_path, output_path, mode="auto", product_name="", product_category="", save_mask_path=None):
    """
    Roteador inteligente com classificação de produto (~0ms):

    1. Classifica o produto a partir dos dados textuais (nome, categoria)
       para decidir a estratégia ANTES de processar a imagem.
    2. Fundo chroma (laranja/verde) → flood-fill conectado (~0.1s).
    3. Embalagens ilustradas (sachês de sementes, cartelas com foto)
       + fundo uniforme → flood-fill conectado (~0.1s).
       Assim o pacote inteiro é preservado, sem confundir a alface
       ilustrada no sachê com o produto real.
    4. Produtos padrão → cascata neural (IS-Net ~0.5s) + pós-processamento
       estilo Photoshop (Decontaminate Colors) que elimina halos e preserva
       tampas translúcidas.
    """
    original = Image.open(input_path)
    orig_w, orig_h = original.size
    bg_info = get_bg_info(original)
    mode_str = str(mode).lower()
    cascade_only = mode_str.startswith('cascade_only')
    mode_is_packaging = 'packaging' in mode_str
    if cascade_only:
        mode_str = 'cascade_only'  # normaliza (cascade_only_packaging -> cascade_only)

    # ── ETAPA 0: Classificar tipo do produto a partir dos dados ───────
    product_hints = classify_product_for_cutout(product_name, product_category)
    sys.stderr.write(
        f"[RemoveBG] Classificação: \"{product_name}\" → "
        f"tipo={product_hints['type']}, {product_hints['description']}\n"
    )
    sys.stderr.flush()

    # ── ETAPA 1: Fundo Chroma (laranja do upscale ou verde de estúdio) ─
    if bg_info['is_chroma']:
        sys.stderr.write(f"[RemoveBG] Fundo chroma detectado (bg={bg_info['color'].astype(int).tolist()}). Flood-fill conectado...\n")
        sys.stderr.flush()
        result = remove_connected_bg(original, bg_info)
        result.save(output_path, 'PNG')
        return result.size, "Chroma Conectado"

    # ── ETAPA 2: Embalagens ilustradas com fundo uniforme → Flood-fill ─
    # Para sachês de sementes, cartelas, blisters: o modelo neural confunde
    # a ilustração com o produto. Flood-fill remove SÓ o fundo conectado
    # às bordas, preservando 100% do conteúdo interno da embalagem.
    is_pack_route = (product_hints['strategy'] == 'flood_fill') or (mode_is_packaging and not cascade_only)
    if is_pack_route and bg_info['is_uniform']:
        sys.stderr.write(
            f"[RemoveBG] Embalagem + fundo uniforme -> Flood-fill inteligente "
            f"(bg={bg_info['color'].astype(int).tolist()}, std={bg_info['std']:.1f})\n"
        )
        sys.stderr.flush()
        result = remove_connected_bg(original, bg_info)
        ff_ok, ff_cov = validate_extracted_alpha(result.split()[-1])
        if ff_ok:
            result = guard_packaging_alpha(original, result, bg_info)
            result.save(output_path, 'PNG')
            return result.size, f"Flood-Fill Inteligente ({product_hints['type']})"
        sys.stderr.write(f"[RemoveBG] Flood-fill invalido (cobertura={ff_cov*100:.1f}%). Seguindo para IA...\n")
        sys.stderr.flush()

    # ── ETAPA 2b: Embalagens ilustradas com fundo NÃO uniforme → Florence+SAM ─
    if product_hints['strategy'] == 'flood_fill' and not bg_info['is_uniform'] and mode_str != 'cascade_only':
        if florence_ai is not None and sam2_ai is not None:
            try:
                sys.stderr.write(f"[RemoveBG] Embalagem ilustrada + fundo complexo → Florence-2 + SAM 2.1\n")
                sys.stderr.flush()
                ai_res = remove_background_ai(
                    original, product_name=product_name,
                    product_category=product_category, save_mask_path=save_mask_path,
                    force_packaging=(mode_is_packaging or product_hints['type'] == 'illustrated_packet')
                )
                if ai_res.get("success") and ai_res.get("result_image"):
                    res_img = ai_res["result_image"]
                    res_img.save(output_path, 'PNG')
                    return res_img.size, f"Florence-2 + SAM 2.1 ({ai_res.get('strategy', 'auto')})"
            except Exception as ai_err:
                sys.stderr.write(f"[RemoveBG] Florence-SAM falhou ({ai_err}). Fallback para cascata neural...\n")
                traceback.print_exc(file=sys.stderr)
                sys.stderr.flush()

    # ── ETAPA 2c: Produtos standard → Florence+SAM para recorte preciso ──
    # O SAM 2.1 segue contornos complexos (gargalos, reentrâncias) com muito
    # mais precisão que o IS-Net. Tenta primeiro, fallback para cascata neural.
    # NOTA: modo "cascade_only" pula Florence+SAM (tentativa alternativa do usuário)
    if product_hints['strategy'] == 'neural_cascade' and mode_str != 'cascade_only':
        if florence_ai is not None and sam2_ai is not None:
            try:
                sys.stderr.write(f"[RemoveBG] Produto standard → tentando Florence-2 + SAM 2.1 (precisão máxima)\n")
                sys.stderr.flush()
                ai_res = remove_background_ai(
                    original, product_name=product_name,
                    product_category=product_category, save_mask_path=save_mask_path,
                    force_packaging=(mode_is_packaging or product_hints['type'] == 'illustrated_packet')
                )
                if ai_res.get("success") and ai_res.get("result_image"):
                    res_img = ai_res["result_image"]
                    res_img.save(output_path, 'PNG')
                    return res_img.size, f"Florence-2 + SAM 2.1 ({ai_res.get('strategy', 'auto')})"
            except Exception as ai_err:
                sys.stderr.write(f"[RemoveBG] Florence-SAM falhou ({ai_err}). Fallback para cascata neural...\n")
                traceback.print_exc(file=sys.stderr)
                sys.stderr.flush()
    elif mode_str == 'cascade_only':
        sys.stderr.write(f"[RemoveBG] Modo cascade_only: pulando Florence+SAM, usando cascata neural direta\n")
        sys.stderr.flush()

    # ── ETAPA 3: Cascata neural + pós-processamento Photoshop ─────────
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

    cascade = CASCADES.get(mode_str, CASCADES["auto"])
    result = None
    model_used = "none"

    for model_id, model_name in cascade:
        sess = get_model_session(model_id, model_name)
        if sess is None:
            continue
        try:
            sys.stderr.write(f"[RemoveBG] Processando com {model_name} ({model_id})...\n")
            sys.stderr.flush()
            use_matting = (model_id == "birefnet-general")
            output_data = remove(input_data, session=sess, alpha_matting=use_matting)
            candidate_img = Image.open(io.BytesIO(output_data))

            # Quality Gate
            candidate_alpha = candidate_img.split()[-1]
            is_valid, cov = validate_extracted_alpha(candidate_alpha)
            if not is_valid:
                sys.stderr.write(f"[RemoveBG] Quality Gate rejeitou {model_name} (cobertura={cov*100:.1f}%). Próximo...\n")
                sys.stderr.flush()
                continue

            result = candidate_img
            model_used = model_name
            break
        except Exception as e:
            sys.stderr.write(f"[RemoveBG] {model_name} falhou: {e}. Próximo...\n")
            continue

    if result is None:
        raise RuntimeError("Todos os modelos de remoção de fundo falharam")

    if needs_resize:
        alpha = result.split()[-1]
        alpha_full = alpha.resize((orig_w, orig_h), Image.LANCZOS)
        original_rgba = original.convert('RGBA')
        original_rgba.putalpha(alpha_full)
        result = original_rgba

    # Pós-processamento: normalização de alpha + limpeza de bordas
    detected_bg = bg_info.get('color', np.array([255.0, 255.0, 255.0]))
    result = solidify_and_defringe(
        result, bg_color=detected_bg,
        preserve_corners=(mode_is_packaging or product_hints['type'] == 'illustrated_packet')
    )
    sys.stderr.write(f"[RemoveBG] Recorte finalizado (bg={detected_bg.astype(int).tolist()}).\n")
    sys.stderr.flush()

    result.save(output_path, 'PNG')
    return result.size, model_used


# ==============================================================================
# LOOP PRINCIPAL (STDIN / STDOUT)
# ==============================================================================

if __name__ == '__main__':
    print("READY", flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line == 'EXIT':
            break

        try:
            parts = line.split('|')
            cmd = parts[0].upper()

            if cmd == 'WARMUP':
                # Pre-carrega Florence-2 + SAM 2.1 (a 1a remocao de fundo deixa de esperar o carregamento).
                # Responde 'WARMED' (nao 'OK|'/'ERROR|') para nao interferir em uma requisicao em andamento.
                try:
                    if florence_ai is not None:
                        florence_ai.get_florence_model()
                    if sam2_ai is not None:
                        sam2_ai.get_sam2_model()
                    print("WARMED", flush=True)
                except Exception as e:
                    sys.stderr.write(f"Aviso: pre-carregamento falhou: {e}\n")
                    print("WARMED_FAIL", flush=True)

            elif cmd == 'CLASSIFY':
                # CLASSIFY|<image_path>|<product_name>
                img_path = parts[1]
                prod_name = parts[2] if len(parts) > 2 else ""
                if florence_ai is not None:
                    res = florence_ai.classify_product(img_path, prod_name)
                    print(f"OK|{json.dumps(res, ensure_ascii=False)}", flush=True)
                else:
                    print(f"ERROR|Módulo Florence-2 não disponível", flush=True)

            elif cmd == 'OCR':
                # OCR|<image_path>
                img_path = parts[1]
                if florence_ai is not None:
                    txt = florence_ai.ocr_product(img_path)
                    print(f"OK|{txt}", flush=True)
                else:
                    print(f"ERROR|Módulo Florence-2 não disponível", flush=True)

            elif cmd == 'CAPTION':
                # CAPTION|<image_path>
                img_path = parts[1]
                if florence_ai is not None:
                    cap = florence_ai.caption_product(img_path)
                    print(f"OK|{cap}", flush=True)
                else:
                    print(f"ERROR|Módulo Florence-2 não disponível", flush=True)

            elif cmd == 'REMOVE_AI':
                # REMOVE_AI|<input_path>|<output_path>|<product_name>|<product_category>|<mask_path>
                input_path = parts[1]
                output_path = parts[2]
                prod_name = parts[3] if len(parts) > 3 else ""
                prod_cat = parts[4] if len(parts) > 4 else ""
                mask_path = parts[5] if len(parts) > 5 and parts[5] else None

                im = Image.open(input_path)
                ai_res = remove_background_ai(
                    im,
                    product_name=prod_name,
                    product_category=prod_cat,
                    save_mask_path=mask_path
                )
                if ai_res.get("success"):
                    ai_res["result_image"].save(output_path, 'PNG')
                    w, h = ai_res["result_image"].size
                    print(f"OK|{w}|{h}|Florence-2 + SAM 2.1 ({ai_res.get('strategy')})", flush=True)
                else:
                    print(f"ERROR|Falha na segmentação Florence-SAM", flush=True)

            else:
                # REMOVE|<input_path>|<output_path>|<mode>|<product_name>|<product_cat>
                if cmd == 'REMOVE':
                    input_path = parts[1]
                    output_path = parts[2]
                    mode = parts[3] if len(parts) > 3 and parts[3] else "auto"
                    prod_name = parts[4] if len(parts) > 4 else ""
                    prod_cat = parts[5] if len(parts) > 5 else ""
                else:
                    input_path = parts[0]
                    output_path = parts[1]
                    mode = parts[2] if len(parts) > 2 and parts[2] else "auto"
                    prod_name = parts[3] if len(parts) > 3 else ""
                    prod_cat = parts[4] if len(parts) > 4 else ""

                (w, h), model = process_image(input_path, output_path, mode, prod_name, prod_cat)
                print(f"OK|{w}|{h}|{model}", flush=True)

        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            print(f"ERROR|{str(e)}", flush=True)
