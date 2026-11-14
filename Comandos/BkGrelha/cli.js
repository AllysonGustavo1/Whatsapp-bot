#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const {
  buildBkHelpMessage,
  executarGiroGrelha,
  listarContasStatus,
  executarAdicionarContas,
  executarCriarContasBk,
} = require("./index");

// Carrega .env da raiz se existir
function carregarEnvRaiz() {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return;
  const conteudo = fs.readFileSync(envPath, "utf8");
  for (const linha of conteudo.split(/\r?\n/)) {
    const clean = linha.trim();
    if (!clean || clean.startsWith("#")) continue;
    const eq = clean.indexOf("=");
    if (eq === -1) continue;
    const k = clean.slice(0, eq).trim();
    const v = clean.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !(k in process.env)) {
      process.env[k] = v;
    }
  }
}

function extrairFlags(args) {
  let arquivoTxt = null;
  let fecharEmulador = false;
  const posicionais = [];

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--fechar" || a === "--quit") {
      fecharEmulador = true;
    } else if (a === "--arquivo" || a === "--file" || a === "-f") {
      arquivoTxt = args[i + 1] || null;
      i += 1;
    } else if (a.startsWith("--arquivo=") || a.startsWith("--file=")) {
      arquivoTxt = a.split("=").slice(1).join("=");
    } else {
      posicionais.push(a);
    }
  }
  return { arquivoTxt, fecharEmulador, posicionais };
}

async function main() {
  carregarEnvRaiz();
  const { arquivoTxt, fecharEmulador, posicionais } = extrairFlags(
    process.argv.slice(2)
  );
  const cmd = (posicionais[0] || "girar").toLowerCase();

  const onOutput = async (payload) => {
    if (payload && typeof payload === "object" && Buffer.isBuffer(payload.image)) {
      const tag = payload.tipo || "imagem";
      const header = `[MIDIA:${tag}] (${payload.image.length} bytes)`;
      console.log(payload.caption ? `${header}\n${payload.caption}` : header);
      return;
    }
    console.log(payload);
  };

  if (["help", "--help", "-h", "ajuda"].includes(cmd)) {
    console.log(buildBkHelpMessage("/"));
    console.log("\nUso CLI:");
    console.log(
      "  npm run bk [-- girar [qtd]|criar [qtd]|txt|contas|add|help] [--arquivo caminho.txt] [--fechar]"
    );
    return;
  }

  if (["contas", "lista", "listar", "status"].includes(cmd)) {
    console.log(listarContasStatus(arquivoTxt));
    return;
  }

  if (["add", "adicionar", "importar"].includes(cmd)) {
    const resto = posicionais.slice(1).join("\n");
    const msg = await executarAdicionarContas({ argTexto: resto, arquivoTxt });
    console.log(msg);
    return;
  }

  if (
    ["girar", "spin", "rodar", "run", "criar", "create", "nova", "novas"].includes(
      cmd
    )
  ) {
    const qtd = Number.parseInt(posicionais[1] || "1", 10) || 1;
    await executarCriarContasBk({
      quantidade: qtd,
      girar: true,
      arquivoTxt,
      onOutput,
      fecharEmuladorNoFinal: fecharEmulador,
    });
    return;
  }

  if (["txt", "ler", "arquivo"].includes(cmd)) {
    await executarGiroGrelha({
      arquivoTxt,
      onOutput,
      fecharEmuladorNoFinal: fecharEmulador,
    });
    return;
  }

  // Caso usuario passe um caminho de arquivo .txt direto: node cli.js minhas_contas.txt
  if (cmd.endsWith(".txt")) {
    await executarGiroGrelha({
      arquivoTxt: posicionais[0],
      onOutput,
      fecharEmuladorNoFinal: fecharEmulador,
    });
    return;
  }

  console.error(`Subcomando desconhecido: ${cmd}`);
  console.log("Comandos CLI: girar [qtd] | criar [qtd] | txt | contas | add <conta> | help");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("Erro fatal CLI BK Grelha:", err);
  process.exit(1);
});
