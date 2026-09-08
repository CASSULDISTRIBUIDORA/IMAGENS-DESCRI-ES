# -*- coding: utf-8 -*-
"""
Gera o manual do sistema MultiPic em HTML (Mini-site interativo)
"""
import os

HTML_CONTENT = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Manual do Sistema • MultiPic</title>
    <style>
        :root {
            --bg-body: #0a0b16;
            --bg-sidebar: #0f1123;
            --bg-card: #15182d;
            --bg-card-hover: #1c203b;
            --border-color: #24284b;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --primary: #ff6b35;
            --primary-hover: #e85a25;
            --primary-glow: rgba(255, 107, 53, 0.25);
            --accent: #6366f1;
            --accent-glow: rgba(99, 102, 241, 0.25);
            --success: #10b981;
            --success-bg: rgba(16, 185, 129, 0.12);
            --warning: #f59e0b;
            --warning-bg: rgba(245, 158, 11, 0.12);
            --info: #0ea5e9;
            --info-bg: rgba(14, 165, 233, 0.12);
            --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--font-sans);
            background-color: var(--bg-body);
            color: var(--text-primary);
            line-height: 1.6;
            display: flex;
            min-height: 100vh;
            overflow-x: hidden;
        }

        .sidebar {
            width: 320px;
            background-color: var(--bg-sidebar);
            border-right: 1px solid var(--border-color);
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            z-index: 100;
        }

        .sidebar-header {
            padding: 24px 20px;
            border-bottom: 1px solid var(--border-color);
            position: sticky;
            top: 0;
            background-color: var(--bg-sidebar);
            z-index: 2;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }

        .brand-icon {
            width: 36px;
            height: 36px;
            background: linear-gradient(135deg, var(--primary), #ff9f43);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 900;
            color: #fff;
            font-size: 18px;
            box-shadow: 0 4px 12px var(--primary-glow);
        }

        .brand-title {
            font-size: 20px;
            font-weight: 800;
            letter-spacing: 0.5px;
        }

        .brand-title span { color: var(--primary); }

        .brand-badge {
            font-size: 11px;
            background-color: rgba(255, 255, 255, 0.08);
            color: var(--text-secondary);
            padding: 2px 8px;
            border-radius: 12px;
            border: 1px solid var(--border-color);
        }

        .search-box { position: relative; }

        .search-input {
            width: 100%;
            background-color: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 10px 14px 10px 36px;
            color: var(--text-primary);
            font-size: 13px;
            outline: none;
            transition: all 0.2s ease;
        }

        .search-input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px var(--primary-glow);
        }

        .search-icon {
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
            font-size: 14px;
        }

        .sidebar-nav {
            padding: 16px 12px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .nav-category {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            padding: 12px 12px 4px 12px;
        }

        .nav-link {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 13px;
            font-weight: 500;
            border-radius: 6px;
            transition: all 0.15s ease;
        }

        .nav-link:hover {
            color: var(--text-primary);
            background-color: rgba(255, 255, 255, 0.05);
        }

        .nav-link.active {
            color: #fff;
            background: linear-gradient(90deg, rgba(255, 107, 53, 0.2), transparent);
            border-left: 3px solid var(--primary);
            padding-left: 9px;
            font-weight: 600;
        }

        .main-content {
            margin-left: 320px;
            flex: 1;
            padding: 40px 60px 100px 60px;
            max-width: 1200px;
        }

        .hero-banner {
            background: linear-gradient(135deg, rgba(255, 107, 53, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 36px 40px;
            margin-bottom: 48px;
            position: relative;
            overflow: hidden;
        }

        .hero-banner::after {
            content: '';
            position: absolute;
            top: -50%;
            right: -20%;
            width: 300px;
            height: 300px;
            background: radial-gradient(circle, var(--primary-glow) 0%, transparent 70%);
            pointer-events: none;
        }

        .hero-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(255, 107, 53, 0.15);
            color: var(--primary);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 16px;
            border: 1px solid rgba(255, 107, 53, 0.3);
        }

        .hero-title {
            font-size: 32px;
            font-weight: 800;
            line-height: 1.2;
            margin-bottom: 12px;
        }

        .hero-subtitle {
            font-size: 16px;
            color: var(--text-secondary);
            max-width: 800px;
        }

        .manual-section {
            margin-bottom: 56px;
            scroll-margin-top: 40px;
        }

        .section-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border-color);
        }

        .section-num {
            background-color: var(--bg-card);
            color: var(--primary);
            border: 1px solid var(--border-color);
            width: 32px;
            height: 32px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 14px;
        }

        .section-title {
            font-size: 24px;
            font-weight: 700;
            color: var(--text-primary);
        }

        .section-desc {
            font-size: 15px;
            color: var(--text-secondary);
            margin-bottom: 24px;
        }

        .card-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .card {
            background-color: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px;
            transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .card:hover {
            transform: translateY(-2px);
            border-color: rgba(255, 107, 53, 0.4);
            box-shadow: 0 12px 24px rgba(0, 0, 0, 0.3);
        }

        .card-icon {
            width: 42px;
            height: 42px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.05);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            margin-bottom: 16px;
            color: var(--primary);
        }

        .card-title {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 8px;
            color: var(--text-primary);
        }

        .card-text {
            font-size: 14px;
            color: var(--text-secondary);
            line-height: 1.5;
        }

        .callout {
            border-radius: 10px;
            padding: 18px 22px;
            margin: 20px 0;
            display: flex;
            gap: 16px;
            align-items: flex-start;
            border-left: 4px solid;
            font-size: 14px;
        }

        .callout-icon {
            font-size: 20px;
            flex-shrink: 0;
            margin-top: 2px;
        }

        .callout-content h4 {
            font-size: 15px;
            font-weight: 700;
            margin-bottom: 4px;
        }

        .callout.info {
            background-color: var(--info-bg);
            border-left-color: var(--info);
            color: #bae6fd;
        }
        .callout.info h4 { color: #e0f2fe; }

        .callout.warning {
            background-color: var(--warning-bg);
            border-left-color: var(--warning);
            color: #fde68a;
        }
        .callout.warning h4 { color: #fef3c7; }

        .callout.success {
            background-color: var(--success-bg);
            border-left-color: var(--success);
            color: #a7f3d0;
        }
        .callout.success h4 { color: #d1fae5; }

        .step-list {
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin: 20px 0;
        }

        .step-item {
            display: flex;
            gap: 16px;
            background-color: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 18px 20px;
            align-items: flex-start;
        }

        .step-badge {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--primary), #ff9f43);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 13px;
            flex-shrink: 0;
        }

        .step-content { flex: 1; }

        .step-title {
            font-size: 15px;
            font-weight: 700;
            margin-bottom: 4px;
            color: var(--text-primary);
        }

        .step-desc {
            font-size: 13px;
            color: var(--text-secondary);
        }

        kbd {
            background-color: #1e2242;
            color: #e2e8f0;
            border: 1px solid #3b426f;
            border-bottom: 2px solid #2f3459;
            border-radius: 5px;
            padding: 2px 7px;
            font-family: var(--font-mono);
            font-size: 12px;
            font-weight: 600;
            box-shadow: 0 1px 2px rgba(0,0,0,0.4);
            white-space: nowrap;
        }

        .shortcuts-table {
            width: 100%;
            border-collapse: collapse;
            background-color: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            overflow: hidden;
            margin: 20px 0;
        }

        .shortcuts-table th {
            background-color: #101224;
            padding: 12px 18px;
            text-align: left;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            border-bottom: 1px solid var(--border-color);
        }

        .shortcuts-table td {
            padding: 12px 18px;
            font-size: 13px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            color: var(--text-secondary);
        }

        .shortcuts-table tr:hover td {
            background-color: rgba(255, 255, 255, 0.02);
            color: var(--text-primary);
        }

        .shortcuts-table tr:last-child td { border-bottom: none; }

        .faq-item {
            background-color: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            margin-bottom: 12px;
            overflow: hidden;
        }

        .faq-question {
            padding: 16px 20px;
            font-weight: 600;
            font-size: 15px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            user-select: none;
            transition: background-color 0.15s;
        }

        .faq-question:hover { background-color: rgba(255, 255, 255, 0.03); }

        .faq-arrow {
            font-size: 12px;
            color: var(--text-muted);
            transition: transform 0.2s ease;
        }

        .faq-item.open .faq-arrow {
            transform: rotate(180deg);
            color: var(--primary);
        }

        .faq-answer {
            padding: 0 20px 18px 20px;
            font-size: 14px;
            color: var(--text-secondary);
            display: none;
            line-height: 1.6;
        }

        .faq-item.open .faq-answer { display: block; }

        .footer {
            margin-top: 80px;
            padding-top: 24px;
            border-top: 1px solid var(--border-color);
            text-align: center;
            font-size: 13px;
            color: var(--text-muted);
        }

        @media (max-width: 900px) {
            .sidebar { display: none; }
            .main-content { margin-left: 0; padding: 24px; }
        }
    </style>
</head>
<body>

    <aside class="sidebar">
        <div class="sidebar-header">
            <div class="brand">
                <div class="brand-icon">M</div>
                <div>
                    <div class="brand-title">MULTI <span>PIC</span></div>
                    <span class="brand-badge">Manual do Usuário v1.0</span>
                </div>
            </div>
            <div class="search-box">
                <span class="search-icon">🔍</span>
                <input type="text" id="manual-search" class="search-input" placeholder="Buscar no manual...">
            </div>
        </div>

        <nav class="sidebar-nav">
            <div class="nav-category">Introdução</div>
            <a href="#visao-geral" class="nav-link active">📖 Visão Geral</a>
            <a href="#instalacao" class="nav-link">🚀 Instalação Autônoma</a>
            <a href="#auto-update" class="nav-link">🔄 Atualizações Automáticas (GitHub)</a>
            
            <div class="nav-category">Configuração</div>
            <a href="#configuracoes" class="nav-link">⚙️ Padrões de Fábrica</a>
            <a href="#integracoes" class="nav-link">🔌 Sankhya ERP & FTP</a>
            <a href="#gemini-ia" class="nav-link">✨ Google Gemini IA</a>

            <div class="nav-category">Operação & Fluxo</div>
            <a href="#criacao-lote" class="nav-link">📸 Criação em Lote & Prints</a>
            <a href="#edicao-recorte" class="nav-link">✂️ Edição & Recorte Híbrido</a>
            <a href="#variantes" class="nav-link">📑 Imagens Alternativas (Variantes)</a>
            <a href="#descricoes" class="nav-link">📝 Descrições Técnicas & Bulas</a>
            <a href="#exportacao" class="nav-link">💾 Exportação & Publicação</a>

            <div class="nav-category">Gestão & Referência</div>
            <a href="#fila-trabalho" class="nav-link">🔄 Fila de Validação</a>
            <a href="#painel-consumo" class="nav-link">📊 Métricas & Tokens de IA</a>
            <a href="#atalhos" class="nav-link">⌨️ Tabela de Atalhos</a>
            <a href="#faq" class="nav-link">❓ Dúvidas Frequentes (FAQ)</a>
        </nav>
    </aside>

    <main class="main-content">

        <div class="hero-banner">
            <div class="hero-badge">Guia Oficial & Treinamento</div>
            <h1 class="hero-title">Manual de Operação e Instalação do MultiPic</h1>
            <p class="hero-subtitle">
                Centralizador inteligente de fotos e descrições técnicas de produtos da Cassul Distribuidora. Integração direta com Sankhya ERP, inteligência artificial Google Gemini, recorte inteligente de fundos e automação em lote.
            </p>
        </div>

        <!-- SEÇÃO 1: VISÃO GERAL -->
        <section id="visao-geral" class="manual-section">
            <div class="section-header">
                <div class="section-num">01</div>
                <h2 class="section-title">Visão Geral do Sistema</h2>
            </div>
            <p class="section-desc">
                O MultiPic foi desenvolvido sob medida para otimizar e unificar o fluxo de trabalho entre o setor de Marketing, Logística e Cadastro de Produtos da empresa.
            </p>

            <div class="card-grid">
                <div class="card">
                    <div class="card-icon">🎯</div>
                    <h3 class="card-title">Propósito Central</h3>
                    <p class="card-text">Eliminar o retrabalho de recortar fundos manualmente, padronizar resoluções para o ERP e materiais publicitários e gerar descrições técnicas no padrão de bula com um clique.</p>
                </div>
                <div class="card">
                    <div class="card-icon">⚡</div>
                    <h3 class="card-title">Automação de Ponta a Ponta</h3>
                    <p class="card-text">Desde a leitura de prints de tela até o salvamento nos servidores de rede e publicação simultânea no Sankhya ERP via API e SFTP/FTP.</p>
                </div>
                <div class="card">
                    <div class="card-icon">🛡️</div>
                    <h3 class="card-title">Configuração Zero</h3>
                    <p class="card-text">O sistema já sai de fábrica pré-configurado com todas as rotas de rede, credenciais do ERP e regras de nomenclatura corporativa.</p>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 2: INSTALAÇÃO -->
        <section id="instalacao" class="manual-section">
            <div class="section-header">
                <div class="section-num">02</div>
                <h2 class="section-title">Instalação Autônoma (.exe)</h2>
            </div>
            <p class="section-desc">
                O instalador foi construído para funcionar de forma 100% autônoma ("One-Click"), sem perguntas técnicas, garantindo facilidade para qualquer colaborador instalar.
            </p>

            <div class="step-list">
                <div class="step-item">
                    <div class="step-badge">1</div>
                    <div class="step-content">
                        <div class="step-title">Executar o Instalador</div>
                        <div class="step-desc">Dê um duplo clique no arquivo <code>MultiPic Setup 1.0.0.exe</code>. Não é necessário executar como administrador nem escolher caminhos de pasta.</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">2</div>
                    <div class="step-content">
                        <div class="step-title">Instalação Silenciosa</div>
                        <div class="step-desc">O instalador descompacta os arquivos, copia os módulos de inteligência artificial e registra o programa de forma silenciosa.</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">3</div>
                    <div class="step-content">
                        <div class="step-title">Atalhos Automáticos & Abertura</div>
                        <div class="step-desc">Um atalho com o ícone oficial é criado instantaneamente na sua <strong>Área de Trabalho</strong> e no <strong>Menu Iniciar</strong>, abrindo o MultiPic pronto para o uso.</div>
                    </div>
                </div>
            </div>

            <div class="callout success">
                <div class="callout-icon">✅</div>
                <div class="callout-content">
                    <h4>Pronto de Primeira</h4>
                    <p>Ao abrir em qualquer computador novo, o MultiPic detecta a instalação limpa e já carrega automaticamente todos os perfis de exportação e credenciais integradas.</p>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 2.1: ATUALIZAÇÕES AUTOMÁTICAS -->
        <section id="auto-update" class="manual-section">
            <div class="section-header">
                <div class="section-num">02.1</div>
                <h2 class="section-title">Atualizações Automáticas via GitHub</h2>
            </div>
            <p class="section-desc">
                O MultiPic possui integração nativa com o GitHub Releases da organização para manter todas as máquinas da empresa sempre atualizadas sem intervenção manual.
            </p>

            <div class="card-grid">
                <div class="card">
                    <div class="card-icon">📡</div>
                    <h3 class="card-title">Verificação ao Iniciar</h3>
                    <p class="card-text">Ao abrir o programa, ele consulta automaticamente o repositório <code>CASSULDISTRIBUIDORA/IMAGENS-DESCRI-ES</code> para conferir se há uma versão mais recente.</p>
                </div>
                <div class="card">
                    <div class="card-icon">⬇️</div>
                    <h3 class="card-title">Download Silencioso em Segundo Plano</h3>
                    <p class="card-text">Havendo atualização, o download do novo instalador ocorre de forma invisível em background enquanto você continua trabalhando normalmente.</p>
                </div>
                <div class="card">
                    <div class="card-icon">🚀</div>
                    <h3 class="card-title">Aplicação com 1 Clique</h3>
                    <p class="card-text">Assim que o download termina, surge um aviso informando a disponibilidade da nova versão com o botão <strong>"Reiniciar e Atualizar"</strong>, ou a atualização se aplica automaticamente ao fechar o app.</p>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 3: CONFIGURAÇÕES DE FÁBRICA -->
        <section id="configuracoes" class="manual-section">
            <div class="section-header">
                <div class="section-num">03</div>
                <h2 class="section-title">Configurações & Padrões de Fábrica</h2>
            </div>
            <p class="section-desc">
                O aplicativo vem calibrado com os parâmetros operacionais da empresa. Para visualizá-los, clique no ícone de engrenagem na barra de título ou acesse <kbd>Arquivo</kbd> &gt; <kbd>Configurações</kbd>.
            </p>

            <div class="card-grid">
                <div class="card">
                    <div class="card-icon">📦</div>
                    <h3 class="card-title">Perfil 1: Sankhya ERP</h3>
                    <p class="card-text">
                        • Formato: <strong>JPG</strong><br>
                        • Dimensão: <strong>300 x 300 px</strong> (Fundo Branco <code>#FFFFFF</code>)<br>
                        • Qualidade: <strong>90%</strong><br>
                        • Destino: <code>\\\\192.168.10.23\\Marketing_Operacional\\01 CASSUL DISTRIBUIDORA\\SANKHYA\\IMAGENS SANKHYA</code>
                    </p>
                </div>
                <div class="card">
                    <div class="card-icon">🎨</div>
                    <h3 class="card-title">Perfil 2: Tablóide / Catálogo / Site</h3>
                    <p class="card-text">
                        • Formato: <strong>PNG</strong> com Fundo Transparente<br>
                        • Dimensão: <strong>1000 x 1000 px</strong><br>
                        • Qualidade: <strong>100%</strong><br>
                        • Destino: <code>\\\\192.168.10.23\\Marketing_Operacional\\01 CASSUL DISTRIBUIDORA\\IMPRESSOS\\TABLÓIDES\\IMAGENS TABLOIDES</code>
                    </p>
                </div>
            </div>

            <div class="callout info">
                <div class="callout-icon">💡</div>
                <div class="callout-content">
                    <h4>Acesso aos Diretórios de Rede</h4>
                    <p>Certifique-se de que o computador está conectado à rede corporativa cabeada ou Wi-Fi interna (ou via VPN caso trabalhe em home office) para que as gravações automáticas em <code>\\\\192.168.10.23</code> ocorram normalmente.</p>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 4: INTEGRAÇÃO SANKHYA -->
        <section id="integracoes" class="manual-section">
            <div class="section-header">
                <div class="section-num">04</div>
                <h2 class="section-title">Integração Nativa Sankhya ERP & FTP</h2>
            </div>
            <p class="section-desc">
                O MultiPic comunica-se diretamente com o banco de dados e repositório de arquivos do Sankhya.
            </p>

            <div class="step-list">
                <div class="step-item">
                    <div class="step-badge">API</div>
                    <div class="step-content">
                        <div class="step-title">Gateway de Serviços (MGE)</div>
                        <div class="step-desc">Utiliza autenticação Bearer com renovação automática de token para consultar SKUs, nome de produtos, marcas e categorias, além de atualizar a imagem principal na tabela <code>TGFPRO</code> e o campo de descrição.</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">FTP</div>
                    <div class="step-content">
                        <div class="step-title">Repositório de Arquivos do Servidor</div>
                        <div class="step-desc">Conecta-se ao servidor <code>192.168.10.138</code> no caminho <code>/home/mgeweb/repositorio/imagem/imagensprodutos</code> para gravação física das fotos vinculadas.</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 5: CRIAÇÃO EM LOTE E OCR DE PRINTS -->
        <section id="criacao-lote" class="manual-section">
            <div class="section-header">
                <div class="section-num">05</div>
                <h2 class="section-title">Criação em Lote Inteligente & Leitura de Prints (OCR)</h2>
            </div>
            <p class="section-desc">
                Adicione múltiplos produtos de uma só vez digitando, colando listas ou simplesmente tirando prints de tela!
            </p>

            <div class="step-list">
                <div class="step-item">
                    <div class="step-badge">1</div>
                    <div class="step-content">
                        <div class="step-title">Capturar Print da Tela</div>
                        <div class="step-desc">Pressione <kbd>Windows</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> no seu teclado e selecione qualquer área da tela contendo códigos de produtos (relatórios, planilhas, notas fiscais ou telas do Sankhya).</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">2</div>
                    <div class="step-content">
                        <div class="step-title">Colar Diretamente na Caixa de Texto</div>
                        <div class="step-desc">No MultiPic, clique no botão <strong>"Criar em Lote"</strong> no topo da página. Em seguida, pressione <kbd>Ctrl</kbd> + <kbd>V</kbd> dentro da caixa de texto (ou arraste a imagem do print para dentro dela).</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">3</div>
                    <div class="step-content">
                        <div class="step-title">Extração Instantânea por IA</div>
                        <div class="step-desc">O modelo visual do Gemini examina o print e transcreve automaticamente apenas os números de SKU, preenchendo o campo de texto sem sujeiras ou textos desnecessários.</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">4</div>
                    <div class="step-content">
                        <div class="step-title">Criar Páginas</div>
                        <div class="step-desc">Clique em <strong>"Criar Páginas"</strong>. O sistema gerará as páginas sequencialmente e consultará a descrição e marca de cada SKU no Sankhya.</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 6: EDIÇÃO E RECORTE HÍBRIDO -->
        <section id="edicao-recorte" class="manual-section">
            <div class="section-header">
                <div class="section-num">06</div>
                <h2 class="section-title">Edição & Remoção Híbrida de Fundo</h2>
            </div>
            <p class="section-desc">
                O MultiPic possui três motores inteligentes de remoção de fundo e ferramentas de retoque:
            </p>

            <div class="card-grid">
                <div class="card">
                    <div class="card-icon">⚡</div>
                    <h3 class="card-title">Remover Fundo (Automático)</h3>
                    <p class="card-text">Classifica a imagem e aplica o melhor algoritmo. Se detectar fundo branco de estúdio, utiliza recorte por tolerância de luminância; se o fundo for complexo, aciona a IA.</p>
                </div>
                <div class="card">
                    <div class="card-icon">✨</div>
                    <h3 class="card-title">Forçar Recorte de Objeto (IA)</h3>
                    <p class="card-text">Localizado no menu <strong>Editar</strong> ou no botão de varinha mágica. Ideal para recortar fotos tiradas em ambientes reais, mesas de trabalho ou fundos ruidosos.</p>
                </div>
                <div class="card">
                    <div class="card-icon">📦</div>
                    <h3 class="card-title">Forçar Preservar Embalagem</h3>
                    <p class="card-text">Especialmente desenvolvido para sachês e pacotes plásticos que possuem visor transparente ou furo de pendurador (hanger) no topo, evitando que o plástico ou o furo sejam recortados por engano.</p>
                </div>
            </div>

            <div class="card-grid">
                <div class="card">
                    <div class="card-icon">🧹</div>
                    <h3 class="card-title">Borracha Inteligente (Inpainting)</h3>
                    <p class="card-text">Selecione a ferramenta de borracha e pinte sobre selos promocionais, textos na embalagem ou manchas. A inteligência artificial reconstroi o fundo de forma imperceptível.</p>
                </div>
                <div class="card">
                    <div class="card-icon">☀️</div>
                    <h3 class="card-title">Ajustes de Iluminação</h3>
                    <p class="card-text">Sliders para Brilho, Contraste, Saturação, Exposição, Sombras e Pretos. O botão <strong>Auto</strong> ajusta o contraste de forma instantânea para fotos opacas.</p>
                </div>
                <div class="card">
                    <div class="card-icon">🔍</div>
                    <h3 class="card-title">Comparar com Original</h3>
                    <p class="card-text">A qualquer momento, segure a tecla <kbd>Espaço</kbd> ou clique em "Ver Original" para alternar instantaneamente entre a foto original e a foto tratada.</p>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 7: VARIANTES -->
        <section id="variantes" class="manual-section">
            <div class="section-header">
                <div class="section-num">07</div>
                <h2 class="section-title">Imagens Alternativas (Variantes)</h2>
            </div>
            <p class="section-desc">
                Quando um produto possui várias fotos (ângulos adicionais, tabela nutricional ou fotos de contexto):
            </p>

            <div class="step-list">
                <div class="step-item">
                    <div class="step-badge">+</div>
                    <div class="step-content">
                        <div class="step-title">Criar uma Nova Variante</div>
                        <div class="step-desc">Selecione a página do produto e pressione o atalho <kbd>Ctrl</kbd> + <kbd>D</kbd> ou clique no botão <strong>"+ Variante"</strong> no topo da página. Uma subpágina vinculada ao mesmo código será adicionada logo abaixo.</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">📁</div>
                    <div class="step-content">
                        <div class="step-title">Isolamento de Repositório (Regra de Ouro)</div>
                        <div class="step-desc">A imagem principal (Variante 0 / Página Pai) é a única enviada para a pasta local do Sankhya (300x300 JPG). As <strong>Variantes 2 em diante</strong> são gravadas <strong>exclusivamente na pasta de Tablóides/Site</strong>, mantendo o banco de imagens do ERP estritamente limpo.</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">🏷️</div>
                    <div class="step-content">
                        <div class="step-title">Nomenclatura Limpa</div>
                        <div class="step-desc">Os arquivos são nomeados de forma concisa e padronizada:
                            <br>• Imagem Principal: <code>45348.png</code> e <code>45348.jpg</code>
                            <br>• Imagens Alternativas: <code>45348_2.png</code>, <code>45348_3.png</code>, etc.
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 8: DESCRIÇÕES TÉCNICAS -->
        <section id="descricoes" class="manual-section">
            <div class="section-header">
                <div class="section-num">08</div>
                <h2 class="section-title">Descrições Técnicas & Bulas com IA</h2>
            </div>
            <p class="section-desc">
                O painel lateral direito permite gerar descrições ricas e técnicas no padrão de bulas farmacêuticas, agropecuárias e de ferramentas.
            </p>

            <div class="step-list">
                <div class="step-item">
                    <div class="step-badge">1</div>
                    <div class="step-content">
                        <div class="step-title">Foto da Bula ou Rótulo (Opcional)</div>
                        <div class="step-desc">Na seção "Referência para IA (Bula/Rótulo)", cole (<kbd>Ctrl</kbd> + <kbd>V</kbd>) ou arraste a foto do verso da embalagem ou da bula impressa. A IA lerá as especificações técnicas, dosagens e composição.</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">2</div>
                    <div class="step-content">
                        <div class="step-title">Gerar com IA</div>
                        <div class="step-desc">Clique no botão <strong>"Gerar"</strong>. O Google Gemini estruturará o texto em seções padronizadas (Título, Indicações, Fórmula, Posologia, Carência e Apresentação).</div>
                    </div>
                </div>
                <div class="step-item">
                    <div class="step-badge">3</div>
                    <div class="step-content">
                        <div class="step-title">Publicar no Sankhya</div>
                        <div class="step-desc">Clique em <strong>"Publicar Descrição"</strong>. O texto será enviado de forma imediata para o campo <code>AD_DESCRPRODSITE</code> do produto no ERP.</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 9: EXPORTAÇÃO E PUBLICAÇÃO -->
        <section id="exportacao" class="manual-section">
            <div class="section-header">
                <div class="section-num">09</div>
                <h2 class="section-title">Exportação & Publicação no Sankhya</h2>
            </div>
            <p class="section-desc">
                Como finalizar o trabalho e disponibilizar os arquivos para as equipes de arte e para o sistema.
            </p>

            <div class="card-grid">
                <div class="card">
                    <div class="card-icon">💾</div>
                    <h3 class="card-title">Exportar Atual (Ctrl+S)</h3>
                    <p class="card-text">Gera os arquivos de saída da página em exibição e grava nos diretórios ativos dos perfis configurados.</p>
                </div>
                <div class="card">
                    <div class="card-icon">📑</div>
                    <h3 class="card-title">Exportar Todas as Páginas</h3>
                    <p class="card-text">Processa todas as páginas do lote de uma única vez, exibindo uma barra de progresso com os produtos concluídos.</p>
                </div>
                <div class="card">
                    <div class="card-icon">🚀</div>
                    <h3 class="card-title">Publicar Imagem Principal no Sankhya</h3>
                    <p class="card-text">Envia o JPG 300x300 via sessionUpload e vincula diretamente ao produto no Sankhya sem precisar abrir o ERP.</p>
                </div>
            </div>
        </section>

        <!-- SEÇÃO 10: ATALHOS DE TECLADO -->
        <section id="atalhos" class="manual-section">
            <div class="section-header">
                <div class="section-num">10</div>
                <h2 class="section-title">Tabela Completa de Atalhos de Teclado</h2>
            </div>
            <p class="section-desc">
                Agilize sua rotina de trabalho utilizando os atalhos rápidos do teclado:
            </p>

            <table class="shortcuts-table">
                <thead>
                    <tr>
                        <th style="width: 220px;">Atalho</th>
                        <th>Ação Executada</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><kbd>Ctrl</kbd> + <kbd>O</kbd></td>
                        <td>Abrir diálogo para carregar novas imagens do computador</td>
                    </tr>
                    <tr>
                        <td><kbd>Ctrl</kbd> + <kbd>S</kbd></td>
                        <td>Exportar imagem da página atual para os diretórios configurados</td>
                    </tr>
                    <tr>
                        <td><kbd>Ctrl</kbd> + <kbd>V</kbd></td>
                        <td>Colar imagem do clipboard na página atual ou na caixa de criação em lote</td>
                    </tr>
                    <tr>
                        <td><kbd>Ctrl</kbd> + <kbd>D</kbd></td>
                        <td>Adicionar página variante para o mesmo produto (foto alternativa)</td>
                    </tr>
                    <tr>
                        <td><kbd>Ctrl</kbd> + <kbd>Z</kbd></td>
                        <td>Desfazer a última ação de edição/ajuste</td>
                    </tr>
                    <tr>
                        <td><kbd>Ctrl</kbd> + <kbd>Y</kbd></td>
                        <td>Refazer a última ação desfeita</td>
                    </tr>
                    <tr>
                        <td><kbd>Espaço</kbd> (segurar)</td>
                        <td>Alternar visualização com a imagem original sem cortes para comparação</td>
                    </tr>
                    <tr>
                        <td><kbd>Ctrl</kbd> + <kbd>+</kbd></td>
                        <td>Aumentar zoom da imagem no canvas</td>
                    </tr>
                    <tr>
                        <td><kbd>Ctrl</kbd> + <kbd>-</kbd></td>
                        <td>Diminuir zoom da imagem no canvas</td>
                    </tr>
                    <tr>
                        <td><kbd>Ctrl</kbd> + <kbd>0</kbd></td>
                        <td>Ajustar imagem 100% à área visível da tela</td>
                    </tr>
                    <tr>
                        <td><kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></td>
                        <td>Capturar print da tela para extração de SKUs por inteligência artificial</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <!-- SEÇÃO 11: FAQ / TROUBLESHOOTING -->
        <section id="faq" class="manual-section">
            <div class="section-header">
                <div class="section-num">11</div>
                <h2 class="section-title">Perguntas Frequentes & Solução de Problemas</h2>
            </div>
            <p class="section-desc">
                Respostas rápidas para as dúvidas e cenários mais comuns do dia a dia.
            </p>

            <div class="faq-item">
                <div class="faq-question">
                    <span>O que fazer se der erro ao salvar nos diretórios de rede?</span>
                    <span class="faq-arrow">▼</span>
                </div>
                <div class="faq-answer">
                    Verifique se o Windows consegue acessar a pasta <code>\\\\192.168.10.23</code> pelo Windows Explorer. Caso sua senha de rede corporativa tenha expirado ou você esteja em conexão externa sem a VPN conectada, o acesso a essa pasta fica bloqueado pelo Windows.
                </div>
            </div>

            <div class="faq-item">
                <div class="faq-question">
                    <span>A remoção de fundo cortou partes plásticas transparentes da embalagem. Como corrigir?</span>
                    <span class="faq-arrow">▼</span>
                </div>
                <div class="faq-answer">
                    Vá no menu superior em <strong>Editar</strong> e selecione <strong>"Forçar Preservar Embalagem"</strong>. Esse algoritmo foi calibrado para não apagar áreas de visor transparente ou o pendurador de fita plástica de sachês e pacotes.
                </div>
            </div>

            <div class="faq-item">
                <div class="faq-question">
                    <span>O programa salva automaticamente o que estou fazendo se fechar sem querer?</span>
                    <span class="faq-arrow">▼</span>
                </div>
                <div class="faq-answer">
                    Sim! O MultiPic conta com um sistema de auto-salvamento em tempo real. Se você fechar o programa ou o computador reiniciar, todas as páginas, fotos e textos editados reaparecerão intactos ao reabrir.
                </div>
            </div>

            <div class="faq-item">
                <div class="faq-question">
                    <span>Como posso limpar a sessão e começar um lote totalmente do zero?</span>
                    <span class="faq-arrow">▼</span>
                </div>
                <div class="faq-answer">
                    Basta clicar no botão <strong>"Limpar Tudo"</strong> na barra superior ou fechar as abas individualmente no ícone de lixeira de cada página.
                </div>
            </div>
        </section>

        <footer class="footer">
            <p><strong>MultiPic</strong> • Sistema Corporativo desenvolvido para CASSUL Distribuidora • Marketing & Tecnologia</p>
        </footer>

    </main>

    <script>
        document.querySelectorAll('.faq-question').forEach(q => {
            q.addEventListener('click', () => {
                const item = q.parentElement;
                item.classList.toggle('open');
            });
        });

        const searchInput = document.getElementById('manual-search');
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            const sections = document.querySelectorAll('.manual-section');
            
            sections.forEach(sec => {
                const text = sec.textContent.toLowerCase();
                if (!term || text.includes(term)) {
                    sec.style.display = 'block';
                } else {
                    sec.style.display = 'none';
                }
            });
        });

        window.addEventListener('scroll', () => {
            const sections = document.querySelectorAll('.manual-section');
            const navLinks = document.querySelectorAll('.nav-link');
            let current = '';

            sections.forEach(sec => {
                const secTop = sec.offsetTop - 100;
                if (window.pageYOffset >= secTop) {
                    current = sec.getAttribute('id');
                }
            });

            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === '#' + current) {
                    link.classList.add('active');
                }
            });
        });
    </script>
</body>
</html>
"""

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_root = os.path.join(base_dir, "MANUAL_DO_SISTEMA.html")
    target_src = os.path.join(base_dir, "src", "manual.html")

    with open(target_root, "w", encoding="utf-8") as f:
        f.write(HTML_CONTENT)
    print(f"Gravado com sucesso em: {target_root}")

    with open(target_src, "w", encoding="utf-8") as f:
        f.write(HTML_CONTENT)
    print(f"Gravado com sucesso em: {target_src}")

if __name__ == "__main__":
    main()
