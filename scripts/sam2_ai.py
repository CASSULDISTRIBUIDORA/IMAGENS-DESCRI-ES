"""
Módulo SAM 2.1 AI - Meta Segment Anything Model 2.1
Segmentação de alta precisão com saída probabilística contínua (anti-aliasing sub-pixel),
interpolação suave Lanczos, refinamento de borda com feather leve (0.8px) e remoção de halo escuro.
Totalmente local e gratuito (licença Apache 2.0 Meta).
"""

import sys
import time
import math
import torch
import cv2
import numpy as np
from PIL import Image

_device = "cuda" if torch.cuda.is_available() else "cpu"
_torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32
_model = None
_processor = None


def get_sam2_model():
    """Carrega o modelo SAM 2.1 sob demanda (mantém em memória após a primeira chamada)."""
    global _model, _processor
    if _model is None or _processor is None:
        model_id = "facebook/sam2.1-hiera-small"
        t0 = time.time()
        sys.stderr.write(f"[SAM] Carregando modelo em memória ({_device}, {_torch_dtype})...\n")
        sys.stderr.flush()

        from transformers import Sam2Model, Sam2Processor
        _processor = Sam2Processor.from_pretrained(model_id)
        _model = Sam2Model.from_pretrained(model_id).to(_device)
        _model.eval()

        sys.stderr.write(f"[SAM] Modelo pronto em {time.time() - t0:.2f}s!\n")
        sys.stderr.flush()
    return _model, _processor


def segment_with_box(image_pil, box_xyxy, positive_points=None, negative_points=None, use_center_point=True):
    """
    Executa a segmentação precisa no SAM 2.1 utilizando a Bounding Box do Florence-2.
    Retorna lista de tuplas com máscaras probabilísticas contínuas (float32 de 0.0 a 1.0):
    [(mask_prob_float32, iou_score), ...]
    NÃO binariza precocemente para 0 ou 255, preservando tons intermediários de anti-aliasing.
    """
    image = image_pil.convert("RGB")
    w, h = image.size
    model, processor = get_sam2_model()

    x1, y1, x2, y2 = [int(round(coord)) for coord in box_xyxy]
    x1 = max(0, min(w - 1, x1))
    y1 = max(0, min(h - 1, y1))
    x2 = max(x1 + 1, min(w, x2))
    y2 = max(y1 + 1, min(h, y2))
    clamped_box = [x1, y1, x2, y2]

    # Ponto positivo seguro no centro da Bounding Box
    pts = []
    labels = []

    if positive_points:
        for p in positive_points:
            pts.append([float(p[0]), float(p[1])])
            labels.append(1)
    elif use_center_point:
        # Ponto no centro da caixa (desativado para embalagens: o centro costuma ser a ilustracao)
        cx = float((x1 + x2) / 2.0)
        cy = float((y1 + y2) / 2.0)
        pts.append([cx, cy])
        labels.append(1)

    if negative_points:
        for p in negative_points:
            pts.append([float(p[0]), float(p[1])])
            labels.append(0)

    input_points = [[pts]] if pts else None
    input_labels = [[labels]] if pts else None

    t0 = time.time()
    with torch.inference_mode():
        proc_kwargs = dict(input_boxes=[[clamped_box]], return_tensors="pt")
        if input_points is not None:
            proc_kwargs["input_points"] = input_points
            proc_kwargs["input_labels"] = input_labels
        inputs = processor(image, **proc_kwargs).to(_device)

        outputs = model(**inputs)
        # binarize=False para receber os logits contínuos sem corte rígido em degraus
        masks = processor.post_process_masks(
            outputs.pred_masks.cpu(),
            inputs["original_sizes"].cpu(),
            binarize=False
        )

    sys.stderr.write(f"[SAM] Inferência concluída em {time.time() - t0:.2f}s!\n")
    sys.stderr.flush()

    # Extrair logits contínuos e converter via sigmóide para probabilidades contínuas (0.0 a 1.0)
    iou_scores = outputs.iou_scores[0, 0].cpu().numpy()
    pred_logits = masks[0][0].numpy()  # shape (num_masks, H, W)

    results = []
    for i in range(len(iou_scores)):
        # Sigmóide suave preservando os sub-pixels na borda
        prob = 1.0 / (1.0 + np.exp(-pred_logits[i].astype(np.float32)))
        prob = np.clip(prob, 0.0, 1.0)
        score = float(iou_scores[i])
        results.append((prob, score))

    sys.stderr.write(f"[SAM] Máscaras probabilísticas geradas: {len(results)}\n")
    sys.stderr.flush()
    return results


def select_best_mask(candidate_masks, bounding_box, image_size, prefer_whole=False):
    """
    Avalia as máscaras candidatas do SAM 2.1 e seleciona a melhor.
    Critérios:
    - Score de IoU do SAM
    - Cobertura da Bounding Box
    - Coerência espacial e integridade do objeto
    Retorna (best_mask_prob_float32, best_details)
    """
    w, h = image_size
    bx1, by1, bx2, by2 = bounding_box
    bbox_area = max(1.0, float((bx2 - bx1) * (by2 - by1)))

    best_mask = None
    best_score = -1.0
    best_details = {}

    for idx, (m_prob, sam_score) in enumerate(candidate_masks):
        # Binarização apenas para estatísticas de área e componentes
        bin_thresh = (m_prob > 0.50).astype(np.uint8)
        mask_area = float(np.sum(bin_thresh > 0))
        coverage_ratio = mask_area / bbox_area

        if 0.30 <= coverage_ratio <= 1.05:
            coverage_score = 1.0
        elif 0.15 <= coverage_ratio < 0.30:
            coverage_score = 0.50
        elif coverage_ratio > 1.05:
            coverage_score = max(0.0, 1.0 - (coverage_ratio - 1.05) * 2.0)
        else:
            coverage_score = 0.20

        num_labels, labels_im, stats, centroids = cv2.connectedComponentsWithStats(bin_thresh)
        component_penalty = 0.0
        if num_labels > 6:
            component_penalty = min(0.35, (num_labels - 6) * 0.05)

        if prefer_whole:
            # Embalagens: favorece a mascara que cobre o objeto INTEIRO (nao so a ilustracao do miolo)
            whole_term = min(coverage_ratio, 1.0) if coverage_ratio <= 1.05 else coverage_score
            total_score = (sam_score * 0.25) + (coverage_score * 0.20) + (whole_term * 0.55) - component_penalty
        else:
            total_score = (sam_score * 0.45) + (coverage_score * 0.45) - component_penalty

        if total_score > best_score:
            best_score = total_score
            best_mask = m_prob
            best_details = {
                "mask_index": idx,
                "sam_score": sam_score,
                "coverage_ratio": coverage_ratio,
                "components": num_labels - 1,
                "composite_score": total_score
            }

    sys.stderr.write(
        f"[SAM] Melhor máscara selecionada: #{best_details.get('mask_index', 0)} "
        f"(sam_score={best_details.get('sam_score', 0):.3f}, "
        f"cobertura_bbox={best_details.get('coverage_ratio', 0)*100:.1f}%, "
        f"score_final={best_score:.3f})\n"
    )
    sys.stderr.flush()
    return best_mask, best_details


# ==============================================================================
# FUNÇÕES DE ACABAMENTO, SUAVIZAÇÃO E DESCONTAMINAÇÃO DE HALO
# ==============================================================================

def resize_mask_soft(mask_float, target_size):
    """
    Redimensiona a máscara probabilística para a resolução original utilizando
    interpolação suave LANCZOS ou LINEAR, garantindo transições contínuas sem degraus.
    """
    tw, th = target_size
    m = mask_float.astype(np.float32)
    if (m.shape[1], m.shape[0]) == (tw, th):
        return m
    return cv2.resize(m, (tw, th), interpolation=cv2.INTER_LANCZOS4)


def build_edge_band(bin_mask, inner_px=2, outer_px=2):
    """
    Constrói o miolo sólido (inner_core) e a faixa estreita de borda (edge_band).
    Garante que o miolo do produto permaneça 100% sólido (alpha = 1.0) e sem vazamentos,
    restringindo a transição e a descontaminação estritamente à borda.
    """
    k_inner = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (inner_px * 2 + 1, inner_px * 2 + 1))
    k_outer = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (outer_px * 2 + 1, outer_px * 2 + 1))

    inner_core = cv2.erode(bin_mask, k_inner, iterations=1)
    outer_bound = cv2.dilate(bin_mask, k_outer, iterations=1)
    edge_band = (outer_bound > 0) & (inner_core == 0)

    return inner_core, edge_band, outer_bound


def decontaminate_edge_colors(image_rgb, inner_core, edge_band):
    """Preserva rigorosamente a nitidez, reflexos e cores originais da borda sem inpaint difuso destrutivo."""
    if isinstance(image_rgb, Image.Image):
        rgb = np.array(image_rgb.convert("RGB"))
    else:
        rgb = np.array(image_rgb)
    return rgb


def refine_alpha_matting(soft_mask, inner_core, edge_band, outer_bound, radius=0.8):
    """
    Refinamento de matting no canal Alpha:
    - Miolo estrutural do produto: travado em 1.0 (100% sólido)
    - Fundo exterior definitivo: travado em 0.0
    - Faixa de transição de borda: suavização Hermite cúbica contínua preservando transparências legítimas
    """
    a = np.clip(soft_mask.astype(np.float32), 0.0, 1.0)

    ksize = int(math.ceil(radius * 3) * 2 + 1)
    ksize = max(3, ksize | 1)
    blurred = cv2.GaussianBlur(a, (ksize, ksize), radius)

    # Curva cúbica Hermite na borda
    ramp = np.clip((blurred - 0.02) / 0.96, 0.0, 1.0)
    smooth_edge = ramp * ramp * (3.0 - 2.0 * ramp)

    final_alpha = a.copy()
    final_alpha[inner_core > 0] = 1.0
    final_alpha[outer_bound == 0] = 0.0
    final_alpha[edge_band] = smooth_edge[edge_band]

    return np.clip(final_alpha, 0.0, 1.0)


def composite_on_white_preview(rgba_pil_or_arr):
    """Gera prévia composta sobre fundo branco puro (#FFFFFF) para validação visual."""
    if isinstance(rgba_pil_or_arr, Image.Image):
        rgba = np.array(rgba_pil_or_arr)
    else:
        rgba = np.array(rgba_pil_or_arr)

    rgb = rgba[:, :, :3].astype(np.float32)
    a = (rgba[:, :, 3:4].astype(np.float32)) / 255.0
    white_bg = np.array([255.0, 255.0, 255.0], dtype=np.float32)

    comp = rgb * a + white_bg * (1.0 - a)
    comp = np.clip(comp, 0.0, 255.0).astype(np.uint8)
    return Image.fromarray(comp, mode="RGB")


def remove_small_components(mask_float, min_area=25):
    """
    Remove pequenos artefatos e ilhas isoladas de ruído (menores que min_area).
    NÃO remove partes finas conectadas (cabos, hastes, gancheiras).
    """
    bin_mask = (mask_float > 0.50).astype(np.uint8)
    num_labels, labels_im, stats, _ = cv2.connectedComponentsWithStats(bin_mask, connectivity=8)

    cleaned_float = mask_float.copy()
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < min_area:
            cleaned_float[labels_im == i] = 0.0

    return cleaned_float


def clean_packaging_mask(mask_float, close_frac=0.015):
    """
    Limpeza para embalagens (formas compactas): fecha lacunas serrilhadas na borda
    (kernel ~1.5% do menor lado) e mantem apenas o maior componente conectado.
    Evita que regioes escuras/claras proximas da borda virem 'buracos' no recorte.
    """
    h, w = mask_float.shape[:2]
    bin_mask = (mask_float > 0.50).astype(np.uint8)
    k = max(5, int(min(w, h) * close_frac)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    closed = cv2.morphologyEx(bin_mask, cv2.MORPH_CLOSE, kernel)
    num, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    if num <= 1:
        return mask_float
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = (labels == largest)
    return np.where(keep, np.maximum(mask_float, closed.astype(np.float32)), 0.0).astype(np.float32)


def fill_tiny_holes(mask_float, max_area=40):
    """
    Preenche apenas micro-poros e ruídos pontuais de pixel (menores que max_area).
    PRESERVA RIGOROSAMENTE furos médios e grandes estruturais (gancheiras, furos de blister,
    alças de ferramentas, vazados).
    """
    bin_mask = (mask_float > 0.50).astype(np.uint8)
    inverted = (1 - bin_mask).astype(np.uint8)
    num_labels, labels_im, stats, _ = cv2.connectedComponentsWithStats(inverted, connectivity=8)

    h, w = bin_mask.shape
    border_labels = set()
    border_labels.update(labels_im[0, :].tolist())
    border_labels.update(labels_im[h - 1, :].tolist())
    border_labels.update(labels_im[:, 0].tolist())
    border_labels.update(labels_im[:, w - 1].tolist())

    cleaned_float = mask_float.copy()
    for i in range(1, num_labels):
        if i in border_labels:
            continue
        area = stats[i, cv2.CC_STAT_AREA]
        if area <= max_area:
            cleaned_float[labels_im == i] = 1.0

    return cleaned_float


def fill_packaging_internal_holes(mask_float, bounding_box, preserve_hanging_slot=True):
    """
    Preenche buracos internos em embalagens (textos vazados, letras brancas em fundo colorido,
    logotipos), garantindo que o rótulo permaneça 100% sólido.
    Preserva rigorosamente a gancheira (Euro slot / furo de pendurar) na região superior central.
    """
    bin_mask = (mask_float > 0.50).astype(np.uint8)
    h, w = bin_mask.shape
    bx1, by1, bx2, by2 = bounding_box
    bw = max(1, bx2 - bx1)
    bh = max(1, by2 - by1)

    # Inverter e analisar componentes de fundo
    inverted = (1 - bin_mask).astype(np.uint8)
    num_labels, labels_im, stats, centroids = cv2.connectedComponentsWithStats(inverted, connectivity=8)

    # Identificar o componente com maior área que toca a borda (o verdadeiro fundo externo)
    border_pixels = np.concatenate([
        labels_im[0, :],
        labels_im[h - 1, :],
        labels_im[:, 0],
        labels_im[:, w - 1]
    ])
    
    # Contagem de pixels na borda por label
    unique_border, counts = np.unique(border_pixels, return_counts=True)
    border_counts = dict(zip(unique_border, counts))

    cleaned_float = mask_float.copy()

    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        cx, cy = centroids[i]
        edge_touches = border_counts.get(i, 0)

        # Se o componente cobre a grande maioria da borda externa, é o fundo da foto
        if edge_touches > (2 * (w + h) * 0.15) or (edge_touches > 0 and area > (w * h * 0.40)):
            continue

        is_hanging_slot = False
        if preserve_hanging_slot and bh > 100:
            rel_x = (cx - bx1) / float(bw)
            rel_y = (cy - by1) / float(bh)
            if 0.25 <= rel_x <= 0.75 and 0.02 <= rel_y <= 0.25:
                if 150 <= area <= 25000:
                    is_hanging_slot = True

        if not is_hanging_slot:
            cleaned_float[labels_im == i] = 1.0

    return cleaned_float


def validate_mask(mask_float, bounding_box, image_size, sam_score=None, min_bbox_ratio=0.22):
    """
    Valida automaticamente a qualidade e a consistência da máscara gerada.
    """
    w, h = image_size
    img_area = float(w * h)
    bx1, by1, bx2, by2 = bounding_box
    bbox_area = max(1.0, float((bx2 - bx1) * (by2 - by1)))

    bin_mask = (mask_float > 0.50).astype(np.uint8)
    mask_area = float(np.sum(bin_mask > 0))
    mask_bbox_ratio = mask_area / bbox_area
    mask_image_ratio = mask_area / img_area

    num_labels, _, _, _ = cv2.connectedComponentsWithStats(bin_mask)
    num_components = max(0, num_labels - 1)

    top_contact = np.sum(bin_mask[0, :] > 0)
    bottom_contact = np.sum(bin_mask[h - 1, :] > 0)
    left_contact = np.sum(bin_mask[:, 0] > 0)
    right_contact = np.sum(bin_mask[:, w - 1] > 0)
    border_contacts = int(top_contact + bottom_contact + left_contact + right_contact)

    metrics = {
        "mask_area": int(mask_area),
        "bbox_area": int(bbox_area),
        "mask_bbox_ratio": round(mask_bbox_ratio, 3),
        "mask_image_ratio": round(mask_image_ratio, 3),
        "num_components": num_components,
        "border_contacts": border_contacts,
        "sam_score": round(float(sam_score), 3) if sam_score is not None else None
    }

    reasons = []
    valid = True
    confidence = 1.0

    if mask_area < 100:
        valid = False
        confidence = 0.0
        reasons.append("Máscara vazia ou área insignificante.")
    elif mask_bbox_ratio < min_bbox_ratio:
        valid = False
        confidence = max(0.1, mask_bbox_ratio * 2.0)
        reasons.append(f"Cobertura muito baixa da Bounding Box ({mask_bbox_ratio*100:.1f}%). Possível corte de detalhe interno.")
    elif mask_image_ratio > 0.96 and (bbox_area / img_area) < 0.75:
        valid = False
        confidence = 0.2
        reasons.append(f"Máscara vazou para fora da Bounding Box ({mask_image_ratio*100:.1f}% da imagem total).")
    elif num_components > 20:
        confidence -= 0.35
        reasons.append(f"Número elevado de componentes desconexos ({num_components}).")

    if valid:
        confidence = min(1.0, max(0.5, (sam_score or 0.85) * (0.8 + (mask_bbox_ratio * 0.2))))

    return {
        "valid": valid,
        "confidence": round(float(confidence), 3),
        "reasons": reasons,
        "metrics": metrics
    }


def apply_alpha_mask(image_pil_or_arr, alpha_float):
    """
    Aplica o canal Alpha na imagem mantendo RGB e nitidez intactos.
    Retorna imagem RGBA transparente com transição aveludada e natural.
    """
    if isinstance(image_pil_or_arr, Image.Image):
        rgb = np.array(image_pil_or_arr.convert("RGB"))
    else:
        rgb = np.array(image_pil_or_arr)[:, :, :3]

    alpha_uint8 = np.clip(alpha_float * 255.0, 0.0, 255.0).astype(np.uint8)

    if alpha_uint8.shape[:2] != rgb.shape[:2]:
        alpha_uint8 = cv2.resize(alpha_uint8, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LANCZOS4)

    rgba = np.dstack([rgb, alpha_uint8])
    return Image.fromarray(rgba, mode="RGBA")
