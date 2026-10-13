#!/usr/bin/env bash
set -e

echo "=========================================="
echo "  Instalação de Dependências - Whatsapp Bot"
echo "=========================================="

echo "[1/4] Atualizando repositórios do sistema..."
sudo apt-get update -y

echo "[2/4] Instalando dependências de sistema e Python..."
sudo apt-get install -y wget curl gnupg libsndfile1 python3 python3-pip

echo "[3/4] Instalando módulos Python para transcrição de áudio..."
pip3 install --break-system-packages soundfile SpeechRecognition 2>/dev/null || pip3 install soundfile SpeechRecognition

echo "[4/4] Instalando Google Chrome oficial..."
if ! command -v google-chrome-stable &> /dev/null; then
    wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    sudo apt-get install -y /tmp/google-chrome.deb || (sudo dpkg -i /tmp/google-chrome.deb && sudo apt-get install -f -y)
    rm -f /tmp/google-chrome.deb
    echo "Google Chrome instalado com sucesso!"
else
    echo "Google Chrome já está instalado."
fi

echo "=========================================="
echo "  Ambiente configurado com sucesso!"
echo "=========================================="
