import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, SCHEMA } from '../lib/supabase'
import { STATUS_ORCAMENTO, numeroCotacao, formatarData, formatarMoeda } from '../lib/format'
import Badge from '../components/Badge'

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
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [aba, setAba] = useState('todos')
  const [busca, setBusca] = useState('')
  const [pedidos, setPedidos] = useState([])
  const [verTodosPedidos, setVerTodosPedidos] = useState(false)

  useEffect(() => {
    const carregar = () => supabase
      .from('orcamentos')
      .select('id, numero, status, cliente_nome, referencia, origem, frete, desconto, created_at, enviado_em, visualizado_em, visualizacoes, aprovado_em, orcamento_itens(quantidade, preco_unitario)')
      .order('numero', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error(error)
        setLista(data || [])
        setCarregando(false)
      })
    carregar()
    supabase.rpc('pedidos_recebidos').then(({ data }) => setPedidos(data || []))
    // tempo real: cliente abriu ou aprovou
    const canal = supabase.channel('orcamentos-lista')
      .on('postgres_changes', { event: 'UPDATE', schema: SCHEMA, table: 'orcamentos' }, carregar)
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((o) =>
      (aba === 'todos' || o.status === aba) &&
      (!q || (o.cliente_nome || '').toLowerCase().includes(q) || (o.referencia || '').toLowerCase().includes(q) || numeroCotacao(o.numero).includes(q)))
  }, [lista, aba, busca])

  const aprovadosValor = lista.filter((o) => o.status === 'aprovado').reduce((s, o) => s + totalDe(o), 0)

  return (
    <>
      <div className="titulo-pagina">
        <div>
          <h1>Clientes</h1>
          <div className="subtitulo">Orçamentos que você envia aos seus clientes. Recebeu um pedido por WhatsApp, PDF ou foto? Responda em minutos.</div>
        </div>
        <Link to="/orcamentos/novo" className="btn btn-primario">+ Novo orçamento</Link>
      </div>

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
          <input className="input" placeholder="Buscar cliente ou número..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      )}

      {carregando ? (
        <div className="card">Carregando...</div>
      ) : lista.length === 0 && pedidos.length > 0 ? (
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
                  <div className="titulo">{o.cliente_nome || 'Cliente não informado'}{o.referencia ? ` · ${o.referencia}` : ''}</div>
                  <div className="meta">
                    <span className="mono">{numeroCotacao(o.numero)}</span>
                    <span>{n} {n === 1 ? 'item' : 'itens'}</span>
                    <span>{formatarData(o.created_at, false)}</span>
                    {o.status === 'enviado' && (o.visualizado_em
                      ? <span className="ok">cliente abriu {o.visualizacoes > 1 ? `${o.visualizacoes}×` : ''}</span>
                      : <span>ainda não aberto</span>)}
                    {o.aprovado_em && <span className="ok">aprovado em {formatarData(o.aprovado_em)}</span>}
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
