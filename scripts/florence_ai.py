"""
Módulo Florence-2 AI - Microsoft Florence-2 Base
Localização semântica do produto físico completo, OCR e geração de Bounding Boxes.
Totalmente local e gratuito (licença MIT Microsoft).
"""

import os
import sys
import time
import re
import math
import torch
from PIL import Image
import numpy as np

_device = "cuda" if torch.cuda.is_available() else "cpu"
_torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32
_model = None
_processor = None


def get_florence_model():
    """Carrega o modelo Florence-2 sob demanda (mantém em memória após a primeira chamada)."""
    global _model, _processor
    if _model is None or _processor is None:
        model_id = "microsoft/Florence-2-base"
        t0 = time.time()
        sys.stderr.write(f"[Florence] Carregando modelo em memória ({_device}, {_torch_dtype})...\n")
        sys.stderr.flush()

        from transformers import AutoProcessor, AutoModelForCausalLM
        _model = AutoModelForCausalLM.from_pretrained(
            model_id,
            torch_dtype=_torch_dtype,
            trust_remote_code=True
        ).to(_device)
        _model.eval()
        _processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)

        sys.stderr.write(f"[Florence] Modelo pronto em {time.time() - t0:.2f}s!\n")
        sys.stderr.flush()
    return _model, _processor


def run_florence_task(image, task_prompt, text_input=None, max_tokens=1024):
    """Executa uma tarefa Florence-2 com segurança e parsing automático."""
    model, processor = get_florence_model()
    prompt = task_prompt if text_input is None else task_prompt + text_input
    
    with torch.inference_mode():
        inputs = processor(text=prompt, images=image, return_tensors="pt").to(_device, _torch_dtype)
        generated_ids = model.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=max_tokens,
            num_beams=1,
            do_sample=False,
            use_cache=False
        )
        generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = processor.post_process_generation(
            generated_text,
            task=task_prompt,
            image_size=(image.width, image.height)
        )
    return parsed


def infer_physical_object_type(product_name=None, product_category=None, keywords=None):
    """
    Classifica o produto em seu tipo físico comercial real (embalagem vs objeto direto),
    evitando que fotos impressas no rótulo (ex.: foto da alface no sachê de sementes)
    sejam confundidas com o produto comercial vendido.
    """
    name = (product_name or "").lower()
    cat = (product_category or "").lower()
    kw_str = " ".join(keywords or []).lower()
    corpus = f"{name} {cat} {kw_str}".strip()

    # 1. Sachês de Sementes e Envelopes Agrícolas / Jardim
    seed_indicators = [
        "semente", "sementes", "sem.", "horta", "garden", "adubo", 
        "fertilizante", "seed packet", "seed", "seeds", "envelopinho"
    ]
    if any(re.search(r'\b' + re.escape(w), corpus) for w in seed_indicators):
        return {
            "physical_type": "seed_packet",
            "is_packaging": True,
            "is_hanging_pack": True,
            "detection_prompts": [
                "seed packet",
                "seed package",
                "retail seed packaging",
                "hanging retail package",
                "product packaging",
                "seed envelope"
            ],
            "retry_prompts": [
                "retail seed packet",
                "hanging seed package",
                "product package",
                "full product packaging",
                "retail packaging"
            ],
            "excluded_keywords": [
                "alface", "lettuce", "vegetable", "leaf", "plant", "food", 
                "cabbage", "folha", "legume", "verdura", "tomate", "cenoura", 
                "rabanete", "pimenta", "morango", "hortaliça"
            ]
        }

    # 2. Blisters, Cartelas e Embalagens Penduráveis (pilhas, ferragens, cosméticos)
    blister_indicators = ["blister", "blist.", "blist", "cartela", "cart.", "cartelas", "display", "cartela pendurável"]
    if any(re.search(r'\b' + re.escape(w), corpus) for w in blister_indicators):
        return {
            "physical_type": "blister_pack",
            "is_packaging": True,
            "is_hanging_pack": True,
            "detection_prompts": [
                "blister pack",
                "carded packaging",
                "retail package",
                "hanging retail package",
                "blister card",
                "product package"
            ],
            "retry_prompts": [
                "retail blister card",
                "full carded packaging",
                "hanging retail package",
                "product package",
                "full product packaging"
            ],
            "excluded_keywords": []
        }

    # 3. Caixas de Varejo / Cartuchos
    box_indicators = ["caixa", "cx", "cx.", "carton", "estojo"]
    if any(re.search(r'\b' + re.escape(w), corpus) for w in box_indicators):
        return {
            "physical_type": "product_box",
            "is_packaging": True,
            "is_hanging_pack": False,
            "detection_prompts": [
                "product box",
                "retail box",
                "carton",
                "product package",
                "retail packaging"
            ],
            "retry_prompts": [
                "retail product box",
                "packaging box",
                "full product box",
                "the entire package"
            ],
            "excluded_keywords": []
        }

    # 4. Frascos, Garrafas e Potes
    bottle_indicators = ["frasco", "garrafa", "pote", "litro", "500ml", "1l", "vidro", "lata", "galão", "spray"]
    if any(re.search(r'\b' + re.escape(w), corpus) for w in bottle_indicators):
        return {
            "physical_type": "bottle",
            "is_packaging": True,
            "is_hanging_pack": False,
            "detection_prompts": [
                "bottle",
                "spray bottle",
                "product bottle",
                "plastic bottle",
                "jar",
                "dispenser",
                "container",
                "product packaging"
            ],
            "retry_prompts": [
                "the whole bottle",
                "spray bottle",
                "product container",
                "entire item"
            ],
            "excluded_keywords": []
        }

    # 5. Sachês, Bolsas e Sacos Flexíveis em Geral
    sachet_indicators = ["saco", "sache", "sachê", "refil", "pct", "pacote", "pouch", "envelope"]
    if any(re.search(r'\b' + re.escape(w), corpus) for w in sachet_indicators):
        return {
            "physical_type": "sachet",
            "is_packaging": True,
            "is_hanging_pack": True,
            "detection_prompts": [
                "sachet",
                "product bag",
                "pouch",
                "packet",
                "product package",
                "retail packaging"
            ],
            "retry_prompts": [
                "full retail pouch",
                "sachet package",
                "the whole product"
            ],
            "excluded_keywords": []
        }

    # 6. Ferramentas e Itens Manuais
    tool_indicators = ["alicate", "chave", "martelo", "tesoura", "broca", "ferramenta", "disco", "trena"]
    if any(re.search(r'\b' + re.escape(w), corpus) for w in tool_indicators):
        return {
            "physical_type": "tool",
            "is_packaging": False,
            "is_hanging_pack": False,
            "detection_prompts": [
                "hand tool",
                "tool",
                "hardware product",
                "the whole tool",
                "tool on card packaging"
            ],
            "retry_prompts": [
                "entire tool",
                "hand tool product",
                "the whole item"
            ],
            "excluded_keywords": []
        }

    # 7. Tipo Padrão (Geral)
    return {
        "physical_type": "general_product",
        "is_packaging": False,
        "is_hanging_pack": False,
        "detection_prompts": [
            "retail packaging",
            "product package",
            "the whole product",
            "the entire item",
            "package",
            "product"
        ],
        "retry_prompts": [
            "the whole product",
            "entire commercial product",
            "retail product item"
        ],
        "excluded_keywords": []
    }


def generate_detection_prompts(product_name=None, product_category=None, keywords=None):
    """
    Gera diferentes formas semânticas de descrever o objeto físico completo,
    evitando que o modelo foque apenas em ilustrações ou fotos impressas no miolo.
    """
    info = infer_physical_object_type(product_name, product_category, keywords)
    return list(info["detection_prompts"])


def expand_box(box, image_size, percentage=0.03):
    """
    Expande a Bounding Box em aproximadamente 3% (ou percentage)
    respeitando estritamente os limites da imagem.
    Garante a preservação de gancheiras, abas, cabos, pontas e bordas finas.
    """
    w, h = image_size
    x1, y1, x2, y2 = box
    bw = max(1, x2 - x1)
    bh = max(1, y2 - y1)

    pad_x = int(round(bw * percentage))
    pad_y = int(round(bh * percentage))

    new_x1 = max(0, x1 - pad_x)
    new_y1 = max(0, y1 - pad_y)
    new_x2 = min(w, x2 + pad_x)
    new_y2 = min(h, y2 + pad_y)

    return [new_x1, new_y1, new_x2, new_y2]


def detect_product(image_pil, product_name=None, product_category=None, keywords=None, prompts_override=None):
    """
    Localiza o produto físico completo gerando candidatos de Bounding Box.
    Retorna lista de candidatos:
    [
        {"box": [x1, y1, x2, y2], "score": float, "label": str, "source": str},
        ...
    ]
    """
    image = image_pil.convert("RGB")
    w, h = image.size
    img_area = float(w * h)

    physical_info = infer_physical_object_type(product_name, product_category, keywords)
    if prompts_override:
        prompts = prompts_override
    else:
        prompts = physical_info["detection_prompts"]

    candidates = []

    sys.stderr.write(f"[Florence] Localizando produto: '{product_name or 'não especificado'}' (tamanho {w}x{h}, tipo={physical_info['physical_type']})\n")
    sys.stderr.write(f"[Florence] Prompts semânticos: {prompts[:4]}\n")
    sys.stderr.flush()

    # 1. Detecção via <CAPTION_TO_PHRASE_GROUNDING> com prompts semânticos físicos
    for p in prompts[:4]:
        try:
            res = run_florence_task(image, "<CAPTION_TO_PHRASE_GROUNDING>", p)
            data = res.get("<CAPTION_TO_PHRASE_GROUNDING>", {})
            bboxes = data.get("bboxes", [])
            labels = data.get("labels", [])
            for i, b in enumerate(bboxes):
                label = labels[i] if i < len(labels) else p
                candidates.append({
                    "box": [int(round(b[0])), int(round(b[1])), int(round(b[2])), int(round(b[3]))],
                    "score": 0.90,
                    "label": label,
                    "source": f"grounding:{p}"
                })
        except Exception as e:
            sys.stderr.write(f"[Florence] Erro no grounding '{p}': {e}\n")
            sys.stderr.flush()

    # 2. Detecção de Objetos Padrão <OD>
    excluded = [ex.lower() for ex in physical_info.get("excluded_keywords", [])]
    try:
        od_res = run_florence_task(image, "<OD>")
        od_data = od_res.get("<OD>", {})
        od_bboxes = od_data.get("bboxes", [])
        od_labels = od_data.get("labels", [])
        for i, b in enumerate(od_bboxes):
            label = od_labels[i] if i < len(od_labels) else "object"
            label_lower = label.lower()
            # Se é embalagem esperada e a OD detectou apenas o elemento ilustrado interno (ex.: cabbage, lettuce, plant),
            # não usar como alvo principal
            if physical_info["is_packaging"] and any(ex in label_lower for ex in excluded):
                continue

            candidates.append({
                "box": [int(round(b[0])), int(round(b[1])), int(round(b[2])), int(round(b[3]))],
                "score": 0.80,
                "label": label,
                "source": "od"
            })
    except Exception as e:
        sys.stderr.write(f"[Florence] Erro em OD: {e}\n")
        sys.stderr.flush()

    # Normalizar coordenadas e remover caixas degeneradas
    valid_candidates = []
    for c in candidates:
        b = c["box"]
        x1 = max(0, min(w - 1, b[0]))
        y1 = max(0, min(h - 1, b[1]))
        x2 = max(x1 + 1, min(w, b[2]))
        y2 = max(y1 + 1, min(h, b[3]))
        box_area = (x2 - x1) * (y2 - y1)
        # Ignora caixas menores que 1% da imagem
        if box_area >= (img_area * 0.01):
            valid_candidates.append({
                "box": [x1, y1, x2, y2],
                "score": float(c.get("score", 0.5)),
                "label": str(c.get("label", "")),
                "source": str(c.get("source", "unknown"))
            })

    # Caso nenhum candidato seja encontrado, usar a imagem inteira com margem de segurança
    if not valid_candidates:
        sys.stderr.write("[Florence] Nenhum candidato específico encontrado. Usando imagem total como fallback.\n")
        valid_candidates.append({
            "box": [0, 0, w, h],
            "score": 0.50,
            "label": "full_image",
            "source": "fallback"
        })

    # Deduplicar caixas muito semelhantes (IoU > 0.88)
    deduped = []
    for c in valid_candidates:
        is_dup = False
        for d in deduped:
            iou = _compute_iou(c["box"], d["box"])
            if iou > 0.88:
                is_dup = True
                if c["score"] > d["score"]:
                    d.update(c)
                break
        if not is_dup:
            deduped.append(c)

    sys.stderr.write(f"[Florence] Candidatos únicos encontrados: {len(deduped)}\n")
    sys.stderr.flush()
    return deduped


def validate_packaging_box(box, image_size, physical_info=None):
    """
    Valida se a Bounding Box cobre a estrutura física da embalagem comercial
    (inclui topo/gancheira, base e laterais coerentes) ou se representa apenas
    um elemento ilustrado interno.
    """
    w, h = image_size
    x1, y1, x2, y2 = box
    bw = x2 - x1
    bh = y2 - y1
    area_ratio = (bw * bh) / float(w * h)

    reasons = []
    is_valid = True

    is_hanging = physical_info.get("is_hanging_pack", False) if physical_info else True

    if is_hanging:
        if y1 > 0.20 * h:
            is_valid = False
            reasons.append(f"ignora cabeçalho e gancheira superior (y1={y1} > {int(0.20*h)})")

        if y2 < 0.75 * h:
            is_valid = False
            reasons.append(f"ignora base da embalagem (y2={y2} < {int(0.75*h)})")

        if bh < 0.50 * h:
            is_valid = False
            reasons.append(f"altura insuficiente para embalagem (altura={bh} < {int(0.50*h)})")

        if area_ratio < 0.18:
            is_valid = False
            reasons.append(f"área insuficiente para sachê/cartela ({area_ratio*100:.1f}% < 18%)")
    else:
        # Para objetos 3D, frascos, sprays, garrafas, potes e caixas:
        # Frascos podem ser esguios/verticais ocupando de 10% a 25% da área total da imagem.
        is_tall = bh >= (0.35 * h)
        if is_tall:
            if area_ratio < 0.08:
                is_valid = False
                reasons.append(f"área extremamente reduzida ({area_ratio*100:.1f}% < 8%)")
        else:
            if area_ratio < 0.15:
                is_valid = False
                reasons.append(f"área insuficiente para objeto físico ({area_ratio*100:.1f}% < 15%)")

    confidence = 1.0 if is_valid else max(0.0, 1.0 - (0.35 * len(reasons)))
    return {
        "valid": is_valid,
        "confidence": confidence,
        "reasons": reasons
    }


def rank_candidates(candidates, image_size, product_name=None, product_category=None, keywords=None):
    """
    Classifica as Bounding Boxes candidatas em ordem de preferência.
    Prioriza o objeto físico completo (área adequada, centralidade, proporção e coerência semântica)
    em vez de detalhes ou ilustrações internas menores.
    """
    w, h = image_size
    img_area = float(w * h)
    img_cx = w / 2.0
    img_cy = h / 2.0
    max_dist = math.sqrt(img_cx**2 + img_cy**2)

    physical_info = infer_physical_object_type(product_name, product_category, keywords)
    physical_type = physical_info.get("physical_type", "general_product")
    is_packaging = physical_info.get("is_packaging", False)
    is_hanging = physical_info.get("is_hanging_pack", False)
    excluded = [k.lower() for k in physical_info.get("excluded_keywords", [])]

    # 1. Detecção de contenção geométrica (Box Containment)
    # Identifica se um candidato menor está contido dentro de um candidato maior de produto/embalagem
    for i, c_inner in enumerate(candidates):
        ix1, iy1, ix2, iy2 = c_inner["box"]
        inner_area = (ix2 - ix1) * (iy2 - iy1)
        c_inner["is_contained"] = False

        for j, c_outer in enumerate(candidates):
            if i == j:
                continue
            ox1, oy1, ox2, oy2 = c_outer["box"]
            outer_area = (ox2 - ox1) * (oy2 - oy1)

            # Uma caixa só pode atuar como recipiente se NÃO for a moldura inteira da imagem
            if outer_area >= (0.94 * img_area):
                continue

            # Interseção
            inter_x1 = max(ix1, ox1)
            inter_y1 = max(iy1, oy1)
            inter_x2 = min(ix2, ox2)
            inter_y2 = min(iy2, oy2)
            inter_w = max(0, inter_x2 - inter_x1)
            inter_h = max(0, inter_y2 - inter_y1)
            inter_area = inter_w * inter_h

            # Se c_inner está mais de 80% contido em c_outer e é substancialmente menor
            if inner_area > 0 and (inter_area / float(inner_area)) >= 0.80 and inner_area <= 0.75 * outer_area:
                c_inner["is_contained"] = True
                c_inner["container_box"] = c_outer["box"]
                break

    ranked = []
    for c in candidates:
        x1, y1, x2, y2 = c["box"]
        bw = x2 - x1
        bh = y2 - y1
        box_area = bw * bh
        area_ratio = box_area / img_area

        # 1. Distância ao centro da imagem (produtos principais ficam centralizados)
        box_cx = (x1 + x2) / 2.0
        box_cy = (y1 + y2) / 2.0
        dist_to_center = math.sqrt((box_cx - img_cx)**2 + (box_cy - img_cy)**2)
        center_score = max(0.0, 1.0 - (dist_to_center / max_dist))

        # 2. Coerência de área:
        # Objetos verticais/esguios (como frascos) cobrem naturalmente entre 14% e 40% da imagem quadrada
        is_slender = (bh >= 1.8 * bw)
        if area_ratio >= 0.35 or (is_slender and area_ratio >= 0.14):
            area_score = 1.0
        elif 0.18 <= area_ratio < 0.35 or (is_slender and area_ratio >= 0.08):
            area_score = 0.70
        else:
            area_score = 0.25

        # 3. Heurísticas estruturais e semânticas
        structural_bonus = 0.0
        label_lower = c["label"].lower()

        # Penalidade se for um elemento estritamente contido dentro de um recipiente/produto maior
        if c.get("is_contained"):
            structural_bonus -= 0.60

        if is_hanging:
            # Regras específicas de gancheiras / sachês penduráveis
            # Penalidade se corta o topo/cabeçalho
            if y1 > 0.18 * h:
                structural_bonus -= 0.50

            # Penalidade se corta a base
            if y2 < 0.80 * h:
                structural_bonus -= 0.40

            # Bônus se cobre cabeçalho e base com proporção vertical coerente
            if y1 <= 0.12 * h and y2 >= 0.82 * h:
                structural_bonus += 0.45
                if bh >= (0.85 * bw): # Proporção de sachê / cartela
                    structural_bonus += 0.15

        # Penalidade drástica se o label é biológico / alimento quando esperava embalagem
        if any(ex in label_lower for ex in excluded):
            structural_bonus -= 0.70

        # Bônus semântico alinhado à categoria física
        if physical_type == "bottle":
            if any(t in label_lower for t in ["bottle", "spray", "dispenser", "jar", "can", "container", "canister"]):
                structural_bonus += 0.40
            elif any(t in label_lower for t in ["package", "packaging", "item", "product"]):
                structural_bonus += 0.20
        elif physical_type in ("sachet", "seed_packet", "blister_pack"):
            if any(t in label_lower for t in ["packet", "package", "packaging", "sachet", "pouch", "envelope", "card"]):
                structural_bonus += 0.40
        elif physical_type == "product_box":
            if any(t in label_lower for t in ["box", "carton", "package", "packaging"]):
                structural_bonus += 0.40
        elif physical_type == "tool":
            if any(t in label_lower for t in ["tool", "hardware", "pliers", "wrench", "hammer"]):
                structural_bonus += 0.40
        else:
            if any(t in label_lower for t in ["package", "packaging", "product", "bottle", "box", "item"]):
                structural_bonus += 0.25

        # Pontuação combinada ponderada
        raw_score = c.get("score", 0.7)
        ranking_score = (
            (raw_score * 0.20) +
            (area_score * 0.35) +
            (center_score * 0.15) +
            structural_bonus
        )

        ranked.append({
            **c,
            "area_ratio": area_ratio,
            "center_score": center_score,
            "structural_bonus": structural_bonus,
            "ranking_score": ranking_score
        })

    # Ordenar por maior ranking_score
    ranked.sort(key=lambda x: x["ranking_score"], reverse=True)

    for i, r in enumerate(ranked[:3]):
        sys.stderr.write(
            f"[Florence] Candidato #{i+1}: label='{r['label']}' "
            f"bbox={r['box']} area={r['area_ratio']*100:.1f}% "
            f"score={r['ranking_score']:.3f} (orig_score={r['score']:.2f})\n"
        )
    sys.stderr.flush()

    return ranked


def _compute_iou(b1, b2):
    """Calcula Intersection over Union (IoU) entre duas caixas [x1, y1, x2, y2]."""
    xa = max(b1[0], b2[0])
    ya = max(b1[1], b2[1])
    xb = min(b1[2], b2[2])
    yb = min(b1[3], b2[3])
    inter = max(0, xb - xa) * max(0, yb - ya)
    if inter == 0:
        return 0.0
    area1 = (b1[2] - b1[0]) * (b1[3] - b1[1])
    area2 = (b2[2] - b2[0]) * (b2[3] - b2[1])
    union = area1 + area2 - inter
    return inter / float(union) if union > 0 else 0.0


# ==============================================================================
# Funções de Compatibilidade Legada
# ==============================================================================

def classify_product(img_input, product_name=""):
    """Compatibilidade legada com interface IPC do Electron."""
    try:
        image = Image.open(img_input).convert("RGB") if isinstance(img_input, str) else img_input.convert("RGB")
        w, h = image.size
        candidates = detect_product(image, product_name=product_name)
        ranked = rank_candidates(candidates, (w, h), product_name=product_name)
        best = ranked[0] if ranked else {"box": [0, 0, w, h], "label": "product"}

        caption_res = run_florence_task(image, "<DETAILED_CAPTION>")
        caption_text = caption_res.get("<DETAILED_CAPTION>", "")

        ocr_res = run_florence_task(image, "<OCR>")
        ocr_text = ocr_res.get("<OCR>", "")

        cap_lower = caption_text.lower()
        ocr_lower = ocr_text.lower()
        name_lower = (product_name or "").lower()

        pkg_pattern = re.compile(r"\b(packet|package|packaging|pack|sachet|bag|box|carton|pouch|envelope|blister|bottle|jar|can|seed|seeds)\b", re.I)
        pt_pkg_pattern = re.compile(r"\b(sem\.?|semente|sementes|env\.?|envelope|pct\.?|pacote|cart\.?|cartela|blist\.?|blister|sache|cx\.?|caixa)\b", re.I)

        is_pkg = bool(pkg_pattern.search(cap_lower) or pt_pkg_pattern.search(name_lower) or pt_pkg_pattern.search(ocr_lower))
        mode = "packaging" if is_pkg else "object"

        return {
            "mode": mode,
            "caption": caption_text,
            "ocr": ocr_text,
            "main_box": best["box"],
            "bboxes": [r["box"] for r in ranked],
            "labels": [r["label"] for r in ranked]
        }
    except Exception as err:
        sys.stderr.write(f"[Florence] Erro classify_product: {err}\n")
        return {
            "mode": "object",
            "caption": "",
            "ocr": "",
            "main_box": [0, 0, 0, 0],
            "bboxes": [],
            "labels": []
        }


def ocr_product(img_input):
    image = Image.open(img_input).convert("RGB") if isinstance(img_input, str) else img_input.convert("RGB")
    res = run_florence_task(image, "<OCR>")
    return res.get("<OCR>", "")


def caption_product(img_input):
    image = Image.open(img_input).convert("RGB") if isinstance(img_input, str) else img_input.convert("RGB")
    res = run_florence_task(image, "<DETAILED_CAPTION>")
    return res.get("<DETAILED_CAPTION>", "")
