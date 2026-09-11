const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, Notification, net, Tray, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const { setupUpdater } = require('./updater');

// Desabilita a verificação de certificados SSL no Node.js (necessário para o fetch nativo não falhar em sandbox/certificados internos)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Ignora erros de certificado SSL (para instâncias do Chromium caso existam)
app.commandLine.appendSwitch('ignore-certificate-errors');

// Força o Windows a agrupar os ícones corretamente na barra de tarefas
app.setAppUserModelId('com.multipic.app');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (event, commandLine, workingDirectory) => {
  // Alguém tentou rodar uma segunda instância, vamos focar a nossa janela original
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

let mainWindow;
let tray = null;

// Log global do sistema
const logFile = path.join(app.getPath('userData'), 'debug.log');

// Configurações padrão conforme especificado para ambiente de produção da empresa
const DEFAULT_SETTINGS = {
  profiles: [
    {
      name: "Sankhya ERP",
      format: "jpg",
      width: 300,
      height: 300,
      quality: 90,
      background: "#FFFFFF",
      outputDir: "\\\\192.168.10.23\\Marketing_Operacional\\01 CASSUL DISTRIBUIDORA\\SANKHYA\\IMAGENS SANKHYA",
      active: true
    },
    {
      name: "Tablóide/Catálogo/Site",
      format: "png",
      width: 1000,
      height: 1000,
      quality: 100,
      background: "transparent",
      outputDir: "\\\\192.168.10.23\\Marketing_Operacional\\01 CASSUL DISTRIBUIDORA\\IMPRESSOS\\TABLÓIDES\\IMAGENS TABLOIDES",
      active: true
    }
  ],
  parallelProcessing: 4,
  removeBgApiKey: "",
  sankhyaSecret: "",
  sankhyaToken: "",
  sankhyaQuery: "SELECT\np.CODPROD AS CODIGO\n, p.DESCRPROD AS NOME \n, m.descricao AS MARCA\n, p.CARACTERISTICAS \n, d2.DESCRGRUPOPROD GRUPO_NIVEL2\n, d3.DESCRGRUPOPROD GRUPO_NIVEL3\n, d4.DESCRGRUPOPROD GRUPO_NIVEL4\n, p.AD_CATEGORIAPRODUTO \nFROM tgfpro p\nJOIN TGFMAR m ON m.codigo = p.CODMARCA \nLEFT JOIN TGFGRU d4 ON d4.CODGRUPOPROD = p.CODGRUPOPROD \nLEFT JOIN TGFGRU d3 on (d4.codgrupai=d3.codgrupoprod)\nLEFT JOIN TGFGRU d2 on (d3.codgrupai=d2.codgrupoprod)\nLEFT JOIN TGFGRU d1 on (d2.codgrupai=d1.codgrupoprod)\nWHERE p.CODPROD = {SKU}",
  geminiApiKey: "",
  geminiPrompt: "PADRÃO DE GERAÇÃO DE DESCRIÇÕES - PRODUTOS SANKHYA\n\n1. FORMATO DE SAÍDA\n- A descrição final deve ser sempre gerada dentro de um bloco de texto limpo (code block) mas com toda a acentuação e pontuação da língua portuguesa perfeitamente preservadas, utilizando exclusivamente a marcação de código pura de texto simples (plaintext).\n- Não utilizar formatações ricas em Markdown (como negritos ou itálicos) dentro do bloco de texto final.\n\n2. ESTRUTURA DE TÓPICOS INTELIGENTE (ADAPTATIVA)\nO sistema deve identificar a natureza do produto antes de nomear os tópicos. O texto deve ser dividido nas seções abaixo (em LETRAS MAIÚSCULAS), omitindo e adaptando o que não fizer sentido:\n- TÍTULO DO PRODUTO (Nome isolado na primeira linha)\n- Parágrafo Introdutório: Texto corrido resumindo o que é o produto e seu benefício principal (máximo de 2 a 3 linhas).\n- PRINCIPAIS INDICAÇÕES, BENEFÍCIOS E ESPECIFICAÇÕES (Para medicamentos/químicos) OU PRINCIPAIS CARACTERÍSTICAS E BENEFÍCIOS (Para roupas, EPIs e objetos): Lista em tópicos (-). Agrupe marca, cor ou voltagem aqui.\n- FÓRMULA E COMPOSIÇÃO (Para medicamentos/nutrição, realizando a transcrição exata) OU MATERIAL E COMPOSIÇÃO (Para vestuário/ferramentas).\n- MODO DE USAR E POSOLOGIA (Para medicamentos) OU INSTRUÇÕES DE USO / CUIDADOS (Para roupas, equipamentos e limpeza).\n- PERÍODOS DE CARÊNCIA: Lista indicando prazos de descarte. (EXCLUSIVO para produtos veterinários/agrícolas).\n- APRESENTAÇÃO (REGRA DE OURO): ÚLTIMA informação do texto. Detalhe EXCLUSIVAMENTE AQUI os volumes, tamanhos (P, M, G, numerações) e tipos de embalagem.\n\n3. TOM, ESTILO E REGRA ANTI-REPETIÇÃO\n- Linguagem técnica, profissional, clara e objetiva.\n- Regra de Informação Única: NENHUMA característica técnica deve aparecer em mais de um tópico.\n  * Tamanhos, pesos e volumes vão APENAS para a \"Apresentação\".\n  * Espécies-alvo ou público-alvo vão APENAS para as \"Indicações\".\n  * Marca e cor vão APENAS para as \"Especificações\".\n- Eliminar jargões comerciais vazios (ex: \"feito com alta qualidade\", \"design incrível\") e informações óbvias que não agregam valor técnico.\n\n4. CAUTELA JURÍDICA\n- Proibido o uso de termos hiperbólicos ou adjetivos extremos (ex: \"ultra eficiente\", \"cura garantida\").\n- Substituir promessas terapêuticas absolutas por termos seguros (ex: trocar \"evita\" ou \"cura\" por \"auxilia no tratamento de\"). Fidelidade estrita à bula.\n\n5. REGRA DE LIMITE DE CARACTERES E FORMATAÇÃO\n- O texto final gerado DEVE possuir no máximo 3.500 caracteres (incluindo espaços e quebras de linha).\n- Os pontinhos de preenchimento (e.g. .............) na seção \"FÓRMULA E COMPOSIÇÃO\" são OBRIGATÓRIOS apenas para medicamentos e químicos. Não utilizar para roupas e equipamentos.\n- Sintetizar listas e mesclar informações afins de forma compacta e direta.",
  sankhyaEnvironment: "production",
  sankhyaClientId: "8897fb53-3515-443d-a0b0-78a0af796756",
  sankhyaQueueEnabled: true,
  sankhyaQueueInterval: "5",
  sankhyaQueueQuery: "SELECT \nCASE WHEN AD_STATUS LIKE 'P' THEN 'Pendente'\n     WHEN ad_status LIKE 'VC' THEN 'Validado pelo Comercial'\n     WHEN ad_status LIKE 'VF' THEN 'Validado pelo Financeiro'\n     WHEN ad_status LIKE 'VL' THEN 'Validado pela Logística'\n     WHEN ad_status LIKE 'VM' THEN 'Validado pelo Marketing'\n     ELSE 'Concluído' END STATUS,\ncodprod, DESCRPROD, AD_DESCRPRODSITE, IMAGEM, ad_status, tgfpro.* \nFROM tgfpro \nWHERE AD_STATUS = 'VL'",
  sankhyaQueueField: "AD_STATUS",
  sankhyaQueueValue: "VM",
  sankhyaCodUsu: "",
  sankhyaFtpHost: "192.168.10.138",
  sankhyaFtpUser: "mgeweb",
  sankhyaFtpPassword: "5nkca55ul",
  sankhyaFtpPath: "/home/mgeweb/repositorio/imagem/imagensprodutos",
  excludedGroups: [
    300000000,
    113000000,
    601000000
  ]
};

// Caminho do arquivo de configurações no userData
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// ============================================================
// API Usage Tracker
// ============================================================
function getUsagePath() {
  return path.join(app.getPath('userData'), 'api-usage.json');
}

function getUsageData() {
  try {
    const raw = fs.readFileSync(getUsagePath(), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function saveUsageData(data) {
  fs.writeFile(getUsagePath(), JSON.stringify(data, null, 2), () => {});
}

function trackApiCall(type, usageMetadata = null) {
  const data = getUsageData();
  const now = new Date();
  const monthKey = now.toISOString().substring(0, 7);
  const dayKey = now.toISOString().substring(0, 10);
  
  // Estrutura: { monthly: { "2026-08": { rewrite: {...} } }, daily: { "2026-08-31": { rewrite: {...} } } }
  if (!data.monthly) data.monthly = {};
  if (!data.daily) data.daily = {};
  
  // Gravar mensal
  if (!data.monthly[monthKey]) data.monthly[monthKey] = {};
  if (!data.monthly[monthKey][type]) data.monthly[monthKey][type] = { calls: 0, inputTokens: 0, outputTokens: 0, images: 0 };
  const mEntry = data.monthly[monthKey][type];
  mEntry.calls++;
  if (usageMetadata) {
    mEntry.inputTokens += usageMetadata.promptTokenCount || 0;
    mEntry.outputTokens += usageMetadata.candidatesTokenCount || usageMetadata.totalTokenCount || 0;
  }
  if (['upscale', 'removeBgChroma', 'inpaint', 'autoEnhance'].includes(type)) mEntry.images++;
  
  // Gravar diário
  if (!data.daily[dayKey]) data.daily[dayKey] = {};
  if (!data.daily[dayKey][type]) data.daily[dayKey][type] = { calls: 0, inputTokens: 0, outputTokens: 0, images: 0 };
  const dEntry = data.daily[dayKey][type];
  dEntry.calls++;
  if (usageMetadata) {
    dEntry.inputTokens += usageMetadata.promptTokenCount || 0;
    dEntry.outputTokens += usageMetadata.candidatesTokenCount || usageMetadata.totalTokenCount || 0;
  }
  if (['upscale', 'removeBgChroma', 'inpaint', 'autoEnhance'].includes(type)) dEntry.images++;
  
  saveUsageData(data);
}

// Carrega configurações
function loadSettings() {
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) {
    try {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(data);
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (error) {
      console.error('Erro ao ler settings:', error);
      return { ...DEFAULT_SETTINGS };
    }
  }
  // Primeira execução em máquina nova: persiste o DEFAULT_SETTINGS completo
  try {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao inicializar settings.json:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

// Salva configurações
function saveSettings(settings) {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Erro ao salvar settings:', error);
    return false;
  }
}

function createWindow() {
  // Força o tema escuro nativo
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    title: 'MultiPic',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Remover menu padrão
  Menu.setApplicationMenu(null);

  // Interceptar qualquer link ou janela popup para abrir SEMPRE no navegador padrão do Windows (Chrome, Edge, etc.)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('https:') || url.startsWith('http:'))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Mostra a janela quando o conteúdo estiver pronto, se não estiver iniciando oculto
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) {
      mainWindow.maximize();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Em vez de fechar, minimizar para a bandeja
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // Carrega o index.html da pasta src
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Abre DevTools em modo dev para debug
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
  
  // Atalho Ctrl+Shift+I para DevTools (funciona em produção também)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Configura o updater (com try/catch para não travar)
  try {
    setupUpdater(mainWindow);
  } catch (err) {
    console.error('Erro ao configurar updater:', err);
  }
}

app.whenReady().then(() => {
  createWindow();
  
  // Pré-carregar motor BiRefNet para remoção de fundo (carrega modelo em background)
  setTimeout(() => {
    if (getRembgExePath()) {
      fs.appendFileSync(logFile, `[rembg] Pré-carregando motor BiRefNet em background...\n`);
      startRembgProcess();
    }
  }, 500);

  // Configurar inicialização junto com o Windows (rodando oculto em background)
  app.setLoginItemSettings({
    openAtLogin: true,
    args: ['--hidden'] // Inicia oculto e fica na bandeja
  });

  // Configurar a bandeja do sistema (Tray)
  let iconPath = path.join(__dirname, 'build', 'icon.png');
  // Fallback se não encontrar o PNG
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(__dirname, 'build', 'icon.ico');
  }

  try {
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Abrir MultiPic', click: () => { mainWindow.show(); mainWindow.maximize(); } },
      { label: 'Sair', click: () => { app.isQuiting = true; app.quit(); } }
    ]);
    tray.setToolTip('MultiPic - Processamento de Imagens');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      mainWindow.show();
      mainWindow.maximize();
    });
  } catch (err) {
    fs.appendFileSync(logFile, `Erro ao criar bandeja do sistema: ${err}\n`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Não faz nada, mantém o app rodando na bandeja.
  // Se quiser que no Mac continue também, é comportamento padrão.
});

// IPC Handlers - app
ipcMain.handle('app:getVersion', () => app.getVersion());

// IPC Handlers - Window Controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('clipboard:writeText', (event, text) => {
  clipboard.writeText(text || '');
  return true;
});

ipcMain.handle('clipboard:writeImage', (event, imageBase64) => {
  try {
    if (!imageBase64) return false;
    const img = nativeImage.createFromDataURL(imageBase64);
    clipboard.writeImage(img);
    return true;
  } catch (err) {
    console.error('Erro ao copiar imagem para a área de transferência:', err);
    return false;
  }
});

ipcMain.handle('clipboard:readImage', () => {
  try {
    const img = clipboard.readImage();
    if (img && !img.isEmpty()) {
      return img.toDataURL();
    }
  } catch (err) {
    console.error('Erro ao ler imagem da área de transferência:', err);
  }
  return null;
});


ipcMain.handle('search:googleLens', async (event, { imageBase64, queryText }) => {
  try {
    if (!imageBase64) return { success: false };

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imgBuf = Buffer.from(base64Data, 'base64');
    
    let mimeType = 'image/jpeg';
    let ext = 'jpg';
    if (imageBase64.startsWith('data:image/png')) {
      mimeType = 'image/png';
      ext = 'png';
    } else if (imageBase64.startsWith('data:image/webp')) {
      mimeType = 'image/webp';
      ext = 'webp';
    }

    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="encoded_image"; filename="product.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const suffix = `\r\n--${boundary}--\r\n`;
    const fullBody = Buffer.concat([Buffer.from(prefix), imgBuf, Buffer.from(suffix)]);

    const lensRes = await fetch('https://lens.google.com/v3/upload', {
      method: 'POST',
      body: fullBody,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      redirect: 'manual'
    });

    const location = lensRes.headers.get('location');
    if (location) {
      let finalUrl = location;
      if (queryText && queryText.trim()) {
        const urlObj = new URL(location);
        urlObj.searchParams.set('q', queryText.trim());
        finalUrl = urlObj.toString();
      }
      await shell.openExternal(finalUrl);
      return { success: true, url: finalUrl };
    }
  } catch (err) {
    console.error('[GoogleLens] Erro ao pesquisar por imagem:', err);
  }
  return { success: false };
});

ipcMain.handle('shell:openExternal', async (event, url) => {
  try {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
      return true;
    }
  } catch (err) {
    console.error('Erro ao abrir URL externa:', err);
  }
  return false;
});

// IPC Handler - Abrir Manual do Sistema no navegador padrão
ipcMain.handle('app:openManual', async () => {
  try {
    const candidates = [
      path.join(__dirname, 'MANUAL_DO_SISTEMA.html'),
      path.join(__dirname, 'src', 'manual.html'),
      process.resourcesPath ? path.join(process.resourcesPath, 'MANUAL_DO_SISTEMA.html') : null
    ].filter(Boolean);

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        await shell.openPath(p);
        return true;
      }
    }
  } catch (err) {
    console.error('Erro ao abrir manual do sistema:', err);
  }
  return false;
});

// IPC Handler - Baixar imagem de URL (para drag & drop do navegador)
ipcMain.handle('files:downloadFromUrl', async (event, url) => {
  try {
    console.log('Tentando baixar imagem de:', url);
    
    // Usar fetch nativo (Node 18+ / Electron 35)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.google.com/'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    if (buffer.length < 100) {
      throw new Error('Imagem muito pequena ou inválida');
    }
    
    const metadata = await sharp(buffer).metadata();
    
    // Salvar em pasta temporária
    const tempDir = path.join(app.getPath('temp'), 'multipic');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const ext = metadata.format === 'jpeg' ? 'jpg' : (metadata.format || 'png');
    const fileName = `download_${Date.now()}.${ext}`;
    const tempPath = path.join(tempDir, fileName);
    
    fs.writeFileSync(tempPath, buffer);
    
    const base64 = buffer.toString('base64');
    console.log('Imagem baixada com sucesso:', metadata.width, 'x', metadata.height, metadata.format);
    
    return {
      base64: `data:image/${metadata.format};base64,${base64}`,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      filePath: tempPath
    };
  } catch (error) {
    console.error('Erro ao baixar imagem de URL:', error.message);
    throw error;
  }
});


// IPC Handler - Remover fundo de imagem (usando remove.bg API)
ipcMain.handle('image:removeBg', async (event, base64Data) => {
  
  try {
    fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] Iniciando remoção de fundo via remove.bg...\n`);
    
    // Carregar settings para pegar API key
    const settings = loadSettings();
    const apiKey = settings.removeBgApiKey;
    
    if (!apiKey) {
      throw new Error('API Key não configurada. Vá em Configurações e adicione sua API Key do remove.bg.');
    }
    
    // Extrair dados puros do base64
    const rawBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const inputBuffer = Buffer.from(rawBase64, 'base64');
    
    let resultBuffer;
    
    // Verificar se já é um PNG com fundo transparente
    const imageMeta = await sharp(inputBuffer).metadata();
    const imageStats = await sharp(inputBuffer).stats();
    const isPngWithTransparency = imageMeta.format === 'png' && !imageStats.isOpaque;

    if (isPngWithTransparency) {
      fs.appendFileSync(logFile, `Imagem detectada como PNG com fundo transparente. Pulando remove.bg...\n`);
      resultBuffer = inputBuffer;
    } else {
      // Converter para PNG via sharp para enviar ao remove.bg
      const pngBuffer = await sharp(inputBuffer).png().toBuffer();
      
      fs.appendFileSync(logFile, `Enviando imagem para remove.bg (${pngBuffer.length} bytes)...\n`);
      
      // Montar multipart/form-data
      const boundary = '----MultiPicBoundary' + Date.now();
      
      const filePart = `--${boundary}\r\nContent-Disposition: form-data; name="image_file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`;
      const sizePart = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\nfull\r\n`;
      const footer = `--${boundary}--\r\n`;
      
      const bodyBuffer = Buffer.concat([
        Buffer.from(filePart),
        pngBuffer,
        Buffer.from(sizePart),
        Buffer.from(footer)
      ]);
      
      const response = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Accept': 'image/png'
        },
        body: bodyBuffer,
        signal: AbortSignal.timeout(60000)
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        fs.appendFileSync(logFile, `Erro HTTP ${response.status}: ${errorBody}\n`);
        
        if (response.status === 402) {
          throw new Error('Créditos esgotados. Verifique sua conta em remove.bg');
        } else if (response.status === 403 || response.status === 401) {
          throw new Error('API Key inválida. Verifique nas Configurações.');
        }
        throw new Error(`Erro remove.bg: HTTP ${response.status} - ${errorBody}`);
      }
      
      // remove.bg retorna a imagem PNG diretamente como binário
      const arrayBuffer = await response.arrayBuffer();
      resultBuffer = Buffer.from(arrayBuffer);
    }
    
    // Auto-trim: recortar bordas transparentes
    const trimmedBuffer = await sharp(resultBuffer)
      .trim()
      .png()
      .toBuffer();
    
    // Obter dimensões da imagem trimada
    const trimmedMeta = await sharp(trimmedBuffer).metadata();
    const tw = trimmedMeta.width;
    const th = trimmedMeta.height;
    
    // Criar canvas quadrado com margem de 5%
    const maxDim = Math.max(tw, th);
    const margin = Math.round(maxDim * 0.05);
    const squareSize = maxDim + (margin * 2);
    
    // Calcular padding para centralizar
    const padLeft = Math.round((squareSize - tw) / 2);
    const padRight = squareSize - tw - padLeft;
    const padTop = Math.round((squareSize - th) / 2);
    const padBottom = squareSize - th - padTop;
    
    const squareBuffer = await sharp(trimmedBuffer)
      .extend({
        top: padTop,
        bottom: padBottom,
        left: padLeft,
        right: padRight,
        background: { r: 0, g: 0, b: 0, alpha: 0 }  // Transparente
      })
      .png()
      .toBuffer();
    
    const resultBase64 = squareBuffer.toString('base64');
    
    fs.appendFileSync(logFile, `Fundo removido via remove.bg! Trimmed: ${tw}x${th}, Square: ${squareSize}x${squareSize}\n`);
    
    trackApiCall('removeBg');
    return {
      base64: `data:image/png;base64,${resultBase64}`,
      format: 'png'
    };
  } catch (error) {
    const errMsg = error.stack || error.message || String(error);
    fs.appendFileSync(logFile, `ERRO: ${errMsg}\n`);
    console.error('Erro ao remover fundo:', errMsg);
    throw new Error(error.message || 'Erro ao remover fundo');
  }
});

// ============================================================
// rembg - Processo Python persistente para remoção de fundo (opcional com fallback @imgly)
// ============================================================
let rembgProcess = null;
let rembgReady = false;
let rembgPendingResolve = null;
let rembgBuffer = '';
let imglyModule = null;

function getImglyPublicPath() {
  const { pathToFileURL } = require('url');
  let distPath = path.join(__dirname, 'node_modules', '@imgly', 'background-removal-node', 'dist');
  
  if (app.isPackaged) {
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@imgly', 'background-removal-node', 'dist');
    if (fs.existsSync(unpackedPath)) {
      distPath = unpackedPath;
    }
  }
  
  let fileUrl = pathToFileURL(distPath).href;
  if (!fileUrl.endsWith('/')) fileUrl += '/';
  return fileUrl;
}

async function removeBgWithImgly(imgBuffer) {
  if (!imglyModule) {
    imglyModule = require('@imgly/background-removal-node');
  }
  const removeBackground = imglyModule.removeBackground || imglyModule.default;
  const publicPath = getImglyPublicPath();
  fs.appendFileSync(logFile, `[imgly] Executando com publicPath: ${publicPath}\n`);
  const blobIn = new Blob([imgBuffer], { type: 'image/png' });
  const blobOut = await removeBackground(blobIn, { publicPath });
  const ab = await blobOut.arrayBuffer();
  return Buffer.from(ab);
}

function getRembgExePath() {
  // 1. Empacotado no build (extraResources)
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, 'rembg_server', 'rembg_server.exe');
    if (fs.existsSync(packed)) return { exe: packed, args: [], source: 'empacotado' };
  }
  // 2. Em desenvolvimento (dist local)
  const devPath = path.join(__dirname, 'dist', 'rembg_server', 'rembg_server.exe');
  if (fs.existsSync(devPath)) return { exe: devPath, args: [], source: 'dev-local' };
  // 3. Fallback: Python do sistema com script
  try {
    const { execSync } = require('child_process');
    execSync('python -c "import rembg"', { stdio: 'ignore', timeout: 2500 });
    let scriptPath = process.resourcesPath ? path.join(process.resourcesPath, 'scripts', 'remove_bg.py') : null;
    if (!scriptPath || !fs.existsSync(scriptPath)) scriptPath = path.join(__dirname, 'scripts', 'remove_bg.py');
    if (fs.existsSync(scriptPath)) return { exe: 'python', args: [scriptPath], source: 'python-sistema' };
  } catch (e) { /* Python indisponível */ }
  return null;
}

function startRembgProcess() {
  if (rembgProcess) return;
  
  const rembgInfo = getRembgExePath();
  if (!rembgInfo) {
    fs.appendFileSync(logFile, `[rembg] Nenhum motor BiRefNet encontrado (exe empacotado, dev-local ou Python). Usando @imgly.\n`);
    return;
  }
  
  fs.appendFileSync(logFile, `[rembg] Iniciando motor BiRefNet (${rembgInfo.source}): ${rembgInfo.exe} ${rembgInfo.args.join(' ')}\n`);
  
  const { spawn } = require('child_process');
  
  try {
    rembgProcess = spawn(rembgInfo.exe, rembgInfo.args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (rembgProcess.stdin) {
      rembgProcess.stdin.on('error', (err) => {
        fs.appendFileSync(logFile, `[rembg] stdin erro capturado: ${err.message}\n`);
      });
    }

    rembgProcess.on('error', (err) => {
      fs.appendFileSync(logFile, `[rembg] Erro no spawn do Python: ${err.message}\n`);
      rembgProcess = null;
      rembgReady = false;
      if (rembgPendingResolve) {
        rembgPendingResolve('ERROR|Python indisponível');
        rembgPendingResolve = null;
      }
    });

    rembgProcess.stdout.on('data', (data) => {
      rembgBuffer += data.toString();
      const lines = rembgBuffer.split('\n');
      rembgBuffer = lines.pop(); // Guardar linha incompleta
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        fs.appendFileSync(logFile, `[rembg] stdout: ${trimmed}\n`);
        
        if (trimmed === 'LOADING') {
          fs.appendFileSync(logFile, `[rembg] Carregando modelos (BRIA RMBG-2.0 + BiRefNet)...\n`);
        } else if (trimmed === 'READY') {
          rembgReady = true;
          fs.appendFileSync(logFile, `[rembg] Modelo carregado! Pronto para processar.\n`);
          if (rembgPendingResolve) {
            rembgPendingResolve('READY');
            rembgPendingResolve = null;
          }
        } else if (trimmed.startsWith('OK|') || trimmed.startsWith('ERROR|')) {
          if (rembgPendingResolve) {
            rembgPendingResolve(trimmed);
            rembgPendingResolve = null;
          }
        }
      }
    });
    
    rembgProcess.stderr.on('data', (data) => {
      fs.appendFileSync(logFile, `[rembg] stderr: ${data.toString().substring(0, 200)}\n`);
    });
    
    rembgProcess.on('close', (code) => {
      fs.appendFileSync(logFile, `[rembg] Processo encerrado (code ${code})\n`);
      rembgProcess = null;
      rembgReady = false;
      if (rembgPendingResolve) {
        rembgPendingResolve('ERROR|Processo encerrado');
        rembgPendingResolve = null;
      }
    });
  } catch (err) {
    fs.appendFileSync(logFile, `[rembg] Exceção ao iniciar Python: ${err.message}\n`);
    rembgProcess = null;
    rembgReady = false;
  }
}

function sendToRembg(command) {
  return new Promise((resolve, reject) => {
    if (!rembgProcess || !rembgProcess.stdin || !rembgProcess.stdin.writable) {
      reject(new Error('Processo rembg não iniciado ou stdin fechado'));
      return;
    }
    rembgPendingResolve = resolve;
    try {
      rembgProcess.stdin.write(command + '\n');
    } catch (err) {
      rembgPendingResolve = null;
      reject(err);
      return;
    }
    
    // Timeout de 60 segundos (BRIA pode demorar mais)
    setTimeout(() => {
      if (rembgPendingResolve === resolve) {
        rembgPendingResolve = null;
        reject(new Error('Timeout ao processar imagem via Python'));
      }
    }, 60000);
  });
}

function waitForRembgReady(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (rembgReady) { resolve('READY'); return; }
    const timer = setTimeout(() => {
      resolve('TIMEOUT');
    }, timeoutMs);
    const prev = rembgPendingResolve;
    rembgPendingResolve = (msg) => {
      clearTimeout(timer);
      if (prev) prev(msg);
      resolve(msg);
    };
  });
}

// IPC Handler - Remover fundo via rembg (BiRefNet - processo persistente)

async function removeWhiteBackgroundBuffer(imgBuffer) {
  const { data, info } = await sharp(imgBuffer).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Flood fill suave a partir das 4 bordas para remover apenas o fundo branco externo conectado
  const isBg = new Uint8Array(width * height);
  const queue = [];

  const isWhitePixel = (pos) => {
    const idx = pos * channels;
    const a = channels === 4 ? data[idx + 3] : 255;
    if (a < 20) return true;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    const minC = Math.min(r, g, b);
    const maxC = Math.max(r, g, b);
    return minC >= 238 && (maxC - minC) < 18;
  };

  // Enfileirar pixels brancos das bordas
  for (let x = 0; x < width; x++) {
    const topPos = x;
    const bottomPos = (height - 1) * width + x;
    if (isWhitePixel(topPos)) { isBg[topPos] = 1; queue.push(topPos); }
    if (isWhitePixel(bottomPos)) { isBg[bottomPos] = 1; queue.push(bottomPos); }
  }
  for (let y = 0; y < height; y++) {
    const leftPos = y * width;
    const rightPos = y * width + (width - 1);
    if (!isBg[leftPos] && isWhitePixel(leftPos)) { isBg[leftPos] = 1; queue.push(leftPos); }
    if (!isBg[rightPos] && isWhitePixel(rightPos)) { isBg[rightPos] = 1; queue.push(rightPos); }
  }

  // BFS para espalhar pelo fundo branco externo
  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const cx = curr % width;
    const cy = Math.floor(curr / width);

    const neighbors = [
      cx > 0 ? curr - 1 : -1,
      cx < width - 1 ? curr + 1 : -1,
      cy > 0 ? curr - width : -1,
      cy < height - 1 ? curr + width : -1
    ];

    for (const n of neighbors) {
      if (n !== -1 && !isBg[n] && isWhitePixel(n)) {
        isBg[n] = 1;
        queue.push(n);
      }
    }
  }

  // Montar buffer RGBA final
  const outBuf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * channels;
    const dstIdx = i * 4;
    outBuf[dstIdx] = data[srcIdx];
    outBuf[dstIdx + 1] = data[srcIdx + 1];
    outBuf[dstIdx + 2] = data[srcIdx + 2];
    if (isBg[i]) {
      outBuf[dstIdx + 3] = 0;
    } else {
      outBuf[dstIdx + 3] = channels === 4 ? data[srcIdx + 3] : 255;
    }
  }

  return await sharp(outBuf, { raw: { width, height, channels: 4 } }).png().toBuffer();
}



// Classificador Híbrido: Camada 1 (Sharp 3ms) + Camada 2 (Gemini Vision Tira-teima)
async function classifyImageHybrid(imgBuffer, productName = '', apiKey = '') {
  try {
    const { data, info } = await sharp(imgBuffer)
      .resize(300, 300, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    // 1. Amostragem das 4 bordas externas
    let whiteBorder = 0;
    let totalBorder = 0;
    for (let x = 0; x < width; x += 10) {
      for (const y of [0, height - 1]) {
        const idx = (y * width + x) * channels;
        const a = channels === 4 ? data[idx + 3] : 255;
        if (a < 20 || (data[idx] >= 235 && data[idx + 1] >= 235 && data[idx + 2] >= 235)) whiteBorder++;
        totalBorder++;
      }
    }
    for (let y = 0; y < height; y += 10) {
      for (const x of [0, width - 1]) {
        const idx = (y * width + x) * channels;
        const a = channels === 4 ? data[idx + 3] : 255;
        if (a < 20 || (data[idx] >= 235 && data[idx + 1] >= 235 && data[idx + 2] >= 235)) whiteBorder++;
        totalBorder++;
      }
    }
    const isWhiteBg = (whiteBorder / totalBorder) > 0.80;

    // 2. Bounding box dos pixels do produto
    let minX = width, maxX = 0, minY = height, maxY = 0;
    let solidCount = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const idx = (y * width + x) * channels;
        const a = channels === 4 ? data[idx + 3] : 255;
        const isSolid = a > 20 && (data[idx] < 238 || data[idx + 1] < 238 || data[idx + 2] < 238);
        if (isSolid) {
          solidCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX <= minX || maxY <= minY) return 'object';

    const bw = maxX - minX;
    const bh = maxY - minY;
    const fillRatio = solidCount / ((bw / 2) * (bh / 2));

    // 3. Cantos do bounding box (amostra de 8% da dimensão)
    const csX = Math.max(2, Math.round(bw * 0.08));
    const csY = Math.max(2, Math.round(bh * 0.08));
    let cornerFilled = 0;
    const checkCorner = (sx, sy) => {
      let s = 0, tot = 0;
      for (let cy = sy; cy < sy + csY; cy += 2) {
        for (let cx = sx; cx < sx + csX; cx += 2) {
          if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
          const idx = (cy * width + cx) * channels;
          const a = channels === 4 ? data[idx + 3] : 255;
          if (a > 20 && (data[idx] < 238 || data[idx + 1] < 238 || data[idx + 2] < 238)) s++;
          tot++;
        }
      }
      return tot > 0 && (s / tot) > 0.35;
    };

    if (checkCorner(minX, minY)) cornerFilled++;
    if (checkCorner(maxX - csX, minY)) cornerFilled++;
    if (checkCorner(minX, maxY - csY)) cornerFilled++;
    if (checkCorner(maxX - csX, maxY - csY)) cornerFilled++;

    // Contexto de palavras-chave
    const pkgKeywords = /\b(semente|sementes|envelope|envelopes|pacote|pacotes|cartela|cartelas|blister|sache|saches|caixa|caixas|display|refil|lata|latas)\b/i;
    const nameSuggestsPkg = pkgKeywords.test(productName);

    // CAMADA 1: Alta Certeza Instantânea (3ms)
    if (isWhiteBg) {
      if ((fillRatio >= 0.85 && cornerFilled >= 3) || (nameSuggestsPkg && fillRatio >= 0.76)) {
        return 'packaging';
      }
      if (fillRatio < 0.70 && !nameSuggestsPkg) {
        return 'object';
      }
    } else {
      if (fillRatio >= 0.92 && cornerFilled === 4 && nameSuggestsPkg) {
        return 'packaging';
      }
      if (fillRatio < 0.75) {
        return 'object';
      }
    }

    // Se o nome não sugere embalagem e os cantos não estão preenchidos como cartela retangular, é objeto (0ms instantâneo)
    if (!nameSuggestsPkg && cornerFilled <= 2) {
      return 'object';
    }

    // CAMADA 2: Tira-teima com Gemini Vision (se houver ambiguidade e chave da API)
    if (apiKey) {
      try {
        const smallJpg = await sharp(imgBuffer)
          .resize(512, 512, { fit: 'inside' })
          .jpeg({ quality: 80 })
          .toBuffer();

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(1000), // Limite de 1s para nunca prender a interface
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: 'Analise esta foto de produto de e-commerce. O item exibido é uma EMBALAGEM/CARTELA (como um pacote de sementes, caixa, blister, sachê, saco, pote ou produto onde a arte impressa com textos/rótulos é o produto) ou é um OBJETO_SOLTO (como uma ferramenta, calçado, garrafa/peça isolada sem cartela exterior)? Responda estritamente com apenas uma palavra: EMBALAGEM ou OBJETO.' },
                { inline_data: { mime_type: 'image/jpeg', data: smallJpg.toString('base64') } }
              ]
            }]
          })
        });

        if (response.ok) {
          const resData = await response.json();
          const answer = resData.candidates?.[0]?.content?.parts?.[0]?.text?.toUpperCase() || '';
          if (answer.includes('EMBALAGEM')) return 'packaging';
          if (answer.includes('OBJETO')) return 'object';
        }
      } catch (geminiErr) {
        console.warn('[detectMode] Fallback Gemini Vision falhou, usando heurística:', geminiErr.message);
      }
    }

    // Fallback padrão se não houver internet/chave
    return (nameSuggestsPkg || (fillRatio >= 0.80 && cornerFilled >= 3)) ? 'packaging' : 'object';
  } catch (err) {
    console.error('[detectMode] Erro:', err);
    return 'object';
  }
}

ipcMain.handle('image:detectMode', async (event, { base64Data, productName, apiKey }) => {
  try {
    const rawBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const imgBuffer = Buffer.from(rawBase64, 'base64');
    const mode = await classifyImageHybrid(imgBuffer, productName, apiKey);
    return { success: true, mode };
  } catch (err) {
    console.error('Erro image:detectMode:', err);
    return { success: false, mode: 'object' };
  }
});

ipcMain.handle('image:removeWhiteBg', async (event, base64Data) => {
  try {
    const rawBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const imgBuffer = Buffer.from(rawBase64, 'base64');
    const resultBuffer = await removeWhiteBackgroundBuffer(imgBuffer);
    return {
      success: true,
      base64: `data:image/png;base64,${resultBuffer.toString('base64')}`,
      format: 'png'
    };
  } catch (err) {
    console.error('Erro removeWhiteBg:', err);
    throw err;
  }
});

ipcMain.handle('image:removeBgChroma', async (event, { base64Data, apiKey, mode = 'auto' }) => {
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] Iniciando remoção de fundo (modo: ${mode}, rembg / @imgly)...\n`);
  
  try {
    const rawBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const imgBuffer = Buffer.from(rawBase64, 'base64');
    
    let processedBuffer = null;
    let elapsed = 0;
    
    // 1. Tentar motor Python persistente (U2Net, IS-Net, BRIA)
    if (getRembgExePath()) {
      try {
        if (!rembgProcess) {
          startRembgProcess();
          fs.appendFileSync(logFile, `[rembg] Aguardando modelo carregar (primeira vez, até 60s)...\n`);
          await waitForRembgReady(60000);
        }
        
        if (rembgProcess && rembgReady) {
          const tempDir = path.join(app.getPath('temp'), 'multipic-rembg');
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          
          const ts = Date.now();
          const inputPath = path.join(tempDir, `input_${ts}.png`);
          const outputPath = path.join(tempDir, `output_${ts}.png`);
          
          await sharp(imgBuffer).rotate().png().toFile(inputPath);
          fs.appendFileSync(logFile, `[rembg] Enviando para processamento Python (modo=${mode})...\n`);
          const startTime = Date.now();
          
          const result = await sendToRembg(`${inputPath}|${outputPath}|${mode}`);
          elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          fs.appendFileSync(logFile, `[rembg] Resultado Python em ${elapsed}s: ${result}\n`);
          
          try { fs.unlinkSync(inputPath); } catch {}
          
          if (!result.startsWith('ERROR|') && fs.existsSync(outputPath)) {
            processedBuffer = fs.readFileSync(outputPath);
            try { fs.unlinkSync(outputPath); } catch {}
          }
        }
      } catch (pythonErr) {
        fs.appendFileSync(logFile, `[rembg] Falha no motor Python (${pythonErr.message}), caindo para motor nativo @imgly.\n`);
      }
    }
    
    // 2. Fallback nativo: @imgly/background-removal-node (Node.js/ONNX) sem depender de Python
    if (!processedBuffer) {
      fs.appendFileSync(logFile, `[rembg] Processando via motor nativo @imgly (ONNX)...\n`);
      const startTime = Date.now();
      try {
        const pngInput = await sharp(imgBuffer).rotate().png().toBuffer();
        processedBuffer = await removeBgWithImgly(pngInput);
        elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        fs.appendFileSync(logFile, `[rembg] Motor nativo @imgly concluído em ${elapsed}s!\n`);
      } catch (imglyErr) {
        fs.appendFileSync(logFile, `[rembg] Motor @imgly falhou (${imglyErr.message}), tentando recorte Sharp...\n`);
      }
    }
    
    // 3. Fallback final garantido: remoção de fundo branco com Sharp puro (zero dependência)
    if (!processedBuffer) {
      fs.appendFileSync(logFile, `[rembg] Usando fallback Sharp removeWhiteBackgroundBuffer...\n`);
      try {
        processedBuffer = await removeWhiteBackgroundBuffer(imgBuffer);
      } catch (sharpErr) {
        fs.appendFileSync(logFile, `[rembg] Recorte Sharp falhou: ${sharpErr.message}\n`);
      }
    }
    
    if (!processedBuffer) {
      throw new Error('Não foi possível remover o fundo da imagem.');
    }
    
    // Trim + centralização quadrada (via Sharp)
    const trimmedBuffer = await sharp(processedBuffer)
      .trim()
      .png()
      .toBuffer();
    
    const trimmedMeta = await sharp(trimmedBuffer).metadata();
    const tw = trimmedMeta.width;
    const th = trimmedMeta.height;
    
    const maxDim = Math.max(tw, th);
    const margin = Math.round(maxDim * 0.05);
    const squareSize = maxDim + (margin * 2);
    
    const padLeft = Math.round((squareSize - tw) / 2);
    const padRight = squareSize - tw - padLeft;
    const padTop = Math.round((squareSize - th) / 2);
    const padBottom = squareSize - th - padTop;
    
    const squareBuffer = await sharp(trimmedBuffer)
      .extend({
        top: padTop,
        bottom: padBottom,
        left: padLeft,
        right: padRight,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();
    
    const resultBase64 = squareBuffer.toString('base64');
    
    fs.appendFileSync(logFile, `[rembg] Concluído com sucesso em ${elapsed}s! Trimmed: ${tw}x${th}, Square: ${squareSize}x${squareSize}\n`);
    
    return {
      base64: `data:image/png;base64,${resultBase64}`,
      format: 'png'
    };
  } catch (error) {
    const errMsg = error.stack || error.message || String(error);
    fs.appendFileSync(logFile, `[rembg] ERRO: ${errMsg}\n`);
    throw new Error(error.message || 'Erro ao remover fundo via rembg');
  }
});

// ============================================================
// Sankhya - Helpers
// ============================================================
const SANKHYA_DEFAULT_CLIENT_ID = '8897fb53-3515-443d-a0b0-78a0af796756';

function getSankhyaBaseUrl(environment) {
  return environment === 'sandbox' 
    ? 'https://api.sandbox.sankhya.com.br' 
    : 'https://api.sankhya.com.br';
}

async function authenticateSankhya({ clientId, secret, token, environment }) {
  const baseUrl = getSankhyaBaseUrl(environment);
  const cid = (clientId || SANKHYA_DEFAULT_CLIENT_ID).trim();
  const trimmedSecret = (secret || '').trim();
  const trimmedToken = (token || '').trim();
  
  fs.appendFileSync(logFile, `[Sankhya] Autenticando (${environment || 'production'}) em ${baseUrl}...\n`);
  
  const authBody = new URLSearchParams({
    client_id: cid,
    client_secret: trimmedSecret,
    grant_type: 'client_credentials'
  });
  
  const authResponse = await fetch(`${baseUrl}/authenticate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'X-Token': trimmedToken,
    },
    body: authBody.toString()
  });
  
  if (!authResponse.ok) {
    const authError = await authResponse.text();
    fs.appendFileSync(logFile, `[Sankhya] Erro autenticação HTTP ${authResponse.status}: ${authError}\n`);
    throw new Error(`Falha na autenticação Sankhya (HTTP ${authResponse.status}): ${authError}`);
  }
  
  const authData = await authResponse.json();
  const accessToken = authData.access_token || authData.bearerToken || authData.token;
  
  if (!accessToken) {
    fs.appendFileSync(logFile, `[Sankhya] Resposta auth sem token: ${JSON.stringify(authData)}\n`);
    throw new Error('Autenticação Sankhya não retornou access_token');
  }
  
  fs.appendFileSync(logFile, `[Sankhya] Autenticado! Token obtido.\n`);
  return { accessToken, baseUrl };
}

// Cache do token Sankhya para evitar reautenticações desnecessárias
let sankhyaCachedToken = null;
let sankhyaTokenExpiry = 0;

/**
 * Obtém token Sankhya com cache e auto-refresh (expira em 50 minutos).
 * Se o token em cache ainda for válido, retorna-o diretamente.
 */
async function getSankhyaToken(settings) {
  try {
    // Aceitar tanto formato completo (sankhyaEnvironment) quanto reduzido (environment)
    const environment = settings.sankhyaEnvironment || settings.environment || 'sandbox';
    const clientId = settings.sankhyaClientId || settings.clientId;
    const secret = settings.sankhyaSecret || settings.secret;
    const token = settings.sankhyaToken || settings.token;
    
    const baseUrl = getSankhyaBaseUrl(environment);
    
    // Verifica se o token em cache ainda é válido
    if (sankhyaCachedToken && Date.now() < sankhyaTokenExpiry) {
      fs.appendFileSync(logFile, `[Sankhya] Usando token em cache (expira em ${Math.round((sankhyaTokenExpiry - Date.now()) / 60000)} min)\n`);
      return { accessToken: sankhyaCachedToken, baseUrl };
    }
    
    // Token expirado ou inexistente, autentica novamente
    fs.appendFileSync(logFile, `[Sankhya] Token expirado ou inexistente, reautenticando...\n`);
    const result = await authenticateSankhya({
      clientId,
      secret,
      token,
      environment
    });
    
    // Salva no cache com expiração de 50 minutos
    sankhyaCachedToken = result.accessToken;
    sankhyaTokenExpiry = Date.now() + 50 * 60 * 1000;
    
    fs.appendFileSync(logFile, `[Sankhya] Token cacheado (válido por 50 minutos)\n`);
    return result;
  } catch (error) {
    throw error;
  }
}

// Fetch com retry automático quando Bearer expira (403)
async function sankhyaFetchWithRetry(url, options, settings, logFile) {
  let response = await fetch(url, options);
  
  if (response.status === 403) {
    const body = await response.text();
    if (body.includes('Expirado') || body.includes('GTW3403')) {
      fs.appendFileSync(logFile, '[Sankhya] Bearer expirado, renovando silenciosamente...\n');
      // Limpar cache e reautenticar
      sankhyaCachedToken = null;
      sankhyaTokenExpiry = 0;
      const refreshed = await getSankhyaToken(settings);
      
      // Atualizar header Authorization
      const newOptions = { ...options, headers: { ...options.headers, 'Authorization': 'Bearer ' + refreshed.accessToken } };
      response = await fetch(url, newOptions);
      fs.appendFileSync(logFile, '[Sankhya] Retry com novo token: HTTP ' + response.status + '\n');
    }
  }
  return response;
}


// ============================================================
// IPC Handlers - Sankhya (Busca de Produto)
// ============================================================
ipcMain.handle('sankhya:query', async (event, { sku, secret, token, query, environment, clientId }) => {
  let sqlQuery;
  if (query.match(/\{SKU\}/i)) {
    sqlQuery = query.replace(/\{SKU\}/gi, sku);
  } else {
    const whereIdx = query.toUpperCase().indexOf('WHERE');
    if (whereIdx !== -1) {
      sqlQuery = query.substring(0, whereIdx) + `WHERE p.CODPROD = ${sku}`;
    } else {
      sqlQuery = query.trimEnd();
      if (sqlQuery.endsWith(';')) sqlQuery = sqlQuery.slice(0, -1);
      sqlQuery += `\nWHERE p.CODPROD = ${sku}`;
    }
  }
  
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [Sankhya] Buscando SKU: ${sku}\n`);
  fs.appendFileSync(logFile, `[Sankhya] Query: ${sqlQuery}\n`);
  
  try {
    const { accessToken, baseUrl } = await authenticateSankhya({ clientId, secret, token, environment });
    
    const response = await fetch(`${baseUrl}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        serviceName: 'DbExplorerSP.executeQuery',
        requestBody: {
          sql: sqlQuery
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      fs.appendFileSync(logFile, `[Sankhya] Erro query HTTP ${response.status}: ${errorText}\n`);
      throw new Error(`Sankhya retornou HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    const rowsCount = data?.responseBody?.rows ? (Array.isArray(data.responseBody.rows) ? data.responseBody.rows.length : 'não-array') : 'sem-rows';
    fs.appendFileSync(logFile, `[Sankhya] Resposta (rows: ${rowsCount}): ${JSON.stringify(data).substring(0, 2000)}\n`);
    return data;
  } catch (error) {
    fs.appendFileSync(logFile, `[Sankhya] ERRO: ${error.message}\n`);
    throw new Error(error.message || 'Erro ao consultar Sankhya');
  }
});

// ============================================================
// IPC Handlers - Sankhya (Endereço no CD)
// ============================================================
ipcMain.handle('sankhya:getWarehouseAddress', async (event, { sku, secret, token, environment, clientId }) => {
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [Sankhya] Buscando endereço CD para SKU: ${sku}\n`);
  try {
    const { accessToken, baseUrl } = await authenticateSankhya({ clientId, secret, token, environment });
    const sql = `SELECT ENDWMS.ENDERECO FROM TGFPRO PRO INNER JOIN TGWEST EST ON EST.CODPROD = PRO.CODPROD AND EST.ESTOQUE > 0 INNER JOIN TGWEND ENDWMS ON ENDWMS.CODEND = EST.CODEND AND ENDWMS.ENDERECO NOT LIKE '01.90%' INNER JOIN tsiusu usu ON usu.CODUSU = pro.CODUSU WHERE PRO.UTILIZAWMS = 'S' AND pro.CODPROD = ${sku} ORDER BY ENDWMS.ENDERECO`;
    const response = await fetch(`${baseUrl}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', requestBody: { sql } })
    });
    const data = await response.json().catch(() => null);
    const addresses = [];
    if (data?.responseBody?.rows && Array.isArray(data.responseBody.rows)) {
      for (const row of data.responseBody.rows) {
        const addr = Array.isArray(row) ? row[0] : Object.values(row)[0];
        if (addr) addresses.push(String(addr).trim());
      }
    }
    fs.appendFileSync(logFile, `[Sankhya] Endereços CD SKU ${sku}: ${addresses.length} encontrado(s)\n`);
    return { success: true, addresses };
  } catch (error) {
    fs.appendFileSync(logFile, `[Sankhya] ERRO endereço CD: ${error.message}\n`);
    return { success: false, addresses: [], error: error.message };
  }
});

// ============================================================
// IPC Handlers - Sankhya (Status do Produto - Fotos Alternativas)
// ============================================================
ipcMain.handle('sankhya:getProductStatus', async (event, { sku, secret, token, environment, clientId }) => {
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [Sankhya] Buscando status produto SKU: ${sku}\n`);
  try {
    const { accessToken, baseUrl } = await authenticateSankhya({ clientId, secret, token, environment });
    const sql = `SELECT COUNT(*) AS QTD FROM TGFIMAL WHERE CODPROD = ${sku}`;
    const response = await fetch(`${baseUrl}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ serviceName: 'DbExplorerSP.executeQuery', requestBody: { sql } })
    });
    const data = await response.json().catch(() => null);
    let altCount = 0;
    if (data?.responseBody?.rows && Array.isArray(data.responseBody.rows) && data.responseBody.rows.length > 0) {
      const row = data.responseBody.rows[0];
      altCount = Number(Array.isArray(row) ? row[0] : Object.values(row)[0]) || 0;
    }
    fs.appendFileSync(logFile, `[Sankhya] Status SKU ${sku}: ${altCount} fotos alternativas\n`);
    return { success: true, altCount };
  } catch (error) {
    fs.appendFileSync(logFile, `[Sankhya] ERRO status produto: ${error.message}\n`);
    return { success: false, altCount: 0, error: error.message };
  }
});

// ============================================================
// IPC Handlers - Sankhya (Salvar Descrição)
// ============================================================
ipcMain.handle('sankhya:saveDescription', async (event, { sku, description, secret, token, environment, clientId }) => {
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [Sankhya] Salvando descrição SKU: ${sku} (${description.length} chars)\n`);
  
  try {
    const { accessToken, baseUrl } = await authenticateSankhya({ clientId, secret, token, environment });
    
    fs.appendFileSync(logFile, `[Sankhya] Usando CRUDServiceProvider.saveRecord para CODPROD=${sku}\n`);
    
    const response = await fetch(`${baseUrl}/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.saveRecord&outputType=json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        serviceName: 'CRUDServiceProvider.saveRecord',
        requestBody: {
          dataSet: {
            rootEntity: 'Produto',
            includePresentationFields: 'N',
            dataRow: {
              localFields: {
                CARACTERISTICAS: { '$': description }
              },
              key: {
                CODPROD: { '$': String(sku) }
              }
            },
            entity: {
              fieldset: {
                list: 'CODPROD,CARACTERISTICAS'
              }
            }
          }
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      fs.appendFileSync(logFile, `[Sankhya] Erro salvar HTTP ${response.status}: ${errorText}\n`);
      throw new Error(`Sankhya retornou HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    fs.appendFileSync(logFile, `[Sankhya] Salvo: ${JSON.stringify(data).substring(0, 500)}\n`);
    
    // Verificar se houve erro na resposta
    if (data?.status === '0') {
      throw new Error(data.statusMessage || 'Erro desconhecido ao salvar');
    }
    
    return { success: true, data };
  } catch (error) {
    fs.appendFileSync(logFile, `[Sankhya] ERRO salvar: ${error.message}\n`);
    throw new Error(error.message || 'Erro ao salvar no Sankhya');
  }
});
// ============================================================
// IPC Handlers - Sankhya (Imagens Alternativas - TGFIMAL)
// ============================================================
ipcMain.handle('sankhya:saveAlternativeImages', async (event, { sku, images, secret, token, environment, clientId, settings }) => {
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [Sankhya] Registrando ${images.length} imagem(ns) alternativa(s) para SKU: ${sku}\n`);
  
  try {
    const { accessToken, baseUrl } = await authenticateSankhya({ clientId, secret, token, environment });

    const results = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const nomearq = img.fileName;

      // Verificar se já existe na TGFIMAL para este CODPROD e NOMEARQ
      try {
        const checkRes = await fetch(`${baseUrl}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify({
            serviceName: 'DbExplorerSP.executeQuery',
            requestBody: { sql: `SELECT COUNT(*) FROM TGFIMAL WHERE CODPROD = ${sku} AND NOMEARQ = '${nomearq}'` }
          })
        });
        const checkData = await checkRes.json().catch(() => null);
        const exists = Number(checkData?.responseBody?.rows?.[0]?.[0] || 0) > 0;
        if (exists) {
          fs.appendFileSync(logFile, `[Sankhya TGFIMAL] ${nomearq} já existe para SKU ${sku}. Não duplicando.\n`);
          results.push({ fileName: nomearq, success: true, alreadyExists: true });
          continue;
        }
      } catch (checkErr) {
        fs.appendFileSync(logFile, `[Sankhya TGFIMAL] Aviso ao checar duplicata: ${checkErr.message}\n`);
      }

      // Usar a entidade oficial ImagemAlternativaProduto com CODUSU: '0'
      const crudBody = {
        serviceName: 'CRUDServiceProvider.saveRecord',
        requestBody: {
          dataSet: {
            rootEntity: 'ImagemAlternativaProduto',
            includePresentationFields: 'N',
            dataRow: {
              localFields: {
                CODPROD: { '$': String(sku) },
                NOMEARQ: { '$': nomearq },
                CODUSU: { '$': '0' }
              }
            },
            entity: { fieldset: { list: 'CODPROD,NOMEARQ,CODUSU' } }
          }
        }
      };

      const crudResponse = await fetch(`${baseUrl}/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.saveRecord&outputType=json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(crudBody)
      });
      const crudData = await crudResponse.json().catch(() => null);
      fs.appendFileSync(logFile, `[Sankhya TGFIMAL] Resposta para ${nomearq}: ${JSON.stringify(crudData)}\n`);

      if (crudResponse.ok && crudData?.status === '1') {
        const nuimg = crudData?.responseBody?.entities?.entity?.NUIMG?.['$'] || 'OK';
        fs.appendFileSync(logFile, `[Sankhya TGFIMAL] SUCESSO: ${nomearq} gravado com NUIMG=${nuimg}\n`);
        results.push({ fileName: nomearq, success: true, nuimg });
      } else {
        const msg = crudData?.statusMessage || `HTTP ${crudResponse.status}`;
        fs.appendFileSync(logFile, `[Sankhya TGFIMAL] Erro ao gravar ${nomearq}: ${msg}\n`);
        results.push({ fileName: nomearq, success: false, error: msg });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return { success: successCount === images.length, results, successCount, total: images.length };
  } catch (error) {
    fs.appendFileSync(logFile, `[Sankhya] ERRO TGFIMAL: ${error.message}\n`);
    throw new Error(error.message || 'Erro ao registrar imagens alternativas no Sankhya');
  }
});

/**
 * Executa comandos SQL no Oracle diretamente no servidor Linux via SSH
 */
function executeSqlViaSsh(sqlList, settings) {
  return new Promise((resolve, reject) => {
    const { Client } = require('ssh2');
    const conn = new Client();
    
    conn.on('ready', () => {
      const sqlScript = sqlList.map(s => s.trim().endsWith(';') ? s.trim() : s.trim() + ';').join('\n') + '\nCOMMIT;\nEXIT;\n';
      
      const cmd = `
# Lista todas as pastas de Wildfly e configuracoes de teste no servidor
echo "=== PASTAS DE WILDFLY ENCONTRADAS ==="
ls -la /home/mgeweb/ 2>/dev/null

echo "=== DATASOURCES DE TODOS OS AMBIENTES (TESTE / HOMOLOG / PROD) ==="
find /home/mgeweb/ -name "standalone*.xml" 2>/dev/null | while read xmlFile; do
  echo "--- ARQUIVO: $xmlFile ---"
  sed -n '/<datasource /,/<\\/datasource>/p' "$xmlFile" 2>/dev/null
done
`;
      conn.exec(cmd, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        let output = '';
        let errorOutput = '';
        stream.on('close', (code, signal) => {
          conn.end();
          resolve({ code, output, errorOutput });
        }).on('data', (data) => {
          output += data.toString();
        }).stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect({
      host: settings.sankhyaFtpHost || '192.168.10.140',
      port: 22,
      username: settings.sankhyaFtpUser || 'root',
      password: settings.sankhyaFtpPassword || 'C@ssul',
      readyTimeout: 15000
    });
  });
}

// ============================================================
// IPC Handlers - Sankhya (Upload FTP de Imagens)
// ============================================================
ipcMain.handle('sankhya:uploadImagesFTP', async (event, { files, settings, profile }) => {
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [FTP] Iniciando upload de ${files.length} arquivo(s)...\n`);
  
  const host = settings.sankhyaFtpHost;
  const user = settings.sankhyaFtpUser;
  const password = settings.sankhyaFtpPassword;
  const remotePath = settings.sankhyaFtpPath;
  
  // Tentar SFTP primeiro (porta 22), depois FTP (porta 21)
  try {
    fs.appendFileSync(logFile, `[SFTP] Tentando SFTP em ${host}:22 (usuário: ${user})...\n`);
    const SftpClient = require('ssh2-sftp-client');
    const sftp = new SftpClient();
    
    await sftp.connect({
      host: host,
      port: 22,
      username: user,
      password: password,
      readyTimeout: 10000
    });
    
    fs.appendFileSync(logFile, `[SFTP] Conectado via SFTP!\n`);
    
    let uploadedCount = 0;
    for (const file of files) {
      try {
        const cleanBase64 = (file.buffer || file.base64 || '').replace(/^data:image\/\w+;base64,/, '');
        let buffer = Buffer.from(cleanBase64, 'base64');
        // Redimensionar e formatar RIGOROSAMENTE conforme o perfil configurado pelo usuário
        try {
          const targetW = profile?.width ? parseInt(profile.width, 10) : 1000;
          const targetH = profile?.height ? parseInt(profile.height, 10) : 1000;
          const targetQ = profile?.quality ? parseInt(profile.quality, 10) : 100;
          const bgConfig = (!profile || profile.background === 'transparent') ? { r: 0, g: 0, b: 0, alpha: 0 } : profile.background;
          
          buffer = await sharp(buffer)
            .resize(targetW, targetH, { fit: 'contain', background: bgConfig })
            .png({ quality: targetQ })
            .toBuffer();
          fs.appendFileSync(logFile, `[SFTP] Imagem redimensionada para regra do perfil (${targetW}x${targetH} PNG): ${file.fileName} (${Math.round(buffer.length / 1024)}KB)\n`);
        } catch (resizeErr) {
          fs.appendFileSync(logFile, `[SFTP] Aviso processamento ${file.fileName}: ${resizeErr.message}. Enviando original.\n`);
        }
        const remoteFile = `${remotePath}/${file.fileName}`;
        fs.appendFileSync(logFile, `[SFTP] Enviando ${file.fileName} (${Math.round(buffer.length / 1024)}KB) -> ${remoteFile}\n`);
        await sftp.put(buffer, remoteFile);
        // Garantir que o arquivo seja legível pelo servidor web
        try { await sftp.chmod(remoteFile, 0o644); } catch(chmodErr) { 
          fs.appendFileSync(logFile, '[SFTP] chmod falhou: ' + chmodErr.message + '\n');
        }
        // Verificar se o arquivo existe e é legível
        try {
          const stat = await sftp.stat(remoteFile);
          fs.appendFileSync(logFile, '[SFTP] Verificacao: ' + file.fileName + ' existe! Tamanho: ' + stat.size + ' bytes, Permissoes: ' + stat.mode.toString(8) + ', Owner UID: ' + stat.uid + ', GID: ' + stat.gid + '\n');
          // Tentar mudar dono para mgeweb (o Sankhya roda como este usuário)
          try {
            const sshClient = sftp.client;
            if (sshClient && sshClient.exec) {
              await new Promise((resolve, reject) => {
                sshClient.exec('chown mgeweb:mgeweb "' + remoteFile + '" 2>/dev/null; chmod 666 "' + remoteFile + '"', (err, stream) => {
                  if (err) { reject(err); return; }
                  stream.on('close', () => resolve());
                  stream.on('data', () => {});
                  stream.stderr.on('data', () => {});
                });
              });
              fs.appendFileSync(logFile, '[SFTP] chown mgeweb + chmod 666 executado para ' + file.fileName + '\n');
            }
          } catch(chownErr) {
            fs.appendFileSync(logFile, '[SFTP] Aviso chown: ' + chownErr.message + '\n');
          }
        } catch(statErr) {
          fs.appendFileSync(logFile, '[SFTP] ALERTA: Arquivo NAO encontrado apos upload! ' + statErr.message + '\n');
        }
        uploadedCount++;
        fs.appendFileSync(logFile, `[SFTP] Upload OK: ${file.fileName} (chmod 644)\n`);
      } catch (fileErr) {
        fs.appendFileSync(logFile, `[SFTP] Erro ao enviar ${file.fileName}: ${fileErr.message}\n`);
      }
    }
    
    await sftp.end();
    
    // Executar chown via SSH separado para mudar ownership dos arquivos para mgeweb
    try {
      const { Client } = require('ssh2');
      const sshConn = new Client();
      await new Promise((resolve, reject) => {
        sshConn.on('ready', () => {
            const chownCmds = files.map(f => {
            const rFile = remotePath + '/' + f.fileName;
            return 'chown mgeweb:mgeweb "' + rFile + '"; chmod 777 "' + rFile + '"';
          }).join('; ');
          // Adicionar verificação: ls -la e whoami do processo
          const fullCmd = chownCmds + '; echo "---VERIFICACAO---"; ls -la ' + remotePath + '/ | head -20; echo "---WHOAMI---"; whoami; echo "---PROCESSOS JAVA---"; ps aux | grep -i "jboss\\|wildfly\\|java" | head -5';
          
          sshConn.exec(fullCmd, (err, stream) => {
            if (err) {
              fs.appendFileSync(logFile, '[SSH] Erro chown: ' + err.message + '\n');
              sshConn.end();
              resolve();
              return;
            }
            let output = '';
            stream.on('data', (data) => { output += data; });
            stream.stderr.on('data', (data) => { output += data; });
            stream.on('close', () => {
              fs.appendFileSync(logFile, '[SSH] chown mgeweb OK para ' + files.length + ' arquivo(s)\n');
              sshConn.end();
              resolve();
            });
          });
        });
        sshConn.on('error', (err) => {
          fs.appendFileSync(logFile, '[SSH] Erro conexao chown: ' + err.message + '\n');
          resolve();
        });
        sshConn.connect({ host: host, port: 22, username: user, password: password, readyTimeout: 10000 });
      });
    } catch (chownErr) {
      fs.appendFileSync(logFile, '[SSH] Falha geral chown: ' + chownErr.message + '\n');
    }
    
    fs.appendFileSync(logFile, `[SFTP] Concluído: ${uploadedCount}/${files.length} arquivo(s) enviado(s)\n`);
    return { success: true, uploaded: uploadedCount };
    
  } catch (sftpError) {
    fs.appendFileSync(logFile, `[SFTP] Falhou: ${sftpError.message}. Tentando FTP normal...\n`);
    
    // Fallback: FTP normal (porta 21)
    const ftp = require('basic-ftp');
    const { Readable } = require('stream');
    const client = new ftp.Client();
    
    try {
      fs.appendFileSync(logFile, `[FTP] Conectando a ${host}:21 (usuário: ${user})...\n`);
      
      await client.access({
        host: host,
        user: user,
        password: password,
        secure: false
      });
      
      fs.appendFileSync(logFile, `[FTP] Conectado! Entrando no diretório: ${remotePath}\n`);
      await client.cd(remotePath);
      
      let uploadedCount = 0;
      for (const file of files) {
        try {
          let buffer = Buffer.from(file.buffer, 'base64');
          // Redimensionar rigorosamente conforme o perfil configurado
          try {
            const targetW = profile?.width ? parseInt(profile.width, 10) : 1000;
            const targetH = profile?.height ? parseInt(profile.height, 10) : 1000;
            const targetQ = profile?.quality ? parseInt(profile.quality, 10) : 100;
            const bgConfig = (!profile || profile.background === 'transparent') ? { r: 0, g: 0, b: 0, alpha: 0 } : profile.background;

            buffer = await sharp(buffer)
              .resize(targetW, targetH, { fit: 'contain', background: bgConfig })
              .png({ quality: targetQ })
              .toBuffer();
          } catch (resizeErr) {
            fs.appendFileSync(logFile, `[FTP] Aviso: falha ao redimensionar: ${resizeErr.message}\n`);
          }
          fs.appendFileSync(logFile, `[FTP] Enviando ${file.fileName} (${Math.round(buffer.length / 1024)}KB)...\n`);
          await client.uploadFrom(Readable.from(buffer), file.fileName);
          uploadedCount++;
          fs.appendFileSync(logFile, `[FTP] Upload OK: ${file.fileName}\n`);
        } catch (fileErr) {
          fs.appendFileSync(logFile, `[FTP] Erro ao enviar ${file.fileName}: ${fileErr.message}\n`);
        }
      }
      
      fs.appendFileSync(logFile, `[FTP] Concluído: ${uploadedCount}/${files.length} arquivo(s) enviado(s)\n`);
      return { success: true, uploaded: uploadedCount };
    } catch (ftpError) {
      fs.appendFileSync(logFile, `[FTP] ERRO: ${ftpError.message}\n`);
      throw new Error(`SFTP e FTP falharam: ${ftpError.message}`);
    } finally {
      client.close();
      fs.appendFileSync(logFile, `[FTP] Conexão encerrada\n`);
    }
  }
});

// ============================================================
// IPC Handlers - Sankhya (Download Imagem de Referência)
// ============================================================
ipcMain.handle('sankhya:getProductImage', async (event, { codProd, settings }) => {
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [Sankhya] Download imagem referência CODPROD=${codProd}\n`);
  try {
    let { accessToken, baseUrl } = await getSankhyaToken(settings);
    
    // Baixar via endpoint .dbimage (formato correto da API Sankhya)
    const downloadUrl = `${baseUrl}/gateway/v1/mge/Produto@IMAGEM@CODPROD=${codProd}.dbimage`;
    fs.appendFileSync(logFile, `[Sankhya] GET dbimage: ${downloadUrl}\n`);
    
    let response = await fetch(downloadUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    // Se retornar 403 (token expirado no gateway), limpa cache, renova token e tenta novamente
    if (response.status === 403) {
      fs.appendFileSync(logFile, `[Sankhya] dbimage 403: token expirado, renovando token silenciosamente...\n`);
      sankhyaCachedToken = null;
      sankhyaTokenExpiry = 0;
      const refreshed = await getSankhyaToken(settings);
      accessToken = refreshed.accessToken;
      response = await fetch(downloadUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
    }
    
    if (!response.ok) {
      fs.appendFileSync(logFile, `[Sankhya] Imagem não encontrada (HTTP ${response.status})\n`);
      return { success: false, base64: null };
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    // Se retornou HTML ou JSON de erro, não é imagem
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      fs.appendFileSync(logFile, `[Sankhya] Resposta não é imagem (content-type: ${contentType})\n`);
      return { success: false, base64: null };
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    
    if (buffer.length < 100) {
      fs.appendFileSync(logFile, `[Sankhya] Imagem muito pequena (${buffer.length} bytes), ignorando\n`);
      return { success: false, base64: null };
    }
    
    const mimeType = contentType.startsWith('image/') ? contentType : 'image/jpeg';
    const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;
    fs.appendFileSync(logFile, `[Sankhya] Imagem referência baixada: ${Math.round(buffer.length / 1024)}KB\n`);
    
    return { success: true, base64 };
  } catch (error) {
    fs.appendFileSync(logFile, `[Sankhya] ERRO download imagem: ${error.message}\n`);
    return { success: false, base64: null };
  }
});

// ============================================================
// IPC Handlers - Sankhya (Upload Imagem Principal)
// ============================================================
ipcMain.handle('sankhya:uploadMainImage', async (event, { imageBase64, codProd, settings }) => {
  // EXTRA: Também enviar a imagem principal via FTP/SFTP para o diretório de imagens
  try {
    const ftpHost = settings.sankhyaFtpHost;
    const ftpUser = settings.sankhyaFtpUser;
    const ftpPass = settings.sankhyaFtpPassword;
    const ftpPath = settings.sankhyaFtpPath;
    if (ftpHost && ftpUser) {
      const cleanMainB64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const rawBuf = Buffer.from(cleanMainB64, 'base64');
      // Processar foto principal para 300x300 JPG com fundo branco
      const mainImgBuffer = await sharp(rawBuf)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .resize(300, 300, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 90 })
        .toBuffer();
      
      const mainFileName = codProd + '.jpg';
      const remoteFile = ftpPath + '/' + mainFileName;
      
      try {
        const SftpClient = require('ssh2-sftp-client');
        const sftp2 = new SftpClient();
        await sftp2.connect({ host: ftpHost, port: 22, username: ftpUser, password: ftpPass, readyTimeout: 10000 });
        await sftp2.put(mainImgBuffer, remoteFile);
        try { await sftp2.chmod(remoteFile, 0o644); } catch(e) {}
        // Verificar imagem principal e chown
        try {
          const stat2 = await sftp2.stat(remoteFile);
          fs.appendFileSync(logFile, '[SFTP] Verificacao img principal: ' + mainFileName + ' Tamanho: ' + stat2.size + ' UID: ' + stat2.uid + ' GID: ' + stat2.gid + ' Mode: ' + stat2.mode.toString(8) + '\n');
          // chown para mgeweb
          try {
            const sshClient2 = sftp2.client;
            if (sshClient2 && sshClient2.exec) {
              await new Promise((resolve, reject) => {
                sshClient2.exec('chown mgeweb:mgeweb "' + remoteFile + '" 2>/dev/null; chmod 666 "' + remoteFile + '"', (err, stream) => {
                  if (err) { reject(err); return; }
                  stream.on('close', () => resolve());
                  stream.on('data', () => {});
                  stream.stderr.on('data', () => {});
                });
              });
              fs.appendFileSync(logFile, '[SFTP] chown mgeweb img principal OK\n');
            }
          } catch(chErr) {
            fs.appendFileSync(logFile, '[SFTP] Aviso chown principal: ' + chErr.message + '\n');
          }
        } catch(e2) {
          fs.appendFileSync(logFile, '[SFTP] ALERTA: img principal NAO encontrada: ' + e2.message + '\n');
        }
        // Listar diretório para ver os outros arquivos
        try {
          const dirList = await sftp2.list(ftpPath);
          const relevantFiles = dirList.filter(f => f.name.includes(String(codProd))).map(f => f.name + ' (' + f.size + 'b, mode:' + (f.rights ? JSON.stringify(f.rights) : 'N/A') + ')');
          fs.appendFileSync(logFile, '[SFTP] Arquivos do SKU ' + codProd + ' no servidor: ' + relevantFiles.join(', ') + '\n');
        } catch(e3) {}
        await sftp2.end();
        fs.appendFileSync(logFile, '[SFTP] Imagem principal ' + mainFileName + ' enviada via FTP (' + Math.round(mainImgBuffer.length/1024) + 'KB) -> ' + remoteFile + '\n');
      } catch (sftpErr) {
        fs.appendFileSync(logFile, '[SFTP] Falha ao enviar imagem principal via FTP: ' + sftpErr.message + '\n');
      }
    }
  } catch (ftpMainErr) {
    fs.appendFileSync(logFile, '[FTP] Erro ao preparar imagem principal para FTP: ' + ftpMainErr.message + '\n');
  }
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [Sankhya] Upload imagem principal CODPROD=${codProd} (${Math.round(imageBase64.length / 1024)}KB base64)\n`);
  
  try {
    // Passo 1: Obter token via cache (com retry se expirado)
    let tokenResult = await getSankhyaToken(settings);
    let accessToken = tokenResult.accessToken;
    let baseUrl = tokenResult.baseUrl;
    
    // Passo 2: Processar imagem para 300x300 JPG com fundo branco
    const cleanMainB64_2 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const rawBuffer = Buffer.from(cleanMainB64_2, 'base64');
    const imageBuffer = await sharp(rawBuffer)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(300, 300, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 90 })
      .toBuffer();
    
    fs.appendFileSync(logFile, `[Sankhya] Imagem processada: 300x300 JPG (${Math.round(imageBuffer.length / 1024)}KB)\n`);
    
    // Passo 3: Upload da imagem via sessionUpload
    const boundary = '----FormBoundary' + Date.now().toString(36) + Math.random().toString(36).substring(2);
    
    const fileName = `produto_${codProd}.jpg`;
    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="arquivo"; filename="${fileName}"\r\n`,
      `Content-Type: image/jpeg\r\n\r\n`,
    ];
    const headerBuffer = Buffer.from(bodyParts.join(''), 'utf-8');
    const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const multipartBody = Buffer.concat([headerBuffer, imageBuffer, footerBuffer]);
    
    const uploadUrl = `${baseUrl}/gateway/v1/mge/sessionUpload.mge?sessionkey=Produto_IMAGEM&fitem=S&salvar=S&useCache=N`;
    fs.appendFileSync(logFile, `[Sankhya] POST sessionUpload: ${uploadUrl}\n`);
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody
    });
    
    let uploadOk = false;
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      fs.appendFileSync(logFile, `[Sankhya] Erro sessionUpload HTTP ${uploadResponse.status}: ${errorText}\n`);
      
      // Se Bearer expirado (403), renovar token silenciosamente e refazer
      if (uploadResponse.status === 403 || errorText.includes('Expirado')) {
        fs.appendFileSync(logFile, '[Sankhya] Bearer expirado, renovando token silenciosamente...\n');
        sankhyaCachedToken = null;
        sankhyaTokenExpiry = 0;
        const refreshed = await getSankhyaToken(settings);
        accessToken = refreshed.accessToken;
        
        // Refazer sessionUpload com novo token
        const retryResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body: multipartBody
        });
        
        if (!retryResponse.ok) {
          const retryError = await retryResponse.text();
          fs.appendFileSync(logFile, `[Sankhya] Retry sessionUpload falhou HTTP ${retryResponse.status}: ${retryError}\n`);
          throw new Error(`Erro no upload da imagem (HTTP ${retryResponse.status}): ${retryError}`);
        }
        
        const retryData = await retryResponse.text();
        fs.appendFileSync(logFile, `[Sankhya] Retry sessionUpload OK: ${retryData.substring(0, 200)}\n`);
        uploadOk = true;
      } else {
        throw new Error(`Erro no upload da imagem (HTTP ${uploadResponse.status}): ${errorText}`);
      }
    } else {
      const uploadData = await uploadResponse.text();
      fs.appendFileSync(logFile, `[Sankhya] sessionUpload OK: ${uploadData.substring(0, 500)}\n`);
      uploadOk = true;
    }
    
    // Passo 3: Vincular imagem ao produto via CRUDServiceProvider.saveRecord
    const saveUrl = `${baseUrl}/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.saveRecord&outputType=json`;
    const saveBody = {
      serviceName: 'CRUDServiceProvider.saveRecord',
      requestBody: {
        dataSet: {
          rootEntity: 'Produto',
          includePresentationFields: 'N',
          dataRow: {
            key: { CODPROD: { '$': String(codProd) } },
            localFields: { IMAGEM: { '$': '$file.session.key{Produto_IMAGEM}' } }
          },
          entity: { fieldset: { list: 'CODPROD,IMAGEM' } }
        }
      }
    };
    
    fs.appendFileSync(logFile, `[Sankhya] POST CRUDServiceProvider.saveRecord vinculando imagem ao CODPROD=${codProd}\n`);
    
    let saveResponse = await fetch(saveUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(saveBody)
    });
    
    let saveData = await saveResponse.json().catch(() => null);
    fs.appendFileSync(logFile, `[Sankhya] Resposta CRUDServiceProvider CODPROD=${codProd}: ${JSON.stringify(saveData).substring(0, 500)}\n`);
    
    // Se retornar status 3 ("Não autorizado"), o token pode ter expirado silenciosamente no backend. Renova e tenta novamente.
    if (saveData?.status === '3' || saveData?.statusMessage?.includes('Não autorizado')) {
      fs.appendFileSync(logFile, `[Sankhya] saveRecord retornou status 3 (Não autorizado). Renovando token silenciosamente e tentando novamente...\n`);
      sankhyaCachedToken = null;
      sankhyaTokenExpiry = 0;
      const refreshed = await getSankhyaToken(settings);
      accessToken = refreshed.accessToken;
      
      // Refazer sessionUpload com o novo token para atualizar a chave de sessão
      await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartBody
      });
      
      saveResponse = await fetch(saveUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(saveBody)
      });
      saveData = await saveResponse.json().catch(() => null);
      fs.appendFileSync(logFile, `[Sankhya] Resposta retry saveRecord CODPROD=${codProd}: ${JSON.stringify(saveData).substring(0, 500)}\n`);
    }

    if (saveData && saveData.status === '1') {
      fs.appendFileSync(logFile, `[Sankhya] SUCESSO! Imagem principal vinculada ao CODPROD=${codProd}\n`);
      return { success: true };
    } else {
      const errMsg = saveData?.statusMessage || 'Erro desconhecido';
      fs.appendFileSync(logFile, `[Sankhya] FALHA ao vincular imagem: ${errMsg}. Verifique permissoes do usuario de integracao no Sankhya (CRUDServiceProvider.saveRecord + entidade Produto).\n`);
      throw new Error(`O Sankhya recusou o salvamento da Imagem Principal: ${errMsg}`);
    }
  } catch (error) {
    fs.appendFileSync(logFile, `[Sankhya] ERRO upload imagem principal: ${error.message}\n`);
    throw new Error(error.message || 'Erro ao fazer upload da imagem principal');
  }
});
let primaryGeminiKeyDisabledUntil = 0;
const geminiModelCooldownMap = new Map();
const GEMINI_TEXT_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash'
];

function getActiveGeminiTextModel() {
  const now = Date.now();
  for (const model of GEMINI_TEXT_MODELS) {
    const disabledUntil = geminiModelCooldownMap.get(model) || 0;
    if (now >= disabledUntil) {
      return model;
    }
  }
  // Se todos estiverem temporariamente com cooldown, remove do prioritário e tenta
  geminiModelCooldownMap.delete(GEMINI_TEXT_MODELS[0]);
  return GEMINI_TEXT_MODELS[0];
}

function markGeminiModelCooldown(model, durationMs = 3 * 60 * 1000) {
  geminiModelCooldownMap.set(model, Date.now() + durationMs);
  fs.appendFileSync(logFile, `[Gemini] Modelo ${model} colocado em repouso por ${Math.round(durationMs / 1000)}s devido a erro 503/429.\n`);
}

async function fetchGeminiWithSmartModel(buildBody, primaryKey, fallbackKeyInput) {
  let fallbackKey = fallbackKeyInput;
  if (!fallbackKey) {
    try {
      const storedSettings = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
      fallbackKey = storedSettings.geminiApiKeyFallback || '';
    } catch (e) {
      fs.appendFileSync(logFile, `[Gemini] Erro ao ler fallbackKey: ${e.message}\n`);
    }
  }

  const isPrimaryActive = Date.now() >= primaryGeminiKeyDisabledUntil;
  let activeKey = (isPrimaryActive && primaryKey) ? primaryKey : (fallbackKey || primaryKey);

  if (!activeKey) {
    throw new Error('Nenhuma chave de API do Gemini foi fornecida ou configurada.');
  }

  let lastError = null;
  const maxModelTries = GEMINI_TEXT_MODELS.length;

  for (let attempt = 0; attempt < maxModelTries; attempt++) {
    const currentModel = getActiveGeminiTextModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${activeKey}`;

    fs.appendFileSync(logFile, `[Gemini] Requisição com modelo: ${currentModel} (tentativa ${attempt + 1}/${maxModelTries})\n`);

    try {
      let response = await fetch(url, buildBody());

      // 1. Tratamento de cota da chave (402, 403, ou 429 por cota de projeto)
      if ((response.status === 402 || response.status === 403) && activeKey === primaryKey && fallbackKey && fallbackKey !== primaryKey) {
        primaryGeminiKeyDisabledUntil = Date.now() + 30 * 60 * 1000;
        fs.appendFileSync(logFile, `[Gemini] Cota da chave esgotada (HTTP ${response.status}). Comutando para chave de backup!\n`);
        activeKey = fallbackKey;
        const backupUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${activeKey}`;
        response = await fetch(backupUrl, buildBody());
      }

      // 2. Tratamento de sobrecarga (503) ou rate-limit específico do modelo (429)
      if (response.status === 503 || response.status === 429) {
        const errText = await response.text().catch(() => '');
        fs.appendFileSync(logFile, `[Gemini] Modelo ${currentModel} indisponível (HTTP ${response.status}): ${errText.substring(0, 150)}\n`);
        markGeminiModelCooldown(currentModel, 3 * 60 * 1000); // 3 minutos de repouso
        lastError = new Error(`Modelo ${currentModel} indisponível (HTTP ${response.status})`);
        continue; // Tenta o próximo modelo livre na próxima iteração!
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        fs.appendFileSync(logFile, `[Gemini] Erro HTTP ${response.status}: ${errorText}\n`);
        throw new Error(`Gemini retornou HTTP ${response.status}`);
      }

      return { response, model: currentModel };
    } catch (err) {
      fs.appendFileSync(logFile, `[Gemini] Falha ao consultar ${currentModel}: ${err.message}\n`);
      markGeminiModelCooldown(currentModel, 2 * 60 * 1000);
      lastError = err;
      continue;
    }
  }

  throw lastError || new Error('Todos os modelos do Gemini estão temporariamente indisponíveis.');
}

async function fetchGeminiWithFallback(urlBuilder, fetchOptions, primaryKey, fallbackKeyInput) {
  let fallbackKey = fallbackKeyInput;
  if (!fallbackKey) {
    try {
      const storedSettings = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
      fallbackKey = storedSettings.geminiApiKeyFallback || '';
    } catch (e) {
      fs.appendFileSync(logFile, `[Gemini] Erro ao ler fallbackKey: ${e.message}\n`);
    }
  }

  const isPrimaryActive = Date.now() >= primaryGeminiKeyDisabledUntil;
  let activeKey = (isPrimaryActive && primaryKey) ? primaryKey : (fallbackKey || primaryKey);

  if (!activeKey) {
    throw new Error('Nenhuma chave de API do Gemini foi fornecida ou configurada.');
  }

  let response = await fetch(urlBuilder(activeKey), fetchOptions);

  // Se der erro de limite (429/402/403) na chave primária e tivermos chave de backup:
  if ((response.status === 429 || response.status === 402 || response.status === 403) && activeKey === primaryKey && fallbackKey && fallbackKey !== primaryKey) {
    primaryGeminiKeyDisabledUntil = Date.now() + 30 * 60 * 1000; // Desativa chave primária por 30 minutos
    fs.appendFileSync(logFile, `[Gemini] Cota da chave gratuita esgotada (HTTP ${response.status}). Comutando INSTANTANEAMENTE para chave de backup!\n`);
    activeKey = fallbackKey;
    response = await fetch(urlBuilder(activeKey), fetchOptions);
  }

  return response;
}

// ============================================================
// IPC Handlers - Gemini (Reescrita de Texto)
// ============================================================
ipcMain.handle('gemini:rewrite', async (event, { text, productName, apiKey, prompt, ocrImageBase64, ocrImages }) => {
  let fullPrompt;
  const nameContext = productName ? `\n\nNOME DO PRODUTO (CONTÉM CARACTERÍSTICAS COMO TAMANHO, COR, ETC): ${productName}` : '';
  
  if (prompt.match(/\{TEXTO\}/i)) {
    fullPrompt = prompt.replace(/\{TEXTO\}/gi, text) + nameContext;
  } else {
    // Prompt do usuário não tem {TEXTO} — concatena o texto original no final
    fullPrompt = prompt + '\n\nTEXTO ORIGINAL DO PRODUTO PARA REESCREVER:\n' + text + nameContext;
  }
  
  // Normalizar array de imagens OCR (até 4 imagens)
  const imageList = Array.isArray(ocrImages) && ocrImages.length > 0
    ? ocrImages.filter(Boolean)
    : (ocrImageBase64 ? [ocrImageBase64] : []);

  if (imageList.length > 0) {
    fullPrompt += `\n\nATENÇÃO: Foram anexadas ${imageList.length} imagem(ns) de referência (bula, rótulo, embalagem ou especificações). Extraia e utilize também todas as informações legíveis nelas.`;
  }
  
  fs.appendFileSync(logFile, `[Gemini] Prompt final (${fullPrompt.length} chars, ${imageList.length} imagens)\n`);
  
  const parts = [{ text: fullPrompt }];
  for (const img of imageList) {
    const rawBase64 = img.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = img.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    parts.push({
      inline_data: { mime_type: mimeType, data: rawBase64 }
    });
  }
  
  try {
    const buildBody = () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Você é um redator técnico. REGRAS OBRIGATÓRIAS:\n1. Responda SOMENTE com o texto da descrição reescrita, sem explicações ou comentários.\n2. Use EXCLUSIVAMENTE as informações presentes no texto original fornecido OU presentes na imagem enviada como referência. NÃO invente, NÃO acrescente dados, espécies, dosagens, indicações ou qualquer informação que NÃO esteja explicitamente no texto de entrada ou na imagem.\n3. Não use markdown, asteriscos, negrito ou formatação especial. Retorne texto puro (plaintext).\n4. Se o material original menciona apenas bovinos, NÃO adicione ovinos, suínos ou outras espécies.\n5. Reorganize e reescreva o texto seguindo as regras do prompt do usuário, mas mantendo fidelidade total aos dados originais do texto e da imagem.' }]
        },
        contents: [{ parts }]
      })
    });

    const { response, model } = await fetchGeminiWithSmartModel(buildBody, apiKey);
    
    const data = await response.json();
    let result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Limpar formatação markdown que o Gemini pode adicionar
    result = result.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();
    result = result.replace(/\*\*/g, '').replace(/\*/g, '');
    fs.appendFileSync(logFile, `[Gemini] Resultado via ${model}: ${result.substring(0, 200)}...\n`);
    trackApiCall('rewrite', data.usageMetadata);
    return { text: result };
  } catch (error) {
    fs.appendFileSync(logFile, `[Gemini] ERRO: ${error.message}\n`);
    throw new Error(error.message || 'Erro ao reescrever com Gemini');
  }
});

// ============================================================
// IPC Handlers - Gemini (Extração de SKUs de Prints / Imagens)
// ============================================================
ipcMain.handle('gemini:extractSkus', async (event, { imageBase64, apiKey }) => {
  fs.appendFileSync(logFile, `[Gemini] Extraindo SKUs de print (${Math.round((imageBase64?.length || 0) / 1024)}KB)\n`);
  
  if (!apiKey) {
    throw new Error('Chave da API Gemini não configurada.');
  }

  try {
    const rawBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    const systemPrompt = `Você é um leitor óptico (OCR) especializado em extração de códigos de produtos (SKUs) em capturas de tela e relatórios de sistemas comerciais (Sankhya, planilhas Excel, notas fiscais, ERPs, WhatsApp ou catálogos).

REGRAS ESTRITAS:
1. Localize e extraia TODOS os códigos de produtos ou itens presentes na imagem. Normalmente são números inteiros de 3 a 8 dígitos (por exemplo: 45244, 12055, 30440, etc.).
2. Em tabelas com colunas (como "Cód.", "CODPROD", "Item", "Código", "SKU", "Produto"), foque exclusivamente nos números que representam os códigos dos produtos.
3. NÃO extraia valores em dinheiro com centavos (como 15,90 ou 15.90), porcentagens, telefones ou datas.
4. NÃO invente códigos. Extraia apenas o que for visível na imagem.
5. Retorne SOMENTE os números dos códigos encontrados, um por linha, em texto puro, sem asteriscos, sem bullets, sem explicações, sem markdown.
6. Se não houver nenhum código legível, retorne exatamente: VAZIO`;

    const urlBuilder = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`;
    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [{
          parts: [
            { text: 'Extraia todos os códigos de produtos (SKUs) visíveis neste print / imagem.' },
            {
              inline_data: {
                mime_type: mimeType,
                data: rawBase64
              }
            }
          ]
        }]
      })
    };
    const response = await fetchGeminiWithFallback(urlBuilder, fetchOptions, apiKey);

    if (!response.ok) {
      const errorText = await response.text();
      fs.appendFileSync(logFile, `[Gemini] Erro extrair SKUs HTTP ${response.status}: ${errorText}\n`);
      throw new Error(`Gemini retornou HTTP ${response.status}`);
    }

    const data = await response.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();
    
    fs.appendFileSync(logFile, `[Gemini] SKUs brutos encontrados:\n${text}\n`);
    trackApiCall('extractSkus', data.usageMetadata);

    if (text.toUpperCase().includes('VAZIO')) {
      return { skus: [] };
    }

    // Extrair todos os números de 3 a 8 dígitos encontrados no retorno
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

    return { skus: unique };
  } catch (error) {
    fs.appendFileSync(logFile, `[Gemini] ERRO extrair SKUs: ${error.message}\n`);
    throw new Error(error.message || 'Erro ao extrair códigos do print');
  }
});

// ============================================================
// IPC Handlers - Gemini (Auto-Enhance de Imagem)
// ============================================================
ipcMain.handle('gemini:auto-enhance', async (event, { imageBase64, apiKey }) => {
  fs.appendFileSync(logFile, `[Gemini] Auto-enhance imagem (${Math.round(imageBase64.length / 1024)}KB)\n`);
  
  try {
    const urlBuilder = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`;
    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: { responseModalities: ['TEXT'] },
        contents: [{
          parts: [
            { text: 'Analise esta foto de produto para e-commerce. Retorne APENAS um JSON com ajustes SUTIS para melhorar a imagem. REGRAS OBRIGATÓRIAS:\n1. Seja CONSERVADOR — ajustes pequenos (valores entre -15 e +15 no máximo)\n2. PRIORIDADE é FIDELIDADE DAS CORES ORIGINAIS do produto. NUNCA altere as cores reais.\n3. Só ajuste o que realmente precisa — se a imagem já está boa, retorne zeros.\n4. Foco: corrigir subexposição/superexposição leve, aumentar nitidez visual, equilibrar sombras.\n5. NUNCA exagere em saturação ou contraste — fotos de catálogo devem parecer naturais.\n\nEstrutura exata: {"brightness":0,"contrast":0,"saturation":0,"temperature":0,"highlights":0,"shadows":0,"whites":0,"blacks":0}\nValores inteiros de -100 a 100, mas use no MÁXIMO -15 a +15. Retorne SOMENTE o JSON.' },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
              }
            }
          ]
        }]
      })
    };
    const response = await fetchGeminiWithFallback(urlBuilder, fetchOptions, apiKey);
    
    if (!response.ok) {
      const errorText = await response.text();
      fs.appendFileSync(logFile, `[Gemini] Auto-enhance erro HTTP ${response.status}: ${errorText}\n`);
      throw new Error(`Gemini retornou HTTP ${response.status}`);
    }
    
    const data = await response.json();
    let result = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Limpar markdown
    result = result.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();
    
    fs.appendFileSync(logFile, `[Gemini] Auto-enhance resultado: ${result}\n`);
    
    const adjustments = JSON.parse(result);
    trackApiCall('autoEnhance', data.usageMetadata);
    return { adjustments };
  } catch (error) {
    fs.appendFileSync(logFile, `[Gemini] Auto-enhance ERRO: ${error.message}\n`);
    throw new Error(error.message || 'Erro no auto-enhance');
  }
});

// ============================================================
// IPC Handlers - Gemini (Inpainting / Borracha Mágica)
// ============================================================
ipcMain.handle('gemini:inpaint', async (event, { imageBase64, maskBase64, fullImageBase64, prompt, apiKey, mode = 'background', variations = 3 }) => {
    fs.appendFileSync(logFile, `[Gemini] Inpainting ${variations} variações (recorte: ${Math.round(imageBase64.length / 1024)}KB) Mode: ${mode}\n`);
    
    let editPrompt;
    if (mode === 'background') {
      const setting = prompt && prompt.trim() !== '' 
        ? `in the following setting: "${prompt}"` 
        : `in a suitable, professional, and visually appealing setting that complements the product`;
      editPrompt = `I am sending you an image of a product with a transparent background. Generate a new square image containing this product ${setting}. IMPORTANT RULES:\n- The product must be preserved exactly as it is.\n- The generated background must fill the entire transparent area.\n- Return ONLY the final generated image.`;
    } else if (mode === 'generative') {
      if (prompt && prompt.trim() !== '') {
        editPrompt = `I am sending you 3 images:\n1. FIRST: The FULL original photo (context)\n2. SECOND: A CROPPED region from the photo\n3. THIRD: The SAME cropped region but with RED PAINT over a specific area\n\nIMPORTANT RULES:\n- Generate the following inside the red painted area: "${prompt}"\n- The result MUST have EXACTLY the same dimensions as images 2 and 3\n- DO NOT change ANYTHING outside the red painted areas\n- Preserve the original background in unpainted areas\n- Return ONLY the edited cropped image.`;
      } else {
        editPrompt = `I am sending you 3 images:\n1. FIRST: The FULL original photo (context)\n2. SECOND: A CROPPED region from the photo\n3. THIRD: The SAME cropped region but with RED PAINT over areas to REMOVE\n\nIMPORTANT RULES:\n- COMPLETELY ERASE and remove whatever is under the red paint marks\n- Reconstruct, fill and blend the erased area seamlessly matching the surrounding texture, material, surface, color and background as if the object never existed (seamless inpainting / generative erase)\n- The result MUST have EXACTLY the same dimensions as images 2 and 3\n- DO NOT change ANYTHING outside the red painted areas\n- Return ONLY the edited cropped image.`;
      }
    } else {
      editPrompt = `I am sending you 3 images:\n1. FIRST: The FULL original photo (context)\n2. SECOND: A CROPPED region from the photo\n3. THIRD: The SAME cropped region but with RED PAINT over areas to REMOVE\n\nIMPORTANT RULES:\n- COMPLETELY ERASE everything under the red paint marks\n- Fill the erased areas with the natural background/texture that should be there\n- The result MUST have EXACTLY the same dimensions as images 2 and 3\n- DO NOT change ANYTHING outside the red painted areas\n- Return ONLY the edited cropped image.`;
    }
    
    const buildParts = () => {
      const parts = [{ text: editPrompt }];
      if (fullImageBase64) {
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: fullImageBase64.replace(/^data:image\/\w+;base64,/, '') } });
      }
      parts.push({ inline_data: { mime_type: 'image/png', data: imageBase64.replace(/^data:image\/\w+;base64,/, '') } });
      if ((mode === 'eraser' || mode === 'generative') && maskBase64) {
        parts.push({ inline_data: { mime_type: 'image/png', data: maskBase64.replace(/^data:image\/\w+;base64,/, '') } });
      }
      return parts;
    };
    
    const temperatures = [0.4, 1.0];
  
  const makeRequest = async (temp) => {
    try {
      const urlBuilder = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${key}`;
      const fetchOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: temp },
          contents: [{ parts: buildParts() }]
        })
      };
      const response = await fetchGeminiWithFallback(urlBuilder, fetchOptions, apiKey);
      
      if (!response.ok) return null;
      
      const data = await response.json();
      const responseParts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = responseParts.find(p => {
        if (p.inline_data && p.inline_data.mime_type) return p.inline_data.mime_type.startsWith('image/');
        if (p.inlineData && p.inlineData.mimeType) return p.inlineData.mimeType.startsWith('image/');
        return false;
      });
      
      if (!imagePart) return null;
      
      const imgData = imagePart.inline_data || imagePart.inlineData;
      const mimeType = imgData.mime_type || imgData.mimeType;
      return `data:${mimeType};base64,${imgData.data}`;
    } catch (err) {
      fs.appendFileSync(logFile, `[Gemini] Variação temp=${temp} falhou: ${err.message}\n`);
      return null;
    }
  };
  
  try {
    // Chamadas sequenciais com delay para evitar HTTP 429 (rate limit)
    const validResults = [];
    for (let i = 0; i < temperatures.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 12000)); // 12s de delay entre chamadas (rate limit Gemini)
      const result = await makeRequest(temperatures[i]);
      if (result) validResults.push(result);
    }
    
    fs.appendFileSync(logFile, `[Gemini] Inpaint OK - ${validResults.length}/${variations} variações geradas\n`);
    
    if (validResults.length === 0) {
      throw new Error('Nenhuma variação foi gerada com sucesso');
    }
    
    trackApiCall('inpaint');
    return { variations: validResults };
  } catch (error) {
    fs.appendFileSync(logFile, `[Gemini] Inpaint ERRO: ${error.message}\n`);
    throw new Error(error.message || 'Erro no inpainting');
  }
});

// ============================================================
// IPC Handlers - Gemini (Upscale IA)
// ============================================================
ipcMain.handle('gemini:upscale', async (event, { imageBase64, targetW, targetH, apiKey, customPrompt }) => {
  fs.appendFileSync(logFile, `[Gemini] Upscale IA para ${targetW}x${targetH} (tamanho orig: ${Math.round(imageBase64.length / 1024)}KB)\n`);
  
  let editPrompt;
  const userInstructions = customPrompt ? customPrompt.trim() : '';

  if (userInstructions) {
    editPrompt = `You are an expert commercial photo editor and image generation engine for e-commerce products.
The user provided a product image and gave these MANDATORY MODIFICATION INSTRUCTIONS:
"${userInstructions}"

CRITICAL EDITING RULES:
1. STRICTLY EXECUTE THE USER'S REQUEST: "${userInstructions}".
2. If the user asks to keep only one item, isolate a single product, or remove duplicates (e.g. "deixa somente uma tesoura", "apenas uma tesoura", "deixar so uma", "keep only one item", "remover outra tesoura", etc.):
   - You MUST REMOVE the second/duplicate item completely.
   - You MUST KEEP ONLY ONE SINGLE PRIMARY PRODUCT ITEM.
   - BEAUTIFULLY AND PERFECTLY CENTER the single product in the middle of the frame with balanced margins on all sides.
3. The output image must be ultra-high resolution (at least ${targetW}x${targetH} pixels), crisp, sharp, with clean edges.
4. Place the single product on a clean, solid, pure white background (#FFFFFF).
5. Preserve the exact realistic material, metal reflections, textures, and true colors of the product.
6. Return ONLY the final generated image.`;
  } else {
    editPrompt = `You are an advanced super-resolution AI for e-commerce products. Your goal is to upscale the provided product image to at least ${targetW}x${targetH} pixels. You MUST strictly preserve the exact colors, shapes, typography, and structural details of the product. Enhance clarity, sharpen edges, and remove compression artifacts. Place the product centered on a pure solid white background (#FFFFFF). Return ONLY the final generated image.`;
  }

  try {
    const urlBuilder = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${key}`;
    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.1 },
        contents: [{
          parts: [
            { text: editPrompt },
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64.replace(/^data:image\/\w+;base64,/, '') } }
          ]
        }]
      })
    };

    const response = await fetchGeminiWithFallback(urlBuilder, fetchOptions, apiKey);
    
    if (!response.ok) {
      const errorText = await response.text();
      fs.appendFileSync(logFile, `[Gemini] Upscale erro HTTP ${response.status}: ${errorText}\n`);
      throw new Error(`Gemini retornou HTTP ${response.status}`);
    }
      
      const data = await response.json();
      const responseParts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = responseParts.find(p => {
        if (p.inline_data && p.inline_data.mime_type) return p.inline_data.mime_type.startsWith('image/');
        if (p.inlineData && p.inlineData.mimeType) return p.inlineData.mimeType.startsWith('image/');
        return false;
      });
      
      if (!imagePart) {
        throw new Error('Nenhuma imagem foi retornada pelo Gemini no Upscale');
      }
      
      const imgData = imagePart.inline_data || imagePart.inlineData;
      const mimeType = imgData.mime_type || imgData.mimeType;
      trackApiCall('upscale', data.usageMetadata);
      return { base64: `data:${mimeType};base64,${imgData.data}` };

  } catch (error) {
    fs.appendFileSync(logFile, `[Gemini] Upscale ERRO: ${error.message}\n`);
    throw new Error(error.message || 'Erro no Upscale com IA');
  }
});

ipcMain.handle('app:getAppPath', () => app.getAppPath());

// ============================================================
// Fila de Trabalho Background (Sankhya)
// ============================================================
let queueIntervalTimer = null;
let activeNotification = null;
let pendingQueueSkus = null; // Guarda SKUs pendentes para o renderer puxar

async function checkSankhyaQueue(autoOpen = false) {
  const settings = loadSettings();
  if (!settings.sankhyaQueueEnabled || !settings.sankhyaQueueQuery) return;
  
  try {
    fs.appendFileSync(logFile, `[Fila] Verificando fila de trabalho...\n`);
    const { accessToken, baseUrl } = await authenticateSankhya({ 
      clientId: settings.sankhyaClientId, 
      secret: settings.sankhyaSecret, 
      token: settings.sankhyaToken, 
      environment: settings.sankhyaEnvironment 
    });
    
    let finalQuery = settings.sankhyaQueueQuery;
    if (settings.excludedGroups && settings.excludedGroups.length > 0) {
      const groupsStr = settings.excludedGroups.join(',');
      const excludeStr = `CODGRUPOPROD NOT IN (${groupsStr})`;
      // Se tiver {FILTRO_GRUPOS}, substitui. Senão, anexa ao final.
      if (finalQuery.includes('{FILTRO_GRUPOS}')) {
        finalQuery = finalQuery.replace('{FILTRO_GRUPOS}', `AND ${excludeStr}`);
      } else {
        // Assume que a query já tem um WHERE e anexa no final
        finalQuery = `${finalQuery} AND ${excludeStr}`;
      }
    }
    
    fs.appendFileSync(logFile, `[Fila] Query executada: ${finalQuery}\n`);

    const response = await fetch(`${baseUrl}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({
        serviceName: 'DbExplorerSP.executeQuery',
        requestBody: { sql: finalQuery }
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const rows = data?.responseBody?.rows || [];
      const meta = data?.responseBody?.fieldsMetadata || [];
      
      if (rows.length > 0) {
        fs.appendFileSync(logFile, `[Fila] Encontrados ${rows.length} itens pendentes.\n`);
        
        // Encontrar índice da coluna CODPROD (case insensitive)
        let codProdIndex = 0; // fallback pra primeira coluna
        for (let i = 0; i < meta.length; i++) {
          if ((meta[i].name || '').toUpperCase() === 'CODPROD') {
            codProdIndex = i;
            break;
          }
        }
        
        // Extrair SKUs
        const skus = rows.map(r => Array.isArray(r) ? r[codProdIndex] : (r.CODPROD || Object.values(r)[0]));
        
        // Sempre guarda os SKUs pendentes para o renderer poder puxar
        pendingQueueSkus = skus;
        fs.appendFileSync(logFile, `[Fila] SKUs pendentes armazenados: ${skus.join(', ')}\n`);

        if (autoOpen && mainWindow) {
          // Tenta enviar ao renderer, mas ele pode não estar pronto ainda
          mainWindow.webContents.send('queue:open', skus);
        }

        if (Notification.isSupported()) {
          activeNotification = new Notification({
              title: 'Fila de Trabalho MultiPic',
              body: `Existem ${rows.length} produtos validados pela logística aguardando fotos/descrição.`,
              icon: path.join(__dirname, 'build/icon.png')
            });
            
            activeNotification.on('click', () => {
              if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
                mainWindow.webContents.send('queue:open', skus);
              }
            });
            
            activeNotification.show();
          }
      } else {
        fs.appendFileSync(logFile, `[Fila] Nenhum item pendente.\n`);
      }
    }
  } catch (err) {
    fs.appendFileSync(logFile, `[Fila] Erro ao checar fila: ${err.message}\n`);
  }
}

// IPC para o renderer puxar SKUs pendentes quando estiver pronto
ipcMain.handle('queue:checkNow', async () => {
  fs.appendFileSync(logFile, '[Fila] Verificação manual solicitada (F5)...\n');
  try {
    await checkSankhyaQueue(true);
    return { success: true, skus: pendingQueueSkus || [] };
  } catch (err) {
    return { success: false, error: err.message, skus: [] };
  }
});

ipcMain.handle('queue:getPending', () => {
  fs.appendFileSync(logFile, `[Fila] Renderer pediu pendentes: ${pendingQueueSkus ? pendingQueueSkus.join(', ') : 'nenhum'}\n`);
  return pendingQueueSkus;
});

ipcMain.handle('queue:clearPending', () => {
  pendingQueueSkus = null;
  return true;
});

function startQueueChecker() {
  if (queueIntervalTimer) clearInterval(queueIntervalTimer);
  const settings = loadSettings();
  if (settings.sankhyaQueueEnabled) {
    const minutes = parseInt(settings.sankhyaQueueInterval) || 30;
    fs.appendFileSync(logFile, `[Fila] Checker iniciado, rodando a cada ${minutes} minutos.\n`);
    queueIntervalTimer = setInterval(() => checkSankhyaQueue(false), minutes * 60 * 1000);
    // Também roda logo na inicialização se estiver ativado, abrindo direto
    checkSankhyaQueue(true);
  }
}

// Chamar startQueueChecker logo após app.whenReady
app.on('ready', () => {
  setTimeout(startQueueChecker, 5000); // aguarda 5s pra não travar boot
});


// ============================================================
// IPC Handlers - Autosave em Arquivo Físico (Sem limite de 5MB)
// ============================================================
const getAutosaveFilePath = () => path.join(app.getPath('userData'), 'autosave.json');

ipcMain.handle('autosave:save', async (event, data) => {
  try {
    const filePath = getAutosaveFilePath();
    const tempPath = filePath + '.tmp';
    await fs.promises.writeFile(tempPath, JSON.stringify(data), 'utf8');
    await fs.promises.rename(tempPath, filePath);
    return { success: true };
  } catch (err) {
    console.error('Erro ao salvar autosave no disco:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.on('autosave:saveSync', (event, data) => {
  try {
    const filePath = getAutosaveFilePath();
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
    event.returnValue = true;
  } catch (err) {
    console.error('Erro ao salvar autosave síncrono:', err);
    event.returnValue = false;
  }
});

ipcMain.handle('autosave:load', async () => {
  try {
    const filePath = getAutosaveFilePath();
    if (fs.existsSync(filePath)) {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(content);
    }
    return null;
  } catch (err) {
    console.error('Erro ao ler autosave do disco:', err);
    return null;
  }
});

ipcMain.handle('autosave:clear', async () => {
  try {
    const filePath = getAutosaveFilePath();
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('settings:load', () => loadSettings());
// ============================================================
// IPC Handlers - API Usage
// ============================================================
ipcMain.handle('usage:get', async () => {
  const data = getUsageData();
  // Migrar formato antigo se necessário
  if (!data.monthly && !data.daily) {
    const migrated = { monthly: {}, daily: {} };
    Object.keys(data).forEach(key => {
      if (key !== 'monthly' && key !== 'daily' && key.match(/^\d{4}-\d{2}$/)) {
        migrated.monthly[key] = data[key];
      }
    });
    return migrated;
  }
  return data;
});

ipcMain.handle('usage:reset', async () => {
  const monthKey = new Date().toISOString().substring(0, 7);
  const data = getUsageData();
  delete data[monthKey];
  saveUsageData(data);
  return data;
});

ipcMain.handle('settings:save', (event, settings) => {
  saveSettings(settings);
  startQueueChecker(); // Reinicia o checker se mudaram as configs
});

// ============================================================
// IPC Handlers - Sankhya (Validar Marketing)
// ============================================================
ipcMain.handle('sankhya:getGroups', async (event, { secret, token, environment, clientId }) => {
  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [Sankhya] Buscando todos os grupos de produtos (TGFGRU)\n`);
  try {
    const { accessToken, baseUrl } = await authenticateSankhya({ clientId, secret, token, environment });
    const response = await fetch(`${baseUrl}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({
        serviceName: 'DbExplorerSP.executeQuery',
        requestBody: { sql: "SELECT CODGRUPOPROD, DESCRGRUPOPROD FROM TGFGRU ORDER BY DESCRGRUPOPROD" }
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const rows = data?.responseBody?.rows || [];
      const meta = data?.responseBody?.fieldsMetadata || [];
      
      const codIdx = meta.findIndex(m => m.name.toUpperCase() === 'CODGRUPOPROD');
      const descrIdx = meta.findIndex(m => m.name.toUpperCase() === 'DESCRGRUPOPROD');
      
      return rows.map(r => ({
        CODGRUPOPROD: parseInt(Array.isArray(r) ? r[codIdx] : r.CODGRUPOPROD),
        DESCRGRUPOPROD: Array.isArray(r) ? r[descrIdx] : r.DESCRGRUPOPROD
      }));
    } else {
      throw new Error(`Erro API: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    fs.appendFileSync(logFile, `[Sankhya] Erro ao buscar grupos: ${err.message}\n`);
    throw err;
  }
});

ipcMain.handle('sankhya:markMarketingValidated', async (event, { sku, secret, token, environment, clientId, queueField, queueValue, codUsu }) => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dhAtual = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] [Sankhya] Validando MKT SKU: ${sku} (${queueField}=${queueValue}, CODUSU=${codUsu || 'N/A'}, DH=${dhAtual})\n`);
  
  if (!queueField || !queueValue) {
    throw new Error('Campo e valor de validação do marketing não configurados nas opções.');
  }

  try {
    const { accessToken, baseUrl } = await authenticateSankhya({ clientId, secret, token, environment });

    const localFields = {
      [queueField]: { '$': queueValue },
      AD_DHVALMKT: { '$': dhAtual }
    };
    const fieldList = ['CODPROD', queueField, 'AD_DHVALMKT'];

    if (codUsu && String(codUsu).trim()) {
      localFields['AD_CODUSUMKT'] = { '$': String(codUsu).trim() };
      fieldList.push('AD_CODUSUMKT');
    }
    
    const response = await fetch(`${baseUrl}/gateway/v1/mge/service.sbr?serviceName=CRUDServiceProvider.saveRecord&outputType=json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        serviceName: 'CRUDServiceProvider.saveRecord',
        requestBody: {
          dataSet: {
            rootEntity: 'Produto',
            includePresentationFields: 'N',
            dataRow: {
              localFields,
              key: {
                CODPROD: { '$': String(sku) }
              }
            },
            entity: {
              fieldset: {
                list: fieldList.join(',')
              }
            }
          }
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sankhya retornou HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    if (data?.status === '0') throw new Error(data.statusMessage || 'Erro ao validar no Sankhya');
    
    return { success: true, data };
  } catch (error) {
    fs.appendFileSync(logFile, `[Sankhya] ERRO validar MKT: ${error.message}\n`);
    throw new Error(error.message || 'Erro ao salvar validação no Sankhya');
  }
});

// IPC Handlers - files
ipcMain.handle('files:openImages', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
  });
  if (canceled) return [];
  return filePaths;
});

ipcMain.handle('files:selectDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('files:readImageAsBase64', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const image = sharp(buffer);
    const metadata = await image.metadata();
    let isTransparent = false;
    if (metadata.hasAlpha) {
      try {
        const stats = await image.stats();
        isTransparent = !stats.isOpaque;
      } catch (e) {
        isTransparent = false;
      }
    }
    const base64 = buffer.toString('base64');
    return {
      base64: `data:image/${metadata.format};base64,${base64}`,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      hasAlpha: !!metadata.hasAlpha,
      isTransparent: isTransparent
    };
  } catch (error) {
    console.error('Erro ao ler imagem:', error);
    throw error;
  }
});

ipcMain.handle('files:saveProcessedImage', async (event, args) => {
  const { base64, filePath, format, quality, width, height, background } = args;
  try {
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Tratamento do fundo para transparência ou cor sólida
    const bgConfig = background === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : background;
    let imgProcess = sharp(buffer).resize(width, height, { fit: 'contain', background: bgConfig });

    if (format === 'jpg' || format === 'jpeg') {
      const jpgBg = (!background || background === 'transparent') ? '#FFFFFF' : background;
      imgProcess = imgProcess.flatten({ background: jpgBg }).jpeg({ quality: quality || 90 });
    } else if (format === 'png') {
      imgProcess = imgProcess.png({ quality: quality || 100 }).withMetadata({ density: 300 });
    }

    await imgProcess.toFile(filePath);
    return true;
  } catch (error) {
    console.error('Erro ao salvar imagem processada:', error);
    return false;
  }
});

ipcMain.handle('files:exportToProfile', async (event, args) => {
  const { base64, fileName, profile } = args;
  try {
    const { format, width, height, quality, background, outputDir } = profile;
    
    // Cria o diretório de saída caso não exista
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const ext = format === 'jpg' ? 'jpg' : 'png';
    const finalPath = path.join(outputDir, `${fileName}.${ext}`);
    
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    const targetW = parseInt(width, 10) || 1000;
    const targetH = parseInt(height, 10) || 1000;
    const targetQ = parseInt(quality, 10) || 100;
    const bgConfig = background === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : background;
    let imgProcess = sharp(buffer).resize(targetW, targetH, { fit: 'contain', background: bgConfig });

    if (format === 'jpg' || format === 'jpeg') {
      const jpgBg = (!background || background === 'transparent') ? '#FFFFFF' : background;
      imgProcess = imgProcess.flatten({ background: jpgBg }).jpeg({ quality: targetQ });
    } else if (format === 'png') {
      imgProcess = imgProcess.png({ quality: targetQ }).withMetadata({ density: 300 });
    }

    const processedBuffer = await imgProcess.toBuffer();
    await fs.promises.writeFile(finalPath, processedBuffer);
    return { success: true, outputPath: finalPath, base64: processedBuffer.toString('base64') };
  } catch (error) {
    console.error('Erro ao exportar para perfil:', error);
    return { success: false, error: error.message };
  }
});

// ============================================================
// Histórico de Alterações de Produtos / Relatórios
// ============================================================
const historyFilePath = path.join(app.getPath('userData'), 'historico_alteracoes.json');

function loadHistoryData() {
  try {
    if (fs.existsSync(historyFilePath)) {
      const raw = fs.readFileSync(historyFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('[History] Erro ao carregar historico:', err);
  }
  return [];
}

function saveHistoryData(records) {
  try {
    fs.writeFileSync(historyFilePath, JSON.stringify(records, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[History] Erro ao gravar historico:', err);
    return false;
  }
}

ipcMain.handle('history:add', async (event, record) => {
  try {
    const records = loadHistoryData();
    const newRecord = {
      id: Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: Date.now(),
      dateStr: record.dateStr || new Date().toLocaleString('pt-BR'),
      monthYear: record.monthYear || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      sku: String(record.sku || '').trim(),
      productName: String(record.productName || '').trim(),
      brand: String(record.brand || '').trim(),
      userName: String(record.userName || '').trim() || os.userInfo().username || 'Usuário',
      changes: record.changes || {},
      changesSummary: String(record.changesSummary || '').trim()
    };
    records.unshift(newRecord); // Mais recentes primeiro
    saveHistoryData(records);
    return { success: true, record: newRecord };
  } catch (err) {
    console.error('[History] Erro em history:add:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('history:get', async (event, monthYear) => {
  try {
    const records = loadHistoryData();
    if (!monthYear || monthYear === 'all') {
      return { success: true, records };
    }
    const filtered = records.filter(r => r.monthYear === monthYear);
    return { success: true, records: filtered };
  } catch (err) {
    return { success: false, error: err.message, records: [] };
  }
});

ipcMain.handle('history:getMonths', async () => {
  try {
    const records = loadHistoryData();
    const monthsSet = new Set();
    const now = new Date();
    const currentMY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    monthsSet.add(currentMY);
    
    records.forEach(r => {
      if (r.monthYear) monthsSet.add(r.monthYear);
    });
    const sorted = Array.from(monthsSet).sort().reverse();
    return { success: true, months: sorted };
  } catch (err) {
    return { success: false, error: err.message, months: [] };
  }
});

ipcMain.handle('history:clear', async () => {
  saveHistoryData([]);
  return { success: true };
});

ipcMain.handle('system:getUsername', () => {
  try {
    return os.userInfo().username || '';
  } catch (e) {
    return '';
  }
});



