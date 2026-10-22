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
  const [prontoParaEnviar, setProntoParaEnviar] = useState(true)

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

    return () => {
      ativo = false
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
          <p className="texto-suave">
            {erroInicial === 'LINK_DESATIVADO'
              ? 'Este canal de pedidos foi temporariamente pausado pela empresa. Tente novamente mais tarde ou entre em contato direto.'
              : erroInicial === 'LINK_INVALIDO'
              ? 'O link que você acessou não existe ou foi alterado pela empresa.'
              : erroInicial}
          </p>
        </div>
      </div>
    )
  }

  if (sucesso) {
    return (
      <div className="pedido-link-pagina">
        <div className="pedido-link-container">
          <div className="card pedido-sucesso-card">
            <div className="sucesso-icone">✓</div>
            <h2>Pedido enviado com sucesso!</h2>
            <p className="texto-suave">
              A empresa <b>{empresa.nome}</b> recebeu seus itens e vai preparar o seu orçamento.
            </p>

            <div className="pedido-protocolo-bloco">
              <span className="rotulo">Número do protocolo</span>
              <span className="mono valor">{sucesso.protocolo}</span>
              <small className="texto-suave">Guarde este código para acompanhar ou tirar dúvidas.</small>
            </div>

            <div className="alerta alerta-info" style={{ textAlign: 'left', marginTop: 16 }}>
              Assim que os preços e condições estiverem prontos, a empresa entrará em contato pelo seu{' '}
              {whatsapp && email ? 'WhatsApp ou e-mail' : whatsapp ? 'WhatsApp' : 'e-mail'}.
            </div>

            <button
              type="button"
              className="btn btn-secundario"
              style={{ marginTop: 20 }}
              onClick={() => {
                setSucesso(null)
                setNome('')
                setWhatsapp('')
                setEmail('')
                setDocumento('')
                setObservacoes('')
                setItens([itemVazio(), itemVazio(), itemVazio()])
              }}
            >
              Fazer outro pedido para esta empresa
            </button>
          </div>
        </div>
      </div>
    )
  }

  const local = [empresa.cidade, empresa.uf].filter(Boolean).join(' / ')

  return (
    <div className="pedido-link-pagina">
      <div className="pedido-link-container">
        {/* Topo da empresa */}
        <div className="pedido-link-topo card">
          <div className="empresa-info">
            <span className="badge-topo">Solicitação de Orçamento</span>
            <h1>{empresa.nome}</h1>
            <div className="empresa-meta texto-suave">
              {empresa.documento && <span>{mascaraDocumento(empresa.documento)}</span>}
              {local && <span>{local}</span>}
              {empresa.telefone && <span>{empresa.telefone}</span>}
            </div>
            <p className="empresa-descricao">
              Preencha os itens que você precisa e seus dados de contato. Nós retornaremos com o orçamento completo.
            </p>
          </div>
        </div>

        {/* Formulário de envio */}
        <form onSubmit={enviar} className="pedido-link-form card">
          {erroEnvio && <div className="alerta alerta-erro" style={{ marginBottom: 16 }}>{erroEnvio}</div>}

          {/* Campo honeypot invisível para enganar bots de spam */}
          <div style={{ position: 'absolute', left: '-9999px', opacity: 0 }} aria-hidden="true">
            <input
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              placeholder="Não preencha este campo"
            />
          </div>

          <div className="secao-form">
            <h3>1. Seus dados de contato</h3>
            <div className="campo">
              <label>Seu nome ou Razão Social *</label>
              <input
                className="input"
                placeholder="Ex.: Maria Souza ou Papelaria Brasil Ltda"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={120}
                required
              />
            </div>

            <div className="linha-campos">
              <div className="campo">
                <label>WhatsApp <small>(com DDD)</small></label>
                <input
                  className="input"
                  type="tel"
                  placeholder="(19) 99999-0000"
                  value={whatsapp}
                  onChange={(e) => handleWhatsapp(e.target.value)}
                  maxLength={15}
                />
              </div>

              <div className="campo">
                <label>E-mail</label>
                <input
                  className="input"
                  type="email"
                  placeholder="seu@email.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={120}
                />
              </div>
            </div>

            <div className="campo">
              <label>CNPJ ou CPF <small>(opcional)</small></label>
              <input
                className="input"
                placeholder="Para emissão de nota ou faturamento"
                value={documento}
                onChange={(e) => setDocumento(mascaraDocumento(e.target.value))}
                maxLength={18}
              />
            </div>
          </div>

          <div className="secao-form">
            <div className="secao-form-cab">
              <h3>2. O que você precisa cotar? (até 10 itens)</h3>
              <small className="texto-suave">Digite o produto e a quantidade</small>
            </div>

            <div className="pedido-itens-lista">
              {itens.map((it, idx) => (
                <div key={idx} className="pedido-item-linha">
                  <span className="item-num">{idx + 1}</span>
                  <div className="item-campos">
                    <div className="item-linha-principal">
                      <input
                        className="input item-prod"
                        placeholder="Nome do produto ou descrição"
                        value={it.produto}
                        onChange={(e) => mudarItem(idx, 'produto', e.target.value)}
                        maxLength={200}
                      />
                      <div className="item-qtd-un">
                        <input
                          className="input item-qtd"
                          inputMode="decimal"
                          placeholder="Qtd"
                          value={it.quantidade}
                          onChange={(e) => mudarItem(idx, 'quantidade', e.target.value)}
                        />
                        <select
                          className="select item-un"
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
              {enviando ? 'Enviando seu pedido...' : 'Enviar pedido de orçamento'}
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
