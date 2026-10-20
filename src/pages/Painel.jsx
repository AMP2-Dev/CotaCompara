import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, SCHEMA } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { STATUS_COTACAO, STATUS_ORCAMENTO, numeroCotacao, formatarData, formatarMoeda } from '../lib/format'
import { vencedorDasPropostas } from '../lib/comparativo'
import Badge from '../components/Badge'

export default function Painel() {
  const { empresa } = useAuth()
  const navigate = useNavigate()
  const [n, setN] = useState({ abertas: 0, fornecedores: 0, respostas: 0, aguardando: 0 })
  const [cotacoes, setCotacoes] = useState([])
  const [economiaTotal, setEconomiaTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [pedidosAbertos, setPedidosAbertos] = useState(0)
  const [pedidosLinkAbertos, setPedidosLinkAbertos] = useState(0)
  const [propostas, setPropostas] = useState([])

  // integração entre usuários: pedidos que chegaram para mim e orçamentos que fornecedores me mandaram
  useEffect(() => {
    if (!empresa) return
    supabase.rpc('pedidos_recebidos').then(({ data }) =>
      setPedidosAbertos((data || []).filter((p) => p.cotacao.aberta && (!p.respondido_em || p.pode_corrigir)).length))
    supabase.rpc('propostas_recebidas').then(({ data }) => setPropostas(data || []))

    // Pedidos pelo link público aguardando
    const carregarPedidosLink = () => {
      supabase
        .from('pedidos_link')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendente')
        .then(({ count }) => setPedidosLinkAbertos(count || 0))
    }
    carregarPedidosLink()

    const canalPedLink = supabase
      .channel('painel-pedidos-link')
      .on('postgres_changes', { event: '*', schema: SCHEMA, table: 'pedidos_link' }, carregarPedidosLink)
      .subscribe()

    return () => { supabase.removeChannel(canalPedLink) }
  }, [empresa])

  useEffect(() => {
    if (!empresa) return
    let ativo = true

    const carregar = async () => {
      const [abertas, fornecedores, respostas, aguardando, cots] = await Promise.all([
        supabase.from('cotacoes').select('id', { count: 'exact', head: true }).eq('status', 'enviada'),
        supabase.from('fornecedores').select('id', { count: 'exact', head: true }).eq('ativo', true),
        supabase.from('convites').select('id', { count: 'exact', head: true }).eq('status', 'respondido'),
        supabase.from('convites').select('id', { count: 'exact', head: true }).in('status', ['enviado', 'aberto']),
        supabase.from('cotacoes')
          .select('id, numero, titulo, status, prazo_resposta, created_at, convites(status)')
          .in('status', ['enviada', 'encerrada'])
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      const lista = cots.data || []
      const ids = lista.map((c) => c.id)
      const { data: propostas } = ids.length
        ? await supabase.from('v_propostas').select('*').in('cotacao_id', ids)
        : { data: [] }

      let economia = 0
      const comResultado = lista.map((c) => {
        const r = vencedorDasPropostas((propostas || []).filter((p) => p.cotacao_id === c.id))
        economia += r.economia
        return { ...c, ...r, qtdPropostas: (propostas || []).filter((p) => p.cotacao_id === c.id).length }
      })

      if (!ativo) return
      setN({
        abertas: abertas.count || 0,
        fornecedores: fornecedores.count || 0,
        respostas: respostas.count || 0,
        aguardando: aguardando.count || 0,
      })
      setCotacoes(comResultado)
      setEconomiaTotal(economia)
      setCarregando(false)
    }
    carregar()

    // atualiza sozinho quando um fornecedor responde
    const canal = supabase
      .channel('painel-convites')
      .on('postgres_changes', { event: '*', schema: SCHEMA, table: 'convites' }, carregar)
      .subscribe()

    return () => { ativo = false; supabase.removeChannel(canal) }
  }, [empresa])

  const primeiroNome = (empresa?.responsavel || '').split(' ')[0]
  const vazio = !carregando && cotacoes.length === 0
  const recentes = cotacoes.slice(0, 8)

  return (
    <>
      <div className="titulo-pagina">
        <div>
          <h1>{primeiroNome ? `Olá, ${primeiroNome}!` : 'Seu painel'}</h1>
          <div className="subtitulo">
            {empresa?.nome}{!carregando && ` · ${n.fornecedores} ${n.fornecedores === 1 ? 'fornecedor' : 'fornecedores'} na agenda`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/orcamentos/novo" className="btn btn-secundario">+ Responder orçamento</Link>
          <Link to="/cotacoes/nova" className="btn btn-primario">+ Nova cotação</Link>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card stat destaque">
          <div className="rotulo">Cotações abertas</div>
          <div className="valor">{carregando ? '–' : n.abertas}</div>
          <div className="detalhe">aguardando preços</div>
        </div>
        <div className="card stat verde">
          <div className="rotulo">Respostas recebidas</div>
          <div className="valor">{carregando ? '–' : n.respostas}</div>
          <div className="detalhe">propostas de fornecedores</div>
        </div>
        <div className="card stat laranja">
          <div className="rotulo">Aguardando resposta</div>
          <div className="valor">{carregando ? '–' : n.aguardando}</div>
          <div className="detalhe">convites enviados ou abertos</div>
        </div>
        <div className="card stat amarelo">
          <div className="rotulo">Economia identificada</div>
          <div className="valor valor-moeda">{carregando ? '–' : formatarMoeda(economiaTotal)}</div>
          <div className="detalhe">vencedor × proposta mais cara</div>
        </div>
      </div>

      {pedidosLinkAbertos > 0 && (
        <Link to="/orcamentos" className="card orc-chamada ped-alerta" style={{ borderColor: 'var(--cor-primaria)' }}>
          <span className="orc-chamada-icone">⚡</span>
          <span>
            <b>Você tem {pedidosLinkAbertos} {pedidosLinkAbertos === 1 ? 'pedido pelo link aguardando você' : 'pedidos pelo link aguardando você'}</b>
            <small>Clientes acessaram seu link direto de pedidos e enviaram listas para você precificar.</small>
          </span>
          <span className="orc-chamada-seta">Ver pedidos →</span>
        </Link>
      )}

      {pedidosAbertos > 0 && (
        <Link to="/orcamentos" className="card orc-chamada ped-alerta">
          <span className="orc-chamada-icone">📥</span>
          <span>
            <b>Você tem {pedidosAbertos} {pedidosAbertos === 1 ? 'pedido de cotação' : 'pedidos de cotação'} para responder</b>
            <small>Compradores que usam o CotaCompara enviaram direto para o seu painel. Seus preços do catálogo já vêm preenchidos.</small>
          </span>
          <span className="orc-chamada-seta">Responder →</span>
        </Link>
      )}

      {propostas.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 0 }}>
          <div className="secao-topo" style={{ padding: '16px 20px 0' }}>
            <h3>📨 Propostas recebidas <small className="texto-suave">orçamentos que fornecedores enviaram para você</small></h3>
          </div>
          <div className="lista" style={{ boxShadow: 'none' }}>
            {propostas.slice(0, 6).map((o) => {
              const st = STATUS_ORCAMENTO[o.status] || STATUS_ORCAMENTO.enviado
              const vencido = o.status === 'enviado' && o.valido_ate && new Date(o.valido_ate) < new Date()
              return (
                <a key={o.token} className="lista-item clicavel" href={`/o/${o.token}`} target="_blank" rel="noreferrer">
                  <div className="principal">
                    <div className="titulo">{o.fornecedor.nome}{o.referencia ? ` · ${o.referencia}` : ''}</div>
                    <div className="meta">
                      <span className="mono">{numeroCotacao(o.numero)}</span>
                      <span>{o.itens} {o.itens === 1 ? 'item' : 'itens'}</span>
                      <span>recebido {formatarData(o.enviado_em)}</span>
                      {o.status === 'enviado' && !vencido && <span>válido até {formatarData(o.valido_ate, false)}</span>}
                    </div>
                  </div>
                  <div className="orc-total">{formatarMoeda(o.total)}</div>
                  {vencido ? <Badge cor="laranja">vencido</Badge> : <Badge cor={o.status === 'enviado' ? 'laranja' : st.cor}>{o.status === 'enviado' ? 'aguardando você' : st.rotulo}</Badge>}
                </a>
              )
            })}
          </div>
        </div>
      )}

      <Link to="/orcamentos/novo" className="card orc-chamada">
        <span className="orc-chamada-icone">⚡</span>
        <span>
          <b>Recebeu um pedido de orçamento por WhatsApp, PDF ou foto?</b>
          <small>Cole ou envie o arquivo: o CotaCompara monta a tabela, você coloca os preços e manda um orçamento profissional em minutos.</small>
        </span>
        <span className="orc-chamada-seta">Orçamento Rápido →</span>
      </Link>

      {/* ---------- Resultados ---------- */}
      {recentes.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 0 }}>
          <div className="secao-topo" style={{ padding: '18px 20px 0' }}>
            <h3>Resultados das cotações</h3>
            <Link to="/cotacoes" className="texto-suave">Ver todas</Link>
          </div>
          <div className="tabela-wrap">
            <table className="tabela painel-res">
              <thead>
                <tr>
                  <th>Cotação</th>
                  <th>Status</th>
                  <th>Respostas</th>
                  <th>Vencedor</th>
                  <th className="num">Menor total</th>
                  <th className="num">Economia</th>
                </tr>
              </thead>
              <tbody>
                {recentes.map((c) => {
                  const st = STATUS_COTACAO[c.status]
                  const total = c.convites?.length || 0
                  const vencida = c.status === 'enviada' && c.prazo_resposta && new Date(c.prazo_resposta) < new Date()
                  return (
                    <tr key={c.id} className="clicavel" onClick={() => navigate(`/cotacoes/${c.id}`)}>
                      <td>
                        <div className="painel-tit">{c.titulo}</div>
                        <div className="painel-sub mono">{numeroCotacao(c.numero)} · {formatarData(c.created_at, false)}</div>
                      </td>
                      <td>{vencida ? <Badge cor="laranja">prazo vencido</Badge> : <Badge cor={st.cor}>{st.rotulo}</Badge>}</td>
                      <td className="mono">{c.qtdPropostas}/{total}</td>
                      <td>
                        {c.vencedor
                          ? <span className="painel-venc">🏆 {c.vencedor.fornecedor_nome}</span>
                          : c.qtdPropostas > 0
                            ? <span className="texto-suave">nenhuma proposta completa</span>
                            : <span className="texto-suave">aguardando</span>}
                      </td>
                      <td className="num"><strong>{c.vencedor ? formatarMoeda(c.vencedor.total) : '—'}</strong></td>
                      <td className="num">
                        {c.economia > 0
                          ? <span className="painel-eco">{formatarMoeda(c.economia)} <small>({c.economiaPct.toFixed(0)}%)</small></span>
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vazio && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="vazio">
            <div className="icone">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="M9 12h6M9 16h4" />
              </svg>
            </div>
            <h2>Comece sua primeira cotação</h2>
            <p>Cadastre seus fornecedores, monte a lista de produtos e dispare. Os preços caem aqui, já comparados.</p>
            <Link to={n.fornecedores ? '/cotacoes/nova' : '/fornecedores'} className="btn btn-primario">
              {n.fornecedores ? 'Criar cotação' : 'Cadastrar fornecedores'}
            </Link>
          </div>
        </div>
      )}

      {vazio && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Como funciona</h3>
          <div className="passos">
            <div className="passo">
              <div className="num">1</div>
              <div><strong>Monte a cotação</strong><p>Produtos e quantidades, em poucos cliques.</p></div>
            </div>
            <div className="passo">
              <div className="num">2</div>
              <div><strong>Envie aos fornecedores</strong><p>Cada um recebe um link. Sem cadastro, sem senha.</p></div>
            </div>
            <div className="passo">
              <div className="num">3</div>
              <div><strong>Compare e decida</strong><p>Menor preço por item e no total, lado a lado.</p></div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
