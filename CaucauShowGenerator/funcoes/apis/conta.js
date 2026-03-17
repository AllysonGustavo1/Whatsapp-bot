const { fetchApi, extrairRespostaDetalhada } = require("../utils/http");
const { extrairTokenAutenticacao } = require("../utils/token");
const { gerarCPF } = require("../geradores/dados");

const URL_CRIACAO_MEMBRO =
  "https://apigatewaysitelovers.cacaushow.com.br/membrosite/api/membros";
const URL_ENVIO_CODIGO_EMAIL =
  "https://apigatewaysitelovers.cacaushow.com.br/membrosite/api/leads/envio-codigo-email";
const URL_VALIDACAO_CODIGO_EMAIL =
  "https://apigatewaysitelovers.cacaushow.com.br/membrosite/api/leads/validacao-codigo-email";
const URL_AUTENTICACAO_POR_EMAIL =
  "https://apigatewaysitelovers.cacaushow.com.br/membrosite/api/autenticacoes/autenticacao-por-email";
const URL_OBTER_POR_DOCUMENTO_EMAIL =
  "https://apigatewaysitelovers.cacaushow.com.br/membrosite/api/autenticacoes/obter-por-documento-email";

async function CriacaoDeConta({ apiHeaders, nome, email, senha, telefone }) {
  if (!apiHeaders) throw new Error("Os headers da API não foram definidos.");
  if (!nome) throw new Error("O nome não foi definido.");
  if (!email) throw new Error("O e-mail não foi definido.");
  if (!senha) throw new Error("A senha não foi definida.");
  if (!telefone) throw new Error("O telefone não foi definido.");

  const documento = gerarCPF();
  const membroPayload = {
    nome,
    dataNascimento: "2000-03-01T03:00:00.000Z",
    documento,
    email,
    idOrigem: 6,
    telefone,
    documentoResponsavel: null,
    aceiteTermo: true,
    enviaComunicacao: true,
    senhaHash: senha,
    nomeSocial: "",
    tokenIndicacao: "",
    visualizarPopupHome: true,
    syncMarketingCloud: true,
    paisOrigem: "Brasil",
    tipoDocumento: "CPF",
    linkUnsubscribe: "",
    queroSerLover: true,
    ativo: true,
  };

  const response = await fetchApi(URL_CRIACAO_MEMBRO, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify(membroPayload),
  });

  return {
    response,
    url: URL_CRIACAO_MEMBRO,
    requestBody: membroPayload,
    documento,
    ...(await extrairRespostaDetalhada(response)),
  };
}

async function enviarCodigoEmail({ apiHeaders, identificador }) {
  const response = await fetchApi(URL_ENVIO_CODIGO_EMAIL, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({ identificador, tipoIdentificador: 1 }),
  });

  return {
    response,
    url: URL_ENVIO_CODIGO_EMAIL,
    requestBody: { identificador, tipoIdentificador: 1 },
    ...(await extrairRespostaDetalhada(response)),
  };
}

async function validarCodigoEmail({ apiHeaders, identificador, codigo }) {
  const response = await fetchApi(URL_VALIDACAO_CODIGO_EMAIL, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({ identificador, codigo, tipoIdentificador: 1 }),
  });

  return {
    response,
    url: URL_VALIDACAO_CODIGO_EMAIL,
    requestBody: { identificador, codigo, tipoIdentificador: 1 },
    ...(await extrairRespostaDetalhada(response)),
  };
}

async function CriacaoDeContaCompleta({
  apiHeaders,
  nome,
  email,
  senha,
  telefone,
  codigoEmail,
  solicitarCodigo,
  onEtapa,
}) {
  const criacao = await CriacaoDeConta({
    apiHeaders,
    nome,
    email,
    senha,
    telefone,
  });
  if (typeof onEtapa === "function") onEtapa("criacao", criacao);

  const envioCodigo = await enviarCodigoEmail({
    apiHeaders,
    identificador: criacao.documento,
  });
  if (typeof onEtapa === "function") onEtapa("envioCodigo", envioCodigo);

  let codigoEmailFinal = codigoEmail;
  if (!codigoEmailFinal && typeof solicitarCodigo === "function") {
    codigoEmailFinal = await solicitarCodigo();
  }

  let validacaoCodigo = null;
  if (codigoEmailFinal) {
    validacaoCodigo = await validarCodigoEmail({
      apiHeaders,
      identificador: criacao.documento,
      codigo: String(codigoEmailFinal).trim(),
    });
    if (typeof onEtapa === "function")
      onEtapa("validacaoCodigo", validacaoCodigo);
  }

  return {
    documento: criacao.documento,
    criacao,
    envioCodigo,
    validacaoCodigo,
    codigoEmailUsado: codigoEmailFinal || null,
  };
}

async function autenticarPorEmail({ apiHeaders, email, senha }) {
  const body = { email, senha };
  const response = await fetchApi(URL_AUTENTICACAO_POR_EMAIL, {
    method: "POST",
    headers: { ...apiHeaders, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const detalhes = await extrairRespostaDetalhada(response);
  return {
    response,
    url: URL_AUTENTICACAO_POR_EMAIL,
    requestBody: body,
    token: extrairTokenAutenticacao(detalhes),
    ...detalhes,
  };
}

async function obterPorDocumentoEmail({ apiHeaders, email, documento = "" }) {
  const url = `${URL_OBTER_POR_DOCUMENTO_EMAIL}?documento=${encodeURIComponent(documento)}&email=${encodeURIComponent(email)}`;
  const response = await fetchApi(url, { method: "GET", headers: apiHeaders });

  return {
    response,
    url,
    requestBody: null,
    ...(await extrairRespostaDetalhada(response)),
  };
}

module.exports = {
  CriacaoDeConta,
  CriacaoDeContaCompleta,
  enviarCodigoEmail,
  validarCodigoEmail,
  autenticarPorEmail,
  obterPorDocumentoEmail,
};
