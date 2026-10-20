import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STATUS_COTACAO, numeroCotacao, formatarData } from '../lib/format'
import Badge from '../components/Badge'

const ABAS = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'rascunho', rotulo: 'Rascunhos' },
  { id: 'enviada', rotulo: 'Abertas' },
  { id: 'encerrada', rotulo: 'Encerradas' },
]

export default function Cotacoes() {
  const navigate = useNavigate()
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [aba, setAba] = useState('todas')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    supabase
      .from('cotacoes')
      .select('id, numero, titulo, status, prazo_resposta, created_at, cotacao_itens(count), convites(status)')
      .order('numero', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error(error)
        setLista(data || [])
        setCarregando(false)
      })
  }, [])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((c) =>
      (aba === 'todas' || c.status === aba) &&
      (!q || c.titulo.toLowerCase().includes(q) || numeroCotacao(c.numero).includes(q))
    )
  }, [lista, aba, busca])

  return (
    <>
      <div className="titulo-pagina">
        <div>
          <h1>Cotações</h1>
          <div className="subtitulo">Peça preços aos seus fornecedores, compare e escolha o melhor.</div>
        </div>
        <Link to="/cotacoes/nova" className="btn btn-primario">+ Nova cotação</Link>
      </div>

      {lista.length > 0 && (
        <div className="barra">
          <div className="abas">
            {ABAS.map((a) => (
              <button key={a.id} className={aba === a.id ? 'ativo' : ''} onClick={() => setAba(a.id)}>
                {a.rotulo}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Buscar cotação..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      )}

      {carregando ? (
        <div className="card">Carregando...</div>
      ) : lista.length === 0 ? (
        <div className="card">
          <div className="vazio">
            <div className="icone">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" /><path d="M12 11v6M9 14h6" /></svg>
            </div>
            <h2>Nenhuma cotação ainda</h2>
            <p>Liste os produtos e quantidades. Depois é só escolher os fornecedores e mandar o link.</p>
            <Link to="/cotacoes/nova" className="btn btn-primario">Criar primeira cotação</Link>
          </div>
        </div>
      ) : filtradas.length === 0 ? (
        <div className="card texto-suave">Nenhuma cotação nesse filtro.</div>
      ) : (
        <div className="lista">
          {filtradas.map((c) => {
            const st = STATUS_COTACAO[c.status] || STATUS_COTACAO.rascunho
            const total = c.convites?.length || 0
            const resp = (c.convites || []).filter((v) => v.status === 'respondido').length
            const itens = c.cotacao_itens?.[0]?.count || 0
            const vencida = c.status === 'enviada' && c.prazo_resposta && new Date(c.prazo_resposta) < new Date()
            return (
              <div key={c.id} className="lista-item clicavel" onClick={() => navigate(`/cotacoes/${c.id}`)}>
                <div className="principal">
                  <div className="titulo">{c.titulo}</div>
                  <div className="meta">
                    <span className="mono">{numeroCotacao(c.numero)}</span>
                    <span>{itens} {itens === 1 ? 'item' : 'itens'}</span>
                    <span>criada {formatarData(c.created_at, false)}</span>
                    {c.prazo_resposta && <span>prazo {formatarData(c.prazo_resposta)}</span>}
                  </div>
                </div>
                {total > 0 && (
                  <div className="progresso" title={`${resp} de ${total} responderam`}>
                    <div className="barra-fundo">
                      <div className="barra-cheia" style={{ width: `${(resp / total) * 100}%` }} />
                    </div>
                    <div className="txt">{resp}/{total} respostas</div>
                  </div>
                )}
                {vencida ? <Badge cor="laranja">prazo vencido</Badge> : <Badge cor={st.cor}>{st.rotulo}</Badge>}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
