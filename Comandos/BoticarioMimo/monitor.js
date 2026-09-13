const fs = require("fs");
const path = require("path");
const { verificarMimosBoticario } = require("./index");

const MONITORES_FILE = path.join(process.cwd(), "boticariomimo-monitores.json");
const INTERVALO_MS = 30 * 1000; // 30 segundos
const REPETIR_ALERTA_APOS_MS = 10 * 60 * 1000; // 10 minutos se as mesmas lojas continuarem disponíveis

class MonitorBoticario {
  constructor() {
    this.monitores = new Map();
    this.intervalId = null;
    this.emExecucao = false;
    this.getSock = null;
    this.sendTextWithLog = null;
    this.carregarMonitores();
  }

  carregarMonitores() {
    try {
      if (fs.existsSync(MONITORES_FILE)) {
        const raw = fs.readFileSync(MONITORES_FILE, "utf8");
        const lista = JSON.parse(raw);
        for (const item of lista) {
          if (item.chatId && item.cidade) {
            this.monitores.set(item.chatId, {
              cidade: item.cidade,
              ativadoEm: item.ativadoEm || new Date().toISOString(),
              ultimoAviso: item.ultimoAviso || null,
              ultimaNotificacaoEm: item.ultimaNotificacaoEm || 0,
            });
          }
        }
        if (this.monitores.size > 0) {
          console.log(
            `[MONITOR BOTICÁRIO] ${this.monitores.size} monitor(es) ativo(s) recuperado(s) do disco.`
          );
        }
      }
    } catch (err) {
      console.error("[MONITOR BOTICÁRIO] Erro ao carregar monitores salvos:", err.message);
    }
  }

  salvarMonitores() {
    try {
      const lista = [];
      for (const [chatId, dados] of this.monitores.entries()) {
        lista.push({
          chatId,
          cidade: dados.cidade,
          ativadoEm: dados.ativadoEm,
          ultimoAviso: dados.ultimoAviso,
          ultimaNotificacaoEm: dados.ultimaNotificacaoEm,
        });
      }
      fs.writeFileSync(MONITORES_FILE, JSON.stringify(lista, null, 2), "utf8");
    } catch (err) {
      console.error("[MONITOR BOTICÁRIO] Erro ao salvar monitores:", err.message);
    }
  }

  isMonitorando(chatId) {
    return this.monitores.has(chatId);
  }

  obterMonitor(chatId) {
    return this.monitores.get(chatId);
  }

  ativar(chatId, cidade = "Natal") {
    this.monitores.set(chatId, {
      cidade,
      ativadoEm: new Date().toISOString(),
      ultimoAviso: null,
      ultimaNotificacaoEm: 0,
    });
    this.salvarMonitores();
    console.log(`[MONITOR BOTICÁRIO] Monitor ativado para ${chatId} (${cidade})`);
  }

  desativar(chatId) {
    const existia = this.monitores.delete(chatId);
    if (existia) {
      this.salvarMonitores();
      console.log(`[MONITOR BOTICÁRIO] Monitor desativado para ${chatId}`);
    }
    return existia;
  }

  alternar(chatId, cidade = "Natal") {
    if (this.isMonitorando(chatId)) {
      const monitorAntigo = this.obterMonitor(chatId);
      this.desativar(chatId);
      return {
        ativo: false,
        cidade: monitorAntigo?.cidade || cidade,
        mensagem:
          "🔴 *Monitoramento O Boticário DESATIVADO!*\n" +
          "Você não receberá mais notificações automáticas deste mimo.\n\n" +
          "_Envie /boticariomimo a qualquer momento para reativar._",
      };
    }

    this.ativar(chatId, cidade);
    return {
      ativo: true,
      cidade,
      mensagem:
        "🟢 *Monitoramento O Boticário ATIVADO!*\n\n" +
        `📍 Cidade: *${cidade}*\n` +
        "⏱️ Frequência: checando a cada *30 segundos*\n" +
        "🔔 Avisaremos assim que o mimo estiver disponível em alguma loja!\n\n" +
        "_Para desativar a qualquer momento, basta enviar /boticariomimo novamente._",
    };
  }

  iniciar({ getSock, sendTextWithLog }) {
    this.getSock = getSock;
    this.sendTextWithLog = sendTextWithLog;

    if (this.intervalId) return;

    console.log("[MONITOR BOTICÁRIO] Serviço de monitoramento a cada 30s iniciado.");
    this.intervalId = setInterval(() => this.executarRodada(), INTERVALO_MS);
  }

  async enviarMensagem(to, texto) {
    try {
      const sock = typeof this.getSock === "function" ? this.getSock() : null;
      if (!sock) {
        console.warn("[MONITOR BOTICÁRIO] Socket do WhatsApp não disponível para envio.");
        return;
      }

      if (typeof this.sendTextWithLog === "function") {
        await this.sendTextWithLog(sock, to, texto);
      } else {
        await sock.sendMessage(to, { text: texto });
      }
    } catch (err) {
      console.error(`[MONITOR BOTICÁRIO] Erro ao enviar mensagem para ${to}:`, err.message);
    }
  }

  async executarRodada() {
    if (this.emExecucao) return;
    if (this.monitores.size === 0) return;

    this.emExecucao = true;
    try {
      // Agrupa os chats por cidade para não duplicar requisições
      const cidadesMap = new Map(); // cidade -> [chatIds]
      for (const [chatId, dados] of this.monitores.entries()) {
        const cidade = dados.cidade || "Natal";
        if (!cidadesMap.has(cidade)) {
          cidadesMap.set(cidade, []);
        }
        cidadesMap.get(cidade).push(chatId);
      }

      for (const [cidade, chatIds] of cidadesMap.entries()) {
        try {
          const resultado = await verificarMimosBoticario({
            cidade,
            salvarTxt: true,
          });

          const temDisponivel =
            Array.isArray(resultado.disponiveis) && resultado.disponiveis.length > 0;

          if (temDisponivel) {
            const assinatura = resultado.disponiveis
              .map((l) => l.code)
              .sort()
              .join(",");

            const agora = Date.now();

            for (const chatId of chatIds) {
              const dados = this.monitores.get(chatId);
              if (!dados) continue;

              const mudouLojas = dados.ultimoAviso !== assinatura;
              const passouTempoLembrete =
                agora - (dados.ultimaNotificacaoEm || 0) > REPETIR_ALERTA_APOS_MS;

              if (mudouLojas || passouTempoLembrete) {
                const linhas = [
                  "🚨 *ALERTA: MIMO DISPONÍVEL NO BOTICÁRIO!*",
                  `📍 Cidade: *${cidade}*`,
                  `🛍️ Lojas com brinde liberado: *${resultado.disponiveis.length}* de ${resultado.total}\n`,
                ];

                resultado.disponiveis.forEach((loja, idx) => {
                  linhas.push(`*${idx + 1}. ${loja.storeName}*`);
                  linhas.push(
                    `📍 ${loja.storeStreetAddress}, ${loja.storeAddressNumber} - ${loja.storeDistrict}`
                  );
                  linhas.push("");
                });

                linhas.push(
                  "👉 Abra o app O Boticário imediatamente para garantir o seu resgate antes que esgote!"
                );
                linhas.push("\n_Para parar os alertas, envie /boticariomimo_");

                await this.enviarMensagem(chatId, linhas.join("\n"));

                dados.ultimoAviso = assinatura;
                dados.ultimaNotificacaoEm = agora;
              }
            }
            this.salvarMonitores();
          } else {
            // Se esgotou em todas, reseta o último aviso para quando voltar a ter estoque avisar novamente
            for (const chatId of chatIds) {
              const dados = this.monitores.get(chatId);
              if (dados && dados.ultimoAviso !== null) {
                dados.ultimoAviso = null;
              }
            }
          }
        } catch (errCidade) {
          console.error(
            `[MONITOR BOTICÁRIO] Erro na consulta de ${cidade}:`,
            errCidade.message
          );
        }
      }
    } catch (err) {
      console.error("[MONITOR BOTICÁRIO] Erro na rodada de monitoramento:", err.message);
    } finally {
      this.emExecucao = false;
    }
  }
}

const monitorBoticario = new MonitorBoticario();

module.exports = {
  monitorBoticario,
  MonitorBoticario,
};
