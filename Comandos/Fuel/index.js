function calcularCombustivel(precoGasolina, precoEtanol, kmLGasolina, kmLEtanol) {
  const custoPorKmGasolina = precoGasolina / kmLGasolina;
  const custoPorKmEtanol = precoEtanol / kmLEtanol;

  let melhor;
  if (custoPorKmGasolina < custoPorKmEtanol) {
    melhor = "gasolina";
  } else if (custoPorKmEtanol < custoPorKmGasolina) {
    melhor = "etanol";
  } else {
    melhor = "empate";
  }

  const fmt = (v) => v.toFixed(3);

  const linhas = [
    `⛽ Gasolina: R$${fmt(custoPorKmGasolina)}/km`,
    `🌿 Etanol:   R$${fmt(custoPorKmEtanol)}/km`,
    ``,
  ];

  if (melhor === "gasolina") {
    linhas.push("✅ Gasolina é mais vantajosa!");
  } else if (melhor === "etanol") {
    linhas.push("✅ Etanol é mais vantajoso!");
  } else {
    linhas.push("🤝 Empate! Ambos têm o mesmo custo por km.");
  }

  return {
    custoPorKmGasolina,
    custoPorKmEtanol,
    melhor,
    mensagem: linhas.join("\n"),
  };
}

module.exports = { calcularCombustivel };
