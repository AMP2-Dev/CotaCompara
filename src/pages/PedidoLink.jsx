import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, mensagemErro } from '../lib/supabase'
import { UNIDADES, parseNumero } from '../lib/format'
import { mascaraDocumento } from '../lib/cnpj'
import Logo from '../components/Logo'
import Carregando from '../components/Carregando'

const itemVazio = () => ({ produto: '', quantidade: '1', unidade: 'UN', observacao: '' })

export default function PedidoLink() {
  const { token } = useParams()
  const [empresa, setEmpresa] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erroInicial, setErroInicial] = useState('')

  // Formulário do cliente
  const [nome, setNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [documento, setDocumento] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [itens, setItens] = useState([itemVazio(), itemVazio(), itemVazio()])

  // Antispam
  const [honeypot, setHoneypot] = useState('')
  const [prontoParaEnviar, setProntoParaEnviar] = useState(false)

  // Envio e resultado
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')
  const [sucesso, setSucesso] = useState(null) // { protocolo, criado_em }

  useEffect(() => {
    let ativo = true
    const carregar = async () => {
      const { data, error } = await supabase.rpc('empresa_link_publico', { p_token: token })
      if (!ativo) return
      if (error) {
        setErroInicial(mensagemErro(error))
      } else {
        setEmpresa(data)
      }
      setCarregando(false)
    }
    carregar()

    // Botão fica desabilitado por 3s após abrir a tela (antispam)
    const t = setTimeout(() => {
      if (ativo) setProntoParaEnviar(true)
    }, 3000)

    return () => {
      ativo = false
      clearTimeout(t)
    }
  }, [token])

  const mudarItem = (idx, campo, valor) => {
    setItens((prev) => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], [campo]: valor }
      return copy
    })
  }

  const adicionarItem = () => {
    if (itens.length >= 10) return
    setItens((prev) => [...prev, itemVazio()])
  }

  const removerItem = (idx) => {
    if (itens.length <= 1) return
    setItens((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleWhatsapp = (val) => {
    const d = String(val).replace(/\D/g, '').slice(0, 11)
    if (d.length <= 10) {
      setWhatsapp(d.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').trim())
    } else {
      setWhatsapp(d.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').trim())
    }
  }

  const enviar = async (e) => {
    e.preventDefault()
    setErroEnvio('')

    // Se o honeypot veio preenchido, bot caiu na armadilha: simula sucesso sem gravar nada
    if (honeypot) {
      setSucesso({ protocolo: 'PED-SPAM-OK', criado_em: new Date().toISOString() })
      return
    }

    if (!nome.trim()) {
      setErroEnvio('Informe seu nome ou o nome da sua empresa.')
      return
    }

    if (!whatsapp.trim() && !email.trim()) {
      setErroEnvio('Informe seu WhatsApp ou e-mail para que a empresa possa responder seu pedido.')
      return
    }

    const itensValidos = itens
      .map((i) => ({
        produto: i.produto.trim(),
        quantidade: parseNumero(i.quantidade),
        unidade: i.unidade || 'UN',
        observacao: i.observacao.trim() || null,
      }))
      .filter((i) => i.produto.length > 0)

    if (itensValidos.length === 0) {
      setErroEnvio('Informe pelo menos um produto para o pedido.')
      return
    }

    if (itensValidos.length > 10) {
      setErroEnvio('Máximo de 10 itens por pedido.')
      return
    }

    for (const it of itensValidos) {
      if (it.produto.length < 2) {
        setErroEnvio(`O produto "${it.produto}" precisa ter pelo menos 2 caracteres.`)
        return
      }
      if (!Number.isFinite(it.quantidade) || it.quantidade <= 0) {
        setErroEnvio(`Quantidade inválida para o produto "${it.produto}".`)
        return
      }
    }

    setEnviando(true)
    const clientePayload = {
      nome: nome.trim(),
      whatsapp: whatsapp.trim() || null,
      email: email.trim() || null,
      documento: documento.trim() ? documento.replace(/\D/g, '') : null,
      observacoes: observacoes.trim() || null,
    }

    const { data, error } = await supabase.rpc('criar_pedido_link', {
      p_token: token,
      p_cliente: clientePayload,
      p_itens: itensValidos,
    })

    setEnviando(false)
    if (error) {
      setErroEnvio(mensagemErro(error))
    } else {
      setSucesso(data)
    }
  }

  if (carregando) return <Carregando />

  if (erroInicial) {
    return (
      <div className="orc-pub-erro">
        <Logo to={null} />
        <div className="card" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>Link indisponível</h2>
          <p className="texto-suave">{erroInicial}</p>
        </div>
      </div>
    )
  }

  const localizacao = [empresa?.cidade, empresa?.uf].filter(Boolean).join(' / ')

  if (sucesso) {
    return (
      <div className="pedido-link-wrap">
        <div className="pedido-link-card sucesso">
          <div className="sucesso-icone">✓</div>
          <h2>Pedido enviado com sucesso!</h2>
          <p className="sucesso-sub">
            Protocolo: <b className="mono destaque-proto">{sucesso.protocolo}</b>
          </p>
          <p className="sucesso-texto">
            A empresa <b>{empresa?.nome}</b> recebeu seu pedido de orçamento e responderá pelo{' '}
            {whatsapp && email ? 'WhatsApp ou e-mail' : whatsapp ? 'WhatsApp' : 'e-mail'} informado.
          </p>

          <div className="sucesso-acoes">
            <button
              className="btn btn-secundario"
              onClick={() => {
                setSucesso(null)
                setItens([itemVazio(), itemVazio(), itemVazio()])
                setObservacoes('')
              }}
            >
              Fazer outro pedido
            </button>
          </div>

          <div className="pedido-link-cta">
            <Logo to={null} />
            <div>
              <b>Você também compra para sua empresa ou condomínio?</b>
              <p>Com o CotaCompara você envia cotações para vários fornecedores e compara os preços automaticamente.</p>
              <Link to="/cadastro" className="btn btn-primario btn-pequeno">
                Conhecer o CotaCompara grátis
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pedido-link-wrap">
      <div className="pedido-link-card">
        <header className="pedido-link-cab">
          <div className="pedido-link-subtitulo">Pedido de orçamento direto para</div>
          <h1 className="pedido-link-titulo">{empresa?.nome}</h1>
          {localizacao && <div className="pedido-link-local">{localizacao}</div>}
        </header>

        {erroEnvio && <div className="alerta alerta-erro">{erroEnvio}</div>}

        <form onSubmit={enviar}>
          {/* Honeypot invisível para bots */}
          <div style={{ display: 'none' }} aria-hidden="true">
            <label>Não preencha este campo:</label>
            <input
              type="text"
              name="empresa_site"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <div className="secao-form">
            <h3>1. Seus dados de contato</h3>
            <div className="campo">
              <label>
                Seu nome ou Razão Social <span className="obrigatorio">*</span>
              </label>
              <input
                className="input"
                placeholder="Ex.: João Silva ou Silva Materiais Ltda"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={120}
                required
              />
            </div>

            <div className="grid grid-2-col">
              <div className="campo">
                <label>WhatsApp</label>
                <input
                  className="input"
                  type="tel"
                  placeholder="(00) 00000-0000"
                  value={whatsapp}
                  onChange={(e) => handleWhatsapp(e.target.value)}
                />
              </div>

              <div className="campo">
                <label>E-mail</label>
                <input
                  className="input"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={120}
                />
              </div>
            </div>
            <p className="texto-suave" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>
              * Informe pelo menos WhatsApp ou e-mail para receber o orçamento.
            </p>

            <div className="campo">
              <label>CNPJ ou CPF (opcional)</label>
              <input
                className="input mono"
                placeholder="00.000.000/0000-00"
                value={documento}
                onChange={(e) => setDocumento(mascaraDocumento(e.target.value))}
              />
            </div>
          </div>

          <div className="secao-form">
            <div className="secao-form-topo">
              <h3>2. Produtos que você precisa</h3>
              <span className="texto-suave" style={{ fontSize: 13 }}>
                {itens.length}/10 itens
              </span>
            </div>

            <div className="pedido-itens-lista">
              {itens.map((it, idx) => (
                <div key={idx} className="pedido-item-linha">
                  <div className="pedido-item-num">{idx + 1}</div>
                  <div className="pedido-item-campos">
                    <div className="pedido-item-principal">
                      <input
                        className="input"
                        placeholder="Nome ou descrição do produto *"
                        value={it.produto}
                        onChange={(e) => mudarItem(idx, 'produto', e.target.value)}
                        maxLength={200}
                      />
                    </div>
                    <div className="pedido-item-detalhes">
                      <div className="item-qtd-wrap">
                        <label className="rotulo-mini">Qtd</label>
                        <input
                          className="input"
                          type="text"
                          inputMode="decimal"
                          placeholder="1"
                          value={it.quantidade}
                          onChange={(e) => mudarItem(idx, 'quantidade', e.target.value)}
                        />
                      </div>
                      <div className="item-un-wrap">
                        <label className="rotulo-mini">Unid.</label>
                        <select
                          className="input select"
                          value={it.unidade}
                          onChange={(e) => mudarItem(idx, 'unidade', e.target.value)}
                        >
                          {UNIDADES.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <input
                      className="input input-mini"
                      placeholder="Observação (marca preferida, modelo, cor...)"
                      value={it.observacao}
                      onChange={(e) => mudarItem(idx, 'observacao', e.target.value)}
                      maxLength={200}
                    />
                  </div>
                  {itens.length > 1 && (
                    <button
                      type="button"
                      className="btn-remover-item"
                      title="Remover este item"
                      onClick={() => removerItem(idx)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="pedido-itens-botoes">
              {itens.length < 10 ? (
                <button type="button" className="btn btn-secundario btn-pequeno" onClick={adicionarItem}>
                  + Adicionar outro item
                </button>
              ) : (
                <span className="texto-suave" style={{ fontSize: 13 }}>
                  Máximo de 10 itens atingido.
                </span>
              )}
            </div>
          </div>

          <div className="secao-form">
            <h3>3. Observações gerais (opcional)</h3>
            <textarea
              className="input textarea"
              rows={3}
              placeholder="Ex.: Local de entrega, prazo em que precisa, necessidade de nota fiscal..."
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              maxLength={1000}
            />
          </div>

          <div className="pedido-envio-acoes">
            <button
              type="submit"
              className="btn btn-primario btn-grande btn-bloco"
              disabled={enviando || !prontoParaEnviar}
            >
              {enviando ? 'Enviando seu pedido...' : !prontoParaEnviar ? 'Aguarde um instante...' : 'Enviar pedido de orçamento'}
            </button>
            <p className="texto-suave" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>
              Ao enviar, a empresa receberá sua lista para precificar e responder.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
