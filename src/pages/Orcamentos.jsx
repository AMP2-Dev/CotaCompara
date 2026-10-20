import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, SCHEMA, APP_URL, mensagemErro } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { STATUS_ORCAMENTO, numeroCotacao, formatarData, formatarMoeda, copiarTexto, linkWhatsApp } from '../lib/format'
import Badge from '../components/Badge'
import { IconeWhats, IconeLink } from '../components/Icones'

const ABAS = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'rascunho', rotulo: 'Rascunhos' },
  { id: 'enviado', rotulo: 'Enviados' },
  { id: 'aprovado', rotulo: 'Aprovados' },
]

// pedido ainda aceita resposta (ou correção liberada)
const pedidoAberto = (p) => p.cotacao.aberta && (!p.respondido_em || p.pode_corrigir)

const totalDe = (o) => {
  const sub = (o.orcamento_itens || []).reduce((s, i) => s + (i.preco_unitario == null ? 0 : Math.round(i.quantidade * i.preco_unitario * 100) / 100), 0)
  return Math.max(sub - Number(o.desconto || 0), 0) + Number(o.frete || 0)
}

// Lista dos orçamentos que a empresa enviou (lado fornecedor)
export default function Orcamentos() {
  const navigate = useNavigate()
  const { empresa, recarregarEmpresa } = useAuth()
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [aba, setAba] = useState('todos')
  const [busca, setBusca] = useState('')
  const [pedidos, setPedidos] = useState([])
  const [verTodosPedidos, setVerTodosPedidos] = useState(false)

  // Pedidos pelo link
  const [pedidosLink, setPedidosLink] = useState([])
  const [itemAbertoId, setItemAbertoId] = useState(null)
  const [acaoId, setAcaoId] = useState(null)
  const [copiadoLink, setCopiadoLink] = useState(false)
  const [aviso, setAviso] = useState('')

  // Informações do link da empresa
  const [linkToken, setLinkToken] = useState(empresa?.pedido_link_token || '')
  const [linkAtivo, setLinkAtivo] = useState(empresa?.pedido_link_ativo ?? true)

  useEffect(() => {
    if (empresa) {
      setLinkToken(empresa.pedido_link_token || '')
      setLinkAtivo(empresa.pedido_link_ativo ?? true)
    }
  }, [empresa])

  const carregarPedidosLink = async () => {
    const { data } = await supabase
      .from('pedidos_link')
      .select('*')
      .eq('status', 'pendente')
      .order('created_at', { ascending: false })
    setPedidosLink(data || [])
  }

  useEffect(() => {
    const carregar = () => supabase
      .from('orcamentos')
      .select('id, numero, status, cliente_nome, referencia, origem, frete, desconto, created_at, enviado_em, visualizado_em, visualizacoes, aprovado_em, aprovacao_codigo, orcamento_itens(quantidade, preco_unitario)')
      .order('numero', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error(error)
        setLista(data || [])
        setCarregando(false)
      })

    carregar()
    carregarPedidosLink()
    supabase.rpc('pedidos_recebidos').then(({ data }) => setPedidos(data || []))

    // tempo real: cliente abriu ou aprovou orçamento
    const canalOrc = supabase.channel('orcamentos-lista')
      .on('postgres_changes', { event: 'UPDATE', schema: SCHEMA, table: 'orcamentos' }, carregar)
      .subscribe()

    // tempo real: novos pedidos chegados pelo link
    const canalPedLink = supabase.channel('pedidos-link-lista')
      .on('postgres_changes', { event: '*', schema: SCHEMA, table: 'pedidos_link' }, carregarPedidosLink)
      .subscribe()

    return () => {
      supabase.removeChannel(canalOrc)
      supabase.removeChannel(canalPedLink)
    }
  }, [])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((o) =>
      (aba === 'todos' || o.status === aba) &&
      (!q || (o.cliente_nome || '').toLowerCase().includes(q) || (o.referencia || '').toLowerCase().includes(q) || numeroCotacao(o.numero).includes(q) || (o.aprovacao_codigo || '').toLowerCase().includes(q)))
  }, [lista, aba, busca])

  const aprovadosValor = lista.filter((o) => o.status === 'aprovado').reduce((s, o) => s + totalDe(o), 0)

  const urlPedidoLink = linkToken ? `${APP_URL}/p/${linkToken}` : ''

  const copiarUrlLink = async () => {
    if (!urlPedidoLink) return
    await copiarTexto(urlPedidoLink)
    setCopiadoLink(true)
    setTimeout(() => setCopiadoLink(false), 2500)
  }

  const compartilharWhats = () => {
    if (!urlPedidoLink) return
    const txt = `Olá! Para solicitar um orçamento para a ${empresa?.nome || 'nossa empresa'}, basta acessar o link abaixo e montar seu pedido:\n${urlPedidoLink}`
    const wUrl = `https://wa.me/?text=${encodeURIComponent(txt)}`
    window.open(wUrl, '_blank')
  }

  const alternarLinkAtivo = async () => {
    if (!empresa?.id) return
    const novoStatus = !linkAtivo
    setLinkAtivo(novoStatus)
    const { error } = await supabase.from('empresas').update({ pedido_link_ativo: novoStatus }).eq('id', empresa.id)
    if (error) {
      setAviso(mensagemErro(error))
      setLinkAtivo(!novoStatus)
    } else {
      recarregarEmpresa?.()
      setAviso(novoStatus ? 'Link de pedidos ativado com sucesso.' : 'Link de pedidos desativado temporariamente.')
      setTimeout(() => setAviso(''), 4000)
    }
  }

  const gerarNovoLink = async () => {
    if (!window.confirm('Tem certeza de que deseja gerar um novo link de pedidos? O link anterior deixará de funcionar imediatamente.')) {
      return
    }
    const { data: novoToken, error } = await supabase.rpc('novo_link_pedido')
    if (error) {
      setAviso(mensagemErro(error))
    } else {
      setLinkToken(novoToken)
      setLinkAtivo(true)
      recarregarEmpresa?.()
      setAviso('Novo link de pedidos gerado com sucesso!')
      setTimeout(() => setAviso(''), 4000)
    }
  }

  const aceitarPedido = async (pedId) => {
    setAcaoId(pedId)
    setAviso('')
    const { data: orcId, error } = await supabase.rpc('aceitar_pedido_link', { p_id: pedId })
    setAcaoId(null)
    if (error) {
      setAviso(mensagemErro(error))
    } else if (orcId) {
      navigate(`/orcamentos/${orcId}`)
    }
  }

  const recusarPedido = async (pedId) => {
    if (!window.confirm('Deseja recusar este pedido recebido pelo link?')) return
    setAcaoId(pedId)
    const { error } = await supabase.rpc('recusar_pedido_link', { p_id: pedId })
    setAcaoId(null)
    if (error) {
      setAviso(mensagemErro(error))
    } else {
      carregarPedidosLink()
    }
  }

  return (
    <>
      <div className="titulo-pagina">
        <div>
          <h1>Clientes</h1>
          <div className="subtitulo">Orçamentos que você envia aos seus clientes. Recebeu um pedido por WhatsApp, PDF ou foto? Responda em minutos.</div>
        </div>
        <Link to="/orcamentos/novo" className="btn btn-primario">+ Novo orçamento</Link>
      </div>

      {aviso && <div className="alerta alerta-info" style={{ marginBottom: 16 }}>{aviso}</div>}

      {/* Card Seu link de pedidos */}
      <div className="card card-link-pedidos" style={{ marginBottom: 16 }}>
        <div className="link-pedidos-topo">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0 }}>🔗 Seu link de pedidos</h3>
              <Badge cor={linkAtivo ? 'verde' : 'vermelho'}>{linkAtivo ? 'Ativo' : 'Desativado'}</Badge>
            </div>
            <p className="texto-suave" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Envie para seus clientes no WhatsApp ou coloque na bio do Instagram. Eles escolhem os itens sem precisar de login.
            </p>
          </div>
        </div>

        <div className="link-pedidos-barra">
          <input className="input mono" readOnly value={urlPedidoLink || 'Gerando link...'} style={{ flex: 1 }} />
          <button className="btn btn-secundario btn-pequeno" onClick={copiarUrlLink}>
            <IconeLink /> {copiadoLink ? 'Copiado!' : 'Copiar'}
          </button>
          <button className="btn btn-verde btn-pequeno" onClick={compartilharWhats}>
            <IconeWhats /> WhatsApp
          </button>
          <button className="btn btn-secundario btn-pequeno" onClick={alternarLinkAtivo}>
            {linkAtivo ? 'Desativar link' : 'Ativar link'}
          </button>
          <button className="btn btn-texto btn-pequeno" onClick={gerarNovoLink} title="Invalida o link atual e cria outro">
            Gerar novo
          </button>
        </div>
      </div>

      {/* Pedidos pelo link — aguardando você */}
      {pedidosLink.length > 0 && (
        <div className="card ped-caixa" style={{ marginBottom: 16 }}>
          <div className="secao-topo" style={{ marginBottom: 10 }}>
            <h3>⚡ Pedidos pelo link — aguardando você</h3>
            <span className="badge badge-laranja">{pedidosLink.length} {pedidosLink.length === 1 ? 'pedido' : 'pedidos'}</span>
          </div>

          <div className="pedidos-link-lista">
            {pedidosLink.map((p) => {
              const totalItens = Array.isArray(p.itens) ? p.itens.length : 0
              const aberto = itemAbertoId === p.id
              return (
                <div key={p.id} className="pedido-link-item-painel">
                  <div className="pedido-link-item-header">
                    <div className="principal">
                      <div className="titulo">
                        <b>{p.cliente_nome}</b>
                        <span className="mono destaque-proto" style={{ marginLeft: 8, fontSize: 13 }}>
                          {p.protocolo}
                        </span>
                      </div>
                      <div className="meta">
                        <span>{totalItens} {totalItens === 1 ? 'item' : 'itens'}</span>
                        {p.cliente_whatsapp && <span>WhatsApp: {p.cliente_whatsapp}</span>}
                        {p.cliente_email && <span>E-mail: {p.cliente_email}</span>}
                        <span>recebido em {formatarData(p.created_at)}</span>
                      </div>
                    </div>

                    <div className="pedido-link-acoes">
                      <button
                        className="btn btn-texto btn-pequeno"
                        onClick={() => setItemAbertoId(aberto ? null : p.id)}
                      >
                        {aberto ? 'Ocultar itens ▲' : 'Ver itens ▼'}
                      </button>
                      <button
                        className="btn btn-primario btn-pequeno"
                        disabled={acaoId === p.id}
                        onClick={() => aceitarPedido(p.id)}
                      >
                        {acaoId === p.id ? 'Montando...' : 'Aceitar e montar orçamento'}
                      </button>
                      <button
                        className="btn btn-perigo btn-pequeno"
                        disabled={acaoId === p.id}
                        onClick={() => recusarPedido(p.id)}
                      >
                        Recusar
                      </button>
                    </div>
                  </div>

                  {aberto && (
                    <div className="pedido-link-detalhe-itens">
                      {p.observacoes && (
                        <div className="pedido-obs-bloco">
                          <b>Observações do cliente:</b> {p.observacoes}
                        </div>
                      )}
                      <table className="tabela-mini">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Produto</th>
                            <th className="num">Quantidade</th>
                            <th>Unidade</th>
                            <th>Observação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(p.itens || []).map((it, idx) => (
                            <tr key={idx}>
                              <td>{idx + 1}</td>
                              <td><b>{it.produto}</b></td>
                              <td className="num">{it.quantidade}</td>
                              <td>{it.unidade || 'UN'}</td>
                              <td>{it.observacao || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {pedidos.length > 0 && (
        <div className="card ped-caixa">
          <div className="secao-topo" style={{ marginBottom: 8 }}>
            <h3>📥 Pedidos recebidos <small className="texto-suave">de compradores que usam o CotaCompara</small></h3>
            {pedidos.filter(pedidoAberto).length > 0 && <span className="badge badge-laranja">{pedidos.filter(pedidoAberto).length} para responder</span>}
          </div>
          {(verTodosPedidos ? pedidos : pedidos.slice(0, 5)).map((p) => {
            const aberto = pedidoAberto(p)
            return (
              <div key={p.token} className="lista-item clicavel ped-item" onClick={() => navigate(`/pedidos/${p.token}`)}>
                <div className="principal">
                  <div className="titulo">{p.comprador.nome} · {p.cotacao.titulo}</div>
                  <div className="meta">
                    <span className="mono">{numeroCotacao(p.cotacao.numero)}</span>
                    <span>{p.cotacao.itens} {p.cotacao.itens === 1 ? 'item' : 'itens'}</span>
                    {p.comprador.cidade && <span>{p.comprador.cidade}/{p.comprador.uf}</span>}
                    <span>recebido {formatarData(p.recebido_em)}</span>
                    {aberto && p.cotacao.prazo_resposta && <span>responder até {formatarData(p.cotacao.prazo_resposta)}</span>}
                  </div>
                </div>
                {aberto ? <span className="btn btn-primario btn-pequeno">{p.pode_corrigir ? 'Corrigir' : 'Responder'}</span>
                  : p.respondido_em ? <Badge cor={p.cotacao.status === 'encerrada' ? '' : 'verde'}>{p.cotacao.status === 'encerrada' ? 'Encerrada' : 'Respondido'}</Badge>
                  : <Badge>{p.cotacao.status === 'encerrada' ? 'Encerrada' : 'Prazo encerrado'}</Badge>}
              </div>
            )
          })}
          {pedidos.length > 5 && <button className="btn btn-texto btn-pequeno" onClick={() => setVerTodosPedidos(!verTodosPedidos)}>{verTodosPedidos ? 'Ver menos' : `Ver todos (${pedidos.length})`}</button>}
        </div>
      )}

      {lista.length > 0 && (
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <div className="card stat"><div className="rotulo">Orçamentos enviados</div><div className="valor">{lista.filter((o) => o.status !== 'rascunho').length}</div></div>
          <div className="card stat"><div className="rotulo">Aprovados</div><div className="valor">{lista.filter((o) => o.status === 'aprovado').length}</div></div>
          <div className="card stat"><div className="rotulo">Valor aprovado</div><div className="valor" style={{ fontSize: 26 }}>{formatarMoeda(aprovadosValor)}</div></div>
        </div>
      )}

      {lista.length > 0 && (
        <div className="barra">
          <div className="abas">
            {ABAS.map((a) => (
              <button key={a.id} className={aba === a.id ? 'ativo' : ''} onClick={() => setAba(a.id)}>{a.rotulo}</button>
            ))}
          </div>
          <input className="input" placeholder="Buscar cliente, número ou código APV..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      )}

      {carregando ? (
        <div className="card">Carregando...</div>
      ) : lista.length === 0 && (pedidos.length > 0 || pedidosLink.length > 0) ? (
        <div className="card texto-suave">Você ainda não enviou orçamentos por conta própria. Recebeu um pedido por WhatsApp, PDF ou foto? <Link to="/orcamentos/novo">Responda aqui</Link>.</div>
      ) : lista.length === 0 ? (
        <div className="card">
          <div className="vazio">
            <div className="icone">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
            </div>
            <h2>Responda pedidos de orçamento sem digitar tudo</h2>
            <p>Cole a mensagem do WhatsApp, envie o PDF ou uma foto da lista. O CotaCompara monta a tabela,
              você coloca os preços e envia um orçamento profissional com os dados da sua empresa.</p>
            <Link to="/orcamentos/novo" className="btn btn-primario">Fazer meu primeiro orçamento</Link>
          </div>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="card texto-suave">Nenhum orçamento nesse filtro.</div>
      ) : (
        <div className="lista">
          {filtrados.map((o) => {
            const st = STATUS_ORCAMENTO[o.status] || STATUS_ORCAMENTO.rascunho
            const n = o.orcamento_itens?.length || 0
            return (
              <div key={o.id} className="lista-item clicavel" onClick={() => navigate(`/orcamentos/${o.id}`)}>
                <div className="principal">
                  <div className="titulo">
                    {o.cliente_nome || 'Cliente não informado'}
                    {o.referencia ? ` · ${o.referencia}` : ''}
                    {o.aprovacao_codigo && (
                      <span className="mono destaque-proto" style={{ marginLeft: 8, fontSize: 12 }}>
                        {o.aprovacao_codigo}
                      </span>
                    )}
                  </div>
                  <div className="meta">
                    <span className="mono">{numeroCotacao(o.numero)}</span>
                    <span>{n} {n === 1 ? 'item' : 'itens'}</span>
                    <span>{formatarData(o.created_at, false)}</span>
                    {o.status === 'enviado' && (o.visualizado_em
                      ? <span className="ok">cliente abriu {o.visualizacoes > 1 ? `${o.visualizacoes}×` : ''}</span>
                      : <span>ainda não aberto</span>)}
                    {o.aprovado_em && (
                      <span className="ok">
                        aprovado em {formatarData(o.aprovado_em)} {o.aprovacao_codigo ? `(${o.aprovacao_codigo})` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="orc-total">{formatarMoeda(totalDe(o))}</div>
                <Badge cor={st.cor}>{st.rotulo}</Badge>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
