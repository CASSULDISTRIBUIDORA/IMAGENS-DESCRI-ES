const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

let mainWindow;

function setupUpdater(window) {
  mainWindow = window;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:updateAvailable', info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('updater:updateDownloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Erro no auto-updater:', err);
  });

  // Verifica atualizações ao iniciar
  autoUpdater.checkForUpdatesAndNotify();
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
