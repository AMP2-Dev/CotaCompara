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
import { cnpjValido, consultarCnpj, mascaraCnpj, nomeExibicao } from '../lib/cnpj'
import Badge from '../components/Badge'
import { IconeLixo, IconeVoltar, IconeWhats, IconeLink, IconeEmail } from '../components/Icones'

let seq = 0
const novoItem = (d = {}) => ({ key: ++seq, produto: '', quantidade: '', unidade: 'UN', preco: '', observacao: '', conferir: false, sugestao: null, doCatalogo: false, ...d })
const precoTexto = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }))
const ORIGEM = { texto: 'texto colado', pdf: 'PDF', imagem: 'foto', planilha: 'planilha', manual: 'digitado' }

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

  const lerTexto = () => aplicarLeitura(lerItens(colado), 'texto', colado)

  const lerArq = async (file) => {
    if (!file) return
    setErro(''); setResumo(null)
    if (!tipoArquivo(file)) return setErro('Formato não suportado. Envie PDF, foto (JPG/PNG), Excel ou CSV.')
    setLendo({ etapa: 'Abrindo o arquivo...' })
    try {
      const { texto, origem: org, ocr } = await lerArquivo(file, (p) => setLendo(p))
      const lidos = lerItens(texto)
      aplicarLeitura(lidos, org, texto)
      if (ocr && lidos.length) setResumo((r) => r && { ...r, texto: r.texto + ' Leitura de foto: confira nomes e quantidades.' })
    } catch (e) {
      setErro(e.message || 'Não consegui ler o arquivo.')
    } finally {
      setLendo(null)
      if (inputArquivo.current) inputArquivo.current.value = ''
    }
  }

  // ------------------------------------------------------------ itens
  const alterar = (key, campo, valor) => setItens((l) => l.map((i) => (i.key === key ? { ...i, [campo]: valor, ...(campo === 'quantidade' ? { conferir: false } : {}) } : i)))
  const remover = (key) => setItens((l) => l.filter((i) => i.key !== key))
  const adicionar = () => setItens((l) => [...l, novoItem()])
  const usarSugestao = (it) => setItens((l) => l.map((i) => (i.key === it.key ? {
    ...i, produto: it.sugestao.nome, preco: i.preco || precoTexto(it.sugestao.ultimo_preco), sugestao: null, doCatalogo: it.sugestao.ultimo_preco != null,
  } : i)))
  const aoSairProduto = (it) => {
    if (!it.produto.trim() || it.doCatalogo) return
    const achado = buscarNoCatalogo(it.produto, catalogo)
    if (achado?.exato && !it.preco && achado.item.ultimo_preco != null) {
      setItens((l) => l.map((i) => (i.key === it.key ? { ...i, produto: achado.item.nome, preco: precoTexto(achado.item.ultimo_preco), doCatalogo: true, sugestao: null } : i)))
    } else if (achado && !achado.exato) {
      setItens((l) => l.map((i) => (i.key === it.key ? { ...i, sugestao: achado.item } : i)))
    }
  }
  const formatarPreco = (it) => {
    const n = parseNumero(it.preco)
    if (Number.isFinite(n) && n >= 0) alterar(it.key, 'preco', precoTexto(n))
  }

  const totais = useMemo(() => {
    let sub = 0, semPreco = 0
    for (const i of itens) {
      if (!i.produto.trim()) continue
      const q = parseNumero(i.quantidade), p = parseNumero(i.preco)
      if (Number.isFinite(q) && Number.isFinite(p)) sub += Math.round(q * p * 100) / 100
      else semPreco++
    }
    const desc = parseNumero(cond.desconto) || 0
    const frete = parseNumero(cond.frete) || 0
    return { sub, desc, frete, total: Math.max(sub - desc, 0) + frete, semPreco }
  }, [itens, cond.desconto, cond.frete])

  // ------------------------------------------------------------ cliente
  const buscarDoc = async () => {
    const d = soDigitos(cliente.documento)
    if (d.length !== 14 || !cnpjValido(d)) return
    setDocBusca('buscando')
    try {
      const r = await consultarCnpj(d)
      setCliente((c) => ({ ...c, nome: c.nome || nomeExibicao(r), email: c.email || r.email || '', whatsapp: c.whatsapp || r.telefone || '' }))
      setDocBusca('')
    } catch { setDocBusca('') }
  }

  // ------------------------------------------------------------ salvar
  const salvar = async () => {
    setErro(''); setOk('')
    const validos = itens.filter((i) => i.produto.trim())
    if (!validos.length) { setErro('Adicione pelo menos um item.'); return null }
    for (const [n, i] of validos.entries()) {
      const q = parseNumero(i.quantidade)
      if (!Number.isFinite(q) || q <= 0) { setErro(`Informe a quantidade do item ${n + 1} (${i.produto}).`); return null }
      const p = parseNumero(i.preco)
      if (i.preco.trim() && (!Number.isFinite(p) || p < 0)) { setErro(`Preço inválido no item ${n + 1} (${i.produto}).`); return null }
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
    const r = await salvar(); if (!r) return
    await registrarEnvio(r)
    await copiarTexto(mensagem(r))
    setOk('Mensagem com o link copiada. É só colar no WhatsApp, Telegram ou e-mail.')
  }
  const enviarEmail = async () => {
    if (!emailValido(cliente.email)) { setErro('Informe o e-mail do cliente para enviar.'); return }
    const r = await salvar(); if (!r) return
    setSalvando(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/enviar-orcamento', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ orcamento_id: r.id }),
      })
      const j = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(j.erro || 'Falha ao enviar o e-mail.')
      await registrarEnvio(r)
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
        <div className="alerta alerta-ok">
          ✅ Aprovado{orc.aprovado_por ? ` por ${orc.aprovado_por}` : ''}{orc.aprovado_em ? ` em ${formatarData(orc.aprovado_em)}` : ''}.
        </div>
      )}
      {erro && <div className="alerta alerta-erro">{erro}</div>}
      {ok && <div className="alerta alerta-ok">{ok}</div>}
      {noPainel && <div className="alerta alerta-info">⚡ {cliente.nome || 'Este cliente'} também usa o CotaCompara: o orçamento já apareceu no painel dele, em "Propostas recebidas".</div>}

      {/* ---------------- 1. entrada ---------------- */}
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
                <b>📋 Colar texto</b><span>WhatsApp, e-mail, lista</span>
              </button>
              <button className={modo === 'arquivo' ? 'ativo' : ''} onClick={() => setModo('arquivo')}>
                <b>📎 Enviar arquivo</b><span>PDF, foto/print, Excel</span>
              </button>
              <button onClick={() => { setImportarAberto(false); if (!itens.length) setItens([novoItem(), novoItem(), novoItem()]) }}>
                <b>⌨️ Digitar</b><span>começar do zero</span>
              </button>
            </div>

            {modo === 'texto' ? (
              <>
                <textarea className="textarea orc-colar" value={colado} onChange={(e) => setColado(e.target.value)} autoFocus
                  placeholder={'Cole aqui a mensagem como ela veio. Ex.:\n\nBom dia! Preciso de orçamento:\n10 cx caneta azul\n5 resmas papel A4\nLápis preto - 3 cx\nBorracha branca 20 un'} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                  <small className="texto-suave">Pode colar a conversa inteira: cumprimentos, datas e nomes são ignorados.</small>
                  <button className="btn btn-primario" onClick={lerTexto} disabled={!colado.trim()}>Montar tabela</button>
                </div>
              </>
            ) : (
              <div
                className={`orc-drop ${arrastando ? 'sobre' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => { e.preventDefault(); setArrastando(false); lerArq(e.dataTransfer.files?.[0]) }}
                onClick={() => !lendo && inputArquivo.current?.click()}
              >
                <input ref={inputArquivo} type="file" hidden accept="application/pdf,image/*,.xlsx,.xls,.ods,.csv,.txt"
                  onChange={(e) => lerArq(e.target.files?.[0])} />
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
                    onBlur={() => aoSairProduto(i)} />
                  {i.sugestao && (
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
                    onChange={(e) => alterar(i.key, 'quantidade', e.target.value)} />
                </div>
                <div className="c-un">
                  <select className="select" value={i.unidade} onChange={(e) => alterar(i.key, 'unidade', e.target.value)}>
                    {!UNIDADES.includes(i.unidade) && <option value={i.unidade}>{i.unidade}</option>}
                    {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="c-preco">
                  <input className="input qtd" inputMode="decimal" value={i.preco} placeholder="0,00"
                    onChange={(e) => alterar(i.key, 'preco', e.target.value)} onBlur={() => formatarPreco(i)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const prox = e.currentTarget.closest('.orc-linha')?.nextElementSibling?.querySelector('.c-preco input'); prox?.focus() } }} />
                </div>
                <div className="c-sub">{sub == null ? '—' : formatarMoeda(sub)}</div>
                <div className="c-rm">
                  <button className="btn-icone perigo" title="Remover" onClick={() => remover(i.key)}><IconeLixo /></button>
                </div>
              </div>
            )
          })}
          <div className="itens-rodape">
            <button className="btn btn-texto" onClick={adicionar}>+ Adicionar item</button>
            <span className="texto-suave" style={{ alignSelf: 'center', fontSize: 13 }}>Dica: Enter no preço pula para o próximo item.</span>
          </div>

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
              <input className="input" value={cliente.nome} onChange={(e) => setCliente({ ...cliente, nome: e.target.value })} placeholder="Ex.: Escola Municipal Monteiro Lobato" />
            </div>
            <div className="linha-campos">
              <div className="campo">
                <label>CNPJ ou CPF <small>(opcional)</small></label>
                <input className="input" value={cliente.documento} inputMode="numeric"
                  onChange={(e) => { const d = soDigitos(e.target.value); setCliente({ ...cliente, documento: d.length > 11 ? mascaraCnpj(d) : e.target.value }) }}
                  onBlur={buscarDoc} placeholder="busca o nome pelo CNPJ" />
                {docBusca === 'buscando' && <small>Consultando CNPJ...</small>}
              </div>
              <div className="campo">
                <label>Referência <small>(opcional)</small></label>
                <input className="input" value={cliente.referencia} onChange={(e) => setCliente({ ...cliente, referencia: e.target.value })} placeholder="Ex.: Pedido 123 / Material 2º semestre" />
              </div>
            </div>
            <div className="linha-campos">
              <div className="campo">
                <label>WhatsApp do cliente</label>
                <input className="input" value={cliente.whatsapp} inputMode="tel" onChange={(e) => setCliente({ ...cliente, whatsapp: e.target.value })} placeholder="(19) 99999-0000" />
              </div>
              <div className="campo">
                <label>E-mail do cliente</label>
                <input className="input" value={cliente.email} inputMode="email" onChange={(e) => setCliente({ ...cliente, email: e.target.value })} placeholder="compras@cliente.com.br" />
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Condições</h3>
            <div className="linha-campos">
              <div className="campo">
                <label>Validade (dias)</label>
                <input className="input" inputMode="numeric" value={cond.validade} onChange={(e) => setCond({ ...cond, validade: e.target.value })} />
              </div>
              <div className="campo">
                <label>Prazo de entrega</label>
                <input className="input" value={cond.prazo} onChange={(e) => setCond({ ...cond, prazo: e.target.value })} placeholder="Ex.: 2 dias úteis" />
              </div>
            </div>
            <div className="campo">
              <label>Pagamento</label>
              <input className="input" value={cond.pagamento} onChange={(e) => setCond({ ...cond, pagamento: e.target.value })} placeholder="Ex.: Pix à vista ou boleto 28 dias" />
            </div>
            <div className="linha-campos">
              <div className="campo">
                <label>Frete (R$) <small>0 = grátis</small></label>
                <input className="input" inputMode="decimal" value={cond.frete} onChange={(e) => setCond({ ...cond, frete: e.target.value })} placeholder="deixe vazio se não tiver" />
              </div>
              <div className="campo">
                <label>Desconto (R$)</label>
                <input className="input" inputMode="decimal" value={cond.desconto} onChange={(e) => setCond({ ...cond, desconto: e.target.value })} placeholder="0,00" />
              </div>
            </div>
            <div className="campo">
              <label>Observações</label>
              <textarea className="textarea" style={{ minHeight: 60 }} value={cond.obs} onChange={(e) => setCond({ ...cond, obs: e.target.value })} placeholder="Ex.: marcas equivalentes, entrega no endereço da escola..." />
            </div>
            <label className="orc-check"><input type="checkbox" checked={salvarPadrao} onChange={(e) => setSalvarPadrao(e.target.checked)} /> Usar estas condições nos próximos orçamentos</label>
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
            <button className="btn btn-secundario" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
            <button className="btn btn-secundario" onClick={abrirPdf} disabled={salvando}>Ver / PDF</button>
            <button className="btn btn-secundario" onClick={copiarLink} disabled={salvando} title="Copiar mensagem com link"><IconeLink /> Link</button>
            <button className="btn btn-secundario" onClick={enviarEmail} disabled={salvando} title="Enviar por e-mail"><IconeEmail /> E-mail</button>
            <button className="btn btn-verde" onClick={enviarWhats} disabled={salvando}><IconeWhats /> Enviar no WhatsApp</button>
          </div>
        </div>
      )}
      {orc && origem !== 'manual' && <p className="texto-suave" style={{ fontSize: 12, textAlign: 'center' }}>Itens importados de {ORIGEM[origem]}.</p>}
    </>
  )
}
