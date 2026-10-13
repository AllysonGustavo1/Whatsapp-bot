#!/usr/bin/env bash
set -e

echo "=========================================="
echo "  Instalação de Dependências - Whatsapp Bot"
echo "=========================================="

ARCH=$(uname -m)
echo "Arquitetura detectada: $ARCH"

echo "[1/4] Atualizando repositórios do sistema..."
sudo apt-get update -y

echo "[2/4] Instalando dependências de sistema e Python..."
sudo apt-get install -y wget curl gnupg libsndfile1 python3 python3-pip ffmpeg

echo "[3/4] Instalando módulos Python para transcrição de áudio..."
pip3 install --break-system-packages soundfile SpeechRecognition 2>/dev/null || pip3 install soundfile SpeechRecognition

echo "[4/4] Instalando navegador compatível..."
if [ "$ARCH" = "x86_64" ]; then
    if ! command -v google-chrome-stable &> /dev/null && ! command -v google-chrome &> /dev/null; then
        echo "Instalando Google Chrome oficial (x86_64)..."
        wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
        sudo apt-get install -y /tmp/google-chrome.deb || (sudo dpkg -i /tmp/google-chrome.deb && sudo apt-get install -f -y)
        rm -f /tmp/google-chrome.deb
        echo "Google Chrome instalado com sucesso!"
    else
        echo "Google Chrome já está instalado."
    fi
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    echo "Servidor ARM64 detectado. Instalando Chromium nativo..."
    if command -v snap &> /dev/null; then
        sudo snap install chromium || true
    fi
    if ! command -v chromium &> /dev/null && ! [ -f /snap/bin/chromium ]; then
        echo "Instalando Chromium via APT/PPA..."
        sudo add-apt-repository -y ppa:saiarcot895/chromium-beta 2>/dev/null || true
        sudo apt-get update -y
        sudo apt-get install -y chromium-browser chromium || true
    fi
    echo "Chromium ARM64 pronto!"
else
    echo "Arquitetura desconhecida ($ARCH). Tentando instalar chromium..."
    sudo apt-get install -y chromium-browser chromium || true
fi

echo "=========================================="
echo "  Ambiente configurado com sucesso!"
echo "=========================================="
