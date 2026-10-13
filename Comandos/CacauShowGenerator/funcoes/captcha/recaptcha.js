const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const https = require("https");
const os = require("os");
const { execSync } = require("child_process");

puppeteer.use(StealthPlugin());

function verificarExecutavel(caminho) {
  if (!caminho || typeof caminho !== "string") return false;
  try {
    if (!fs.existsSync(caminho)) return false;
    // No Linux/Unix, testar se roda --version para evitar stubs falsos como o wrapper do snap
    if (process.platform !== "win32") {
      const stats = fs.statSync(caminho);
      if (!stats.isFile() && !stats.isSymbolicLink()) return false;
      execSync(`"${caminho}" --version`, { stdio: "ignore", timeout: 4000 });
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function obterCaminhoChrome() {
  if (
    process.env.PUPPETEER_EXECUTABLE_PATH &&
    verificarExecutavel(process.env.PUPPETEER_EXECUTABLE_PATH)
  ) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (
    process.env.CHROME_PATH &&
    verificarExecutavel(process.env.CHROME_PATH)
  ) {
    return process.env.CHROME_PATH;
  }

  if (process.platform === "win32") {
    const caminhos = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
    for (const c of caminhos) {
      if (verificarExecutavel(c)) return c;
    }
  } else {
    const caminhosLinux = [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
      "/usr/lib/chromium/chromium",
      "/usr/lib/chromium-browser/chromium-browser",
      "/usr/bin/chromium-browser",
    ];
    for (const c of caminhosLinux) {
      if (verificarExecutavel(c)) return c;
    }
  }

  // Tenta obter o binário gerenciado pelo Puppeteer
  try {
    const puppeteerBase = require("puppeteer");
    if (typeof puppeteerBase.executablePath === "function") {
      const pPath = await puppeteerBase.executablePath();
      if (verificarExecutavel(pPath)) {
        return pPath;
      }
    }
  } catch (_) {}

  return undefined;
}

function obterComandoPython() {
  const comandos = ["python3", "python"];
  for (const cmd of comandos) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore", timeout: 3000 });
      return cmd;
    } catch (_) {}
  }
  return "python3";
}

function downloadAudio(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

function transcreverAudio(mp3Path) {
  const scriptPath = path.join(__dirname, "transcribe.py");
  const pyCmd = obterComandoPython();
  try {
    const result = execSync(`${pyCmd} "${scriptPath}" "${mp3Path}"`, {
      encoding: "utf8",
      timeout: 20000,
    });
    return result.trim();
  } catch (err) {
    const detalhe = err.stderr ? String(err.stderr).trim() : err.message;
    console.warn(`[reCAPTCHA] Falha ao transcrever áudio com ${pyCmd}:`, detalhe);
    throw new Error(`Falha no Python de transcrição (${pyCmd}): ${detalhe}`);
  }
}

async function resolverRecaptchaRegistro({ onLog } = {}) {
  const log = (msg) => {
    if (typeof onLog === "function") onLog(msg);
    console.log(`[reCAPTCHA] ${msg}`);
  };

  const executablePath = await obterCaminhoChrome();
  log("Iniciando navegador em modo stealth para resolver validação de segurança...");

  const launchOptions = {
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-first-run",
      "--no-zygote",
      "--window-size=1280,1200",
    ],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
  } catch (errLaunch) {
    if (process.platform === "linux") {
      log("Tentando baixar o Chrome automaticamente via Puppeteer...");
      try {
        execSync("npx puppeteer browsers install chrome", {
          stdio: "ignore",
          timeout: 60000,
        });
        const novoCaminho = await obterCaminhoChrome();
        if (novoCaminho) launchOptions.executablePath = novoCaminho;
        browser = await puppeteer.launch(launchOptions);
      } catch (errAutoInstall) {
        throw new Error(
          `Não foi possível iniciar o Chrome no servidor: ${errLaunch.message}.\n` +
          `Execute no terminal do Ubuntu:\n` +
          `wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo dpkg -i google-chrome-stable_current_amd64.deb || sudo apt-get install -f -y`
        );
      }
    } else {
      throw new Error(`Não foi possível iniciar o navegador: ${errLaunch.message}`);
    }
  }

  const tempAudioPath = path.join(os.tmpdir(), `recaptcha_${Date.now()}.mp3`);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1200 });

    log("Acessando página de cadastro...");
    await page.goto("https://lovers.cacaushow.com.br/register", {
      waitUntil: "networkidle2",
      timeout: 35000,
    });

    const recaptchaFrameElement = await page.waitForSelector(
      'iframe[src*="recaptcha/api2/anchor"]',
      { timeout: 20000 }
    );
    const recaptchaFrame = await recaptchaFrameElement.contentFrame();

    log("Interagindo com validação...");
    await recaptchaFrame.click("#recaptcha-anchor");
    await new Promise((r) => setTimeout(r, 2500));

    // Verifica se foi resolvido imediatamente sem desafio
    let token = await page.evaluate(() => {
      const el = document.querySelector('textarea[name="g-recaptcha-response"]');
      return el ? el.value : "";
    });

    if (token) {
      log("Validação concluída imediatamente!");
      return token;
    }

    log("Resolvendo desafio por áudio...");
    const bframeElement = await page.waitForSelector(
      'iframe[src*="recaptcha/api2/bframe"]',
      { timeout: 20000 }
    );
    const bframe = await bframeElement.contentFrame();

    // Checa se o Google já bloqueou o IP para desafios automatizados
    const bloqueioInicial = await bframe.evaluate(() => {
      const el = document.querySelector(
        ".rc-doscaptcha-header-text, .rc-doscaptcha-body-text"
      );
      return el ? el.innerText.trim() : null;
    });
    if (bloqueioInicial) {
      throw new Error(`Google bloqueou requisições neste IP: "${bloqueioInicial}"`);
    }

    await bframe.waitForSelector("#recaptcha-audio-button", { timeout: 15000 });
    await bframe.click("#recaptcha-audio-button");
    await new Promise((r) => setTimeout(r, 3000));

    const bloqueioAposAudio = await bframe.evaluate(() => {
      const el = document.querySelector(
        ".rc-doscaptcha-header-text, .rc-doscaptcha-body-text, .rc-audiochallenge-error-message"
      );
      return el ? el.innerText.trim() : null;
    });
    if (bloqueioAposAudio) {
      throw new Error(`Google bloqueou o áudio neste IP: "${bloqueioAposAudio}"`);
    }

    const audioUrl = await bframe.evaluate(() => {
      const audio =
        document.querySelector("#audio-source") ||
        document.querySelector(".rc-audiochallenge-tdownload-link");
      return audio ? audio.src || audio.href : null;
    });

    if (!audioUrl) {
      throw new Error("Link do áudio do reCAPTCHA não encontrado.");
    }

    log("Processando áudio...");
    await downloadAudio(audioUrl, tempAudioPath);

    const textoTranscrito = transcreverAudio(tempAudioPath);
    if (!textoTranscrito) {
      throw new Error("Áudio do reCAPTCHA não pôde ser transcrito.");
    }

    log(`Inserindo resposta da validação...`);
    await bframe.waitForSelector("#audio-response", { timeout: 10000 });
    await bframe.type("#audio-response", textoTranscrito);
    await bframe.click("#recaptcha-verify-button");
    await new Promise((r) => setTimeout(r, 4000));

    token = await page.evaluate(() => {
      const el = document.querySelector('textarea[name="g-recaptcha-response"]');
      return el ? el.value : "";
    });

    if (!token) {
      throw new Error("Token não gerado após confirmação do desafio.");
    }

    log("Validação de segurança resolvida com sucesso!");
    return token;
  } finally {
    if (fs.existsSync(tempAudioPath)) {
      try {
        fs.unlinkSync(tempAudioPath);
      } catch (_) {}
    }
    await browser.close();
  }
}

module.exports = {
  resolverRecaptchaRegistro,
};
