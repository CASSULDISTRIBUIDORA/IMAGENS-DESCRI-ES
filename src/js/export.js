class ExportManager {
  constructor() {}
  
  /**
   * Exporta uma única imagem para vários perfis
   * @param {string} base64 - Base64 raw (sem prefixo dataURL)
   * @param {string} fileName - Nome do arquivo (ou sku)
   * @param {Array} profiles - Perfis ativos
   * @returns {Promise<boolean>}
   */
  async exportImage(base64, fileName, profiles) {
    if (!window.api || !window.api.files) {
      console.error('API do Electron não disponível');
      return false;
    }
    
    if (!profiles || profiles.length === 0) {
      if (window.app) window.app.showToast('Nenhum perfil de exportação ativo', 'warning');
      return false;
    }
    
    let allSuccess = true;
    
    for (const profile of profiles) {
      try {
        const result = await window.api.files.exportToProfile({
          base64,
          fileName,
          profile
        });
        
        if (!result.success) {
          allSuccess = false;
          console.error(`Falha ao exportar para o perfil ${profile.name}`);
        }
      } catch (error) {
        allSuccess = false;
        console.error(`Erro ao exportar para o perfil ${profile.name}:`, error);
      }
    }
    
    if (allSuccess && window.app) {
      window.app.showToast('Imagem exportada com sucesso!', 'success');
    } else if (!allSuccess && window.app) {
      window.app.showToast('Erros durante a exportação. Verifique os logs.', 'error');
    }
    
    return allSuccess;
  }
  
  /**
   * Exporta múltiplas imagens para os perfis
   * @param {Array} images - [{ base64, fileName }]
   * @param {Array} profiles 
   * @param {Function} onProgress - Callback(current, total)
   */
  async exportBatch(images, profiles, onProgress) {
    if (!window.api || !window.api.files) return;
    
    if (!profiles || profiles.length === 0) {
      if (window.app) window.app.showToast('Nenhum perfil de exportação ativo', 'warning');
      return;
    }
    
    let successCount = 0;
    const total = images.length;
    
    for (let i = 0; i < total; i++) {
      if (onProgress) onProgress(i + 1, total);
      
      const img = images[i];
      const success = await this.exportImage(img.base64, img.fileName, profiles);
      if (success) successCount++;
    }
    
    if (window.app) {
      window.app.showToast(`Exportação em lote concluída: ${successCount}/${total} com sucesso`, 'success');
    }
  }
  
  /**
   * Renderiza a lista de perfis de exportação
   * @param {Array} profiles 
   * @param {string} containerId 
   */
  renderProfilesList(profiles, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!profiles || profiles.length === 0) {
      container.innerHTML = '<div class="text-muted text-center p-3">Nenhum perfil configurado.</div>';
      return;
    }
    
    profiles.forEach((profile, idx) => {
      const item = document.createElement('div');
      item.className = `export-profile-item ${profile.active ? 'active' : ''}`;
      
      item.innerHTML = `
        <label style="display:flex; align-items:center; cursor:pointer; width:100%;">
          <input type="checkbox" ${profile.active ? 'checked' : ''} class="profile-toggle" data-index="${idx}" style="margin-right:10px;">
          <div>
            <strong>${profile.name}</strong>
            <div style="font-size: 0.8rem; color: var(--text-secondary, #b0b0c0);">
              ${profile.format.toUpperCase()} • ${profile.width}x${profile.height} • Q:${profile.quality}%
            </div>
          </div>
        </label>
      `;
      
      container.appendChild(item);
      
      // Listener para o toggle
      const checkbox = item.querySelector('.profile-toggle');
      checkbox.addEventListener('change', (e) => {
        if (window.app && window.app.settingsManager) {
          const profs = window.app.settingsManager.settings.profiles;
          if (profs[idx]) {
            profs[idx].active = e.target.checked;
            window.app.settingsManager.save();
          }
        }
      });
    });
  }
}

window.ExportManager = ExportManager;
