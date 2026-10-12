"use strict";

const PRIMEIROS_NOMES = [
  "Lucas", "Gabriel", "Matheus", "Guilherme", "Gustavo", "Felipe", "Rodrigo",
  "Bruno", "Rafael", "Leonardo", "Thiago", "Diego", "Henrique", "Caio",
  "Eduardo", "Danilo", "Vinicius", "Alerrandro", "Allyson", "Arthur", "Bernardo",
  "Juliana", "Mariana", "Camila", "Beatriz", "Larissa", "Leticia", "Fernanda",
  "Amanda", "Jessica", "Bruna", "Gabriela", "Carolina", "Natalia", "Patricia"
];

const SOBRENOMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves",
  "Pereira", "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho",
  "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha",
  "Dias", "Nascimento", "Andrade", "Moreira", "Nunes", "Marques", "Machado"
];

const DDD_BRASIL = [
  "11", "19", "21", "27", "31", "41", "47", "48", "51", "61", "62", "71",
  "81", "84", "85", "91", "98"
];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDigits(length = 8) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10);
  }
  return result;
}

function gerarCPF() {
  const d = [];
  for (let i = 0; i < 9; i++) {
    d.push(Math.floor(Math.random() * 10));
  }

  let s1 = 0;
  for (let i = 0; i < 9; i++) {
    s1 += d[i] * (10 - i);
  }
  let r1 = s1 % 11;
  d.push(r1 < 2 ? 0 : 11 - r1);

  let s2 = 0;
  for (let i = 0; i < 10; i++) {
    s2 += d[i] * (11 - i);
  }
  let r2 = s2 % 11;
  d.push(r2 < 2 ? 0 : 11 - r2);

  return d.join("");
}

function gerarNomeCompleto() {
  const primeiro = randomChoice(PRIMEIROS_NOMES);
  const sobrenome1 = randomChoice(SOBRENOMES);
  const sobrenome2 = randomChoice(SOBRENOMES);
  return {
    nomeCompleto: `${primeiro} ${sobrenome1} ${sobrenome2}`,
    firstName: primeiro,
    lastName: `${sobrenome1} ${sobrenome2}`
  };
}

function gerarTelefone() {
  const ddd = randomChoice(DDD_BRASIL);
  const sufixo = randomDigits(8);
  return `+55${ddd}9${sufixo}`;
}

function gerarSenhaForte() {
  const maiusculas = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const minusculas = "abcdefghijkmnpqrstuvwxyz";
  const numeros = "23456789";
  const especiais = "@#!$%&*";

  const p1 = randomChoice(maiusculas.split(""));
  const p2 = randomChoice(minusculas.split(""));
  const p3 = randomChoice(numeros.split(""));
  const p4 = randomChoice(especiais.split(""));

  const todos = maiusculas + minusculas + numeros + especiais;
  let resto = "";
  for (let i = 0; i < 8; i++) {
    resto += randomChoice(todos.split(""));
  }

  return `${p1}${p2}${p3}${p4}${resto}`;
}

function randomAlphanumeric(len = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let str = "";
  for (let i = 0; i < len; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}

function gerarDataNascimento(minIdade = 18, maxIdade = 50) {
  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const anoMin = anoAtual - maxIdade;
  const anoMax = anoAtual - minIdade;

  const ano = Math.floor(Math.random() * (anoMax - anoMin + 1)) + anoMin;
  const mes = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const dia = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0");

  return `${ano}-${mes}-${dia}`;
}

function gerarSexo() {
  return Math.random() > 0.5 ? "male" : "female";
}

const ENDERECO_PADRAO = {
  postalCode: "59125-090",
  street: "Avenida Governador Antônio de Melo e Souza",
  number: "000",
  neighborhood: "Potengi",
  city: "Natal",
  state: "RN",
  country: "BRA"
};

function gerarEndereco(custom = {}) {
  return {
    postalCode: custom.postalCode || custom.cep || ENDERECO_PADRAO.postalCode,
    street: custom.street || custom.rua || custom.logradouro || ENDERECO_PADRAO.street,
    number: custom.number !== undefined ? String(custom.number) : (custom.numero !== undefined ? String(custom.numero) : ENDERECO_PADRAO.number),
    neighborhood: custom.neighborhood || custom.bairro || ENDERECO_PADRAO.neighborhood,
    city: custom.city || custom.cidade || ENDERECO_PADRAO.city,
    state: custom.state || custom.estado || ENDERECO_PADRAO.state,
    country: custom.country || ENDERECO_PADRAO.country,
    complement: custom.complement || custom.complemento || null
  };
}

module.exports = {
  gerarCPF,
  gerarNomeCompleto,
  gerarTelefone,
  gerarSenhaForte,
  gerarDataNascimento,
  gerarSexo,
  gerarEndereco,
  randomAlphanumeric
};
