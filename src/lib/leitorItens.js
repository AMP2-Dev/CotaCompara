// Leitor de itens do Orçamento Rápido — roda 100% no navegador, sem custo.
// Recebe texto (colado do WhatsApp/e-mail, extraído de PDF, OCR de foto ou
// linhas de planilha) e devolve uma lista de itens { produto, quantidade, unidade, conferir }.

// ---------------------------------------------------------------- unidades
const UNID = {
  UN: ['un', 'und', 'unid', 'unids', 'unidade', 'unidades', 'u', 'pc', 'pç', 'pcs', 'pçs', 'peca', 'peça', 'pecas', 'peças'],
  CX: ['cx', 'cxs', 'caixa', 'caixas'],
  PCT: ['pct', 'pcts', 'pt', 'pac', 'pacote', 'pacotes'],
  FD: ['fd', 'fdo', 'fardo', 'fardos'],
  RESMA: ['resma', 'resmas', 'rm', 'rs'],
  BL: ['bl', 'bloco', 'blocos'],
  KIT: ['kit', 'kits'],
  JG: ['jg', 'jogo', 'jogos'],
  FR: ['fr', 'frasco', 'frascos'],
  TB: ['tb', 'tubo', 'tubos'],
  CT: ['ct', 'cartela', 'cartelas'],
  RL: ['rl', 'rolo', 'rolos'],
  PAR: ['par', 'pares'],
  DZ: ['dz', 'duzia', 'dúzia', 'duzias', 'dúzias'],
  SC: ['sc', 'saco', 'sacos'],
  GL: ['gl', 'galao', 'galão', 'galoes', 'galões'],
  LT: ['lata', 'latas'],
  KG: ['kg', 'kgs', 'quilo', 'quilos'],
  G: ['g', 'gr', 'grs', 'grama', 'gramas'],
  L: ['l', 'lt', 'lts', 'litro', 'litros'],
  ML: ['ml'],
  M: ['m', 'mt', 'mts', 'metro', 'metros'],
  'M²': ['m2', 'm²'],
  'M³': ['m3', 'm³'],
}
const MAPA_UNID = {}
for (const [u, alias] of Object.entries(UNID)) for (const a of alias) MAPA_UNID[a] = u
// unidades de medida que, grudadas no número, são especificação do produto (500ml, 75g, 1L)
const MEDIDAS = new Set(['G', 'ML', 'KG', 'L', 'M', 'M²', 'M³'])

const alternativas = Object.keys(MAPA_UNID).sort((a, b) => b.length - a.length)
  .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const RX_UN = `(?:${alternativas})`
const NUM = '(\\d{1,6}(?:[.,]\\d{1,3})?)'

export function normalizarUnidade(u) {
  if (!u) return null
  const k = String(u).toLowerCase().replace(/\.$/, '').trim()
  return MAPA_UNID[k] || null
}

export function numero(s) {
  if (s == null) return NaN
  let t = String(s).trim()
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.') // 1.000,5
  else t = t.replace(',', '.')
  return Number(t)
}

// ---------------------------------------------------------------- texto
const RX_WHATS = [
  /^\[\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?,?\s+\d{1,2}:\d{2}(?::\d{2})?\]\s*[^:]{1,40}:\s*/, // [13/10 17:25] Fulano:
  /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*-\s*[^:]{1,40}:\s*/,                      // 13/10/2026 17:25 - Fulano:
]
const RX_MARCADOR = /^[\s•·●○◦▪▫■□☐☑✓✔✅➡️→>*\-–—]+/u
const RX_ENUM = /^\(?(\d{1,3})\s*[).:–-]\s+(?=\S)/   // 1) 1. 1- 1: (1)
const RX_ITEM_PALAVRA = /^item\s*\d{1,3}\s*[:.)-]?\s*/i

const CONVERSA = /^(bom dia|boa tarde|boa noite|ol[aá]\b|oi\b|e a[ií]|tudo bem|segue|seguem|favor|por favor|pfv|pf\b|obrigad|grat[oa]\b|agrade[cç]|att\b|atenciosamente|abra[cç]o|aguardo|fico no aguardo|preciso de (um |uma )?(or[cç]amento|cota[cç][aã]o)|gostaria|poderia|pode(ria)? me|me (passa|envia|manda)|cota[cç][aã]o\b|or[cç]amento\b|pedido\b|lista\b|segue a lista|material\b|prazo\b|entrega\b|pagamento\b|forma de pagamento|cnpj\b|cpf\b|raz[aã]o social|endere[cç]o|rua\b|av\.?\b|bairro|cidade|cep\b|tel\.?\b|telefone|celular|whats|e-?mail|contato|respons[aá]vel|data\b|validade|total\b|valor total|subtotal|observa[cç]|obs\b|assinatura|https?:)/i

const SO_NUMERO = /^[\d\s.,/-]+$/

export function limparLinha(l) {
  let s = String(l || '').replace(/ /g, ' ')
  for (const rx of RX_WHATS) s = s.replace(rx, '')
  s = s.replace(RX_MARCADOR, '').replace(RX_ITEM_PALAVRA, '')
  return s.replace(/\s+/g, ' ').trim()
}

function arrumarProduto(p) {
  let s = String(p || '')
    .replace(/^[\s:;,.\-–—=x×*]+/i, '')
    .replace(/[\s:;,\-–—=*]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/^de\s+/i, '')
  // TUDO EM MAIÚSCULAS (comum em PDF e OCR): deixa só a 1ª letra maiúscula,
  // mantendo siglas curtas e códigos com número (A4, HB, 2B, 75G)
  const letras = s.replace(/[^A-Za-zÀ-ÿ]/g, '')
  const maius = letras.replace(/[^A-ZÀ-Þ]/g, '')
  if (letras.length > 4 && maius.length / letras.length > 0.7) {
    s = s.split(' ').map((w) => (/\d/.test(w) || (w.length <= 2 && /^[A-ZÀ-Þ]+$/.test(w)) ? w : w.toLowerCase())).join(' ')
  }
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const QTD_ROTULO = new RegExp(`\\b(?:qtd|qtde|quant|quantidade)\\.?\\s*[:=]?\\s*${NUM}\\s*(${RX_UN})?\\.?(?=\\s|$|[,;)])`, 'i')
const QTD_PARENT = new RegExp(`\\(\\s*${NUM}\\s*(${RX_UN})?\\.?\\s*\\)`, 'i')
const QTD_INICIO = new RegExp(`^${NUM}\\s*(${RX_UN})?\\.?(?:\\s*(?:x|×|de|-|–|:)\\s*|\\s+)(.+)$`, 'i')
const QTD_FIM = new RegExp(`^(.+?)(\\s*(?:[-–:=x×]|\\.{2,})\\s*|\\s+)${NUM}(\\s*)(${RX_UN})?\\.?$`, 'i')

// ---------------------------------------------------------------- preço
// "R$ 2,50", "2,50", "1.250,00", "x 2.50", "@ 3,90 cada" — o número com 2 casas
// decimais no fim da linha é preço; se vier em dupla (2,50 25,00) o 2º é o total.
const MOEDA = '(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d+,\\d{2})'
const RX_RS = /(?:(?:pre[cç]o|valor|vlr|unit[aá]rio|unit|p\.?\s*unit)\.?\s*[:=]?\s*)?R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:cada|\/\s*[a-zç]{1,6}\.?|unit[aá]rio))?/gi
const RX_PRECO_FIM = new RegExp(`(?:^|\\s)(?:(?:[x×@=:]|-|–|a|por|pre[cç]o|valor|vlr|unit\\.?|unit[aá]rio)\\s*)?${MOEDA}(?:\\s*(?:cada|\\/\\s*[a-zç]{1,6}\\.?|unit[aá]rio))?\\s*$`, 'i')
const RX_PRECO_PONTO = /(?:^|\s)(?:[x×@=]|a|por|pre[cç]o|valor|vlr)\s*(\d+\.\d{2})(?:\s*(?:cada|\/\s*[a-zç]{1,6}\.?))?\s*$/i
const RX_SOBRA = /(?:[\s\-–:=x×@*]+|\s+(?:a|por|cada|de|pre[cç]o|valor|vlr|unit\.?|unit[aá]rio))$/i

function aparar(s) {
  let t = s, ant
  do { ant = t; t = t.replace(RX_SOBRA, '') } while (t !== ant && t)
  return t.trim()
}

/** Separa o preço do resto da linha. Retorna { resto, preco } (preco null se não achou). */
export function separarPreco(linha) {
  let s = String(linha || '')
  const rs = [...s.matchAll(RX_RS)]
  if (rs.length) {
    const preco = numero(rs[0][1])
    s = s.replace(RX_RS, ' ').replace(/\s+/g, ' ')
    return { resto: aparar(s), preco: Number.isFinite(preco) ? preco : null }
  }
  let m = s.match(RX_PRECO_FIM)
  if (m && /[A-Za-zÀ-ÿ]{2,}/.test(s.slice(0, m.index))) {
    let preco = numero(m[1])
    let resto = aparar(s.slice(0, m.index))
    // dupla "2,50 25,00": o da esquerda é o unitário
    const m2 = resto.match(RX_PRECO_FIM)
    if (m2 && /[A-Za-zÀ-ÿ]{2,}/.test(resto.slice(0, m2.index))) {
      preco = numero(m2[1])
      resto = aparar(resto.slice(0, m2.index))
    }
    return { resto, preco }
  }
  m = s.match(RX_PRECO_PONTO)
  if (m && /[A-Za-zÀ-ÿ]{2,}/.test(s.slice(0, m.index))) {
    return { resto: aparar(s.slice(0, m.index)), preco: Number(m[1]) }
  }
  return { resto: s, preco: null }
}

/**
 * Lê uma linha de texto livre. Retorna null se não parece um item.
 */
export function lerLinha(linhaOriginal, contexto = {}) {
  let s = limparLinha(linhaOriginal)
  if (!s || s.length < 2) return null
  if (SO_NUMERO.test(s)) return null
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(s)) return null
  if (CONVERSA.test(s) && !/^\d/.test(s)) return null // inclui "Total R$ ...", "Valor total"

  const { resto: semPreco, preco } = separarPreco(s)
  s = semPreco
  if (!s || !/[A-Za-zÀ-ÿ]{2,}/.test(s)) return null
  if (preco != null && /^(frete|desconto|taxa|soma|sub-?total|total|valor)\b/i.test(s)) return null

  let enumerado = false
  const en = s.match(RX_ENUM)
  if (en) {
    const resto = s.slice(en[0].length)
    // "2 - Caneta azul 10 un": o 2 é numeração se o resto também tem quantidade;
    // "2 - Caneta azul": o 2 é a quantidade
    if (QTD_FIM.test(resto) || QTD_INICIO.test(resto) || QTD_ROTULO.test(resto) || QTD_PARENT.test(resto) || /[).:]/.test(en[0])) {
      s = resto
      enumerado = true
    }
  }

  let qtd = NaN, un = null, produto = null, m

  if ((m = s.match(QTD_ROTULO))) {
    qtd = numero(m[1]); un = normalizarUnidade(m[2])
    produto = s.replace(m[0], ' ')
  } else if ((m = s.match(QTD_PARENT))) {
    qtd = numero(m[1]); un = normalizarUnidade(m[2])
    produto = s.replace(m[0], ' ')
  } else if ((m = s.match(QTD_INICIO))) {
    const u = normalizarUnidade(m[2])
    const grudado = m[2] && new RegExp(`^${m[1].replace('.', '\\.')}${m[2]}`, 'i').test(s)
    if (u && MEDIDAS.has(u) && grudado) {
      // "500ml detergente": é especificação, não quantidade
      produto = s
    } else {
      qtd = numero(m[1]); un = u; produto = m[3]
    }
  }
  if (produto == null || !Number.isFinite(qtd)) {
    const alvo = produto ?? s
    if ((m = alvo.match(QTD_FIM))) {
      const u = normalizarUnidade(m[5])
      const separado = /[-–:=x×.]/.test(m[2])
      const grudado = m[4] === '' && m[5]
      // "Papel A4 75g", "Detergente 500ml", "Caneta 0.7": número final é especificação
      const especificacao = (!separado && u && MEDIDAS.has(u) && grudado) || (!separado && !u && /[.,]/.test(m[3]) && numero(m[3]) < 5)
      if (!especificacao) {
        qtd = numero(m[3]); un = u; produto = m[1]
      }
    }
  }

  produto = arrumarProduto(produto ?? s)
  if (!produto || produto.length < 2 || !/[A-Za-zÀ-ÿ]{2,}/.test(produto)) return null

  const temQtd = Number.isFinite(qtd) && qtd > 0
  // sem quantidade: só aceita se a linha estava numerada/marcada ou se já estamos numa lista
  const marcado = enumerado || RX_MARCADOR.test(String(linhaOriginal).trim())
  if (!temQtd && !marcado && !contexto.emLista) return null
  if (!temQtd && produto.split(' ').length > 12) return null // frase longa, não é item

  return {
    produto,
    quantidade: temQtd ? qtd : 1,
    unidade: un || 'UN',
    conferir: !temQtd,
    ...(preco != null && preco > 0 ? { preco } : {}),
  }
}

// ---------------------------------------------------------------- tabelas
const CAB_PROD = /produto|descri|item|material|especifica|mercadoria/i
const CAB_QTD = /^(qtd|qtde|quant|quantidade|qde|qt)\b/i
const CAB_UN = /^(un|und|unid|unidade|medida|u\.?m\.?)\b/i
const CAB_PRECO = /pre[cç]o|unit|vlr\.?\s*un|valor\s*un/i
const CAB_TOTAL = /total/i

function dividirCelulas(l) {
  if (l.includes('\t')) return l.split('\t')
  if ((l.match(/;/g) || []).length >= 1) return l.split(';')
  if ((l.match(/\|/g) || []).length >= 2) return l.split('|')
  return null
}

function lerTabela(linhas) {
  const rows = linhas.map((l) => (dividirCelulas(l) || []).map((c) => c.trim()))
  let col = null
  const itens = []
  for (const cells of rows) {
    if (!cells.length) continue
    const temCab = cells.some((c) => CAB_PROD.test(c)) && cells.some((c) => CAB_QTD.test(c))
    if (temCab) {
      col = {
        p: (() => { const i = cells.findIndex((c) => /produto|descri|material|especifica|mercadoria/i.test(c)); return i >= 0 ? i : cells.findIndex((c) => CAB_PROD.test(c)) })(),
        q: cells.findIndex((c) => CAB_QTD.test(c)),
        u: cells.findIndex((c) => CAB_UN.test(c)),
        v: (() => { const i = cells.findIndex((c) => CAB_PRECO.test(c) && !CAB_TOTAL.test(c)); return i >= 0 ? i : cells.findIndex((c) => /^(valor|pre[cç]o)$/i.test(c)) })(),
      }
      continue
    }
    let produto, qtd, un, preco = NaN
    if (col) {
      produto = cells[col.p]; qtd = numero(cells[col.q]); un = col.u >= 0 ? cells[col.u] : null
      if (col.v >= 0) preco = numero(String(cells[col.v] || '').replace(/R\$\s*/i, ''))
    } else {
      // sem cabeçalho: produto = maior célula com letras; qtd = 1º número; unidade = célula que é unidade
      const comLetras = cells.map((c, i) => [c, i]).filter(([c]) => /[A-Za-zÀ-ÿ]{2,}/.test(c) && !normalizarUnidade(c))
      if (!comLetras.length) continue
      const [p, ip] = comLetras.sort((a, b) => b[0].length - a[0].length)[0]
      produto = p
      const nums = cells.map((c, i) => [c, i]).filter(([c, i]) => i !== ip && /^\d{1,6}([.,]\d{1,3})?$/.test(c))
      // ignora coluna de numeração (1, 2, 3...) que vem antes do produto
      const depois = nums.filter(([, i]) => i > ip)
      qtd = numero((depois[0] || nums[nums.length - 1] || [])[0])
      un = (cells.find((c) => normalizarUnidade(c)) || null)
      // depois da quantidade, a 1ª célula com cara de dinheiro (2,50 ou R$ 2,50) é o preço
      const din = cells.map((c, i) => [c.replace(/R\$\s*/i, ''), i])
        .filter(([c, i]) => i > ip && i !== (depois[0] || [])[1] && /^(\d{1,3}(\.\d{3})+|\d+)[.,]\d{2}$/.test(c))
      if (din.length) preco = numero(din[0][0])
    }
    if (!produto || !/[A-Za-zÀ-ÿ]{2,}/.test(produto) || CONVERSA.test(produto) && !Number.isFinite(qtd)) continue
    if (/^(total|subtotal|valor)/i.test(produto)) continue
    const temQtd = Number.isFinite(qtd) && qtd > 0
    itens.push({
      produto: arrumarProduto(produto), quantidade: temQtd ? qtd : 1,
      unidade: normalizarUnidade(un) || (un ? String(un).toUpperCase().slice(0, 6) : 'UN'), conferir: !temQtd,
      ...(Number.isFinite(preco) && preco > 0 ? { preco } : {}),
    })
  }
  return itens
}

/**
 * Texto bruto → itens. Detecta sozinho se é tabela (Excel/PDF) ou texto livre.
 */
export function lerItens(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim())
  if (!linhas.length) return []
  const tabulares = linhas.filter((l) => dividirCelulas(l)).length
  if (tabulares >= Math.max(2, linhas.length * 0.5)) {
    const t = lerTabela(linhas)
    if (t.length) return t
  }
  const itens = []
  let emLista = false
  for (const l of linhas) {
    const it = lerLinha(l, { emLista })
    if (it) { itens.push(it); if (!it.conferir) emLista = true }
  }
  return itens
}

// ---------------------------------------------------------------- catálogo
const ABREV = {
  esf: 'esferografica', esferog: 'esferografica', az: 'azul', vm: 'vermelho', verm: 'vermelho', pt: 'preto', pto: 'preto',
  vd: 'verde', am: 'amarelo', br: 'branco', bco: 'branco', cad: 'caderno', lap: 'lapis', borr: 'borracha', env: 'envelope',
  pap: 'papel', sulf: 'sulfite', cx: 'caixa', pct: 'pacote', c: 'com', s: 'sem', fls: 'folhas', fl: 'folhas', cl: 'cola',
  marc: 'marcador', txt: 'texto', grampo: 'grampos', grampeador: 'grampeador', apont: 'apontador', tes: 'tesoura',
}

/** mesma regra do banco: cotacompara.chave_produto() */
export function chaveProduto(p) {
  return String(p || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function tokens(p) {
  return chaveProduto(p.replace(/\bc\//gi, 'com ').replace(/\bs\//gi, 'sem ')).split(' ').filter(Boolean).map((t) => ABREV[t] || t)
}

function parecido(a, b) {
  if (a === b) return true
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true
  // 1 letra trocada em palavras longas (erro comum de OCR)
  if (a.length >= 5 && a.length === b.length) {
    let d = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false
    return true
  }
  return false
}

const CORES = new Set(['azul', 'vermelho', 'vermelha', 'preto', 'preta', 'verde', 'amarelo', 'amarela', 'branco', 'branca', 'rosa', 'roxo', 'roxa', 'laranja', 'cinza', 'marrom', 'lilas', 'dourado', 'prata'])
const ehMedida = (t) => /\d/.test(t)

export function similaridade(a, b) {
  const ta = tokens(a), tb = tokens(b)
  if (!ta.length || !tb.length) return 0
  const usados = new Set()
  const sobraA = []
  let iguais = 0
  for (const x of ta) {
    const j = tb.findIndex((y, k) => !usados.has(k) && parecido(x, y))
    if (j >= 0) { usados.add(j); iguais++ } else sobraA.push(x)
  }
  const sobraB = tb.filter((_, k) => !usados.has(k))
  // cor ou medida diferente = outro produto (caneta azul ≠ caneta vermelha; A4 ≠ A3; 10 matérias ≠ 1 matéria)
  if (sobraA.some((t) => CORES.has(t)) && sobraB.some((t) => CORES.has(t))) return 0
  if (sobraA.some(ehMedida) && sobraB.some(ehMedida)) return 0
  return (2 * iguais) / (ta.length + tb.length)
}

/**
 * Procura o produto no catálogo do fornecedor.
 * Retorna { item, score, exato } ou null.
 */
export function buscarNoCatalogo(produto, catalogo) {
  if (!produto || !catalogo?.length) return null
  const chave = chaveProduto(produto)
  const exato = catalogo.find((c) => c.chave === chave)
  if (exato) return { item: exato, score: 1, exato: true }
  let melhor = null
  for (const c of catalogo) {
    const s = similaridade(produto, c.nome)
    if (s >= 0.6 && (!melhor || s > melhor.score)) melhor = { item: c, score: s, exato: false }
  }
  return melhor
}
