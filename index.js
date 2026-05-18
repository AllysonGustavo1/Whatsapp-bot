const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
} = require("@whiskeysockets/baileys");
const { criarMembro } = require("./Comandos/CacauShowGenerator");
const { encurtarLink } = require("./Comandos/Encurtador");
const { calcularCombustivel } = require("./Comandos/Fuel");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const pino = require("pino");

const PREFIX = "/";
const SALVAR_REQUISICOES_TXT = true;
const COMMAND_STATUS_FILE = path.join(__dirname, "comandos-status.txt");
const AUTH_FOLDER = path.join(__dirname, "auth_info_baileys");
const runningByChat = new Set();

const COMMANDS = {
  help: ["help", "ajuda", "comandos"],
  cacaushow: ["cacaushow"],
  encurtar: ["encurtar"],
  fuel: ["fuel"],
};

// ─── Utilitários de status ────────────────────────────────────────────────────

function parseStatus(value = "") {
  const normalized = String(value).trim().toLowerCase();
  return ["on", "ativo", "ligado", "true", "1"].includes(normalized);
}

function getCommandStatus() {
  const defaults = {
    help: true,
    cacaushow: true,
    encurtar: true,
    fuel: true,
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

// ─── Mensagens ────────────────────────────────────────────────────────────────

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
    `/encurtar {link} - ${label(status.encurtar)}`,
    `/fuel {p.gasolina} {p.etanol} {km/l gas} {km/l eta} - ${label(status.fuel)}`,
  ].join("\n");
}

// ─── Parsing de comandos ──────────────────────────────────────────────────────

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

function parseEncurtarCommand(text = "") {
  if (!text.startsWith(PREFIX)) return null;
  const trimmed = text.trim();
  const [rawCmd, ...args] = trimmed.split(/\s+/);
  const cmd = normalizeCommand(rawCmd);
  if (!COMMANDS.encurtar.includes(cmd)) return null;

  return {
    originalUrl: args.join(" ").trim(),
  };
}

function parseFuelCommand(text = "") {
  if (!text.startsWith(PREFIX)) return null;
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = normalizeCommand(rawCmd);
  if (!COMMANDS.fuel.includes(cmd)) return null;

  if (args.length < 4) return { incompleto: true };

  const [precoGasolina, precoEtanol, kmLGasolina, kmLEtanol] = args.map(
    (v) => parseFloat(v.replace(",", "."))
  );

  if ([precoGasolina, precoEtanol, kmLGasolina, kmLEtanol].some((n) => isNaN(n) || n <= 0)) {
    return { invalido: true };
  }

  return { precoGasolina, precoEtanol, kmLGasolina, kmLEtanol };
}

// ─── Log e envio ─────────────────────────────────────────────────────────────

function logRequest(from, content) {
  if (!content.startsWith(PREFIX)) return;
  console.log(`[REQ] ${from}: ${content}`);
}

async function sendTextWithLog(sock, to, text) {
  const output = String(text);
  console.log(`[RES] ${to}: ${output}`);
  await sock.sendMessage(to, { text: output });
}

// ─── Handler de mensagens ─────────────────────────────────────────────────────

async function handleMessage(sock, message) {
  try {
    // Ignora mensagens sem conteúdo, de broadcast ou enviadas pelo próprio bot
    if (!message.message) return;
    if (isJidBroadcast(message.key.remoteJid)) return;
    if (message.key.fromMe) return;

    const from = message.key.remoteJid;

    // Extrai o texto da mensagem (suporta texto simples, extendedText e listResponseMessage)
    const content =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.listResponseMessage?.title ||
      "";

    const commandStatus = getCommandStatus();
    const encurtarData = parseEncurtarCommand(content);
    const fuelData = parseFuelCommand(content, PREFIX, COMMANDS.fuel);

    logRequest(from, content);

    // /help /ajuda /comandos
    if (isHelpCommand(content) && commandStatus.help) {
      await sendTextWithLog(sock, from, buildHelpMessage(commandStatus));
      return;
    }

    // /cacaushow desligado
    if (isCacauShowCommand(content) && !commandStatus.cacaushow) {
      await sendTextWithLog(
        sock,
        from,
        "⛔ O comando /cacaushow está desligado no momento."
      );
      return;
    }

    // /encurtar desligado
    if (encurtarData && !commandStatus.encurtar) {
      await sendTextWithLog(
        sock,
        from,
        "⛔ O comando /encurtar está desligado no momento."
      );
      return;
    }

    // /fuel desligado
    if (fuelData && !commandStatus.fuel) {
      await sendTextWithLog(
        sock,
        from,
        "⛔ O comando /fuel está desligado no momento."
      );
      return;
    }

    // /encurtar {link}
    if (encurtarData && commandStatus.encurtar) {
      if (!encurtarData.originalUrl) {
        await sendTextWithLog(sock, from, "⚠️ Use: /encurtar {link}");
        return;
      }

      try {
        const { shortUrl } = await encurtarLink(encurtarData.originalUrl);
        await sendTextWithLog(sock, from, `✅ Link encurtado: ${shortUrl}`);
      } catch (error) {
        const messageText = String(error?.message || "").toLowerCase();
        if (messageText.includes("url")) {
          await sendTextWithLog(
            sock,
            from,
            "❌ URL inválida. Envie um link começando com http:// ou https://"
          );
          return;
        }
        console.error("Erro no /encurtar:", error);
        await sendTextWithLog(
          sock,
          from,
          "❌ Não foi possível encurtar o link agora. Tente novamente em instantes."
        );
      }

      return;
    }

    // /fuel {preço gasolina} {preço etanol} {km/l gasolina} {km/l etanol}
    if (fuelData && commandStatus.fuel) {
      if (fuelData.incompleto) {
        await sendTextWithLog(
          sock,
          from,
          "⚠️ Use: /fuel {preço gasolina} {preço etanol} {km/l gasolina} {km/l etanol}\n" +
            "Exemplo: /fuel 6.19 4.49 12 8"
        );
        return;
      }

      if (fuelData.invalido) {
        await sendTextWithLog(
          sock,
          from,
          "❌ Valores inválidos. Use números positivos.\n" +
            "Exemplo: /fuel 6.19 4.49 12 8"
        );
        return;
      }

      try {
        const resultado = calcularCombustivel(
          fuelData.precoGasolina,
          fuelData.precoEtanol,
          fuelData.kmLGasolina,
          fuelData.kmLEtanol
        );
        await sendTextWithLog(sock, from, resultado.mensagem);
      } catch (error) {
        console.error("Erro no /fuel:", error);
        await sendTextWithLog(
          sock,
          from,
          "❌ Erro ao calcular. Verifique os valores e tente novamente."
        );
      }

      return;
    }

    // /cacaushow
    if (isCacauShowCommand(content) && commandStatus.cacaushow) {
      if (runningByChat.has(from)) {
        await sendTextWithLog(
          sock,
          from,
          "⏳ Já existe uma geração em andamento para este chat."
        );
        return;
      }

      runningByChat.add(from);
      await sendTextWithLog(
        sock,
        from,
        "🚀 Iniciando o gerador Cacau Show. Aguarde as próximas mensagens..."
      );

      try {
        await criarMembro({
          salvarRequisicoesTxt: SALVAR_REQUISICOES_TXT,
          onOutput: async (texto) => {
            await sendTextWithLog(sock, from, String(texto));
          },
        });

        await sendTextWithLog(sock, from, "✅ Fluxo finalizado.");
      } catch (error) {
        console.error("Erro no /cacaushow:", error);
        await sendTextWithLog(
          sock,
          from,
          "❌ Ocorreu um erro ao executar o gerador Cacau Show."
        );
      } finally {
        runningByChat.delete(from);
      }
    }
  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
  }
}

// ─── Conexão com o Baileys ────────────────────────────────────────────────────

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    // Logger silencioso — mude para 'info' ou 'debug' se quiser mais detalhes
    logger: pino({ level: "silent" }),
    printQRInTerminal: false, // exibimos manualmente via qrcode-terminal
    browser: ["Allysongs Bot", "Chrome", "1.0.0"],
    syncFullHistory: false,
  });

  // Exibe QR Code no terminal
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 Escaneie o QR Code abaixo com o WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        `🔌 Conexão encerrada (código ${statusCode}). Reconectando: ${shouldReconnect}`
      );

      if (shouldReconnect) {
        // Aguarda 3 segundos antes de tentar reconectar
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log(
          "🚪 Sessão encerrada (logout). Apague a pasta auth_info_baileys e reinicie."
        );
      }
    }

    if (connection === "open") {
      console.log("✅ Allysongs Bot conectado ao WhatsApp com sucesso!");
    }
  });

  // Salva credenciais sempre que atualizadas
  sock.ev.on("creds.update", saveCreds);

  // Processa mensagens recebidas
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      await handleMessage(sock, msg);
    }
  });
}

// ─── Inicialização ────────────────────────────────────────────────────────────

connectToWhatsApp().catch((error) => {
  console.error("❌ Falha ao iniciar o bot:", error);
  process.exit(1);
});
