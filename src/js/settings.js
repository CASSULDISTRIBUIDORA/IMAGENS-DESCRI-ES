class SettingsManager {
  constructor() {
    this.settings = {
      parallelProcessing: 2,
      profiles: []
    };
    
    this.defaultProfile = {
      name: 'Sankhya ERP',
      format: 'jpg',
      width: 300,
      height: 300,
      quality: 90,
      background: '#ffffff',
      outputDir: '\\\\192.168.10.23\\Marketing_Operacional\\01 CASSUL DISTRIBUIDORA\\SANKHYA\\IMAGENS SANKHYA',
      active: true
    };
    
    this.bindEvents();
  }
  
  bindEvents() {
    // Menu Tabs
    const menuItems = document.querySelectorAll('.settings-menu-item');
    const tabPanes = document.querySelectorAll('.settings-tab-pane');
    
    menuItems.forEach(item => {
      item.addEventListener('click', () => {
        menuItems.forEach(mi => mi.classList.remove('active'));
        tabPanes.forEach(tp => tp.classList.remove('active'));
        
        item.classList.add('active');
        const tabId = item.getAttribute('data-tab');
        const targetTab = document.getElementById(tabId);
        if (targetTab) targetTab.classList.add('active');
        
        // Auto-carregar grupos ao abrir aba Fila de Trabalho
        if (tabId === 'tab-fila' && !this.cachedGroups) {
          this.carregarGruposSankhya();
        }
        
        // Auto-carregar dados de uso de IA
        if (tabId === 'tab-usage') {
          this.renderUsagePanel();
        }
        
        // Auto-grow textareas na aba ativa
        setTimeout(() => {
          document.querySelectorAll('.settings-content textarea').forEach(ta => {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
          });
        }, 50);
      });
    });

    // Busca de grupos
    document.getElementById('settings-groups-search')?.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const items = document.querySelectorAll('#settings-groups-checklist .group-item');
      items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? 'flex' : 'none';
      });
    });

    document.getElementById('btn-open-settings')?.addEventListener('click', () => this.openModal());
    
    // Botão "Verificar Atualizações"
    document.getElementById('btn-check-updates')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-check-updates');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i data-lucide="loader" style="animation:spin 1s linear infinite;"></i> Verificando...';
      btn.style.pointerEvents = 'none';
      if (window.lucide) lucide.createIcons({ nodes: [btn] });
      try {
        await window.api.updater.checkForUpdates();
        // Se chegou aqui sem erro, pode ser que não tenha atualização
        setTimeout(() => {
          btn.innerHTML = '<i data-lucide="check-circle"></i> Você está na versão mais recente!';
          btn.style.color = '#10B981';
          if (window.lucide) lucide.createIcons({ nodes: [btn] });
          setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.color = '';
            btn.style.pointerEvents = '';
            if (window.lucide) lucide.createIcons({ nodes: [btn] });
          }, 4000);
        }, 3000);
      } catch (err) {
        btn.innerHTML = '<i data-lucide="alert-circle"></i> Erro ao verificar';
        btn.style.color = '#f44336';
        if (window.lucide) lucide.createIcons({ nodes: [btn] });
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.style.color = '';
          btn.style.pointerEvents = '';
          if (window.lucide) lucide.createIcons({ nodes: [btn] });
        }, 3000);
      }
    });
    document.getElementById('btn-settings-cancel')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btn-settings-save')?.addEventListener('click', () => {
      // Puxar parallelProcessing
      const parallelInput = document.getElementById('settings-parallel');
      if (parallelInput) {
        this.settings.parallelProcessing = parseInt(parallelInput.value) || 2;
      }
      // Puxar API Key do remove.bg
      const apiKeyInput = document.getElementById('settings-removebg-key');
      if (apiKeyInput) {
        this.settings.removeBgApiKey = apiKeyInput.value.trim();
      }
      // Sankhya
      const sankhyaEnv = document.getElementById('settings-sankhya-environment');
      if (sankhyaEnv) this.settings.sankhyaEnvironment = sankhyaEnv.value;
      const sankhyaClientId = document.getElementById('settings-sankhya-clientid');
      if (sankhyaClientId) this.settings.sankhyaClientId = sankhyaClientId.value.trim();
      const sankhyaSecret = document.getElementById('settings-sankhya-secret');
      if (sankhyaSecret) this.settings.sankhyaSecret = sankhyaSecret.value.trim();
      const sankhyaToken = document.getElementById('settings-sankhya-token');
      if (sankhyaToken) this.settings.sankhyaToken = sankhyaToken.value.trim();
      const sankhyaQuery = document.getElementById('settings-sankhya-query');
      if (sankhyaQuery) this.settings.sankhyaQuery = sankhyaQuery.value.trim();
      
      const queueEnabled = document.getElementById('settings-sankhya-queue-enabled');
      if (queueEnabled) this.settings.sankhyaQueueEnabled = queueEnabled.checked;
      const queueInterval = document.getElementById('settings-sankhya-queue-interval');
      if (queueInterval) this.settings.sankhyaQueueInterval = queueInterval.value;
      const queueQuery = document.getElementById('settings-sankhya-queue-query');
      if (queueQuery) this.settings.sankhyaQueueQuery = queueQuery.value.trim();
      const queueField = document.getElementById('settings-sankhya-queue-field');
      if (queueField) this.settings.sankhyaQueueField = queueField.value.trim();
      const queueValue = document.getElementById('settings-sankhya-queue-value');
      if (queueValue) this.settings.sankhyaQueueValue = queueValue.value.trim();
      const queueCodUsu = document.getElementById('settings-sankhya-codusu');
      if (queueCodUsu) this.settings.sankhyaCodUsu = queueCodUsu.value.trim();
      const queueNomeUsu = document.getElementById('settings-sankhya-nomeusu');
      if (queueNomeUsu) this.settings.sankhyaNomeUsu = queueNomeUsu.value.trim();
      
      // FTP
      const ftpHost = document.getElementById('settings-sankhya-ftp-host');
      if (ftpHost) this.settings.sankhyaFtpHost = ftpHost.value.trim();
      const ftpUser = document.getElementById('settings-sankhya-ftp-user');
      if (ftpUser) this.settings.sankhyaFtpUser = ftpUser.value.trim();
      const ftpPassword = document.getElementById('settings-sankhya-ftp-password');
      if (ftpPassword) this.settings.sankhyaFtpPassword = ftpPassword.value.trim();
      const ftpPath = document.getElementById('settings-sankhya-ftp-path');
      if (ftpPath) this.settings.sankhyaFtpPath = ftpPath.value.trim();
      
      // Gemini
      const geminiKey = document.getElementById('settings-gemini-key');
      if (geminiKey) this.settings.geminiApiKey = geminiKey.value.trim();
      const geminiKeyFallback = document.getElementById('settings-gemini-key-fallback');
      if (geminiKeyFallback) this.settings.geminiApiKeyFallback = geminiKeyFallback.value.trim();
      const geminiPrompt = document.getElementById('settings-gemini-prompt');
      if (geminiPrompt) this.settings.geminiPrompt = geminiPrompt.value.trim();
      
      this.save();
      this.closeModal();
      if (window.app) window.app.showToast('Configurações salvas!', 'success');
    });
    
  }
  
  async load() {
    if (window.api && window.api.settings) {
      try {
        const loaded = await window.api.settings.load();
        if (loaded && loaded.profiles) {
          this.settings = loaded;
        } else {
          // Iniciar com default se não tiver nada
          this.settings.profiles = [{ ...this.defaultProfile }];
          this.save();
        }
      } catch (e) {
        console.error("Erro carregando configurações:", e);
        this.settings.profiles = [{ ...this.defaultProfile }];
      }
    } else {
      // Fallback
      this.settings.profiles = [{ ...this.defaultProfile }];
    }
  }
  
  async save() {
    if (window.api && window.api.settings) {
      try {
        await window.api.settings.save(this.settings);
        
        // Disparar evento para outros componentes se atualizarem
        window.dispatchEvent(new CustomEvent('settingsChanged', { detail: this.settings }));
        
        // Atualiza a sidebar se estiver no editor
        if (window.app && window.app.exportManager) {
          window.app.exportManager.renderProfilesList(this.settings.profiles, 'export-profiles-list');
        }
        
      } catch (e) {
        console.error("Erro salvando configurações:", e);
      }
    }
  }
  
  addProfile() {
    this.settings.profiles.push({ ...this.defaultProfile, name: 'Novo Perfil' });
    this.renderSettingsModal();
  }
  
  removeProfile(index) {
    this.settings.profiles.splice(index, 1);
    this.renderSettingsModal();
  }
  
  updateProfile(index, data) {
    if (this.settings.profiles[index]) {
      this.settings.profiles[index] = { ...this.settings.profiles[index], ...data };
    }
  }
  
  getActiveProfiles() {
    return this.settings.profiles.filter(p => p.active);
  }
  
  openModal() {
    this.renderSettingsModal();
    // Auto-grow textareas
    setTimeout(() => {
      document.querySelectorAll('.settings-content textarea').forEach(ta => {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
        ta.addEventListener('input', function() {
          this.style.height = 'auto';
          this.style.height = this.scrollHeight + 'px';
        });
      });
    }, 50);
    const modal = document.getElementById('modal-settings');
    if (modal) modal.style.display = 'flex'; // ou classe 'show'
  }
  
  closeModal() {
    const modal = document.getElementById('modal-settings');
    if (modal) modal.style.display = 'none';
  }
  
  async carregarGruposSankhya() {
    const container = document.getElementById('settings-groups-checklist');
    if (!container) return;
    
    if (!this.settings.sankhyaSecret || !this.settings.sankhyaToken) {
      container.innerHTML = '<div class="text-xs text-danger" style="padding:12px;">Configure e salve as credenciais do Sankhya primeiro.</div>';
      return;
    }
    
    container.innerHTML = '<div class="text-xs text-secondary" style="padding:12px;">Carregando grupos do Sankhya...</div>';
    
    try {
      const result = await window.api.sankhya.getGroups({
        clientId: this.settings.sankhyaClientId,
        secret: this.settings.sankhyaSecret,
        token: this.settings.sankhyaToken,
        environment: this.settings.sankhyaEnvironment
      });
      
      this.cachedGroups = result || [];
      this.renderGroupsChecklist();
    } catch (err) {
      console.error(err);
      container.innerHTML = `<div class="text-xs text-danger" style="padding:12px;">Erro ao carregar: ${err.message}</div>`;
    }
  }
  
  renderGroupsChecklist() {
    const container = document.getElementById('settings-groups-checklist');
    if (!container) return;
    if (!this.cachedGroups || this.cachedGroups.length === 0) {
      return;
    }
    
    if (!this.settings.excludedGroups) this.settings.excludedGroups = [];
    
    container.innerHTML = '';
    this.cachedGroups.forEach(grupo => {
      const item = document.createElement('label');
      item.className = 'group-item';
      
      const isExcluded = this.settings.excludedGroups.includes(grupo.CODGRUPOPROD);
      
      item.innerHTML = `
        <input type="checkbox" value="${grupo.CODGRUPOPROD}" ${isExcluded ? 'checked' : ''}>
        <span style="font-size: 11px;">${grupo.CODGRUPOPROD} - ${grupo.DESCRGRUPOPROD}</span>
      `;
      
      item.querySelector('input').addEventListener('change', (e) => {
        const checked = e.target.checked;
        const val = parseInt(e.target.value);
        if (checked) {
          if (!this.settings.excludedGroups.includes(val)) this.settings.excludedGroups.push(val);
        } else {
          this.settings.excludedGroups = this.settings.excludedGroups.filter(id => id !== val);
        }
      });
      
      container.appendChild(item);
    });
  }
  
  renderSettingsModal() {
    const parallelInput = document.getElementById('settings-parallel');
    if (parallelInput) parallelInput.value = this.settings.parallelProcessing;
    
    const apiKeyInput = document.getElementById('settings-removebg-key');
    if (apiKeyInput) apiKeyInput.value = this.settings.removeBgApiKey || '';
    
    // Sankhya
    const sankhyaEnv = document.getElementById('settings-sankhya-environment');
    if (sankhyaEnv) sankhyaEnv.value = this.settings.sankhyaEnvironment || 'sandbox';
    const sankhyaClientId = document.getElementById('settings-sankhya-clientid');
    if (sankhyaClientId) sankhyaClientId.value = this.settings.sankhyaClientId || '';
    const sankhyaSecret = document.getElementById('settings-sankhya-secret');
    if (sankhyaSecret) sankhyaSecret.value = this.settings.sankhyaSecret || '';
    const sankhyaToken = document.getElementById('settings-sankhya-token');
    if (sankhyaToken) sankhyaToken.value = this.settings.sankhyaToken || '';
    const sankhyaQuery = document.getElementById('settings-sankhya-query');
    if (sankhyaQuery) sankhyaQuery.value = this.settings.sankhyaQuery || '';
    
    const queueEnabled = document.getElementById('settings-sankhya-queue-enabled');
    if (queueEnabled) queueEnabled.checked = !!this.settings.sankhyaQueueEnabled;
    const queueInterval = document.getElementById('settings-sankhya-queue-interval');
    if (queueInterval) queueInterval.value = this.settings.sankhyaQueueInterval || '30';
    const queueQuery = document.getElementById('settings-sankhya-queue-query');
    if (queueQuery) queueQuery.value = this.settings.sankhyaQueueQuery || '';
    const queueField = document.getElementById('settings-sankhya-queue-field');
    if (queueField) queueField.value = this.settings.sankhyaQueueField || '';
    const queueValue = document.getElementById('settings-sankhya-queue-value');
    if (queueValue) queueValue.value = this.settings.sankhyaQueueValue || '';
    const queueCodUsu = document.getElementById('settings-sankhya-codusu');
    if (queueCodUsu) queueCodUsu.value = this.settings.sankhyaCodUsu || '';
    const queueNomeUsu = document.getElementById('settings-sankhya-nomeusu');
    if (queueNomeUsu) queueNomeUsu.value = this.settings.sankhyaNomeUsu || '';
    
    this.renderGroupsChecklist();
    
    // FTP
    const ftpHost = document.getElementById('settings-sankhya-ftp-host');
    if (ftpHost) ftpHost.value = this.settings.sankhyaFtpHost || '192.168.10.140';
    const ftpUser = document.getElementById('settings-sankhya-ftp-user');
    if (ftpUser) ftpUser.value = this.settings.sankhyaFtpUser || 'root';
    const ftpPassword = document.getElementById('settings-sankhya-ftp-password');
    if (ftpPassword) ftpPassword.value = this.settings.sankhyaFtpPassword || 'C@ssul';
    const ftpPath = document.getElementById('settings-sankhya-ftp-path');
    if (ftpPath) ftpPath.value = this.settings.sankhyaFtpPath || '/home/mgeweb/repositorio/imagem/imagensprodutos';
    
    // Gemini
    const geminiKey = document.getElementById('settings-gemini-key');
    if (geminiKey) geminiKey.value = this.settings.geminiApiKey || '';
    const geminiKeyFallback = document.getElementById('settings-gemini-key-fallback');
    if (geminiKeyFallback) geminiKeyFallback.value = this.settings.geminiApiKeyFallback || '';
    const geminiPrompt = document.getElementById('settings-gemini-prompt');
    if (geminiPrompt) geminiPrompt.value = this.settings.geminiPrompt || '';
    
    const list = document.getElementById('settings-profiles-list');
    if (!list) return;
    
    list.innerHTML = '';
    list.style.display = 'grid';
    list.style.gridTemplateColumns = 'repeat(3, 1fr)';
    list.style.gap = '12px';
    
    this.settings.profiles.forEach((profile, idx) => {
      const card = document.createElement('div');
      card.style.cssText = 'background: var(--surface-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px;';
      
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <input type="text" class="form-control profile-name" value="${profile.name}" data-index="${idx}" style="font-weight: 600; font-size: 12px; background: transparent; border: none; padding: 0; color: var(--text-primary);">
          <button class="btn btn-ghost btn-sm btn-remove-profile" data-index="${idx}" style="color: var(--danger-color); padding: 2px;" title="Remover"><i data-lucide="x" style="width:14px;height:14px;"></i></button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <div>
            <label style="font-size: 10px; color: var(--text-muted);">Formato</label>
            <select class="form-control profile-format" data-index="${idx}" style="font-size: 11px; padding: 4px 6px;">
              <option value="jpg" ${profile.format === 'jpg' ? 'selected' : ''}>JPG</option>
              <option value="png" ${profile.format === 'png' ? 'selected' : ''}>PNG</option>
              <option value="webp" ${profile.format === 'webp' ? 'selected' : ''}>WebP</option>
            </select>
          </div>
          <div>
            <label style="font-size: 10px; color: var(--text-muted);">Qualidade</label>
            <input type="number" class="form-control profile-quality" value="${profile.quality}" data-index="${idx}" style="font-size: 11px; padding: 4px 6px;">
          </div>
          <div>
            <label style="font-size: 10px; color: var(--text-muted);">Largura</label>
            <input type="number" class="form-control profile-width" value="${profile.width}" data-index="${idx}" style="font-size: 11px; padding: 4px 6px;">
          </div>
          <div>
            <label style="font-size: 10px; color: var(--text-muted);">Altura</label>
            <input type="number" class="form-control profile-height" value="${profile.height}" data-index="${idx}" style="font-size: 11px; padding: 4px 6px;">
          </div>
        </div>
        <div>
          <label style="font-size: 10px; color: var(--text-muted);">Fundo</label>
          <input type="text" class="form-control profile-bg" value="${profile.background || '#ffffff'}" data-index="${idx}" style="font-size: 11px; padding: 4px 6px;">
        </div>
        <div>
          <label style="font-size: 10px; color: var(--text-muted);">Diretório</label>
          <div style="display: flex; gap: 4px;">
            <input type="text" class="form-control profile-dir" value="${profile.outputDir}" data-index="${idx}" style="font-size: 11px; padding: 4px 6px; flex: 1;">
            <button class="btn btn-secondary btn-sm btn-select-dir" data-index="${idx}" style="padding: 4px 8px;">...</button>
          </div>
        </div>
      `;
      
      list.appendChild(card);
      
      // Re-render lucide icons
      if (window.lucide) window.lucide.createIcons();
      
      // Listeners
      card.querySelector('.btn-remove-profile').addEventListener('click', () => this.removeProfile(idx));
      
      ['name', 'format', 'quality', 'width', 'height', 'bg', 'dir'].forEach(field => {
        const input = card.querySelector(`.profile-${field}`);
        if(input) {
          input.addEventListener('change', (e) => {
            const key = field === 'bg' ? 'background' : field === 'dir' ? 'outputDir' : field;
            let val = e.target.value;
            if (['quality', 'width', 'height'].includes(key)) val = parseInt(val) || 0;
            this.updateProfile(idx, { [key]: val });
          });
        }
      });
      
      card.querySelector('.btn-select-dir').addEventListener('click', async () => {
        if (window.api && window.api.files) {
          const dir = await window.api.files.selectDirectory();
          if (dir) {
            this.updateProfile(idx, { outputDir: dir });
            this.renderSettingsModal();
          }
        }
      });
    });
    
    // Botão + para adicionar perfil
    const addCard = document.createElement('div');
    addCard.style.cssText = 'border: 2px dashed var(--border-color); border-radius: 8px; min-height: 200px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;';
    addCard.innerHTML = '<div style="text-align: center; color: var(--text-muted);"><i data-lucide="plus" style="width:24px;height:24px;"></i><div style="font-size: 11px; margin-top: 4px;">Novo Perfil</div></div>';
    addCard.addEventListener('click', () => this.addProfile());
    addCard.addEventListener('mouseenter', () => { addCard.style.borderColor = 'var(--primary-color)'; addCard.style.color = 'var(--primary-color)'; });
    addCard.addEventListener('mouseleave', () => { addCard.style.borderColor = 'var(--border-color)'; addCard.style.color = ''; });
    list.appendChild(addCard);
    if (window.lucide) window.lucide.createIcons();
  }
  async renderUsagePanel() {
    const panel = document.getElementById('usage-panel');
    if (!panel || !window.api || !window.api.usage) return;
    
    try {
      const allData = await window.api.usage.get();
      const monthKey = new Date().toISOString().substring(0, 7);
      const month = allData[monthKey] || {};
      
      // Precos Gemini 3.6 Flash (introductory ate dez/2026)
      const INPUT_PRICE = 0.75 / 1000000;   // US$/token
      const OUTPUT_PRICE = 3.75 / 1000000;  // US$/token
      const IMAGE_PRICE = 0.039;             // US$/imagem gerada
      const REMOVEBG_PRICE = 0.20;           // US$/chamada remove.bg
      
      const types = [
        { key: 'rewrite', label: 'Reescrita de texto', icon: 'type' },
        { key: 'removeBgChroma', label: 'Remocao de fundo (Gemini)', icon: 'eraser' },
        { key: 'removeBg', label: 'Remocao de fundo (remove.bg)', icon: 'scissors' },
        { key: 'upscale', label: 'Upscale IA', icon: 'maximize-2' },
        { key: 'autoEnhance', label: 'Auto Enhance', icon: 'sparkles' },
        { key: 'inpaint', label: 'Cenario/Inpaint', icon: 'paintbrush' },
      ];
      
      let totalCalls = 0;
      let totalCost = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalImages = 0;
      let rows = '';
      
      types.forEach(function(t) {
        const entry = month[t.key];
        if (!entry || !entry.calls) return;
        
        const calls = entry.calls || 0;
        const inTk = entry.inputTokens || 0;
        const outTk = entry.outputTokens || 0;
        const imgs = entry.images || 0;
        
        totalCalls += calls;
        totalInputTokens += inTk;
        totalOutputTokens += outTk;
        totalImages += imgs;
        
        // Calcular custo
        let cost = 0;
        if (t.key === 'removeBg') {
          cost = calls * REMOVEBG_PRICE;
        } else {
          cost = (inTk * INPUT_PRICE) + (outTk * OUTPUT_PRICE) + (imgs * IMAGE_PRICE);
        }
        totalCost += cost;
        
        // Formatar tokens
        var tokenInfo = '';
        if (inTk > 0 || outTk > 0) {
          tokenInfo = ' (' + Math.round((inTk + outTk) / 1000) + 'K tokens)';
        }
        
        rows += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">' +
          '<span style="display:flex;align-items:center;gap:6px;color:var(--text-primary);font-size:13px;">' +
            '<i data-lucide="' + t.icon + '" style="width:14px;height:14px;color:var(--accent,#ff6b35);"></i>' +
            t.label +
          '</span>' +
          '<span style="display:flex;gap:12px;align-items:center;">' +
            '<span style="color:var(--text-secondary);font-size:11px;">' + calls + 'x' + tokenInfo + '</span>' +
            '<span style="color:var(--text-primary);font-size:12px;min-width:70px;text-align:right;">US\$' + cost.toFixed(4) + '</span>' +
          '</span>' +
        '</div>';
      });
      
      if (totalCalls === 0) {
        panel.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;text-align:center;padding:16px 0;">Nenhuma chamada de IA registrada neste mes</p>';
      } else {
        const monthLabel = new Date().toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        const totalTokensK = Math.round((totalInputTokens + totalOutputTokens) / 1000);
        
        panel.innerHTML = 
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:10px 12px;background:rgba(255,107,53,0.1);border-radius:8px;">' +
            '<div>' +
              '<div style="color:var(--text-primary);font-size:14px;font-weight:600;">' + totalCalls + ' chamadas</div>' +
              '<div style="color:var(--text-secondary);font-size:11px;">' + monthLabel + '</div>' +
              '<div style="color:var(--text-secondary);font-size:10px;">' + totalTokensK + 'K tokens | ' + totalImages + ' imagens</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
              '<div style="color:var(--accent,#ff6b35);font-size:16px;font-weight:700;">US\$' + totalCost.toFixed(2) + '</div>' +
              '<div style="color:var(--text-secondary);font-size:11px;">custo real estimado</div>' +
            '</div>' +
          '</div>' +
          '<div style="color:var(--text-secondary);font-size:10px;margin-bottom:8px;">Precos: Gemini 3.6 Flash (introductory) | remove.bg API</div>' +
          rows;
      }
      
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      panel.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;">Erro ao carregar dados de uso</p>';
    }
  }

}



window.SettingsManager = SettingsManager;
