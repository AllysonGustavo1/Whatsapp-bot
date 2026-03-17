const { create } = require("@open-wa/wa-automate");
const { criarMembro } = require("./CaucauShowGenerator");

const PREFIX = "/";
const runningByChat = new Set();

const COMMANDS = {
  help: ["help", "ajuda", "comandos"],
  cacaushow: ["cacaushow"],
};

const HELP_MESSAGE = [
  "🤖 *Allysongs Bot*",
  "",
  "Comandos disponíveis:",
  "• /help",
  "• /ajuda",
  "• /comandos",
  "• /cacaushow",
].join("\n");

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

      if (isHelpCommand(content)) {
        await client.sendText(message.from, HELP_MESSAGE);
        return;
      }

      if (isCacauShowCommand(content)) {
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
            onOutput: async (texto) => {
              await client.sendText(message.from, String(texto));
            },
          });

          await client.sendText(
            message.from,
            [
              "✅ Fluxo finalizado.",
              `Código: ${resultado.experienciaMembroId || "N/A"}`,
              `Validade: ${resultado.validade || "N/A"}`,
            ].join("\n"),
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

create({
  sessionId: "allysongs-bot",
  multiDevice: true,
  qrTimeout: 0,
  authTimeout: 0,
  headless: true,
  logConsole: true,
})
  .then(start)
  .catch((error) => {
    console.error("❌ Falha ao iniciar o bot:", error);
  });
