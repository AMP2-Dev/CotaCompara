import { useEffect, useState } from 'react'
import { formatarData } from '../lib/format'
import { mascaraCnpj, mascaraCpf } from '../lib/cnpj'

export default function CarimboAprovacao({
  codigo,
  aprovadoEm,
  aprovadoPor,
  docTipo,
  documento,
  dados,
  hash,
  className = '',
}) {
  const [qrUrl, setQrUrl] = useState('')

  const urlVerificacao = `https://cotacompara.amp.ia.br/v/${codigo}`

  useEffect(() => {
    if (!codigo) return
    let ativo = true
    import('qrcode')
      .then((QRCode) => QRCode.toDataURL(urlVerificacao, { margin: 1, width: 96, errorCorrectionLevel: 'M' }))
      .then((url) => {
        if (ativo) setQrUrl(url)
      })
      .catch((err) => console.error('Erro ao gerar QR Code', err))
    return () => { ativo = false }
  }, [codigo, urlVerificacao])

  if (!codigo) return null

  const docMascarado = () => {
    if (!documento) return null
    const d = String(documento).replace(/\D/g, '')
    if (docTipo === 'CNPJ' || d.length === 14) return mascaraCnpj(d)
    if (docTipo === 'CPF' || d.length === 11) return mascaraCpf(d)
    return documento
  }

  const hashCurto = hash ? String(hash).slice(0, 16) : null
  const razaoSocial = dados?.razao_social || null

  return (
    <div className={`carimbo-aprovacao ${className}`}>
      <div className="carimbo-corpo">
        <div className="carimbo-info">
          <div className="carimbo-topo">
            <span className="carimbo-icone">✓</span>
            <span className="carimbo-titulo">APROVADO ELETRONICAMENTE</span>
            <span className="carimbo-codigo mono">{codigo}</span>
          </div>

          <div className="carimbo-linhas">
            <div>
              <b>Data/Hora:</b> {formatarData(aprovadoEm)}
            </div>
            <div>
              <b>Aprovado por:</b> {aprovadoPor} {docMascarado() && <span className="mono">({docTipo || 'DOC'}: {docMascarado()})</span>}
            </div>
            {razaoSocial && razaoSocial !== aprovadoPor && (
              <div>
                <b>Razão Social:</b> {razaoSocial}
              </div>
            )}
            {hashCurto && (
              <div className="carimbo-hash">
                <b>Hash SHA-256:</b> <span className="mono">{hashCurto}...</span>
              </div>
            )}
          </div>

          <div className="carimbo-rodape">
            Assinatura eletrônica simples (Lei 14.063/2020) · Verifique em <span className="mono">cotacompara.amp.ia.br/v/{codigo}</span>
          </div>
        </div>

        {qrUrl && (
          <div className="carimbo-qr">
            <img src={qrUrl} alt={`QR Code de verificação: ${codigo}`} width={76} height={76} />
            <span className="carimbo-qr-label">Escanear</span>
          </div>
        )}
      </div>
    </div>
  )
}
