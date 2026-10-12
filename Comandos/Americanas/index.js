"use strict";

const { executarPedidos } = require("./pedidos");
const { executarCriarConta } = require("./criarConta");
const { executarLimparResgatados } = require("./limpar");
const { executarPerfil } = require("./perfil");
const { obterContasUsuario, normalizarUserId } = require("./storage");

/**
 * Monta o menu de ajuda do comando /americanas
 */
function buildAmericanasHelpMessage() {
  return [
    "🛍️ *Americanas*",
    "",
    "Escolha uma das opções abaixo:",
    "",
    "• /americanas pedidos - Consulta os pedidos e códigos de retirada das suas contas",
    "• /americanas criar conta - Cria e ativa novas contas na Americanas com perfil completo",
    "• /americanas perfil - Configura ou visualiza seu perfil padrão fixo (nome, senha, nascimento)",
    "• /americanas limpar resgatados - Exclui todas as suas contas cujos pedidos já foram retirados/entregues",
    "",
    "📌 *Como usar cada opção:*",
    "",
    "🔹 *Consultar Pedidos:*",
    "• `/americanas pedidos` (consulta todas as suas contas cadastradas)",
    "• `/americanas pedidos detalhado` (mostra os produtos comprados e valores)",
    "• `/americanas pedidos 1667939111935-01` (consulta apenas um pedido específico)",
    "",
    "🔹 *Salvar Perfil Padrão (Exclusivo por Usuário):*",
    '• `/americanas perfil nome="Allyson Silva" senha="MinhaSenha123" nascimento="2000-05-23" sexo="masculino"`',
    "• `/americanas perfil` (mostra seu perfil salvo no momento)",
    "• `/americanas perfil limpar` (reseta para voltar a gerar dados aleatórios)",
    "",
    "🔹 *Criar Contas:*",
    "• `/americanas criar conta` (cria 1 conta usando seu perfil salvo ou dados automáticos)",
    "• `/americanas criar conta 2` (cria 2 contas)",
    '• `/americanas criar conta contas=2 nome="Carlos Eduardo"` (cria contas com override)',
    "",
    "🔹 *Limpar Contas Resgatadas:*",
    "• `/americanas limpar resgatados` (remove automaticamente as contas já retiradas)",
    "",
    "🔹 *Minhas Contas:*",
    "• `/americanas contas` (lista suas contas salvas no bot)",
    "",
    "⚙️ *Campos aceitos em criar conta e perfil:*",
    "• `contas=N` ou número avulso: Quantidade de contas a criar",
    '• `nome="Nome Sobrenome"`: Nome fixo para a conta',
    '• `senha="SuaSenha123"`: Senha definitiva (mín. 8 dígitos, maiúscula, minúscula e número)',
    '• `nascimento="AAAA-MM-DD"`: Data de nascimento',
    '• `sexo="masculino"` ou `"feminino"`: Sexo para o perfil cadastral',
    '• `cpf="00000000000"`: CPF específico (opcional)',
    '• `telefone="+5511999999999"`: Telefone específico (opcional)',
    "• `sem-perfil`: Cria apenas o login sem dados de endereço",
    "",
    "🔒 _Privacidade: Cada usuário tem seu perfil, contas e pedidos 100% isolados dos demais!_",
  ].join("\n");
}

/**
 * Parser flexível e natural de diretrizes
 */
function parseDirectives(text = "") {
  let cleanText = text.trim();
  const flags = {};

  if (/\b(?:--)?(?:detalhado|detalhes|produtos)\b/i.test(cleanText)) {
    flags.detalhado = true;
    cleanText = cleanText.replace(/\b(?:--)?(?:detalhado|detalhes|produtos)\b/gi, " ");
  }

  if (/\b(?:--)?(?:no-profile|sem-perfil|sem\s+perfil|profile=false)\b/i.test(cleanText)) {
    flags.profile = false;
    cleanText = cleanText.replace(/\b(?:--)?(?:no-profile|sem-perfil|sem\s+perfil|profile=false)\b/gi, " ");
  }

  const kvRegex =
    /(?:--)?(contas?|accounts?|count|qtd|quantidade|nome|name|senha|password|pass|nascimento|birthdate|data-nascimento|sexo|gender|cpf|telefone|phone|tel|cep|endereco|rua|pedidos?|orderid|order_id|order|conta|account)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))/gi;

  cleanText = cleanText.replace(kvRegex, (match, key, val1, val2, val3) => {
    const k = key.toLowerCase();
    const v = val1 ?? val2 ?? val3 ?? "";
    flags[k] = v.trim();
    return " ";
  });

  const remainingTokens = cleanText
    .split(/\s+/)
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter((t) => t.length > 0 && t !== ",");

  for (const token of remainingTokens) {
    if (/^\d+$/.test(token) && !flags.contas && !flags.accounts && !flags.count) {
      flags.contas = parseInt(token, 10);
    } else if (token.includes("@") && token.includes(":") && !flags.conta) {
      flags.conta = token;
    } else if (/^\d{10,}-\d+$/.test(token) && !flags.pedido) {
      flags.pedido = token;
    }
  }

  const options = {
    accounts:
      parseInt(
        flags.contas ||
        flags.conta ||
        flags.accounts ||
        flags.count ||
        flags.qtd ||
        flags.quantidade ||
        1,
        10
      ) || 1,
    nome: flags.nome || flags.name || null,
    senha: flags.senha || flags.password || flags.pass || null,
    nascimento: flags.nascimento || flags.birthdate || flags["data-nascimento"] || null,
    sexo: flags.sexo || flags.gender || null,
    cpf: flags.cpf || null,
    telefone: flags.telefone || flags.phone || flags.tel || null,
    cep: flags.cep || null,
    endereco: flags.endereco || flags.rua || null,
    profile: flags.profile !== false,
    detalhado: Boolean(flags.detalhado),
    pedido: flags.pedido || flags.pedidos || flags.orderid || flags.order_id || flags.order || null,
    conta: flags.conta || flags.account || null,
    rawFlags: flags,
  };

  return options;
}

/**
 * Identifica o subcomando da Americanas a partir do texto
 */
function parseAmericanasCommand(text = "", prefix = "/") {
  if (!text.startsWith(prefix)) return null;

  const trimmed = text.trim();
  const [rawCmd, ...restArgs] = trimmed.split(/\s+/);
  const cmd = rawCmd.slice(prefix.length).toLowerCase();

  if (cmd !== "americanas" && cmd !== "ame") {
    return null;
  }

  const subTexto = restArgs.join(" ").trim();
  const subTextoLower = subTexto.toLowerCase();

  if (!subTexto || subTextoLower === "help" || subTextoLower === "ajuda") {
    return {
      tipo: "help",
      options: {},
    };
  }

  // /americanas perfil [limpar | reset | campos]
  if (subTextoLower.startsWith("perfil")) {
    const semPerfil = subTexto.replace(/^perfil\b/i, "").trim();
    const semPerfilLower = semPerfil.toLowerCase();
    let subAcao = null;
    if (semPerfilLower === "limpar" || semPerfilLower === "reset" || semPerfilLower === "remover") {
      subAcao = "limpar";
    }
    const options = parseDirectives(semPerfil);
    return {
      tipo: "perfil",
      subAcao,
      options,
    };
  }

  // /americanas limpar resgatados | /americanas excluir resgatados | /americanas remover resgatados | /americanas limpar
  if (
    subTextoLower.startsWith("limpar resgatados") ||
    subTextoLower.startsWith("excluir resgatados") ||
    subTextoLower.startsWith("remover resgatados") ||
    subTextoLower.startsWith("limpar-resgatados") ||
    subTextoLower === "limpar" ||
    subTextoLower === "excluir" ||
    subTextoLower === "remover"
  ) {
    return {
      tipo: "limpar_resgatados",
      options: {},
    };
  }

  // /americanas contas (lista as contas do usuário)
  if (subTextoLower === "contas" || subTextoLower === "minhas contas" || subTextoLower === "lista") {
    return {
      tipo: "minhas_contas",
      options: {},
    };
  }

  // /americanas pedidos [flags / parâmetros]
  if (subTextoLower.startsWith("pedidos") || subTextoLower.startsWith("pedido")) {
    const semSub = subTexto.replace(/^pedidos?\b/i, "").trim();
    const options = parseDirectives(semSub);
    return {
      tipo: "pedidos",
      options,
    };
  }

  // /americanas criar conta [diretrizes]
  if (
    subTextoLower.startsWith("criar conta") ||
    subTextoLower.startsWith("criar-conta") ||
    subTextoLower.startsWith("criarconta") ||
    subTextoLower.startsWith("criar") ||
    subTextoLower.startsWith("create")
  ) {
    const semSub = subTexto
      .replace(/^(criar\s+conta|criar-conta|criarconta|criar|create)\b/i, "")
      .trim();
    const options = parseDirectives(semSub);
    return {
      tipo: "criar_conta",
      options,
    };
  }

  return {
    tipo: "desconhecido",
    subTexto,
    options: parseDirectives(subTexto),
  };
}

module.exports = {
  buildAmericanasHelpMessage,
  parseDirectives,
  parseAmericanasCommand,
  executarPedidos,
  executarCriarConta,
  executarLimparResgatados,
  executarPerfil,
  obterContasUsuario,
  normalizarUserId,
};
