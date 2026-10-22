// Vercel Function: POST /api/enviar-orcamento
// Envia por e-mail (Resend) o orçamento que o fornecedor montou no Orçamento Rápido.
// Usa o token do usuário logado: o RLS do Supabase garante que só envia orçamento da própria empresa.
// Corpo: { orcamento_id: uuid, email_destinatario?: string, atualizar_cadastro?: boolean }

import { createClient } from '@supabase/supabase-js'
import { montarEmailOrcamento, numeroDoc } from './_lib/emailOrcamento.js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || 'CotaCompara <cotacao@amp.adm.br>'
const APP_URL = (process.env.APP_URL || process.env.VITE_APP_URL || 'https://cotacompara.amp.ia.br').replace(/\/$/, '')

const responder = (res, status, corpo) => res.status(status).json(corpo)
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim())

export default async function handler(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'Use POST.' })
  if (!SUPABASE_URL || !SUPABASE_ANON) return responder(res, 500, { erro: 'Supabase não configurado no servidor.' })
  if (!RESEND_KEY) return responder(res, 500, { erro: 'RESEND_API_KEY não configurada na Vercel.' })

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return responder(res, 401, { erro: 'Faça login novamente.' })

  let corpo = req.body
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo) } catch { corpo = {} } }
  const { orcamento_id, email_destinatario, atualizar_cadastro = true } = corpo || {}
  if (!orcamento_id) return responder(res, 400, { erro: 'orcamento_id é obrigatório.' })

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
    db: { schema: 'cotacompara' },
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await sb.auth.getUser(token)
  if (userErr || !userData?.user) return responder(res, 401, { erro: 'Sessão expirada. Entre novamente.' })

  const { data: orc } = await sb.from('orcamentos').select('*, orcamento_itens(*)').eq('id', orcamento_id).maybeSingle()
  if (!orc) return responder(res, 404, { erro: 'Orçamento não encontrado.' })

  const destinatario = (email_destinatario || orc.cliente_email || '').trim()
  if (!emailOk(destinatario)) {
    return responder(res, 400, { erro: 'Informe um e-mail válido do cliente ou signatário para enviar.' })
  }

  // Se o destinatário informado for novo ou diferente, atualiza cliente_email do orçamento
  if (atualizar_cadastro && destinatario && destinatario !== (orc.cliente_email || '').trim()) {
    await sb.from('orcamentos').update({ cliente_email: destinatario }).eq('id', orc.id)
  }

  const { data: empresa } = await sb.from('empresas').select('*').eq('id', orc.empresa_id).maybeSingle()
  if (!empresa) return responder(res, 404, { erro: 'Empresa não encontrada.' })
  if (empresa.bloqueado) return responder(res, 403, { erro: 'Conta suspensa. Fale com o suporte.' })

  const itens = [...(orc.orcamento_itens || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  const { assunto, html, texto } = montarEmailOrcamento({ empresa, orcamento: orc, itens, link: `${APP_URL}/o/${orc.token}` })

  console.log(`[enviar-orcamento] usuario=${userData.user.email} orcamento=${numeroDoc(orc.numero)} para=${destinatario}`)
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM.replace(/^[^<]*</, `${empresa.nome.replace(/[<>"]/g, '').slice(0, 60)} via CotaCompara <`),
        to: [destinatario],
        reply_to: empresa.email_contato || userData.user.email,
        subject: assunto, html, text: texto,
        tags: [{ name: 'app', value: 'cotacompara' }, { name: 'tipo', value: 'orcamento' }],
      }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = j?.message || j?.error || `Resend respondeu ${r.status}`
      console.error(`[enviar-orcamento] ERRO Resend ${r.status}: ${msg}`)
      return responder(res, 502, { erro: 'Falha no envio: ' + msg })
    }
    return responder(res, 200, { ok: true, id: j.id, destinatario })
  } catch (e) {
    return responder(res, 502, { erro: 'Não foi possível falar com o serviço de e-mail: ' + e.message })
  }
}
