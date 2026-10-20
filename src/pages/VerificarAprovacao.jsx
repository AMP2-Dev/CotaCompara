import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, mensagemErro } from '../lib/supabase'
import { numeroCotacao, formatarData, formatarMoeda } from '../lib/format'
import Logo from '../components/Logo'
import Carregando from '../components/Carregando'

export default function VerificarAprovacao() {
  const { codigo } = useParams()
  const [dados, setDados] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    const verificar = async () => {
      setCarregando(true)
      setErro('')
      const { data, error } = await supabase.rpc('verificar_aprovacao', { p_codigo: codigo })
      if (!ativo) return
      if (error) {
        setErro(mensagemErro(error))
      } else {
        setDados(data)
      }
      setCarregando(false)
    }
    verificar()
    return () => { ativo = false }
  }, [codigo])

  if (carregando) return <Carregando />

  return (
    <div className="verificar-wrap">
      <div className="verificar-topo">
        <Logo to="/" />
      </div>

      <div className="verificar-card">
        {erro ? (
          <div className="verificar-erro">
            <div className="status-icone status-erro">✕</div>
            <h2>Código de aprovação não encontrado</h2>
            <p className="texto-suave">
              O código informado <b>{codigo}</b> não foi localizado na base de registros do CotaCompara.
            </p>
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Verifique se digitou o código corretamente ou escaneou o QR Code do comprovante original.
            </p>
          </div>
        ) : dados?.integro ? (
          <div className="verificar-sucesso">
            <div className="status-icone status-ok">✓</div>
            <h2 className="titulo-valido">Aprovação válida e íntegra</h2>
            <p className="subtitulo-valido">O conteúdo deste orçamento não sofreu nenhuma alteração após ser aprovado.</p>

            <div className="verificar-info-grid">
              <div className="info-bloco">
                <span className="info-rotulo">Código de registro</span>
                <span className="info-valor mono destaque-cod">{codigo}</span>
              </div>

              <div className="info-bloco">
                <span className="info-rotulo">Fornecedor emissor</span>
                <span className="info-valor">
                  <b>{dados.fornecedor?.nome}</b>
                  {dados.fornecedor?.cnpj && <small className="mono"> · CNPJ {dados.fornecedor.cnpj}</small>}
                </span>
              </div>

              <div className="info-bloco">
                <span className="info-rotulo">Orçamento</span>
                <span className="info-valor mono">{numeroCotacao(dados.numero)}</span>
              </div>

              <div className="info-bloco">
                <span className="info-rotulo">Valor total aprovado</span>
                <span className="info-valor">{formatarMoeda(dados.total)}</span>
              </div>

              <div className="info-bloco">
                <span className="info-rotulo">Aprovado por</span>
                <span className="info-valor">
                  <b>{dados.cliente?.nome}</b>
                  {dados.cliente?.documento && (
                    <small className="mono"> ({dados.cliente?.doc_tipo || 'Doc'}: {dados.cliente.documento})</small>
                  )}
                  {dados.cliente?.dados?.razao_social && dados.cliente?.dados?.razao_social !== dados.cliente?.nome && (
                    <small> · {dados.cliente.dados.razao_social}</small>
                  )}
                </span>
              </div>

              <div className="info-bloco">
                <span className="info-rotulo">Data e hora da aprovação</span>
                <span className="info-valor">{formatarData(dados.aprovado_em)}</span>
              </div>

              {dados.validade && (
                <div className="info-bloco">
                  <span className="info-rotulo">Validade da proposta</span>
                  <span className="info-valor">{formatarData(dados.validade, false)}</span>
                </div>
              )}

              <div className="info-bloco info-full">
                <span className="info-rotulo">Impressão digital criptográfica (SHA-256)</span>
                <span className="info-valor mono hash-quebra">{dados.hash}</span>
              </div>
            </div>

            <div className="base-legal-nota">
              Assinatura eletrônica simples registrada conforme os termos da Lei Federal nº 14.063/2020.
            </div>
          </div>
        ) : (
          <div className="verificar-alerta-invalido">
            <div className="status-icone status-aviso">!</div>
            <h2 className="titulo-invalido">Atenção: integridade não confirmada</h2>
            <p className="subtitulo-invalido">
              O conteúdo deste orçamento foi alterado ou não corresponde ao registro original gerado no momento da aprovação.
            </p>

            <div className="verificar-info-grid">
              <div className="info-bloco">
                <span className="info-rotulo">Código de registro</span>
                <span className="info-valor mono">{codigo}</span>
              </div>
              <div className="info-bloco">
                <span className="info-rotulo">Fornecedor</span>
                <span className="info-valor">{dados?.fornecedor?.nome}</span>
              </div>
            </div>
          </div>
        )}

        <div className="verificar-rodape-acoes">
          <Link to="/" className="btn btn-secundario">Ir para o CotaCompara</Link>
        </div>
      </div>
    </div>
  )
}
