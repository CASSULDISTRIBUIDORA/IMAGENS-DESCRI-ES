const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

let mainWindow;

function setupUpdater(window) {
  mainWindow = window;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Atualização disponível:', info?.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:updateAvailable', info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Atualização baixada com sucesso:', info?.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:updateDownloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater] Verificação de atualização:', err?.message || err);
  });

  // Verifica atualizações ao iniciar de forma assíncrona segura
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('[AutoUpdater] Não foi possível verificar atualizações agora:', err?.message);
    });
  }, 3000);
}

ipcMain.handle('updater:checkForUpdates', async () => {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('Erro ao verificar atualizações:', err);
  }
});

ipcMain.handle('updater:installUpdate', () => {
  autoUpdater.quitAndInstall();
});

module.exports = { setupUpdater };
