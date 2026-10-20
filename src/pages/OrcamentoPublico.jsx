import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase, mensagemErro } from '../lib/supabase'
import { numeroCotacao, formatarData, formatarMoeda, formatarQtd, linkWhatsApp } from '../lib/format'
import { mascaraCnpj, mascaraCpf, cnpjValido, cpfValido, consultarCnpj } from '../lib/cnpj'
import Logo from '../components/Logo'
import Modal from '../components/Modal'
import Carregando from '../components/Carregando'
import CarimboAprovacao from '../components/CarimboAprovacao'

// A4 retrato com margem de 10 mm, em px CSS
const LARGURA = Math.floor((210 - 20) * 3.7795) // 718
const ALTURA = Math.floor((297 - 20) * 3.7795) - 12 // 1034
const ZOOM_MIN = 0.6

function ajustar(folha) {
  if (!folha) return
  document.body.classList.add('modo-impressao-orc')
  folha.style.zoom = ''
  const alt = (z) => { folha.style.width = `${LARGURA / z}px`; return folha.scrollHeight * z }
  let z = 1
  if (alt(1) > ALTURA) {
    let lo = ZOOM_MIN, hi = 1
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (alt(m) <= ALTURA) lo = m; else hi = m }
    z = lo
  }
  folha.style.width = `${LARGURA / z}px`; folha.style.zoom = String(z)
}
function restaurar(folha) {
  document.body.classList.remove('modo-impressao-orc')
  if (folha) { folha.style.zoom = ''; folha.style.width = '' }
}

export default function OrcamentoPublico() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const folhaRef = useRef(null)
  const comprovanteRef = useRef(null)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')

  // Modal de aprovação em 3 passos
  const [aprovarAberto, setAprovarAberto] = useState(false)
  const [passo, setPasso] = useState(1) // 1: Identificação, 2: Confirmação, 3: Comprovante
  const [docTipo, setDocTipo] = useState('CNPJ')
  const [documento, setDocumento] = useState('')
  const [nomeAprovador, setNomeAprovador] = useState('')
  const [consultandoCnpj, setConsultandoCnpj] = useState(false)
  const [dadosCnpj, setDadosCnpj] = useState(null)
  const [erroCnpj, setErroCnpj] = useState('')
  const [concordou, setConcordou] = useState(false)
  const [enviandoAprovacao, setEnviandoAprovacao] = useState(false)
  const [erroAprovar, setErroAprovar] = useState('')
  const [resultadoAprovacao, setResultadoAprovacao] = useState(null)
  const [qrComprovante, setQrComprovante] = useState('')

  const carregar = async () => {
    const { data, error } = await supabase.rpc('orcamento_publico', { p_token: token })
    if (error) setErro(mensagemErro(error)); else setDados(data)
  }

  useEffect(() => {
    const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    carregar()
    return () => meta.remove()
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dados) return
    document.title = `Orçamento ${numeroCotacao(dados.orcamento.numero)} · ${dados.empresa.nome}`
    const antes = () => ajustar(folhaRef.current)
    const depois = () => restaurar(folhaRef.current)
    window.addEventListener('beforeprint', antes)
    window.addEventListener('afterprint', depois)
    if (params.get('imprimir')) setTimeout(imprimir, 600)
    return () => { window.removeEventListener('beforeprint', antes); window.removeEventListener('afterprint', depois) }
  }, [dados]) // eslint-disable-line react-hooks/exhaustive-deps

  // Geração do QR code do comprovante no passo 3
  useEffect(() => {
    if (resultadoAprovacao?.codigo) {
      const url = `https://cotacompara.amp.ia.br/v/${resultadoAprovacao.codigo}`
      import('qrcode')
        .then((QRCode) => QRCode.toDataURL(url, { margin: 1, width: 140, errorCorrectionLevel: 'M' }))
        .then((u) => setQrComprovante(u))
        .catch((e) => console.error(e))
    }
  }, [resultadoAprovacao])

  const imprimir = () => {
    ajustar(folhaRef.current)
    requestAnimationFrame(() => setTimeout(() => window.print(), 50))
  }

  const imprimirComprovante = () => {
    window.print()
  }

  // Manipulação de documento
  const handleDocChange = async (val) => {
    const digits = val.replace(/\D/g, '')
    if (docTipo === 'CNPJ') {
      const mascara = mascaraCnpj(digits)
      setDocumento(mascara)
      if (digits.length === 14 && cnpjValido(digits)) {
        setConsultandoCnpj(true)
        setErroCnpj('')
        try {
          const res = await consultarCnpj(digits)
          setDadosCnpj(res)
          if (!nomeAprovador && res.razao_social) {
            setNomeAprovador(res.nome_fantasia || res.razao_social)
          }
        } catch {
          setErroCnpj('Não foi possível consultar os dados na Receita. Você pode prosseguir normalmente.')
          setDadosCnpj(null)
        } finally {
          setConsultandoCnpj(false)
        }
      } else {
        setDadosCnpj(null)
        setErroCnpj('')
      }
    } else {
      setDocumento(mascaraCpf(digits))
      setDadosCnpj(null)
      setErroCnpj('')
    }
  }

  const alternarTipoDoc = (tipo) => {
    setDocTipo(tipo)
    setDocumento('')
    setDadosCnpj(null)
    setErroCnpj('')
  }

  const documentoValido = () => {
    const d = documento.replace(/\D/g, '')
    if (docTipo === 'CNPJ') return d.length === 14 && cnpjValido(d)
    return d.length === 11 && cpfValido(d)
  }

  const avancarParaPasso2 = (e) => {
    e.preventDefault()
    setErroAprovar('')
    if (!documentoValido()) {
      setErroAprovar(docTipo === 'CNPJ' ? 'Informe um CNPJ válido.' : 'Informe um CPF válido.')
      return
    }
    if (!nomeAprovador.trim()) {
      setErroAprovar('Informe o nome de quem está aprovando.')
      return
    }
    setPasso(2)
  }

  const confirmarAprovacao = async () => {
    setErroAprovar('')
    if (!concordou) {
      setErroAprovar('É necessário confirmar os dados e concordar com a aprovação.')
      return
    }

    setEnviandoAprovacao(true)
    const dadosPayload = docTipo === 'CNPJ' && dadosCnpj ? {
      razao_social: dadosCnpj.razao_social,
      nome_fantasia: dadosCnpj.nome_fantasia,
      cidade: dadosCnpj.cidade,
      uf: dadosCnpj.uf,
      situacao: dadosCnpj.situacao,
      fonte: 'consulta',
    } : {
      fonte: 'informado',
    }

    const { data, error } = await supabase.rpc('aprovar_orcamento_v2', {
      p_token: token,
      p_nome: nomeAprovador.trim(),
      p_doc_tipo: docTipo,
      p_documento: documento.replace(/\D/g, ''),
      p_dados: dadosPayload,
    })

    setEnviandoAprovacao(false)
    if (error) {
      setErroAprovar(mensagemErro(error))
    } else {
      setResultadoAprovacao(data)
      setPasso(3)
      carregar()
    }
  }

  const fecharModal = () => {
    setAprovarAberto(false)
    setPasso(1)
    setErroAprovar('')
    setConcordou(false)
  }

  if (erro) return (
    <div className="orc-pub-erro">
      <Logo to={null} />
      <div className="card" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
        <h2 style={{ marginBottom: 8 }}>Não foi possível abrir</h2>
        <p className="texto-suave">{erro}</p>
      </div>
    </div>
  )
  if (!dados) return <Carregando />

  const { empresa: e, orcamento: o, itens } = dados
  const vencido = o.valido_ate && new Date(o.valido_ate) < new Date()
  const local = [e.cidade, e.uf].filter(Boolean).join(' / ')
  const whatsFornecedor = linkWhatsApp(e.telefone, `Olá! Sobre o orçamento ${numeroCotacao(o.numero)}${o.cliente_nome ? ` (${o.cliente_nome})` : ''}:`)
  const podeAprovar = o.status === 'enviado' && !vencido && !dados.sou_dono
  const semPreco = itens.filter((i) => i.preco_unitario == null).length

  return (
    <div className="orc-pub">
      {/* Orçamento imprime em A4 retrato */}
      <style>{'@media print { @page { size: A4 portrait; margin: 10mm; } }'}</style>

      <div className="orc-pub-barra no-print">
        <div className="orc-pub-barra-in">
          <span className="texto-suave" style={{ fontSize: 13 }}>Orçamento de <b>{e.nome}</b></span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secundario btn-pequeno" onClick={imprimir}>Baixar PDF / Imprimir</button>
            {whatsFornecedor && <a className="btn btn-secundario btn-pequeno" href={whatsFornecedor} target="_blank" rel="noreferrer">Falar no WhatsApp</a>}
            {podeAprovar && <button className="btn btn-verde btn-pequeno" onClick={() => { setPasso(1); setAprovarAberto(true) }}>Aprovar orçamento</button>}
          </div>
        </div>
      </div>

      {o.status === 'aprovado' && (
        o.aprovacao_codigo ? (
          <div className="no-print orc-pub-aviso" style={{ maxWidth: 718, margin: '16px auto 0' }}>
            <CarimboAprovacao
              codigo={o.aprovacao_codigo}
              aprovadoEm={o.aprovado_em}
              aprovadoPor={o.aprovado_por}
              docTipo={o.aprovacao_doc_tipo}
              documento={o.aprovacao_documento}
              dados={o.aprovacao_dados}
              hash={o.aprovacao_hash}
            />
          </div>
        ) : (
          <div className="alerta alerta-ok no-print orc-pub-aviso">
            ✅ Orçamento aprovado{o.aprovado_por ? ` por ${o.aprovado_por}` : ''} em {formatarData(o.aprovado_em)}. O fornecedor vê a aprovação no painel dele.
          </div>
        )
      )}

      {vencido && o.status !== 'aprovado' && (
        <div className="alerta alerta-info no-print orc-pub-aviso">A validade deste orçamento terminou em {formatarData(o.valido_ate, false)}. Peça uma atualização ao fornecedor.</div>
      )}

      <div className="orc-folha" ref={folhaRef}>
        <header className="orc-f-cab">
          <div className="orc-f-emp">
            {e.logo_url && <img src={e.logo_url} alt="" className="orc-f-logo" />}
            <div>
              <div className="orc-f-nome">{e.nome}</div>
              {e.razao_social && e.razao_social !== e.nome && <div>{e.razao_social}</div>}
              {e.cnpj && <div className="mono">CNPJ {e.cnpj}</div>}
              {(e.endereco || local) && <div>{[e.endereco, local, e.cep && `CEP ${e.cep}`].filter(Boolean).join(' · ')}</div>}
              {(e.telefone || e.email) && <div>{[e.telefone, e.email].filter(Boolean).join(' · ')}</div>}
            </div>
          </div>
          <div className="orc-f-doc">
            <div className="orc-f-tipo">Orçamento</div>
            <div className="orc-f-num mono">{numeroCotacao(o.numero)}</div>
            <div>Data: {formatarData(o.enviado_em || o.criado_em, false)}</div>
            <div>Válido até: <b>{formatarData(o.valido_ate, false)}</b></div>
          </div>
        </header>

        {(o.cliente_nome || o.referencia) && (
          <section className="orc-f-cliente">
            {o.cliente_nome && <div><span>Cliente</span><b>{o.cliente_nome}</b>{o.cliente_documento && <small className="mono"> · {o.cliente_documento}</small>}</div>}
            {o.referencia && <div><span>Referência</span><b>{o.referencia}</b></div>}
          </section>
        )}

        <table className="orc-f-tabela">
          <thead>
            <tr><th style={{ width: 30 }}>#</th><th>Produto</th><th className="num">Qtd</th><th>Un.</th><th className="num">Preço unit.</th><th className="num">Subtotal</th></tr>
          </thead>
          <tbody>
            {itens.map((i, n) => (
              <tr key={n} className={i.preco_unitario == null ? 'sem' : ''}>
                <td>{n + 1}</td>
                <td>{i.produto}{i.observacao && <div className="orc-f-obs">{i.observacao}</div>}</td>
                <td className="num">{formatarQtd(i.quantidade)}</td>
                <td>{i.unidade}</td>
                <td className="num">{i.preco_unitario == null ? 'não disponível' : formatarMoeda(i.preco_unitario)}</td>
                <td className="num">{i.subtotal == null ? '—' : formatarMoeda(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="orc-f-rodape">
          <div className="orc-f-cond">
            {o.prazo_entrega && <div><span>Prazo de entrega</span>{o.prazo_entrega}</div>}
            {o.condicao_pagamento && <div><span>Pagamento</span>{o.condicao_pagamento}</div>}
            <div><span>Validade</span>{o.validade_dias} dias</div>
            {o.observacoes && <div className="obs"><span>Observações</span>{o.observacoes}</div>}
            {semPreco > 0 && <div className="obs"><span>Atenção</span>{semPreco} {semPreco === 1 ? 'item não está disponível' : 'itens não estão disponíveis'} no momento.</div>}
          </div>
          <div className="orc-f-totais">
            <div><span>Subtotal</span>{formatarMoeda(o.subtotal)}</div>
            {Number(o.desconto) > 0 && <div><span>Desconto</span>− {formatarMoeda(o.desconto)}</div>}
            {o.frete != null && <div><span>Frete</span>{Number(o.frete) ? formatarMoeda(o.frete) : 'grátis'}</div>}
            <div className="total"><span>Total</span>{formatarMoeda(o.total)}</div>
          </div>
        </div>

        {/* Bloco de carimbo na impressão pós-totais */}
        {o.status === 'aprovado' && (
          o.aprovacao_codigo ? (
            <div style={{ marginTop: 14 }}>
              <CarimboAprovacao
                codigo={o.aprovacao_codigo}
                aprovadoEm={o.aprovado_em}
                aprovadoPor={o.aprovado_por}
                docTipo={o.aprovacao_doc_tipo}
                documento={o.aprovacao_documento}
                dados={o.aprovacao_dados}
                hash={o.aprovacao_hash}
              />
            </div>
          ) : (
            <div className="orc-f-aprovado">Aprovado por {o.aprovado_por} em {formatarData(o.aprovado_em)}</div>
          )
        )}

        <div className="orc-f-assinatura">
          <div><div className="linha" />{e.responsavel ? `${e.responsavel} — ${e.nome}` : e.nome}</div>
          <div><div className="linha" />De acordo (cliente)</div>
        </div>
        <div className="orc-f-marca">Orçamento gerado no CotaCompara · cotacompara.amp.ia.br</div>
      </div>

      <div className="orc-pub-cta no-print">
        <Logo to={null} />
        <div>
          <b>Também compra para a sua empresa ou instituição?</b>
          <span>Mande a lista para vários fornecedores e veja o menor preço de cada item em um só lugar.</span>
        </div>
        <a className="btn btn-primario btn-pequeno" href="/cadastro">Conhecer o CotaCompara</a>
      </div>

      {/* Modal de aprovação eletrônica em 3 passos */}
      <Modal
        aberto={aprovarAberto}
        titulo={passo === 3 ? 'Comprovante de aprovação' : 'Aprovação eletrônica do orçamento'}
        onFechar={fecharModal}
        rodape={
          passo === 1 ? (
            <>
              <button className="btn btn-secundario" onClick={fecharModal}>Cancelar</button>
              <button className="btn btn-primario" onClick={avancarParaPasso2} disabled={!documentoValido() || !nomeAprovador.trim()}>
                Avançar para confirmação →
              </button>
            </>
          ) : passo === 2 ? (
            <>
              <button className="btn btn-secundario" onClick={() => setPasso(1)} disabled={enviandoAprovacao}>← Voltar</button>
              <button className="btn btn-verde" onClick={confirmarAprovacao} disabled={enviandoAprovacao || !concordou}>
                {enviandoAprovacao ? 'Registrando aprovação...' : 'Confirmar e aprovar'}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secundario" onClick={imprimirComprovante}>Salvar comprovante (PDF)</button>
              <button className="btn btn-primario" onClick={fecharModal}>Fechar</button>
            </>
          )
        }
      >
        {passo === 1 && (
          <div className="aprov-passo">
            <p style={{ marginTop: 0, fontSize: 14 }}>
              Você está aprovando o orçamento <b>{numeroCotacao(o.numero)}</b> de <b>{e.nome}</b> no valor de <b>{formatarMoeda(o.total)}</b>.
            </p>

            {erroAprovar && <div className="alerta alerta-erro">{erroAprovar}</div>}

            <div className="campo">
              <label>Identificação de quem está aprovando</label>
              <div className="abas-doc" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  className={`btn btn-pequeno ${docTipo === 'CNPJ' ? 'btn-primario' : 'btn-secundario'}`}
                  onClick={() => alternarTipoDoc('CNPJ')}
                >
                  Pessoa Jurídica (CNPJ)
                </button>
                <button
                  type="button"
                  className={`btn btn-pequeno ${docTipo === 'CPF' ? 'btn-primario' : 'btn-secundario'}`}
                  onClick={() => alternarTipoDoc('CPF')}
                >
                  Pessoa Física (CPF)
                </button>
              </div>

              <input
                className="input mono"
                placeholder={docTipo === 'CNPJ' ? '00.000.000/0000-00' : '000.000.000-00'}
                value={documento}
                onChange={(ev) => handleDocChange(ev.target.value)}
                autoFocus
              />
              {consultandoCnpj && <small className="texto-suave" style={{ display: 'block', marginTop: 4 }}>Consultando dados na Receita Federal...</small>}
              {erroCnpj && <small className="texto-suave" style={{ display: 'block', marginTop: 4, color: '#b45309' }}>{erroCnpj}</small>}
            </div>

            {docTipo === 'CNPJ' && dadosCnpj && (
              <div className="dados-consulta-cnpj card-compacto">
                <div className="grid-cnpj-compacto">
                  <div>
                    <span className="cnpj-rotulo">Razão Social</span>
                    <span className="cnpj-valor">{dadosCnpj.razao_social || '—'}</span>
                  </div>
                  {dadosCnpj.nome_fantasia && (
                    <div>
                      <span className="cnpj-rotulo">Nome Fantasia</span>
                      <span className="cnpj-valor">{dadosCnpj.nome_fantasia}</span>
                    </div>
                  )}
                  <div>
                    <span className="cnpj-rotulo">Cidade / UF</span>
                    <span className="cnpj-valor">{[dadosCnpj.cidade, dadosCnpj.uf].filter(Boolean).join(' / ') || '—'}</span>
                  </div>
                  <div>
                    <span className="cnpj-rotulo">Situação Cadastral</span>
                    <span className="cnpj-valor">
                      {dadosCnpj.situacao || '—'}
                      {dadosCnpj.situacao && dadosCnpj.situacao !== 'ATIVA' && (
                        <span className="badge badge-laranja" style={{ marginLeft: 6, fontSize: 10 }}>
                          Situação: {dadosCnpj.situacao}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {docTipo === 'CPF' && documento.replace(/\D/g, '').length === 11 && (
              <div className="selo-cpf-informado">
                <small>⚠️ CPF informado pelo cliente (não verificado na Receita).</small>
              </div>
            )}

            <div className="campo" style={{ marginTop: 14 }}>
              <label>Seu nome (quem está aprovando) <span className="obrigatorio">*</span></label>
              <input
                className="input"
                placeholder="Nome completo do responsável"
                value={nomeAprovador}
                onChange={(ev) => setNomeAprovador(ev.target.value)}
                maxLength={120}
              />
            </div>
          </div>
        )}

        {passo === 2 && (
          <div className="aprov-passo">
            <h4 style={{ margin: '0 0 12px' }}>Confirmação dos dados</h4>
            <div className="resumo-aprovacao-card">
              <div className="resumo-linha">
                <span>Orçamento</span>
                <b>{numeroCotacao(o.numero)} · {e.nome}</b>
              </div>
              <div className="resumo-linha">
                <span>Valor Total</span>
                <b style={{ color: 'var(--cor-primaria)' }}>{formatarMoeda(o.total)}</b>
              </div>
              <div className="resumo-linha">
                <span>Validade</span>
                <span>{o.validade_dias} dias ({formatarData(o.valido_ate, false)})</span>
              </div>
              <div className="resumo-linha">
                <span>Aprovador</span>
                <b>{nomeAprovador}</b>
              </div>
              <div className="resumo-linha">
                <span>Documento</span>
                <span className="mono">{docTipo}: {documento}</span>
              </div>
              {dadosCnpj?.razao_social && (
                <div className="resumo-linha">
                  <span>Razão Social</span>
                  <span>{dadosCnpj.razao_social}</span>
                </div>
              )}
            </div>

            {erroAprovar && <div className="alerta alerta-erro" style={{ marginTop: 12 }}>{erroAprovar}</div>}

            <label className="checkbox-termo" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={concordou}
                onChange={(ev) => setConcordou(ev.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ fontSize: 13, lineHeight: 1.4 }}>
                Confirmo que verifiquei os itens, quantidades, valores e prazos, e <b>aprovo este orçamento</b>.
              </span>
            </label>

            <p className="texto-suave" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.4 }}>
              Para comprovar a validade jurídica da aprovação registramos data, hora, endereço IP e assinatura digital, em conformidade com a Lei Federal nº 14.063/2020 e a LGPD.
            </p>
          </div>
        )}

        {passo === 3 && resultadoAprovacao && (
          <div className="recibo-comprovante" ref={comprovanteRef}>
            <div className="recibo-topo">
              <div className="recibo-icone">✓</div>
              <h3 style={{ margin: '4px 0 2px' }}>Pedido aprovado com sucesso!</h3>
              <p className="texto-suave" style={{ fontSize: 13, margin: 0 }}>O fornecedor já foi notificado no painel.</p>
            </div>

            <div className="recibo-destaque">
              <span className="rotulo-mini">CÓDIGO DE APROVAÇÃO</span>
              <div className="recibo-codigo mono">{resultadoAprovacao.codigo}</div>
            </div>

            <div className="recibo-grade">
              <div>
                <span className="recibo-rotulo">Fornecedor</span>
                <span className="recibo-dado">{resultadoAprovacao.fornecedor || e.nome}</span>
              </div>
              <div>
                <span className="recibo-rotulo">Orçamento</span>
                <span className="recibo-dado mono">{numeroCotacao(resultadoAprovacao.numero || o.numero)}</span>
              </div>
              <div>
                <span className="recibo-rotulo">Valor Total</span>
                <span className="recibo-dado">{formatarMoeda(resultadoAprovacao.total || o.total)}</span>
              </div>
              <div>
                <span className="recibo-rotulo">Aprovado por</span>
                <span className="recibo-dado">{nomeAprovador} <small className="mono">({documento})</small></span>
              </div>
              <div>
                <span className="recibo-rotulo">Data e Hora</span>
                <span className="recibo-dado">{formatarData(resultadoAprovacao.aprovado_em)}</span>
              </div>
              <div>
                <span className="recibo-rotulo">Validade da proposta</span>
                <span className="recibo-dado">{formatarData(resultadoAprovacao.validade, false)}</span>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span className="recibo-rotulo">Impressão digital (Hash SHA-256)</span>
                <span className="recibo-dado mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  {resultadoAprovacao.hash?.slice(0, 16)}... ({resultadoAprovacao.hash})
                </span>
              </div>
            </div>

            {qrComprovante && (
              <div className="recibo-qr-bloco">
                <img src={qrComprovante} alt="QR Code" width={110} height={110} />
                <span className="texto-suave" style={{ fontSize: 11, marginTop: 4 }}>
                  Aponte a câmera para verificar a autenticidade online
                </span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--cor-primaria)' }}>
                  cotacompara.amp.ia.br/v/{resultadoAprovacao.codigo}
                </span>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
