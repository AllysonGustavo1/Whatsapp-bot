function buscarCampoRecursivo(objeto, chaves) {
  if (!objeto || typeof objeto !== "object") return null;

  const fila = [objeto];
  const visitados = new Set();
  const chavesNormalizadas = chaves.map((chave) => chave.toLowerCase());

  while (fila.length > 0) {
    const atual = fila.shift();
    if (!atual || typeof atual !== "object") continue;
    if (visitados.has(atual)) continue;
    visitados.add(atual);

    if (Array.isArray(atual)) {
      for (const item of atual) {
        fila.push(item);
      }
      continue;
    }

    for (const [chave, valor] of Object.entries(atual)) {
      const chaveLower = chave.toLowerCase();
      if (
        chavesNormalizadas.includes(chaveLower) &&
        valor != null &&
        valor !== ""
      ) {
        return valor;
      }

      if (valor && typeof valor === "object") {
        fila.push(valor);
      }
    }
  }

  return null;
}

function normalizarBearer(token) {
  if (!token || typeof token !== "string") return null;
  const valor = token.trim();
  if (!valor) return null;
  return valor.toLowerCase().startsWith("bearer ")
    ? valor.slice(7).trim()
    : valor;
}

function extrairTokenAutenticacao(detalhesResposta) {
  const tokenDoJson =
    typeof detalhesResposta?.data === "string"
      ? detalhesResposta.data
      : buscarCampoRecursivo(detalhesResposta?.data, [
          "token",
          "accessToken",
          "jwt",
          "bearer",
        ]);

  const tokenDoTexto = detalhesResposta?.bodyText
    ? detalhesResposta.bodyText.replace(/^"|"$/g, "")
    : null;

  return normalizarBearer(tokenDoJson) || normalizarBearer(tokenDoTexto);
}

module.exports = {
  buscarCampoRecursivo,
  normalizarBearer,
  extrairTokenAutenticacao,
};
