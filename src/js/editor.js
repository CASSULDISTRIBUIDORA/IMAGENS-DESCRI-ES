class Editor {
  constructor() {
    this.processor = new window.ImageProcessor();
    this.pages = []; // Array de objetos de página
    this.activePageId = null;
    this.nextPageId = 1;
    this.isProcessing = false;
    
    // Overlay helpers
    this._overlays = new Map();
    
    // Ajustes padrão
    this.defaultAdjustments = {
      brightness: 0, contrast: 0, saturation: 0,
      temperature: 0, hue: 0, highlights: 0,
      shadows: 0, whites: 0, blacks: 0
    };
    
    this.defaultTransform = {
      zoom: 1, posX: 0, posY: 0, rotation: 0
    };
    this.workspaceZoom = 1.0;
    this.bindGlobalEvents();
    
    // Configura o IntersectionObserver para mudança de página no scroll
    this.pageRatios = new Map();
    this.scrollObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const id = parseInt(entry.target.dataset.pageId);
        this.pageRatios.set(id, entry.intersectionRatio);
      });
      
      let bestId = null;
      let maxRatio = 0;
      for (const [id, ratio] of this.pageRatios.entries()) {
        if (ratio > maxRatio) {
          maxRatio = ratio;
          bestId = id;
        }
      }
      
      if (bestId !== null && maxRatio > 0.4 && this.activePageId !== bestId) {
        if (this.getPage(bestId)) {
          this.setActivePage(bestId);
        }
      }
    }, {
      root: document.getElementById('pages-container'),
      threshold: [0.1, 0.3, 0.5, 0.7, 0.9]
    });
  }

  showPageOverlay(pageId, label = 'Processando...', sub = '', onCancel = null, cancelBtnText = 'Cancelar Remoção (Manter Imagem)') {
    const wrapper = document.querySelector(`.page-wrapper[data-page-id="${pageId}"]`);
    if (!wrapper) return;
    const container = wrapper.querySelector('.canvas-container');
    if (!container) return;
    container.style.position = 'relative';
    this.hidePageOverlay(pageId);
    const overlay = document.createElement('div');
    overlay.className = 'processing-overlay';
    overlay.dataset.pageId = pageId;
    overlay.innerHTML = `
      <div class="processing-spinner"></div>
      <div class="processing-label">${label}<span class="processing-dots"></span></div>
      ${sub ? `<div class="processing-sub">${sub}</div>` : ''}
      <div class="processing-progress"><div class="processing-progress-bar"></div></div>
      ${onCancel ? `
        <div style="display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; justify-content: center;">
          <button type="button" class="btn btn-cancel-overlay" style="font-size: 11px; padding: 6px 14px; background: rgba(239, 68, 68, 0.25); border: 1px solid rgba(239, 68, 68, 0.5); color: #fff; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; transition: background 0.2s; white-space: nowrap;" onmouseover="this.style.background='rgba(239,68,68,0.5)'" onmouseout="this.style.background='rgba(239,68,68,0.25)'">
            <i data-lucide="x" style="width:12px;height:12px;"></i> ${cancelBtnText}
          </button>
          <button type="button" class="btn btn-mode-embalagem" style="font-size: 11px; padding: 6px 14px; background: rgba(59, 130, 246, 0.35); border: 1px solid rgba(59, 130, 246, 0.6); color: #fff; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; transition: background 0.2s; white-space: nowrap;" onmouseover="this.style.background='rgba(59,130,246,0.55)'" onmouseout="this.style.background='rgba(59,130,246,0.35)'">
            <i data-lucide="package" style="width:12px;height:12px;"></i> Preservar Embalagem (Tirar só Fundo)
          </button>
        </div>
      ` : ''}
    `;
    if (onCancel) {
      overlay.style.pointerEvents = 'auto';
      const btnCancel = overlay.querySelector('.btn-cancel-overlay');
      if (btnCancel) {
        btnCancel.style.pointerEvents = 'auto';
        btnCancel.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        };
      }
      const btnEmbalagem = overlay.querySelector('.btn-mode-embalagem');
      if (btnEmbalagem) {
        btnEmbalagem.style.pointerEvents = 'auto';
        btnEmbalagem.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.removeBackgroundPackaging(pageId);
        };
      }
    }
    container.appendChild(overlay);
    this._overlays.set(pageId, overlay);
    this._debouncedLucide();
  }

  hidePageOverlay(pageId) {
    const existing = this._overlays.get(pageId);
    if (existing) {
      existing.style.animation = 'overlayFadeIn 0.2s ease reverse';
      setTimeout(() => existing.remove(), 200);
      this._overlays.delete(pageId);
    }
    document.querySelectorAll(`.processing-overlay[data-page-id="${pageId}"]`).forEach(el => {
      el.style.animation = 'overlayFadeIn 0.2s ease reverse';
      setTimeout(() => el.remove(), 200);
    });
  }
  
  // Debounce de lucide.createIcons para evitar chamadas excessivas
  _lucideTimer = null;
  _debouncedLucide() {
    if (this._lucideTimer) return;
    this._lucideTimer = setTimeout(() => {
      this._lucideTimer = null;
      if (window.lucide) window.lucide.createIcons();
    }, 150);
  }
  
    // ======================== Page Management ========================
  
  async loadQueue(skus) {
    if (!skus || skus.length === 0) return;
    
    this._isLoadingQueue = true;
    const hadActivePage = this.activePageId && this.pages.length > 0;
    const savedActiveId = this.activePageId;
    
    for (const sku of skus) {
      const cleanSku = String(sku || '').trim();
      if (!cleanSku) continue;
      
      // Evitar duplicar se o SKU já existe em alguma página aberta
      const existing = this.pages.find(p => String(p.sku || '').trim() === cleanSku);
      if (existing) {
        console.log(`[Queue] SKU ${cleanSku} já está no editor (Página ${existing.id}), pulando duplicação.`);
        continue;
      }
      
      const pageId = this.createPageSilent();
      const page = this.pages.find(p => p.id === pageId);
      if (page) {
        page.sku = cleanSku;
        const input = document.querySelector(`.page-sku-input[data-page-id="${pageId}"]`);
        if (input) input.value = cleanSku;
        await this.buscarSkuSilent(pageId);
        await new Promise(r => setTimeout(r, 300));
      }
    }
    
    this._isLoadingQueue = false;
    
    if (!hadActivePage && this.pages.length > 0) {
      this.setActivePage(this.pages[0].id);
    } else if (savedActiveId) {
      this.setActivePage(savedActiveId);
    }

    if (window.app && typeof window.app.updateStatusBarQueueCount === 'function') {
      window.app.updateStatusBarQueueCount();
    }
  }

  getNextId() {
    let max = 0;
    for (const p of this.pages) {
      if (p.id && p.id > max) max = p.id;
      if (p.groupId && p.groupId > max) max = p.groupId;
    }
    if (this.nextPageId <= max) {
      this.nextPageId = max + 1;
    }
    return this.nextPageId++;
  }

  createPage(imageData = null) {
    const pageId = this.getNextId();
    const page = {
      id: pageId,
      sku: '',
      productName: '',
      descriptionOriginal: '',
      description: '',
      originalImage: null,
      currentImage: null,
      canvas: null,
      ctx: null,
      adjustments: { ...this.defaultAdjustments },
      transform: { ...this.defaultTransform },
      history: [],
      historyIndex: -1,
      hasChanges: false,
      exportSankhya: true,
      exportTabloide: true,
      variantIndex: 0,
      groupId: pageId,
    };
    
    this.pages.push(page);
    this.renderPageDOM(page);
    this.setActivePage(pageId);
    
    document.body.classList.toggle('has-multiple-pages', this.pages.length > 1);
    
    if (imageData) {
      page._userImage = true;
      this.loadImageToPage(pageId, imageData);
    }
    
    this._debouncedLucide();
    if (window.app && typeof window.app.updateStatusBarQueueCount === 'function') {
      window.app.updateStatusBarQueueCount();
    }
    
    return pageId;
  }
  
  // Cria página sem mudar a página ativa (para loadQueue)
  createPageSilent(imageData = null) {
    const pageId = this.getNextId();
    const page = {
      id: pageId,
      sku: '',
      productName: '',
      descriptionOriginal: '',
      description: '',
      originalImage: null,
      currentImage: null,
      canvas: null,
      ctx: null,
      adjustments: { ...this.defaultAdjustments },
      transform: { ...this.defaultTransform },
      history: [],
      historyIndex: -1,
      hasChanges: false,
      exportSankhya: true,
      exportTabloide: true,
      variantIndex: 0,
      groupId: pageId,
    };
    
    this.pages.push(page);
    this.renderPageDOM(page);
    // NÃO chama setActivePage aqui
    
    document.body.classList.toggle('has-multiple-pages', this.pages.length > 1);
    
    if (imageData) {
      this.loadImageToPage(pageId, imageData);
    }
    
    this._debouncedLucide();
    if (window.app && typeof window.app.updateStatusBarQueueCount === 'function') {
      window.app.updateStatusBarQueueCount();
    }
    
    return pageId;
  }
  
  addVariantPage() {
    const parentPage = this.getActivePage();
    if (!parentPage || !parentPage.sku) {
      if (window.app) window.app.showToast('Selecione uma página com SKU para adicionar variante', 'warning');
      return;
    }

    // Encontra o maior índice de variante para este SKU
    let maxIdx = 0;
    this.pages.forEach(p => {
      if (p.sku === parentPage.sku && p.variantIndex > maxIdx) {
        maxIdx = p.variantIndex;
      }
    });

    const newVariantIndex = maxIdx === 0 ? 2 : maxIdx + 1;
    
    const pageId = this.nextPageId++;
    const page = {
      id: pageId,
      sku: parentPage.sku,
      productName: parentPage.productName,
      descriptionOriginal: parentPage.descriptionOriginal,
      description: parentPage.description,
      originalImage: parentPage.originalImage, // Herda a imagem original para facilitar
      currentImage: parentPage.currentImage,
      canvas: null,
      ctx: null,
      adjustments: { ...this.defaultAdjustments },
      transform: { ...this.defaultTransform },
      history: [],
      historyIndex: -1,
      hasChanges: false,
      exportSankhya: false, // Variantes normalmente não vão pro Sankhya como principal
      exportTabloide: true,
      variantIndex: newVariantIndex,
      groupId: parentPage.groupId || parentPage.id,
    };
    
    this.pages.push(page);
    this.renderPageDOM(page);
    this.setActivePage(pageId);
    
    document.body.classList.toggle('has-multiple-pages', this.pages.length > 1);
    
    if (page.originalImage) {
      page.canvas.width = page.currentImage.width;
      page.canvas.height = page.currentImage.height;
      this.renderPage(pageId);
    }
    
    this._debouncedLucide();
    if (window.app) window.app.showToast(`Variante ${newVariantIndex} adicionada!`, 'success');
    
    return pageId;
  }

  renderPageDOM(page, prepend = false) {
    const container = document.getElementById('pages-container');
    const addBtn = container.querySelector('.add-page-container');
    
    // Procura ou cria o container do grupo (horizontal)
    let groupWrapper = container.querySelector(`.sku-group-wrapper[data-group-id="${page.groupId}"]`);
    let groupContainer = groupWrapper ? groupWrapper.querySelector('.sku-group') : null;
    
    if (!groupWrapper) {
      groupWrapper = document.createElement('div');
      groupWrapper.className = 'sku-group-wrapper';
      groupWrapper.dataset.groupId = page.groupId;
      
      groupContainer = document.createElement('div');
      groupContainer.className = 'sku-group';
      groupContainer.dataset.groupId = page.groupId;
      
      const btnPrev = document.createElement('button');
      btnPrev.className = 'carousel-btn prev';
      btnPrev.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
      btnPrev.onclick = () => groupContainer.scrollBy({ left: -400, behavior: 'smooth' });
      
      const btnNext = document.createElement('button');
      btnNext.className = 'carousel-btn next';
      btnNext.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
      btnNext.onclick = () => groupContainer.scrollBy({ left: 400, behavior: 'smooth' });
      
      groupWrapper.appendChild(btnPrev);
      groupWrapper.appendChild(groupContainer);
      groupWrapper.appendChild(btnNext);
      
      if (prepend && container.firstElementChild && container.firstElementChild !== addBtn) {
        container.insertBefore(groupWrapper, container.firstElementChild);
      } else {
        container.insertBefore(groupWrapper, addBtn);
      }
    }
    
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.dataset.pageId = page.id;
    
    wrapper.innerHTML = `
      <div class="page-header">
        <div class="page-title">
          ${page.variantIndex > 0 
            ? `Variante ${page.variantIndex}` 
            : `<span class="page-number-label">Página ${this.getPageDisplayNumber(page)}</span> - <input class="page-sku-input" placeholder="SKU" value="${page.sku}" data-page-id="${page.id}"><button class="btn btn-ghost btn-icon btn-sm page-btn-search" data-page-id="${page.id}" title="Buscar no Sankhya"><i data-lucide="search" style="width:12px;height:12px;"></i></button>`
          }
        </div>
        <div class="page-actions">
          ${page.variantIndex > 0 ? '' : `
          <button class="btn btn-ghost btn-icon btn-sm page-btn-up" data-page-id="${page.id}" title="Mover para cima">
            <i data-lucide="chevron-up"></i>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm page-btn-down" data-page-id="${page.id}" title="Mover para baixo">
            <i data-lucide="chevron-down"></i>
          </button>
          `}
          <button class="btn btn-ghost btn-icon btn-sm page-btn-duplicate" data-page-id="${page.id}" title="Duplicar">
            <i data-lucide="copy"></i>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm page-btn-delete" data-page-id="${page.id}" title="Excluir">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
      <div class="canvas-container" style="position: relative;">
        <canvas class="main-canvas page-canvas" data-page-id="${page.id}"></canvas>
        ${page.variantIndex === 0 ? `
        <button class="btn-add-variant-page" data-page-id="${page.id}" title="Nova Variante" style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 28px; height: 60px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); border-right: none; border-radius: 6px 0 0 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: white; opacity: 0.5; transition: all 0.2s; z-index: 10;" onmouseover="this.style.opacity='1'; this.style.background='rgba(0,0,0,0.8)';" onmouseout="this.style.opacity='0.5'; this.style.background='rgba(0,0,0,0.5)';">
          <i data-lucide="copy" style="width: 14px; height: 14px;"></i>
        </button>
        ` : ''}
      </div>
      <div class="page-footer">
        ${page.variantIndex > 0 ? `
          <div style="width: 100%; display: flex; align-items: stretch; gap: 8px;">
            <textarea id="prompt-variante-${page.id}" placeholder="Descreva o cenário IA para esta variante..." style="flex: 1; font-size: 12px; padding: 8px 12px; border-radius: 6px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; min-width: 0; resize: none; overflow: hidden; min-height: 33px; box-sizing: border-box; line-height: 1.4;" rows="1" oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"></textarea>
            <button class="btn btn-primary btn-sm btn-ai-action btn-gerar-cenario-variante" data-page-id="${page.id}" style="font-size: 11px; padding: 0 12px; white-space: nowrap; display: flex; align-items: center; gap: 6px; border-radius: 6px; margin: 0; align-self: flex-end; height: 33px;">
                <i data-lucide="sparkles" style="width:12px;height:12px;"></i> Gerar Fundo
            </button>
            <button class="btn-export-page btn-export-page-all" data-page-id="${page.id}" data-export-type="all" style="font-size: 11px; padding: 0 12px; white-space: nowrap; border-radius: 6px; margin: 0; display: flex; align-items: center; align-self: flex-end; height: 33px;">
              Exportar Variante
            </button>
          </div>
        ` : `
          <div style="width: 100%; display: flex; justify-content: space-between; align-items: stretch; gap: 8px; flex-wrap: wrap;">
            <div style="display: flex; gap: 6px; flex: 1; min-width: 0;">
              <button class="btn btn-secondary btn-sm btn-ai-action btn-upscale-page" data-page-id="${page.id}" style="font-size: 11px; padding: 0 12px; border-radius: 6px; display: flex; align-items: center; gap: 6px; white-space: nowrap; margin: 0; align-self: flex-end; height: 33px;">
                  <i data-lucide="zap" style="width:14px;height:14px;"></i> Upscale
              </button>
              <textarea id="prompt-upscale-${page.id}" placeholder="Opcional: Instruções para o upscale..." style="flex: 1; font-size: 12px; padding: 8px 12px; border-radius: 6px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); color: #fff; min-width: 0; resize: none; overflow: hidden; min-height: 33px; box-sizing: border-box; line-height: 1.4;" rows="1" oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'"></textarea>
              <div style="display: flex; background: rgba(0,0,0,0.25); border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; align-self: flex-end; height: 33px;">
                <button class="btn-export-page" data-page-id="${page.id}" data-export-type="sankhya" style="margin: 0; padding: 0 12px; font-size: 11px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-right: 1px solid rgba(255,255,255,0.08); border-radius: 0; color: var(--text-secondary); cursor: pointer; transition: background 0.2s, color 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'; this.style.color='#fff';" onmouseout="this.style.background='transparent'; this.style.color='var(--text-secondary)';">
                  Principal
                </button>
                <button class="btn-export-page" data-page-id="${page.id}" data-export-type="tabloide" style="margin: 0; padding: 0 12px; font-size: 11px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; border-right: 1px solid rgba(255,255,255,0.08); border-radius: 0; color: var(--text-secondary); cursor: pointer; transition: background 0.2s, color 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'; this.style.color='#fff';" onmouseout="this.style.background='transparent'; this.style.color='var(--text-secondary)';">
                  Alternativas
                </button>
                <button class="btn-export-page btn-validate-only" data-page-id="${page.id}" data-export-type="validate_only" style="margin: 0; padding: 0 12px; font-size: 11px; display: flex; align-items: center; justify-content: center; gap: 4px; border: none; border-right: 1px solid rgba(255,255,255,0.12); border-radius: 0; background: #ea580c; color: white; font-weight: bold; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='#f97316'" onmouseout="this.style.background='#ea580c'" title="Somente validar no Sankhya pelo marketing no estado atual">
                  <i data-lucide="check" style="width:13px;height:13px;"></i> Validar
                </button>
                <button class="btn-export-page btn-export-page-all" data-page-id="${page.id}" data-export-type="all" style="margin: 0; padding: 0 14px; font-size: 11px; display: flex; align-items: center; justify-content: center; gap: 5px; border: none; border-radius: 0; background: linear-gradient(90deg, #8B5CF6, #3B82F6); color: white; font-weight: bold; cursor: pointer; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                  <i data-lucide="zap" style="width:13px;height:13px; fill: white;"></i> Salvar e Validar
                </button>
              </div>
            </div>
          </div>
        `}
      </div>
    `;
    
    groupContainer.appendChild(wrapper);
    
    const canvasContainer = wrapper.querySelector('.canvas-container');
    if (canvasContainer && this._bgColor) {
      canvasContainer.style.setProperty('background-color', this._bgColor, 'important');
    }
    const canvas = wrapper.querySelector('.page-canvas');
    page.canvas = canvas;
    page.ctx = canvas.getContext('2d', { willReadFrequently: true });
    page.ctx.imageSmoothingEnabled = true;
    page.ctx.imageSmoothingQuality = 'high';
    
    this.bindPageEvents(wrapper, page);
    
    wrapper.addEventListener('click', (e) => {
      if (!e.target.closest('button') && !e.target.closest('input') && !e.target.closest('label')) {
        this.setActivePage(page.id);
      }
    });
    
    canvas.addEventListener('click', () => this.setActivePage(page.id));
  }
  
  bindPageEvents(wrapper, page) {
    const pageId = page.id;
    
    const skuInput = wrapper.querySelector('.page-sku-input');
    let searchTimeout;
    if (skuInput) {
      skuInput.addEventListener('input', (e) => {
        page.sku = e.target.value;
        this.syncSidebarDescription();
        
        clearTimeout(searchTimeout);
        if (page.sku && page.sku.trim().length >= 2) {
          searchTimeout = setTimeout(() => {
            this.setActivePage(pageId);
            this.buscarSku(pageId);
          }, 1200); // 1.2 second debounce
        }
      });
      
      skuInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { 
          clearTimeout(searchTimeout);
          this.setActivePage(pageId); 
          this.buscarSku(pageId); 
        }
      });
      
      skuInput.addEventListener('blur', () => {
        clearTimeout(searchTimeout);
        if (page.sku && page.sku.trim().length >= 2) {
          this.setActivePage(pageId);
          this.buscarSku(pageId);
        }
      });
    }

    // Upscale manual
    const btnUpscale = wrapper.querySelector('.btn-upscale-page');
    if (btnUpscale) {
      btnUpscale.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.setActivePage(page.id);
        const promptInput = wrapper.querySelector(`#prompt-upscale-${page.id}`);
        const customPrompt = promptInput ? promptInput.value.trim() : '';
        if (window.app) await window.app.doUpscale(page, null, customPrompt);
      });
    }
    
    // Gerar cenário variante
    const btnGerarCenario = wrapper.querySelector('.btn-gerar-cenario-variante');
    if (btnGerarCenario) {
      btnGerarCenario.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.setActivePage(page.id);
        const textarea = wrapper.querySelector(`#prompt-variante-${page.id}`);
        const promptText = textarea ? textarea.value.trim() : '';
        this.generateAIBackground(page, promptText, btnGerarCenario);
      });
    }
    
    wrapper.querySelector('.page-btn-search')?.addEventListener('click', () => {
      this.setActivePage(pageId); this.buscarSku(pageId);
    });
    wrapper.querySelector('.page-btn-up')?.addEventListener('click', () => this.movePage(pageId, -1));
    wrapper.querySelector('.page-btn-down')?.addEventListener('click', () => this.movePage(pageId, 1));
    wrapper.querySelector('.page-btn-duplicate')?.addEventListener('click', () => this.duplicatePage(pageId));
    wrapper.querySelector('.page-btn-delete')?.addEventListener('click', () => this.deletePage(pageId));
    
    if (this.scrollObserver) {
      this.scrollObserver.observe(wrapper);
    }
    
    // Add Variant inline button
    wrapper.querySelector('.btn-add-variant-page')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setActivePage(page.id);
      this.addVariantPage(page.id);
    });
    
    // Add New Page below inline
    wrapper.querySelector('.page-btn-add-below')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.createPage();
    });
    
    // Exportar botões (3 tipos)
    wrapper.querySelectorAll('.btn-export-page').forEach(btn => {
      btn.addEventListener('click', () => {
        const exportType = btn.dataset.exportType;
        if (window.app) window.app.exportPage(pageId, exportType);
      });
    });
    
    const canvasContainer = wrapper.querySelector('.canvas-container');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
      canvasContainer.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
    });
    canvasContainer.addEventListener('dragenter', () => canvasContainer.classList.add('drag-over'));
    canvasContainer.addEventListener('dragleave', () => canvasContainer.classList.remove('drag-over'));
    canvasContainer.addEventListener('drop', async (e) => {
      canvasContainer.classList.remove('drag-over');
      this.setActivePage(pageId);
      if (window.app) window.app.handleDropOnPage(pageId, e);
    });
    
    // Ctrl+scroll no canvas: NÃO mexe no zoom da imagem (transform.zoom)
    // O zoom da imagem ? controlado exclusivamente pelo slider do sidebar
    // O Ctrl+scroll global (no pages-container) controla o zoom da página (workspaceZoom)
  }
  
  setActivePage(pageId) {
    const isSamePage = this.activePageId === pageId;
    this.activePageId = pageId;
    
    document.querySelectorAll('.page-wrapper').forEach(w => {
      w.classList.toggle('active', parseInt(w.dataset.pageId) === pageId);
    });
    
    this.syncSidebarSliders();
    this.syncSidebarDescription();

    // Só busca no Sankhya se ainda não carregou os dados nesta sessão
    const page = this.getPage(pageId);
    if (page && page.sku && !page._freshSankhyaLoaded) {
      this.buscarSkuSilent(pageId);
    }
  }
  
  getActivePage() { return this.pages.find(p => p.id === this.activePageId); }
  getPage(pageId) { return this.pages.find(p => p.id === pageId); }
  

  /**
   * Remove um produto validado da tela (todas as suas páginas e variantes)
   * e atualiza a numeração de todas as páginas restantes.
   */
  /**
   * Reconcilia e limpa os divisores '+' entre cards:
   * 1. Remove qualquer sku-group-wrapper vazio
   * 2. Remove todos os '+' soltos/duplicados
   * 3. Insere EXATAMENTE UM único '+' entre cada par de cards
   */
  cleanupInsertZones() {
    const container = document.getElementById('pages-container');
    if (!container) return;

    // 1. Remove todas as insert-zones antigas/duplicadas
    container.querySelectorAll('.page-insert-zone').forEach(el => el.remove());

    // 2. Remove containers de grupo vazios (que não têm nenhuma página)
    container.querySelectorAll('.sku-group-wrapper').forEach(gw => {
      if (gw.querySelectorAll('.page-wrapper').length === 0) {
        gw.remove();
      }
    });

    // 3. Adiciona EXATAMENTE UMA insert-zone entre cada card consecutivo
    const groups = Array.from(container.querySelectorAll('.sku-group-wrapper'));
    for (let i = 0; i < groups.length - 1; i++) {
      const currentGroup = groups[i];
      const nextGroup = groups[i + 1];

      const insertZone = document.createElement('div');
      insertZone.className = 'page-insert-zone';
      insertZone.title = 'Inserir página em branco aqui';
      insertZone.addEventListener('click', () => {
        const newPageId = this.createPage();
        const newGroupWrapper = container.querySelector(`.sku-group-wrapper[data-group-id="${newPageId}"]`);
        if (newGroupWrapper) {
          container.insertBefore(newGroupWrapper, insertZone);
          this.cleanupInsertZones();
        }
      });

      container.insertBefore(insertZone, nextGroup);
    }
  }

  removeProduct(sku) {
    if (!sku) return;
    const cleanSku = String(sku).trim();
    const pagesToRemove = this.pages.filter(p => String(p.sku || '').trim() === cleanSku);
    if (pagesToRemove.length === 0) return;

    pagesToRemove.forEach(p => {
      const idx = this.pages.findIndex(item => item.id === p.id);
      if (idx !== -1) {
        this.pages.splice(idx, 1);
      }
      const wrapper = document.querySelector(`.page-wrapper[data-page-id="${p.id}"]`);
      if (wrapper) {
        wrapper.remove();
      }
    });

    // Reconciliar DOM: elimina imediatamente wrappers vazios e divisores duplicados
    this.cleanupInsertZones();
    this.ensureBlankPage();
    this.cleanupInsertZones();
    this.updateAllPageNumbers();

    // Ativar a próxima página de produto disponível ou a página em branco padrão
    if (this.pages.length > 0) {
      const targetPage = this.pages.find(p => p.sku && String(p.sku).trim().length > 0) || this.pages[0];
      this.setActivePage(targetPage.id);
    }

    document.body.classList.toggle('has-multiple-pages', this.pages.length > 1);
    this.triggerAutosave(true);
    if (window.app && typeof window.app.updateStatusBarQueueCount === 'function') {
      window.app.updateStatusBarQueueCount();
    }
    console.log(`[Editor] Produto ${cleanSku} removido da tela e DOM perfeitamente ajustado sem buracos.`);
  }

  deletePage(pageId) {
    if (this.pages.length <= 1) {
      if (window.app) window.app.showToast('Precisa ter pelo menos 1 página', 'warning');
      return;
    }
    const idx = this.pages.findIndex(p => p.id === pageId);
    if (idx === -1) return;
    this.pages.splice(idx, 1);
    this.updateAllPageNumbers();
    
    const wrapper = document.querySelector(`.page-wrapper[data-page-id="${pageId}"]`);
    if (wrapper) {
      wrapper.remove();
    }

    // Reconciliar DOM: remove containers vazios e reconstrói divisores únicos
    this.cleanupInsertZones();
    
    if (this.activePageId === pageId) {
      this.setActivePage(this.pages[Math.min(idx, this.pages.length - 1)].id);
    }
    document.body.classList.toggle('has-multiple-pages', this.pages.length > 1);
    this.triggerAutosave(true);
    if (window.app && typeof window.app.updateStatusBarQueueCount === 'function') {
      window.app.updateStatusBarQueueCount();
    }
  }
  
  movePage(pageId, direction) {
    const idx = this.pages.findIndex(p => p.id === pageId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.pages.length) return;
    [this.pages[idx], this.pages[newIdx]] = [this.pages[newIdx], this.pages[idx]];
    
    const wrapperIdx = document.querySelector(`.page-wrapper[data-page-id="${this.pages[idx].id}"]`);
    const wrapperNewIdx = document.querySelector(`.page-wrapper[data-page-id="${this.pages[newIdx].id}"]`);
    
    if (wrapperIdx && wrapperNewIdx && wrapperIdx.parentNode === wrapperNewIdx.parentNode) {
      const container = wrapperIdx.parentNode;
      if (direction < 0) container.insertBefore(wrapperIdx, wrapperNewIdx);
      else container.insertBefore(wrapperNewIdx, wrapperIdx);
    }
  }
  
  duplicatePage(pageId, skipImageCopy = false) {
    const source = this.getPage(pageId);
    if (!source) return null;
    
    // Sempre duplica como variante no mesmo grupo (carrossel)
    let maxIdx = 0;
    this.pages.forEach(p => {
      if (p.groupId === source.groupId && p.variantIndex > maxIdx) {
        maxIdx = p.variantIndex;
      }
    });
    const newVariantIndex = maxIdx === 0 ? 2 : maxIdx + 1;
    
    const newPageId = this.nextPageId++;
    const newPage = {
      id: newPageId,
      sku: source.sku,
      productName: source.productName,
      descriptionOriginal: source.descriptionOriginal,
      description: source.description,
      originalImage: null,
      currentImage: null,
      canvas: null,
      ctx: null,
      adjustments: { ...source.adjustments },
      transform: { ...source.transform },
      history: [],
      historyIndex: -1,
      hasChanges: true,
      exportSankhya: false,
      exportTabloide: true,
      variantIndex: newVariantIndex,
      groupId: source.groupId || source.id,
    };
    
    this.pages.push(newPage);
    this.renderPageDOM(newPage);
    this.setActivePage(newPageId);
    
    if (source.currentImage && !skipImageCopy) {
      const img = new Image();
      img.onload = () => {
        newPage.originalImage = img;
        newPage.currentImage = img;
        newPage.canvas.width = img.width;
        newPage.canvas.height = img.height;
        this.renderPage(newPageId);
        this.pushHistory(newPageId);
      };
      img.src = source.currentImage.src;
    }
    
    return newPageId;
  }
  
  duplicateAsNewItem(pageId) {
    const source = this.getPage(pageId);
    if (!source) return null;
    
    // Encontrar todas as páginas do mesmo grupo (principal + variantes)
    const sourceGroupId = Number(source.groupId || source.id);
    const groupPages = this.pages.filter(p => Number(p.groupId || p.id) === sourceGroupId);
    groupPages.sort((a, b) => (a.variantIndex || 0) - (b.variantIndex || 0));
    
    // Encontrar a posição no array logo após o último item do grupo original
    let lastGroupIdx = -1;
    this.pages.forEach((p, i) => {
      if ((p.groupId || p.id) === sourceGroupId) lastGroupIdx = i;
    });
    const insertIdx = lastGroupIdx + 1;
    
    // Encontrar o elemento DOM do grupo original para inserir depois
    const sourceGroupWrapper = document.querySelector(`.page-wrapper[data-page-id="${groupPages[0].id}"]`);
    const sourceSkuGroup = sourceGroupWrapper?.closest('.sku-group-wrapper');
    
    const newGroupId = this.nextPageId;
    const newPages = [];
    
    groupPages.forEach((srcPage, i) => {
      const newPageId = this.nextPageId++;
      const newPage = {
        id: newPageId,
        sku: '',
        productName: '',
        brand: '',
        descriptionOriginal: '',
        description: '',
        originalImage: null,
        currentImage: null,
        canvas: null,
        ctx: null,
        adjustments: { ...srcPage.adjustments },
        transform: { ...srcPage.transform },
        history: [],
        historyIndex: -1,
        hasChanges: true,
        exportSankhya: false,
        exportTabloide: true,
        variantIndex: srcPage.variantIndex || 0,
        groupId: newGroupId,
        referenceImage: null,
      };
      
      // Inserir no array na posição correta (logo após o grupo original)
      this.pages.splice(insertIdx + i, 0, newPage);
      this.renderPageDOM(newPage);
      newPages.push({ newPage, srcPage });
    });
    
    // Mover o DOM do novo grupo para logo após o grupo original
    if (sourceSkuGroup) {
      const newGroupWrapper = document.querySelector(`.page-wrapper[data-page-id="${newPages[0].newPage.id}"]`);
      const newSkuGroup = newGroupWrapper?.closest('.sku-group-wrapper');
      if (newSkuGroup) {
        sourceSkuGroup.after(newSkuGroup);
      }
    }
    
    // Copiar imagens de cada página
    newPages.forEach(({ newPage, srcPage }) => {
      if (srcPage.currentImage) {
        const img = new Image();
        img.onload = () => {
          newPage.originalImage = img;
          newPage.currentImage = img;
          newPage.canvas.width = img.width;
          newPage.canvas.height = img.height;
          this.renderPage(newPage.id);
          this.pushHistory(newPage.id);
        };
        img.src = srcPage.currentImage.src;
      }
    });
    
    // Ativar a primeira página do novo grupo
    const firstNewPage = newPages[0]?.newPage;
    if (firstNewPage) {
      this.setActivePage(firstNewPage.id);
      
      setTimeout(() => {
        const wrapper = document.querySelector(`.page-wrapper[data-page-id="${firstNewPage.id}"]`);
        const skuInput = wrapper?.querySelector('.sku-input');
        if (skuInput) {
          skuInput.focus();
          skuInput.select();
        }
        // Scroll para o novo item
        wrapper?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
    
    if (window.app) window.app.showToast(`Item duplicado (${newPages.length} página${newPages.length > 1 ? 's' : ''})! Digite o novo SKU`, 'info');
    return firstNewPage?.id;
  }
  
  // ======================== Image Loading ========================
  
  async loadImageToPage(pageId, imageData) {
    const targetP = this.getPage(pageId);
    if (targetP) targetP._userImage = true;
    const page = this.getPage(pageId);
    if (!page) return;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        page.originalImage = img;
        page.currentImage = img;
        page.canvas.width = img.width;
        page.canvas.height = img.height;
        page.adjustments = { ...this.defaultAdjustments };
        page.transform = { ...this.defaultTransform };
        page.history = [];
        page.historyIndex = -1;
        this.pushHistory(pageId);
        this.renderPage(pageId);
        this.syncSidebarSliders();
        resolve();
      };
      
      if (typeof imageData === 'string') {
        img.src = imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`;
      } else {
        img.src = imageData.base64.startsWith('data:') 
          ? imageData.base64 
          : `data:image/${imageData.format || 'jpeg'};base64,${imageData.base64}`;
      }
    });
  }
  
  async loadImage(imageData) {
    const pageId = this.createPage(imageData);
    return pageId;
  }
  

  ensureBlankPage() {
    // Verifica se a primeira página já é a página em branco padrão (sem SKU e sem imagem)
    const firstIsBlank = this.pages.length > 0 && !this.pages[0].sku && !this.pages[0].currentImage;
    if (!firstIsBlank) {
      const pageId = 1;
      const finalId = this.pages.some(p => p.id === 1) ? this.nextPageId++ : 1;
      
      const page = {
        id: finalId,
        sku: '',
        productName: '',
        descriptionOriginal: '',
        description: '',
        originalImage: null,
        currentImage: null,
        canvas: null,
        ctx: null,
        adjustments: { ...this.defaultAdjustments },
        transform: { ...this.defaultTransform },
        history: [],
        historyIndex: -1,
        hasChanges: false,
        exportSankhya: true,
        exportTabloide: true,
        variantIndex: 0,
        groupId: finalId,
      };

      this.pages.unshift(page);
      this.renderPageDOM(page, true);
      this._debouncedLucide();
      document.body.classList.toggle('has-multiple-pages', this.pages.length > 1);

      const wrapper = document.querySelector(`.page-wrapper[data-page-id="${finalId}"]`);
      if (wrapper) {
        const container = wrapper.querySelector('.canvas-container');
        if (container && this._bgColor) {
          container.style.setProperty('background-color', this._bgColor, 'important');
        }
      }
      this.setActivePage(finalId);
      console.log('[Editor] Página em branco padrão garantida como primeira página (Página ' + finalId + ')');
    }
  }

  // ======================== Rendering ========================
  
  renderPage(pageId) {
    if (!this._renderRAFs) this._renderRAFs = {};
    if (this._renderRAFs[pageId]) cancelAnimationFrame(this._renderRAFs[pageId]);
    this._renderRAFs[pageId] = requestAnimationFrame(() => {
      delete this._renderRAFs[pageId];
      this._doRenderPage(pageId);
    });
  }
  _doRenderPage(pageId) {
    const page = this.getPage(pageId);
    if (!page || !page.currentImage || !page.canvas) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = page.canvas.width;
    tempCanvas.height = page.canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = 'high';
    tempCtx.drawImage(page.currentImage, 0, 0);
    this.processor.applyAdjustments(tempCanvas, page.adjustments);
    const finalCanvas = this.processor.applyTransform(tempCanvas, page.transform);
    // Limpar canvas com transparencia para preservar o fundo invisivel na exportacao
    page.ctx.clearRect(0, 0, page.canvas.width, page.canvas.height);
    page.ctx.drawImage(finalCanvas, 0, 0);
  }
  
  render() { if (this.activePageId) this.renderPage(this.activePageId); }
  
  // ======================== Adjustments ========================
  
  setAdjustment(name, value) {
    const page = this.getActivePage();
    if (!page) return;
    page.adjustments[name] = value;
    page.hasChanges = true;
    const valSpan = document.getElementById(`value-${name}`);
    if (valSpan) valSpan.textContent = value;
    const slider = document.getElementById(`slider-${name}`);
    if (slider && slider.value != value) slider.value = value;
    this.renderPage(page.id);
  }
  
  setTransform(name, value) {
    const page = this.getActivePage();
    if (!page) return;
    page.transform[name] = value;
    page.hasChanges = true;
    const valSpan = document.getElementById(`value-${name}`);
    if (valSpan) {
      valSpan.textContent = name === 'zoom' ? `${Math.round(value * 100)}%` : 
                           name === 'rotation' ? `${value}?` : value;
    }
    const slider = document.getElementById(`slider-${name}`);
    if (slider && slider.value != value) slider.value = value;
    this.renderPage(page.id);
  }
  
  resetAdjustments() {
    const page = this.getActivePage();
    if (!page) return;
    Object.keys(this.defaultAdjustments).forEach(key => this.setAdjustment(key, this.defaultAdjustments[key]));
    this.pushHistory(page.id);
  }
  
  resetTransform() {
    const page = this.getActivePage();
    if (!page) return;
    Object.keys(this.defaultTransform).forEach(key => this.setTransform(key, this.defaultTransform[key]));
    this.pushHistory(page.id);
  }
  
  async autoAdjust() {
    const page = this.getActivePage();
    if (!page) return;
    
    // Tentar usar Gemini IA se tiver API key
    const settings = window._settingsManager?.settings;
    if (settings.geminiApiKey && page.currentImage) {
      try {
        const btnAuto = document.getElementById('btn-auto-adjust');
        if (btnAuto) {
          btnAuto.disabled = true;
          btnAuto.innerHTML = '<i data-lucide="loader-2" style="width:12px;height:12px;" class="spin"></i> Analisando...';
        }
        
        // Converter imagem para base64 (reduzida para não sobrecarregar)
        const tempCanvas = document.createElement('canvas');
        const maxSize = 1024;
        const ratio = Math.min(maxSize / page.canvas.width, maxSize / page.canvas.height, 1);
        tempCanvas.width = page.canvas.width * ratio;
        tempCanvas.height = page.canvas.height * ratio;
        const tCtx = tempCanvas.getContext('2d');
        tCtx.drawImage(page.currentImage, 0, 0, tempCanvas.width, tempCanvas.height);
        const imageBase64 = tempCanvas.toDataURL('image/png');
        
        const result = await window.api.gemini.autoEnhance({
          imageBase64,
          apiKey: settings.geminiApiKey
        });
        
        if (result?.adjustments) {
          Object.keys(result.adjustments).forEach(key => {
            if (this.defaultAdjustments.hasOwnProperty(key)) {
              this.setAdjustment(key, result.adjustments[key]);
            }
          });
          this.pushHistory(page.id);
        }
        
        if (btnAuto) {
          btnAuto.disabled = false;
          btnAuto.innerHTML = '<i data-lucide="wand-2" style="width:12px;height:12px;"></i> Auto';
          this._debouncedLucide();
        }
        return;
      } catch (err) {
        console.warn('Gemini auto-enhance falhou, usando local:', err);
        const btnAuto = document.getElementById('btn-auto-adjust');
        if (btnAuto) {
          btnAuto.disabled = false;
          btnAuto.innerHTML = '<i data-lucide="wand-2" style="width:12px;height:12px;"></i> Auto';
          this._debouncedLucide();
        }
      }
    }
    
    // Fallback: ajuste local
    const suggested = this.processor.autoAdjust(page.canvas);
    Object.keys(suggested).forEach(key => this.setAdjustment(key, suggested[key]));
    this.pushHistory(page.id);
  }
  
  // ======================== Auto Save (local) ========================
  
  _autosaveTimer = null;
  _AUTOSAVE_KEY = 'multipic_autosave';
  _AUTOSAVE_DELAY = 1500; // 1.5s após última mudança

  triggerAutosave(immediate = false) {
    if (this._autosaveTimer) {
      clearTimeout(this._autosaveTimer);
      this._autosaveTimer = null;
    }
    if (window.app && typeof window.app.updateStatusBarQueueCount === 'function') {
      window.app.updateStatusBarQueueCount();
    }
    if (immediate) {
      this._doSaveToLocal();
    } else {
      this._autosaveTimer = setTimeout(() => this._doSaveToLocal(), this._AUTOSAVE_DELAY);
    }
  }

  saveToLocal(immediate = false) {
    this.triggerAutosave(immediate);
  }

  _prepareAutosaveData() {
    return {
      savedAt: new Date().toISOString(),
      nextPageId: this.nextPageId,
      pages: this.pages.map(page => {
        let imageBase64 = null;
        // O autosave só deve salvar as imagens que o usuário carregou ou gerou/modificou no app
        const isUserImage = page.hasChanges || page._userImage || (page.history && page.history.length > 0);
        
        if (isUserImage && page.currentImage) {
          if (typeof page.currentImage.src === 'string' && page.currentImage.src.startsWith('data:image/')) {
            imageBase64 = page.currentImage.src;
          } else if (page._cachedSrc === page.currentImage.src && page._cachedBase64) {
            imageBase64 = page._cachedBase64;
          } else {
            try {
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = page.currentImage.width || page.canvas.width;
              tempCanvas.height = page.currentImage.height || page.canvas.height;
              const tempCtx = tempCanvas.getContext('2d');
              tempCtx.drawImage(page.currentImage, 0, 0);
              imageBase64 = tempCanvas.toDataURL('image/png');
              page._cachedSrc = page.currentImage.src;
              page._cachedBase64 = imageBase64;
            } catch (e) {
              imageBase64 = page.currentImage.src || null;
            }
          }
        }

        return {
          id: page.id,
          sku: page.sku || '',
          productName: page.productName || '',
          brand: page.brand || '',
          descriptionOriginal: page.descriptionOriginal || '',
          description: page.description || '',
          adjustments: page.adjustments,
          transform: page.transform,
          hasChanges: page.hasChanges,
          userImage: !!page._userImage,
          exportSankhya: page.exportSankhya,
          exportTabloide: page.exportTabloide,
          variantIndex: page.variantIndex || 0,
          groupId: page.groupId,
          imageBase64
        };
      })
    };
  }

  async _doSaveToLocal() {
    try {
      const data = this._prepareAutosaveData();
      if (!data || !data.pages) return;

      // 1. Salvar no arquivo físico do Electron (sem limite de 5MB)
      if (window.api && window.api.autosave && window.api.autosave.save) {
        await window.api.autosave.save(data);
      }

      // 2. Fallback no localStorage se couber
      try {
        localStorage.setItem(this._AUTOSAVE_KEY, JSON.stringify(data));
      } catch (e) {
        // QuotaExceeded ignorado pois já foi gravado no disco físico
      }

      console.log('[AutoSave] Salvo ' + data.pages.length + ' pagina(s) com sucesso');
    } catch (e) {
      console.warn('[AutoSave] Erro ao salvar:', e.message);
    }
  }

  saveToLocalSync() {
    try {
      const data = this._prepareAutosaveData();
      if (!data || !data.pages) return;
      if (window.api && window.api.autosave && window.api.autosave.saveSync) {
        window.api.autosave.saveSync(data);
      }
      try {
        localStorage.setItem(this._AUTOSAVE_KEY, JSON.stringify(data));
      } catch (e) {}
      console.log('[AutoSave] Salvo síncrono antes do encerramento');
    } catch (e) {
      console.warn('[AutoSave] Erro no salvamento síncrono:', e.message);
    }
  }

  async loadFromLocal() {
    try {
      let data = null;
      if (window.api && window.api.autosave && window.api.autosave.load) {
        data = await window.api.autosave.load();
      }
      if (!data) {
        const raw = localStorage.getItem(this._AUTOSAVE_KEY);
        if (raw) {
          try { data = JSON.parse(raw); } catch (e) {}
        }
      }

      if (!data || !data.pages || data.pages.length === 0) return false;

      console.log('[AutoSave] Restaurando ' + data.pages.length + ' pagina(s) de ' + data.savedAt);

      // Limpar DOM antes de restaurar
      this.pages = [];
      const container = document.getElementById('pages-container');
      if (container) {
        container.querySelectorAll('.sku-group-wrapper, .page-insert-zone').forEach(el => el.remove());
      }

      // 1. SEMPRE CRIAR A PÁGINA 1 (EM BRANCO PADRÃO) NA PRIMEIRA POSIÇÃO
      const blankPage = {
        id: 1,
        sku: '',
        productName: '',
        descriptionOriginal: '',
        description: '',
        originalImage: null,
        currentImage: null,
        canvas: null,
        ctx: null,
        adjustments: { ...this.defaultAdjustments },
        transform: { ...this.defaultTransform },
        history: [],
        historyIndex: -1,
        hasChanges: false,
        exportSankhya: true,
        exportTabloide: true,
        variantIndex: 0,
        groupId: 1,
      };
      this.pages.push(blankPage);
      this.renderPageDOM(blankPage);

      // 2. Filtrar páginas salvas que têm SKU ou imagem (ignorar páginas fantasmas sem nada)
      const productPages = [];
      const seenSkus = new Set();
      data.pages.forEach(p => {
        const sku = String(p.sku || '').trim();
        if (p.imageBase64 || sku) {
          if (sku) {
            if (seenSkus.has(sku)) return;
            seenSkus.add(sku);
          }
          productPages.push(p);
        }
      });

      let maxId = 1;

      // 3. Renderizar páginas de produtos após a Página 1
      // Sanitizar groupIds para garantir que itens principais diferentes NUNCA fiquem na mesma linha!
      const usedGroupIds = new Set([1]);
      productPages.forEach(savedPage => {
        let pageId = savedPage.id && savedPage.id !== 1 ? savedPage.id : ++maxId;
        if (pageId > maxId) maxId = pageId;

        let gId = savedPage.groupId || pageId;
        if (!savedPage.variantIndex || savedPage.variantIndex === 0) {
          if (usedGroupIds.has(gId)) {
            gId = ++maxId;
          }
          usedGroupIds.add(gId);
        }
        if (gId > maxId) maxId = gId;

        const page = {
          id: pageId,
          sku: savedPage.sku || '',
          productName: savedPage.productName || '',
          descriptionOriginal: savedPage.descriptionOriginal || '',
          description: savedPage.description || '',
          originalImage: null,
          currentImage: null,
          canvas: null,
          ctx: null,
          adjustments: savedPage.adjustments || { ...this.defaultAdjustments },
          transform: savedPage.transform || { ...this.defaultTransform },
          history: [],
          historyIndex: -1,
          hasChanges: savedPage.hasChanges || false,
          exportSankhya: savedPage.exportSankhya !== undefined ? savedPage.exportSankhya : true,
          exportTabloide: savedPage.exportTabloide !== undefined ? savedPage.exportTabloide : true,
          variantIndex: savedPage.variantIndex || 0,
          groupId: gId,
        };

        this.pages.push(page);
        this.renderPageDOM(page);

        // Restaurar imagem
        if (savedPage.imageBase64) {
          const img = new Image();
          img.onload = () => {
            page.currentImage = img;
            page.originalImage = img;
            page.canvas.width = img.width;
            page.canvas.height = img.height;
            page.history = [{
              imageSrc: img.src,
              adjustments: { ...page.adjustments },
              transform: { ...page.transform }
            }];
            page.historyIndex = 0;
            this.renderPage(page.id);
          };
          img.src = savedPage.imageBase64;
        }

        const skuInput = document.querySelector(`#page-${pageId} .page-sku-input, [data-page-id="${pageId}"] .page-sku-input`);
        if (skuInput) skuInput.value = page.sku;
      });

      this.nextPageId = maxId + 1;
      this.cleanupInsertZones();
      this.updateAllPageNumbers();
      document.body.classList.toggle('has-multiple-pages', this.pages.length > 1);

      // Sempre ativar a Página 1 (em branco padrão) no início!
      this.setActivePage(1);

      // Aplicar cor de fundo configurada em todos os containers
      if (this._bgColor) {
        document.querySelectorAll('.canvas-container').forEach(c => {
          c.style.setProperty('background-color', this._bgColor, 'important');
        });
      }

      this._debouncedLucide();

      // Re-buscar dados frescos (descrição, características, fabricante) e imagens em background
      setTimeout(() => {
        const settings = window.app?.settingsManager?.settings;
        this.pages.forEach(p => {
          if (p.sku && String(p.sku).trim().length >= 2) {
            this.buscarSkuSilent(p.id).catch(() => {});
            if (settings && !p.referenceImage) {
              this._fetchProductImage(p, p.sku, settings).catch(() => {});
            }
          }
        });
      }, 500);

      if (window.app && typeof window.app.updateStatusBarQueueCount === 'function') {
        window.app.updateStatusBarQueueCount();
      }

      return true;
    } catch (e) {
      console.warn('[AutoSave] Erro ao restaurar:', e.message);
      return false;
    }
  }

  async clearAutosave() {
    if (window.api && window.api.autosave && window.api.autosave.clear) {
      await window.api.autosave.clear();
    }
    localStorage.removeItem(this._AUTOSAVE_KEY);
    console.log('[AutoSave] Limpo');
  }

  async hasAutosave() {
    try {
      if (window.api && window.api.autosave && window.api.autosave.load) {
        const data = await window.api.autosave.load();
        if (data && data.pages && data.pages.length > 0) return true;
      }
      const raw = localStorage.getItem(this._AUTOSAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return data.pages && data.pages.length > 0;
    } catch (e) {
      return false;
    }
  }

  // ======================== Detecção de Transparência ========================
  
  hasTransparency(imageOrBase64) {
    return new Promise((resolve) => {
      const checkImage = (img) => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let transparentPixels = 0;
          const totalPixels = data.length / 4;
          // Amostrar a cada 4 pixels para performance
          for (let i = 3; i < data.length; i += 16) {
            if (data[i] < 250) transparentPixels++;
          }
          // Ajustar contagem pelo fator de amostragem
          transparentPixels *= 4;
          const ratio = transparentPixels / totalPixels;
          resolve(ratio > 0.05); // >5% transparente = já tem fundo removido
        } catch (e) {
          resolve(false);
        }
      };
      
      if (typeof imageOrBase64 === 'string') {
        const img = new Image();
        img.onload = () => checkImage(img);
        img.onerror = () => resolve(false);
        img.src = imageOrBase64;
      } else if (imageOrBase64 instanceof HTMLImageElement) {
        checkImage(imageOrBase64);
      } else {
        resolve(false);
      }
    });
  }
  

  /**
   * Enquadra a imagem proporcionalmente dentro de um canvas quadrado (1:1),
   * garantindo margem de respiro (~7% em cada lado) para que NUNCA cole nas laterais/topo/fundo.
   */
  fitAndCenterImage(pageId) {
    const page = this.getPage(pageId);
    if (!page) return;

    // Se houve upscale nesta imagem, garante o uso da versão upscale em alta definição!
    const img = page._upscaledImage || page.originalImage || page.currentImage;
    if (!img) return;
    const w = img.width || page.canvas.width;
    const h = img.height || page.canvas.height;
    if (!w || !h) return;

    // Canvas quadrado padrão proporcional
    const targetSize = Math.max(w, h, 1024);
    // Produto ocupa no máximo 86% do espaço (deixando 7% de margem em toda a borda)
    const maxDimension = targetSize * 0.86;
    const scale = Math.min(maxDimension / w, maxDimension / h, 1.0);
    const scaledW = Math.round(w * scale);
    const scaledH = Math.round(h * scale);

    const squareCanvas = document.createElement('canvas');
    squareCanvas.width = targetSize;
    squareCanvas.height = targetSize;
    const sCtx = squareCanvas.getContext('2d');
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';

    // Fundo branco se não for transparente
    const hasAlpha = page._hasTransparency || false;
    if (!hasAlpha) {
      sCtx.fillStyle = '#FFFFFF';
      sCtx.fillRect(0, 0, targetSize, targetSize);
    }

    const destX = Math.round((targetSize - scaledW) / 2);
    const destY = Math.round((targetSize - scaledH) / 2);
    sCtx.drawImage(img, 0, 0, w, h, destX, destY, scaledW, scaledH);

    const bakedImg = new Image();
    bakedImg.onload = () => {
      page.currentImage = bakedImg;
      page.originalImage = bakedImg;
      page.canvas.width = targetSize;
      page.canvas.height = targetSize;
      page.transform = { zoom: 1, posX: 0, posY: 0, rotation: 0 };
      this.pushHistory(page.id);
      this.renderPage(page.id);
      this.syncSidebarSliders();
      this.triggerAutosave(true);
    };
    bakedImg.src = squareCanvas.toDataURL(hasAlpha ? 'image/png' : 'image/jpeg', 0.98);
  }

  /**
   * Remove apenas o fundo branco externo preservando 100% da embalagem/cartela.
   */
  async removeBackgroundPackaging(pageId = null) {
    const page = pageId ? this.getPage(pageId) : this.getActivePage();
    if (!page || !page.currentImage || page._isProcessing) return;

    page._isProcessing = true;
    page._abortOperation = false;
    this.showPageOverlay(page.id, 'Removendo fundo da embalagem', 'Preservando cartela e textos...');

    try {
      const sourceImage = page._upscaledImage || page.originalImage || page.currentImage;
      const res = await window.api.image.removeWhiteBg(sourceImage.src);

      if (res && res.base64) {
        const newImg = new Image();
        newImg.onload = () => {
          page.currentImage = newImg;
          page.originalImage = newImg;
          page._hasTransparency = true;
          page.canvas.width = newImg.width;
          page.canvas.height = newImg.height;
          page.transform = { zoom: 1, posX: 0, posY: 0, rotation: 0 };
          this.pushHistory(page.id);
          this.renderPage(page.id);
          this.syncSidebarSliders();
          page._isProcessing = false;
          this.hidePageOverlay(page.id);
          this.triggerAutosave(true);
          if (window.app) window.app.showToast('Embalagem preservada com fundo transparente!', 'success');
        };
        newImg.onerror = () => {
          page._isProcessing = false;
          this.hidePageOverlay(page.id);
          this.fitAndCenterImage(page.id);
        };
        newImg.src = res.base64;
      } else {
        throw new Error('Falha no processamento de remoção de fundo da embalagem');
      }
    } catch (err) {
      console.error('Erro removeBackgroundPackaging:', err);
      page._isProcessing = false;
      this.hidePageOverlay(page.id);
      this.fitAndCenterImage(page.id);
      if (window.app) window.app.showToast('Erro ao recortar embalagem. Mantida com respiro.', 'warning');
    }
  }

  async removeBackground(pageId = null, force = false) {
    const page = pageId ? this.getPage(pageId) : this.getActivePage();
    if (!page || !page.currentImage || page._isProcessing) return;

    // Se não for forçado, verificar automaticamente se é embalagem/cartela
    if (!force && window.api?.image?.detectMode) {
      try {
        const targetApiKey = window._settingsManager?.settings?.geminiApiKey || '';
        const detectRes = await window.api.image.detectMode({
          base64Data: page.currentImage.src,
          productName: page.productName || '',
          apiKey: targetApiKey
        });
        if (detectRes && detectRes.mode === 'packaging') {
          if (window.app) window.app.showToast('Embalagem detectada: preservando cartela e textos!', 'info');
          return this.removeBackgroundPackaging(page.id);
        }
      } catch (detectErr) {
        console.warn('Detecção automática de modo falhou, seguindo fluxo normal:', detectErr);
      }
    }

    page._isProcessing = true;
    page._abortOperation = false;
    
    const cancelLabel = page._isUpscaled ? 'Cancelar Remoção (Manter Upscale)' : 'Cancelar Remoção (Manter Imagem)';
    this.showPageOverlay(page.id, 'Removendo fundo', 'Inteligência Artificial trabalhando', () => {
      page._abortOperation = true;
      page._isProcessing = false;
      this.hidePageOverlay(page.id);
      this.fitAndCenterImage(page.id);
      if (window.app) {
        const msg = page._isUpscaled 
          ? 'Remoção cancelada. Imagem do Upscale mantida e centralizada com borda!' 
          : 'Remoção cancelada. Imagem centralizada com borda de respiro.';
        window.app.showToast(msg, 'info');
      }
    }, cancelLabel);
    
    const settings = window._settingsManager?.settings;
    const hasRemoveBgKey = !!settings?.removeBgApiKey;
    
    try {
      let result;
      
      try {
        result = await window.api.image.removeBgChroma({
          base64Data: page.currentImage.src,
          apiKey: settings?.geminiApiKey || ''
        });
      } catch (chromaErr) {
        console.warn('Remoção local falhou:', chromaErr);
        if (hasRemoveBgKey) {
          this.showPageOverlay(page.id, 'Tentando remove.bg', 'Fallback ativado');
          result = await window.api.image.removeBg(page.currentImage.src);
        } else {
          throw chromaErr;
        }
      }
      
      if (page._abortOperation) {
        page._isProcessing = false;
        this.hidePageOverlay(page.id);
        return;
      }
      
      const newImg = new Image();
      newImg.onload = () => {
        if (page._abortOperation) return;
        page.currentImage = newImg;
        page.canvas.width = newImg.width;
        page.canvas.height = newImg.height;
        this.pushHistory(page.id);
        this.renderPage(page.id);
        page._isProcessing = false;
        this.hidePageOverlay(page.id);
        this.triggerAutosave(true); // Salva imediatamente
        if (window.app) window.app.showToast('Fundo removido com sucesso!', 'success');
      };
      newImg.onerror = () => {
        page._isProcessing = false;
        this.hidePageOverlay(page.id);
        if (window.app) window.app.showToast('Erro ao carregar imagem processada', 'error');
      };
      newImg.src = result.base64;
    } catch (error) {
      console.error('Falha ao remover fundo:', error);
      if (window.app) window.app.showToast('Erro ao remover fundo: ' + error.message, 'error');
      page._isProcessing = false;
      this.hidePageOverlay(page.id);
    }
  }
  
  // ======================== History ========================
  
  pushHistory(pageId) {
    const page = this.getPage(pageId || this.activePageId);
    if (!page || !page.currentImage) return;
    if (page.historyIndex < page.history.length - 1) {
      page.history = page.history.slice(0, page.historyIndex + 1);
    }
    page.history.push({
      imageSrc: page.currentImage.src,
      adjustments: { ...page.adjustments },
      transform: { ...page.transform }
    });
    if (page.history.length > 20) page.history.shift();
    page.historyIndex = page.history.length - 1;
    this.triggerAutosave();
  }
  
  undo() {
    const page = this.getActivePage();
    if (!page || page.historyIndex <= 0) return;
    page.historyIndex--;
    this.applyHistoryState(page);
  }
  
  redo() {
    const page = this.getActivePage();
    if (!page || page.historyIndex >= page.history.length - 1) return;
    page.historyIndex++;
    this.applyHistoryState(page);
  }
  
  applyHistoryState(page) {
    const state = page.history[page.historyIndex];
    if (!state) return;
    page.adjustments = { ...state.adjustments };
    page.transform = { ...state.transform };
    Object.keys(page.adjustments).forEach(k => this.setAdjustment(k, page.adjustments[k]));
    Object.keys(page.transform).forEach(k => this.setTransform(k, page.transform[k]));
    if (page.currentImage.src !== state.imageSrc) {
      const img = new Image();
      img.onload = () => { page.currentImage = img; this.renderPage(page.id); };
      img.src = state.imageSrc;
    } else {
      this.renderPage(page.id);
    }
  }
  
  showOriginal() {
    const page = this.getActivePage();
    if (!page || !page.originalImage) return;
    // Limpar canvas com transparencia para preservar o fundo invisivel na exportacao
    page.ctx.clearRect(0, 0, page.canvas.width, page.canvas.height);
    page.ctx.drawImage(page.originalImage, 0, 0);
  }
  
  showEdited() {
    const page = this.getActivePage();
    if (page) this.renderPage(page.id);
  }
  
  getProcessedBase64(pageId, format = 'png') {
    const page = this.getPage(pageId || this.activePageId);
    if (!page || !page.canvas) return null;
    const fullData = this.processor.canvasToBase64(page.canvas, format);
    return fullData.split(',')[1];
  }
  
  // ======================== Sidebar Sync ========================
  
  syncSidebarSliders() {
    const page = this.getActivePage();
    if (!page) return;
    Object.keys(this.defaultAdjustments).forEach(key => {
      const slider = document.getElementById(`slider-${key}`);
      const valSpan = document.getElementById(`value-${key}`);
      if (slider) slider.value = page.adjustments[key];
      if (valSpan) valSpan.textContent = page.adjustments[key];
    });
    const zoomSlider = document.getElementById('slider-zoom');
    if (zoomSlider) zoomSlider.value = Math.round(page.transform.zoom * 100);
    const zoomVal = document.getElementById('value-zoom');
    if (zoomVal) zoomVal.textContent = `${Math.round(page.transform.zoom * 100)}%`;
    const statusZoom = document.getElementById('statusbar-zoom');
    if (statusZoom) statusZoom.textContent = `${Math.round(page.transform.zoom * 100)}%`;
    const posXInput = document.getElementById('slider-posX');
    if (posXInput) posXInput.value = page.transform.posX;
    const posYInput = document.getElementById('slider-posY');
    if (posYInput) posYInput.value = page.transform.posY;
    const rotSlider = document.getElementById('slider-rotation');
    if (rotSlider) rotSlider.value = page.transform.rotation;
    const rotVal = document.getElementById('value-rotation');
    if (rotVal) rotVal.textContent = `${page.transform.rotation}°`;
  }
  
  getActiveMainPage() {
    const page = this.getActivePage();
    if (!page) return null;
    if (!page.variantIndex || page.variantIndex === 0) return page;
    return this.pages.find(p => p.groupId === page.groupId && (!p.variantIndex || p.variantIndex === 0)) || page;
  }
  
  syncSidebarDescription() {
    const page = this.getActiveMainPage();
    const indicator = document.getElementById('desc-page-indicator');
    const textareaOriginal = document.getElementById('textarea-descricao-original');
    const textareaNova = document.getElementById('textarea-descricao');
    const btnGerar = document.getElementById('btn-reescrever-ia');
    const divActionButtons = document.getElementById('ai-action-buttons');
    
    if (!page) {
      if (indicator) indicator.textContent = 'Nenhuma página selecionada';
      if (textareaOriginal) textareaOriginal.value = '';
      if (textareaNova) textareaNova.value = '';
      if (btnGerar) {
        btnGerar.innerHTML = '<i data-lucide="wand-2" style="width:10px;height:10px;"></i> Gerar';
        btnGerar.style.display = 'flex';
      }
      if (divActionButtons) divActionButtons.style.display = 'none';
      this._updateProductRefCard(null);
      this._debouncedLucide();
      return;
    }
    
    this._updateProductRefCard(page);
    
    if (indicator) {
      let mainPageId = page.id;
      let pageNum = this.getPageDisplayNumber(page);
      let label = `Página ${pageNum}`;
      if (page.sku) label += ` - ${page.sku}`;
      if (page.productName) label += ` - ${page.productName}`;
      if (page.brand) label += ` | ${page.brand}`;
      indicator.textContent = label;
    }
    if (textareaOriginal) textareaOriginal.value = page.descriptionOriginal || '';
    
    if (page._isGenerating) {
      if (btnGerar) {
        btnGerar.disabled = true;
        btnGerar.innerHTML = '<i data-lucide="loader-2" style="width:10px;height:10px;" class="spin"></i> Gerando...';
        btnGerar.style.opacity = '0.6';
      }
      if (textareaNova) {
        textareaNova.value = '';
        textareaNova.placeholder = '? Gerando descrição com IA... Aguarde.';
        textareaNova.style.opacity = '0.5';
      }
    } else {
      if (btnGerar) {
        btnGerar.disabled = false;
        btnGerar.innerHTML = page.description ? '<i data-lucide="sparkles" style="width:10px;height:10px;"></i> Gerar Novamente' : '<i data-lucide="wand-2" style="width:10px;height:10px;"></i> Gerar';
        btnGerar.style.opacity = '1';
      }
      if (textareaNova) {
        textareaNova.value = page.description || '';
        textareaNova.placeholder = "Preencha as referências acima e clique em Gerar...";
        textareaNova.style.opacity = '1';
      }
    }
    
    if (divActionButtons) {
      divActionButtons.style.display = page.description ? 'flex' : 'none';
    }

    // Sincronizar imagem de referência para IA (OCR) específica desta página
    const ocrDropzone = document.getElementById('ocr-dropzone');
    const ocrPreview = document.getElementById('ocr-preview');
    const btnRemoveOcr = document.getElementById('btn-remove-ocr');
    if (page && page.ocrImageBase64) {
      if (ocrDropzone) ocrDropzone.style.display = 'none';
      if (ocrPreview) {
        ocrPreview.src = page.ocrImageBase64;
        ocrPreview.style.display = 'block';
      }
      if (btnRemoveOcr) btnRemoveOcr.style.display = 'block';
      if (window.app) window.app._ocrImageBase64 = page.ocrImageBase64;
    } else {
      if (ocrDropzone) ocrDropzone.style.display = 'block';
      if (ocrPreview) {
        ocrPreview.src = '';
        ocrPreview.style.display = 'none';
      }
      if (btnRemoveOcr) btnRemoveOcr.style.display = 'none';
      if (window.app) window.app._ocrImageBase64 = null;
    }

    this._debouncedLucide();
  }
  

  getPageDisplayNumber(page) {
    if (!page) return 1;
    const idx = this.pages.indexOf(page);
    return idx >= 0 ? idx + 1 : (page.id || 1);
  }

  updateAllPageNumbers() {
    this.pages.forEach((p, idx) => {
      const pageNum = idx + 1;
      const wrapper = document.querySelector(`.page-wrapper[data-page-id="${p.id}"]`);
      if (wrapper) {
        const label = wrapper.querySelector('.page-number-label');
        if (label && (!p.variantIndex || p.variantIndex === 0)) {
          label.textContent = `Página ${pageNum}`;
        }
      }
    });
  }

  updatePageHeader(page) {
    const wrapper = document.querySelector(`.page-wrapper[data-page-id="${page.id}"]`);
    if (!wrapper) return;
    const titleEl = wrapper.querySelector('.page-title');
    if (!titleEl) return;
    
    // Remover info antiga se existir
    const oldInfo = titleEl.querySelector('.page-product-info');
    if (oldInfo) oldInfo.remove();
    
    // Montar info: CÓDIGO - NOME - MARCA
    const parts = [];
    if (page.productName) parts.push(page.productName);
    if (page.brand) parts.push(page.brand);
    
    if (parts.length > 0) {
      const infoSpan = document.createElement('span');
      infoSpan.className = 'page-product-info';
      infoSpan.textContent = ` - ${parts.join(' | ')}`;
      infoSpan.style.cssText = 'color: var(--text-secondary); font-size: 11px; white-space: nowrap; vertical-align: middle;';
      titleEl.appendChild(infoSpan);
    }
  }
  
  // ======================== Sankhya ========================
  
  async buscarSku(pageId) {
    const page = this.getPage(pageId);
    if (!page) return;
    const sku = String(page.sku || '').trim();
    if (!sku) { if (window.app) window.app.showToast('Digite um código SKU', 'warning'); return; }
    const settings = window.app?.settingsManager?.settings;
    if (!settings.sankhyaSecret || !settings.sankhyaToken || !settings.sankhyaQuery) {
      if (window.app) window.app.showToast('Configure Sankhya nas Configurações primeiro', 'warning');
      return;
    }
    if (window.app) window.app.showToast('Buscando no Sankhya...', 'info');
    
    // Limpar apenas a descrição original para recarregar fresca do Sankhya
    page.descriptionOriginal = '';
    this.syncSidebarDescription();
    try {
      const result = await window.api.sankhya.query({
        sku, secret: settings.sankhyaSecret,
        token: settings.sankhyaToken, query: settings.sankhyaQuery,
        environment: settings.sankhyaEnvironment || 'sandbox',
        clientId: settings.sankhyaClientId
      });
      let caracteristicas = '';
      let nomeProduto = '';
      let marca = '';
      if (result?.responseBody?.rows && result?.responseBody?.fieldsMetadata) {
        const rows = result.responseBody.rows;
        const meta = result.responseBody.fieldsMetadata;
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          // Buscar campos por nome
          for (let i = 0; i < meta.length; i++) {
            const fieldName = (meta[i].name || '').toUpperCase();
            const valor = Array.isArray(row) ? row[i] : Object.values(row)[i];
            if (fieldName === 'CARACTERISTICAS' && valor && String(valor).trim()) {
              caracteristicas = String(valor).trim();
            }
            if ((fieldName === 'NOME' || fieldName === 'DESCRPROD') && valor && String(valor).trim()) {
              if (!nomeProduto) nomeProduto = String(valor).trim();
            }
            if ((fieldName === 'MARCA' || fieldName === 'DESCRMAR' || fieldName === 'FABRICANTE' || fieldName === 'DESCRFABR' || fieldName === 'AD_FABRICANTE' || fieldName === 'MARCAPROD') && valor && String(valor).trim()) {
              if (!marca) marca = String(valor).trim();
            }
          }
        }
      }
      if (caracteristicas || nomeProduto) {
        page.descriptionOriginal = caracteristicas || '';
        if (nomeProduto) page.productName = nomeProduto;
        if (marca) page.brand = marca;
        page._freshSankhyaLoaded = true;
        this.updatePageHeader(page);
        if (window.app && typeof window.app.updateStatusBarQueueCount === 'function') {
          window.app.updateStatusBarQueueCount();
        }
        this.syncSidebarDescription();
        if (caracteristicas) {
          if (window.app) window.app.showToast('Produto encontrado!', 'success');
        } else {
          if (window.app) window.app.showToast('Produto encontrado! (sem descrição/caracter?sticas)', 'info');
        }
        
        // Buscar imagem de referência em paralelo (não bloqueia)
        try { await this._fetchProductImage(page, sku, settings); } catch(e) { /* silencioso */ }
        
      } else {
        if (window.app) window.app.showToast('Produto não encontrado', 'warning');
      }
    } catch (err) {
      console.error('Erro Sankhya:', err);
      if (window.app) window.app.showToast('Erro: ' + err.message, 'error');
    }
  }

  async buscarSkuSilent(pageId) {
    const page = this.getPage(pageId);
    if (!page) return;
    const sku = String(page.sku || '').trim();
    if (!sku) return;
    const settings = window.app?.settingsManager?.settings;
    if (!settings || !settings.sankhyaSecret || !settings.sankhyaToken || !settings.sankhyaQuery) return;
    
    // NUNCA zere as descrições existentes aqui! Elas devem permanecer visíveis enquanto a consulta roda.
    try {
      const result = await window.api.sankhya.query({
        sku, secret: settings.sankhyaSecret,
        token: settings.sankhyaToken, query: settings.sankhyaQuery,
        environment: settings.sankhyaEnvironment || 'sandbox',
        clientId: settings.sankhyaClientId
      });
      
      let caracteristicas = '';
      let nomeProduto = '';
      let marca = '';
      
      if (result?.responseBody?.rows && result?.responseBody?.fieldsMetadata) {
        const rows = result.responseBody.rows;
        const meta = result.responseBody.fieldsMetadata;
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          for (let i = 0; i < meta.length; i++) {
            const fieldName = (meta[i].name || '').toUpperCase();
            const valor = Array.isArray(row) ? row[i] : Object.values(row)[i];
            if (fieldName === 'CARACTERISTICAS' && valor && String(valor).trim()) {
              caracteristicas = String(valor).trim();
            }
            if ((fieldName === 'NOME' || fieldName === 'DESCRPROD') && valor && String(valor).trim()) {
              if (!nomeProduto) nomeProduto = String(valor).trim();
            }
            if ((fieldName === 'MARCA' || fieldName === 'DESCRMAR' || fieldName === 'FABRICANTE' || fieldName === 'DESCRFABR' || fieldName === 'AD_FABRICANTE' || fieldName === 'MARCAPROD') && valor && String(valor).trim()) {
              if (!marca) marca = String(valor).trim();
            }
          }
        }
      }
      
      if (caracteristicas || nomeProduto) {
        if (caracteristicas) page.descriptionOriginal = caracteristicas;
        if (nomeProduto) page.productName = nomeProduto;
        if (marca) page.brand = marca;
        page._freshSankhyaLoaded = true;
        this.updatePageHeader(page);
        if (window.app && typeof window.app.updateStatusBarQueueCount === 'function') {
          window.app.updateStatusBarQueueCount();
        }
        
        // Sincroniza a barra lateral se esta for a página atualmente selecionada
        const activeMain = this.getActiveMainPage();
        if (activeMain && activeMain.id === page.id) {
          this.syncSidebarDescription();
        }
      }
      
      // Buscar imagem de referencia se ainda não tiver
      if (!page.referenceImage) {
        try { await this._fetchProductImage(page, sku, settings); } catch(e) { /* silencioso */ }
      }
      
    } catch (err) {
      console.error('Erro Sankhya (silencioso):', err);
    }
  }

  async _fetchProductImage(page, sku, settings) {
    try {
      if (!window.api || !window.api.sankhya || !window.api.sankhya.getProductImage) return;
      const result = await window.api.sankhya.getProductImage({
        codProd: sku,
        settings: {
          sankhyaSecret: settings.sankhyaSecret,
          sankhyaToken: settings.sankhyaToken,
          sankhyaClientId: settings.sankhyaClientId,
          sankhyaEnvironment: settings.sankhyaEnvironment || 'sandbox'
        }
      });
      if (result && result.success && result.base64) {
        page.referenceImage = result.base64;
        console.log('[RefImg] SKU ' + sku + ' imagem carregada');
      } else {
        page.referenceImage = null;
      }
      // Sempre atualizar o card se for a pagina ativa
      const activeMain = this.getActiveMainPage();
      if (activeMain && (activeMain.id === page.id || activeMain.groupId === page.groupId)) {
        this._updateProductRefCard(page);
      }
    } catch (err) {
      console.error('[RefImg] Erro SKU ' + sku + ':', err);
      page.referenceImage = null;
    }
  }
  
  _updateProductRefCard(page) {
    const card = document.getElementById('product-ref-card');
    const img = document.getElementById('product-ref-img');
    const imgEmpty = document.getElementById('product-ref-img-empty');
    const codeEl = document.getElementById('product-ref-code');
    const nameEl = document.getElementById('product-ref-name');
    const brandEl = document.getElementById('product-ref-brand');
    if (!card) return;
    
    if (!page || (!page.sku && !page.productName)) {
      card.style.display = 'none';
      return;
    }
    
    card.style.display = 'block';
    if (codeEl) codeEl.textContent = page.sku || '';
    if (nameEl) nameEl.textContent = page.productName || '';
    if (brandEl) {
      if (page.brand) {
        brandEl.textContent = 'Fabricante: ' + page.brand;
        brandEl.style.display = 'block';
      } else {
        brandEl.textContent = '';
        brandEl.style.display = 'none';
      }
    }

    // Atalho: clicar no nome/fabricante abre a pesquisa no Google no navegador padrão e copia
    const infoWrap = document.getElementById('product-ref-info');
    if (infoWrap) {
      infoWrap.title = 'Clique para pesquisar no Google (navegador padrão)';
      infoWrap.onclick = () => {
        const name = (page.productName || '').trim();
        const brand = (page.brand || '').trim();
        const textToSearch = [name, brand].filter(Boolean).join(' ');
        if (!textToSearch) return;

        // 1. Copiar para o clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(textToSearch);
        }
        if (window.api && window.api.clipboard && window.api.clipboard.writeText) {
          window.api.clipboard.writeText(textToSearch);
        }

        // 2. Sanitizar os termos de busca
        const cleanQuery = textToSearch
          .replace(/[\/|\\,;:*?"<>#%]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const formattedQuery = encodeURIComponent(cleanQuery).replace(/%20/g, '+');

        // 3. Copiar a imagem de referência para o Clipboard do Windows (se existir)
        let hasCopiedImage = false;
        if (page.referenceImage && window.api?.clipboard?.writeImage) {
          window.api.clipboard.writeImage(page.referenceImage);
          hasCopiedImage = true;
        }

        // 4. Abrir o Google Imagens diretamente no navegador padrão com Nome e Fabricante
        const searchUrl = `https://www.google.com/search?tbm=isch&q=${formattedQuery}`;
        if (window.api?.shell?.openExternal) {
          window.api.shell.openExternal(searchUrl);
        } else {
          window.open(searchUrl, '_blank');
        }

        if (window.app) {
          if (hasCopiedImage) {
            window.app.showToast('Google Imagens aberto! Imagem copiada (pressione Ctrl+V se desejar comparar a foto).', 'success');
          } else {
            window.app.showToast('Pesquisando no Google Imagens...', 'info');
          }
        }
      };
    }
    
    if (page.referenceImage && img) {
      img.src = page.referenceImage;
      img.style.display = 'block';
      img.style.cursor = 'pointer';
      img.onclick = () => {
        // Lightbox para expandir a imagem
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 99999; display: flex; align-items: center; justify-content: center; cursor: pointer;';
        const bigImg = document.createElement('img');
        bigImg.src = page.referenceImage;
        bigImg.style.cssText = 'max-width: 85vw; max-height: 85vh; object-fit: contain; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);';
        overlay.appendChild(bigImg);
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
      };
      if (imgEmpty) imgEmpty.style.display = 'none';
    } else {
      if (img) { img.src = ''; img.style.display = 'none'; }
      if (imgEmpty) {
        imgEmpty.style.display = 'flex';
        imgEmpty.style.flexDirection = 'column';
        imgEmpty.style.alignItems = 'center';
        imgEmpty.style.justifyContent = 'center';
        imgEmpty.style.cursor = 'pointer';
        imgEmpty.title = 'Clique para recarregar foto do Sankhya';
        imgEmpty.innerHTML = '<span style="font-size: 10px; font-weight: 500; color: var(--text-muted);">Sem foto</span><span style="font-size: 8px; color: var(--primary-color); margin-top: 2px;">(clique p/ recarregar)</span>';
        imgEmpty.onclick = async () => {
          imgEmpty.innerHTML = '<i data-lucide="loader-2" class="spin" style="width:14px;height:14px;color:var(--primary-color);"></i><span style="font-size:8px;margin-top:2px;">Buscando...</span>';
          if (window.lucide) window.lucide.createIcons();
          const settings = window._settingsManager?.settings || {};
          await this._fetchProductImage(page, page.sku, settings);
        };
      }
    }
  }
  
  setBgColor(color) {
    this._bgColor = color;
    document.documentElement.style.setProperty('--page-bg-color', color);
    document.querySelectorAll('.canvas-container').forEach(c => {
      c.style.setProperty('background-color', color, 'important');
    });
  }
  
  // ======================== Helpers ========================
  
  setProcessing(isProc) {
    this.isProcessing = isProc;
    const loadingOverlay = document.getElementById('editor-loading');
    if (loadingOverlay) loadingOverlay.style.display = isProc ? 'flex' : 'none';
  }
  
  bindGlobalEvents() {
    const pagesContainer = document.getElementById('pages-container');
    if (pagesContainer) {
      pagesContainer.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          const zoomDelta = e.deltaY < 0 ? 1.1 : 0.9;
          this.workspaceZoom *= zoomDelta;
          this.workspaceZoom = Math.max(0.2, Math.min(3.0, this.workspaceZoom));
          
          // Aplica o zoom via CSS zoom nativo (escala toda a UI dos cards)
          pagesContainer.style.zoom = this.workspaceZoom;
        }
      });
    }

    const adjustmentTypes = ['brightness', 'contrast', 'saturation', 'temperature', 'hue', 'highlights', 'shadows', 'whites', 'blacks'];
    adjustmentTypes.forEach(type => {
      const slider = document.getElementById(`slider-${type}`);
      if (slider) {
        slider.addEventListener('input', (e) => this.setAdjustment(type, parseInt(e.target.value)));
        slider.addEventListener('change', () => { const p = this.getActivePage(); if (p) this.pushHistory(p.id); });
        // Duplo clique reseta este slider ao valor padrão
        slider.addEventListener('dblclick', () => {
          const defaultVal = this.defaultAdjustments[type] || 0;
          this.setAdjustment(type, defaultVal);
          slider.value = defaultVal;
          const p = this.getActivePage(); if (p) this.pushHistory(p.id);
        });
      }
    });
    
    const zoomSlider = document.getElementById('slider-zoom');
    if (zoomSlider) {
      zoomSlider.addEventListener('input', (e) => this.setTransform('zoom', parseFloat(e.target.value) / 100));
      zoomSlider.addEventListener('change', () => { const p = this.getActivePage(); if (p) this.pushHistory(p.id); });
      zoomSlider.addEventListener('dblclick', () => {
        this.setTransform('zoom', 1);
        zoomSlider.value = 100;
        const p = this.getActivePage(); if (p) this.pushHistory(p.id);
      });
    }
    const posXInput = document.getElementById('slider-posX');
    if (posXInput) {
      posXInput.addEventListener('input', (e) => this.setTransform('posX', parseFloat(e.target.value) || 0));
      posXInput.addEventListener('change', () => { const p = this.getActivePage(); if (p) this.pushHistory(p.id); });
    }
    const posYInput = document.getElementById('slider-posY');
    if (posYInput) {
      posYInput.addEventListener('input', (e) => this.setTransform('posY', parseFloat(e.target.value) || 0));
      posYInput.addEventListener('change', () => { const p = this.getActivePage(); if (p) this.pushHistory(p.id); });
    }
    const rotSlider = document.getElementById('slider-rotation');
    if (rotSlider) {
      rotSlider.addEventListener('input', (e) => this.setTransform('rotation', parseFloat(e.target.value)));
      rotSlider.addEventListener('change', () => { const p = this.getActivePage(); if (p) this.pushHistory(p.id); });
      rotSlider.addEventListener('dblclick', () => {
        this.setTransform('rotation', 0);
        rotSlider.value = 0;
        const p = this.getActivePage(); if (p) this.pushHistory(p.id);
      });
    }
    
    document.getElementById('btn-auto-adjust')?.addEventListener('click', () => this.autoAdjust());
    document.getElementById('btn-reset-adjustments')?.addEventListener('click', () => this.resetAdjustments());
    
    document.getElementById('btn-add-page')?.addEventListener('click', () => {
      this.createPage();
      this._debouncedLucide();
    });
    
    document.getElementById('btn-add-variant')?.addEventListener('click', () => {
      this.addVariantPage();
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        this.showOriginal();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.showEdited();
    });
    
    const textareaOriginal = document.getElementById('textarea-descricao-original');
    textareaOriginal?.addEventListener('input', () => {
      const page = this.getActiveMainPage();
      if (page) {
        page.descriptionOriginal = textareaOriginal.value;
        page.hasChanges = true;
      }
    });

    const textarea = document.getElementById('textarea-descricao');
    textarea?.addEventListener('input', () => {
      const page = this.getActiveMainPage();
      if (page) {
        page.description = textarea.value;
        page.hasChanges = true;
      }
    });
  }
  
  get currentImage() { const p = this.getActivePage(); return p?.currentImage || null; }
  get currentFile() { const p = this.getActivePage(); return p ? { name: p.sku || 'imagem', sku: p.sku, format: 'jpg' } : null; }
  get hasChanges() { return this.pages.some(p => p.hasChanges); }
  get transform() { const p = this.getActivePage(); return p?.transform || this.defaultTransform; }
  // ======================== Pincéis IA (Borracha + Generativo) ========================
  
  _brushMode = 'eraser'; // 'eraser' | 'generative'
  
  switchBrushTab(mode) {
    const controls = document.getElementById('magic-eraser-controls');
    
    // Se clicar na mesma aba ativa ? desativar tudo
    if (this.magicEraserActive && this._brushMode === mode) {
      this.magicEraserActive = false;
      document.getElementById('brush-tab-eraser')?.classList.remove('active');
      document.getElementById('brush-tab-generative')?.classList.remove('active');
      if (controls) controls.style.display = 'none';
      this.clearMagicEraserCanvas();
      this._removeFloatingPrompt();
      return;
    }
    
    // Trocar modo
    this._brushMode = mode;
    
    // Atualizar abas visuais
    document.getElementById('brush-tab-eraser')?.classList.toggle('active', mode === 'eraser');
    document.getElementById('brush-tab-generative')?.classList.toggle('active', mode === 'generative');
    // Classe especial para cor diferente na aba generativa
    const genTab = document.getElementById('brush-tab-generative');
    if (genTab) {
      genTab.classList.toggle('brush-tab-generative', mode === 'generative');
    }
    
    // Atualizar texto do botão de ação
    const applyBtn = document.getElementById('btn-eraser-apply');
    if (applyBtn) {
      if (mode === 'eraser') {
        applyBtn.innerHTML = '<i data-lucide="eraser" style="width:10px;height:10px;"></i> Apagar Seleção';
      } else {
        applyBtn.innerHTML = '<i data-lucide="sparkles" style="width:10px;height:10px;"></i> Gerar';
      }
      this._debouncedLucide();
    }
    
    // Fechar prompt flutuante se tiver aberto
    this._removeFloatingPrompt();
    
    // Ativar pincel (ou recriar canvas se já estava ativo)
    if (this.magicEraserActive) {
      // J? estava ativo, limpar e recriar com novo modo
      this.clearMagicEraserCanvas();
      this.initMagicEraserCanvas();
    } else {
      // Primeira ativação
      this.magicEraserActive = true;
      if (controls) controls.style.display = 'flex';
      this.initMagicEraserCanvas();
    }
  }
  

  deactivateBrush() {
    this.magicEraserActive = false;
    document.getElementById('brush-tab-eraser')?.classList.remove('active');
    document.getElementById('brush-tab-generative')?.classList.remove('active');
    const controls = document.getElementById('magic-eraser-controls');
    if (controls) controls.style.display = 'none';
    this.clearMagicEraserCanvas();
    this._removeFloatingPrompt();
    if (this._brushCursor) this._brushCursor.style.display = 'none';
    document.querySelectorAll('.magic-eraser-overlay').forEach(el => el.remove());
    this._eraserCanvas = null;
    this._eraserCtx = null;
  }

  cancelActiveActions() {
    let count = 0;

    // 1. Interromper carregamento da fila
    if (this._isLoadingQueue) {
      this._isLoadingQueue = false;
      count++;
    }

    // 2. Abortar overlays e processos de IA em todas as páginas
    this.pages.forEach(page => {
      if (page._isProcessing) {
        page._abortOperation = true;
        page._isProcessing = false;
        this.hidePageOverlay(page.id);
        count++;
      }
    });

    // 3. Desativar modo pincel (Borracha ou Generativo)
    if (this.magicEraserActive) {
      this.deactivateBrush();
      count++;
    } else {
      this.clearMagicEraserCanvas();
      this._removeFloatingPrompt();
    }

    // 4. Fechar variações de IA se exibidas
    const aiThumbContainer = document.getElementById('ai-thumbnails-container');
    if (aiThumbContainer && aiThumbContainer.style.display !== 'none') {
      const btnCancel = document.getElementById('btn-ai-cancel');
      if (btnCancel) btnCancel.click();
      else {
        this._cancelVariationPreview();
        aiThumbContainer.style.display = 'none';
      }
      count++;
    }

    // 5. Se houver variação pré-visualizada no canvas
    if (this._selectedVariationB64 || this._previewOriginalSrc) {
      this._cancelVariationPreview();
      count++;
    }

    return count;
  }

  toggleBrush() {
    if (this.magicEraserActive) {
      // Desativar
      this.magicEraserActive = false;
      document.getElementById('brush-tab-eraser')?.classList.remove('active');
      document.getElementById('brush-tab-generative')?.classList.remove('active');
      const controls = document.getElementById('magic-eraser-controls');
      if (controls) controls.style.display = 'none';
      this.clearMagicEraserCanvas();
      this._removeFloatingPrompt();
    } else {
      // Ativar com modo atual
      this.switchBrushTab(this._brushMode);
    }
  }
  
  // Manter compatibilidade
  toggleMagicEraser() {
    this.toggleBrush();
  }
  
  initMagicEraserCanvas() {
    const page = this.getActivePage();
    if (!page) return;
    
    const wrapper = document.querySelector(`.page-wrapper[data-page-id="${page.id}"]`);
    if (!wrapper) return;
    
    // Criar canvas overlay para pintura
    let overlay = wrapper.querySelector('.magic-eraser-overlay');
    if (!overlay) {
      overlay = document.createElement('canvas');
      overlay.className = 'magic-eraser-overlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;z-index:10;pointer-events:auto;';
      const container = wrapper.querySelector('.canvas-container') || wrapper;
      container.style.position = 'relative';
      container.appendChild(overlay);
    }
    
    overlay.width = page.canvas.width;
    overlay.height = page.canvas.height;
    this._eraserCtx = overlay.getContext('2d');
    this._eraserCanvas = overlay;
    this._eraserPainting = false;
    this._eraserBrushSize = parseInt(document.getElementById('eraser-brush-size')?.value || '30');
    
    // Criar cursor visual do pincel
    let brushCursor = document.getElementById('eraser-brush-cursor');
    if (!brushCursor) {
      brushCursor = document.createElement('div');
      brushCursor.id = 'eraser-brush-cursor';
      const isGen = this._brushMode === 'generative';
      const color = isGen ? '#6366f1' : '#ff4444';
      const shadow = isGen ? 'rgba(99,102,241,0.5)' : 'rgba(255,0,0,0.5)';
      brushCursor.style.cssText = `position:fixed;pointer-events:none;border:2px solid ${color};border-radius:50%;z-index:9999;display:none;box-shadow:0 0 4px ${shadow};transform:translate(-50%,-50%);`;
      document.body.appendChild(brushCursor);
    } else {
      const isGen = this._brushMode === 'generative';
      brushCursor.style.borderColor = isGen ? '#6366f1' : '#ff4444';
      brushCursor.style.boxShadow = `0 0 4px ${isGen ? 'rgba(99,102,241,0.5)' : 'rgba(255,0,0,0.5)'}`;
    }
    this._brushCursor = brushCursor;
    this._updateBrushCursorSize();
    
    overlay.style.cursor = 'none';
    
    // Prevenir menu de contexto ao usar botão direito
    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    overlay.addEventListener('mousedown', (e) => {
      // Photoshop style: Alt + Botão Direito para redimensionar pincel
      if (e.button === 2 && (e.altKey || this._altKeyHeld)) {
        e.preventDefault();
        e.stopPropagation();
        this._startBrushResize(e);
        return;
      }
      if (e.button === 0 && !e.altKey) {
        this._eraserStartPaint(e);
      }
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!this._isResizingBrush) {
        this._eraserMoveCursor(e);
        this._eraserPaint(e);
      }
    });

    overlay.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this._eraserStopPaint(e);
      }
    });

    overlay.addEventListener('mouseleave', () => {
      if (!this._isResizingBrush) {
        this._eraserStopPaint();
        if (this._brushCursor) this._brushCursor.style.display = 'none';
      }
    });

    overlay.addEventListener('mouseenter', () => {
      if (this._brushCursor) this._brushCursor.style.display = 'block';
    });
  }
  
  _updateBrushCursorSize() {
    if (!this._brushCursor) return;
    const displaySize = this._eraserBrushSize * 2;
    this._brushCursor.style.width = displaySize + 'px';
    this._brushCursor.style.height = displaySize + 'px';
  }
  
  _eraserMoveCursor(e) {
    if (!this._brushCursor) return;
    this._brushCursor.style.display = 'block';
    this._brushCursor.style.left = e.clientX + 'px';
    this._brushCursor.style.top = e.clientY + 'px';
  }

  /**
   * Atalho Photoshop: Alt + Botão Direito do Mouse + Arrastar horizontalmente
   * Direita -> Aumenta tamanho do pincel
   * Esquerda -> Diminui tamanho do pincel
   */
  _startBrushResize(e) {
    this._isResizingBrush = true;
    const startX = e.clientX;
    const startSize = this._eraserBrushSize;

    const onGlobalMouseMove = (moveEv) => {
      if (!this._isResizingBrush) return;
      const deltaX = moveEv.clientX - startX;
      // Sensibilidade suave: 1px de arrasto = ~0.4px de tamanho
      const newSize = Math.max(2, Math.min(150, Math.round(startSize + deltaX * 0.4)));
      this.updateEraserBrushSize(newSize);
    };

    const onGlobalMouseUp = (upEv) => {
      if (upEv.button === 2 || !upEv.buttons) {
        this._isResizingBrush = false;
        window.removeEventListener('mousemove', onGlobalMouseMove);
        window.removeEventListener('mouseup', onGlobalMouseUp);
      }
    };

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
  }
  
  _eraserStartPaint(e) {
    this._eraserPainting = true;
    this._eraserPaint(e);
  }
  
  _eraserPaint(e) {
    if (!this._eraserPainting || !this._eraserCtx) return;
    const rect = this._eraserCanvas.getBoundingClientRect();
    const scaleX = this._eraserCanvas.width / rect.width;
    const scaleY = this._eraserCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    this._eraserCtx.globalAlpha = 0.5;
    this._eraserCtx.fillStyle = this._brushMode === 'generative' ? '#4466ff' : '#ff0000';
    this._eraserCtx.beginPath();
    this._eraserCtx.arc(x, y, this._eraserBrushSize * scaleX, 0, Math.PI * 2);
    this._eraserCtx.fill();
  }
  
  _eraserStopPaint(e) {
    if (!this._eraserPainting) return;
    this._eraserPainting = false;
    // No modo generativo, mostrar prompt flutuante após pintar
    if (this._brushMode === 'generative' && e) {
      this._showFloatingPrompt(e);
    }
  }
  
  clearMagicEraserCanvas() {
    if (this._eraserCtx && this._eraserCanvas) {
      this._eraserCtx.clearRect(0, 0, this._eraserCanvas.width, this._eraserCanvas.height);
    }
    // Remover overlay
    document.querySelectorAll('.magic-eraser-overlay').forEach(el => el.remove());
    this._eraserCtx = null;
    this._eraserCanvas = null;
    // Esconder cursor
    const brushCursor = document.getElementById('eraser-brush-cursor');
    if (brushCursor) brushCursor.style.display = 'none';
  }
  
  // Método de compatibilidade
  async applyMagicEraser() {
    return this.applyBrush();
  }
  
  async generateAIBackground(targetPage = null, customPrompt = null, btnElement = null) {
    const page = targetPage || this.getActivePage();
    if (!page || !page.currentImage) return;
    
    const promptText = customPrompt || "";
    // Validação de texto removida: backend prover? fallback se vazio.
    
    const settings = window._settingsManager?.settings || (window.app && window.app.settingsManager?.settings);
    if (!settings.geminiApiKey) {
      if (window.app) window.app.showToast('Configure a API Key do Gemini nas configura??es', 'warning');
      return;
    }

    const btn = btnElement;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" style="width:12px;height:12px;" class="spin"></i> Gerando...`;
      this._debouncedLucide();
    }
    this.showPageOverlay(page.id, 'Gerando cenário com IA', 'Criando variações de fundo');

    try {
      // 1. Pega a imagem atual com fundo transparente (PNG)
      let imageBase64 = this.processor.canvasToBase64(page.canvas, 'png');
      
      // 2. Gera a máscara automaticamente: Transparente -> Ciano, Opaco -> Preto
      // O main.js com prompt espera Ciano (azul claro: r=0, g=255, b=255) para preencher
      let maskCanvas = document.createElement('canvas');
      maskCanvas.width = page.canvas.width;
      maskCanvas.height = page.canvas.height;
      let mCtx = maskCanvas.getContext('2d');
      mCtx.drawImage(page.canvas, 0, 0);
      let imgData = mCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      let data = imgData.data;
      
      let transparentPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i+3] < 50) { // Transparente
          data[i] = 0;     // R
          data[i+1] = 255; // G
          data[i+2] = 255; // B
          data[i+3] = 255; // Alpha
          transparentPixels++;
        } else { // Conteúdo a ser mantido
          data[i] = 0;
          data[i+1] = 0;
          data[i+2] = 0;
          data[i+3] = 255;
        }
      }
      
      let maskBase64;
      if (transparentPixels === 0) {
        // Imagem atual não tem transparência. Tentamos usar o backup transparente se existir.
        if (page._lastTransparentBase64 && page._lastTransparentMask) {
          imageBase64 = page._lastTransparentBase64;
          maskBase64 = page._lastTransparentMask;
        } else {
          if (window.app) window.app.showToast('Remova o fundo da imagem primeiro (Editar > Remover Fundo) antes de gerar o cenário!', 'warning');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="sparkles" style="width:12px;height:12px;"></i> Gerar Fundo`;
            this._debouncedLucide();
          }
          return;
        }
      } else {
        mCtx.putImageData(imgData, 0, 0);
        maskBase64 = maskCanvas.toDataURL('image/png');
        // Salva para poder regenerar depois que o fundo for aplicado
        page._lastTransparentBase64 = imageBase64;
        page._lastTransparentMask = maskBase64;
      }
      
      // 3. Chama a API do Gemini
      const result = await window.api.gemini.inpaint({
        imageBase64: imageBase64,
        maskBase64: maskBase64,
        fullImageBase64: null,
        prompt: promptText,
        apiKey: settings.geminiApiKey,
        mode: 'background',
        variations: 3
      });
      
      if (result && result.variations && result.variations.length > 0) {
        // Exibe o painel de miniaturas
        const container = document.getElementById('ai-thumbnails-container');
        const list = document.getElementById('ai-thumbnails-list');
        const btnConfirm = document.getElementById('btn-ai-confirm');
        const btnCancel = document.getElementById('btn-ai-cancel');
        
        if (container && list) {
          list.innerHTML = ''; // Limpa miniaturas anteriores
          
          // Salva o estado atual para caso o usuário cancele
          const backupImageData = imageBase64;
          const backupWidth = page.canvas.width;
          const backupHeight = page.canvas.height;
          const backupTransform = { ...page.transform };
          
          result.variations.forEach((base64Data, index) => {
            const img = document.createElement('img');
            img.className = 'ai-thumbnail';
            img.src = base64Data.startsWith('data:') ? base64Data : `data:image/png;base64,${base64Data}`;
            
            img.onclick = async () => {
              // Remove seleção das outras
              Array.from(list.children).forEach(child => child.classList.remove('selected'));
              img.classList.add('selected');
              
              // Aplica o preview no card atual
              const previewImg = new Image();
              previewImg.onload = () => {
                page.currentImage = previewImg;
                page.canvas.width = previewImg.width;
                page.canvas.height = previewImg.height;
                page.transform = { ...this.defaultTransform };
                this.syncSidebarSliders();
                this.renderPage(page.id);
              };
              previewImg.src = img.src;
            };
            
            list.appendChild(img);
          });
          
          // Seleciona a primeira automaticamente
          if (list.firstChild) {
            list.firstChild.click();
          }
          
          container.style.display = 'flex';
          
          // Eventos dos botões
          btnConfirm.onclick = () => {
            container.style.display = 'none';
            this.pushHistory(page.id); // Salva a escolha no histórico
            if (window.app) window.app.showToast('Cenário aplicado com sucesso!', 'success');
          };
          
          btnCancel.onclick = () => {
              container.style.display = 'none';
              const restoreImg = new Image();
              restoreImg.onload = () => {
                page.currentImage = restoreImg;
                page.canvas.width = backupWidth;
                page.canvas.height = backupHeight;
                page.transform = backupTransform;
                this.syncSidebarSliders();
                this.renderPage(page.id);
              };
              restoreImg.src = backupImageData;
            };

            const btnRegen = document.getElementById('btn-ai-regen');
            if (btnRegen) {
              btnRegen.onclick = async () => {
                container.style.display = 'none';
                const restoreImg = new Image();
                restoreImg.onload = () => {
                  page.currentImage = restoreImg;
                  page.canvas.width = backupWidth;
                  page.canvas.height = backupHeight;
                  page.transform = backupTransform;
                  this.syncSidebarSliders();
                  this.renderPage(page.id);
                  this.generateAIBackground(page, promptText, btnElement);
                };
                restoreImg.src = backupImageData;
              };
            }
        }
      }
    } catch (err) {
      console.error(err);
      if (window.app) window.app.showToast('Erro ao gerar cenário: ' + err.message, 'error');
    } finally {
      this.hidePageOverlay(page.id);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="sparkles" style="width:12px;height:12px;"></i> Gerar Fundo`;
        this._debouncedLucide();
      }
    }
  }
  

  /**
   * Recorta bordas vazias/transparentes/brancas e centraliza o produto
   * proporcionalmente no canvas (regra de auto-ajuste do sistema).
   */
  autoTrimAndCenterCanvas(sourceCanvas, isTransparent = true) {
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let minX = w, minY = h, maxX = -1, maxY = -1;
    let hasContent = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        // Pixel de fundo: transparente (a < 25) OU branco sólido (#FFFFFF ou quase branco)
        const isBg = (a < 25) || (r > 246 && g > 246 && b > 246);
        if (!isBg) {
          hasContent = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Se a imagem estiver vazia ou não encontrar limites, retorna original
    if (!hasContent || maxX < minX || maxY < minY) {
      return sourceCanvas;
    }

    const contentW = maxX - minX + 1;
    const contentH = maxY - minY + 1;

    // Tamanho padrão do canvas quadrado (1024x1024 ou proporcional ao original)
    const targetSize = Math.max(w, h, 1024);

    // Margem proporcional: o produto ocupa ~86% do canvas (7% de margem em cada lado)
    const maxAvailable = targetSize * 0.86;
    const scale = Math.min(maxAvailable / contentW, maxAvailable / contentH, 1.0);

    const scaledW = Math.round(contentW * scale);
    const scaledH = Math.round(contentH * scale);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = targetSize;
    finalCanvas.height = targetSize;
    const fCtx = finalCanvas.getContext('2d');
    fCtx.imageSmoothingEnabled = true;
    fCtx.imageSmoothingQuality = 'high';

    // Se o canvas original não era transparente, preenche o fundo de branco
    if (!isTransparent) {
      fCtx.fillStyle = '#FFFFFF';
      fCtx.fillRect(0, 0, targetSize, targetSize);
    }

    // Desenha o conteúdo recortado exatamente no centro
    const destX = Math.round((targetSize - scaledW) / 2);
    const destY = Math.round((targetSize - scaledH) / 2);

    fCtx.drawImage(sourceCanvas, minX, minY, contentW, contentH, destX, destY, scaledW, scaledH);
    console.log(`[AutoAdjust] Recortado de ${contentW}x${contentH} e centralizado em ${targetSize}x${targetSize}`);
    return finalCanvas;
  }

  async applyBrush(userPrompt) {
    const page = this.getActivePage();
    if (!page || !this._eraserCanvas) return;
    
    // ============================================
    // MODO BORRACHA SIMPLES (NÃO CHAMA IA)
    // ============================================
    if (this._brushMode === 'eraser') {
      const tempCanvas = document.createElement('canvas');
      // Usar o tamanho exato da visualização atual
      tempCanvas.width = page.canvas.width;
      tempCanvas.height = page.canvas.height;
      const ctx = tempCanvas.getContext('2d');
      
      // 1. Forçar render da imagem com todos os ajustes e zoom NO MOMENTO
      // (Bake visual completo)
      const tempImgCanvas = document.createElement('canvas');
      tempImgCanvas.width = page.canvas.width;
      tempImgCanvas.height = page.canvas.height;
      const tCtx = tempImgCanvas.getContext('2d');
      tCtx.imageSmoothingEnabled = true;
      tCtx.imageSmoothingQuality = 'high';
      tCtx.drawImage(page.currentImage, 0, 0);
      this.processor.applyAdjustments(tempImgCanvas, page.adjustments);
      const finalTransformed = this.processor.applyTransform(tempImgCanvas, page.transform);
      
      // 2. Desenhar essa imagem no tempCanvas
      ctx.drawImage(finalTransformed, 0, 0);
      
      // 3. Apagar usando a máscara perfeitamente alinhada
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(this._eraserCanvas, 0, 0, tempCanvas.width, tempCanvas.height);
      ctx.globalCompositeOperation = 'source-over';
      
      // 4. Regra do sistema: auto-trim e centralização proporcional do produto restante
      const finalAdjustedCanvas = this.autoTrimAndCenterCanvas(tempCanvas, true);

      const btn = document.getElementById('btn-eraser-apply');
      if (btn) btn.disabled = true;
      
      const newImg = new Image();
      newImg.onload = () => {
        // Como fizemos bake do zoom/pan/rotação/ajustes e centralizamos o objeto,
        // resetamos as transformações para que o objeto fique perfeito no centro!
        page.transform = { zoom: 1, posX: 0, posY: 0, rotation: 0 };
        page.adjustments = Object.assign({}, this.defaultAdjustments);
        this.syncSidebarSliders(); // atualiza a interface
        
        page.currentImage = newImg;
        page.canvas.width = newImg.width;
        page.canvas.height = newImg.height;
        page.hasChanges = true;
        this.clearMagicEraserCanvas();
        this.renderPage(page.id);
        this.triggerAutosave(true);
        if (btn) btn.disabled = false;
        if (window.app) window.app.showToast('Apagado e centralizado com sucesso!', 'success');
      };
      newImg.src = finalAdjustedCanvas.toDataURL('image/png');
      return;
    }
    
    // ============================================
    // MODO GENERATIVO (CHAMA GEMINI INPAINT)
    // ============================================
    const settings = window._settingsManager?.settings;
    if (!settings.geminiApiKey) {
      alert('Configure a API Key do Gemini nas configurações');
      return;
    }

    // Se o popup flutuante estiver aberto e o userPrompt estiver vazio, pega o que estiver digitado lá
    if (this._brushMode === 'generative' && !userPrompt) {
      const textarea = document.querySelector('.generative-floating-prompt textarea');
      if (textarea && textarea.value.trim()) {
        userPrompt = textarea.value.trim();
      }
    }
    
    // Fechar popup flutuante se estiver aberto
    this._removeFloatingPrompt();
    
    const btn = document.getElementById('btn-eraser-apply');
    const floatingGenBtn = document.querySelector('.generative-floating-prompt .btn-generate');
    const loadingText = 'Gerando...';
    
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" style="width:12px;height:12px;" class="spin"></i> ${loadingText}`;
    }
    if (floatingGenBtn) {
      floatingGenBtn.disabled = true;
      floatingGenBtn.innerHTML = `<i data-lucide="loader-2" style="width:12px;height:12px;" class="spin"></i> ${loadingText}`;
      this._debouncedLucide();
    }
    
    const overlayTitle = (userPrompt && userPrompt.trim()) ? 'Gerando conteúdo com IA' : 'Borracha Generativa IA';
    const overlaySub = (userPrompt && userPrompt.trim()) ? `"${userPrompt}"` : 'Apagando seleção e recriando o fundo...';
    this.showPageOverlay(page.id, overlayTitle, overlaySub);
    
    try {
      // 1. Fazer Bake da visualização para o Generative também! 
      // (Senão o zoom e recortes saem desalinhados do que o usuario pintou na tela)
      const bakedCanvas = document.createElement('canvas');
      bakedCanvas.width = page.canvas.width;
      bakedCanvas.height = page.canvas.height;
      const bCtx = bakedCanvas.getContext('2d');
      const tempImgCanvas = document.createElement('canvas');
      tempImgCanvas.width = page.canvas.width;
      tempImgCanvas.height = page.canvas.height;
      const tCtx = tempImgCanvas.getContext('2d');
      tCtx.drawImage(page.currentImage, 0, 0);
      this.processor.applyAdjustments(tempImgCanvas, page.adjustments);
      const finalTransformed = this.processor.applyTransform(tempImgCanvas, page.transform);
      bCtx.drawImage(finalTransformed, 0, 0);

      const maskData = this._eraserCtx.getImageData(0, 0, this._eraserCanvas.width, this._eraserCanvas.height);
      let minX = this._eraserCanvas.width, minY = this._eraserCanvas.height, maxX = 0, maxY = 0;
      for (let i = 0; i < maskData.data.length; i += 4) {
        if (maskData.data[i + 3] > 10) {
          const px = (i / 4) % this._eraserCanvas.width;
          const py = Math.floor((i / 4) / this._eraserCanvas.width);
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        }
      }
      
      if (maxX < minX) {
        this.showPageOverlay(page.id, 'Nenhuma área pintada');
        setTimeout(() => this.hidePageOverlay(page.id), 2000);
        return;
      }
      
      const padding = 100;
      const x1 = Math.max(0, minX - padding);
      const y1 = Math.max(0, minY - padding);
      const x2 = Math.min(bakedCanvas.width, maxX + padding);
      const y2 = Math.min(bakedCanvas.height, maxY + padding);
      const regionW = x2 - x1;
      const regionH = y2 - y1;
      
      // 3. Imagem base do recorte (do bakedCanvas)
      const cropOrigCanvas = document.createElement('canvas');
      cropOrigCanvas.width = regionW;
      cropOrigCanvas.height = regionH;
      const cropOrigCtx = cropOrigCanvas.getContext('2d');
      cropOrigCtx.drawImage(bakedCanvas, x1, y1, regionW, regionH, 0, 0, regionW, regionH);
      
      // 4. Máscara do recorte
      const cropMaskCanvas = document.createElement('canvas');
      cropMaskCanvas.width = regionW;
      cropMaskCanvas.height = regionH;
      const cropMaskCtx = cropMaskCanvas.getContext('2d');
      cropMaskCtx.fillStyle = '#000000';
      cropMaskCtx.fillRect(0, 0, regionW, regionH);
      cropMaskCtx.globalCompositeOperation = 'source-over';
      cropMaskCtx.drawImage(this._eraserCanvas, x1, y1, regionW, regionH, 0, 0, regionW, regionH);
      
      const imageBase64 = cropOrigCanvas.toDataURL('image/png');
      const maskBase64 = cropMaskCanvas.toDataURL('image/png');
      
      const fullCanvas = document.createElement('canvas');
      const fullMaxSize = 1024;
      const fullRatio = Math.min(fullMaxSize / bakedCanvas.width, fullMaxSize / bakedCanvas.height, 1);
      fullCanvas.width = bakedCanvas.width * fullRatio;
      fullCanvas.height = bakedCanvas.height * fullRatio;
      const fullCtx = fullCanvas.getContext('2d');
      fullCtx.drawImage(bakedCanvas, 0, 0, fullCanvas.width, fullCanvas.height);
      const fullBase64 = fullCanvas.toDataURL('image/jpeg', 0.7);
      
      this._regenerateData = {
        imageBase64, maskBase64, fullBase64,
        prompt: userPrompt,
        apiKey: settings.geminiApiKey,
        needsTransformReset: true // flag p/ resetar transforms se aceitar variacao
      };
      
      const result = await window.api.gemini.inpaint({
        imageBase64: imageBase64,
        maskBase64: maskBase64,
        fullImageBase64: fullBase64,
        prompt: userPrompt,
        apiKey: settings.geminiApiKey,
        mode: 'generative'
      });
      
      if (result && result.variations && result.variations.length > 0) {
        this._inpaintData = { x1, y1, regionW, regionH, page, bakedBase64: bakedCanvas.toDataURL('image/png') };
        this._showVariationPicker(result.variations);
      }
    } catch (err) {
      console.error('Erro pincel IA:', err);
      alert('Erro no pincel IA: ' + err.message);
    } finally {
      this.hidePageOverlay(page.id);
      if (floatingGenBtn) {
        floatingGenBtn.disabled = false;
        floatingGenBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/></svg> Gerar`;
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="sparkles" style="width:12px;height:12px;"></i> Gerar`;
        this._debouncedLucide();
      }
    }
  }

  _showVariationPicker(variations) {
    if (this._eraserCanvas) this._eraserCanvas.style.opacity = "0";
    // Remover picker anterior
    document.getElementById('variation-picker')?.remove();
    
    // Salvar estado original para poder cancelar
    const { page } = this._inpaintData || {};
    if (page) {
      this._previewOriginalSrc = page.currentImage.src;
    }
    this._selectedVariationB64 = null;
    
    const picker = document.createElement('div');
    picker.id = 'variation-picker';
    picker.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(20,20,30,0.95);border-radius:12px;padding:12px 16px;display:flex;gap:12px;align-items:center;box-shadow:0 8px 32px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(10px);';
    
    const label = document.createElement('span');
    label.textContent = 'Escolha:';
    label.style.cssText = 'color:#fff;font-size:12px;font-weight:600;white-space:nowrap;';
    picker.appendChild(label);
    
    const thumbs = [];
    
    variations.forEach((b64, i) => {
      const thumb = document.createElement('img');
      thumb.src = b64;
      thumb.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid transparent;transition:all 0.2s;';
      thumb.title = `Variação ${i + 1}`;
      thumb.addEventListener('mouseenter', () => {
        if (this._selectedVariationB64 !== b64) {
          thumb.style.border = '2px solid rgba(255,255,255,0.4)';
        }
      });
      thumb.addEventListener('mouseleave', () => {
        if (this._selectedVariationB64 !== b64) {
          thumb.style.border = '2px solid transparent';
        }
      });
      thumb.addEventListener('click', () => {
        // Destacar thumb selecionado
        thumbs.forEach(t => { t.style.border = '2px solid transparent'; t.style.transform = 'scale(1)'; });
        thumb.style.border = '2px solid #ff6b35';
        thumb.style.transform = 'scale(1.1)';
        this._selectedVariationB64 = b64;
        // Pr?-visualizar no canvas (sem aplicar definitivamente)
        this._previewVariation(b64);
        // Habilitar botão OK
        if (okBtn) okBtn.style.opacity = '1';
      });
      thumbs.push(thumb);
      picker.appendChild(thumb);
    });
    
    // Container de botões (vertical)
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    
    // Botão Confirmar
    const okBtn = document.createElement('button');
    okBtn.innerHTML = '? Confirmar';
    okBtn.title = 'Confirmar escolha';
    okBtn.style.cssText = 'background:#52c41a;border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;transition:all 0.2s;opacity:0.4;';
    okBtn.addEventListener('mouseenter', () => { if (this._selectedVariationB64) okBtn.style.background = '#73d13d'; });
    okBtn.addEventListener('mouseleave', () => { okBtn.style.background = '#52c41a'; });
    okBtn.addEventListener('click', () => {
      if (!this._selectedVariationB64) return;
      this._confirmVariation();
      picker.remove();
    });
    btnContainer.appendChild(okBtn);
    
    // Botão Cancelar
    const cancelBtn = document.createElement('button');
    cancelBtn.innerHTML = '? Cancelar';
    cancelBtn.title = 'Cancelar';
    cancelBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;transition:all 0.2s;';
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'rgba(255,77,79,0.4)'; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'rgba(255,255,255,0.1)'; });
    cancelBtn.addEventListener('click', () => {
      this._cancelVariationPreview();
      picker.remove();
    });
    btnContainer.appendChild(cancelBtn);
    
    // Botão Gerar Novamente
    const regenBtn = document.createElement('button');
    regenBtn.innerHTML = '? Gerar Novamente';
    regenBtn.title = 'Gerar novas variações';
    regenBtn.style.cssText = 'background:rgba(59,130,246,0.3);border:none;color:#fff;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;transition:all 0.2s;';
    regenBtn.addEventListener('mouseenter', () => { regenBtn.style.background = 'rgba(59,130,246,0.6)'; });
    regenBtn.addEventListener('mouseleave', () => { regenBtn.style.background = 'rgba(59,130,246,0.3)'; });
    regenBtn.addEventListener('click', async () => {
      if (!this._regenerateData) return;
      this._cancelVariationPreview();
      const thumbElements = picker.querySelectorAll('img');
      thumbElements.forEach(t => { t.style.opacity = '0.3'; t.style.filter = 'blur(2px)'; });
      regenBtn.style.opacity = '0.4';
      regenBtn.disabled = true;
      regenBtn.innerHTML = '? Gerando...';
      try {
        const result = await window.api.gemini.inpaint({
            imageBase64: this._regenerateData.imageBase64,
            maskBase64: this._regenerateData.maskBase64,
            fullImageBase64: this._regenerateData.fullBase64,
            prompt: this._regenerateData.prompt,
            apiKey: this._regenerateData.apiKey,
            mode: this._regenerateData.prompt ? 'generative' : 'eraser'
          });
        if (result?.variationsó.length > 0) {
          picker.remove();
          this._showVariationPicker(result.variations);
        }
      } catch (err) {
        console.error('Erro ao regenerar:', err);
        if (window.app) window.app.showToast('Erro ao regenerar: ' + err.message, 'error');
        thumbElements.forEach(t => { t.style.opacity = '1'; t.style.filter = 'none'; });
        regenBtn.style.opacity = '1';
        regenBtn.disabled = false;
        regenBtn.innerHTML = '? Gerar Novamente';
      }
    });
    btnContainer.appendChild(regenBtn);
    
    picker.appendChild(btnContainer);
    
    document.body.appendChild(picker);
  }
  
  _previewVariation(imageBase64) {
    const { x1, y1, regionW, regionH, page } = this._inpaintData || {};
    if (!page) return;
    
    const patchImg = new Image();
    patchImg.onload = () => {
      // Redesenhar imagem original e sobrepor o patch (preview apenas visual)
      page.ctx.drawImage(page.currentImage, 0, 0);
      page.ctx.drawImage(patchImg, x1, y1, regionW, regionH);
    };
    patchImg.src = imageBase64;
  }
  
  _confirmVariation() {
    const { x1, y1, regionW, regionH, page } = this._inpaintData || {};
    if (!page || !this._selectedVariationB64) return;
    
    const patchImg = new Image();
    patchImg.onload = () => {
      page.ctx.drawImage(page.currentImage, 0, 0);
      page.ctx.drawImage(patchImg, x1, y1, regionW, regionH);
      
      const finalImg = new Image();
      finalImg.onload = () => {
        page.currentImage = finalImg;
        this.pushHistory(page.id);
        this.clearMagicEraserCanvas();
        this.initMagicEraserCanvas();
        this._selectedVariationB64 = null;
        this._previewOriginalSrc = null;
        // Remover prompt flutuante só após confirmar
        this._removeFloatingPrompt();
        this.triggerAutosave(true);
      };
      finalImg.src = page.canvas.toDataURL('image/png');
    };
    patchImg.src = this._selectedVariationB64;
  }
  
  _cancelVariationPreview() {
    if (this._eraserCanvas) this._eraserCanvas.style.opacity = "1";
    const { page } = this._inpaintData || {};
    if (!page || !this._previewOriginalSrc) return;
    
    // Restaurar imagem original no canvas
    page.ctx.drawImage(page.currentImage, 0, 0);
    this._selectedVariationB64 = null;
    this._previewOriginalSrc = null;
  }
  
  updateEraserBrushSize(size) {
    this._eraserBrushSize = Math.max(2, Math.min(150, parseInt(size) || 30));
    this._updateBrushCursorSize();
    const slider = document.getElementById('eraser-brush-size');
    const val = document.getElementById('eraser-brush-val');
    if (slider) slider.value = this._eraserBrushSize;
    if (val) val.textContent = this._eraserBrushSize;
  }
  
  // ======================== Floating Prompt (Generativo) ========================
  
  _showFloatingPrompt(e) {
    // Não mostrar se já existe um
    if (document.querySelector('.generative-floating-prompt')) return;
    
    // Calcular posição do bounding box da pintura no viewport
    if (!this._eraserCanvas || !this._eraserCtx) return;
    const maskData = this._eraserCtx.getImageData(0, 0, this._eraserCanvas.width, this._eraserCanvas.height);
    let minX = this._eraserCanvas.width, minY = this._eraserCanvas.height, maxX = 0, maxY = 0;
    let hasPaint = false;
    for (let i = 0; i < maskData.data.length; i += 4) {
      if (maskData.data[i + 3] > 10) {
        hasPaint = true;
        const px = (i / 4) % this._eraserCanvas.width;
        const py = Math.floor((i / 4) / this._eraserCanvas.width);
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
    if (!hasPaint) return;
    
    // Converter coordenadas do canvas para viewport
    const rect = this._eraserCanvas.getBoundingClientRect();
    const scaleX = rect.width / this._eraserCanvas.width;
    const scaleY = rect.height / this._eraserCanvas.height;
    const centerX = rect.left + ((minX + maxX) / 2) * scaleX;
    const bottomY = rect.top + maxY * scaleY;
    
    const promptBox = document.createElement('div');
    promptBox.className = 'generative-floating-prompt';
    
    // Posicionar abaixo da seleção, centralizado
    const promptWidth = 300;
    let left = centerX - promptWidth / 2;
    let top = bottomY + 16;
    
    // Garantir que não saia da tela
    left = Math.max(10, Math.min(left, window.innerWidth - promptWidth - 10));
    if (top + 180 > window.innerHeight) {
      // Se não cabe abaixo, colocar acima
      top = rect.top + minY * scaleY - 180;
      top = Math.max(10, top);
    }
    
    promptBox.style.left = left + 'px';
    promptBox.style.top = top + 'px';
    
    promptBox.innerHTML = `
      <div class="floating-prompt-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/></svg>
        O que deseja gerar aqui?
      </div>
      <textarea placeholder="Opcional: Digite o que inserir, ou clique em Gerar para apagar e recriar o fundo..." autofocus></textarea>
      <div class="floating-prompt-actions">
        <button class="btn-cancel-prompt">Cancelar</button>
        <button class="btn-generate">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/></svg>
          Gerar
        </button>
      </div>
    `;
    
    document.body.appendChild(promptBox);
    
    // Focar no textarea
    const textarea = promptBox.querySelector('textarea');
    setTimeout(() => textarea?.focus(), 50);
    
    // Enter no textarea = gerar (com ou sem prompt)
    textarea?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        const text = textarea.value.trim();
        this._removeFloatingPrompt();
        this.applyBrush(text);
      }
    });
    
    // Botão gerar (com ou sem prompt)
    promptBox.querySelector('.btn-generate')?.addEventListener('click', () => {
      const text = textarea?.value?.trim() || '';
      this._removeFloatingPrompt();
      this.applyBrush(text);
    });
    
    // Botão cancelar
    promptBox.querySelector('.btn-cancel-prompt')?.addEventListener('click', () => {
      this._removeFloatingPrompt();
    });
  }
  
  _removeFloatingPrompt() {
    document.querySelector('.generative-floating-prompt')?.remove();
  }
}

window.Editor = Editor;










