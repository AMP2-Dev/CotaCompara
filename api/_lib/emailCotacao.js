// Monta o e-mail de convite para o fornecedor (HTML compatível com Gmail/Outlook + texto puro)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const qtd = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

const dataHora = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const numeroCotacao = (n) => '#' + String(n || 0).padStart(4, '0')

const MAX_ITENS_EMAIL = 15

export function montarEmailCotacao({ empresa, cotacao, itens, fornecedor, link, reenvio = false, tipo = 'convite', usuario = false, linkPainel = null }) {
  const correcao = tipo === 'correcao'
  const prazo = dataHora(cotacao.prazo_resposta)
  const local = [empresa.cidade, empresa.uf].filter(Boolean).join(' / ')
  const visiveis = itens.slice(0, MAX_ITENS_EMAIL)
  const resto = itens.length - visiveis.length
  const saudacao = fornecedor.contato || fornecedor.nome

  const assunto = correcao
    ? `Correção liberada: cotação ${numeroCotacao(cotacao.numero)} — ${empresa.nome}`
    : `${reenvio ? 'Lembrete: ' : ''}Pedido de cotação ${numeroCotacao(cotacao.numero)} — ${empresa.nome}`

  const linhasItens = visiveis.map((i, n) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #EEEEEE;color:#999999;font-size:12px;">${n + 1}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEEEEE;font-size:14px;color:#333333;">${esc(i.produto)}${i.observacao ? `<div style="font-size:12px;color:#888888;">${esc(i.observacao)}</div>` : ''}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEEEEE;font-size:14px;color:#333333;text-align:right;white-space:nowrap;">${qtd(i.quantidade)} ${esc(i.unidade)}</td>
      </tr>`).join('')

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#EBEBEB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBEBEB;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#FFE600;padding:16px 28px;">
        <span style="font-size:19px;font-weight:bold;color:#2D3277;">Cota</span><span style="font-size:19px;font-weight:bold;color:#3483FA;">Compara</span>
      </td></tr>
      <tr><td style="padding:28px 28px 6px;">
        <p style="margin:0 0 4px;font-size:13px;color:#888888;">Pedido de cotação de</p>
        <h1 style="margin:0;font-size:22px;color:#333333;">${esc(empresa.nome)}</h1>
        <p style="margin:4px 0 0;font-size:13px;color:#888888;">${[empresa.cnpj && 'CNPJ ' + esc(empresa.cnpj), esc(local), esc(empresa.telefone)].filter(Boolean).join(' · ')}</p>
      </td></tr>
      <tr><td style="padding:18px 28px 0;">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#444444;">Olá, ${esc(saudacao)}!
          ${correcao
            ? `A <strong>${esc(empresa.nome)}</strong> liberou a <strong>correção da sua proposta</strong>. Abra o link, ajuste os valores que precisar e envie. Os valores enviados antes ficam registrados.`
            : `${reenvio ? 'Passando para lembrar do pedido abaixo. ' : ''}Gostaríamos de receber seu preço para os itens abaixo. É rápido: abra o link, digite o preço unitário e envie. <strong>Não precisa de cadastro.</strong>`}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F7F7;border-radius:8px;">
          <tr><td style="padding:12px 14px;font-size:14px;color:#333333;">
            <strong>${esc(cotacao.titulo)}</strong> <span style="color:#999999;font-family:monospace;">${numeroCotacao(cotacao.numero)}</span><br>
            <span style="color:#666666;">${itens.length} ${itens.length === 1 ? 'item' : 'itens'}${prazo ? ` · responder até <strong>${prazo}</strong>` : ''}</span>
          </td></tr>
        </table>
        ${cotacao.observacoes ? `<p style="margin:14px 0 0;padding:10px 14px;background:#E3EDFB;border-radius:8px;font-size:13px;line-height:1.5;color:#1F4E96;white-space:pre-wrap;">${esc(cotacao.observacoes)}</p>` : ''}
      </td></tr>
      <tr><td align="center" style="padding:24px 28px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#3483FA;">
          <a href="${esc(link)}" style="display:inline-block;padding:15px 34px;font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px;">${correcao ? 'Corrigir proposta' : 'Responder cotação'}</a>
        </td></tr></table>
        ${usuario && linkPainel ? `<p style="margin:12px 0 0;font-size:13px;color:#00753A;">⚡ Você usa o CotaCompara: este pedido já está no seu painel (menu Clientes), com os preços do seu catálogo.<br><a href="${esc(linkPainel)}" style="color:#3483FA;">Responder pelo painel</a></p>` : ''}
      </td></tr>
      <tr><td style="padding:16px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888888;text-transform:uppercase;border-bottom:2px solid #EEEEEE;">#</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888888;text-transform:uppercase;border-bottom:2px solid #EEEEEE;">Produto</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;color:#888888;text-transform:uppercase;border-bottom:2px solid #EEEEEE;">Quantidade</th>
          </tr>
          ${linhasItens}
        </table>
        ${resto > 0 ? `<p style="margin:10px 0 0;font-size:13px;color:#888888;">+ ${resto} ${resto === 1 ? 'item' : 'itens'} — veja a lista completa no link.</p>` : ''}
      </td></tr>
      <tr><td style="padding:22px 28px 26px;">
        <p style="margin:0;padding-top:14px;border-top:1px solid #EEEEEE;font-size:12px;line-height:1.6;color:#999999;">
          Se o botão não funcionar, copie este endereço: <a href="${esc(link)}" style="color:#3483FA;word-break:break-all;">${esc(link)}</a><br>
          Dúvidas? É só responder este e-mail — a mensagem vai direto para ${esc(empresa.nome)}.<br>
          Enviado pelo CotaCompara · cotacompara.amp.ia.br
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`

  const texto = [
    `Pedido de cotação de ${empresa.nome}${empresa.cnpj ? ' (CNPJ ' + empresa.cnpj + ')' : ''}`,
    '',
    correcao
      ? `Olá, ${saudacao}! ${empresa.nome} liberou a correção da sua proposta. Os valores enviados antes ficam registrados.`
      : `Olá, ${saudacao}!${reenvio ? ' Passando para lembrar do pedido abaixo.' : ''}`,
    `Cotação: ${cotacao.titulo} ${numeroCotacao(cotacao.numero)}`,
    prazo ? `Responder até: ${prazo}` : null,
    '',
    'Itens:',
    ...visiveis.map((i, n) => `${n + 1}. ${i.produto} — ${qtd(i.quantidade)} ${i.unidade}`),
    resto > 0 ? `+ ${resto} itens (veja no link)` : null,
    '',
    `Responda pelo link (sem cadastro): ${link}`,
    '',
    'Dúvidas? Responda este e-mail.',
  ].filter((l) => l !== null).join('\n')

  return { assunto, html, texto }
}
