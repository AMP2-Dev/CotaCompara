# CotaCompara — Fase 3.5 (CNPJ + resultados + impressão)

Plataforma de cotação de preços: o comprador monta a cotação, os fornecedores
recebem um link por e-mail e preenchem só o preço, sem login.

**Stack:** React + Vite (Vercel) · Supabase (Auth, Postgres, RLS, Realtime) · Resend (e-mail, fase 4)
**Domínio:** https://cotacompara.amp.ia.br

---

## O que tem na fase 1

- Schema completo do banco (todas as tabelas das fases 1 a 5) com RLS
- Funções públicas do fornecedor (`cotacao_publica` e `responder_cotacao`), já prontas para a fase 3
- Cadastro, login, esqueci/nova senha
- Empresa criada automaticamente no cadastro (gatilho no banco)
- Painel com contadores ao vivo (Realtime)
- Tela "Minha empresa" (dados que o fornecedor vê)
- Layout estilo Mercado Livre, responsivo

## O que entrou na fase 2

- **Fornecedores**: cadastrar, editar, buscar, desativar (quem já participou de cotação
  não é excluído, só desativado, para não perder o histórico de preços), atalho de WhatsApp
- **Cotações**: lista com filtros (rascunho / abertas / encerradas) e barra de respostas
- **Nova cotação**: título, prazo, observações e itens (produto, quantidade, unidade, obs.)
  - "Colar do Excel": cola as colunas Produto / Quantidade / Unidade direto da planilha
  - Enter na quantidade cria a próxima linha
- **Detalhe da cotação**:
  - Escolher fornecedores da agenda
  - "Liberar para respostas" (trava os itens)
  - Copiar link individual de cada fornecedor ou enviar pelo WhatsApp com mensagem pronta
  - Status por fornecedor ao vivo: não enviado → enviado → visualizou → respondeu
  - Encerrar / reabrir / excluir rascunho

## O que entrou na fase 3

- **Tela do fornecedor** (`/r/:token`, sem login): dados de quem está cotando, itens com
  quantidade, campo de preço unitário, subtotal automático, "não tenho", condições
  (prazo de entrega, frete, pagamento, observações) e total fixo no rodapé
- Ao enviar: tela de confirmação e tentativa de fechar a aba; pode corrigir até o prazo
- Link inválido, cotação encerrada ou prazo vencido mostram aviso e bloqueiam o envio
- Funciona no celular (itens viram cartões)
- No painel do comprador: botão **Ver preços** em cada fornecedor que respondeu,
  status atualizando ao vivo

## O que entrou na fase 3.5

**Banco:** rodar `supabase/02_cnpj_resultados.sql` no SQL Editor (depois do 01).

- **CNPJ com busca automática** (BrasilAPI, com reserva na API pública do CNPJ.ws):
  valida os dígitos, consulta a Receita e preenche razão social, fantasia, telefone,
  e-mail, endereço, cidade/UF e situação cadastral. Está no cadastro, na ativação,
  em Minha empresa e no cadastro de fornecedor. CNPJ não ATIVO aparece em vermelho.
- **Painel**: tabela "Resultados das cotações" com vencedor, menor total e economia;
  card de economia identificada (vencedor × proposta completa mais cara).
- **Mapa comparativo** dentro da cotação: itens × fornecedores, menor preço de cada
  item em verde, vencedor pelo total, frete/prazo/pagamento e a "compra combinada"
  (cada item do mais barato, com o frete de cada fornecedor).
  - Regra: só vence pelo total quem cotou **todos** os itens.
- **Relatório impresso** (`Imprimir / PDF`): A4 paisagem com dados da empresa, resumo,
  mapa e campos de assinatura. Sem respostas, vira um "Pedido de Cotação" com
  espaço para preencher à mão. **Exportar Excel** gera CSV (abre direto no Excel).
  - O relatório se ajusta sozinho para caber em **1 página A4 paisagem** (reduz a escala
    até 55%). Cabe ~30 itens × 4 fornecedores; acima disso quebra em 2 páginas para não
    ficar ilegível. Funciona pelo botão e também pelo Ctrl+P.

## Fase 3.7 — entrada, trava de CNPJ e administração

**Banco:** rodar `supabase/03_admin_planos_cnpj.sql` (depois do 01 e 02). A última linha
torna `suporte@amp.ia.br` administrador — troque o e-mail se precisar.

- **Tela de entrada dividida**: carrossel de categorias (limpeza, papelaria, hospitalar,
  mecânica, construção, alimentos, informática) com troca suave, linha fina no meio e
  login/cadastro à direita. No celular mostra só o formulário.
- **Cadastro simples** (nome, empresa, WhatsApp, e-mail, senha). O CNPJ é exigido na
  **primeira cotação**: tela com busca na Receita, grava na empresa e segue.
  A trava também está no banco (criar ou liberar cotação sem CNPJ → erro CNPJ_OBRIGATORIO).
- **Painel admin** (cadeado 🔒 no topo, só para administradores) em `/admin`:
  clientes, CNPJ, contato, uso (cotações/fornecedores/respostas), último acesso,
  plano (Grátis/Básico/Pro/Cortesia) com validade, bloqueio, anotações internas,
  envio de link de nova senha e atalho de WhatsApp.
  - Conta bloqueada: entra e vê o histórico, mas não cria nem libera cotações.
  - O cliente não consegue alterar o próprio plano (protegido no banco).

## Fase 4 — envio das cotações por e-mail

**Banco:** rodar `supabase/04_envio_email.sql`.
**Vercel (Environment Variables):** `RESEND_API_KEY` (Sensitive) e `EMAIL_FROM`
(`CotaCompara <cotacao@amp.adm.br>`, já cadastrada).

- Função `api/enviar-convites.js` (Vercel Function) envia pelo Resend, em lote, usando o
  login do usuário (RLS vale) — a chave do Resend fica só no servidor.
- Ao **Liberar para respostas**, todos os fornecedores recebem o e-mail automaticamente.
- Botão **Enviar por e-mail (N)** para os pendentes e ícone ✉ para reenviar (vira "Lembrete").
- Reply-to = e-mail de contato da empresa (ou o de login): a resposta cai direto no comprador.
- Erros de envio aparecem em vermelho no fornecedor.
- O envio só funciona no site publicado (no `npm run dev` local não há a função /api).

## Fase 4.1 — proposta travada e correção liberada pelo comprador

**Banco:** rodar `supabase/05_correcao_proposta.sql`.

- Depois de enviar, o fornecedor vê "Proposta enviada! Boa sorte! 🍀" e **não consegue reenviar** sozinho
  (travado também no banco: erro JA_RESPONDIDO).
- O comprador tem o botão **Liberar correção** no fornecedor: libera e já envia o e-mail
  "Correção liberada" com o link. Pode cancelar antes do fornecedor responder.
- Na correção, o fornecedor vê ao lado de cada campo o valor que já tinha enviado.
- O preço anterior fica registrado (`preco_original`, não editável — nem o comprador altera).
  No mapa, no "Ver preços" e no relatório aparece "↻ era R$ X" e o selo "↻ corrigida".

---

## Fase 5 — Orçamento Rápido (o fornecedor responde pedidos recebidos fora do CotaCompara)

**SQL:** rode `supabase/06_orcamento_rapido.sql` (depois do 01 ao 05).

- Menu **Clientes** (orçamentos): o fornecedor cola a mensagem do WhatsApp, envia PDF, foto/print ou Excel/CSV
  e o sistema monta a **tabela editável** (produto, quantidade, unidade). Tudo lido **no navegador, sem custo**:
  texto e planilha por regras próprias, PDF com pdf.js, foto e PDF escaneado com Tesseract.js (OCR em português).
- **Catálogo do fornecedor**: cada orçamento enviado ensina o sistema; no próximo, o nome certo e o
  último preço já aparecem (sugestão "Você já orçou: ... usar").
- Condições (validade, prazo, pagamento, frete, desconto, observações) com opção de salvar como padrão.
- Saída: **WhatsApp** (mensagem pronta com link), **e-mail** (Resend, `api/enviar-orcamento.js`),
  **link** copiado e **PDF A4 retrato de 1 página** com os dados da empresa.
- Página pública `/o/:token`: o cliente vê, baixa o PDF e **aprova** (fica registrado quem aprovou);
  o fornecedor vê "cliente abriu" e "aprovado" em tempo real na lista.
- CNPJ obrigatório também para orçamentos (sai no documento).

## Fase 6 — Integração entre usuários (sem login extra)

**SQL:** rode `supabase/07_integracao_usuarios.sql` (depois do 06).

- Ao disparar a cotação, o sistema confere a base: se o fornecedor já usa o CotaCompara (mesmo **CNPJ** ou
  **e-mail** da conta/de contato), o pedido **cai direto no painel dele** (Clientes › Pedidos recebidos e
  aviso no Painel), com os preços do catálogo dele já preenchidos. Ele responde ali e a resposta entra no mapa
  do comprador como sempre. Quem não é usuário continua recebendo só pelo e-mail/link.
- O e-mail continua saindo para todos; para quem é usuário ele avisa "este pedido já está no seu painel".
- No detalhe da cotação, o comprador vê o selo "⚡ no painel dele" nos fornecedores que são usuários.
- O contrário também: orçamento enviado pelo Orçamento Rápido para um cliente usuário aparece no Painel dele
  em **Propostas recebidas** (abre a página do orçamento, onde ele aprova).
- O fornecedor vê só "Respondido / Encerrada" — o resultado (quem venceu) não é mostrado.
- A resposta pelo painel também ensina o catálogo (próximo pedido já vem com o preço).
- **Desempenho:** as regras de segurança (RLS) passam a calcular "minha empresa" uma vez por consulta;
  o detalhe da cotação busca cotação, fornecedores e preços ao mesmo tempo (antes eram idas seguidas ao
  servidor); telas pouco usadas (impressão, admin, orçamento, página do fornecedor) só carregam quando abertas.

## 1. Supabase (projeto compartilhado "Fixos")

O CotaCompara roda no mesmo projeto Supabase de outros apps AMP, isolado no
schema **`cotacompara`**. Nada do schema `public` (drywall etc.) é tocado.

1. **SQL Editor → New query** → cole o conteúdo de `supabase/01_schema.sql` → **Run**.
2. **Project Settings → Data API → Exposed schemas** → adicione `cotacompara` → Save.
   (Sem isso o app recebe erro "schema must be one of the following".)
3. **Authentication → URL Configuration**
   - **Não mude o Site URL** (é dos outros apps do projeto).
   - Em **Redirect URLs**, adicione:
     - `https://cotacompara.amp.ia.br/**`
     - `http://localhost:5173/**`
4. **Project Settings → API**: copie a `Project URL` e a `anon public key`
   (são as mesmas do projeto — cada app usa as mesmas chaves).

### Login compartilhado entre apps AMP

- Os usuários ficam em `auth.users`, que é um só por projeto.
- O cadastro feito pelo CotaCompara envia `app: 'cotacompara'`; só esse cadastro cria empresa.
- Quem já tem conta em outro app (ex.: marketplace) entra com o mesmo e-mail e senha
  e cai na tela **/ativar**, que só pede o nome da empresa.
- O gatilho do banco tem nome exclusivo (`cotacompara_on_auth_user_created`),
  então não substitui gatilhos de outros apps.

> Confirmação de e-mail e modelos de e-mail são do projeto inteiro (valem para todos os apps).
> Enquanto o Resend não estiver configurado, o Supabase limita a poucos e-mails por hora.

## 2. Rodar local (Windows)

```bash
npm install
copy .env.example .env.local
# edite .env.local com a URL e a anon key do Supabase
npm run dev
```

Abre em http://localhost:5173

## 3. Vercel

1. Suba a pasta para um repositório no GitHub (`cotacompara`).
2. Vercel → **Add New → Project** → importe o repositório (framework: Vite, detecta sozinho).
3. **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_URL` = `https://cotacompara.amp.ia.br`
4. Deploy.
5. **Settings → Domains** → adicione `cotacompara.amp.ia.br`.

O `vercel.json` já cuida das rotas (atualizar a página em `/painel` ou abrir `/r/token` não dá 404).

## 4. DNS (no seu servidor DNS do amp.ia.br)

| Tipo  | Nome          | Valor                  |
|-------|---------------|------------------------|
| CNAME | `cotacompara` | `cname.vercel-dns.com` |

Confira na tela de Domains da Vercel se ela pede exatamente esse valor; às vezes
ela mostra um CNAME específico do projeto, e aí vale o que ela mostrar.

**Não precisa mexer no Caddyfile da VPS**: o site roda na Vercel, então o
`cotacompara` aponta direto pra lá e não passa pelo Caddy que serve os outros sites.

## 5. Resend (pode adiantar agora, usado na fase 4)

1. Crie conta em resend.com → **Domains → Add domain** → `cotacompara.amp.ia.br`
   (usar o subdomínio isola a reputação do envio do seu e-mail principal).
2. O Resend vai mostrar registros **MX, TXT (SPF) e TXT (DKIM)** para cadastrar no seu DNS.
   Copie exatamente o que ele mostrar.
3. Adicione também um DMARC:
   `TXT  _dmarc.cotacompara  "v=DMARC1; p=none; rua=mailto:suporte@amp.ia.br"`
4. Bônus: no Supabase, **Project Settings → Authentication → SMTP Settings**,
   use o SMTP do Resend (`smtp.resend.com`, porta 465, usuário `resend`, senha = API key).
   Assim os e-mails de confirmação/recuperação de senha também saem pelo seu domínio,
   sem o limite do Supabase.

---

## Tipografia (padrão AMP)

| Uso | Fonte | Variável CSS |
|---|---|---|
| Interface inteira (textos, botões, formulários, menus) | Plus Jakarta Sans 300–800 | `--fonte` |
| Títulos (h1/h2), logo, números de destaque | Outfit 300–900 | `--fonte-destaque` |
| Badges, status, nº de cotação, tags técnicas | ui-monospace / Consolas | `--fonte-mono` (`.badge`, `.mono`) |
| Tabelas de preços / mapa de cotação | Roboto 400/500/700 | `--fonte-tabela` (`.tabela`) |

Fallback: `"Plus Jakarta Sans", "Outfit", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`

---

## Estrutura

```
supabase/01_schema.sql      banco completo + RLS + funções
src/
  lib/supabase.js           cliente + tradução de erros
  contexts/AuthContext.jsx  sessão + empresa do usuário
  components/               Header, Layout, Logo, RotaProtegida...
  pages/                    Entrar, Cadastro, EsqueciSenha, NovaSenha,
                            Painel, MinhaEmpresa, EmBreve, ResponderCotacao
```

## Próximas fases

2. ~~Fornecedores (CRUD) + criar cotação (itens, quantidades, prazo)~~ ✅
3. ~~Tela pública do fornecedor `/r/:token`~~ ✅
4. Disparo de e-mail via Resend (Edge Function) + status enviado/aberto/respondido
5. ~~Mapa de cotação, menor preço por item/total, dashboard, export~~ ✅ (adiantado)


---

## Etapa 2 — Link de Pedidos e Aprovação Eletrônica com Carimbo

**Banco:** rodar `supabase/08_link_e_aprovacao.sql` no SQL Editor do Supabase (projeto Fixos).

- **Link público para pedidos de clientes** (`/p/:token`):
  - Cada empresa possui um link fixo e exclusivo para receber pedidos de orçamento diretamente de seus clientes, sem necessidade de login.
  - O cliente informa nome, WhatsApp e/ou e-mail, documento opcional e lista até 10 itens com quantidade, unidade e observações.
  - Proteção antispam inteligente: honeypot invisível, bloqueio temporário de envio nos primeiros segundos, limitação por IP e trava de pedidos pendentes por empresa.
  - Tela mobile-first com design responsivo (sem rolagem horizontal em celulares).
  - Gera protocolo imediato (`PED-XXXX-XXXX`).
  - No menu **Clientes**, o fornecedor gerencia o link (copiar, enviar no WhatsApp, desativar/ativar e gerar novo link).
  - Pedidos recebidos pelo link aparecem em tempo real via Supabase Realtime, permitindo **Aceitar e montar orçamento** (gera rascunho com dados e itens) ou **Recusar**.
  - No **Painel**, alerta visual dedicado quando houver pedidos pendentes aguardando resposta.

- **Aprovação Eletrônica com Carimbo e Verificação Pública**:
  - Base legal: assinatura eletrônica simples (Lei Federal nº 14.063/2020). Custo zero por uso.
  - Fluxo de aprovação em 3 passos no modal do orçamento público (`/o/:token`):
    1. **Identificação**: escolha entre CNPJ ou CPF.
       - CNPJ: validação matemática e consulta automática na Receita Federal (BrasilAPI com reserva em CNPJ.ws) trazendo dados cadastrais compactos.
       - CPF: validação local dos dígitos verificadores com selo informativo.
       - Nome completo obrigatório de quem está aprovando.
    2. **Confirmação**: resumo do orçamento, aceite formal de condições e aviso de conformidade LGPD.
    3. **Comprovante**: recibo com código grande (`APV-XXXX-XXXX`), data/hora, fornecedor, aprovador, hash criptográfico SHA-256 e QR code dinâmico para validação.
  - **Carimbo de Aprovação Eletrônica** (`CarimboAprovacao.jsx`):
    - Visual estilizado com borda dupla verde, dados da aprovação, hash e QR Code.
    - Exibido no topo do orçamento público e lado do fornecedor (`OrcamentoEditar.jsx`).
    - Sai impresso no PDF logo após os totais do orçamento.
  - **Trava de Imutabilidade**:
    - Trigger no PostgreSQL bloqueia qualquer alteração em itens, quantidades, preços, frete, desconto ou prazos de orçamentos aprovados (`ORCAMENTO_APROVADO_TRAVADO`).
    - No lado do fornecedor, o orçamento aprovado fica somente leitura, oferecendo o botão **Duplicar** para gerar um novo orçamento baseado no anterior.
  - **Página de Verificação Pública** (`/v/:codigo`):
    - Acessível via QR code ou link direto, sem login.
    - Valida a integridade criptográfica do hash canônico contra o banco de dados.
    - Exibe confirmação visual verde (íntegro) ou vermelha (alterado), com os dados do orçamento e documento do cliente protegido por máscara.
