"use strict";

const {
  obterPerfilUsuario,
  salvarPerfilUsuario,
  limparPerfilUsuario,
} = require("./storage");
const { ajustarSenha } = require("./criarConta");

/**
 * Monta as linhas formatadas de todos os campos do perfil.
 * Campos não preenchidos exibem explicitamente _Aleatório_.
 */
function formatarCamposPerfil(perfil = {}) {
  const p = perfil || {};
  return [
    `• *Nome:* ${p.nome || "_Aleatório_"}`,
    `• *Senha:* ${p.senha ? `\`${p.senha}\`` : "_Aleatória (padrão do sistema)_"}`,
    `• *Nascimento:* ${p.nascimento || "_Aleatório_"}`,
    `• *Sexo:* ${p.sexo || "_Aleatório_"}`,
    `• *CPF:* ${p.cpf || "_Aleatório_"}`,
    `• *Telefone:* ${p.telefone || "_Aleatório_"}`,
    `• *CEP:* ${p.cep || "_Aleatório_"}`,
  ];
}

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
        mensagem: [
          "✅ *Seu perfil fixo foi removido com sucesso!*",
          "",
          "Agora, ao criar novas contas, todos os campos voltarão a ser gerados como *Aleatório*:",
          "",
          ...formatarCamposPerfil({}),
        ].join("\n"),
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
  if (options.cep) dadosParaSalvar.cep = options.cep;
  if (options.endereco) dadosParaSalvar.endereco = options.endereco;

  const temCamposNovos = Object.keys(dadosParaSalvar).length > 0;

  // 2. Ação: Se passou campos novos -> salva e atualiza o perfil do usuário
  if (temCamposNovos) {
    const perfilAtualizado = salvarPerfilUsuario(ownerId, dadosParaSalvar);

    const linhas = [
      "✅ *Perfil Americanas Configurado com Sucesso!*",
      "",
      "A partir de agora, suas novas contas usarão esses dados automaticamente:",
      "",
      ...formatarCamposPerfil(perfilAtualizado),
      "",
      "💡 _Para criar contas agora, basta enviar:_ */americanas criar conta*",
      "🗑️ _Para remover seu perfil fixo:_ */americanas perfil limpar*",
    ];

    return {
      sucesso: true,
      perfil: perfilAtualizado,
      mensagem: linhas.join("\n"),
    };
  }

  // 3. Ação: Consulta do perfil atual (/americanas perfil)
  const perfilAtual = obterPerfilUsuario(ownerId);

  // Se não tem nada configurado ainda:
  if (!perfilAtual || Object.keys(perfilAtual).length === 0) {
    return {
      sucesso: true,
      mensagem: [
        "👤 *Americanas - Seu Perfil Padrão*",
        "",
        ...formatarCamposPerfil({}),
        "",
        "⚠️ _Você ainda não configurou um perfil fixo. Suas contas estão sendo criadas com dados fictícios gerados automaticamente a cada criação._",
        "",
        "📌 *Como salvar seus dados fixos (basta fazer uma vez):*",
        '• `/americanas perfil nome="Seu Nome Completo" senha="SuaSenha123" nascimento="2000-05-23" sexo="masculino"`',
        "",
        "💡 _Depois de configurar, basta enviar `/americanas criar conta` que ele usará seu perfil automaticamente!_",
      ].join("\n"),
    };
  }

  // Se já possui perfil configurado:
  const linhas = [
    "👤 *Americanas - Seu Perfil Salvo*",
    "",
    ...formatarCamposPerfil(perfilAtual),
    "",
    "✨ _Ao criar contas com `/americanas criar conta`, os dados definidos serão aplicados e os marcados como Aleatório serão gerados automaticamente._",
    "",
    "✏️ _Para alterar/adicionar campos: envie `/americanas perfil [novos campos]`_",
    "🗑️ _Para resetar seu perfil: envie `/americanas perfil limpar`_",
  ];

  return {
    sucesso: true,
    perfil: perfilAtual,
    mensagem: linhas.join("\n"),
  };
}

module.exports = {
  executarPerfil,
  formatarCamposPerfil,
};
