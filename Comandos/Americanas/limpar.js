"use strict";

const { obterContasUsuario, removerContasUsuario } = require("./storage");
const { consultarPedidosConta } = require("./services/americanas");

/**
 * Status que indicam que o pedido já foi resgatado / entregue ou finalizado
 */
function isStatusResgatado(status) {
  const s = String(status || "").toLowerCase().trim();
  return (
    s === "delivered" ||
    s === "retirado" ||
    s === "entregue" ||
    s === "completed" ||
    s === "order-completed" ||
    s === "concluido" ||
    s === "finalizado"
  );
}

/**
 * Executa a verificação e exclusão de contas cujos pedidos já foram resgatados
 */
async function executarLimparResgatados({ ownerId, onOutput = null } = {}) {
  const emitir = async (msg) => {
    if (typeof onOutput === "function") {
      await onOutput(msg);
    }
  };

  const contas = obterContasUsuario(ownerId);
  if (contas.length === 0) {
    return {
      sucesso: true,
      mensagem: "⚠️ Você não possui nenhuma conta cadastrada para verificar.",
    };
  }

  await emitir(
    `🧹 *Iniciando verificação de pedidos resgatados...*\n` +
    `Total de contas a verificar: *${contas.length}*.\nAguarde enquanto checamos os status junto à Americanas.`
  );

  const contasParaRemover = [];
  const contasMantidas = [];

  for (let i = 0; i < contas.length; i++) {
    const c = contas[i];
    try {
      const res = await consultarPedidosConta({
        email: c.email,
        password: c.password,
      });

      const pedidos = res.pedidos || [];

      if (pedidos.length === 0) {
        // Se a conta não tem pedidos (ou nunca comprou), mantemos ou perguntamos
        contasMantidas.push({
          email: c.email,
          motivo: "Nenhum pedido encontrado",
          pedidos: [],
        });
        continue;
      }

      // Verifica se todos os pedidos desta conta já foram resgatados
      const temPedidoPendente = pedidos.some(
        (p) =>
          !isStatusResgatado(p.status) &&
          (p.prontoParaRetirada === "sim" || p.status === "payment-approved" || (p.retirada && p.retirada !== "(não encontrado)"))
      );

      if (!temPedidoPendente) {
        // Todos os pedidos estão entregues/resgatados!
        contasParaRemover.push({
          email: c.email,
          motivo: "Todos os pedidos já foram retirados/entregues",
          pedidos,
        });
      } else {
        contasMantidas.push({
          email: c.email,
          motivo: "Possui pedido pendente de retirada",
          pedidos,
        });
      }
    } catch (errConta) {
      // Se deu erro ao logar ou consultar, mantemos para segurança
      contasMantidas.push({
        email: c.email,
        motivo: `Aviso na consulta: ${errConta.message || "Erro de login"}`,
        pedidos: [],
      });
    }
  }

  // Remove as contas identificadas do armazenamento do usuário
  if (contasParaRemover.length > 0) {
    const emails = contasParaRemover.map((c) => c.email);
    removerContasUsuario(ownerId, emails);
  }

  // Monta a resposta
  const linhas = [
    "🧹 *Americanas - Limpeza de Contas Concluída*",
    "",
    `🗑️ *Contas excluídas (pedidos resgatados):* *${contasParaRemover.length}*`,
  ];

  if (contasParaRemover.length > 0) {
    for (const c of contasParaRemover) {
      const pedidosStr = c.pedidos.map((p) => `${p.pedido} (${p.statusDescricao || p.status})`).join(", ");
      linhas.push(`• \`${c.email}\` - ${pedidosStr || "Resgatado"}`);
    }
  } else {
    linhas.push("_Nenhuma conta com todos os pedidos resgatados no momento._");
  }

  linhas.push("");
  linhas.push(`📦 *Contas ativas mantidas:* *${contasMantidas.length}*`);
  if (contasMantidas.length > 0) {
    for (const c of contasMantidas) {
      const pendentes = c.pedidos
        .filter((p) => p.prontoParaRetirada === "sim" || p.retirada)
        .map((p) => `Cód: *${p.retirada}* (${p.prontoParaRetirada === "sim" ? "Pronto ✅" : "⏳"})`)
        .join(" | ");
      linhas.push(`• \`${c.email}\`${pendentes ? ` - ${pendentes}` : ` (${c.motivo})`}`);
    }
  }

  return {
    sucesso: true,
    removidas: contasParaRemover.length,
    mantidas: contasMantidas.length,
    mensagem: linhas.join("\n"),
  };
}

module.exports = {
  executarLimparResgatados,
  isStatusResgatado,
};
