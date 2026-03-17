const fs = require("fs");
const path = require("path");

function montarConteudoRespostaTxt(titulo, etapa) {
  if (!etapa) {
    return `${titulo}\n\nEtapa não executada.`;
  }

  const bodyFormatado = etapa.bodyText
    ? etapa.bodyText
    : etapa.data
      ? JSON.stringify(etapa.data, null, 2)
      : "(vazio)";

  return [
    titulo,
    "",
    `URL: ${etapa.url || "(não informada)"}`,
    `Status: ${etapa.status} ${etapa.statusText || ""}`.trim(),
    `OK: ${etapa.ok}`,
    "",
    "Request body:",
    JSON.stringify(etapa.requestBody || null, null, 2),
    "",
    "Response headers:",
    JSON.stringify(etapa.responseHeaders || {}, null, 2),
    "",
    "Response body:",
    bodyFormatado,
  ].join("\n");
}

function salvarRespostasEmTxt(resultado, pastaLogs) {
  fs.mkdirSync(pastaLogs, { recursive: true });

  const arquivos = [
    ["01_criacao_membro.txt", "Criacao de membro", resultado.criacao],
    [
      "02_envio_codigo_email.txt",
      "Envio de codigo por e-mail",
      resultado.envioCodigo,
    ],
    [
      "03_validacao_codigo_email.txt",
      "Validacao do codigo de e-mail",
      resultado.validacaoCodigo,
    ],
    [
      "04_obter_por_documento_email.txt",
      "Obter por documento e e-mail",
      resultado.obterPorDocumentoEmail,
    ],
    [
      "05_autenticacao_email.txt",
      "Autenticacao por e-mail",
      resultado.autenticacaoEmail,
    ],
    ["06_resgate_trufa.txt", "Resgate da trufa", resultado.resgateTrufa],
    [
      "07_listar_meus_resgates.txt",
      "Listar meus resgates",
      resultado.listarMeusResgates,
    ],
  ];

  for (const [nome, titulo, etapa] of arquivos) {
    const conteudo = montarConteudoRespostaTxt(titulo, etapa);
    fs.writeFileSync(path.join(pastaLogs, nome), conteudo, "utf8");
  }
}

function salvarDebugMailTmTxt({ pastaLogs, snapshot }) {
  const nomeArquivo = `mailtm_poll_tentativa_${String(snapshot.tentativa).padStart(3, "0")}.txt`;
  const caminho = path.join(pastaLogs, nomeArquivo);

  const conteudo = [
    "Polling mail.tm",
    "",
    `Tentativa: ${snapshot.tentativa}`,
    `Tempo decorrido (ms): ${snapshot.elapsedMs}`,
    `Qtd mensagens: ${Array.isArray(snapshot.mensagens) ? snapshot.mensagens.length : 0}`,
    "",
    "Mensagens (GET /messages):",
    JSON.stringify(snapshot.mensagens || [], null, 2),
    "",
    "Resposta bruta (GET /messages):",
    JSON.stringify(snapshot.inboxRaw || null, null, 2),
    "",
    "Detalhes (GET /messages/{id}):",
    JSON.stringify(snapshot.mensagensDetalhes || [], null, 2),
  ].join("\n");

  fs.writeFileSync(caminho, conteudo, "utf8");
}

module.exports = {
  salvarRespostasEmTxt,
  salvarDebugMailTmTxt,
};
