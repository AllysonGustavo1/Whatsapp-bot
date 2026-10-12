const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const https = require("https");
const os = require("os");
const { execSync } = require("child_process");

puppeteer.use(StealthPlugin());

function obterCaminhoChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  if (process.env.CHROME_PATH) {
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
      if (fs.existsSync(c)) return c;
    }
  } else {
    const caminhosLinux = [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
    ];
    for (const c of caminhosLinux) {
      if (fs.existsSync(c)) return c;
    }
  }
  return undefined;
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
  try {
    const result = execSync(`python "${scriptPath}" "${mp3Path}"`, {
      encoding: "utf8",
      timeout: 15000,
    });
    return result.trim();
  } catch (err) {
    console.warn("[reCAPTCHA] Falha ao transcrever áudio com Python:", err.message);
    return "";
  }
}

async function resolverRecaptchaRegistro({ onLog } = {}) {
  const log = (msg) => {
    if (typeof onLog === "function") onLog(msg);
    console.log(`[reCAPTCHA] ${msg}`);
  };

  const executablePath = obterCaminhoChrome();
  log("Iniciando navegador em modo stealth para resolver validação de segurança...");

  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,1200",
    ],
  });

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

    await bframe.waitForSelector("#recaptcha-audio-button", { timeout: 15000 });
    await bframe.click("#recaptcha-audio-button");
    await new Promise((r) => setTimeout(r, 3000));

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
      throw new Error("Não foi possível transcrever o áudio do reCAPTCHA.");
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
