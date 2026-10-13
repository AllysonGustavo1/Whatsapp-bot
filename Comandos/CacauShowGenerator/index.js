const {
  CriacaoDeContaCompleta,
  fluxoResgateTrufa,
  autenticarPorEmail,
  obterPorDocumentoEmail,
  gerarNomeAleatorio,
  gerarTelefoneAleatorio,
  gerarEmailMailTm,
  aguardarCodigoEmailMailTm,
  salvarRespostasEmTxt,
  resolverRecaptchaRegistro,
} = require("./funcoes");

const USER_AGENT_PADRAO =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const API_HEADERS = globalThis.API_HEADERS || {
  accept: "application/json, text/plain, */*",
  "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "content-type": "application/json",
  origin: "https://lovers.cacaushow.com.br",
  referer: "https://lovers.cacaushow.com.br/",
  "user-agent": USER_AGENT_PADRAO,
  "sec-ch-ua":
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
};

const SENHA = "Zelele123@";
const CODIGO_EMAIL = globalThis.CODIGO_EMAIL || null;
const TOKEN_RESGATE = globalThis.TOKEN_RESGATE || globalThis.TOKEN;
const EXPERIENCIA_ID = globalThis.EXPERIENCIA_ID || null;
const OFERTA_ID = globalThis.OFERTA_ID || null;
const SALVAR_REQUISICOES_TXT = globalThis.SALVAR_REQUISICOES_TXT || false;
const PASTA_LOGS_REQUISICOES_TXT =
  globalThis.PASTA_LOGS_REQUISICOES_TXT || "./logs-requisicoes";

async function criarMembro({
  onOutput,
  salvarRequisicoesTxt = SALVAR_REQUISICOES_TXT,
  pastaLogsTxt = PASTA_LOGS_REQUISICOES_TXT,
} = {}) {
  const emitir = async (texto) => {
    if (typeof onOutput === "function") {
      await onOutput(texto);
    }
  };

  const NOME = await gerarNomeAleatorio();
  const TELEFONE = gerarTelefoneAleatorio();
  const { email: EMAIL, senhaMailbox } = await gerarEmailMailTm({
    senha: SENHA,
  });

  await emitir(`Nome: ${NOME}`);
  await emitir(`Telefone: ${TELEFONE}`);
  await emitir(`Senha: ${SENHA}`);
  await emitir(`E-mail(mail.tm): ${EMAIL}`);

  const resultado = {};
  const salvarParcial = () => {
    if (!salvarRequisicoesTxt) return;
    salvarRespostasEmTxt(resultado, pastaLogsTxt);
  };

  await emitir("Resolvendo verificação de segurança (reCAPTCHA)...");

  let resultadoConta = null;
  try {
    resultadoConta = await resolverRecaptchaRegistro({
      onLog: (msg) => console.log(`[CacauShow Captcha] ${msg}`),
      onResolvido: async ({ token, page }) => {
        return await CriacaoDeContaCompleta({
          apiHeaders: API_HEADERS,
          nome: NOME,
          email: EMAIL,
          senha: SENHA,
          telefone: TELEFONE,
          codigoEmail: CODIGO_EMAIL,
          recaptchaToken: token,
          page,
          solicitarCodigo: async () => {
            const codigo = await aguardarCodigoEmailMailTm({
              email: EMAIL,
              senha: senhaMailbox,
            });
            return codigo;
          },
          onEtapa: (etapa, dados) => {
            if (etapa === "criacao") {
              resultado.criacao = dados;
              resultado.documento = dados?.documento || resultado.documento;
            } else if (etapa === "envioCodigo") {
              resultado.envioCodigo = dados;
            } else if (etapa === "validacaoCodigo") {
              resultado.validacaoCodigo = dados;
            }
            salvarParcial();
          },
        });
      },
    });
  } catch (errCaptcha) {
    console.error(`[CacauShow] Falha no fluxo de cadastro/reCAPTCHA:`, errCaptcha);
    throw new Error(`Falha no cadastro: ${errCaptcha.message}`);
  }

  if (!resultadoConta) {
    throw new Error("Não foi possível concluir a criação da conta.");
  }

  Object.assign(resultado, resultadoConta);
  salvarParcial();

  await emitir(`CPF: ${resultado.documento}`);

  const obterPorDocEmail = await obterPorDocumentoEmail({
    apiHeaders: API_HEADERS,
    email: EMAIL,
    documento: "",
  });
  resultado.obterPorDocumentoEmail = obterPorDocEmail;
  salvarParcial();

  const authEmail = await autenticarPorEmail({
    apiHeaders: API_HEADERS,
    email: EMAIL,
    senha: SENHA,
  });
  resultado.autenticacaoEmail = authEmail;
  salvarParcial();

  if (!authEmail.ok) {
    console.warn(`[CacauShow] Autenticação falhou (HTTP ${authEmail.status}):`, authEmail.bodyText);
  }

  const tokenResgateFinal = TOKEN_RESGATE || authEmail.token;
  const resultadoResgate = await fluxoResgateTrufa({
    apiHeaders: API_HEADERS,
    token: tokenResgateFinal,
    experienciaId: EXPERIENCIA_ID,
    ofertaId: OFERTA_ID,
    pagina: 1,
  });

  if (resultadoResgate.experienciaId) {
    console.log(
      `[CacauShow] Resgate processado com Experiência: ${resultadoResgate.experienciaId}, Oferta: ${resultadoResgate.ofertaId}`
    );
  }

  if (!resultadoResgate.resgate?.ok) {
    console.warn(`[CacauShow] Resgate falhou (HTTP ${resultadoResgate.resgate?.status}):`, resultadoResgate.resgate?.bodyText);
  }
  if (!resultadoResgate.meusResgates?.ok) {
    console.warn(`[CacauShow] Listagem de resgates falhou (HTTP ${resultadoResgate.meusResgates?.status}):`, resultadoResgate.meusResgates?.bodyText);
  }

  resultado.resgateTrufa = resultadoResgate.resgate;
  resultado.listarMeusResgates = resultadoResgate.meusResgates;
  salvarParcial();

  await emitir(`Codigo para resgate: ${resultadoResgate.experienciaMembroId}`);
  await emitir(`Validade: ${resultadoResgate.validade}`);

  return {
    nome: NOME,
    cpf: resultado.documento,
    telefone: TELEFONE,
    senha: SENHA,
    email: EMAIL,
    resultado,
    logsTxt: salvarRequisicoesTxt ? pastaLogsTxt : null,
    experienciaMembroId: resultadoResgate.experienciaMembroId,
    validade: resultadoResgate.validade,
  };
}

module.exports = {
  criarMembro,
};

if (require.main === module) {
  criarMembro({
    onOutput: async (texto) => {
      console.log(texto);
    },
  })
    .then(() => console.log("Fluxo finalizado."))
    .catch((err) => console.error(err));
}
