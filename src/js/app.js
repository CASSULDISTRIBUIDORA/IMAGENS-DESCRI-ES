class App {
  constructor() {
    this.views = {
      upload: document.getElementById('view-upload'),
      editor: document.getElementById('view-editor'),
      batch: document.getElementById('view-batch')
    };
    
    this.settingsManager = null;
    this.exportManager = null;
    this.editor = null;
    this.batchProcessor = null;
  }
  
  async init() {
    this.settingsManager = new window.SettingsManager();
    await this.settingsManager.load();
    window._settingsManager = this.settingsManager;
    
    this.exportManager = new window.ExportManager();
    this.editor = new window.Editor();
    
    // Restaurar autosave se existir
    const hasAuto = await this.editor.hasAutosave();
    if (hasAuto) {
      const restored = await this.editor.loadFromLocal();
      if (restored) {
        this.showToast('Sessão anterior restaurada', 'info');
      }
    }
    this.batchProcessor = new window.BatchProcessor();
    
    this.setupUI();
    this.setupDragDrop();
    this.setupKeyboardShortcuts();
    this.setupUpdater();
    this.setupReportModal();
    
    // EXPORTAR TUDO — exporta todas as páginas
    document.getElementById('btn-export')?.addEventListener('click', () => {
      this.exportAllPages();
    });
    
    // Garantir que a página em branco padrão sempre exista na primeira posição
    this.editor.ensureBlankPage();
    
    this.showView('editor');

    // Inicializar ícones e métricas da barra de status
    if (window.lucide) window.lucide.createIcons();
    this.editor.updateMagicProcessButton();
    this.updateStatusBarQueueCount();
  }


  // =========================================================================
  // =========================================================================
  // SISTEMA DE CRIAÇÃO EM LOTE POR TEXTO LIVRE OU PRINTS
  // =========================================================================
  setupBatchImportSystem() {
    const modal = document.getElementById('modal-batch-import');
    const btnOpen = document.getElementById('btn-open-batch-import');
    const btnClose = document.getElementById('btn-close-batch-import');
    const btnCancel = document.getElementById('btn-cancel-batch-import');
    const btnClear = document.getElementById('btn-clear-batch-import');
    const btnExecute = document.getElementById('btn-execute-batch-import');
    const btnExecuteLabel = document.getElementById('btn-execute-batch-label') || document.getElementById('btn-execute-label');
    const textarea = document.getElementById('batch-import-textarea');
    const previewBox = document.getElementById('batch-import-preview-box');
    const countEl = document.getElementById('batch-import-count');
    const dupEl = document.getElementById('batch-import-duplicates');
    const chipsEl = document.getElementById('batch-import-chips');
    const ocrLoading = document.getElementById('batch-import-ocr-loading');

    if (!modal || !btnOpen || !textarea) return;

    let detectedSkus = [];
    let isProcessingImage = false;
    const defaultPlaceholder = textarea.placeholder;

    const openModal = () => {
      modal.style.display = 'flex';
      textarea.value = '';
      textarea.placeholder = defaultPlaceholder;
      setTimeout(() => textarea.focus(), 100);
      updatePreview();
      if (window.lucide) window.lucide.createIcons();
    };

    const closeModal = () => {
      modal.style.display = 'none';
      if (ocrLoading) ocrLoading.style.display = 'none';
      textarea.readOnly = false;
      textarea.placeholder = defaultPlaceholder;
    };

    const extractSkus = (text) => {
      if (!text || typeof text !== 'string') return [];
      // Captura sequências numéricas de 3 a 8 dígitos isoladas por delimitadores
      const matches = text.match(/\b\d{3,8}\b/g) || [];
      const unique = [];
      const seen = new Set();
      for (const m of matches) {
        const clean = m.trim();
        if (clean && !seen.has(clean)) {
          seen.add(clean);
          unique.push(clean);
        }
      }
      return unique;
    };

    const updatePreview = () => {
      const text = textarea?.value || '';
      detectedSkus = extractSkus(text);

      if (detectedSkus.length === 0) {
        if (previewBox) previewBox.style.display = 'none';
        if (btnExecute) {
          btnExecute.disabled = true;
          if (btnExecuteLabel) btnExecuteLabel.textContent = 'Criar Páginas';
        }
        return;
      }

      if (previewBox) previewBox.style.display = 'flex';

      // Verificar quantos já estão abertos no editor
      const openSkus = new Set(this.editor?.pages?.filter(p => p.sku).map(p => String(p.sku).trim()) || []);
      const newSkus = detectedSkus.filter(sku => !openSkus.has(sku));
      const alreadyOpenCount = detectedSkus.length - newSkus.length;

      if (countEl) {
        countEl.textContent = `${detectedSkus.length} código(s) detectado(s)`;
      }
      if (dupEl) {
        dupEl.textContent = alreadyOpenCount > 0 ? `(${alreadyOpenCount} já aberto(s) no editor)` : '';
      }

      if (chipsEl) {
        chipsEl.innerHTML = detectedSkus.map(sku => {
          const isAlready = openSkus.has(sku);
          const cls = isAlready ? 'batch-code-chip already-open' : 'batch-code-chip';
          const title = isAlready ? 'Já está aberto no editor (será mantido)' : 'Novo produto';
          return `<span class="${cls}" title="${title}">${sku}</span>`;
        }).join('');
      }

      if (btnExecute) {
        btnExecute.disabled = (newSkus.length === 0);
        if (btnExecuteLabel) {
          btnExecuteLabel.textContent = newSkus.length > 0 ? `Criar ${newSkus.length} Página(s)` : 'Itens já Abertos';
        }
      }
    };

    // Processamento de imagens de print com Gemini Vision direto na caixa de texto
    const processImageForSkus = async (imageBase64) => {
      if (!imageBase64 || isProcessingImage) return;
      const apiKey = this.settingsManager?.settings?.geminiApiKey;
      if (!apiKey) {
        this.showToast('Configure a chave da API Gemini nas Configurações para ler prints com IA.', 'warning');
        return;
      }

      try {
        isProcessingImage = true;
        textarea.readOnly = true;
        textarea.placeholder = 'Lendo print com Inteligência Artificial e extraindo códigos...';
        if (ocrLoading) ocrLoading.style.display = 'flex';

        const result = await window.api.gemini.extractSkus({ imageBase64, apiKey });
        const skus = result?.skus || [];

        if (skus.length > 0) {
          const currentText = textarea.value.trim();
          const newCodesText = skus.join('\n');
          textarea.value = currentText ? `${currentText}\n${newCodesText}` : newCodesText;
          updatePreview();
          this.showToast(`${skus.length} código(s) extraído(s) do print com sucesso!`, 'success');
        } else {
          this.showToast('Nenhum código de produto identificado no print.', 'warning');
        }
      } catch (err) {
        console.error('Erro ao extrair SKUs do print:', err);
        this.showToast(`Erro ao ler print: ${err.message || 'Falha na leitura'}`, 'error');
      } finally {
        isProcessingImage = false;
        textarea.readOnly = false;
        textarea.placeholder = defaultPlaceholder;
        if (ocrLoading) ocrLoading.style.display = 'none';
        if (window.lucide) window.lucide.createIcons();
      }
    };

    const handleImageFile = (file) => {
      if (!file || !file.type.startsWith('image/')) {
        this.showToast('O arquivo selecionado não é uma imagem válida.', 'warning');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result;
        processImageForSkus(base64);
      };
      reader.readAsDataURL(file);
    };

    // Interceptar colagem (Ctrl+V) de print na caixa de texto ou no modal
    const handlePaste = (e) => {
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      const items = clipboardData.items;
      let imageFile = null;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf('image') !== -1) {
            imageFile = items[i].getAsFile();
            break;
          }
        }
      }

      if (imageFile) {
        e.preventDefault();
        handleImageFile(imageFile);
        return;
      }

      setTimeout(updatePreview, 50);
    };

    btnOpen.addEventListener('click', openModal);
    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);
    btnClear?.addEventListener('click', () => {
      textarea.value = '';
      updatePreview();
    });

    textarea.addEventListener('input', updatePreview);
    textarea.addEventListener('paste', handlePaste);
    modal.addEventListener('paste', handlePaste);

    // Arrastar e soltar print diretamente na caixa de texto
    textarea.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      textarea.style.borderColor = 'var(--primary-color)';
    });

    textarea.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      textarea.style.borderColor = 'var(--border-color)';
    });

    textarea.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      textarea.style.borderColor = 'var(--border-color)';

      const files = e.dataTransfer.files;
      if (files && files.length > 0 && files[0].type.startsWith('image/')) {
        handleImageFile(files[0]);
      }
    });

    // Executar a criação em lote
    btnExecute?.addEventListener('click', async () => {
      const openSkus = new Set(this.editor?.pages?.filter(p => p.sku).map(p => String(p.sku).trim()) || []);
      const skusToCreate = detectedSkus.filter(sku => !openSkus.has(sku));
      
      if (skusToCreate.length === 0) return;

      closeModal();
      this.showToast(`Iniciando criação em lote de ${skusToCreate.length} produto(s)...`, 'info');
      this.setProgress(0, `0/${skusToCreate.length}`);

      let createdCount = 0;
      for (let i = 0; i < skusToCreate.length; i++) {
        const sku = skusToCreate[i];
        try {
          const pageId = this.editor.createPageSilent();
          const page = this.editor.getPage(pageId);
          if (page) {
            page.sku = sku;
            const input = document.querySelector(`.page-sku-input[data-page-id="${pageId}"]`);
            if (input) input.value = sku;
            
            // Busca dados completos no Sankhya (nome, marca, descrição e foto atual)
            await this.editor.buscarSkuSilent(pageId);
            createdCount++;
          }
        } catch (err) {
          console.error(`Erro ao criar página do SKU ${sku}:`, err);
        }
        this.setProgress(((i + 1) / skusToCreate.length) * 100, `${i + 1}/${skusToCreate.length}`);
      }

      this.setProgress(100, 'Concluído');
      setTimeout(() => this.setProgress(null), 2000);

      this.editor.updateAllPageNumbers();
      this.editor.cleanupInsertZones();
      this.editor.triggerAutosave(true);
      this.updateStatusBarQueueCount();

      this.showToast(`${createdCount} página(s) criada(s) e carregada(s) com sucesso!`, 'success');
    });
  }

  updateStatusBarQueueCount() {
    clearTimeout(this._statusCountDebounce);
    this._statusCountDebounce = setTimeout(() => {
      if (!this.editor || !this.editor.pages) return;
      if (typeof this.editor.updateTabBadge === 'function') {
        this.editor.updateTabBadge();
      }
      if (window.lucide) window.lucide.createIcons();
    }, 150);
  }
  
  setupUI() {
    // Clique no contador de itens a cadastrar para forçar atualização/recontagem
    document.getElementById('statusbar-queue-info')?.addEventListener('click', () => {
      this.updateStatusBarQueueCount();
      const countEl = document.getElementById('statusbar-queue-count');
      const text = countEl ? countEl.textContent : '';
      this.showToast(`Contador atualizado: ${text}`, 'info');
    });

    // Salvar síncrono antes de fechar a janela
    window.addEventListener('beforeunload', () => {
      if (this.editor) {
        this.editor.saveToLocalSync();
      }
    });

    // Versão
    if (window.api && window.api.app) {
      window.api.app.getVersion().then(v => {
        const verSpan = document.getElementById('app-version');
        if (verSpan) verSpan.textContent = `v${v}`;
      });
    }

    // Inicializar criação em lote
    this.setupBatchImportSystem();

    // Ouvir notificação da Fila de Trabalho (Sankhya)
    this._queueLoaded = false;
    console.log('[Queue] Registrando listeners de fila...');
    if (window.api && window.api.sankhya && window.api.sankhya.onQueueOpen) {
      window.api.sankhya.onQueueOpen((skus) => {
        console.log('[Queue] queue:open recebido com', skus?.length, 'SKUs');
        this.showView('editor');
        if (this.editor && typeof this.editor.loadQueue === 'function' && skus && skus.length > 0) {
          this.editor.loadQueue(skus);
        }
        if (window.api.sankhya.clearPendingQueue) window.api.sankhya.clearPendingQueue();
      });

      // Puxar SKUs pendentes que chegaram antes do renderer estar pronto
      const tryLoadPending = () => {
        if (this._queueLoaded) return;
        console.log('[Queue] Tentando puxar pendentes...');
        if (window.api.sankhya.getPendingQueue) {
          window.api.sankhya.getPendingQueue().then((skus) => {
            console.log('[Queue] getPendingQueue retornou:', skus);
            if (this._queueLoaded) return;
            if (skus && skus.length > 0) {
              this._queueLoaded = true;
              this.showView('editor');
              if (this.editor && typeof this.editor.loadQueue === 'function') {
                this.editor.loadQueue(skus);
              }
              if (window.api.sankhya.clearPendingQueue) window.api.sankhya.clearPendingQueue();
            }
          }).catch(err => console.error('[Queue] Erro getPendingQueue:', err));
        }
      };
      
      // Tenta imediatamente e depois de 5s e 10s
      tryLoadPending();
      setTimeout(tryLoadPending, 5000);
      setTimeout(tryLoadPending, 10000);
    } else {
      console.warn('[Queue] window.api.sankhya.onQueueOpen NÃO disponível!');
    }

    // Window controls
    document.getElementById('btn-minimize')?.addEventListener('click', () => window.api.window.minimize());
    document.getElementById('btn-maximize')?.addEventListener('click', () => window.api.window.maximize());
    document.getElementById('btn-close')?.addEventListener('click', () => window.api.window.close());

    // Menu system
    this.setupMenuSystem();
    
    // Binds de botoes gerais da tela upload
    document.getElementById('btn-select-images')?.addEventListener('click', async () => {
      if (window.api && window.api.files) {
        const paths = await window.api.files.openImages();
        if (paths && paths.length > 0) this.handleFiles(paths);
      }
    });
    
    // Fechar modais ao clicar fora
    window.addEventListener('click', (e) => {
      const modalSettings = document.getElementById('modal-settings');
      if (e.target === document.getElementById('modal-settings-backdrop')) {
        this.settingsManager.closeModal();
      }
    });

    // Seletor de cor de fundo do preview
    document.querySelectorAll('.preview-bg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        if (this.editor) this.editor.setBgColor(color);
        // Atualizar botão ativo
        document.querySelectorAll('.preview-bg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Sincronizar color picker
        const picker = document.getElementById('preview-bg-custom');
        if (picker) picker.value = color;
      });
    });

    const customPicker = document.getElementById('preview-bg-custom');
    if (customPicker) {
      customPicker.addEventListener('input', (e) => {
        const color = e.target.value;
        if (this.editor) this.editor.setBgColor(color);
        document.querySelectorAll('.preview-bg-btn').forEach(b => b.classList.remove('active'));
      });
    }

    // Lógica para Imagens de Referência OCR (Até 4 imagens por Produto/Página)
    const ocrDropzone = document.getElementById('ocr-dropzone');
    const btnRemoveOcr = document.getElementById('btn-remove-ocr');

    const addOcrImage = (base64) => {
      const page = this.editor?.getActiveMainPage();
      if (!page) return;
      if (!Array.isArray(page.ocrImages)) {
        page.ocrImages = page.ocrImageBase64 ? [page.ocrImageBase64] : [];
      }
      if (page.ocrImages.length >= 4) {
        this.showToast('Limite máximo de 4 imagens de referência atingido.', 'warning');
        return;
      }
      page.ocrImages.push(base64);
      page.ocrImageBase64 = page.ocrImages[0];
      this.editor.syncSidebarDescription();
      this.showToast(`Imagem de referência adicionada (${page.ocrImages.length}/4)!`, 'success');
    };

    this.removeOcrImageAt = (index) => {
      const page = this.editor?.getActiveMainPage();
      if (!page || !Array.isArray(page.ocrImages)) return;
      page.ocrImages.splice(index, 1);
      page.ocrImageBase64 = page.ocrImages[0] || null;
      this.editor.syncSidebarDescription();
    };

    btnRemoveOcr?.addEventListener('click', () => {
      const page = this.editor?.getActiveMainPage();
      if (page) {
        page.ocrImages = [];
        page.ocrImageBase64 = null;
      }
      this.editor.syncSidebarDescription();
      this.showToast('Imagens de referência removidas.', 'info');
    });

    // ATALHO: Clicar na caixa de referência cola automaticamente a imagem do Clipboard
    ocrDropzone?.addEventListener('click', async () => {
      // 1. Tentar ler do Electron nativo
      if (window.api?.clipboard?.readImage) {
        const base64 = await window.api.clipboard.readImage();
        if (base64) {
          addOcrImage(base64);
          return;
        }
      }
      // 2. Fallback pelo navigator.clipboard
      try {
        if (navigator.clipboard?.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
              const blob = await item.getType(imageType);
              const reader = new FileReader();
              reader.onload = (e) => addOcrImage(e.target.result);
              reader.readAsDataURL(blob);
              return;
            }
          }
        }
      } catch (err) {}
      this.showToast('Nenhuma imagem copiada. Copie uma imagem antes de clicar.', 'warning');
    });

    document.addEventListener('paste', (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        // Se estiver num input de texto, não roubar o paste a menos que seja imagem
      }
      
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (let item of items) {
        if (item.type.indexOf('image') === 0) {
          const blob = item.getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => addOcrImage(event.target.result);
          reader.readAsDataURL(blob);
          e.preventDefault();
          break;
        }
      }
    });

    ocrDropzone?.addEventListener('dragover', (e) => { e.preventDefault(); ocrDropzone.style.borderColor = 'var(--primary-color)'; });
    ocrDropzone?.addEventListener('dragleave', (e) => { e.preventDefault(); ocrDropzone.style.borderColor = 'var(--border-color)'; });
    ocrDropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      ocrDropzone.style.borderColor = 'var(--border-color)';
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => addOcrImage(event.target.result);
        reader.readAsDataURL(file);
      });
    });

    // Reescrever com Gemini
    const btnGerar = document.getElementById('btn-reescrever-ia');
    const divActionButtons = document.getElementById('ai-action-buttons');

    const handleGerarIA = async (btnClicked) => {
      const targetPage = this.editor.getActiveMainPage();
      if (!targetPage || targetPage._isGenerating) return;
      const textareaOriginal = document.getElementById('textarea-descricao-original');
      const textoOriginal = textareaOriginal?.value?.trim();
      const ocrList = Array.isArray(targetPage.ocrImages) && targetPage.ocrImages.length > 0
        ? targetPage.ocrImages
        : (targetPage.ocrImageBase64 ? [targetPage.ocrImageBase64] : []);

      if (!textoOriginal && ocrList.length === 0) { 
        this.showToast('Busque um SKU primeiro ou anexe imagens de referência (Bula/Rótulo)', 'warning'); 
        return; 
      }
      
      const settings = this.settingsManager.settings;
      if (!settings.geminiApiKey || !settings.geminiPrompt) {
        this.showToast('Configure Gemini nas Configurações primeiro', 'warning');
        return;
      }
      
      targetPage._isGenerating = true;
      this.editor.syncSidebarDescription();
      
      try {
        const result = await window.api.gemini.rewrite({
          text: textoOriginal,
          productName: targetPage.productName,
          apiKey: settings.geminiApiKey,
          prompt: settings.geminiPrompt,
          ocrImages: ocrList,
          ocrImageBase64: ocrList[0] || null
        });
        
        targetPage._isGenerating = false;
        
        if (result?.text) {
          targetPage.description = result.text;
          targetPage.hasChanges = true;
          this.showToast('Nova descri��o gerada para o item ' + targetPage.sku, 'success');
        }
      } catch (err) {
        targetPage._isGenerating = false;
        console.error(err);
        this.showToast('Erro ao reescrever: ' + err.message, 'error');
      }
      
      this.editor.syncSidebarDescription();
    };

    btnGerar?.addEventListener('click', () => handleGerarIA(btnGerar));
    
    // Salvar no Sankhya (publica a descrição original com correções manuais)
    document.getElementById('btn-salvar-sankhya')?.addEventListener('click', () => {
      this._salvarDescricaoSankhya('original');
    });
    
    // Publicar Versão IA no Sankhya (publica a nova descrição gerada pelo Gemini)
    document.getElementById('btn-publicar-sankhya')?.addEventListener('click', () => {
      this._salvarDescricaoSankhya('ia');
    });

    // Validar Marketing (agora executa o fluxo completo do produto: fotos + descrição + conclusão)
    document.getElementById('btn-concluir-mkt')?.addEventListener('click', () => {
      this._processarTudo();
    });

    // Botão Mágico: Processar Tudo
    document.getElementById('btn-magic-process')?.addEventListener('click', () => {
      this._processarTudo();
    });
  }

  async _processarTudo() {
    this._isProcessingAll = true;
    this._cancelProcessarTudo = false;
    const isManualTab = this.editor.activeTab === 'manual';
    // 1. Encontrar todos os SKUs da aba ativa que possuem alterações (hasChanges = true)
    const activePages = this.editor.pages.filter(p => isManualTab ? !p.fromQueue : p.fromQueue);
    const skusToProcess = [...new Set(activePages.filter(p => p.hasChanges && p.sku).map(p => p.sku))];
    
    if (skusToProcess.length === 0) {
      this.showToast(isManualTab ? 'Nenhum item modificado para salvar.' : 'Nenhum item modificado para salvar e validar.', 'warning');
      return;
    }

    const confirmMsg = isManualTab
      ? `Deseja exportar as fotos e salvar ${skusToProcess.length} produto(s) modificado(s)?`
      : `Deseja exportar as fotos, salvar e concluir a validação de ${skusToProcess.length} produto(s) modificado(s)?`;

    if (!confirm(confirmMsg)) {
      return;
    }

    this.showToast(`Iniciando salvamento para ${skusToProcess.length} produto(s)...`, 'info');

    const settings = this.settingsManager?.settings;
    if (!settings?.sankhyaSecret || !settings?.sankhyaToken) {
      this.showToast('Credenciais do Sankhya não configuradas.', 'error');
      return;
    }
    if (!isManualTab && (!settings?.sankhyaQueueField || !settings?.sankhyaQueueValue)) {
      this.showToast('Campos de Conclusão MKT não configurados.', 'error');
      return;
    }

    const env = settings.sankhyaEnvironment || 'sandbox';

    for (let index = 0; index < skusToProcess.length; index++) {
        if (this._cancelProcessarTudo) {
          this.showToast('Automação interrompida pelo usuário.', 'warning');
          break;
        }
      const currentSku = skusToProcess[index];
      const skuPages = this.editor.pages.filter(p => p.sku === currentSku);
      // Usar a página principal do SKU para pegar a descrição (se existir)
      const mainPage = skuPages.find(p => !p.variantIndex || p.variantIndex === 0) || skuPages[0];
      
      this.showToast(`Processando [${index + 1}/${skusToProcess.length}]: ${currentSku}...`, 'info');
      this.setProgress(((index + 1) / skusToProcess.length) * 100, `${index + 1}/${skusToProcess.length}`);

      try {
        // Passo 1: Exportar Imagens localmente
        const pagesWithImages = skuPages.filter(p => p.currentImage);
        const profiles = this.settingsManager.getActiveProfiles();
        const erpProfile = profiles.find(p => p.name?.toLowerCase().includes('sankhya') || (p.format === 'jpg' && p.width <= 400));
        const alternativeProfiles = profiles.filter(p => p !== erpProfile);
        
        for (const p of pagesWithImages) {
          const base64 = this.editor.getProcessedBase64(p.id);
          if (base64) {
            const isVariant = p.variantIndex && p.variantIndex > 0;
            if (isVariant) {
              // Variantes: salvas estritamente nos repositórios de Tablóide/Site (NUNCA no Sankhya ERP!)
              const filename = `${currentSku}_${p.variantIndex}`;
              const targetProfiles = alternativeProfiles.length > 0 ? alternativeProfiles : profiles;
              await this.exportManager.exportImage(base64, filename, targetProfiles);
            } else {
              // Foto principal: apenas um código (salva no Sankhya 300x300 e no Tablóide/Site)
              const filename = currentSku;
              await this.exportManager.exportImage(base64, filename, profiles);
            }
          }
        }
        // Passo 2: Upload FTP das imagens alternativas
        if (!settings.sankhyaFtpHost) {
           this.showToast('Erro: Host FTP não configurado nas Configurações! As imagens alternativas não podem ser enviadas.', 'error');
           throw new Error("FTP não configurado");
        }
        
        try {
          const ftpFiles = [];
          const sortedPages = [...pagesWithImages].sort((a, b) => (a.variantIndex || 0) - (b.variantIndex || 0));
          
          for (let i = 0; i < sortedPages.length; i++) {
            const p = sortedPages[i];
            const base64 = this.editor.getProcessedBase64(p.id);
            if (base64) {
              let fileName;
              if (i === 0) {
                fileName = `${currentSku}.png`;
              } else {
                const vIdx = p.variantIndex || (i + 1);
                fileName = `${currentSku}_${vIdx}.png`;
              }
              ftpFiles.push({ buffer: base64, fileName });
            }
          }
          
          if (ftpFiles.length > 0) {
            const ftpResult = await window.api.sankhya.uploadImagesFTP({ files: ftpFiles, settings });
            if (!ftpResult || !ftpResult.success) {
              throw new Error("Falha no upload FTP/SFTP");
            }
          }
        } catch (ftpErr) {
          console.error('Erro FTP:', ftpErr);
          this.showToast('Erro critico ao enviar imagens FTP para o SKU ' + currentSku + '. As imagens nao foram registradas.', 'error');
          continue; // Pula este SKU e nao registra as alternativas quebradas!
        }

        // Passo 3: Upload API da imagem principal
        try {
          if (mainPage && mainPage.currentImage) {
            const mainBase64 = this.editor.getProcessedBase64(mainPage.id);
            if (mainBase64) {
              await window.api.sankhya.uploadMainImage({
                imageBase64: mainBase64,
                codProd: currentSku,
                settings
              });
            }
          }
        } catch (apiErr) {
          console.error('Erro upload foto principal:', apiErr);
          this.showToast('Erro crítico na foto principal do SKU ' + currentSku + ': ' + apiErr.message, 'error');
          throw apiErr; // Aborta e impede de dar como concluído
        }

        // Passo 4: Registrar imagens alternativas na TGFIMAL
        const altImages = this._buildAlternativeImagesList(currentSku);
        if (altImages.length > 0) {
          await window.api.sankhya.saveAlternativeImages({
            sku: currentSku,
            images: altImages,
            secret: settings.sankhyaSecret,
            token: settings.sankhyaToken,
            environment: env,
            clientId: settings.sankhyaClientId,
            settings
          });
        }

        // Passo 5: Salvar Descrição IA
        if (mainPage && mainPage.description && mainPage.description.trim() !== '') {
          await window.api.sankhya.saveDescription({
            sku: currentSku,
            description: mainPage.description,
            secret: settings.sankhyaSecret,
            token: settings.sankhyaToken,
            environment: env,
            clientId: settings.sankhyaClientId
          });
        }

        // Passo 6: Validar MKT (somente se for item da fila Sankhya)
        const isFromQueue = skuPages.some(p => p.fromQueue);
        if (isFromQueue && settings.sankhyaQueueField && settings.sankhyaQueueValue) {
          await window.api.sankhya.markMarketingValidated({
            sku: currentSku,
            secret: settings.sankhyaSecret,
            token: settings.sankhyaToken,
            environment: env,
            clientId: settings.sankhyaClientId,
            queueField: settings.sankhyaQueueField,
            queueValue: settings.sankhyaQueueValue,
            codUsu: settings.sankhyaCodUsu || ''
          });
        }

        // Concluído para este SKU
        const skuItem = document.querySelector(`.sku-item[data-sku="${currentSku}"]`);
        if (skuItem) skuItem.remove();

        // Fechar as páginas deste SKU
        const groupId = mainPage.groupId || mainPage.id;
        const groupPagesIds = this.editor.pages.filter(p => p.groupId === groupId || p.id === groupId).map(p => p.id);
        
        if (groupPagesIds.length >= this.editor.pages.length) {
          // Se for deletar todas, limpa a última
          for (let i = groupPagesIds.length - 1; i >= 1; i--) {
            this.editor.deletePage(groupPagesIds[i]);
          }
          const lastPageId = groupPagesIds[0];
          const lastPage = this.editor.getPage(lastPageId);
          if (lastPage) {
            lastPage.currentImage = null;
            lastPage.originalImage = null;
            lastPage.sku = null;
            lastPage.description = null;
            lastPage.variantIndex = 0;
            lastPage.history = [];
            lastPage.historyIndex = -1;
            lastPage.hasChanges = false;
            if (lastPage.canvas) {
              lastPage.ctx.clearRect(0, 0, lastPage.canvas.width, lastPage.canvas.height);
            }
          }
          this.editor.syncSidebarSliders();
        } else {
          // Deleta as páginas
          for (const pid of groupPagesIds) {
            this.editor.deletePage(pid);
          }
        }

      } catch (err) {
        console.error(`Erro ao processar ${currentSku}:`, err);
        this.showToast(`Erro no produto ${currentSku}: ${err.message}`, 'error');
      }
    }

    this.setProgress(100, 'Concluído');
    setTimeout(() => this.setProgress(null), 2500);
    this.showToast(isManualTab ? `Salvo com sucesso para ${skusToProcess.length} produto(s)!` : `Automação concluída para ${skusToProcess.length} produto(s)!`, 'success');
    
    // Garantir que sempre existe pelo menos 1 pagina em branco
    if (this.editor.pages.length === 0 || !this.editor.pages.some(p => !p.sku)) {
      this.editor.createPage();
    }
  }
  
  async _salvarDescricaoSankhya(tipo) {
    const page = this.editor.getActiveMainPage();
    if (!page || !page.sku) {
      this.showToast('Busque um SKU primeiro', 'warning');
      return;
    }
    
    const textarea = tipo === 'original' 
      ? document.getElementById('textarea-descricao-original') 
      : document.getElementById('textarea-descricao');
    const texto = textarea?.value?.trim();
    
    if (!texto) {
      this.showToast(tipo === 'original' ? 'Descrição vazia' : 'Gere uma nova descrição primeiro', 'warning');
      return;
    }
    
    const settings = this.settingsManager?.settings;
    if (!settings?.sankhyaSecret || !settings?.sankhyaToken) {
      this.showToast('Configure as credenciais do Sankhya nas Configurações', 'warning');
      return;
    }
    
    const env = settings.sankhyaEnvironment || 'sandbox';
    const envLabel = env === 'prod' ? 'Produção' : 'Sandbox';
    const label = tipo === 'original' ? 'descrição editada' : 'descrição IA';
    // Sincronizar texto
    if (tipo === 'original') page.descriptionOriginal = texto;
    else page.description = texto;
    
    // Adicionar "Atualizado em: DD/MM/AAAA" no rodapé da descrição
    let textoFinal = texto.replace(/\n*Atualizado em: \d{2}\/\d{2}\/\d{4}$/m, '').trimEnd();
    const hoje = new Date();
    const dataFormatada = hoje.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    textoFinal += `\nAtualizado em: ${dataFormatada}`;
    
    this.showToast('Salvando no Sankhya...', 'info');
    
    try {
      const result = await window.api.sankhya.saveDescription({
        sku: page.sku,
        description: textoFinal,
        secret: settings.sankhyaSecret,
        token: settings.sankhyaToken,
        environment: env,
        clientId: settings.sankhyaClientId
      });
      
      try {
        if (window.api?.history?.add) {
          const sysUser = await window.api?.system?.getUsername?.() || '';
          const resolvedUser = settings.sankhyaNomeUsu || (settings.sankhyaCodUsu ? `Usuário ${settings.sankhyaCodUsu}` : sysUser) || 'Usuário';
          await window.api.history.add({
            sku: page.sku,
            productName: page.productName || '',
            brand: page.brand || '',
            userName: resolvedUser,
            changes: { description: true },
            changesSummary: tipo === 'original' ? 'Descrição (Manual)' : 'Descrição (IA)'
          });
        }
      } catch (e) {}

      this.showToast(`Salvo no Sankhya com sucesso! (${envLabel})`, 'success');
    } catch (err) {
      console.error('Erro salvar Sankhya:', err);
      this.showToast('Erro ao salvar: ' + err.message, 'error');
    }
  }

  async _validarMarketing() {
    const page = this.editor.getActiveMainPage();
    if (!page || !page.sku) {
      this.showToast('Busque um SKU primeiro', 'warning');
      return;
    }

    const settings = this.settingsManager?.settings;
    if (!settings?.sankhyaSecret || !settings?.sankhyaToken) {
      this.showToast('Configure as credenciais do Sankhya nas Configurações', 'warning');
      return;
    }
    
    if (!settings?.sankhyaQueueField || !settings?.sankhyaQueueValue) {
      this.showToast('Configure os campos de Conclusão MKT nas configurações da Fila de Trabalho', 'warning');
      return;
    }

    if (!confirm(`Marcar o produto ${page.sku} como Validado pelo Marketing no Sankhya?`)) {
      return;
    }

    this.showToast('Validando no Sankhya...', 'info');
    
    try {
      await window.api.sankhya.markMarketingValidated({
        sku: page.sku,
        secret: settings.sankhyaSecret,
        token: settings.sankhyaToken,
        environment: settings.sankhyaEnvironment || 'sandbox',
        clientId: settings.sankhyaClientId,
        queueField: settings.sankhyaQueueField,
        queueValue: settings.sankhyaQueueValue,
        codUsu: settings.sankhyaCodUsu || ''
      });
      
      this.showToast(`Produto ${page.sku} validado com sucesso!`, 'success');
      
      // Item validado com sucesso: remove da tela automaticamente!
      setTimeout(() => {
        this.editor.removeProduct(page.sku);
      }, 500);
      
    } catch (err) {
      console.error('Erro validar marketing:', err);
      this.showToast('Erro ao validar MKT: ' + err.message, 'error');
    }
  }

  showView(viewName) {
    Object.keys(this.views).forEach(key => {
      if (this.views[key]) {
        if (key === viewName) {
          this.views[key].classList.add('active');
          this.views[key].style.display = 'block'; // ou display padrão dependendo do CSS
        } else {
          this.views[key].classList.remove('active');
          this.views[key].style.display = 'none';
        }
      }
    });
  }
  
  setupDragDrop() {
    const dropzone = document.getElementById('upload-dropzone');
    const editorMain = document.querySelector('.editor-main');
    
    // We bind drag events to both dropzone and editorMain
    const dropTargets = [];
    if (dropzone) dropTargets.push(dropzone);
    if (editorMain) dropTargets.push(editorMain);
    
    if (dropTargets.length === 0) return;
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropTargets.forEach(target => target.addEventListener(eventName, preventDefaults, false));
      document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
      dropTargets.forEach(target => {
        target.addEventListener(eventName, () => {
          target.classList.add('drag-over');
        });
      });
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
      dropTargets.forEach(target => {
        target.addEventListener(eventName, () => {
          target.classList.remove('drag-over');
        });
      });
    });
    
    dropTargets.forEach(target => {
      target.addEventListener('drop', async (e) => {
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      
      // CASO 1: Arquivos locais arrastados do Explorer (têm .path)
      if (files.length > 0 && files[0].path) {
        const paths = files.map(f => f.path);
        this.handleFiles(paths);
        return;
      }
      
      // CASO 2: Imagem arrastada do navegador como blob (tem arquivo mas sem path)
      if (files.length > 0 && !files[0].path) {
        this.showToast('Carregando imagem do navegador...', 'info');
        try {
          const file = files[0];
          const base64 = await this._fileToBase64(file);
          
          let finalBase64 = await this.validateAndUpscaleImage(base64);
          if (!finalBase64) return;
          
          await this.editor.loadImage({
            base64: finalBase64,
            filePath: file.name || 'imagem_web.jpg',
            format: file.type.split('/')[1] || 'jpeg'
          });
          this.showView('editor');
          this.showToast('Imagem carregada com sucesso!', 'success');
          // Auto remover fundo
          setTimeout(() => {
            if (this.editor && this.editor.removeBackground) {
              this.editor.removeBackground();
            }
          }, 300);
        } catch (err) {
          console.error('Erro ao ler imagem do navegador:', err);
          this.showToast('Erro ao carregar imagem', 'error');
        }
        return;
      }
      
      // CASO 3: URL arrastada (sem arquivo, só link)
      let imageUrl = null;
      
      // Verificar text/uri-list
      const uriList = e.dataTransfer.getData('text/uri-list');
      if (uriList && (uriList.startsWith('http://') || uriList.startsWith('https://'))) {
        imageUrl = uriList.split('\n')[0].trim();
      }
      
      // Verificar text/plain como fallback
      if (!imageUrl) {
        const textData = e.dataTransfer.getData('text/plain');
        if (textData && (textData.startsWith('http://') || textData.startsWith('https://'))) {
          imageUrl = textData.trim();
        }
      }
      
      // Verificar HTML para extrair src de img
      if (!imageUrl) {
        const htmlData = e.dataTransfer.getData('text/html');
        if (htmlData) {
          const match = htmlData.match(/src=["']([^"']+)["']/);
          if (match && match[1] && (match[1].startsWith('http://') || match[1].startsWith('https://'))) {
            imageUrl = match[1];
          }
        }
      }
      
      if (imageUrl && window.api && window.api.files) {
        this.showToast('Baixando imagem da internet...', 'info');
        try {
          const data = await window.api.files.downloadFromUrl(imageUrl);
          
          let finalBase64 = await this.validateAndUpscaleImage(data.base64);
          if (!finalBase64) return;
          
          await this.editor.loadImage({
            base64: finalBase64,
            filePath: data.filePath,
            format: data.format || 'jpg'
          });
          this.showView('editor');
          this.showToast('Imagem carregada com sucesso!', 'success');
          // Auto remover fundo
          setTimeout(() => {
            if (this.editor && this.editor.removeBackground) {
              this.editor.removeBackground();
            }
          }, 300);
        } catch (err) {
          console.error('Erro ao baixar imagem:', err);
          this.showToast('Erro ao baixar imagem da internet', 'error');
        }
      } else {
        this.showToast('Formato não suportado. Arraste uma imagem ou URL.', 'warning');
      }
    });
    });
  }

  setupMenuSystem() {
    // Toggle menu dropdowns
    document.querySelectorAll('.menu-item > span').forEach(span => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const menuItem = span.parentElement;
        const wasOpen = menuItem.classList.contains('open');
        
        // Close all menus
        document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
        
        // Toggle clicked menu
        if (!wasOpen) menuItem.classList.add('open');
      });
    });
    
    // Hover to switch between menus when one is open
    document.querySelectorAll('.menu-item > span').forEach(span => {
      span.addEventListener('mouseenter', () => {
        const anyOpen = document.querySelector('.menu-item.open');
        if (anyOpen) {
          document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
          span.parentElement.classList.add('open');
        }
      });
    });
    
    // Close menus when clicking outside
    document.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
    });
    
    // Prevent dropdown clicks from closing menu
    document.querySelectorAll('.menu-dropdown').forEach(dd => {
      dd.addEventListener('click', (e) => e.stopPropagation());
    });
    
    // Menu actions
    document.getElementById('menu-abrir-imagens')?.addEventListener('click', async () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      const el = document.getElementById('btn-select-images');
      if (el) el.click();
    });
    
    document.getElementById('menu-abrir-pasta')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      const el = document.getElementById('btn-select-folder');
      if (el) el.click();
    });
    
    document.getElementById('menu-exportar')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      const el = document.getElementById('btn-export');
      if (el) el.click();
    });
    
    document.getElementById('menu-configuracoes')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      const el = document.getElementById('btn-open-settings');
      if (el) el.click();
    });

    document.getElementById('menu-relatorio-itens')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      this.openReportModal();
    });
    
    document.getElementById('menu-desfazer')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (this.editor) this.editor.undo();
    });
    
    document.getElementById('menu-refazer')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (this.editor) this.editor.redo();
    });
    
    document.getElementById('menu-remover-fundo')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (this.editor) this.editor.removeBackground();
    });

    // Botão "Remover Fundo" / "Desfazer Remoção" na sidebar esquerda (Pincéis IA)
    document.getElementById('btn-remove-bg-manual')?.addEventListener('click', () => {
      if (!this.editor) return;
      const page = this.editor.getActivePage();
      if (page && page._bgRemoved) {
        this.editor.undoRemoveBackground();
      } else {
        this.editor.removeBackground();
      }
    });

    // Botão "Varinha Mágica" na barra vertical
    document.getElementById('btn-magic-wand')?.addEventListener('click', () => {
      if (this.editor) this.editor.toggleMagicWand();
    });
    
    document.getElementById('menu-remover-fundo-objeto')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (this.editor) this.editor.removeBackground(null, true);
    });
    
    document.getElementById('menu-remover-fundo-embalagem')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (this.editor) this.editor.removeBackgroundPackaging();
    });
    
    document.getElementById('menu-resetar')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (this.editor) this.editor.resetAdjustments();
    });
    
    document.getElementById('menu-zoom-in')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (this.editor) this.editor.setTransform('zoom', Math.min(500, (this.editor.transform?.zoom || 100) + 10));
    });
    
    document.getElementById('menu-zoom-out')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (this.editor) this.editor.setTransform('zoom', Math.max(10, (this.editor.transform?.zoom || 100) - 10));
    });
    
    document.getElementById('menu-zoom-reset')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (this.editor) this.editor.setTransform('zoom', 100);
    });
    
    document.getElementById('menu-ver-original')?.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      const btn = document.getElementById('btn-compare');
      if (btn) btn.click();
    });

    document.getElementById('menu-abrir-manual')?.addEventListener('click', async () => {
      document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('open'));
      if (window.api && window.api.app && window.api.app.openManual) {
        await window.api.app.openManual();
      }
    });
  }
  
  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  
  async handleFiles(filePaths) {
    if (!filePaths || filePaths.length === 0) return;
    
    // Cada imagem cria uma página
    for (const filePath of filePaths) {
      if (window.api && window.api.files) {
        try {
          const data = await window.api.files.readImageAsBase64(filePath);
          
          let finalBase64 = await this.validateAndUpscaleImage(data.base64);
          if (!finalBase64) continue;
          
          await this.editor.loadImage({
            base64: finalBase64,
            filePath: filePath,
            format: data.format || 'jpg'
          });
          this.showView('editor');
          // Auto remover fundo da última página criada
          setTimeout(() => {
            if (this.editor && this.editor.removeBackground) {
              this.editor.removeBackground();
            }
          }, 300);
        } catch (e) {
          console.error('Erro ao ler imagem:', e);
          this.showToast('Erro ao carregar imagem', 'error');
        }
      }
    }
  }
  
    async exportPage(pageId, exportType = 'all') {
    const page = this.editor.getPage(pageId);
    if (!page) return;

    const sku = page.sku ? String(page.sku).trim() : '';

    // =========================================================================
    // BOTÃO "VALIDAR" (data-export-type="validate_only"):
    // Função: SOMENTE valida pelo marketing o item no estado que está!
    // Não mexe em foto, não sobe FTP, apenas valida no Sankhya e remove da tela!
    // =========================================================================
    if (exportType === 'validate_only') {
      if (!sku) {
        this.showToast('Página sem SKU para validar', 'warning');
        return;
      }
      const settings = this.settingsManager?.settings;
      if (!settings?.sankhyaSecret || !settings?.sankhyaToken) {
        this.showToast('Credenciais do Sankhya não configuradas', 'error');
        return;
      }
      if (!settings?.sankhyaQueueField || !settings?.sankhyaQueueValue) {
        this.showToast('Configure os campos de Conclusão MKT nas configurações', 'warning');
        return;
      }
      try {
        this.showToast(`Validando produto ${sku} no Sankhya...`, 'info');
        await window.api.sankhya.markMarketingValidated({
          sku,
          secret: settings.sankhyaSecret,
          token: settings.sankhyaToken,
          environment: settings.sankhyaEnvironment || 'sandbox',
          clientId: settings.sankhyaClientId,
          queueField: settings.sankhyaQueueField,
          queueValue: settings.sankhyaQueueValue,
          codUsu: settings.sankhyaCodUsu || ''
        });
        this.showToast(`Produto ${sku} validado com sucesso!`, 'success');
        setTimeout(() => {
          this.editor.removeProduct(sku);
        }, 500);
      } catch (err) {
        console.error(`Erro ao validar ${sku}:`, err);
        this.showToast(`Erro ao validar: ${err.message}`, 'error');
      }
      return;
    }

    if (!page.currentImage) {
      this.showToast('Página sem imagem para exportar', 'warning');
      return;
    }

    // =========================================================================
    // EXPORTAÇÃO DE VARIANTE INDIVIDUAL (Página com variantIndex > 0)
    // Função: Exporta a imagem da variante estritamente para os repositórios
    // cadastrados no sistema (Tablóide/Site), NUNCA para a pasta do Sankhya!
    // =========================================================================
    if (page.variantIndex && page.variantIndex > 0) {
      const base64 = this.editor.getProcessedBase64(pageId);
      const profiles = this.settingsManager.getActiveProfiles();
      const erpProfile = profiles.find(p => p.name?.toLowerCase().includes('sankhya') || (p.format === 'jpg' && p.width <= 400));
      const alternativeProfiles = profiles.filter(p => p !== erpProfile);
      const targetProfiles = alternativeProfiles.length > 0 ? alternativeProfiles : profiles;

      const filename = sku ? `${sku}_${page.variantIndex}` : `variante_${page.id}`;
      await this.exportManager.exportImage(base64, filename, targetProfiles);
      this.showToast(`Variante ${page.variantIndex} exportada para os repositórios cadastrados!`, 'success');
      return;
    }

    // =========================================================================
    // BOTÃO "PRINCIPAL" (data-export-type="sankhya"):
    // Função: SOMENTE trocar a foto principal do Sankhya (300x300 JPG fundo branco)!
    // JAMAIS mexe nas alternativas, JAMAIS mexe em FTP do site, JAMAIS valida!
    // =========================================================================
    if (exportType === 'sankhya') {
      if (!sku) {
        this.showToast('Digite um código SKU para enviar a foto principal', 'warning');
        return;
      }
      await this.processSingleSku(sku, { main: true, alternatives: false, validate: false, removeFromEditor: false });
      return;
    }

    // =========================================================================
    // BOTÃO "ALTERNATIVAS" (data-export-type="tabloide"):
    // Função: SÓ subir as alternativas no Sankhya (FTP + TGFIMAL) e no diretório cadastrado!
    // JAMAIS trocar a foto principal do Sankhya e JAMAIS validar!
    // =========================================================================
    if (exportType === 'tabloide') {
      if (!sku) {
        this.showToast('Digite um código SKU para exportar as alternativas', 'warning');
        return;
      }
      await this.processSingleSku(sku, { main: false, alternatives: true, validate: false, removeFromEditor: false });
      return;
    }

    // =========================================================================
    // BOTÃO "SALVAR E VALIDAR" (data-export-type="all"):
    // Função: Executa Principal + Alternativas + Salva Descrição IA + Valida no Sankhya + Remove da tela!
    // =========================================================================
    if (exportType === 'all') {
      if (!sku) {
        const base64 = this.editor.getProcessedBase64(pageId);
        const profiles = this.settingsManager.getActiveProfiles();
        await this.exportManager.exportImage(base64, `pagina_${page.id}`, profiles);
        this.showToast('Imagem exportada localmente com sucesso!', 'success');
        return;
      }
      const shouldValidate = !!page.fromQueue;
      await this.processSingleSku(sku, { main: true, alternatives: true, validate: shouldValidate, removeFromEditor: true });
    }
  }

  /**
   * Executa todo o fluxo de automação para um SKU específico:
   * 1. Exporta imagens locais
   * 2. Envia via FTP
   * 3. Atualiza imagem principal no Sankhya
   * 4. Registra imagens alternativas na TGFIMAL
   * 5. Salva descrição IA (se houver)
   * 6. Valida o item no Sankhya (se options.validate)
   * 7. Remove da tela (se options.removeFromEditor)
   */
  async processSingleSku(sku, options = { main: true, alternatives: true, validate: true, removeFromEditor: true }) {
    const cleanSku = String(sku || '').trim();
    if (!cleanSku) {
      this.showToast('SKU inválido para processar', 'warning');
      return false;
    }

    const skuPages = this.editor.pages.filter(p => String(p.sku || '').trim() === cleanSku);
    if (skuPages.length === 0) {
      this.showToast(`Nenhuma página encontrada para o SKU ${cleanSku}`, 'warning');
      return false;
    }

    const settings = this.settingsManager?.settings;
    if (!settings?.sankhyaSecret || !settings?.sankhyaToken) {
      this.showToast('Configure as credenciais do Sankhya nas Configurações', 'error');
      return false;
    }

    const env = settings.sankhyaEnvironment || 'sandbox';
    const mainPage = skuPages.find(p => !p.variantIndex || p.variantIndex === 0) || skuPages[0];
    
    // VARIANTES: Somente páginas com variantIndex > 0 que NÃO sejam a página principal!
    const variantPages = skuPages.filter(p => p !== mainPage && p.variantIndex && p.variantIndex > 0);
    variantPages.sort((a, b) => a.variantIndex - b.variantIndex);

    const profiles = this.settingsManager.getActiveProfiles();
    const erpProfile = profiles.find(p => p.name?.toLowerCase().includes('sankhya') || (p.format === 'jpg' && p.width <= 400));
    const alternativeProfiles = profiles.filter(p => p !== erpProfile);
    const siteProfile = alternativeProfiles.find(p => p.name?.toLowerCase().includes('tabl') || p.name?.toLowerCase().includes('site') || p.format === 'png') || alternativeProfiles[0] || profiles[0];

    // =========================================================================
    // 1. FOTO PRINCIPAL SANKHYA: 300x300 JPG com fundo branco
    //    Executado SOMENTE se options.main === true!
    // =========================================================================
    if (options.main && mainPage && mainPage.currentImage) {
      this.showToast(`Atualizando foto principal do SKU ${cleanSku} no Sankhya...`, 'info');
      const mainBase64 = this.editor.getProcessedBase64(mainPage.id);
      if (mainBase64) {
        if (erpProfile) {
          try {
            await window.api.files.exportToProfile({
              base64: mainBase64,
              fileName: cleanSku,
              profile: erpProfile
            });
          } catch(e) { console.error('Erro exportar perfil ERP:', e); }
        }

        try {
          await window.api.sankhya.uploadMainImage({
            imageBase64: mainBase64,
            codProd: cleanSku,
            settings
          });
          this.showToast('Foto principal (300x300 JPG) atualizada no Sankhya!', 'success');
        } catch (mainErr) {
          console.error('Erro crítico ao atualizar foto principal:', mainErr);
          this.showToast('Erro ao atualizar foto principal: ' + mainErr.message, 'error');
          throw mainErr; // Impede validação e remoção se a imagem principal falhou!
        }
      }
    }

    // =========================================================================
    // 2. FOTOS ALTERNATIVAS (SITE E TABLÓIDE/CATÁLOGO)
    //    Executado SOMENTE se options.alternatives === true!
    //    JAMAIS toca na foto principal do Sankhya!
    // =========================================================================
    if (options.alternatives) {
      this.showToast(`Processando imagens alternativas do SKU ${cleanSku}...`, 'info');
      const ftpFiles = [];
      const altImages = [];

      // 2.1 Imagem alternativa da página principal: apenas um código {SKU}.png
      if (mainPage && mainPage.currentImage) {
        const mainBase64 = this.editor.getProcessedBase64(mainPage.id);
        if (mainBase64) {
          const mainAltFileName = `${cleanSku}.png`;
          const mainAltFileBase = cleanSku;

          // Salvar cópia no diretório cadastrado de Tablóide/Catálogo e obter a imagem nas dimensões exatas do perfil
          let processedAltBase64 = mainBase64;
          const targetProfiles = alternativeProfiles.length > 0 ? alternativeProfiles : [siteProfile];
          for (const altProf of targetProfiles) {
            try {
              const expRes = await window.api.files.exportToProfile({
                base64: mainBase64,
                fileName: mainAltFileBase,
                profile: altProf
              });
              if (expRes && expRes.base64) {
                processedAltBase64 = expRes.base64;
              }
            } catch(e) { console.error('Erro exportar perfil Tabloide:', e); }
          }

          ftpFiles.push({ buffer: processedAltBase64, fileName: mainAltFileName });
          altImages.push({ fileName: mainAltFileName });
        }
      }

      // 2.2 Imagens alternativas de variantes (SE E SOMENTE SE houver variantes inseridas no item)
      for (let i = 0; i < variantPages.length; i++) {
        const vp = variantPages[i];
        if (vp.currentImage) {
          const vBase64 = this.editor.getProcessedBase64(vp.id);
          if (vBase64) {
            const vIdx = vp.variantIndex || (i + 2);
            const vFileName = `${cleanSku}_${vIdx}.png`;
            const vFileBase = `${cleanSku}_${vIdx}`;

            let processedVariantBase64 = vBase64;
            const targetProfiles = alternativeProfiles.length > 0 ? alternativeProfiles : [siteProfile];
            for (const altProf of targetProfiles) {
              try {
                const expRes = await window.api.files.exportToProfile({
                  base64: vBase64,
                  fileName: vFileBase,
                  profile: altProf
                });
                if (expRes && expRes.base64) {
                  processedVariantBase64 = expRes.base64;
                }
              } catch(e) { console.error('Erro exportar variante Tabloide:', e); }
            }

            ftpFiles.push({ buffer: processedVariantBase64, fileName: vFileName });
            altImages.push({ fileName: vFileName });
          }
        }
      }

      // Upload FTP das fotos alternativas para o site rigorosamente no tamanho do perfil
      if (settings.sankhyaFtpHost && ftpFiles.length > 0) {
        try {
          const ftpResult = await window.api.sankhya.uploadImagesFTP({ files: ftpFiles, settings, profile: siteProfile });
          if (ftpResult && ftpResult.success) {
            this.showToast(`${ftpFiles.length} foto(s) alternativa(s) enviada(s) ao FTP!`, 'info');
          }
        } catch (ftpErr) {
          console.error('Erro FTP:', ftpErr);
          this.showToast('Aviso FTP: ' + ftpErr.message, 'warning');
        }
      }

      // Gravar Imagens Alternativas na TGFIMAL do Sankhya
      if (altImages.length > 0) {
        try {
          const altResult = await window.api.sankhya.saveAlternativeImages({
            sku: cleanSku,
            images: altImages,
            secret: settings.sankhyaSecret,
            token: settings.sankhyaToken,
            environment: env,
            clientId: settings.sankhyaClientId,
            settings
          });
          if (altResult && altResult.success) {
            this.showToast(`${altImages.length} imagem(ns) alternativa(s) salva(s) no Sankhya!`, 'success');
          }
        } catch (altErr) {
          console.error('Erro TGFIMAL:', altErr);
          this.showToast('Aviso TGFIMAL: ' + altErr.message, 'warning');
        }
      }
    }

    // =========================================================================
    // 3. SALVAR DESCRIÇÃO IA SE HOUVER
    // =========================================================================
    const currentActive = this.editor.getActivePage();
    const isMainActive = currentActive && (currentActive.id === mainPage.id || String(currentActive.sku).trim() === cleanSku);
    const sidebarText = isMainActive ? (document.getElementById('textarea-descricao')?.value || '') : '';
    const descToSave = (mainPage.description || sidebarText || '').trim();

    if (descToSave !== '') {
      mainPage.description = descToSave;
      try {
        await window.api.sankhya.saveDescription({
          sku: cleanSku,
          description: descToSave,
          secret: settings.sankhyaSecret,
          token: settings.sankhyaToken,
          environment: env,
          clientId: settings.sankhyaClientId
        });
        this.showToast(`Descrição do SKU ${cleanSku} salva no Sankhya!`, 'info');
      } catch (descErr) {
        console.error('Erro ao salvar descrição:', descErr);
        this.showToast('Erro ao salvar descrição: ' + descErr.message, 'error');
        throw descErr;
      }
    }

    // =========================================================================
    // 4. VALIDAR MKT NO SANKHYA (Somente se options.validate for true)
    // =========================================================================
    if (options.validate) {
      if (settings.sankhyaQueueField && settings.sankhyaQueueValue) {
        try {
          await window.api.sankhya.markMarketingValidated({
            sku: cleanSku,
            secret: settings.sankhyaSecret,
            token: settings.sankhyaToken,
            environment: env,
            clientId: settings.sankhyaClientId,
            queueField: settings.sankhyaQueueField,
            queueValue: settings.sankhyaQueueValue,
            codUsu: settings.sankhyaCodUsu || ''
          });
          this.showToast(`Produto ${cleanSku} VALIDADO com sucesso no Sankhya!`, 'success');
        } catch (valErr) {
          console.error('Erro validar marketing:', valErr);
          this.showToast('Erro ao validar no Sankhya: ' + valErr.message, 'error');
          return false;
        }
      }
    } else {
      this.showToast(`Produto ${cleanSku} salvo com sucesso!`, 'success');
    }

    // =========================================================================
    // 5. REGISTRAR NO HISTÓRICO DE ALTERAÇÕES
    // =========================================================================
    try {
      if (window.api?.history?.add) {
        const changesList = [];
        if (options.main && mainPage?.currentImage) changesList.push('Foto Principal');
        if (options.alternatives && variantPages.length > 0) {
          changesList.push(variantPages.length === 1 ? '1 Alternativa' : `${variantPages.length} Alternativas`);
        }
        if (descToSave) changesList.push('Descrição');
        if (options.validate) changesList.push('Validação');

        const sysUser = await window.api?.system?.getUsername?.() || '';
        const resolvedUser = settings.sankhyaNomeUsu || (settings.sankhyaCodUsu ? `Usuário ${settings.sankhyaCodUsu}` : sysUser) || 'Usuário';

        await window.api.history.add({
          sku: cleanSku,
          productName: mainPage?.productName || '',
          brand: mainPage?.brand || '',
          userName: resolvedUser,
          changes: {
            mainPhoto: !!(options.main && mainPage?.currentImage),
            altPhotosCount: variantPages.length,
            description: !!descToSave,
            validated: !!options.validate
          },
          changesSummary: changesList.join(', ') || 'Atualização'
        });
      }
    } catch (histErr) {
      console.warn('[History] Falha ao registrar histórico:', histErr);
    }

    // =========================================================================
    // 6. REMOVER DA TELA (se options.removeFromEditor for true)
    // =========================================================================
    if (options.removeFromEditor) {
      setTimeout(() => {
        this.editor.removeProduct(cleanSku);
      }, 500);
    }

    return true;
  }

  
  async exportAllPages() {
    const pagesWithImages = this.editor.pages.filter(p => p.currentImage);
    if (pagesWithImages.length === 0) {
      this.showToast('Nenhuma página com imagem para exportar', 'warning');
      return;
    }
    
    let exported = 0;
    const profiles = this.settingsManager.getActiveProfiles();
    const erpProfile = profiles.find(p => p.name?.toLowerCase().includes('sankhya') || (p.format === 'jpg' && p.width <= 400));
    const alternativeProfiles = profiles.filter(p => p !== erpProfile);
    
    for (const page of pagesWithImages) {
      const base64 = this.editor.getProcessedBase64(page.id);
      const isVariant = page.variantIndex && page.variantIndex > 0;
      const cleanSku = page.sku ? String(page.sku).trim() : '';

      if (isVariant) {
        // Variantes: salvas estritamente nos repositórios cadastrados (Tablóide/Site), NUNCA no Sankhya ERP!
        const filename = cleanSku ? `${cleanSku}_${page.variantIndex}` : `variante_${page.id}`;
        const targetProfiles = alternativeProfiles.length > 0 ? alternativeProfiles : profiles;
        await this.exportManager.exportImage(base64, filename, targetProfiles);
      } else {
        // Foto principal: salva com apenas um código
        const filename = cleanSku ? cleanSku : `pagina_${page.id}`;
        await this.exportManager.exportImage(base64, filename, profiles);
      }
      exported++;
      this.setProgress((exported / pagesWithImages.length) * 100, `${exported}/${pagesWithImages.length}`);
    }
    
    // Registrar na TGFIMAL para cada SKU único
    const settings = this.settingsManager?.settings;
    if (settings?.sankhyaSecret && settings?.sankhyaToken) {
      const skus = [...new Set(pagesWithImages.filter(p => p.sku).map(p => p.sku))];
      for (const sku of skus) {
        try {
          const altImages = this._buildAlternativeImagesList(sku);
          if (altImages.length > 0) {
            await window.api.sankhya.saveAlternativeImages({
              sku,
              images: altImages,
              secret: settings.sankhyaSecret,
              token: settings.sankhyaToken,
              environment: settings.sankhyaEnvironment || 'sandbox',
              clientId: settings.sankhyaClientId
            });
          }
        } catch (err) {
          console.error(`Erro TGFIMAL para SKU ${sku}:`, err);
        }
      }
    }
    
    this.setProgress(100, 'Concluído');
    setTimeout(() => this.setProgress(null), 2000);
    this.showToast(`${exported} página(s) exportada(s)!`, 'success');
  }
  
  /**
   * Monta a lista de imagens alternativas para registrar na TGFIMAL
   * - Página principal (variantIndex 0) → {SKU}.png (Imagem Alternativa #1)
   * - Variantes extras (variantIndex 1, 2...) → {SKU}_{variantIndex}.png (Alt #2, #3...)
   */
  _buildAlternativeImagesList(sku) {
    const cleanSku = String(sku || '').trim();
    const skuPages = this.editor.pages.filter(p => String(p.sku || '').trim() === cleanSku && p.currentImage);
    if (skuPages.length === 0) return [];
    
    const images = [];
    
    // Ordenar: principal primeiro (variantIndex 0 ou undefined), depois variantes
    skuPages.sort((a, b) => (a.variantIndex || 0) - (b.variantIndex || 0));
    
    skuPages.forEach((page, idx) => {
      let fileName;
      if (idx === 0) {
        // Imagem principal → alternativa #1
        fileName = `${cleanSku}.png`;
      } else {
        // Variantes extras → alternativa #2, #3...
        const vIdx = page.variantIndex || (idx + 1);
        fileName = `${cleanSku}_${vIdx}.png`;
      }
      images.push({ fileName });
    });
    
    return images;
  }
  
  async applyPostImageRemoval(pageId, base64, bgMode = 'auto') {
    if (bgMode === 'none') {
      this.editor.fitAndCenterImage(pageId);
      this.showToast('Imagem em alta resolução mantida e centralizada!', 'success');
      return;
    }

    let finalMode = bgMode;
    if (finalMode === 'auto') {
      try {
        const pageRef = this.editor.getPage(pageId);
        const apiKey = this.settingsManager?.settings?.geminiApiKey || '';
        const detectRes = await window.api.image.detectMode({
          base64Data: base64,
          productName: pageRef?.productName || '',
          apiKey: apiKey
        });
        finalMode = detectRes?.mode || 'object';
      } catch (e) {
        finalMode = 'object';
      }
    }

    if (finalMode === 'packaging') {
      this.showToast('Embalagem detectada: preservando cartela e textos!', 'info');
      await this.editor.removeBackgroundPackaging(pageId);
      return;
    }

    // finalMode === 'object'
    setTimeout(async () => {
      const p = this.editor.getPage(pageId);
      if (p && p.currentImage) {
        const isTransparent = await this.editor.hasTransparency(p.currentImage);
        if (isTransparent) {
          this.showToast('Imagem já possui fundo transparente', 'info');
        } else {
          this.editor.removeBackground(pageId, true);
        }
      }
    }, 300);
  }

  async handleDropOnPage(pageId, e) {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    
    if (files.length > 0 && files[0].path) {
      const data = await window.api.files.readImageAsBase64(files[0].path);
      const upscaleResult = await this.validateAndUpscaleImage(data.base64);
      if (!upscaleResult) return;
      const finalBase64 = typeof upscaleResult === 'string' ? upscaleResult : upscaleResult.base64;
      const shouldAutoRemoveBg = upscaleResult?.removeBg !== false;
      const isUpscaled = !!upscaleResult?.isUpscaled;

      await this.editor.loadImageToPage(pageId, {
        base64: finalBase64, filePath: files[0].path, format: data.format || 'jpg'
      });

      const page = this.editor.getPage(pageId);
      if (page) {
        page._isUpscaled = isUpscaled;
        if (isUpscaled) page._upscaledImage = page.currentImage;
      }

      await this.applyPostImageRemoval(pageId, finalBase64, upscaleResult?.bgMode || (shouldAutoRemoveBg ? 'auto' : 'none'));
      return;
    }
    
    if (files.length > 0 && !files[0].path) {
      const file = files[0];
      const base64 = await this._fileToBase64(file);
      const upscaleResult = await this.validateAndUpscaleImage(base64);
      if (!upscaleResult) return;
      const finalBase64 = typeof upscaleResult === 'string' ? upscaleResult : upscaleResult.base64;
      const shouldAutoRemoveBg = upscaleResult?.removeBg !== false;
      const isUpscaled = !!upscaleResult?.isUpscaled;

      await this.editor.loadImageToPage(pageId, {
        base64: finalBase64, filePath: file.name, format: file.type.split('/')[1] || 'jpeg'
      });

      const page = this.editor.getPage(pageId);
      if (page) {
        page._isUpscaled = isUpscaled;
        if (isUpscaled) page._upscaledImage = page.currentImage;
      }

      await this.applyPostImageRemoval(pageId, finalBase64, upscaleResult?.bgMode || (shouldAutoRemoveBg ? 'auto' : 'none'));
      return;
    }
    
    // URL
    let imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!imageUrl) {
      const html = e.dataTransfer.getData('text/html');
      const match = html?.match(/src=["']([^"']+)["']/);
      if (match) imageUrl = match[1];
    }
    
    if (imageUrl && imageUrl.startsWith('http')) {
      this.showToast('Baixando imagem...', 'info');
      const data = await window.api.files.downloadFromUrl(imageUrl);
      const upscaleResult = await this.validateAndUpscaleImage(data.base64);
      if (!upscaleResult) return;
      const finalBase64 = typeof upscaleResult === 'string' ? upscaleResult : upscaleResult.base64;
      const shouldAutoRemoveBg = upscaleResult?.removeBg !== false;
      const isUpscaled = !!upscaleResult?.isUpscaled;

      await this.editor.loadImageToPage(pageId, {
        base64: finalBase64, filePath: data.filePath, format: data.format || 'jpg'
      });

      const page = this.editor.getPage(pageId);
      if (page) {
        page._isUpscaled = isUpscaled;
        if (isUpscaled) page._upscaledImage = page.currentImage;
      }

      await this.applyPostImageRemoval(pageId, finalBase64, upscaleResult?.bgMode || (shouldAutoRemoveBg ? 'auto' : 'none'));
    }
  }
  


  async refreshSankhyaSearch() {
    this.showToast('Atualizando todos os itens e verificando novos produtos... (F5)', 'info');
    try {
      let updatedCount = 0;

      // 1. Atualizar TODOS os itens abertos que possuem SKU
      if (this.editor && this.editor.pages) {
        const pagesWithSku = this.editor.pages.filter(p => p.sku && String(p.sku).trim().length >= 2);
        for (const p of pagesWithSku) {
          try {
            await this.editor.buscarSkuSilent(p.id);
            updatedCount++;
          } catch(e) {}
        }
        // Sincronizar barra lateral da página ativa
        this.editor.syncSidebarDescription();
      }

      // 2. Verificar e trazer novos itens disponíveis na fila do Sankhya naquele momento
      let newCount = 0;
      if (window.api?.sankhya?.checkQueueNow) {
        const queueRes = await window.api.sankhya.checkQueueNow();
        if (queueRes?.skus && queueRes.skus.length > 0) {
          const beforeCount = this.editor.pages.length;
          await this.editor.loadQueue(queueRes.skus);
          const afterCount = this.editor.pages.length;
          newCount = Math.max(0, afterCount - beforeCount);
        }
      }

      if (newCount > 0) {
        this.showToast(`${updatedCount} item(ns) atualizado(s) e ${newCount} novo(s) produto(s) adicionado(s) da fila!`, 'success');
      } else {
        this.showToast(`${updatedCount} item(ns) atualizado(s) com dados frescos do Sankhya!`, 'success');
      }
      this.updateStatusBarQueueCount();
    } catch (e) {
      console.error('Erro ao atualizar busca Sankhya:', e);
      this.showToast('Erro ao atualizar Sankhya: ' + e.message, 'error');
    }
  }

  handleEscape() {
    let canceled = false;

    // 1. Fechar modal de configurações se estiver aberto
    const modalSettings = document.getElementById('modal-settings');
    if (modalSettings && (modalSettings.classList.contains('active') || modalSettings.style.display === 'flex' || modalSettings.style.display === 'block')) {
      if (this.settingsManager && typeof this.settingsManager.closeModal === 'function') {
        this.settingsManager.closeModal();
      } else {
        modalSettings.classList.remove('active');
        modalSettings.style.display = 'none';
      }
      canceled = true;
    }

    // 2. Fechar menus dropdown abertos na titlebar
    const openMenus = document.querySelectorAll('.menu-item.open');
    if (openMenus.length > 0) {
      openMenus.forEach(m => m.classList.remove('open'));
      canceled = true;
    }

    // 3. Interromper automação / processamento em lote
    if (this._isProcessingAll) {
      this._cancelProcessarTudo = true;
      this.showToast('Automação interrompida pelo usuário (ESC)', 'warning');
      canceled = true;
    }

    // 4. Interromper lote do BatchProcessor se houver
    if (this.batchProcessor && this.batchProcessor.isProcessing) {
      this.batchProcessor.cancel();
      this.showToast('Processamento em lote cancelado (ESC)', 'warning');
      canceled = true;
    }

    // 5. Cancelar geração de descrição por IA
    const mainPage = this.editor?.getActiveMainPage?.() || this.editor?.getActivePage?.();
    if (mainPage && mainPage._isGenerating) {
      mainPage._abortGenerating = true;
      mainPage._isGenerating = false;
      this.editor.syncSidebarDescription();
      this.showToast('Geração de descrição cancelada (ESC)', 'info');
      canceled = true;
    }

    // 6. Cancelar ações ativas do Editor (pincéis, overlays de IA, etc.)
    if (this.editor) {
      const editorCanceled = this.editor.cancelActiveActions();
      if (editorCanceled > 0) {
        canceled = true;
      }
    }

    // 7. Remover foco de inputs para cancelar digitação
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      activeEl.blur();
      canceled = true;
    }

    if (canceled) {
      this.showToast('Ação cancelada (ESC)', 'info');
    }
  }

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // F5 (Atualizar busca do Sankhya)
      if (e.key === 'F5') {
        e.preventDefault();
        this.refreshSankhyaSearch();
        return;
      }
      // ESC (Interromper ações)
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        this.handleEscape();
        return;
      }
      // Ctrl atalhos
      if (e.ctrlKey) {
        // Ctrl+Z (Undo)
        if (e.key === 'z' || e.key === 'Z') {
          if (!e.shiftKey && this.views.editor.classList.contains('active')) {
            e.preventDefault();
            this.editor.undo();
          }
        }
        
        // Ctrl+Y ou Ctrl+Shift+Z (Redo)
        if (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
          if (this.views.editor.classList.contains('active')) {
            e.preventDefault();
            this.editor.redo();
          }
        }
        
        // Ctrl+S (Salvar Tudo e Validar)
        if (e.key === 's' || e.key === 'S') {
          if (!e.shiftKey && this.views.editor.classList.contains('active')) {
            e.preventDefault();
            this._processarTudo();
          }
        }
        
        // Ctrl+D (Duplicar página ativa)
        if (e.key === 'd' || e.key === 'D') {
          if (!e.shiftKey && this.views.editor.classList.contains('active')) {
            e.preventDefault();
            const activePage = this.editor.getActivePage();
            if (activePage) {
              this.editor.duplicateAsNewItem(activePage.id);
            }
          }
        }

        // Ctrl+C (Copiar imagem da página ativa)
        if (e.key === 'c' || e.key === 'C') {
          if (!e.shiftKey && this.views.editor.classList.contains('active')) {
            const activePage = this.editor.getActivePage();
            if (activePage && activePage.currentImage) {
              e.preventDefault();
              this._copiedImageSrc = activePage.currentImage.src;
              this.showToast('Imagem copiada', 'info');
            }
          }
        }
        
        // Ctrl+V (Colar imagem na página ativa)
        if (e.key === 'v' || e.key === 'V') {
          if (!e.shiftKey && this.views.editor.classList.contains('active')) {
            const activePage = this.editor.getActivePage();
            if (activePage && this._copiedImageSrc) {
              e.preventDefault();
              const img = new Image();
              img.onload = () => {
                activePage.currentImage = img;
                activePage.canvas.width = img.width;
                activePage.canvas.height = img.height;
                activePage.hasChanges = true;
                this.editor.pushHistory(activePage.id);
                this.editor.renderPage(activePage.id);
                this.showToast('Imagem colada', 'success');
              };
              img.src = this._copiedImageSrc;
            }
          }
        }
        
        // Ctrl+O (Open)
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          document.getElementById('btn-select-images')?.click();
        }
      }
      
      // Delete (Apagar imagem da pagina ativa)
      if (e.key === 'Delete') {
        if (this.views.editor.classList.contains('active')) {
          const activePage = this.editor.getActivePage();
          if (activePage && activePage.currentImage) {
            const focused = document.activeElement;
            if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) return;
            e.preventDefault();
            activePage.currentImage = null;
            activePage.ctx.clearRect(0, 0, activePage.canvas.width, activePage.canvas.height);
            activePage.hasChanges = true;
            this.editor.pushHistory(activePage.id);
            this.editor.renderPage(activePage.id);
            this.showToast('Imagem removida', 'info');
          }
        }
      }
    });
  }
  
  setupUpdater() {
    if (window.api && window.api.updater) {
      window.api.updater.onUpdateAvailable(() => {
        const notif = document.getElementById('update-notification');
        if (notif) notif.style.display = 'block';
      });
      
      window.api.updater.onUpdateDownloaded(() => {
        const notif = document.getElementById('update-notification');
        if (notif) {
          notif.innerHTML = 'Atualização baixada. <button id="btn-install-update" class="btn btn-sm btn-primary">Instalar e Reiniciar</button>';
          document.getElementById('btn-install-update')?.addEventListener('click', () => {
            window.api.updater.installUpdate();
          });
        }
      });
      
      // window.api.updater.checkForUpdates();
    }
  }
  
  async validateAndUpscaleImage(base64) {
    const res = await this.checkImageResolution(base64);
    if (res.isValid) return { base64, removeBg: true, isUpscaled: false };
    const modalRes = await this.showUpscaleVariationsModal(base64, res);
    if (typeof modalRes === 'string') {
      return { base64: modalRes, removeBg: true, isUpscaled: true };
    }
    return modalRes;
  }


  async showUpscaleVariationsModal(base64, res) {
    return new Promise((resolve) => {
      let minW = res.minW || 1000;
      let minH = res.minH || 1000;
      let viewMode = 'real'; // padrão 'real' (tamanho nativo 1000x1000 conforme solicitado)

      // Criar overlay do modal
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);z-index:9999;padding:10px;';
      
      const container = document.createElement('div');
      container.style.cssText = 'background:var(--bg-secondary,#111222);border:1px solid var(--border-color,#252640);border-radius:12px;padding:16px 20px;width:98vw;max-width:1800px;height:96vh;max-height:96vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.85);overflow:hidden;';
      
      // Header
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-shrink:0;';
      header.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
          <h2 style="color:var(--text-primary,#fff);margin:0;font-size:17px;font-weight:700;">Upscale IA — Escolha da Variação em Alta Definição</h2>
          <span style="background:rgba(59,130,246,0.15);color:#60A5FA;border:1px solid rgba(59,130,246,0.3);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">Resolução Alvo: ${minW}x${minH}px</span>
        </div>
      `;
      
      const headerRight = document.createElement('div');
      headerRight.style.cssText = 'display:flex;align-items:center;gap:10px;';

      // Botão para alternar modo de exibição: Tamanho Real vs Ajustar
      const btnViewToggle = document.createElement('button');
      btnViewToggle.className = 'btn btn-secondary btn-sm';
      btnViewToggle.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;padding:5px 12px;background:#1e2038;color:#fff;border:1px solid var(--primary-color,#ff6b35);border-radius:6px;cursor:pointer;';
      btnViewToggle.innerHTML = `🔍 Modo: <strong>Tamanho Real (${minW}x${minH}px)</strong> [Clique para Ajustar]`;

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'background:none;border:none;color:var(--text-secondary,#aaa);font-size:22px;cursor:pointer;padding:4px 8px;line-height:1;';
      closeBtn.onclick = () => { overlay.remove(); resolve(base64); };

      headerRight.appendChild(btnViewToggle);
      headerRight.appendChild(closeBtn);
      header.appendChild(headerRight);
      container.appendChild(header);
      
      // Info
      const info = document.createElement('p');
      info.style.cssText = 'color:var(--text-secondary,#94a3b8);font-size:12px;margin:0 0 10px 0;flex-shrink:0;';
      info.textContent = `Imagem original: ${res.width}x${res.height}px ➜ Ampliando para ${minW}x${minH}px. Role na imagem para inspecionar os detalhes finos (textos, embalagens, rótulos).`;
      container.appendChild(info);
      
      // Grid de 2 variações
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;min-height:0;overflow:hidden;margin-bottom:10px;';
      
      const cards = [];
      const results = [null, null];
      const imgElements = [null, null];

      const applyViewMode = () => {
        if (viewMode === 'real') {
          btnViewToggle.innerHTML = `🔍 Modo: <strong>Tamanho Real (${minW}x${minH}px)</strong> [Clique para Ajustar]`;
          btnViewToggle.style.borderColor = 'var(--primary-color, #ff6b35)';
          imgElements.forEach(img => {
            if (img) {
              img.style.width = `${minW}px`;
              img.style.height = `${minH}px`;
              img.style.minWidth = `${minW}px`;
              img.style.minHeight = `${minH}px`;
              img.style.maxWidth = 'none';
              img.style.maxHeight = 'none';
              img.style.objectFit = 'contain';
            }
          });
        } else {
          btnViewToggle.innerHTML = `⛶ Modo: <strong>Ajustar à Janela</strong> [Clique para Tamanho Real]`;
          btnViewToggle.style.borderColor = 'var(--border-color,#252640)';
          imgElements.forEach(img => {
            if (img) {
              img.style.width = '100%';
              img.style.height = '100%';
              img.style.minWidth = '0';
              img.style.minHeight = '0';
              img.style.maxWidth = '100%';
              img.style.maxHeight = '100%';
              img.style.objectFit = 'contain';
            }
          });
        }
      };

      btnViewToggle.onclick = () => {
        viewMode = viewMode === 'real' ? 'fit' : 'real';
        applyViewMode();
      };
      
      for (let i = 0; i < 2; i++) {
        const card = document.createElement('div');
        card.style.cssText = 'border:2px solid var(--border-color,#252640);border-radius:10px;overflow:hidden;background:#090a16;display:flex;flex-direction:column;height:100%;transition:border-color 0.2s;position:relative;';
        
        // Header do card
        const cardHeader = document.createElement('div');
        cardHeader.style.cssText = 'padding:8px 12px;background:rgba(255,255,255,0.03);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;';
        cardHeader.innerHTML = `<span style="font-weight:700;font-size:13px;color:#fff;">Variação ${i + 1}</span><span class="var-badge" style="font-size:11px;color:#94a3b8;">Gerando...</span>`;
        card.appendChild(cardHeader);

        // Container scrollável da imagem
        const imgContainer = document.createElement('div');
        imgContainer.style.cssText = 'flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;overflow:auto;background:#06070f;position:relative;padding:8px;';
        
        const spinner = document.createElement('div');
        spinner.innerHTML = '<div style="text-align:center;"><div style="width:36px;height:36px;border:3px solid #252640;border-top:3px solid var(--accent,#ff6b35);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 10px;"></div><span style="color:#94a3b8;font-size:13px;font-weight:500;">Gerando variação ' + (i + 1) + ' (' + minW + 'x' + minH + 'px)...</span></div>';
        imgContainer.appendChild(spinner);
        
        card.appendChild(imgContainer);
        
        // Rodapé do card com botão de seleção
        const cardFooter = document.createElement('div');
        cardFooter.style.cssText = 'padding:10px 14px;border-top:1px solid var(--border-color);display:flex;justify-content:center;background:rgba(0,0,0,0.3);flex-shrink:0;';
        
        const selectBtn = document.createElement('button');
        selectBtn.className = 'btn btn-primary btn-block';
        selectBtn.style.cssText = 'width:100%;padding:10px;font-size:13px;font-weight:700;background:#2563EB;color:#fff;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;opacity:0.5;';
        selectBtn.disabled = true;
        selectBtn.innerHTML = `Aguardando Variação ${i + 1}...`;
        
        selectBtn.onclick = (e) => {
          e.stopPropagation();
          if (!results[i]) return;
          overlay.remove();
          resolve({ base64: results[i], bgMode: 'auto', isUpscaled: true });
        };

        cardFooter.appendChild(selectBtn);
        card.appendChild(cardFooter);
        
        grid.appendChild(card);
        cards.push({ card, cardHeader, imgContainer, selectBtn });
      }
      
      container.appendChild(grid);
      
      // Rodapé geral de ações
      const actionRow = document.createElement('div');
      actionRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;padding-top:4px;';
      
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:12px;align-items:center;';
      
      // Botão gerar novamente
      const regenBtn = document.createElement('button');
      regenBtn.innerHTML = '&#x21bb; Gerar novamente';
      regenBtn.style.cssText = 'background:var(--accent,#ff6b35);color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;';
      regenBtn.onclick = () => { generateVariations(); };
      btnRow.appendChild(regenBtn);
      
      // Botão cancelar
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancelar (usar original)';
      cancelBtn.style.cssText = 'background:var(--bg-tertiary,#2a2b4a);color:var(--text-primary,#fff);border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;';
      cancelBtn.onclick = () => { 
        overlay.remove(); 
        resolve({ base64: base64, removeBg: false, isUpscaled: false }); 
      };
      btnRow.appendChild(cancelBtn);
      
      actionRow.appendChild(btnRow);
      container.appendChild(actionRow);
      
      overlay.appendChild(container);
      document.body.appendChild(overlay);
      
      // Adicionar animação CSS
      const style = document.createElement('style');
      style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
      
      const apiKey = this.settingsManager?.settings?.geminiApiKey;
      
      const generateVariations = () => {
        const promptInput = document.getElementById('upscale-prompt');
        const customPrompt = promptInput ? promptInput.value.trim() : '';
        
        for (let i = 0; i < 2; i++) {
          results[i] = null;
          imgElements[i] = null;
          cards[i].imgContainer.innerHTML = '<div style="text-align:center;"><div style="width:36px;height:36px;border:3px solid #252640;border-top:3px solid var(--accent,#ff6b35);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 10px;"></div><span style="color:#94a3b8;font-size:13px;font-weight:500;">Gerando variação ' + (i + 1) + ' (' + minW + 'x' + minH + 'px)...</span></div>';
          const badgeEl = cards[i].cardHeader.querySelector('.var-badge');
          if (badgeEl) {
            badgeEl.textContent = 'Gerando...';
            badgeEl.style.color = '#94a3b8';
          }
          cards[i].card.style.borderColor = 'var(--border-color,#252640)';
          cards[i].selectBtn.disabled = true;
          cards[i].selectBtn.style.opacity = '0.5';
          cards[i].selectBtn.style.background = '#2563EB';
          cards[i].selectBtn.innerHTML = `Aguardando Variação ${i + 1}...`;
        }
        
        const runSequential = async () => {
          for (let i = 0; i < 2; i++) {
            try {
              const result = await window.api.gemini.upscale({
                imageBase64: base64,
                targetW: minW,
                targetH: minH,
                apiKey,
                customPrompt
              });
              if (!result || !result.base64) throw new Error('Sem resultado');
              results[i] = result.base64;
              
              const img = document.createElement('img');
              img.src = result.base64;
              img.title = `Variação ${i + 1} (${minW}x${minH}px) - Clique para alternar zoom`;
              img.style.cursor = 'zoom-in';
              img.onclick = () => {
                viewMode = viewMode === 'real' ? 'fit' : 'real';
                applyViewMode();
              };
              imgElements[i] = img;
              
              cards[i].imgContainer.innerHTML = '';
              cards[i].imgContainer.appendChild(img);
              applyViewMode();
              
              const badgeEl = cards[i].cardHeader.querySelector('.var-badge');
              if (badgeEl) {
                badgeEl.textContent = `${minW}x${minH}px ✓ Pronto`;
                badgeEl.style.color = '#10B981';
              }
              
              cards[i].card.style.borderColor = '#3B82F6';
              cards[i].selectBtn.disabled = false;
              cards[i].selectBtn.style.opacity = '1';
              cards[i].selectBtn.style.background = 'linear-gradient(90deg, #2563EB, #1D4ED8)';
              cards[i].selectBtn.innerHTML = `✓ Escolher Variação ${i + 1} (${minW}x${minH}px)`;
            } catch (err) {
              cards[i].imgContainer.innerHTML = '<span style="color:#f44;font-size:12px;padding:8px;">Erro: ' + err.message + '</span>';
              cards[i].selectBtn.innerHTML = 'Falhou';
            }
          }
        };
        runSequential();
      };
      
      generateVariations();
    });
  }

  async doUpscale(page, base64 = null, customPrompt = '') {
    try {
      let currentBase64 = base64;
      if (page) {
        if (this.editor) this.editor.showPageOverlay(page.id, 'Realizando Upscale IA', 'Isso pode levar de 15 a 30 segundos');
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = page.canvas.width;
        tempCanvas.height = page.canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.fillStyle = '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(page.canvas, 0, 0);
        currentBase64 = tempCanvas.toDataURL('image/jpeg', 1.0);
      }
      
      let minW = 1000, minH = 1000;
      if (this.settingsManager && typeof this.settingsManager.getActiveProfiles === 'function') {
        const activeProfiles = this.settingsManager.getActiveProfiles();
        if (activeProfiles && activeProfiles.length > 0) {
          minW = Math.max(...activeProfiles.map(p => parseInt(p.width) || 300));
          minH = Math.max(...activeProfiles.map(p => parseInt(p.height) || 300));
        }
      }
      
      const apiKey = this.settingsManager?.settings?.geminiApiKey;
      
      const result = await window.api.gemini.upscale({ 
        imageBase64: currentBase64, 
        targetW: minW, 
        targetH: minH,
        apiKey,
        customPrompt
      });
      
      if (!result || !result.base64) throw new Error("Falha ao gerar upscale.");
      
      this.showToast('Upscale finalizado com sucesso!', 'success');
      
      if (page) {
        if (this.editor) this.editor.hidePageOverlay(page.id);
        const img = new Image();
        img.onload = () => {
          page.currentImage = img;
          page.canvas.width = img.width;
          page.canvas.height = img.height;
          page.ctx.drawImage(img, 0, 0);
          page.hasChanges = true;
          this.editor.pushHistory(page.id);
          this.editor.renderPage(page.id);
          
          if (this.editor && typeof this.editor.removeBackground === 'function') {
            setTimeout(() => {
              this.editor.removeBackground(page.id, true);
            }, 300);
          }
        };
        img.src = result.base64;
      }
      
      return result.base64;
    } catch (e) {
      console.error(e);
      this.showToast('Erro no Upscale: ' + (e.message || 'Desconhecido'), 'error');
      if (page && this.editor) this.editor.hidePageOverlay(page.id);
      return null;
    }
  }

  async checkImageResolution(base64) {
    return new Promise((resolve) => {
      let minW = 300;
      let minH = 300;
      
      if (this.settingsManager && typeof this.settingsManager.getActiveProfiles === 'function') {
        const activeProfiles = this.settingsManager.getActiveProfiles();
        if (activeProfiles && activeProfiles.length > 0) {
          minW = Math.max(...activeProfiles.map(p => parseInt(p.width) || 300));
          minH = Math.max(...activeProfiles.map(p => parseInt(p.height) || 300));
        }
      }
      
      const img = new Image();
      img.onload = () => {
        const isValid = img.width >= minW && img.height >= minH;
        const canUpscale = !isValid;
        resolve({
          isValid,
          canUpscale,
          minW, 
          minH,
          width: img.width,
          height: img.height
        });
      };
      img.onerror = () => resolve({ isValid: false, canUpscale: false, minW, minH, width: 0, height: 0 });
      img.src = base64;
    });
  }
  
  showToast(message, type = 'info') {
    // 1. Atualizar a Barra de Notificações no Rodapé (Status Bar)
    const statusMsg = document.getElementById('statusbar-message');
    const statusIcon = document.getElementById('statusbar-icon');
    if (statusMsg) {
      statusMsg.textContent = message;
      if (type === 'success') {
        statusMsg.style.color = '#10B981';
        if (statusIcon) statusIcon.innerHTML = '<i data-lucide="check-circle" style="width:13px;height:13px;color:#10B981;"></i>';
      } else if (type === 'error') {
        statusMsg.style.color = '#EF4444';
        if (statusIcon) statusIcon.innerHTML = '<i data-lucide="alert-circle" style="width:13px;height:13px;color:#EF4444;"></i>';
      } else if (type === 'warning') {
        statusMsg.style.color = '#F59E0B';
        if (statusIcon) statusIcon.innerHTML = '<i data-lucide="alert-triangle" style="width:13px;height:13px;color:#F59E0B;"></i>';
      } else {
        statusMsg.style.color = '#94A3B8';
        if (statusIcon) statusIcon.innerHTML = '<i data-lucide="info" style="width:13px;height:13px;color:var(--primary-color);"></i>';
      }
      if (window.lucide) window.lucide.createIcons();
    }

    // 2. Notificação Pílula Moderna (Garante apenas 1 por vez para NUNCA mais empilhar/sobrepor)
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    // Limpa qualquer notificação anterior imediatamente
    container.innerHTML = '';

    const pill = document.createElement('div');
    pill.className = `toast-pill toast-${type}`;

    let bg = '#1E293B';
    let iconName = 'info';
    if (type === 'success') { bg = 'rgba(16, 185, 129, 0.95)'; iconName = 'check-circle'; }
    else if (type === 'error') { bg = 'rgba(239, 68, 68, 0.95)'; iconName = 'alert-circle'; }
    else if (type === 'warning') { bg = 'rgba(245, 158, 11, 0.95)'; iconName = 'alert-triangle'; }
    else { bg = 'rgba(30, 41, 59, 0.95)'; iconName = 'info'; }

    pill.style.backgroundColor = bg;
    pill.innerHTML = `
      <i data-lucide="${iconName}" style="width:14px;height:14px;flex-shrink:0;"></i>
      <span style="flex:1; word-break: break-word;">${message}</span>
    `;

    container.appendChild(pill);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      pill.style.opacity = '0';
      pill.style.transform = 'translateY(6px)';
      setTimeout(() => pill.remove(), 250);
    }, 3200);
  }

  /**
   * Atualiza a barra de progresso no rodapé
   * @param {number|null} percent - 0 a 100, ou null para ocultar
   * @param {string} text - texto descritivo
   */
  setProgress(percent, text = '') {
    const wrap = document.getElementById('statusbar-progress-wrap');
    const fill = document.getElementById('statusbar-progress-fill');
    const label = document.getElementById('statusbar-progress-text');
    if (!wrap) return;

    if (percent === null || percent === undefined) {
      wrap.style.display = 'none';
      return;
    }

    wrap.style.display = 'flex';
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (fill) fill.style.width = `${clamped}%`;
    if (label) label.textContent = text || `${clamped}%`;
  }

  // =========================================================================
  // SISTEMA DE RELATÓRIOS E HISTÓRICO DE ALTERAÇÕES
  // =========================================================================
  setupReportModal() {
    const modal = document.getElementById('modal-report-history');
    const btnClose = document.getElementById('btn-close-report');
    const btnCloseFooter = document.getElementById('btn-close-report-footer');
    const btnPrint = document.getElementById('btn-print-report');
    const monthSelect = document.getElementById('report-month-select');
    const searchInput = document.getElementById('report-search-input');

    if (!modal) return;

    btnClose?.addEventListener('click', () => this.closeReportModal());
    btnCloseFooter?.addEventListener('click', () => this.closeReportModal());
    
    // Fechar com ESC ou clicando no overlay
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeReportModal();
    });

    btnPrint?.addEventListener('click', () => {
      window.print();
    });

    monthSelect?.addEventListener('change', () => {
      this.loadReportData();
    });

    let searchTimeout;
    searchInput?.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.renderReportTable();
      }, 150);
    });
  }

  async openReportModal() {
    const modal = document.getElementById('modal-report-history');
    if (!modal) return;
    modal.style.display = 'flex';
    const searchInput = document.getElementById('report-search-input');
    if (searchInput) searchInput.value = '';
    
    await this.loadReportMonths();
    await this.loadReportData();
    if (window.lucide) window.lucide.createIcons();
  }

  closeReportModal() {
    const modal = document.getElementById('modal-report-history');
    if (modal) modal.style.display = 'none';
  }

  async loadReportMonths() {
    const monthSelect = document.getElementById('report-month-select');
    if (!monthSelect || !window.api?.history?.getMonths) return;

    try {
      const res = await window.api.history.getMonths();
      const months = res?.months || [];
      const currentVal = monthSelect.value;
      
      const monthNames = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
      ];

      monthSelect.innerHTML = months.map(m => {
        const [yyyy, mm] = m.split('-');
        const monthIndex = parseInt(mm, 10) - 1;
        const label = monthIndex >= 0 && monthIndex < 12 
          ? `${monthNames[monthIndex]} / ${yyyy}`
          : m;
        return `<option value="${m}">${label}</option>`;
      }).join('');

      if (currentVal && months.includes(currentVal)) {
        monthSelect.value = currentVal;
      }
    } catch (e) {
      console.error('[Report] Erro ao carregar meses:', e);
    }
  }

  async loadReportData() {
    const monthSelect = document.getElementById('report-month-select');
    const selectedMonth = monthSelect?.value;
    if (!selectedMonth || !window.api?.history?.get) return;

    try {
      const res = await window.api.history.get(selectedMonth);
      this._reportRecords = res?.records || [];
      this.renderReportTable();
    } catch (e) {
      console.error('[Report] Erro ao carregar dados:', e);
      this._reportRecords = [];
      this.renderReportTable();
    }
  }

  renderReportTable() {
    const tableBody = document.getElementById('report-table-body');
    const emptyState = document.getElementById('report-empty-state');
    const searchInput = document.getElementById('report-search-input');
    const query = (searchInput?.value || '').trim().toLowerCase();

    const records = this._reportRecords || [];
    const filtered = records.filter(r => {
      if (!query) return true;
      const sku = String(r.sku || '').toLowerCase();
      const name = String(r.productName || '').toLowerCase();
      const brand = String(r.brand || '').toLowerCase();
      const user = String(r.userName || '').toLowerCase();
      return sku.includes(query) || name.includes(query) || brand.includes(query) || user.includes(query);
    });

    // Atualizar Contadores / Estatísticas do Mês
    const totalItemsEl = document.getElementById('stat-total-items');
    const mainPhotosEl = document.getElementById('stat-main-photos');
    const descEl = document.getElementById('stat-descriptions');
    const altPhotosEl = document.getElementById('stat-alt-photos');
    const footerInfoEl = document.getElementById('report-footer-info');

    const totalCount = filtered.length;
    let mainPhotosCount = 0;
    let descCount = 0;
    let altPhotosCount = 0;

    filtered.forEach(r => {
      if (r.changes?.mainPhoto) mainPhotosCount++;
      if (r.changes?.description) descCount++;
      if (r.changes?.altPhotosCount) altPhotosCount += Number(r.changes.altPhotosCount) || 0;
    });

    if (totalItemsEl) totalItemsEl.textContent = `${totalCount} item(ns)`;
    if (mainPhotosEl) mainPhotosEl.textContent = `${mainPhotosCount} foto(s) princ.`;
    if (descEl) descEl.textContent = `${descCount} descrição(ões)`;
    if (altPhotosEl) altPhotosEl.textContent = `${altPhotosCount} alternativa(s)`;
    if (footerInfoEl) footerInfoEl.textContent = `Exibindo ${filtered.length} de ${records.length} registro(s) no mês`;

    if (!tableBody) return;

    if (filtered.length === 0) {
      tableBody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    tableBody.innerHTML = filtered.map(r => {
      const badges = [];
      if (r.changes?.mainPhoto) {
        badges.push('<span class="badge-change badge-change-photo"><i data-lucide="image" style="width:10px;height:10px;"></i> Foto Principal</span>');
      }
      if (r.changes?.description) {
        badges.push('<span class="badge-change badge-change-desc"><i data-lucide="sparkles" style="width:10px;height:10px;"></i> Descrição</span>');
      }
      if (r.changes?.altPhotosCount > 0) {
        const count = r.changes.altPhotosCount;
        badges.push(`<span class="badge-change badge-change-alt"><i data-lucide="images" style="width:10px;height:10px;"></i> ${count} Alternativa${count > 1 ? 's' : ''}</span>`);
      }
      if (r.changes?.validated) {
        badges.push('<span class="badge-change badge-change-val"><i data-lucide="check" style="width:10px;height:10px;"></i> Validado MKT</span>');
      }
      if (badges.length === 0) {
        badges.push(`<span class="badge-change" style="background:rgba(255,255,255,0.06);color:#cbd5e1;">${r.changesSummary || 'Alteração'}</span>`);
      }

      return `
        <tr>
          <td style="font-family: monospace; font-weight: 700; color: #60A5FA;">${r.sku || '-'}</td>
          <td style="font-weight: 500; color: #F1F5F9; word-break: break-word;">${r.productName || '<span style="color:var(--text-muted);">(Sem nome)</span>'}</td>
          <td style="color: #94A3B8;">${r.brand || '-'}</td>
          <td style="color: #FBBF24; font-weight: 600;">
            <i data-lucide="user" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>${r.userName || 'Usuário'}
          </td>
          <td>${badges.join(' ')}</td>
          <td style="color: #94A3B8; font-size: 11px; white-space: nowrap;">${r.dateStr || '-'}</td>
        </tr>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window._app = window.app;
  window.app.init();
});

















