// E-mail do orçamento que o fornecedor envia ao cliente (HTML compatível com Gmail/Outlook + texto puro)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const qtd = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const moeda = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const data = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
export const numeroDoc = (n) => '#' + String(n || 0).padStart(4, '0')

const MAX_ITENS = 25

export function montarEmailOrcamento({ empresa, orcamento, itens, link }) {
  const aprovado = orcamento.status === 'aprovado'
  const sub = itens.reduce((s, i) => s + (i.preco_unitario == null ? 0 : Math.round(i.quantidade * i.preco_unitario * 100) / 100), 0)
  const total = Math.max(sub - Number(orcamento.desconto || 0), 0) + Number(orcamento.frete || 0)
  const validoAte = new Date(new Date(orcamento.enviado_em || orcamento.created_at || Date.now()).getTime() + orcamento.validade_dias * 86400000)
  const visiveis = itens.slice(0, MAX_ITENS)
  const resto = itens.length - visiveis.length
  const local = [empresa.cidade, empresa.uf].filter(Boolean).join(' / ')
  const ola = orcamento.cliente_nome ? `Olá, ${esc(orcamento.cliente_nome)}!` : 'Olá!'

  const assunto = aprovado
    ? `Comprovante de Aprovação — Orçamento ${numeroDoc(orcamento.numero)} (${empresa.nome})`
    : `Orçamento ${numeroDoc(orcamento.numero)} — ${empresa.nome}${orcamento.referencia ? ` (${orcamento.referencia})` : ''}`

  const linhas = visiveis.map((i, n) => `
      <tr>
        <td style="padding:7px 8px;border-bottom:1px solid #EEEEEE;color:#999999;font-size:12px;">${n + 1}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #EEEEEE;font-size:13px;color:#333333;">${esc(i.produto)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #EEEEEE;font-size:13px;color:#333333;text-align:right;white-space:nowrap;">${qtd(i.quantidade)} ${esc(i.unidade)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #EEEEEE;font-size:13px;color:#333333;text-align:right;white-space:nowrap;">${i.preco_unitario == null ? '<span style="color:#999999;">não disp.</span>' : moeda(i.preco_unitario)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #EEEEEE;font-size:13px;color:#333333;text-align:right;white-space:nowrap;font-weight:bold;">${i.preco_unitario == null ? '—' : moeda(Math.round(i.quantidade * i.preco_unitario * 100) / 100)}</td>
      </tr>`).join('')

  const condicoes = [
    orcamento.prazo_entrega && `Prazo de entrega: <strong>${esc(orcamento.prazo_entrega)}</strong>`,
    orcamento.condicao_pagamento && `Pagamento: <strong>${esc(orcamento.condicao_pagamento)}</strong>`,
    orcamento.frete != null && `Frete: <strong>${Number(orcamento.frete) ? moeda(orcamento.frete) : 'grátis'}</strong>`,
    Number(orcamento.desconto) > 0 && `Desconto: <strong>${moeda(orcamento.desconto)}</strong>`,
    !aprovado && `Válido até: <strong>${data(validoAte)}</strong>`,
  ].filter(Boolean).join('<br>')

  const aprovacaoBloco = aprovado ? `
    <div style="background:#ECFDF5;border:1px solid #10B981;border-radius:8px;padding:14px 18px;margin-bottom:16px;">
      <p style="margin:0;font-size:14px;color:#065F46;font-weight:bold;">
        ✅ Orçamento Aprovado ${orcamento.aprovacao_codigo ? `— Código #${esc(orcamento.aprovacao_codigo)}` : ''}
      </p>
      ${orcamento.aprovado_por ? `<p style="margin:4px 0 0;font-size:13px;color:#047857;">Signatário / Aprovado por: <strong>${esc(orcamento.aprovado_por)}</strong>${orcamento.aprovacao_documento ? ` (${esc(orcamento.aprovacao_doc_tipo || 'Doc')}: ${esc(orcamento.aprovacao_documento)})` : ''}</p>` : ''}
      ${orcamento.aprovado_em ? `<p style="margin:2px 0 0;font-size:12px;color:#059669;">Data da aprovação: ${data(orcamento.aprovado_em)}</p>` : ''}
    </div>
  ` : ''

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#EBEBEB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBEBEB;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px 28px 14px;border-bottom:3px solid ${aprovado ? '#10B981' : '#FFE600'};">
        <p style="margin:0 0 2px;font-size:12px;color:#888888;text-transform:uppercase;letter-spacing:1px;">Orçamento ${numeroDoc(orcamento.numero)}</p>
        <h1 style="margin:0;font-size:22px;color:#333333;">${esc(empresa.nome)}</h1>
        <p style="margin:4px 0 0;font-size:13px;color:#888888;">${[empresa.cnpj && 'CNPJ ' + esc(empresa.cnpj), esc(local), esc(empresa.telefone)].filter(Boolean).join(' · ')}</p>
      </td></tr>
      <tr><td style="padding:18px 28px 0;">
        ${aprovacaoBloco}
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#444444;">${ola} Segue o nosso orçamento${orcamento.referencia ? ` para <strong>${esc(orcamento.referencia)}</strong>` : ''}.${aprovado ? ' Este orçamento foi aprovado formalmente e você pode acessar o comprovante eletrônico pelo link abaixo.' : ' Você pode ver todos os detalhes, baixar em PDF e aprovar pelo botão abaixo.'}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EEEEEE;border-radius:8px;">
          <tr style="background:#FAFAFA;">
            <td style="padding:7px 8px;font-size:11px;color:#888888;">#</td>
            <td style="padding:7px 8px;font-size:11px;color:#888888;text-transform:uppercase;">Produto</td>
            <td style="padding:7px 8px;font-size:11px;color:#888888;text-align:right;text-transform:uppercase;">Qtd</td>
            <td style="padding:7px 8px;font-size:11px;color:#888888;text-align:right;text-transform:uppercase;">Unit.</td>
            <td style="padding:7px 8px;font-size:11px;color:#888888;text-align:right;text-transform:uppercase;">Subtotal</td>
          </tr>
          ${linhas}
          ${resto > 0 ? `<tr><td colspan="5" style="padding:8px;font-size:13px;color:#888888;">+ ${resto} ${resto === 1 ? 'item' : 'itens'} — veja todos no link</td></tr>` : ''}
          <tr><td colspan="4" style="padding:10px 8px;font-size:15px;color:#333333;text-align:right;"><strong>Total</strong></td>
              <td style="padding:10px 8px;font-size:17px;color:#2D3277;text-align:right;white-space:nowrap;"><strong>${moeda(total)}</strong></td></tr>
        </table>
        <p style="margin:14px 0 0;font-size:13px;line-height:1.7;color:#555555;">${condicoes}</p>
        ${orcamento.observacoes ? `<p style="margin:10px 0 0;font-size:13px;color:#555555;"><strong>Observações:</strong> ${esc(orcamento.observacoes)}</p>` : ''}
      </td></tr>
      <tr><td align="center" style="padding:24px 28px;">
        <a href="${link}" style="display:inline-block;background:${aprovado ? '#0284C7' : '#00A650'};color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 32px;border-radius:8px;">
          ${aprovado ? 'Ver orçamento aprovado e comprovante' : 'Ver orçamento e aprovar'}
        </a>
        <p style="margin:12px 0 0;font-size:12px;color:#999999;">Ou responda este e-mail para falar com ${esc(empresa.nome)}.</p>
      </td></tr>
      <tr><td style="background:#FAFAFA;padding:14px 28px;font-size:11px;color:#999999;text-align:center;">
        Orçamento enviado pelo CotaCompara · cotacompara.amp.ia.br
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`

  const texto = [
    `${aprovado ? '[APROVADO] ' : ''}Orçamento ${numeroDoc(orcamento.numero)} — ${empresa.nome}`,
    orcamento.cliente_nome ? `Para: ${orcamento.cliente_nome}` : null,
    aprovado && orcamento.aprovacao_codigo ? `Aprovação: #${orcamento.aprovacao_codigo}${orcamento.aprovado_por ? ` por ${orcamento.aprovado_por}` : ''}` : null,
    '',
    ...itens.map((i, n) => `${n + 1}. ${i.produto} — ${qtd(i.quantidade)} ${i.unidade} x ${i.preco_unitario == null ? 'não disponível' : moeda(i.preco_unitario)}`),
    '',
    `Total: ${moeda(total)}`,
    !aprovado ? `Válido até ${data(validoAte)}` : null,
    '',
    `${aprovado ? 'Ver detalhes e comprovante eletrônico' : 'Ver detalhes, baixar PDF e aprovar'}: ${link}`,
  ].filter((l) => l !== null).join('\n')

  return { assunto, html, texto }
}
