"use strict";

const {
  obterPerfilUsuario,
  salvarPerfilUsuario,
  limparPerfilUsuario,
} = require("./storage");
const { ajustarSenha } = require("./criarConta");

/**
 * Trata as operações do comando /americanas perfil
 */
async function executarPerfil({ ownerId, options = {}, subAcao = null } = {}) {
  // 1. Ação: Reset / Limpeza do perfil
  if (subAcao === "limpar" || subAcao === "reset" || subAcao === "remover") {
    const removeu = limparPerfilUsuario(ownerId);
    if (removeu) {
      return {
        sucesso: true,
        mensagem:
          "✅ *Seu perfil fixo foi removido com sucesso!*\n\n" +
          "Agora, ao criar novas contas, os dados voltarão a ser gerados aleatoriamente.",
      };
    }
    return {
      sucesso: true,
      mensagem: "ℹ️ Você não possuía nenhum perfil fixo configurado.",
    };
  }

  // Extrai campos informados na mensagem
  const dadosParaSalvar = {};
  if (options.nome) dadosParaSalvar.nome = options.nome;
  if (options.senha) dadosParaSalvar.senha = ajustarSenha(options.senha);
  if (options.nascimento) dadosParaSalvar.nascimento = options.nascimento;
  if (options.sexo) dadosParaSalvar.sexo = options.sexo;
  if (options.cpf) dadosParaSalvar.cpf = options.cpf;
  if (options.telefone) dadosParaSalvar.telefone = options.telefone;

  const temCamposNovos = Object.keys(dadosParaSalvar).length > 0;

  // 2. Ação: Se passou campos novos -> salva e atualiza o perfil do usuário
  if (temCamposNovos) {
    const perfilAtualizado = salvarPerfilUsuario(ownerId, dadosParaSalvar);

    const linhas = [
      "✅ *Perfil Americanas Configurado com Sucesso!*",
      "",
      "A partir de agora, suas novas contas usarão esses dados automaticamente:",
      "",
      `👤 *Nome:* ${perfilAtualizado.nome || "_Não definido (aleatório)_"}`,
      `🔑 *Senha:* \`${perfilAtualizado.senha || "_Padrão do sistema_"}\``,
      `🎂 *Nascimento:* ${perfilAtualizado.nascimento || "_Não definido (aleatório)_"}`,
      `⚧️ *Sexo:* ${perfilAtualizado.sexo || "_Não definido (aleatório)_"}`,
    ];

    if (perfilAtualizado.cpf) {
      linhas.push(`📄 *CPF:* ${perfilAtualizado.cpf}`);
    }
    if (perfilAtualizado.telefone) {
      linhas.push(`📱 *Telefone:* ${perfilAtualizado.telefone}`);
    }

    linhas.push("");
    linhas.push("💡 _Para criar contas agora, basta enviar:_ */americanas criar conta*");
    linhas.push("🗑️ _Para remover seu perfil fixo:_ */americanas perfil limpar*");

    return {
      sucesso: true,
      perfil: perfilAtualizado,
      mensagem: linhas.join("\n"),
    };
  }

  // 3. Ação: Consulta do perfil atual (quando enviou apenas /americanas perfil)
  const perfilAtual = obterPerfilUsuario(ownerId);

  if (!perfilAtual || Object.keys(perfilAtual).length === 0) {
    return {
      sucesso: true,
      mensagem: [
        "👤 *Americanas - Seu Perfil Padrão*",
        "",
        "⚠️ Você ainda não configurou um perfil fixo.",
        "Suas contas estão sendo criadas com dados fictícios gerados automaticamente a cada criação.",
        "",
        "📌 *Como salvar seus dados fixos (basta fazer uma vez):*",
        '• `/americanas perfil nome="Seu Nome Completo" senha="SuaSenha123" nascimento="2000-05-23" sexo="masculino"`',
        "",
        "💡 _Depois de configurar, basta enviar `/americanas criar conta` que ele usará seu perfil automaticamente!_",
      ].join("\n"),
    };
  }

  const linhas = [
    "👤 *Americanas - Seu Perfil Salvo*",
    "",
    `• *Nome:* ${perfilAtual.nome || "_Não definido_"}`,
    `• *Senha:* \`${perfilAtual.senha || "_Padrão do sistema_"}\``,
    `• *Nascimento:* ${perfilAtual.nascimento || "_Não definido_"}`,
    `• *Sexo:* ${perfilAtual.sexo || "_Não definido_"}`,
  ];

  if (perfilAtual.cpf) {
    linhas.push(`• *CPF:* ${perfilAtual.cpf}`);
  }
  if (perfilAtual.telefone) {
    linhas.push(`• *Telefone:* ${perfilAtual.telefone}`);
  }

  linhas.push("");
  linhas.push("✨ _Ao criar contas com `/americanas criar conta`, esses dados serão aplicados automaticamente._");
  linhas.push("");
  linhas.push("✏️ _Para alterar algum campo: envie `/americanas perfil [novos campos]`_");
  linhas.push("🗑️ _Para resetar seu perfil: envie `/americanas perfil limpar`_");

  return {
    sucesso: true,
    perfil: perfilAtual,
    mensagem: linhas.join("\n"),
  };
}

module.exports = {
  executarPerfil,
};
