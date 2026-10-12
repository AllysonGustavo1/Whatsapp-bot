"use strict";

const { salvarContaUsuario, obterPerfilUsuario } = require("./storage");
const { criarContaCompleta } = require("./services/americanas");
const {
  gerarCPF,
  gerarNomeCompleto,
  gerarTelefone,
  gerarSenhaForte,
  gerarDataNascimento,
  gerarSexo,
} = require("./utils/generators");

/**
 * Valida e ajusta a senha para os requisitos da VTEX/Americanas
 */
function ajustarSenha(senhaInformada) {
  if (!senhaInformada) {
    return process.env.AMERICANAS_DEFAULT_PASSWORD || gerarSenhaForte();
  }

  let senha = String(senhaInformada).trim();
  const hasUpper = /[A-Z]/.test(senha);
  const hasLower = /[a-z]/.test(senha);
  const hasNumber = /[0-9]/.test(senha);
  const hasLength = senha.length >= 8;

  if (!hasUpper && hasLower && hasNumber && hasLength) {
    senha = senha.charAt(0).toUpperCase() + senha.slice(1);
  }

  return senha;
}

/**
 * Executa a criação de uma ou mais contas e salva vinculando ao usuário
 */
async function executarCriarConta({
  ownerId,
  options = {},
  onOutput = null,
} = {}) {
  const emitir = async (msg) => {
    if (typeof onOutput === "function") {
      await onOutput(msg);
    }
  };

  const count = Math.min(Math.max(parseInt(options.accounts || options.count || 1, 10) || 1, 1), 10);
  const profileEnabled = options.profile !== false;
  const perfilUsuario = (ownerId ? obterPerfilUsuario(ownerId) : null) || {};

  await emitir(
    `🚀 *Iniciando criação de ${count} conta(s) na Americanas...*\n` +
    `⚙️ *Perfil e endereço:* ${profileEnabled ? "Ativado" : "Desativado"}\n` +
    (perfilUsuario.nome ? `👤 *Usando perfil fixo:* ${perfilUsuario.nome}\n` : "") +
    `⏳ Aguarde enquanto o e-mail temporário e os códigos são validados.`
  );

  const contasCriadas = [];
  const falhas = [];

  for (let i = 1; i <= count; i++) {
    const prefixoLog = `[${i}/${count}]`;

    const nomeFicticio = gerarNomeCompleto();
    const nomeFinal = options.nome || perfilUsuario.nome || nomeFicticio.nomeCompleto;
    const senhaFinal = ajustarSenha(options.senha || options.password || perfilUsuario.senha);
    const nascimentoFinal = options.nascimento || perfilUsuario.nascimento || gerarDataNascimento();
    const sexoFinal = options.sexo || perfilUsuario.sexo || gerarSexo();
    const cpfFinal = options.cpf || perfilUsuario.cpf || gerarCPF();
    const telefoneFinal = options.telefone || perfilUsuario.telefone || gerarTelefone();

    try {
      await emitir(`⏳ ${prefixoLog} Criando e-mail temporário e solicitando código na Americanas...`);

      const conta = await criarContaCompleta({
        senha: senhaFinal,
        preencherPerfil: profileEnabled,
        dadosPerfil: {
          nome: nomeFinal,
          cpf: cpfFinal,
          telefone: telefoneFinal,
          nascimento: nascimentoFinal,
          sexo: sexoFinal,
        },
        onProgress: async ({ step, info }) => {
          if (step === "email_code_received") {
            await emitir(`📩 ${prefixoLog} ${info}`);
          } else if (step === "password_set") {
            await emitir(`🔑 ${prefixoLog} Senha definitiva vinculada com sucesso!`);
          } else if (step === "profile_updated") {
            await emitir(`📝 ${prefixoLog} Perfil e endereço salvos (Checkout liberado)!`);
          }
        },
      });

      // Salva no banco de dados local do WhatsApp-bot isolado para este usuário
      salvarContaUsuario(ownerId, conta);
      contasCriadas.push(conta);

      await emitir(
        `✅ *Conta ${i} criada com sucesso!*\n` +
        `📧 *E-mail:* \`${conta.email}\`\n` +
        `🔑 *Senha:* \`${conta.password}\`\n` +
        `👤 *Nome:* ${conta.profile?.firstName || ""} ${conta.profile?.lastName || ""}\n` +
        `📄 *CPF:* ${conta.profile?.document || cpfFinal}\n` +
        `📱 *Tel:* ${conta.profile?.phone || telefoneFinal}`
      );

      if (i < count) {
        await emitir(`⏳ Aguardando 3 segundos antes da próxima conta...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error(`[Americanas] Erro ao criar conta ${i}:`, err);
      falhas.push({ indice: i, erro: err.message || String(err) });
      await emitir(`❌ ${prefixoLog} Falha ao criar conta: ${err.message || "Erro desconhecido"}`);
    }
  }

  // Resumo final
  const resumo = [
    "🎉 *Americanas - Processo de Criação Finalizado*",
    `✅ Contas criadas: *${contasCriadas.length}/${count}*`,
  ];

  if (contasCriadas.length > 0) {
    resumo.push("\n📋 *Suas credenciais (email:senha):*");
    resumo.push("```");
    for (const c of contasCriadas) {
      resumo.push(`${c.email}:${c.password}`);
    }
    resumo.push("```");
    resumo.push("\n💾 Salvas com segurança e vinculadas exclusivamente ao seu número!");
  }

  if (falhas.length > 0) {
    resumo.push(`\n⚠️ *Falhas (${falhas.length}):*`);
    for (const f of falhas) {
      resumo.push(`• Conta ${f.indice}: ${f.erro}`);
    }
  }

  return {
    sucesso: contasCriadas.length > 0,
    contas: contasCriadas,
    falhas,
    mensagem: resumo.join("\n"),
  };
}

module.exports = {
  executarCriarConta,
  ajustarSenha,
};
