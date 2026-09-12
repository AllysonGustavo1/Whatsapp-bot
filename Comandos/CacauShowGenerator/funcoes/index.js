const {
  CriacaoDeContaCompleta,
  autenticarPorEmail,
  obterPorDocumentoEmail,
} = require("./apis/conta");
const {
  fluxoResgateTrufa,
  resgatarTrufa,
  listarMeusResgates,
  buscarExperienciasAtivas,
  obterLotesExperiencia,
  encontrarExperienciaTrufa,
} = require("./apis/resgate");
const {
  gerarNomeAleatorio,
  gerarTelefoneAleatorio,
  gerarEmailMailTm,
} = require("./geradores/dados");
const { aguardarCodigoEmailMailTm } = require("./mail/mailtm");
const { salvarRespostasEmTxt, salvarDebugMailTmTxt } = require("./utils/logs");

module.exports = {
  CriacaoDeContaCompleta,
  autenticarPorEmail,
  obterPorDocumentoEmail,
  fluxoResgateTrufa,
  resgatarTrufa,
  listarMeusResgates,
  buscarExperienciasAtivas,
  obterLotesExperiencia,
  encontrarExperienciaTrufa,
  gerarNomeAleatorio,
  gerarTelefoneAleatorio,
  gerarEmailMailTm,
  aguardarCodigoEmailMailTm,
  salvarRespostasEmTxt,
  salvarDebugMailTmTxt,
};
