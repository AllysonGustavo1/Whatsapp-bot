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
} = require("./funcoes");

const API_HEADERS = globalThis.API_HEADERS || {
  accept: "application/json, text/plain, */*",
  "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "content-type": "application/json",
  priority: "u=1, i",
  "sec-ch-ua":
    '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  Referer: "https://lovers.cacaushow.com.br/",
};

const SENHA = "Zelele123@";
const CODIGO_EMAIL = globalThis.CODIGO_EMAIL || null;
const TOKEN_RESGATE = globalThis.TOKEN_RESGATE || globalThis.TOKEN;
const EXPERIENCIA_ID = globalThis.EXPERIENCIA_ID || 2011;
const OFERTA_ID = globalThis.OFERTA_ID || 8265;
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

  const resultadoConta = await CriacaoDeContaCompleta({
    apiHeaders: API_HEADERS,
    nome: NOME,
    email: EMAIL,
    senha: SENHA,
    telefone: TELEFONE,
    codigoEmail: CODIGO_EMAIL,
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

  const tokenResgateFinal = TOKEN_RESGATE || authEmail.token;
  const resultadoResgate = await fluxoResgateTrufa({
    apiHeaders: API_HEADERS,
    token: tokenResgateFinal,
    experienciaId: EXPERIENCIA_ID,
    ofertaId: OFERTA_ID,
    pagina: 1,
  });

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
