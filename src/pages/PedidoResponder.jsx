import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, mensagemErro } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { formatarMoeda, formatarQtd, formatarData, numeroCotacao, parseNumero } from '../lib/format'
import { buscarNoCatalogo } from '../lib/leitorItens'
import { IconeVoltar } from '../components/Icones'
import Carregando from '../components/Carregando'

const precoTexto = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }))
const ERROS = {
  LINK_INVALIDO: 'Pedido não encontrado.',
  COTACAO_FECHADA: 'Esta cotação já foi encerrada pelo comprador.',
  PRAZO_ENCERRADO: 'O prazo para responder terminou.',
  JA_RESPONDIDO: 'Você já respondeu. Para alterar, o comprador precisa liberar a correção.',
}
const traduzir = (e) => { const m = e?.message || ''; const k = Object.keys(ERROS).find((x) => m.includes(x)); return k ? ERROS[k] : mensagemErro(e) }

// Fornecedor usuário respondendo, pelo próprio painel, uma cotação que outro usuário enviou.
// Usa as mesmas funções do link público (a resposta cai no mapa do comprador) + o catálogo de preços.
export default function PedidoResponder() {
  const { token } = useParams()
  const { empresa } = useAuth()
  const padrao = empresa?.orc_padrao || {}
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [resp, setResp] = useState({})
  const [cond, setCond] = useState({ prazo: '', pagamento: '', frete: '', obs: '' })
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')
  const [enviado, setEnviado] = useState(false)

  const carregar = async () => {
    const [{ data, error }, { data: cat }] = await Promise.all([
      supabase.rpc('cotacao_publica', { p_token: token }),
      supabase.from('catalogo_produtos').select('id, nome, chave, unidade, ultimo_preco').limit(3000),
    ])
    if (error) { setErro(traduzir(error)); return }
    const r = {}
    for (const i of data.itens) {
      const ja = i.preco_unitario != null || i.disponivel === false
      const achado = ja ? null : buscarNoCatalogo(i.produto, cat || [])
      r[i.id] = {
        preco: ja ? precoTexto(i.preco_unitario) : achado?.exato ? precoTexto(achado.item.ultimo_preco) : '',
        semItem: i.disponivel === false,
        enviado: i.preco_unitario,
        doCatalogo: !ja && achado?.exato && achado.item.ultimo_preco != null,
        sugestao: !ja && achado && !achado.exato ? achado.item : null,
      }
    }
    setResp(r)
    const c = data.condicoes || {}
    const prazoPadrao = parseInt(String(padrao.prazo_entrega || '').replace(/\D/g, ''), 10)
    setCond({
      prazo: c.prazo_entrega_dias != null ? String(c.prazo_entrega_dias) : Number.isFinite(prazoPadrao) ? String(prazoPadrao) : '',
      pagamento: c.condicao_pagamento || padrao.condicao_pagamento || '',
      frete: c.frete != null ? precoTexto(c.frete) : padrao.frete != null ? precoTexto(padrao.frete) : '',
      obs: c.observacao || '',
    })
    setDados(data)
  }
  useEffect(() => { carregar() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const alterar = (id, campo, v) => setResp((r) => ({ ...r, [id]: { ...r[id], [campo]: v } }))
  const usarSugestao = (id) => setResp((r) => ({ ...r, [id]: { ...r[id], preco: r[id].preco || precoTexto(r[id].sugestao.ultimo_preco), sugestao: null, doCatalogo: true } }))

  const totais = useMemo(() => {
    if (!dados) return { total: 0, cotados: 0, semPreco: 0 }
    let total = 0, cotados = 0, semPreco = 0
    for (const i of dados.itens) {
      const r = resp[i.id] || {}
      if (r.semItem) continue
      const p = parseNumero(r.preco)
      if (Number.isFinite(p) && p >= 0) { total += p * Number(i.quantidade); cotados++ } else semPreco++
    }
    const f = parseNumero(cond.frete)
    if (Number.isFinite(f)) total += f
    return { total, cotados, semPreco }
  }, [dados, resp, cond.frete])

  const enviar = async () => {
    setErroEnvio('')
    if (!totais.cotados) return setErroEnvio('Informe o preço de pelo menos um item.')
    if (totais.semPreco > 0 && !window.confirm(`${totais.semPreco} ${totais.semPreco === 1 ? 'item ficou' : 'itens ficaram'} sem preço e ${totais.semPreco === 1 ? 'vai' : 'vão'} como "não tenho". Enviar assim mesmo?`)) return
    const itens = dados.itens.map((i) => {
      const r = resp[i.id] || {}
      const p = parseNumero(r.preco)
      const tem = !r.semItem && Number.isFinite(p) && p >= 0
      return { item_id: i.id, preco_unitario: tem ? p : null, disponivel: tem, observacao: null }
    })
    const prazo = parseInt(cond.prazo, 10), frete = parseNumero(cond.frete)
    setEnviando(true)
    const { error } = await supabase.rpc('responder_cotacao', {
      p_token: token, p_itens: itens,
      p_prazo_entrega_dias: Number.isFinite(prazo) ? prazo : null,
      p_condicao_pagamento: cond.pagamento.trim() || null,
      p_frete: Number.isFinite(frete) ? frete : null,
      p_observacao: cond.obs.trim() || null,
    })
    if (error) { setEnviando(false); return setErroEnvio(traduzir(error)) }
    // o catálogo aprende os preços desta resposta
    await supabase.rpc('aprender_catalogo', {
      p_itens: dados.itens.map((i) => ({ produto: i.produto, unidade: i.unidade, preco: itens.find((x) => x.item_id === i.id)?.preco_unitario ?? null })),
    })
    setEnviando(false)
    setEnviado(true)
    window.scrollTo({ top: 0 })
  }

  if (erro) return (
    <>
      <Link to="/orcamentos" className="voltar"><IconeVoltar /> Clientes</Link>
      <div className="card"><div className="alerta alerta-erro" style={{ margin: 0 }}>{erro}</div></div>
    </>
  )
  if (!dados) return <Carregando />

  const { empresa: comp, cotacao: cot, itens } = dados
  const bloqueado = !dados.pode_responder
  const corrigindo = dados.pode_responder && dados.ja_respondido

  return (
    <>
      <Link to="/orcamentos" className="voltar"><IconeVoltar /> Clientes</Link>
      <div className="titulo-pagina">
        <div>
          <h1>Pedido de {comp.nome}</h1>
          <div className="subtitulo">
            {cot.titulo} · <span className="mono">{numeroCotacao(cot.numero)}</span>
            {cot.prazo_resposta && <> · responder até <b>{formatarData(cot.prazo_resposta)}</b></>}
          </div>
        </div>
      </div>

      {enviado && <div className="alerta alerta-ok">✅ Proposta enviada para {comp.nome}! Os preços foram guardados no seu catálogo. Boa sorte! 🍀</div>}
      {!enviado && corrigindo && <div className="alerta alerta-info">{comp.nome} liberou a correção da sua proposta. Ajuste o que precisar e envie de novo.</div>}
      {!enviado && bloqueado && (
        <div className="alerta alerta-info">
          {dados.ja_respondido ? `Proposta enviada${dados.respondido_em ? ' em ' + formatarData(dados.respondido_em) : ''}. Para alterar, ${comp.nome} precisa liberar a correção.`
            : dados.status_cotacao === 'encerrada' ? 'Esta cotação foi encerrada pelo comprador.' : 'O prazo para responder terminou.'}
        </div>
      )}
      {cot.observacoes && <div className="card" style={{ padding: '12px 16px' }}><b>Observações do comprador:</b> {cot.observacoes}</div>}

      <div className="card">
        <div className="secao-topo">
          <h3>Itens ({itens.length})</h3>
          <small className="texto-suave">{comp.nome}{comp.cidade ? ` · ${comp.cidade}/${comp.uf}` : ''}{comp.cnpj ? ` · CNPJ ${comp.cnpj}` : ''}</small>
        </div>
        <div className="orc-cab ped-cab">
          <span>#</span><span>Produto</span><span style={{ textAlign: 'right' }}>Qtd</span><span>Unid.</span>
          <span style={{ textAlign: 'right' }}>Preço unit. (R$)</span><span style={{ textAlign: 'right' }}>Subtotal</span><span>Não tenho</span>
        </div>
        {itens.map((i, n) => {
          const r = resp[i.id] || {}
          const p = parseNumero(r.preco)
          const sub = !r.semItem && Number.isFinite(p) ? p * Number(i.quantidade) : null
          return (
            <div key={i.id} className="orc-linha ped-linha">
              <span className="n">{n + 1}</span>
              <div className="c-prod">
                <div className="ped-prod">{i.produto}{i.observacao && <small> · {i.observacao}</small>}</div>
                {r.sugestao && !bloqueado && (
                  <div className="orc-sugestao">Você já orçou: <b>{r.sugestao.nome}</b>{r.sugestao.ultimo_preco != null && <> por {formatarMoeda(r.sugestao.ultimo_preco)}</>}
                    <button onClick={() => usarSugestao(i.id)}>usar</button><button className="nao" onClick={() => alterar(i.id, 'sugestao', null)}>não</button></div>
                )}
                {r.doCatalogo && !bloqueado && <div className="orc-dica">preço do seu catálogo</div>}
                {corrigindo && i.preco_unitario != null && <div className="orc-dica" style={{ color: 'var(--texto-3)' }}>enviado antes: {formatarMoeda(i.preco_unitario)}</div>}
              </div>
              <div className="c-qtd ped-num">{formatarQtd(i.quantidade)}</div>
              <div className="c-un ped-un">{i.unidade}</div>
              <div className="c-preco">
                <input className="input qtd" inputMode="decimal" placeholder="0,00" value={r.semItem ? '' : r.preco || ''} disabled={bloqueado || r.semItem}
                  onChange={(e) => alterar(i.id, 'preco', e.target.value)}
                  onBlur={() => { const v = parseNumero(r.preco); if (Number.isFinite(v)) alterar(i.id, 'preco', precoTexto(v)) }} />
              </div>
              <div className="c-sub">{sub == null ? '—' : formatarMoeda(sub)}</div>
              <div className="c-rm ped-nao"><input type="checkbox" checked={!!r.semItem} disabled={bloqueado} onChange={(e) => alterar(i.id, 'semItem', e.target.checked)} title="Não tenho este item" /></div>
            </div>
          )
        })}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Condições</h3>
        <div className="linha-campos">
          <div className="campo"><label>Prazo de entrega (dias)</label><input className="input" inputMode="numeric" value={cond.prazo} disabled={bloqueado} onChange={(e) => setCond({ ...cond, prazo: e.target.value })} /></div>
          <div className="campo"><label>Frete (R$) <small>0 = grátis</small></label><input className="input" inputMode="decimal" value={cond.frete} disabled={bloqueado} onChange={(e) => setCond({ ...cond, frete: e.target.value })} /></div>
        </div>
        <div className="campo"><label>Pagamento</label><input className="input" value={cond.pagamento} disabled={bloqueado} onChange={(e) => setCond({ ...cond, pagamento: e.target.value })} placeholder="Ex.: Pix à vista ou boleto 28 dias" /></div>
        <div className="campo" style={{ marginBottom: 0 }}><label>Observações</label><textarea className="textarea" style={{ minHeight: 60 }} value={cond.obs} disabled={bloqueado} onChange={(e) => setCond({ ...cond, obs: e.target.value })} placeholder="Validade da proposta, marcas, etc." /></div>
      </div>

      {erroEnvio && <div className="alerta alerta-erro">{erroEnvio}</div>}
      {!bloqueado && !enviado && (
        <div className="orc-acoes">
          <div className="orc-acoes-total"><small>Total da sua proposta ({totais.cotados}/{itens.length} itens)</small><b>{formatarMoeda(totais.total)}</b></div>
          <div className="orc-acoes-botoes">
            <button className="btn btn-verde" onClick={enviar} disabled={enviando}>{enviando ? 'Enviando...' : corrigindo ? 'Enviar correção' : `Enviar proposta para ${comp.nome}`}</button>
          </div>
        </div>
      )}
      {enviado && <div style={{ textAlign: 'center', marginTop: 12 }}><Link to="/orcamentos" className="btn btn-secundario">Voltar para Clientes</Link></div>}
    </>
  )
}
