const { execSync } = require("child_process");
const fs = require("fs");

function temComando(cmd) {
  try {
    execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, {
      stdio: "ignore",
    });
    return true;
  } catch (_) {
    return false;
  }
}

function verificarNavegadorLinux() {
  const caminhos = [
    "/snap/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/google-chrome",
    "/usr/bin/chromium",
    "/usr/lib/chromium/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const c of caminhos) {
    if (fs.existsSync(c)) {
      try {
        execSync(`"${c}" --version`, { stdio: "ignore", timeout: 4000 });
        return c;
      } catch (_) {}
    }
  }
  return null;
}

function verificarPythonAudio() {
  const cmds = ["python3", "python"];
  for (const cmd of cmds) {
    try {
      execSync(`${cmd} -c "import soundfile, speech_recognition"`, {
        stdio: "ignore",
        timeout: 4000,
      });
      return true;
    } catch (_) {}
  }
  return false;
}

function temFfmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore", timeout: 3000 });
    return true;
  } catch (_) {
    return false;
  }
}

function temFlac() {
  try {
    execSync("flac --version", { stdio: "ignore", timeout: 3000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function garantirAmbientePronto() {
  console.log(`[Setup] Verificando dependências do ambiente (${process.platform} ${process.arch})...`);

  if (process.platform === "linux") {
    // 1. Verificar Navegador (Chrome ou Chromium)
    let browserPath = verificarNavegadorLinux();
    if (!browserPath) {
      console.log(
        "[Setup] Nenhum navegador compatível detectado no Linux. Instalando automaticamente..."
      );
      try {
        if (process.arch === "arm64") {
          console.log("[Setup] Arquitetura ARM64: instalando Chromium via Snap/APT...");
          try {
            execSync("sudo snap install chromium", { stdio: "inherit", timeout: 180000 });
          } catch (errSnap) {
            console.log("[Setup] Snap falhou ou indisponível, tentando via PPA APT...");
            execSync(
              "sudo add-apt-repository -y ppa:saiarcot895/chromium-beta 2>/dev/null || true && " +
              "sudo apt-get update -y && sudo apt-get install -y chromium-browser chromium",
              { stdio: "inherit", timeout: 240000 }
            );
          }
        } else {
          console.log("[Setup] Arquitetura x86_64: instalando Google Chrome oficial...");
          const cmdInstalar = [
            "wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb",
            "sudo apt-get update -y",
            "sudo apt-get install -y /tmp/google-chrome.deb || (sudo dpkg -i /tmp/google-chrome.deb && sudo apt-get install -f -y)",
            "rm -f /tmp/google-chrome.deb",
          ].join(" && ");
          execSync(cmdInstalar, { stdio: "inherit", timeout: 240000 });
        }

        browserPath = verificarNavegadorLinux();
        if (browserPath) {
          console.log(`[Setup] Navegador instalado com sucesso: ${browserPath}`);
        } else {
          console.warn("[Setup] Instalação executada, mas binário do navegador ainda não detectado.");
        }
      } catch (err) {
        console.warn(
          "[Setup] Não foi possível instalar o navegador automaticamente:",
          err.message
        );
      }
    } else {
      console.log(`[Setup] Navegador operacional detectado: ${browserPath}`);
    }

    // 2. Verificar ffmpeg (essencial para decodificação de MP3 no Ubuntu 20.04/Focal)
    if (!temFfmpeg()) {
      console.log("[Setup] ffmpeg ausente. Instalando via APT...");
      try {
        execSync("sudo apt-get update -y && sudo apt-get install -y ffmpeg", {
          stdio: "inherit",
          timeout: 120000,
        });
        console.log("[Setup] ffmpeg instalado com sucesso!");
      } catch (errFfmpeg) {
        console.warn("[Setup] Falha ao instalar ffmpeg:", errFfmpeg.message);
      }
    } else {
      console.log("[Setup] ffmpeg operacional detectado.");
    }

    // 3. Verificar flac (necessário para speech_recognition enviar áudio no Linux)
    if (!temFlac()) {
      console.log("[Setup] flac ausente. Instalando via APT...");
      try {
        execSync("sudo apt-get install -y flac", {
          stdio: "inherit",
          timeout: 60000,
        });
        console.log("[Setup] flac instalado com sucesso!");
      } catch (errFlac) {
        console.warn("[Setup] Falha ao instalar flac:", errFlac.message);
      }
    } else {
      console.log("[Setup] flac operacional detectado.");
    }

    // 3. Verificar dependências de áudio do Python
    const audioOk = verificarPythonAudio();
    if (!audioOk) {
      console.log(
        "[Setup] Dependências de áudio do Python (soundfile, SpeechRecognition) ausentes. Instalando..."
      );
      try {
        const cmdAudio = [
          "sudo apt-get install -y python3-pip libsndfile1",
          "(pip3 install --break-system-packages soundfile SpeechRecognition 2>/dev/null || pip3 install soundfile SpeechRecognition)",
        ].join(" && ");

        execSync(cmdAudio, { stdio: "inherit", timeout: 180000 });
        if (verificarPythonAudio()) {
          console.log("[Setup] Dependências Python de áudio instaladas com sucesso!");
        } else {
          console.warn("[Setup] Instalação executada, mas importação do Python ainda não confirmada.");
        }
      } catch (err) {
        console.warn(
          "[Setup] Não foi possível instalar dependências Python automaticamente:",
          err.message
        );
      }
    } else {
      console.log("[Setup] Módulos de áudio do Python operacionais.");
    }
  } else if (process.platform === "win32") {
    const audioOk = verificarPythonAudio();
    if (!audioOk) {
      console.log(
        "[Setup] Módulos Python ausentes no Windows. Tentando pip install..."
      );
      try {
        execSync("pip install soundfile SpeechRecognition", {
          stdio: "inherit",
          timeout: 120000,
        });
      } catch (_) {}
    } else {
      console.log("[Setup] Ambiente Windows verificado e pronto.");
    }
  }

  console.log("[Setup] Verificação de ambiente concluída.");
}

module.exports = {
  garantirAmbientePronto,
};

if (require.main === module) {
  garantirAmbientePronto()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Setup] Erro:", err);
      process.exit(1);
    });
}
