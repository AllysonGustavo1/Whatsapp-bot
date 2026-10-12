"use strict";

const {
  obterContasUsuario,
  importarContasLegadasSeNecessario,
} = require("./storage");
const {
  consultarPedidosConta,
} = require("./services/americanas");

function formatCurrency(centsOrValue) {
  const val = typeof centsOrValue === "number" ? centsOrValue : 0;
  return `R$ ${val.toFixed(2).replace(".", ",")}`;
}

/**
 * Consulta pedidos das contas pertencentes ao usuário
 */
async function executarPedidos({
  ownerId,
  detalhado = false,
  orderId = null,
  conta = null,
  onOutput = null,
} = {}) {
  const emitir = async (msg) => {
    if (typeof onOutput === "function") {
      await onOutput(msg);
    }
  };

  // Se não houver contas ainda, importa legadas se disponíveis
  importarContasLegadasSeNecessario(ownerId);

  let contasParaConsultar = [];

  if (conta && conta.includes(":")) {
    const [email, password] = conta.split(":");
    contasParaConsultar = [{ email: email.trim(), password: password.trim() }];
  } else {
    contasParaConsultar = obterContasUsuario(ownerId);
  }

  if (contasParaConsultar.length === 0) {
    return {
      sucesso: true,
      mensagem:
        "⚠️ Você ainda não possui nenhuma conta cadastrada.\n" +
        "Crie uma nova conta com o comando:\n" +
        "👉 */americanas criar conta*",
    };
  }

  await emitir(
    `🔍 *Consultando pedidos na Americanas...*\n` +
    `Verificando *${contasParaConsultar.length}* conta(s) sua(s). Aguarde alguns instantes.`
  );

  const todosPedidos = [];
  const todosProdutos = [];
  const erros = [];

  for (const c of contasParaConsultar) {
    try {
      const res = await consultarPedidosConta({
        email: c.email,
        password: c.password,
        orderId,
        detalhado,
      });

      if (Array.isArray(res.pedidos)) {
        todosPedidos.push(...res.pedidos);
      }
      if (Array.isArray(res.produtos)) {
        todosProdutos.push(...res.produtos);
      }
    } catch (err) {
      erros.push({ email: c.email, erro: err.message || "Erro de login" });
      todosPedidos.push({
        conta: c.email,
        pedido: "(erro)",
        retirada: "(erro)",
        prontoParaRetirada: "nao",
        status: "(erro)",
        statusDescricao: err.message,
      });
    }
  }

  if (todosPedidos.length === 0) {
    return {
      sucesso: true,
      mensagem: "ℹ️ Nenhum pedido encontrado nas suas contas.",
    };
  }

  // Monta a mensagem para o WhatsApp
  const linhas = [
    "🛍️ *Americanas - Seus Pedidos*",
    `Total de pedidos/contas: *${todosPedidos.length}*`,
    "",
  ];

  const aprovados = [];
  const outros = [];

  for (const p of todosPedidos) {
    const statusLimpo = p.statusDescricao || p.status || "(sem status)";
    const prontoTxt = p.prontoParaRetirada === "sim" ? "Sim ✅" : "Não ⏳";
    const retiradaTxt =
      p.retirada && p.retirada !== "(não encontrado)" && p.retirada !== "(erro)"
        ? `*${p.retirada}*`
        : `_${p.retirada || "Não disponível"}_`;

    const itemFormatado = [
      `🛒 *Pedido:* \`${p.pedido}\``,
      `🔑 *Código Retirada:* ${retiradaTxt}`,
      `📍 *Pronto para retirar:* ${prontoTxt}`,
      `📊 *Status:* ${statusLimpo}`,
      `👤 *Conta:* \`${p.conta}\``,
    ];

    if (p.obs) {
      itemFormatado.push(`⚠️ *Obs:* ${p.obs}`);
    }

    if (p.status === "payment-approved" || p.prontoParaRetirada === "sim") {
      aprovados.push(itemFormatado.join("\n"));
    } else {
      outros.push(itemFormatado.join("\n"));
    }
  }

  if (aprovados.length > 0) {
    linhas.push("📦 *Pedidos Aprovados / Retirada:*");
    linhas.push(aprovados.join("\n\n"));
    linhas.push("");
  }

  if (outros.length > 0) {
    linhas.push("📋 *Outros Status / Erros:*");
    linhas.push(outros.join("\n\n"));
    linhas.push("");
  }

  // Bloco rápido pedido:retirada
  const codigosValidos = todosPedidos
    .filter(
      (p) =>
        p.retirada &&
        p.retirada !== "(não encontrado)" &&
        p.retirada !== "(erro)"
    )
    .map((p) => `${p.pedido}:${p.retirada}`);

  if (codigosValidos.length > 0) {
    linhas.push("⚡ *Resumo Rápido (Pedido:Retirada):*");
    linhas.push("```");
    linhas.push(codigosValidos.join("\n"));
    linhas.push("```");
    linhas.push("");
  }

  // Detalhes dos produtos se solicitado
  if (detalhado && todosProdutos.length > 0) {
    linhas.push("🛒 *Produtos Comprados:*");
    const porConta = new Map();
    for (const prod of todosProdutos) {
      if (!porConta.has(prod.conta)) {
        porConta.set(prod.conta, []);
      }
      porConta.get(prod.conta).push(prod);
    }

    for (const [contaEmail, itens] of porConta.entries()) {
      linhas.push(`\n👤 *${contaEmail}:*`);
      for (const item of itens) {
        linhas.push(
          ` • ${item.quantidade}x ${item.produto} - ${formatCurrency(item.precoTotal)} (${item.statusDescricao || item.status})`
        );
      }
    }
  }

  return {
    sucesso: true,
    pedidos: todosPedidos,
    mensagem: linhas.join("\n"),
  };
}

module.exports = {
  executarPedidos,
};
