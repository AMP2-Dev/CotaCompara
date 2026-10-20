# CotaCompara — Etapa 2: roteiro de implementação

> Roteiro para executar no Antigravity, no repositório `AMP2-Dev/CotaCompara`.
> A Etapa 1 (leitor de preço + menu Clientes) já está em produção, commit `e2ccaf9`.

## 0. Regras do projeto (ler antes de tudo)

- **Stack:** React 18 + Vite 5, Supabase e Vercel (deploy automático a cada push na `main`).
- **Supabase compartilhado:** o projeto `ogqahhmxsmjoyjdikafm` ("Fixos") atende vários apps AMP.
  - Tudo do CotaCompara fica no schema **`cotacompara`**.
  - **Não mexer** em `auth`, `public`, Site URL ou triggers de outros apps.
  - **Nunca** usar a `service_role` no frontend.
- **Fluxo de publicação:**
  1. Trabalhar na branch **`etapa-2-link-aprovacao`**.
  2. O SQL novo vai em `supabase/08_link_e_aprovacao.sql`.
  3. O Marco roda esse SQL no Supabase **antes** do merge na `main`.
  4. Só depois disso fazer o merge e o push na `main`. Antes do SQL, a produção quebra.
- **Custo zero por uso:** sem IA paga e sem serviço de assinatura pago. Bibliotecas grátis são permitidas (ex.: `qrcode`).
- **Padrões que já existem e devem ser seguidos:**
  - **RLS:** usar `(select cotacompara.minha_empresa_id())`, na forma initplan, como no `07_integracao_usuarios.sql`, seção 5.
  - **Páginas públicas:** acessam o banco só por RPC `security definer`, com `grant execute ... to anon, authenticated`. Exemplo: `orcamento_publico(text)` em `06_orcamento_rapido.sql`.
  - **Erros:** a RPC dispara `raise exception 'CODIGO'` e o texto amigável fica no mapa de mensagens de `src/lib/supabase.js`.
  - **Rotas públicas:** são lazy em `src/App.jsx`, dentro de `Suspense`, como `OrcamentoPublico`.
  - **CNPJ:** usar `src/lib/cnpj.js`, que já tem `mascaraCnpj`, `cnpjValido`, `consultarCnpj` (BrasilAPI com reserva CNPJ.ws) e `nomeExibicao`.
  - **Fontes:** Plus Jakarta Sans / Outfit, que já estão no `index.css`.
- **Nomes no menu:** "Cotações" e "Fornecedores" são o lado de quem compra. "Clientes" (rota `/orcamentos`) é o lado de quem vende.

---

## PARTE A — Link para o cliente pedir orçamento

**Objetivo:** cada empresa tem um link fixo `cotacompara.amp.ia.br/p/<token>`. O cliente abre o link sem login, monta um pedido de até **10 itens** e envia. O pedido fica numa fila **aguardando aprovação** do fornecedor. Quando o fornecedor aceita, o pedido vira um orçamento rascunho já preenchido.

### A1. SQL (em `08_link_e_aprovacao.sql`)

```sql
-- link da empresa
alter table cotacompara.empresas
  add column if not exists pedido_link_token text unique
    default replace(gen_random_uuid()::text, '-', ''),
  add column if not exists pedido_link_ativo boolean not null default true;
update cotacompara.empresas set pedido_link_token = replace(gen_random_uuid()::text,'-','')
 where pedido_link_token is null;

-- nova origem de orçamento
alter table cotacompara.orcamentos drop constraint if exists orcamentos_origem_check;
alter table cotacompara.orcamentos add constraint orcamentos_origem_check
  check (origem in ('manual','texto','pdf','imagem','planilha','link'));

create table if not exists cotacompara.pedidos_link (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references cotacompara.empresas(id) on delete cascade,
  protocolo        text not null unique,          -- ex.: PED-7K3M2Q (mostrado ao cliente)
  status           text not null default 'pendente' check (status in ('pendente','aceito','recusado')),
  cliente_nome     text not null,
  cliente_documento text,
  cliente_whatsapp text,
  cliente_email    text,
  observacoes      text,
  itens            jsonb not null,                -- [{produto, quantidade, unidade, observacao}] (1..10)
  ip               text,
  user_agent       text,
  orcamento_id     uuid references cotacompara.orcamentos(id) on delete set null,
  decidido_em      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_cc_pedidos_link_empresa on cotacompara.pedidos_link(empresa_id, status, created_at desc);
alter table cotacompara.pedidos_link enable row level security;
-- só a própria empresa lê/atualiza; NÃO criar policy de insert (entra só pela RPC)
create policy pedidos_link_sel on cotacompara.pedidos_link for select to authenticated
  using (empresa_id = (select cotacompara.minha_empresa_id()));
create policy pedidos_link_upd on cotacompara.pedidos_link for update to authenticated
  using (empresa_id = (select cotacompara.minha_empresa_id()));
-- realtime (mesmo bloco do 06 para orcamentos)
```

**Funções auxiliares**

- `cotacompara.ip_requisicao() returns text`: devolve o 1º IP de `current_setting('request.headers', true)::json->>'x-forwarded-for'` (ou `null`).
- `cotacompara.codigo_curto(prefixo text) returns text`: gera `PREFIXO-XXXX-XXXX` com o alfabeto `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (sem 0/O/1/I/L), usando `gen_random_bytes`. Fica em loop até sair um código que não exista.

**RPCs públicas** (`security definer`, grant para `anon, authenticated`)

1. **`empresa_link_publico(p_token text) returns jsonb`**
   - Devolve `{nome, cidade, uf, ativo}` da empresa.
   - Se o token não existir: `LINK_INVALIDO`. Se o link estiver desativado ou a conta bloqueada: `LINK_DESATIVADO`.
2. **`criar_pedido_link(p_token text, p_cliente jsonb, p_itens jsonb) returns jsonb`**
   - **Validações:**
     - link ativo e conta não bloqueada;
     - `cliente.nome` obrigatório, até 120 caracteres;
     - `whatsapp` **ou** `email` obrigatório;
     - de 1 a **10** itens, senão `LIMITE_ITENS`;
     - `produto` com 2 a 200 caracteres;
     - `quantidade` maior que 0 e até 1.000.000;
     - `unidade` com até 6 caracteres;
     - `observacoes` com até 1.000 caracteres.
   - **Antispam:**
     - no máximo **3 pedidos por hora do mesmo IP** para a mesma empresa;
     - no máximo **30 pedidos pendentes** por empresa;
     - se passar de qualquer um dos dois: `MUITOS_PEDIDOS`.
   - Grava `ip` e `user_agent` (`request.headers->>'user-agent'`).
   - Retorna `{protocolo, criado_em}`.

**RPCs do fornecedor** (grant só para `authenticated`)

3. **`aceitar_pedido_link(p_id uuid) returns uuid`**
   - Confere se o pedido é da empresa do usuário (`minha_empresa_id()`) e se está `pendente`.
   - Cria `orcamentos` com `status='rascunho'`, `origem='link'`, os dados do cliente e `referencia = protocolo`.
   - Cria `orcamento_itens` na ordem dos itens, com `preco_unitario` nulo.
   - Marca o pedido como `aceito`, com `orcamento_id` e `decidido_em`.
   - Retorna o id do orçamento.
4. **`recusar_pedido_link(p_id uuid)`**: muda o status para `recusado` e preenche `decidido_em`.
5. **`novo_link_pedido()`**: gera um novo `pedido_link_token` para a empresa do usuário. O link antigo para de funcionar.

### A2. Frontend

- **`src/pages/PedidoLink.jsx`** (rota pública lazy `/p/:token`):
  - **Topo:** "Pedido de orçamento para **{empresa}**", com cidade/UF.
  - **Formulário do cliente:**
    - campos: nome*, WhatsApp, e-mail e CNPJ/CPF opcional (com máscara);
    - aviso: "informe WhatsApp ou e-mail".
  - **Itens:**
    - começa com 3 linhas, e o botão "+ item" vai até **10**; ao chegar no limite aparece "Máximo de 10 itens";
    - cada linha tem produto, qtd e unidade (select com as unidades de `format.js`);
    - campo de observações.
  - **Antispam no navegador:**
    - campo **honeypot** escondido (`name="empresa_site"`): se vier preenchido, não envia e mostra sucesso falso;
    - o botão fica desabilitado por 3 s depois que a página abre.
  - **Sucesso:** "Pedido enviado! Protocolo **PED-XXXX-XXXX**. {empresa} vai analisar e responder pelo WhatsApp/e-mail informado." Também aparece o CTA para conhecer o CotaCompara.
  - Layout mobile-first, porque o cliente abre pelo celular.
- **`src/pages/Orcamentos.jsx`** (tela **Clientes**):
  - **Card "Seu link de pedidos"** (ler `pedido_link_token` e `pedido_link_ativo` da empresa):
    - mostra a URL;
    - botões **Copiar**, **Enviar no WhatsApp** (`https://wa.me/?text=`), **Desativar/Ativar** e **Gerar novo link** (pede confirmação e chama `novo_link_pedido`).
  - **Seção "Pedidos pelo link — aguardando você"** (`select` em `pedidos_link` com `status='pendente'`):
    - cada linha mostra cliente, quantos itens, data e a lista de itens expandível;
    - botões **Aceitar e montar orçamento** (chama a RPC e navega para `/orcamentos/{id}`) e **Recusar**.
    - Atualizar em tempo real (`postgres_changes`, INSERT, tabela `pedidos_link`).
  - **Painel** (`Painel.jsx`): mostrar um alerta "X pedidos pelo link aguardando você" quando houver pendentes.
- **`src/lib/supabase.js`**: adicionar as mensagens:
  - `LINK_DESATIVADO`: "Este link de pedidos está desativado."
  - `LIMITE_ITENS`: "Máximo de 10 itens por pedido."
  - `MUITOS_PEDIDOS`: "Muitos pedidos em pouco tempo. Tente mais tarde."
- **`format.js`**: incluir a origem `link` no texto e no ícone de origem, se existir esse mapeamento.

---

## PARTE B — Aprovação com CNPJ/CPF e carimbo de aprovação

**Objetivo:** quando o cliente aprova um orçamento (`/o/:token`), ele informa um CNPJ (consultado na hora) ou um CPF, confirma os dados e recebe um **comprovante** com código, data/hora, validade e QR code. O mesmo **carimbo** fica gravado no orçamento e sai no PDF.

Base legal: assinatura eletrônica simples, Lei 14.063/2020. Custo zero.

### B1. SQL (continuação do `08`)

```sql
alter table cotacompara.orcamentos
  add column if not exists aprovacao_codigo     text unique,      -- APV-XXXX-XXXX
  add column if not exists aprovacao_doc_tipo   text check (aprovacao_doc_tipo in ('CNPJ','CPF')),
  add column if not exists aprovacao_documento  text,             -- só dígitos
  add column if not exists aprovacao_dados      jsonb,            -- razão social, fantasia, cidade/uf, situação, fonte
  add column if not exists aprovacao_hash       text,             -- sha256 do conteúdo aprovado
  add column if not exists aprovacao_ip         text,
  add column if not exists aprovacao_user_agent text,
  add column if not exists aprovacao_validade   date;
```

**Funções**

- **`cotacompara.cnpj_valido(text)` e `cotacompara.cpf_valido(text)`** (`immutable`): conferem os dígitos verificadores.
- **`cotacompara.conteudo_orcamento(p_id uuid) returns text`**: monta um texto **canônico**, sempre na mesma ordem e no mesmo formato, com:
  - o número do orçamento e o CNPJ do fornecedor;
  - uma linha por item, ordenada por `ordem`, no formato `produto|quantidade|unidade|preco_unitario`, com os números formatados por `to_char` fixo;
  - frete, desconto, total, validade_dias, condicao_pagamento e prazo_entrega.
- **`cotacompara.hash_orcamento(p_id uuid) returns text`** = `encode(extensions.digest(conteudo_orcamento(p_id), 'sha256'), 'hex')`.
  - No Supabase o pgcrypto fica no schema `extensions`.
  - Se `extensions.digest` não existir, usar `create extension if not exists pgcrypto with schema extensions;`.
- **Trava pós-aprovação** (trigger `before update or delete` em `orcamento_itens` e `before update` em `orcamentos`):
  - Se o orçamento estiver `aprovado`, bloquear com `ORCAMENTO_APROVADO_TRAVADO` qualquer mudança em itens, preços, frete, desconto, validade e condições.
  - Continuam liberados: `visualizacoes`, `visualizado_em` e campos internos que não entram no hash.
  - É essa trava que garante que o conteúdo aprovado não muda depois.

**Nova RPC pública: `aprovar_orcamento_v2(p_token text, p_nome text, p_doc_tipo text, p_documento text, p_dados jsonb) returns jsonb`**

- **Mesmas validações** da `aprovar_orcamento` atual (06, linha 265): `LINK_INVALIDO`, `ORCAMENTO_INDISPONIVEL`, `ORCAMENTO_VENCIDO` e `NOME_OBRIGATORIO`.
- **Documento:**
  - `p_doc_tipo` tem de ser `CNPJ` ou `CPF`;
  - o número é validado com a função do tipo, senão `DOCUMENTO_INVALIDO`.
- **`p_dados`:** o backend aceita só as chaves `razao_social`, `nome_fantasia`, `cidade`, `uf`, `situacao` e `fonte`.
  - `fonte` é `'consulta'` para CNPJ consultado e `'informado'` para CPF;
  - cada valor é cortado em 200 caracteres.
- **Grava:**
  - `status='aprovado'`, `aprovado_em=now()` e `aprovado_por=nome`;
  - `aprovacao_codigo = codigo_curto('APV')`;
  - documento, dados, `aprovacao_hash = hash_orcamento(id)`, IP e user agent;
  - `aprovacao_validade = (coalesce(enviado_em, created_at) + validade_dias)::date`;
  - se `cliente_documento` estiver vazio, preencher com o documento; se `cliente_nome` estiver vazio, preencher com a razão social ou com o nome.
- **Retorna** `{codigo, aprovado_em, hash, validade, fornecedor, numero, total}`.
- Se o orçamento já estiver aprovado, retorna os mesmos dados com `ja_aprovado: true`.
- Manter a função antiga `aprovar_orcamento` existindo, para não quebrar cache antigo. A interface passa a usar só a v2.
- `orcamento_publico(text)` passa a devolver também os campos `aprovacao_*`, **exceto `ip` e `user_agent`**.

**Nova RPC pública: `verificar_aprovacao(p_codigo text) returns jsonb`** (`anon`)

- Retorna:
  - fornecedor (nome + CNPJ) e o número do orçamento;
  - cliente: nome, com o documento **mascarado**, ex.: `12.***.***/0001-**`;
  - `aprovado_em`, validade e `hash`;
  - **`integro: aprovacao_hash = hash_orcamento(id)`**.
- Se o código não existir: `CODIGO_INEXISTENTE`.

### B2. Frontend

- **`src/pages/OrcamentoPublico.jsx`**: o modal de aprovação passa a ter 3 passos.
  1. **Identificação:**
     - escolher **CNPJ** ou **CPF**.
     - **CNPJ:** máscara e `cnpjValido`. Ao completar 14 dígitos, chamar `consultarCnpj` (`src/lib/cnpj.js`). Mostrar campos **compactos e só de leitura**, em 2 colunas no desktop e 1 no celular, com fonte menor: razão social, nome fantasia, cidade/UF e situação cadastral.
       - Se a situação não for ATIVA, mostrar o aviso amarelo "CNPJ com situação X na Receita".
       - Se a consulta falhar, deixar seguir com a etiqueta "não foi possível consultar".
     - **CPF:** máscara e validação local, e o selo **"CPF informado pelo cliente (não verificado)"**.
     - Campo obrigatório **"Seu nome (quem está aprovando)"**.
  2. **Confirmação:**
     - mostrar o resumo do orçamento (total e validade) e o checkbox "Confirmo os dados acima e aprovo este orçamento";
     - texto pequeno: "Para comprovar a aprovação registramos data, hora e IP." (LGPD).
  3. **Comprovante** (depois de chamar `aprovar_orcamento_v2`): uma tela tipo recibo com
     - ✅ "Pedido aprovado!";
     - **código** grande `APV-XXXX-XXXX`;
     - data e hora em `America/Sao_Paulo` e validade;
     - fornecedor, total e quem aprovou, com documento;
     - "Impressão digital: primeiros 16 caracteres do hash";
     - **QR code** apontando para `https://cotacompara.amp.ia.br/v/{codigo}`. Gerar com `qrcode` (npm, MIT, grátis) em import dinâmico: `QRCode.toDataURL`;
     - botões **Salvar comprovante (PDF)** (usa `window.print()` só no recibo, com `@page A4`) e **Fechar**.
  - Quando o orçamento já estiver aprovado, o aviso verde atual vira o **bloco do carimbo** com os mesmos dados.
- **Componente `src/components/CarimboAprovacao.jsx`**:
  - É reutilizado no `OrcamentoPublico` (tela e impressão), no `OrcamentoEditar` (lado do fornecedor) e na impressão/PDF do orçamento.
  - Visual de carimbo: borda verde dupla, levemente arredondada, com o título "APROVADO ELETRONICAMENTE".
  - Mostra código, data/hora, "Aprovado por {nome} — {CNPJ/CPF}", razão social, hash curto e QR.
  - Rodapé: "Assinatura eletrônica simples (Lei 14.063/2020). Verifique em cotacompara.amp.ia.br/v/{codigo}".
  - No PDF ele aparece **depois dos totais**, no lugar da linha atual `orc-f-aprovado` (OrcamentoPublico, linha ~184).
- **`src/pages/VerificarAprovacao.jsx`** (rota pública lazy `/v/:codigo`):
  - chama `verificar_aprovacao`;
  - **verde** "Aprovação válida — o conteúdo não foi alterado" ou **vermelho** "Atenção: o conteúdo do orçamento foi alterado depois da aprovação";
  - mostra os dados, com o documento mascarado.
- **Lado do fornecedor:**
  - **`OrcamentoEditar.jsx`:** se `status='aprovado'`, mostrar o `CarimboAprovacao` no topo e deixar itens e condições **só de leitura**, com o aviso "Aprovado — para mudar, duplique o orçamento". O botão Duplicar já existe e passa o estado pela navegação. Mostrar também os dados do cliente vindos da aprovação (razão social, documento, cidade/UF).
  - **`Orcamentos.jsx`** (lista Clientes): na linha aprovada, mostrar o código `APV-…` ao lado de "aprovado em".
  - **E-mail/realtime:** o realtime de `orcamentos` já avisa a lista. Não precisa e-mail novo.
- **`src/lib/supabase.js`**: adicionar as mensagens:
  - `DOCUMENTO_INVALIDO`: "CNPJ/CPF inválido. Confira os números."
  - `ORCAMENTO_APROVADO_TRAVADO`: "Orçamento aprovado não pode ser alterado. Duplique para fazer outro."
  - `CODIGO_INEXISTENTE`: "Código de aprovação não encontrado."

---

## C. Testes obrigatórios antes de pedir o merge

**SQL** (num banco de teste, ou com transação `begin … rollback` no SQL Editor):

1. `criar_pedido_link` com 11 itens dá `LIMITE_ITENS`. O 4º pedido do mesmo IP em 1 hora dá `MUITOS_PEDIDOS`. Com o link desativado dá `LINK_DESATIVADO`.
2. Um usuário anônimo **não** consegue fazer `select` em `pedidos_link`. A empresa B não vê os pedidos da empresa A.
3. `aceitar_pedido_link` cria o orçamento com os itens na ordem certa. Chamar de novo não duplica.
4. `aprovar_orcamento_v2` com CNPJ inválido dá `DOCUMENTO_INVALIDO`. Com dados válidos, grava código, hash, IP e validade.
5. Depois de aprovado, um `update` no preço de um item dá `ORCAMENTO_APROVADO_TRAVADO`.
6. `verificar_aprovacao` retorna `integro=true`. Alterando o item direto, com a trigger desligada para o teste, retorna `integro=false`.
7. `orcamento_publico` **não** devolve IP nem user agent.

**Telas:**

8. O link `/p/:token` no celular (largura 375) não tem rolagem horizontal. O honeypot funciona.
9. O pedido aparece em tempo real na tela Clientes. Aceitar abre o orçamento preenchido.
10. Aprovação com CNPJ real mostra os dados compactos. CPF mostra o selo "não verificado".
11. O comprovante imprime numa página A4. O QR abre `/v/:codigo`.
12. O PDF do orçamento aprovado sai com o carimbo.
13. `npm run build` passa sem erro, e as rotas novas são lazy (o bundle principal não cresce mais que ~10 KB).

## D. Publicação

1. Fazer commit na branch `etapa-2-link-aprovacao` e push. A Vercel gera o preview.
2. O Marco roda `supabase/08_link_e_aprovacao.sql` no Supabase (projeto Fixos) e testa no preview.
3. Depois disso: `git checkout main && git merge --ff-only etapa-2-link-aprovacao && git push origin main`.
4. Conferir na Vercel que o deploy de produção ficou READY e que não há erros de runtime.
5. Atualizar o `README.md` com uma seção "Etapa 2".
