import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error('Faltam VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY no .env.local / Vercel')
}

// Projeto Supabase compartilhado entre apps AMP:
// todas as tabelas e funções do CotaCompara ficam no schema "cotacompara".
export const SCHEMA = 'cotacompara'
export const APP_ID = 'cotacompara'

export const supabase = createClient(url, anonKey, {
  db: { schema: SCHEMA },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'cotacompara-auth',
  },
})

export const APP_URL = import.meta.env.VITE_APP_URL || window.location.origin

// Traduz os erros mais comuns do Supabase Auth para português
export function traduzErro(err) {
  const msg = (err?.message || String(err || '')).toLowerCase()
  if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (msg.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).'
  if (msg.includes('user already registered'))
    return 'Este e-mail já tem conta na plataforma AMP. Entre com a mesma senha que você já usa.'
  if (msg.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (msg.includes('unable to validate email') || msg.includes('invalid email')) return 'E-mail inválido.'
  if (msg.includes('rate limit') || msg.includes('too many')) return 'Muitas tentativas. Aguarde um pouco e tente de novo.'
  if (msg.includes('failed to fetch')) return 'Sem conexão com o servidor. Verifique sua internet.'
  return err?.message || 'Algo deu errado. Tente novamente.'
}

// Erros de regra de negócio que vêm do banco (raise exception)
const ERROS_BANCO = {
  CNPJ_OBRIGATORIO: 'Cadastre o CNPJ da sua empresa em "Minha empresa" antes de criar cotações ou orçamentos.',
  LINK_INVALIDO: 'Link inválido ou expirado. Peça um novo link a quem enviou.',
  LINK_DESATIVADO: 'Este link de pedidos está desativado.',
  LIMITE_ITENS: 'Máximo de 10 itens por pedido.',
  MUITOS_PEDIDOS: 'Muitos pedidos em pouco tempo. Tente mais tarde.',
  DOCUMENTO_INVALIDO: 'CNPJ/CPF inválido. Confira os números.',
  ORCAMENTO_APROVADO_TRAVADO: 'Orçamento aprovado não pode ser alterado. Duplique para fazer outro.',
  CODIGO_INEXISTENTE: 'Código de aprovação não encontrado.',
  ORCAMENTO_VENCIDO: 'A validade deste orçamento terminou. Peça um orçamento atualizado ao fornecedor.',
  ORCAMENTO_INDISPONIVEL: 'Este orçamento não está disponível para aprovação.',
  NOME_OBRIGATORIO: 'Informe seu nome para aprovar.',
  CONTATO_OBRIGATORIO: 'Informe WhatsApp ou e-mail para contato.',
  PEDIDO_JA_DECIDIDO: 'Este pedido já foi respondido anteriormente.',
  ITEM_PRODUTO_INVALIDO: 'Nome do produto inválido (deve ter entre 2 e 200 caracteres).',
  ITEM_QUANTIDADE_INVALIDA: 'Quantidade inválida para os itens do pedido.',
  CONTA_BLOQUEADA: 'Sua conta está suspensa. Fale com o suporte do CotaCompara.',
  ACESSO_NEGADO: 'Acesso restrito ao administrador.',
}
export function mensagemErro(error) {
  const msg = error?.message || String(error || '')
  const chave = Object.keys(ERROS_BANCO).find((k) => msg.includes(k))
  return chave ? ERROS_BANCO[chave] : msg
}
