import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase, mensagemErro, APP_URL } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  UNIDADES, STATUS_ORCAMENTO, formatarQtd, formatarMoeda, parseNumero, numeroCotacao, formatarData,
  linkWhatsApp, emailValido, copiarTexto, soDigitos,
} from '../lib/format'
import { lerItens, buscarNoCatalogo } from '../lib/leitorItens'
import { lerArquivo, tipoArquivo } from '../lib/leitorArquivos'
import { cnpjValido, consultarCnpj, mascaraCnpj, mascaraCpf, nomeExibicao } from '../lib/cnpj'
import Badge from '../components/Badge'
import CarimboAprovacao from '../components/CarimboAprovacao'
import { IconeLixo, IconeVoltar, IconeWhats, IconeLink, IconeEmail } from '../components/Icones'

let seq = 0
const novoItem = (d = {}) => ({ key: ++seq, produto: '', quantidade: '', unidade: 'UN', preco: '', observacao: '', conferir: false, sugestao: null, doCatalogo: false, ...d })
const precoTexto = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }))
const ORIGEM = { texto: 'texto colado', pdf: 'PDF', imagem: 'foto', planilha: 'planilha', manual: 'digitado', link: 'pedido pelo link' }

export default function OrcamentoEditar() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const copia = !id ? location.state?.copia : null
  const { empresa, recarregarEmpresa } = useAuth()
  const padrao = empresa?.orc_padrao || {}

  const [orc, setOrc] = useState(null) // registro salvo (id, numero, token, status...)
  const [cliente, setCliente] = useState({ nome: '', documento: '', whatsapp: '', email: '', referencia: '' })
  const [cond, setCond] = useState(copia?.cond || {
    validade: String(padrao.validade_dias || 7), prazo: padrao.prazo_entrega || '', pagamento: padrao.condicao_pagamento || '',
    frete: padrao.frete != null ? precoTexto(padrao.frete) : '', desconto: '', obs: padrao.observacoes || '',
  })
  const [salvarPadrao, setSalvarPadrao] = useState(false)
  const [itens, setItens] = useState(() => (copia?.itens || []).map((i) => novoItem(i)))
  const [origem, setOrigem] = useState('manual')
  const [textoOriginal, setTextoOriginal] = useState('')
  const [catalogo, setCatalogo] = useState([])

  // importação
  const [modo, setModo] = useState('texto') // texto | arquivo
  const [colado, setColado] = useState('')
  const [lendo, setLendo] = useState(null) // {etapa, pct}
  const [resumo, setResumo] = useState(null)
  const [arrastando, setArrastando] = useState(false)
  const [importarAberto, setImportarAberto] = useState(!id && !copia)
  const [verOriginal, setVerOriginal] = useState(false)
  const inputArquivo = useRef(null)

  const [carregando, setCarregando] = useState(!!id)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState(copia ? 'Cópia criada: confira o cliente e salve.' : '')
  const [docBusca, setDocBusca] = useState('')
  const [noPainel, setNoPainel] = useState(false)

  const travado = orc?.status === 'aprovado'

  // catálogo do fornecedor (para sugerir nome e último preço)
  useEffect(() => {
    supabase.from('catalogo_produtos').select('id, nome, chave, unidade, ultimo_preco, vezes').order('vezes', { ascending: false }).limit(3000)
      .then(({ data }) => setCatalogo(data || []))
  }, [])

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const { data: o, error } = await supabase.from('orcamentos').select('*, orcamento_itens(*)').eq('id', id).maybeSingle()
      if (error || !o) { setErro('Orçamento não encontrado.'); setCarregando(false); return }
      setOrc(o)
      setCliente({ nome: o.cliente_nome || '', documento: o.cliente_documento || '', whatsapp: o.cliente_whatsapp || '', email: o.cliente_email || '', referencia: o.referencia || '' })
      setCond({
        validade: String(o.validade_dias || 7), prazo: o.prazo_entrega || '', pagamento: o.condicao_pagamento || '',
        frete: o.frete != null ? precoTexto(o.frete) : '', desconto: Number(o.desconto) ? precoTexto(o.desconto) : '', obs: o.observacoes || '',
      })
      setOrigem(o.origem || 'manual')
      setTextoOriginal(o.texto_original || '')
      const its = (o.orcamento_itens || []).sort((a, b) => a.ordem - b.ordem)
      setItens(its.map((i) => novoItem({ produto: i.produto, quantidade: formatarQtd(i.quantidade), unidade: i.unidade, preco: precoTexto(i.preco_unitario), observacao: i.observacao || '' })))
      setCarregando(false)
    })()
  }, [id])

  // ------------------------------------------------------------ leitura
  const aplicarLeitura = (lidos, org, texto) => {
    if (!lidos.length) {
      setResumo({ erro: true, texto: 'Não encontrei itens nesse material. Confira se a lista está legível — ou digite os itens abaixo.' })
      return
    }
    let comPreco = 0, precoDoTexto = 0
    const novos = lidos.map((l) => {
      const achado = buscarNoCatalogo(l.produto, catalogo)
      // preço que veio escrito no próprio pedido tem prioridade sobre o catálogo
      if (l.preco != null) {
        precoDoTexto++
        return novoItem({
          produto: achado?.exato ? achado.item.nome : l.produto, quantidade: formatarQtd(l.quantidade),
          unidade: l.unidade !== 'UN' ? l.unidade : (achado?.exato && achado.item.unidade) || 'UN',
          preco: precoTexto(l.preco), conferir: l.conferir, sugestao: achado && !achado.exato ? achado.item : null,
        })
      }
      if (achado?.exato) {
        if (achado.item.ultimo_preco != null) comPreco++
        return novoItem({
          produto: achado.item.nome, quantidade: formatarQtd(l.quantidade), unidade: l.unidade !== 'UN' ? l.unidade : achado.item.unidade || 'UN',
          preco: precoTexto(achado.item.ultimo_preco), conferir: l.conferir, doCatalogo: achado.item.ultimo_preco != null,
        })
      }
      return novoItem({ produto: l.produto, quantidade: formatarQtd(l.quantidade), unidade: l.unidade, conferir: l.conferir, sugestao: achado ? achado.item : null })
    })
    setItens((atual) => [...atual.filter((i) => i.produto.trim()), ...novos])
    setOrigem((o) => (o === 'manual' ? org : o))
    setTextoOriginal((t) => [t, texto].filter(Boolean).join('\n\n----\n\n').slice(0, 20000))
    const conferir = lidos.filter((l) => l.conferir).length
    setResumo({
      texto: `Encontrei ${lidos.length} ${lidos.length === 1 ? 'item' : 'itens'}` +
        (conferir ? ` · ${conferir} sem quantidade (marquei em amarelo para conferir)` : '') +
        (precoDoTexto ? ` · ${precoDoTexto} com o preço que veio no texto` : '') +
        (comPreco ? ` · ${comPreco} já com o preço do seu último orçamento` : '') + '.',
    })
    setImportarAberto(false)
    setColado('')
  }

  const interpretarTexto = () => {
    if (!colado.trim()) return
    const lidos = lerItens(colado)
    aplicarLeitura(lidos, 'texto', colado)
  }

  const processarArquivo = async (file) => {
    if (!file) return
    const tipo = tipoArquivo(file)
    if (!tipo) {
      setResumo({ erro: true, texto: 'Envie um arquivo PDF, foto (JPG/PNG) ou planilha (Excel/CSV).' })
      return
    }
    setLendo({ etapa: 'Lendo arquivo...', pct: 5 })
    try {
      const { texto, origem: org, ocr } = await lerArquivo(file, (p) => setLendo(p))
      setLendo({ etapa: 'Identificando itens...', pct: 95 })
      const lidos = lerItens(texto)
      setLendo(null)
      aplicarLeitura(lidos, org, (ocr ? `[Lido por imagem: ${file.name}]\n` : `[Arquivo: ${file.name}]\n`) + texto)
    } catch (e) {
      console.error(e)
      setLendo(null)
      setResumo({ erro: true, texto: 'Não consegui ler este arquivo: ' + (e.message || 'formato não suportado') + '. Tente copiar o texto e colar na aba "Colar texto".' })
    }
  }

  // ------------------------------------------------------------ itens
  const alterar = (key, campo, valor) => {
    if (travado) return
    setItens((its) => its.map((i) => (i.key === key ? { ...i, [campo]: valor } : i)))
  }
  const remover = (key) => {
    if (travado) return
    setItens((its) => its.filter((i) => i.key !== key))
  }
  const adicionar = () => {
    if (travado) return
    setItens((its) => [...its, novoItem()])
  }

  const aoSairProduto = (item) => {
    if (travado) return
    if (!item.produto.trim()) return
    const achado = buscarNoCatalogo(item.produto, catalogo)
    if (!achado) return
    if (achado.exato) {
      setItens((its) => its.map((i) => {
        if (i.key !== item.key) return i
        return {
          ...i,
          produto: achado.item.nome,
          unidade: i.unidade !== 'UN' ? i.unidade : achado.item.unidade || 'UN',
          preco: i.preco ? i.preco : achado.item.ultimo_preco != null ? precoTexto(achado.item.ultimo_preco) : '',
          doCatalogo: !i.preco && achado.item.ultimo_preco != null,
          sugestao: null,
        }
      }))
    } else {
      alterar(item.key, 'sugestao', achado.item)
    }
  }

  const usarSugestao = (item) => {
    if (travado) return
    const s = item.sugestao
    if (!s) return
    setItens((its) => its.map((i) => (i.key === item.key ? {
      ...i, produto: s.nome, unidade: s.unidade || i.unidade,
      preco: s.ultimo_preco != null ? precoTexto(s.ultimo_preco) : i.preco,
      doCatalogo: s.ultimo_preco != null, sugestao: null,
    } : i)))
  }

  const formatarPreco = (item) => {
    if (travado) return
    const p = parseNumero(item.preco)
    if (Number.isFinite(p) && p >= 0) alterar(item.key, 'preco', precoTexto(p))
  }

  // ------------------------------------------------------------ totais
  const totais = useMemo(() => {
    let sub = 0, semPreco = 0
    itens.forEach((i) => {
      const q = parseNumero(i.quantidade), p = parseNumero(i.preco)
      if (Number.isFinite(q) && Number.isFinite(p)) sub += Math.round(q * p * 100) / 100
      else if (i.produto.trim()) semPreco++
    })
    const frete = cond.frete.trim() ? parseNumero(cond.frete) : 0
    const desc = cond.desconto.trim() ? parseNumero(cond.desconto) : 0
    const total = Math.max(sub - (Number.isFinite(desc) ? desc : 0), 0) + (Number.isFinite(frete) ? frete : 0)
    return { sub, semPreco, frete: Number.isFinite(frete) ? frete : 0, desc: Number.isFinite(desc) ? desc : 0, total }
  }, [itens, cond.frete, cond.desconto])

  // ------------------------------------------------------------ salvar e enviar
  const buscarDoc = async () => {
    const limpo = soDigitos(cliente.documento)
    if (limpo.length !== 14 || !cnpjValido(limpo)) return
    setDocBusca('buscando')
    try {
      const dados = await consultarCnpj(limpo)
      const nome = nomeExibicao(dados)
      if (nome && !cliente.nome) setCliente((c) => ({ ...c, nome }))
      if (dados.email && !cliente.email) setCliente((c) => ({ ...c, email: dados.email }))
      if (dados.telefone && !cliente.whatsapp) setCliente((c) => ({ ...c, whatsapp: dados.telefone }))
      setDocBusca('')
    } catch { setDocBusca('') }
  }

  const salvar = async () => {
    setErro(''); setOk('')
    if (travado) {
      setErro('Orçamento aprovado não pode ser alterado. Duplique para fazer outro.')
      return null
    }
    const validos = itens.filter((i) => i.produto.trim())
    if (validos.length === 0) { setErro('Informe pelo menos um item.'); return null }
    for (const i of validos) {
      const q = parseNumero(i.quantidade)
      if (!Number.isFinite(q) || q <= 0) { setErro(`Informe a quantidade do item "${i.produto}".`); return null }
    }
    const validade = Math.round(parseNumero(cond.validade))
    if (!Number.isFinite(validade) || validade < 1 || validade > 365) { setErro('Validade deve ser entre 1 e 365 dias.'); return null }
    if (cliente.email.trim() && !emailValido(cliente.email)) { setErro('E-mail do cliente inválido.'); return null }

    const frete = cond.frete.trim() ? parseNumero(cond.frete) : null
    const desconto = cond.desconto.trim() ? parseNumero(cond.desconto) : 0
    if ((frete != null && !(frete >= 0)) || !(desconto >= 0)) { setErro('Confira os valores de frete e desconto.'); return null }

    const dados = {
      cliente_nome: cliente.nome.trim() || null, cliente_documento: cliente.documento.trim() || null,
      cliente_whatsapp: cliente.whatsapp.trim() || null, cliente_email: cliente.email.trim() || null,
      referencia: cliente.referencia.trim() || null, origem,
      validade_dias: validade, prazo_entrega: cond.prazo.trim() || null, condicao_pagamento: cond.pagamento.trim() || null,
      frete, desconto, observacoes: cond.obs.trim() || null, texto_original: textoOriginal || null,
    }
    setSalvando(true)
    let registro = orc
    if (orc) {
      const { data, error } = await supabase.from('orcamentos').update(dados).eq('id', orc.id).select().single()
      if (error) { setSalvando(false); setErro(mensagemErro(error)); return null }
      registro = data
      const { error: e2 } = await supabase.from('orcamento_itens').delete().eq('orcamento_id', orc.id)
      if (e2) { setSalvando(false); setErro('Erro ao atualizar itens: ' + e2.message); return null }
    } else {
      const { data, error } = await supabase.from('orcamentos').insert({ ...dados, empresa_id: empresa.id }).select().single()
      if (error) { setSalvando(false); setErro(mensagemErro(error)); return null }
      registro = data
    }
    const linhas = validos.map((i, ordem) => {
      const p = parseNumero(i.preco)
      return {
        orcamento_id: registro.id, ordem, produto: i.produto.trim(), quantidade: parseNumero(i.quantidade),
        unidade: i.unidade || 'UN', preco_unitario: i.preco.trim() && Number.isFinite(p) ? p : null, observacao: i.observacao.trim() || null,
      }
    })
    const { error: e3 } = await supabase.from('orcamento_itens').insert(linhas)
    if (e3) { setSalvando(false); setErro('Erro ao salvar itens: ' + e3.message); return null }

    if (salvarPadrao) {
      const novoPadrao = { validade_dias: validade, prazo_entrega: dados.prazo_entrega, condicao_pagamento: dados.condicao_pagamento, frete, observacoes: dados.observacoes }
      await supabase.from('empresas').update({ orc_padrao: novoPadrao }).eq('id', empresa.id)
      recarregarEmpresa?.()
      setSalvarPadrao(false)
    }
    setOrc(registro)
    setSalvando(false)
    // troca o endereço sem recarregar a tela (mantém mensagens e o envio em andamento)
    if (!orc) window.history.replaceState(window.history.state, '', `/orcamentos/${registro.id}`)
    return registro
  }

  const link = (r) => `${APP_URL}/o/${r.token}`

  const registrarEnvio = async (r) => {
    const { data, error } = await supabase.rpc('registrar_envio_orcamento', { p_id: r.id })
    if (data?.no_painel_do_cliente) setNoPainel(true)
    if (!error) setOrc((o) => ({ ...(o || r), status: (o || r).status === 'rascunho' ? 'enviado' : (o || r).status, enviado_em: (o || r).enviado_em || new Date().toISOString() }))
  }

  const mensagem = (r) => {
    const nome = cliente.nome.trim()
    return `Olá${nome ? ' ' + nome : ''}! Segue o orçamento ${numeroCotacao(r.numero)} da ${empresa?.nome}` +
      `${cliente.referencia.trim() ? ` (${cliente.referencia.trim()})` : ''}.\n\nTotal: ${formatarMoeda(totais.total)}` +
      `\nVálido por ${cond.validade} dias.\n\nVeja os itens, baixe em PDF e aprove pelo link:\n${link(r)}`
  }

  // a janela do WhatsApp/PDF precisa abrir no clique (antes do await), senão o navegador bloqueia
  const abrirDepois = async (montarUrl) => {
    if (travado) {
      window.open(montarUrl(orc), '_blank')
      return
    }
    const janela = window.open('', '_blank')
    const r = await salvar()
    if (!r) { janela?.close(); return }
    await registrarEnvio(r)
    const url = montarUrl(r)
    if (janela) janela.location.href = url; else window.location.href = url
  }

  const enviarWhats = () => abrirDepois((r) => linkWhatsApp(cliente.whatsapp, mensagem(r)) || `https://wa.me/?text=${encodeURIComponent(mensagem(r))}`)
  const abrirPdf = () => abrirDepois((r) => `${link(r)}?imprimir=1`)
  const copiarLink = async () => {
    const r = travado ? orc : await salvar()
    if (!r) return
    if (!travado) await registrarEnvio(r)
    await copiarTexto(mensagem(r))
    setOk('Mensagem com o link copiada. É só colar no WhatsApp, Telegram ou e-mail.')
  }
  const enviarEmail = async () => {
    if (!emailValido(cliente.email)) { setErro('Informe o e-mail do cliente para enviar.'); return }
    const r = travado ? orc : await salvar()
    if (!r) return
    setSalvando(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/enviar-orcamento', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ orcamento_id: r.id }),
      })
      const j = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(j.erro || 'Falha ao enviar o e-mail.')
      if (!travado) await registrarEnvio(r)
      setOk(`Orçamento enviado para ${cliente.email}.`)
    } catch (e) { setErro(e.message) } finally { setSalvando(false) }
  }

  const mudarStatus = async (status) => {
    const { data, error } = await supabase.from('orcamentos').update({ status }).eq('id', orc.id).select().single()
    if (error) return setErro(mensagemErro(error))
    setOrc(data)
  }

  const duplicar = () => {
    const copiaItens = itens.filter((i) => i.produto.trim()).map(({ produto, quantidade, unidade, preco, observacao }) => ({ produto, quantidade, unidade, preco, observacao }))
    navigate('/orcamentos/novo', { state: { copia: { itens: copiaItens, cond } } })
  }

  if (carregando) return <div className="card">Carregando...</div>

  const st = orc ? STATUS_ORCAMENTO[orc.status] : null
  const preenchidos = itens.filter((i) => i.produto.trim()).length

  return (
    <>
      <Link to="/orcamentos" className="voltar"><IconeVoltar /> Clientes</Link>

      <div className="titulo-pagina">
        <div>
          <h1>{orc ? `Orçamento ${numeroCotacao(orc.numero)}` : 'Novo orçamento'}</h1>
          <div className="subtitulo">
            {orc ? <>
              <Badge cor={st.cor}>{st.rotulo}</Badge>{' '}
              {orc.enviado_em && <span>enviado {formatarData(orc.enviado_em)}</span>}
              {orc.visualizado_em && <span> · cliente abriu {formatarData(orc.visualizado_em)}</span>}
            </> : 'Cole o pedido, envie o arquivo ou digite os itens.'}
          </div>
        </div>
        {orc && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secundario btn-pequeno" onClick={duplicar}>Duplicar</button>
            {orc.status === 'enviado' && <>
              <button className="btn btn-verde btn-pequeno" onClick={() => mudarStatus('aprovado')}>Marcar aprovado</button>
              <button className="btn btn-perigo btn-pequeno" onClick={() => mudarStatus('recusado')}>Recusado</button>
            </>}
          </div>
        )}
      </div>

      {orc?.status === 'aprovado' && (
        <div style={{ marginBottom: 16 }}>
          {orc.aprovacao_codigo ? (
            <CarimboAprovacao
              codigo={orc.aprovacao_codigo}
              aprovadoEm={orc.aprovado_em}
              aprovadoPor={orc.aprovado_por}
              docTipo={orc.aprovacao_doc_tipo}
              documento={orc.aprovacao_documento}
              dados={orc.aprovacao_dados}
              hash={orc.aprovacao_hash}
            />
          ) : (
            <div className="alerta alerta-ok">
              ✅ Aprovado{orc.aprovado_por ? ` por ${orc.aprovado_por}` : ''}{orc.aprovado_em ? ` em ${formatarData(orc.aprovado_em)}` : ''}.
            </div>
          )}
          <div className="alerta alerta-info" style={{ marginTop: 8 }}>
            🔒 <b>Orçamento aprovado não pode ser alterado.</b> Para modificar valores, itens ou condições, use o botão <b>Duplicar</b> acima.
          </div>
        </div>
      )}

      {erro && <div className="alerta alerta-erro">{erro}</div>}
      {ok && <div className="alerta alerta-ok">{ok}</div>}
      {noPainel && <div className="alerta alerta-info">⚡ {cliente.nome || 'Este cliente'} também usa o CotaCompara: o orçamento já apareceu no painel dele, em "Propostas recebidas".</div>}

      {/* ---------------- 1. entrada (só se não travado) ---------------- */}
      {!travado && (
        <div className="card">
          <div className="secao-topo">
            <h3>{importarAberto ? 'De onde veio o pedido?' : 'Pedido recebido'}</h3>
            {!importarAberto && (
              <div style={{ display: 'flex', gap: 8 }}>
                {textoOriginal && <button className="btn btn-texto btn-pequeno" onClick={() => setVerOriginal(!verOriginal)}>{verOriginal ? 'Ocultar' : 'Ver'} material recebido</button>}
                <button className="btn btn-secundario btn-pequeno" onClick={() => setImportarAberto(true)}>+ Importar mais itens</button>
              </div>
            )}
          </div>

          {resumo && <div className={`alerta ${resumo.erro ? 'alerta-erro' : 'alerta-info'}`} style={{ marginBottom: importarAberto ? 16 : 0 }}>{resumo.texto}</div>}
          {!importarAberto && verOriginal && <pre className="orc-original">{textoOriginal}</pre>}

          {importarAberto && (
            <>
              <div className="orc-modos">
                <button className={modo === 'texto' ? 'ativo' : ''} onClick={() => setModo('texto')}>
                  💬 Colar texto (WhatsApp, e-mail...)
                </button>
                <button className={modo === 'arquivo' ? 'ativo' : ''} onClick={() => setModo('arquivo')}>
                  📄 Enviar arquivo (PDF, foto, planilha...)
                </button>
              </div>

              {modo === 'texto' ? (
                <div>
                  <textarea
                    className="textarea"
                    rows={5}
                    placeholder="Cole aqui a mensagem do cliente. Exemplo:&#10;5 cx papel sulfite A4&#10;10 canetas azuis Bic&#10;2 grampeadores 26/6"
                    value={colado}
                    onChange={(e) => setColado(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn btn-primario" onClick={interpretarTexto} disabled={!colado.trim()}>
                      Identificar itens
                    </button>
                    {itens.length > 0 && (
                      <button className="btn btn-texto" onClick={() => setImportarAberto(false)}>
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className={`orc-dropzone ${arrastando ? 'arrastando' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
                  onDragLeave={() => setArrastando(false)}
                  onDrop={(e) => { e.preventDefault(); setArrastando(false); processarArquivo(e.dataTransfer.files[0]) }}
                  onClick={() => inputArquivo.current?.click()}
                >
                  <input ref={inputArquivo} type="file" style={{ display: 'none' }} accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
                    onChange={(e) => processarArquivo(e.target.files[0])} />
                  {lendo ? (
                    <div className="orc-lendo">
                      <div className="spinner" />
                      <div>{lendo.etapa}</div>
                      {lendo.pct != null && <div className="orc-barra"><div style={{ width: `${lendo.pct}%` }} /></div>}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 34 }}>📄</div>
                      <b>Toque para escolher ou arraste o arquivo aqui</b>
                      <span>PDF · foto ou print (JPG/PNG) · Excel/CSV — no celular dá para tirar a foto na hora</span>
                      <small>Tudo é lido no seu aparelho. Foto: quanto mais nítida e reta, melhor. Letra à mão não é lida.</small>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------- 2. itens ---------------- */}
      {(itens.length > 0 || !importarAberto) && (
        <div className="card">
          <div className="secao-topo">
            <h3>Itens ({preenchidos})</h3>
            {totais.semPreco > 0 && preenchidos > 0 && <small className="texto-suave">{totais.semPreco} sem preço — saem como "não disponível"</small>}
          </div>

          <div className="orc-cab">
            <span>#</span><span>Produto</span><span style={{ textAlign: 'right' }}>Qtd</span><span>Unid.</span>
            <span style={{ textAlign: 'right' }}>Preço unit. (R$)</span><span style={{ textAlign: 'right' }}>Subtotal</span><span />
          </div>
          {itens.map((i, idx) => {
            const q = parseNumero(i.quantidade), p = parseNumero(i.preco)
            const sub = Number.isFinite(q) && Number.isFinite(p) ? q * p : null
            return (
              <div key={i.key} className={`orc-linha ${i.conferir ? 'conferir' : ''}`}>
                <span className="n">{idx + 1}</span>
                <div className="c-prod">
                  <input className="input" value={i.produto} placeholder="Produto" onChange={(e) => alterar(i.key, 'produto', e.target.value)}
                    onBlur={() => aoSairProduto(i)} disabled={travado} />
                  {!travado && i.sugestao && (
                    <div className="orc-sugestao">
                      Você já orçou: <b>{i.sugestao.nome}</b>{i.sugestao.ultimo_preco != null && <> por {formatarMoeda(i.sugestao.ultimo_preco)}</>}
                      <button onClick={() => usarSugestao(i)}>usar</button>
                      <button className="nao" onClick={() => alterar(i.key, 'sugestao', null)}>não</button>
                    </div>
                  )}
                  {i.doCatalogo && <div className="orc-dica">preço do seu último orçamento</div>}
                </div>
                <div className="c-qtd">
                  <input className="input qtd" inputMode="decimal" value={i.quantidade} placeholder={i.conferir ? 'conferir' : 'Qtd'}
                    onChange={(e) => alterar(i.key, 'quantidade', e.target.value)} disabled={travado} />
                </div>
                <div className="c-un">
                  <select className="select" value={i.unidade} onChange={(e) => alterar(i.key, 'unidade', e.target.value)} disabled={travado}>
                    {!UNIDADES.includes(i.unidade) && <option value={i.unidade}>{i.unidade}</option>}
                    {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="c-preco">
                  <input className="input qtd" inputMode="decimal" value={i.preco} placeholder="0,00"
                    onChange={(e) => alterar(i.key, 'preco', e.target.value)} onBlur={() => formatarPreco(i)}
                    disabled={travado}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const prox = e.currentTarget.closest('.orc-linha')?.nextElementSibling?.querySelector('.c-preco input'); prox?.focus() } }} />
                </div>
                <div className="c-sub">{sub == null ? '—' : formatarMoeda(sub)}</div>
                <div className="c-rm">
                  {!travado && <button className="btn-icone perigo" title="Remover" onClick={() => remover(i.key)}><IconeLixo /></button>}
                </div>
              </div>
            )
          })}
          {!travado && (
            <div className="itens-rodape">
              <button className="btn btn-texto" onClick={adicionar}>+ Adicionar item</button>
              <span className="texto-suave" style={{ alignSelf: 'center', fontSize: 13 }}>Dica: Enter no preço pula para o próximo item.</span>
            </div>
          )}

          <div className="orc-totais">
            <div><span>Subtotal</span><b>{formatarMoeda(totais.sub)}</b></div>
            {totais.desc > 0 && <div><span>Desconto</span><b>− {formatarMoeda(totais.desc)}</b></div>}
            {cond.frete.trim() && <div><span>Frete</span><b>{totais.frete ? formatarMoeda(totais.frete) : 'grátis'}</b></div>}
            <div className="total"><span>Total</span><b>{formatarMoeda(totais.total)}</b></div>
          </div>
        </div>
      )}

      {/* ---------------- 3. cliente e condições ---------------- */}
      {(itens.length > 0 || orc) && (
        <div className="grid grid-2">
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Para quem é</h3>
            <div className="campo">
              <label>Cliente (empresa, escola, instituição...)</label>
              <input className="input" value={cliente.nome} onChange={(e) => setCliente({ ...cliente, nome: e.target.value })} placeholder="Ex.: Escola Municipal Monteiro Lobato" disabled={travado} />
            </div>
            <div className="linha-campos">
              <div className="campo">
                <label>CNPJ ou CPF <small>(opcional)</small></label>
                <input className="input" value={cliente.documento} inputMode="numeric"
                  onChange={(e) => { const d = soDigitos(e.target.value); setCliente({ ...cliente, documento: d.length > 11 ? mascaraCnpj(d) : mascaraCpf(d) }) }}
                  onBlur={buscarDoc} placeholder="busca o nome pelo CNPJ" disabled={travado} />
                {docBusca === 'buscando' && <small>Consultando CNPJ...</small>}
              </div>
              <div className="campo">
                <label>Referência <small>(opcional)</small></label>
                <input className="input" value={cliente.referencia} onChange={(e) => setCliente({ ...cliente, referencia: e.target.value })} placeholder="Ex.: Pedido 123 / Material 2º semestre" disabled={travado} />
              </div>
            </div>
            <div className="linha-campos">
              <div className="campo">
                <label>WhatsApp do cliente</label>
                <input className="input" value={cliente.whatsapp} inputMode="tel" onChange={(e) => setCliente({ ...cliente, whatsapp: e.target.value })} placeholder="(19) 99999-0000" disabled={travado} />
              </div>
              <div className="campo">
                <label>E-mail do cliente</label>
                <input className="input" value={cliente.email} inputMode="email" onChange={(e) => setCliente({ ...cliente, email: e.target.value })} placeholder="compras@cliente.com.br" disabled={travado} />
              </div>
            </div>

            {orc?.aprovacao_dados && (
              <div className="dados-consulta-cnpj card-compacto" style={{ marginTop: 12 }}>
                <span className="texto-suave" style={{ fontSize: 12, fontWeight: 600 }}>Dados registrados na aprovação:</span>
                <div className="grid-cnpj-compacto" style={{ marginTop: 6 }}>
                  {orc.aprovacao_dados.razao_social && (
                    <div><span className="cnpj-rotulo">Razão Social:</span> <span className="cnpj-valor">{orc.aprovacao_dados.razao_social}</span></div>
                  )}
                  {orc.aprovacao_dados.nome_fantasia && (
                    <div><span className="cnpj-rotulo">Nome Fantasia:</span> <span className="cnpj-valor">{orc.aprovacao_dados.nome_fantasia}</span></div>
                  )}
                  {(orc.aprovacao_dados.cidade || orc.aprovacao_dados.uf) && (
                    <div><span className="cnpj-rotulo">Local:</span> <span className="cnpj-valor">{[orc.aprovacao_dados.cidade, orc.aprovacao_dados.uf].filter(Boolean).join(' / ')}</span></div>
                  )}
                  {orc.aprovacao_documento && (
                    <div><span className="cnpj-rotulo">{orc.aprovacao_doc_tipo || 'Doc'}:</span> <span className="cnpj-valor mono">{orc.aprovacao_doc_tipo === 'CNPJ' ? mascaraCnpj(orc.aprovacao_documento) : mascaraCpf(orc.aprovacao_documento)}</span></div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Condições</h3>
            <div className="linha-campos">
              <div className="campo">
                <label>Validade (dias)</label>
                <input className="input" inputMode="numeric" value={cond.validade} onChange={(e) => setCond({ ...cond, validade: e.target.value })} disabled={travado} />
              </div>
              <div className="campo">
                <label>Prazo de entrega</label>
                <input className="input" value={cond.prazo} onChange={(e) => setCond({ ...cond, prazo: e.target.value })} placeholder="Ex.: 2 dias úteis" disabled={travado} />
              </div>
            </div>
            <div className="campo">
              <label>Pagamento</label>
              <input className="input" value={cond.pagamento} onChange={(e) => setCond({ ...cond, pagamento: e.target.value })} placeholder="Ex.: Pix à vista ou boleto 28 dias" disabled={travado} />
            </div>
            <div className="linha-campos">
              <div className="campo">
                <label>Frete (R$) <small>0 = grátis</small></label>
                <input className="input" inputMode="decimal" value={cond.frete} onChange={(e) => setCond({ ...cond, frete: e.target.value })} placeholder="deixe vazio se não tiver" disabled={travado} />
              </div>
              <div className="campo">
                <label>Desconto (R$)</label>
                <input className="input" inputMode="decimal" value={cond.desconto} onChange={(e) => setCond({ ...cond, desconto: e.target.value })} placeholder="0,00" disabled={travado} />
              </div>
            </div>
            <div className="campo">
              <label>Observações</label>
              <textarea className="textarea" style={{ minHeight: 60 }} value={cond.obs} onChange={(e) => setCond({ ...cond, obs: e.target.value })} placeholder="Ex.: marcas equivalentes, entrega no endereço da escola..." disabled={travado} />
            </div>
            {!travado && (
              <label className="orc-check"><input type="checkbox" checked={salvarPadrao} onChange={(e) => setSalvarPadrao(e.target.checked)} /> Usar estas condições nos próximos orçamentos</label>
            )}
          </div>
        </div>
      )}

      {/* ---------------- 4. enviar ---------------- */}
      {(itens.length > 0 || orc) && (
        <div className="orc-acoes">
          <div className="orc-acoes-total">
            <small>Total do orçamento</small>
            <b>{formatarMoeda(totais.total)}</b>
          </div>
          <div className="orc-acoes-botoes">
            {!travado && (
              <button className="btn btn-secundario" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
            )}
            {travado && (
              <button className="btn btn-primario" onClick={duplicar}>Duplicar orçamento</button>
            )}
            <button className="btn btn-secundario" onClick={abrirPdf} disabled={salvando}>Ver / PDF</button>
            <button className="btn btn-secundario" onClick={copiarLink} disabled={salvando} title="Copiar mensagem com link"><IconeLink /> Link</button>
            <button className="btn btn-secundario" onClick={enviarEmail} disabled={salvando} title="Enviar por e-mail"><IconeEmail /> E-mail</button>
            <button className="btn btn-verde" onClick={enviarWhats} disabled={salvando}><IconeWhats /> Enviar no WhatsApp</button>
          </div>
        </div>
      )}
      {orc && origem !== 'manual' && <p className="texto-suave" style={{ fontSize: 12, textAlign: 'center' }}>Itens importados de {ORIGEM[origem] || origem}.</p>}
    </>
  )
}
