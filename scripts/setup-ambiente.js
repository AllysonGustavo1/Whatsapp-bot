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

function verificarChromeLinux() {
  const caminhos = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/google-chrome",
  ];
  for (const c of caminhos) {
    if (fs.existsSync(c)) {
      try {
        execSync(`"${c}" --version`, { stdio: "ignore", timeout: 3000 });
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

async function garantirAmbientePronto() {
  console.log("[Setup] Verificando dependências do ambiente...");

  if (process.platform === "linux") {
    // 1. Verificar Google Chrome
    let chromePath = verificarChromeLinux();
    if (!chromePath) {
      console.log(
        "[Setup] Google Chrome não encontrado no Linux. Instalando automaticamente..."
      );
      try {
        const cmdInstalar = [
          "wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb",
          "sudo apt-get update -y",
          "sudo apt-get install -y /tmp/google-chrome.deb || (sudo dpkg -i /tmp/google-chrome.deb && sudo apt-get install -f -y)",
          "rm -f /tmp/google-chrome.deb",
        ].join(" && ");

        execSync(cmdInstalar, { stdio: "inherit", timeout: 240000 });
        chromePath = verificarChromeLinux();
        if (chromePath) {
          console.log(`[Setup] Google Chrome instalado com sucesso: ${chromePath}`);
        } else {
          console.warn("[Setup] Instalação concluída, mas binário do Chrome ainda não detectado.");
        }
      } catch (err) {
        console.warn(
          "[Setup] Não foi possível instalar o Google Chrome automaticamente:",
          err.message
        );
      }
    } else {
      console.log(`[Setup] Google Chrome operacional detectado: ${chromePath}`);
    }

    // 2. Verificar dependências de áudio do Python
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
