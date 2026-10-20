// Consulta e validação de CNPJ
// Fonte principal: BrasilAPI (sem limite rígido, permite chamada do navegador)
// Reserva: API pública do CNPJ.ws (limite de 3 consultas/minuto por IP)

const so = (s) => String(s || '').replace(/\D/g, '')

export function mascaraCnpj(valor) {
  const d = so(valor).slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function mascaraCpf(valor) {
  const d = so(valor).slice(0, 11)
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

export function mascaraDocumento(valor) {
  const d = so(valor)
  if (d.length <= 11) return mascaraCpf(d)
  return mascaraCnpj(d)
}

export function cpfValido(valor) {
  const c = so(valor)
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
  let soma = 0
  for (let i = 0; i < 9; i++) soma += Number(c[i]) * (10 - i)
  let r = soma % 11
  const d1 = r < 2 ? 0 : 11 - r
  if (Number(c[9]) !== d1) return false
  soma = 0
  for (let i = 0; i < 10; i++) soma += Number(c[i]) * (11 - i)
  r = soma % 11
  const d2 = r < 2 ? 0 : 11 - r
  return Number(c[10]) === d2
}

export function cnpjValido(valor) {
  const c = so(valor)
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const calc = (base) => {
    let soma = 0
    let peso = base.length - 7
    for (const n of base) {
      soma += Number(n) * peso--
      if (peso < 2) peso = 9
    }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = calc(c.slice(0, 12))
  const d2 = calc(c.slice(0, 12) + d1)
  return c.endsWith(`${d1}${d2}`)
}

const titulo = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|\s|\/|-)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase())

const fone = (ddd, num) => {
  const d = so(`${ddd || ''}${num || ''}`)
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  return d || null
}

const juntar = (...partes) => partes.map((p) => (p || '').toString().trim()).filter(Boolean).join(', ')

async function viaBrasilApi(c) {
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${c}`)
  if (r.status === 404) throw new Error('NAO_ENCONTRADO')
  if (!r.ok) throw new Error('FALHA')
  const d = await r.json()
  const logradouro = [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' ')
  const tel = so(d.ddd_telefone_1)
  return {
    cnpj: mascaraCnpj(d.cnpj || c),
    razao_social: d.razao_social || null,
    nome_fantasia: d.nome_fantasia || null,
    situacao: d.descricao_situacao_cadastral || null,
    telefone: tel ? fone(tel.slice(0, 2), tel.slice(2)) : null,
    email: d.email ? String(d.email).toLowerCase() : null,
    cidade: d.municipio ? titulo(d.municipio) : null,
    uf: d.uf || null,
    cep: d.cep ? so(d.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : null,
    endereco: juntar(logradouro && titulo(logradouro), d.numero, d.complemento && titulo(d.complemento), d.bairro && titulo(d.bairro)) || null,
  }
}

async function viaCnpjWs(c) {
  const r = await fetch(`https://publica.cnpj.ws/cnpj/${c}`)
  if (r.status === 404) throw new Error('NAO_ENCONTRADO')
  if (r.status === 429) throw new Error('LIMITE')
  if (!r.ok) throw new Error('FALHA')
  const d = await r.json()
  const e = d.estabelecimento || {}
  return {
    cnpj: mascaraCnpj(c),
    razao_social: d.razao_social || null,
    nome_fantasia: e.nome_fantasia || null,
    situacao: e.situacao_cadastral ? String(e.situacao_cadastral).toUpperCase() : null,
    telefone: e.telefone1 ? fone(e.ddd1, e.telefone1) : null,
    email: e.email ? String(e.email).toLowerCase() : null,
    cidade: e.cidade?.nome ? titulo(e.cidade.nome) : null,
    uf: e.estado?.sigla || null,
    cep: e.cep ? so(e.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : null,
    endereco: juntar(
      titulo([e.tipo_logradouro, e.logradouro].filter(Boolean).join(' ')),
      e.numero, e.complemento && titulo(e.complemento), e.bairro && titulo(e.bairro)
    ) || null,
  }
}

/**
 * Consulta o CNPJ e devolve os dados normalizados.
 * Lança Error com message: INVALIDO | NAO_ENCONTRADO | LIMITE | FALHA
 */
export async function consultarCnpj(valor) {
  const c = so(valor)
  if (!cnpjValido(c)) throw new Error('INVALIDO')
  try {
    return await viaBrasilApi(c)
  } catch (e) {
    if (e.message === 'NAO_ENCONTRADO') throw e
    return await viaCnpjWs(c) // reserva
  }
}

export const MENSAGEM_CNPJ = {
  INVALIDO: 'CNPJ inválido — confira os números.',
  NAO_ENCONTRADO: 'CNPJ não encontrado na Receita Federal.',
  LIMITE: 'Muitas consultas seguidas. Aguarde 1 minuto e tente de novo.',
  FALHA: 'Não foi possível consultar agora. Preencha manualmente ou tente mais tarde.',
}

// Converte o retorno da consulta nos campos da tabela empresas
export const dadosParaEmpresa = (d) => ({
  cnpj: d.cnpj || null,
  razao_social: d.razao_social || null,
  nome_fantasia: d.nome_fantasia || null,
  situacao_cnpj: d.situacao || null,
  cidade: d.cidade || null,
  uf: d.uf || null,
  cep: d.cep || null,
  endereco: d.endereco || null,
  email_contato: d.email || null,
})

// Nome curto para exibir: fantasia > razão social
export const nomeExibicao = (d) => (d?.nome_fantasia || d?.razao_social || '').trim()
