const { create } = require("@open-wa/wa-automate");
const { criarMembro } = require("./CacauShowGenerator");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PREFIX = "/";
const SALVAR_REQUISICOES_TXT = true;
const COMMAND_STATUS_FILE = path.join(__dirname, "comandos-status.txt");
const runningByChat = new Set();

const COMMANDS = {
  help: ["help", "ajuda", "comandos"],
  cacaushow: ["cacaushow"],
};

function parseStatus(value = "") {
  const normalized = String(value).trim().toLowerCase();
  return ["on", "ativo", "ligado", "true", "1"].includes(normalized);
}

function getCommandStatus() {
  const defaults = {
    help: true,
    cacaushow: true,
  };

  try {
    if (!fs.existsSync(COMMAND_STATUS_FILE)) {
      return defaults;
    }

    const raw = fs.readFileSync(COMMAND_STATUS_FILE, "utf8");
    const lines = raw.split(/\r?\n/);
    const result = { ...defaults };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const [nameRaw, statusRaw] = trimmed.includes("=")
        ? trimmed.split("=")
        : trimmed.split(":");

      const name = String(nameRaw || "")
        .trim()
        .toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(result, name)) continue;

      result[name] = parseStatus(statusRaw);
    }

    return result;
  } catch (error) {
    console.error("Erro ao ler comandos-status.txt:", error.message);
    return defaults;
  }
}

function buildHelpMessage(status) {
  const label = (isOn) => (isOn ? "✅ ativo" : "⛔ desligado");
  return [
    "🤖 *Allysongs Bot*",
    "",
    "Comandos disponíveis:",
    `/help - ${label(status.help)}`,
    `/ajuda - ${label(status.help)}`,
    `/comandos - ${label(status.help)}`,
    `/cacaushow - ${label(status.cacaushow)}`,
  ].join("\n");
}

function normalizeCommand(text = "") {
  return text.trim().toLowerCase().replace(/^\//, "");
}

function isHelpCommand(text = "") {
  if (!text.startsWith(PREFIX)) return false;
  const cmd = normalizeCommand(text);
  return COMMANDS.help.includes(cmd);
}

function isCacauShowCommand(text = "") {
  if (!text.startsWith(PREFIX)) return false;
  const cmd = normalizeCommand(text);
  return COMMANDS.cacaushow.includes(cmd);
}

async function start(client) {
  console.log("✅ Allysongs Bot iniciado com sucesso.");

  client.onMessage(async (message) => {
    try {
      const content = message.body || "";
      const commandStatus = getCommandStatus();

      if (isHelpCommand(content) && commandStatus.help) {
        await client.sendText(message.from, buildHelpMessage(commandStatus));
        return;
      }

      if (isCacauShowCommand(content) && !commandStatus.cacaushow) {
        await client.sendText(
          message.from,
          "⛔ O comando /cacaushow está desligado no momento.",
        );
        return;
      }

      if (isCacauShowCommand(content) && commandStatus.cacaushow) {
        if (runningByChat.has(message.from)) {
          await client.sendText(
            message.from,
            "⏳ Já existe uma geração em andamento para este chat.",
          );
          return;
        }

        runningByChat.add(message.from);
        await client.sendText(
          message.from,
          "🚀 Iniciando o gerador Cacau Show. Aguarde as próximas mensagens...",
        );

        try {
          const resultado = await criarMembro({
            salvarRequisicoesTxt: SALVAR_REQUISICOES_TXT,
            onOutput: async (texto) => {
              await client.sendText(message.from, String(texto));
            },
          });

          await client.sendText(
            message.from,
            ["✅ Fluxo finalizado."].join("\n"),
          );
        } catch (error) {
          console.error("Erro no /cacaushow:", error);
          await client.sendText(
            message.from,
            "❌ Ocorreu um erro ao executar o gerador Cacau Show.",
          );
        } finally {
          runningByChat.delete(message.from);
        }
      }
    } catch (error) {
      console.error("Erro ao processar mensagem:", error);
    }
  });
}

function getVPSChromeConfig() {
  const forcedPath =
    process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;

  const candidates = [
    forcedPath,
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ].filter(Boolean);

  const isUsableBrowser = (binPath) => {
    if (!fs.existsSync(binPath)) return false;

    const check = spawnSync(binPath, ["--version"], {
      encoding: "utf8",
      timeout: 10000,
    });

    const output = `${check.stdout || ""}\n${check.stderr || ""}`.toLowerCase();
    const looksLikeBrowser =
      output.includes("chromium") || output.includes("google chrome");
    return check.status === 0 && looksLikeBrowser;
  };

  const executablePath = candidates.find((bin) => isUsableBrowser(bin)) || null;

  if (!executablePath) {
    throw new Error(
      "Nenhum Chrome/Chromium válido encontrado. Instale Chromium e/ou defina CHROME_PATH com um binário funcional.",
    );
  }

  console.log(`🔧 Browser forçado: ${executablePath}`);

  return {
    useChrome: true,
    executablePath,
    browserArgs: [
      "--headless",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--remote-debugging-port=0",
      "--window-size=1366,768",
    ],
  };
}

function getOpenWaConfig() {
  const base = {
    sessionId: "allysongs-bot",
    multiDevice: true,
    qrTimeout: 0,
    authTimeout: 0,
    headless: true,
    logConsole: true,
    popup: false,
  };

  const isVPSLinux = process.platform === "linux" && !process.env.DISPLAY;
  if (!isVPSLinux) return base;

  console.log(
    "🐧 Ambiente VPS Linux detectado. Aplicando configuração de browser.",
  );

  const vpsChrome = getVPSChromeConfig();
  process.env.CHROME_PATH = vpsChrome.executablePath;
  process.env.PUPPETEER_EXECUTABLE_PATH = vpsChrome.executablePath;
  process.env.PUPPETEER_SKIP_DOWNLOAD = "true";

  return {
    ...base,
    ...vpsChrome,
    puppeteerOptions: {
      executablePath: vpsChrome.executablePath,
      args: vpsChrome.browserArgs,
      timeout: 120000,
    },
  };
}

create(getOpenWaConfig())
  .then(start)
  .catch((error) => {
    console.error("❌ Falha ao iniciar o bot:", error);
  });
