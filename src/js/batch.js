class BatchProcessor {
  constructor() {
    this.images = [];
    this.progress = { current: 0, total: 0 };
    this.processor = new window.ImageProcessor();
    this.isProcessing = false;
    
    this.bindEvents();
  }
  
  bindEvents() {
    document.getElementById('btn-process-all')?.addEventListener('click', () => this.processAll());
    document.getElementById('btn-export-all')?.addEventListener('click', () => this.exportAll());
    document.getElementById('btn-batch-add-more')?.addEventListener('click', () => {
      // Chama main para abrir mais
      window.api?.files.openImages().then(paths => {
        if(paths && paths.length) this.addImages(paths);
      });
    });
    document.getElementById('btn-back-upload')?.addEventListener('click', () => {
      if (window.app) window.app.showView('upload');
    });
  }
  
  async addImages(filePaths) {
    if (!filePaths || !filePaths.length) return;
    
    for (const path of filePaths) {
      const fileName = path.split('\\').pop().split('/').pop();
      
      // Lê o thumbnail
      let base64 = null;
      try {
         if (window.api && window.api.files) {
            const data = await window.api.files.readImageAsBase64(path);
            base64 = data.base64;
         }
      } catch(e) {
          console.error("Erro lendo base64:", e);
      }

      this.images.push({
        filePath: path,
        fileName: fileName,
        sku: '',
        status: 'pending',
        thumbnail: base64 || null,
        processedBase64: null,
        originalData: base64
      });
    }
    
    this.renderGrid();
  }
  
  removeImage(index) {
    if (this.images[index]) {
      this.images.splice(index, 1);
      this.renderGrid();
    }
  }
  
  cancel() {
    if (this.isProcessing) {
      this._cancelRequested = true;
    }
  }

  async processAll() {
    if (this.isProcessing || this.images.length === 0) return;
    
    this.isProcessing = true;
    this.progress.total = this.images.length;
    this.progress.current = 0;
    this.updateProgressUI();
    
    for (let i = 0; i < this.images.length; i++) {
      if (this._cancelRequested) {
        this._cancelRequested = false;
        this.isProcessing = false;
        break;
      }
      if (this.images[i].status === 'done') {
        this.progress.current++;
        continue; // Pula as já prontas
      }
      
      this.images[i].status = 'processing';
      this.renderGrid(); // Atualiza badge
      
      try {
        // Remover fundo via processo principal (Node.js)
        let source = this.images[i].thumbnail;
        const result = await window.api.image.removeBg(source);
        
        // Cria canvas a partir da imagem processada
        const img = new Image();
        await new Promise(res => {
          img.onload = res;
          img.src = result.base64;
        });
        
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Auto adjust
        const suggested = this.processor.autoAdjust(canvas);
        this.processor.applyAdjustments(canvas, suggested);
        
        // Salva
        const finalBase64 = this.processor.canvasToBase64(canvas, 'png'); // mantém transparência aqui
        
        this.images[i].processedBase64 = finalBase64;
        this.images[i].thumbnail = finalBase64;
        this.images[i].status = 'done';
        
      } catch (error) {
        console.error('Erro ao processar lote:', error);
        this.images[i].status = 'error';
      }
      
      this.progress.current++;
      this.updateProgressUI();
      this.renderGrid();
    }
    
    this.isProcessing = false;
    if (window.app) window.app.showToast('Processamento em lote concluído', 'success');
  }
  
  async exportAll() {
    if (!window.app || !window.app.exportManager) return;
    
    const toExport = this.images.filter(img => img.status === 'done' || img.status === 'pending');
    if (toExport.length === 0) return;
    
    const profiles = window.app.settingsManager.getActiveProfiles();
    
    const formattedImages = toExport.map(img => ({
      base64: (img.processedBase64 || img.thumbnail).split(',')[1],
      fileName: img.sku ? `${img.sku}` : img.fileName
    }));
    
    await window.app.exportManager.exportBatch(formattedImages, profiles, (curr, tot) => {
      // Callback de progresso
      const text = document.getElementById('batch-progress-text');
      if(text) text.textContent = `Exportando... ${curr}/${tot}`;
    });
  }
  
  openInEditor(index) {
    if (!window.app || !this.images[index]) return;
    
    const imgData = this.images[index];
    
    if (window.app.editor) {
      window.app.editor.loadImage({
        base64: imgData.originalData || imgData.thumbnail,
        filePath: imgData.filePath,
        format: 'jpg'
      }).then(() => {
        window.app.showView('editor');
      });
    }
  }
  
  updateSku(index, sku) {
    if (this.images[index]) {
      this.images[index].sku = sku;
    }
  }
  
  renderGrid() {
    const grid = document.getElementById('batch-grid');
    if (!grid) return;
    
    const count = document.getElementById('batch-count');
    if (count) count.textContent = `${this.images.length} imagens`;
    
    grid.innerHTML = '';
    
    this.images.forEach((img, idx) => {
      const card = document.createElement('div');
      card.className = 'batch-card';
      card.dataset.index = idx;
      
      let badgeClass = 'badge-pending';
      let badgeText = 'Pendente';
      if (img.status === 'processing') { badgeClass = 'badge-processing'; badgeText = 'Processando'; }
      if (img.status === 'done') { badgeClass = 'badge-done'; badgeText = 'Pronto'; }
      if (img.status === 'error') { badgeClass = 'badge-error'; badgeText = 'Erro'; }
      
      card.innerHTML = `
        <div class="batch-card-thumb"><img src="${img.thumbnail || ''}" alt="thumb"></div>
        <input class="batch-card-sku" placeholder="Código SKU" value="${img.sku || ''}">
        <div class="batch-card-status"><span class="badge ${badgeClass}">${badgeText}</span></div>
        <div class="batch-card-actions">
          <button class="btn-icon btn-edit" title="Editar">✏️</button>
          <button class="btn-icon btn-delete" title="Remover">🗑️</button>
        </div>
      `;
      
      grid.appendChild(card);
      
      // Listeners locais
      const skuInput = card.querySelector('.batch-card-sku');
      skuInput.addEventListener('change', (e) => this.updateSku(idx, e.target.value));
      
      card.querySelector('.btn-edit').addEventListener('click', () => this.openInEditor(idx));
      card.querySelector('.btn-delete').addEventListener('click', () => this.removeImage(idx));
    });
  }
  
  updateProgressUI() {
    const bar = document.getElementById('batch-progress-bar');
    const text = document.getElementById('batch-progress-text');
    
    if (bar && text && this.progress.total > 0) {
      const percent = (this.progress.current / this.progress.total) * 100;
      bar.style.width = `${percent}%`;
      text.textContent = `Processando... ${this.progress.current}/${this.progress.total}`;
    }
  }
}

window.BatchProcessor = BatchProcessor;
