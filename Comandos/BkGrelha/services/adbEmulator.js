const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const puppeteer = require("puppeteer");
const { gerarCPF } = require("../../Americanas/utils/generators");
const { httpRequestJson } = require("./bkApi");
const { snapshotMensagensEmail, aguardarCodigoBk } = require("./emailCode");

const PKG_BK = "burgerking.com.br.appandroid";
const PKG_BROWSER = "com.android.browser";

const NOMES_PRIMEIROS = [
  "Lucas",
  "Gabriel",
  "Mateus",
  "Rafael",
  "Bruno",
  "Felipe",
  "Gustavo",
  "Thiago",
  "Mariana",
  "Camila",
  "Juliana",
  "Beatriz",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execFileAsync(bin, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          return reject(error);
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      }
    );
  });
}

async function encontrarAdb() {
  const candidatos = [
    process.env.ADB_PATH,
    process.env.ANDROID_HOME &&
      path.join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"),
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "Android",
        "Sdk",
        "platform-tools",
        "adb.exe"
      ),
    "C:\\Users\\Allyson\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe",
    "D:\\Program Files\\Nox\\bin\\nox_adb.exe",
    "C:\\Program Files\\Nox\\bin\\nox_adb.exe",
  ].filter(Boolean);

  for (const cand of candidatos) {
    if (fs.existsSync(cand)) return cand;
  }

  try {
    await execFileAsync("adb", ["version"], 5000);
    return "adb";
  } catch {
    throw new Error(
      "ADB nao encontrado. Defina ADB_PATH ou instale Android platform-tools."
    );
  }
}

function encontrarNoxConsole() {
  const candidatos = [
    process.env.NOX_CONSOLE_PATH,
    "D:\\Program Files\\Nox\\bin\\NoxConsole.exe",
    "C:\\Program Files\\Nox\\bin\\NoxConsole.exe",
    "C:\\Program Files (x86)\\Nox\\bin\\NoxConsole.exe",
  ].filter(Boolean);

  for (const cand of candidatos) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function descobrirPortaAdbNoxPorIndice(indice) {
  const vmId = Number(indice) === 0 ? "nox" : `Nox_${indice}`;
  const possiveisBases = [
    path.join(process.env.LOCALAPPDATA || "", "Nox", "vms", vmId, `${vmId}.vbox`),
    path.join("D:\\Program Files\\Nox\\bin\\BignoxVMS", vmId, `${vmId}.vbox`),
  ];

  for (const vboxPath of possiveisBases) {
    try {
      if (!fs.existsSync(vboxPath)) continue;
      const xml = fs.readFileSync(vboxPath, "utf8");
      const m = xml.match(/guestport="5555"[^>]*hostport="(\d+)"/i) ||
        xml.match(/hostport="(\d+)"[^>]*guestport="5555"/i);
      if (m) return `127.0.0.1:${m[1]}`;
    } catch {
      // ignora erro de leitura
    }
  }

  const mapaPadrao = {
    0: "127.0.0.1:62001",
    1: "127.0.0.1:62025",
    2: "127.0.0.1:62026",
    3: "127.0.0.1:62027",
    4: "127.0.0.1:62028",
    5: "127.0.0.1:62029",
    6: "127.0.0.1:62030",
  };
  return mapaPadrao[Number(indice)] || "127.0.0.1:62029";
}

async function adb(adbPath, serial, args, timeoutMs = 20000) {
  const fullArgs = serial ? ["-s", serial, ...args] : args;
  return execFileAsync(adbPath, fullArgs, timeoutMs);
}

async function adbShell(adbPath, serial, cmd, timeoutMs = 20000) {
  const res = await adb(adbPath, serial, ["shell", cmd], timeoutMs);
  return res.stdout;
}

async function listarDispositivosOnline(adbPath) {
  const { stdout } = await adb(adbPath, null, ["devices"], 10000);
  const lista = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+device\b/);
    if (m) lista.push(m[1]);
  }
  return lista;
}

async function temBkInstalado(adbPath, serial) {
  try {
    const out = await adbShell(adbPath, serial, `pm path ${PKG_BK}`, 10000);
    return out.includes("package:");
  } catch {
    return false;
  }
}

async function garantirEmuladorPronto({ onLog } = {}) {
  const log = typeof onLog === "function" ? onLog : () => {};
  const adbPath = await encontrarAdb();
  const targetEnv = process.env.BK_ADB_TARGET;
  const noxIndex = process.env.BK_NOX_INDEX ?? "5";

  if (targetEnv) {
    await adb(adbPath, null, ["connect", targetEnv], 8000).catch(() => {});
  }

  let online = await listarDispositivosOnline(adbPath);
  for (const serial of online) {
    if (await temBkInstalado(adbPath, serial)) {
      return { adbPath, serial, iniciouNox: false };
    }
  }

  const alvoPorta = targetEnv || descobrirPortaAdbNoxPorIndice(noxIndex);
  await adb(adbPath, null, ["connect", alvoPorta], 5000).catch(() => {});
  online = await listarDispositivosOnline(adbPath);
  if (online.includes(alvoPorta) && (await temBkInstalado(adbPath, alvoPorta))) {
    return { adbPath, serial: alvoPorta, iniciouNox: false };
  }

  const noxConsole = encontrarNoxConsole();
  if (!noxConsole) {
    throw new Error(
      "Nenhum emulador com Burger King esta ativo e NoxConsole.exe nao foi encontrado."
    );
  }

  log(`Iniciando Nox (index ${noxIndex}, ADB ${alvoPorta})...`);
  await execFileAsync(noxConsole, ["launch", `-index:${noxIndex}`], 15000).catch(
    () => {}
  );

  const deadline = Date.now() + 95000;
  while (Date.now() < deadline) {
    await adb(adbPath, null, ["connect", alvoPorta], 5000).catch(() => {});
    const devs = await listarDispositivosOnline(adbPath).catch(() => []);
    if (devs.includes(alvoPorta)) {
      const boot = await adbShell(
        adbPath,
        alvoPorta,
        "getprop sys.boot_completed",
        5000
      ).catch(() => "");
      if (boot.trim() === "1" && (await temBkInstalado(adbPath, alvoPorta))) {
        await sleep(2500);
        return { adbPath, serial: alvoPorta, iniciouNox: true };
      }
    }
    await sleep(3000);
  }

  throw new Error(
    `Timeout aguardando Nox index ${noxIndex} (${alvoPorta}) inicializar com app BK.`
  );
}

async function encerrarNox({ index } = {}) {
  const noxConsole = encontrarNoxConsole();
  if (!noxConsole) return false;
  const noxIndex = index ?? process.env.BK_NOX_INDEX ?? "5";
  await execFileAsync(noxConsole, ["quit", `-index:${noxIndex}`], 15000).catch(
    () => {}
  );
  return true;
}

function unescapeXml(str) {
  return String(str || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function extrairAuthSession(adbPath, serial) {
  const caminho = `/data/data/${PKG_BK}/shared_prefs/AuthSession.xml`;
  let xml = await adbShell(
    adbPath,
    serial,
    `cat ${caminho} 2>/dev/null || su -c 'cat ${caminho}' 2>/dev/null || true`,
    10000
  );
  if (!xml || !xml.includes("<map")) return null;

  const pegarTag = (nome) => {
    const m = xml.match(
      new RegExp(`<string name="${nome}">([\\s\\S]*?)</string>`)
    );
    return m ? unescapeXml(m[1]) : null;
  };

  let accessToken = null;
  let refreshToken = null;
  let user = null;

  const tokStr = pegarTag("KEYCLOAK_AUTH_TOKEN");
  if (tokStr) {
    try {
      const tokJson = JSON.parse(tokStr);
      accessToken = tokJson.a || null;
      refreshToken = tokJson.b || null;
    } catch {
      // ignora json invalido
    }
  }

  if (!accessToken || !refreshToken) {
    const stateStr = pegarTag("KEYCLOAK_AUTH_STATE");
    if (stateStr) {
      try {
        const st = JSON.parse(stateStr);
        accessToken = accessToken || st.access_token || null;
        refreshToken = refreshToken || st.refresh_token || st.refreshToken || null;
      } catch {
        // ignora
      }
    }
  }

  const userStr = pegarTag("USER");
  if (userStr) {
    try {
      user = JSON.parse(userStr);
    } catch {
      user = null;
    }
  }

  const userUuid = pegarTag("USER_UUID");
  const customerStatus = pegarTag("CUSTOMER_STATUS");

  return {
    accessToken,
    refreshToken,
    user,
    customerId: user?.header?.id || userUuid || null,
    email: user?.email ? String(user.email).toLowerCase() : null,
    cpf: user?.documentCpf || null,
    customerStatus,
  };
}

async function obterFocoAtual(adbPath, serial) {
  return adbShell(
    adbPath,
    serial,
    "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'",
    8000
  ).catch(() => "");
}

async function dumpUiXml(adbPath, serial) {
  return adbShell(
    adbPath,
    serial,
    "uiautomator dump /sdcard/bk_ui.xml >/dev/null 2>&1 && cat /sdcard/bk_ui.xml",
    15000
  ).catch(() => "");
}

function extrairCentroPorResourceId(xml, idSufixo, filtroClass = null) {
  if (!xml) return null;
  const fullId = idSufixo.includes(":id/") ? idSufixo : `${PKG_BK}:id/${idSufixo}`;
  const regex = new RegExp(`resource-id="${fullId}"[^>]*>`, "g");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const inicio = xml.lastIndexOf("<node", match.index);
    const trecho = xml.slice(inicio, match.index + match[0].length);
    if (filtroClass && !trecho.includes(`class="${filtroClass}"`)) continue;
    const b = trecho.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!b) continue;
    const x1 = Number(b[1]);
    const y1 = Number(b[2]);
    const x2 = Number(b[3]);
    const y2 = Number(b[4]);
    return {
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      enabled: trecho.includes('enabled="true"'),
    };
  }
  return null;
}

async function tratarDialogPermissao(adbPath, serial, xml) {
  const idsPermissao = [
    "com.android.permissioncontroller:id/permission_allow_foreground_only_button",
    "com.android.permissioncontroller:id/permission_allow_button",
    "com.android.permissioncontroller:id/permission_allow_one_time_button",
    "com.android.packageinstaller:id/permission_allow_button",
  ];
  for (const id of idsPermissao) {
    const ponto = extrairCentroPorResourceId(xml, id);
    if (ponto) {
      await adbShell(adbPath, serial, `input tap ${ponto.x} ${ponto.y}`, 5000);
      return true;
    }
  }
  return false;
}

async function aguardarETocarBotao(
  adbPath,
  serial,
  resourceId,
  timeoutMs = 25000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const xml = await dumpUiXml(adbPath, serial);
    if (await tratarDialogPermissao(adbPath, serial, xml)) {
      await sleep(800);
      continue;
    }
    const ponto = extrairCentroPorResourceId(xml, resourceId);
    if (ponto) {
      await adbShell(adbPath, serial, `input tap ${ponto.x} ${ponto.y}`, 5000);
      return true;
    }
    await sleep(1200);
  }
  return false;
}

async function descobrirWebViewDevTools(adbPath, serial, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const out = await adbShell(
      adbPath,
      serial,
      "cat /proc/net/unix | grep -oE 'webview_devtools_remote_[0-9]+' || true",
      5000
    ).catch(() => "");
    const linhas = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (linhas.length > 0) {
      return linhas[linhas.length - 1];
    }
    await sleep(1000);
  }
  return null;
}

async function preencherInputWebView(page, selector, valor) {
  await page.waitForSelector(selector, { timeout: 20000 });
  const focoOk = await page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.select?.();
      return true;
    }, selector)
    .catch(() => false);
  if (focoOk) {
    await page.keyboard.type(valor, { delay: 30 }).catch(() => {});
  }

  // Garante sincronizacao em inputs controlados (React/Keycloak) apenas se digitacao nao preencheu
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const atualNorm = String(el.value || "").replace(/\D/g, "");
      const alvoNorm = String(val || "").replace(/\D/g, "");
      const jaPreenchido =
        el.value === val || (alvoNorm.length >= 6 && atualNorm === alvoNorm);
      if (!jaPreenchido) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        if (setter) setter.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    selector,
    valor
  );
}

async function clicarSubmitWebView(page, textoPreferido = null) {
  return page.evaluate((texto) => {
    const botoes = [...document.querySelectorAll("button")].filter(
      (b) => !b.disabled
    );
    let alvo = null;
    if (texto) {
      const rx = new RegExp(texto, "i");
      alvo = botoes.find((b) => rx.test(b.innerText || ""));
    }
    if (!alvo) {
      alvo =
        document.querySelector('button[type="submit"]:not([disabled])') ||
        botoes[0];
    }
    if (!alvo) return false;
    alvo.scrollIntoView?.({ block: "center" });
    alvo.click();
    return true;
  }, textoPreferido);
}

async function preencherOtpWebView(page, codigo) {
  await page.waitForSelector("input.input-code", { timeout: 20000 });
  const inputs = await page.$$("input.input-code");
  if (inputs.length > 0) {
    await inputs[0].click().catch(() => {});
    await page.keyboard.type(codigo, { delay: 55 }).catch(() => {});
  }

  await page.evaluate((cod) => {
    const boxes = [...document.querySelectorAll("input.input-code")];
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    boxes.forEach((box, idx) => {
      const ch = cod[idx] || "";
      if (box.value !== ch) {
        if (setter) setter.call(box, ch);
        else box.value = ch;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
        box.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true }));
      }
    });
    const hidden = document.querySelector('input[name="code"]');
    if (hidden && hidden.value !== cod) {
      if (setter) setter.call(hidden, cod);
      else hidden.value = cod;
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, codigo);

  await sleep(350);
  await clicarSubmitWebView(page, "Continuar");
}

function gerarCelularAleatorio() {
  const ddds = ["11", "21", "31", "41", "51", "71", "81", "84", "85"];
  const ddd = ddds[Math.floor(Math.random() * ddds.length)];
  let numero = "9";
  for (let i = 0; i < 8; i++) {
    numero += String(Math.floor(Math.random() * 10));
  }
  return { ddd, numero };
}

async function completarPosLoginNativo(adbPath, serial, { cpf, onLog }) {
  const log = typeof onLog === "function" ? onLog : () => {};
  const deadline = Date.now() + 55000;
  let smsEnviado = false;
  let nomeEnviado = false;

  while (Date.now() < deadline) {
    const sessao = await extrairAuthSession(adbPath, serial);
    const foco = await obterFocoAtual(adbPath, serial);

    if (
      sessao?.accessToken &&
      sessao?.refreshToken &&
      (sessao?.user?.header?.id ||
        (foco.includes("NewHomeActivity") && sessao.customerId))
    ) {
      return sessao;
    }

    if (foco.includes("SMSValidateActivity") && !smsEnviado) {
      log("Tela de SMS detectada — preenchendo numero para finalizar cadastro...");
      const xml = await dumpUiXml(adbPath, serial);
      const dddPos = extrairCentroPorResourceId(
        xml,
        "tv_sms_ddd",
        "android.widget.EditText"
      );
      const celPos = extrairCentroPorResourceId(
        xml,
        "tv_sms_phone",
        "android.widget.EditText"
      );
      const btnPos = extrairCentroPorResourceId(xml, "btn_validate_sms");

      if (dddPos && celPos && btnPos) {
        const { ddd, numero } = gerarCelularAleatorio();
        await adbShell(adbPath, serial, `input tap ${dddPos.x} ${dddPos.y}`);
        await sleep(250);
        await adbShell(adbPath, serial, `input text ${ddd}`);
        await sleep(250);
        await adbShell(adbPath, serial, `input tap ${celPos.x} ${celPos.y}`);
        await sleep(250);
        await adbShell(adbPath, serial, `input text ${numero}`);
        await sleep(400);
        await adbShell(adbPath, serial, `input tap ${btnPos.x} ${btnPos.y}`);
        smsEnviado = true;
        await sleep(2500);
        continue;
      }
    }

    if (foco.includes("LoginNameValidateActivity") && !nomeEnviado) {
      log("Tela de primeiro nome detectada — confirmando cadastro...");
      const xml = await dumpUiXml(adbPath, serial);
      const nomePos = extrairCentroPorResourceId(
        xml,
        "et_name",
        "android.widget.EditText"
      );
      const btnPos = extrairCentroPorResourceId(xml, "btn_confirm");
      if (nomePos && btnPos) {
        const primeiroNome =
          NOMES_PRIMEIROS[Math.floor(Math.random() * NOMES_PRIMEIROS.length)];
        await adbShell(adbPath, serial, `input tap ${nomePos.x} ${nomePos.y}`);
        await sleep(250);
        await adbShell(adbPath, serial, `input text ${primeiroNome}`);
        await sleep(300);
        await adbShell(adbPath, serial, `input tap ${btnPos.x} ${btnPos.y}`);
        nomeEnviado = true;
        await sleep(3500);
        continue;
      }
    }

    // Fallback: se o app ja estiver na home sem preencher USER ainda
    if (foco.includes("NewHomeActivity") && sessao?.accessToken) {
      await sleep(2000);
      const retrySessao = await extrairAuthSession(adbPath, serial);
      if (retrySessao?.accessToken && retrySessao?.customerId) {
        return { ...retrySessao, cpf: retrySessao.cpf || cpf || null };
      }
    }

    await sleep(1500);
  }

  const ultimaSessao = await extrairAuthSession(adbPath, serial);
  if (ultimaSessao?.accessToken && ultimaSessao?.refreshToken) {
    return ultimaSessao;
  }
  throw new Error(
    "Login no emulador nao concluiu gravacao do AuthSession.xml dentro do tempo limite."
  );
}

async function autenticarContaViaWorker({ email, senha, cpf, onLog } = {}) {
  const log = typeof onLog === "function" ? onLog : () => {};
  const workerBase = (
    process.env.BK_WORKER_URL || "http://127.0.0.1:3847"
  ).replace(/\/+$/, "");
  const endpoint = `${workerBase}/auth`;
  const timeoutMs = Number(process.env.BK_WORKER_TIMEOUT_MS) || 180000;

  log(`Solicitando autenticacao de ${email} ao Worker BK (${endpoint})...`);

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (process.env.BK_WORKER_TOKEN) {
    headers["x-bk-worker-token"] = process.env.BK_WORKER_TOKEN;
  }

  let res;
  try {
    res = await httpRequestJson(
      endpoint,
      { method: "POST", headers },
      JSON.stringify({ email, senha, cpf }),
      timeoutMs
    );
  } catch (err) {
    const errIndisp = new Error(
      `Worker BK indisponivel (${err?.message || "falha de conexao"}).`
    );
    errIndisp.code = "WORKER_UNAVAILABLE";
    throw errIndisp;
  }

  if (res.status >= 502 && res.status <= 504) {
    const errIndisp = new Error(`Worker BK indisponivel (HTTP ${res.status}).`);
    errIndisp.code = "WORKER_UNAVAILABLE";
    throw errIndisp;
  }

  const dados = res.data;
  if (res.status >= 400 || !dados?.ok || !dados?.accessToken) {
    const msg =
      (typeof dados === "object" && (dados?.error || dados?.message)) ||
      `Worker BK retornou HTTP ${res.status}`;
    const err = new Error(msg);
    if (typeof dados === "object" && dados?.code) {
      err.code = dados.code;
    }
    throw err;
  }

  return {
    accessToken: dados.accessToken,
    refreshToken: dados.refreshToken || null,
    user: dados.user || null,
    customerId: dados.customerId || null,
    email: dados.email ? String(dados.email).toLowerCase() : email,
    cpf: dados.cpf || cpf || null,
    customerStatus: dados.customerStatus || "ACTIVE",
    metodoWorker: true,
  };
}

async function garantirAdbOuDelegar({ email, senha, cpf, permitirWorker, log }) {
  if (permitirWorker && process.env.BK_USE_WORKER === "1") {
    return {
      delegado: true,
      sessao: await autenticarContaViaWorker({ email, senha, cpf, onLog: log }),
    };
  }

  try {
    await encontrarAdb();
  } catch (errAdb) {
    if (!permitirWorker || process.env.BK_DISABLE_WORKER === "1") {
      throw errAdb;
    }
    log("ADB nao disponivel localmente; delegando autenticacao para o Worker remoto...");
    return {
      delegado: true,
      sessao: await autenticarContaViaWorker({ email, senha, cpf, onLog: log }),
    };
  }

  return { delegado: false, sessao: null };
}

async function autenticarContaNoEmulador({
  email,
  senha,
  cpf,
  onLog,
  adbPortForward = 9229,
  permitirWorker = true,
} = {}) {
  const log = typeof onLog === "function" ? onLog : () => {};
  if (!email) {
    throw new Error("Email obrigatorio para login via emulador.");
  }

  const checagemWorker = await garantirAdbOuDelegar({
    email,
    senha,
    cpf,
    permitirWorker,
    log,
  });
  if (checagemWorker.delegado) {
    return checagemWorker.sessao;
  }

  const { adbPath, serial } = await garantirEmuladorPronto({ onLog: log });
  log(`Preparando login de ${email} no emulador (${serial})...`);

  // Snapshot do Mail.tm ANTES de solicitar novo codigo para ignorar codigos antigos
  const snapshotEmail = await snapshotMensagensEmail({ email, senha });

  // Limpa sessao SSO do navegador e estado do app BK para evitar auto-login na conta anterior
  await adbShell(adbPath, serial, `am force-stop ${PKG_BK}`, 8000).catch(
    () => {}
  );
  await adbShell(adbPath, serial, `pm clear ${PKG_BROWSER}`, 10000);
  await adbShell(adbPath, serial, `pm clear ${PKG_BK}`, 10000);
  await adbShell(
    adbPath,
    serial,
    `pm grant ${PKG_BK} android.permission.ACCESS_FINE_LOCATION 2>/dev/null || true; pm grant ${PKG_BK} android.permission.ACCESS_COARSE_LOCATION 2>/dev/null || true`,
    8000
  ).catch(() => {});
  await sleep(1000);

  log("Abrindo app Burger King...");
  await adbShell(
    adbPath,
    serial,
    `monkey -p ${PKG_BK} -c android.intent.category.LAUNCHER 1`,
    12000
  );

  // Tela inicial: "Entrar no App" -> escolha "E-mail"
  const clicouStart = await aguardarETocarBotao(
    adbPath,
    serial,
    "tv_start_app",
    25000
  );
  if (!clicouStart) {
    // Pode ja ter ido direto para tela de escolha ou precisar aguardar splash
    log("Botao tv_start_app nao apareceu, verificando tela de login...");
  } else {
    await sleep(1500);
  }

  const clicouEmail = await aguardarETocarBotao(
    adbPath,
    serial,
    "login_email",
    20000
  );
  if (!clicouEmail) {
    throw new Error("Nao encontrou o botao de login por E-mail no app BK.");
  }

  log("Conectando ao WebView OAuth via DevTools...");
  const socketName = await descobrirWebViewDevTools(adbPath, serial, 25000);
  if (!socketName) {
    throw new Error(
      "WebView DevTools nao encontrado apos abrir login por E-mail."
    );
  }

  const forwardPort = Number(adbPortForward) || 9229;
  await adb(
    adbPath,
    serial,
    ["forward", `tcp:${forwardPort}`, `localabstract:${socketName}`],
    8000
  );

  let browser = null;
  const cpfUsado = (cpf && cpf.replace(/\D/g, "")) || gerarCPF();

  try {
    await sleep(1500);
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${forwardPort}`,
      defaultViewport: null,
    });

    let page = null;
    const deadlinePage = Date.now() + 20000;
    while (Date.now() < deadlinePage) {
      const pages = await browser.pages().catch(() => []);
      page = pages.find((p) => p.url().includes("auth.burgerking.com.br")) || pages[pages.length - 1];
      if (page) {
        const temInput = await page
          .evaluate(() => Boolean(document.querySelector("input")))
          .catch(() => false);
        if (temInput) break;
      }
      await sleep(800);
    }

    if (!page) {
      throw new Error("Pagina Keycloak nao carregou no WebView.");
    }

    // 1) Preenche e-mail e envia (aguardando Akamai/React estabilizarem)
    await preencherInputWebView(page, 'input:not([type="hidden"])', email);
    await sleep(1500);

    // 2) Envia e aguarda tela de codigo OTP (com retentativa caso o 1o clique ocorra antes do JS/Akamai concluir)
    const deadlineOtpScreen = Date.now() + 30000;
    let ultimoCliqueEmail = 0;
    let telaOtpPronta = false;
    while (Date.now() < deadlineOtpScreen) {
      const estado = await page
        .evaluate(() => {
          const codes = document.querySelectorAll("input.input-code").length;
          const btn = [...document.querySelectorAll("button")].find(
            (b) => !b.disabled && /continuar/i.test(b.innerText || "")
          );
          return { codes, temContinuarHabilitado: Boolean(btn) };
        })
        .catch(() => ({ codes: 0, temContinuarHabilitado: false }));

      if (estado.codes >= 6) {
        telaOtpPronta = true;
        break;
      }

      if (estado.temContinuarHabilitado && Date.now() - ultimoCliqueEmail > 4500) {
        await clicarSubmitWebView(page, "Continuar");
        ultimoCliqueEmail = Date.now();
      }
      await sleep(800);
    }

    if (!telaOtpPronta) {
      throw new Error("Tela de codigo OTP (input.input-code) nao apareceu apos enviar email.");
    }

    log(`Aguardando codigo OTP no email ${email}...`);
    const codigo = await aguardarCodigoBk({
      email,
      senha,
      snapshot: snapshotEmail,
      onLog: log,
    });

    await preencherOtpWebView(page, codigo);

    // 3) Verifica redirecionamento OAuth ou tela de CPF
    let ultimoCliqueCpf = 0;
    const deadlineAuth = Date.now() + 45000;

    while (Date.now() < deadlineAuth) {
      const foco = await obterFocoAtual(adbPath, serial);
      if (foco.includes(PKG_BK) && !foco.includes("BrowserActivity")) {
        break;
      }

      const pagesAtuais = await browser.pages().catch(() => []);
      const paginaAtual =
        pagesAtuais.find((p) => p.url().includes("auth.burgerking.com.br")) ||
        pagesAtuais[pagesAtuais.length - 1] ||
        page;

      const state = await paginaAtual
        .evaluate(() => {
          const cpfInput = document.querySelector('input[name="cpf"]');
          const otpInputs = document.querySelectorAll("input.input-code").length;
          const btn = document.querySelector('button[type="submit"]');
          return {
            temCpf: Boolean(cpfInput),
            temOtp: otpInputs >= 6,
            cpfVal: cpfInput ? cpfInput.value : "",
            btnDisabled: btn ? btn.disabled : false,
            cpfJaCadastrado:
              Boolean(document.querySelector('input[name="validationType"]')) ||
              /j[aá]\s+[eé]\s+cadastrado/i.test(document.body?.innerText || ""),
          };
        })
        .catch(() => null);

      // Navegacao em andamento (execution context recarregando): aguarda sem abortar o loop
      if (!state) {
        await sleep(1000);
        continue;
      }

      if (state.cpfJaCadastrado) {
        const errCpf = new Error(
          `CPF (${cpfUsado}) ja possui cadastro no Burger King.`
        );
        errCpf.code = "CPF_JA_CADASTRADO";
        throw errCpf;
      }

      if (state.temCpf && Date.now() - ultimoCliqueCpf > 6000) {
        if (!state.cpfVal || state.cpfVal.replace(/\D/g, "") !== cpfUsado) {
          log(`Preenchendo CPF (${cpfUsado}) para concluir autenticacao...`);
          await preencherInputWebView(paginaAtual, 'input[name="cpf"]', cpfUsado);
          await sleep(1200);
        }
        await clicarSubmitWebView(paginaAtual, "Continuar");
        ultimoCliqueCpf = Date.now();
        await sleep(3000);
        continue;
      }

      await sleep(1000);
    }
  } finally {
    if (browser) {
      await browser.disconnect().catch(() => {});
    }
    await adb(
      adbPath,
      serial,
      ["forward", "--remove", `tcp:${forwardPort}`],
      5000
    ).catch(() => {});
  }

  log("Finalizando sessao no app BK...");
  const sessaoFinal = await completarPosLoginNativo(adbPath, serial, {
    cpf: cpfUsado,
    onLog: log,
  });

  if (!sessaoFinal?.accessToken || !sessaoFinal?.refreshToken) {
    throw new Error("Nao foi possivel extrair access_token/refresh_token do app.");
  }

  return sessaoFinal;
}

module.exports = {
  PKG_BK,
  encontrarAdb,
  encontrarNoxConsole,
  garantirEmuladorPronto,
  encerrarNox,
  extrairAuthSession,
  autenticarContaViaWorker,
  autenticarContaNoEmulador,
};
