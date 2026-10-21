-- =====================================================================
-- CotaCompara · Etapa 2 · LINK DE PEDIDOS E APROVAÇÃO COM CARIMBO
--
-- Rode no SQL Editor do Supabase (projeto compartilhado "Fixos"),
-- DEPOIS dos arquivos 01 a 07.
-- Só mexe no schema "cotacompara".
-- =====================================================================

do $$
begin
  create extension if not exists pgcrypto with schema extensions;
exception when others then
  null; -- caso pgcrypto já exista em public ou extensions
end $$;

-- ---------------------------------------------------------------------
-- 1. Alterações em tabelas existentes
-- ---------------------------------------------------------------------

-- link da empresa
alter table cotacompara.empresas
  add column if not exists pedido_link_token text unique
    default replace(gen_random_uuid()::text, '-', ''),
  add column if not exists pedido_link_ativo boolean not null default true;

update cotacompara.empresas
   set pedido_link_token = replace(gen_random_uuid()::text, '-', '')
 where pedido_link_token is null;

-- nova origem de orçamento ('link')
alter table cotacompara.orcamentos drop constraint if exists orcamentos_origem_check;
alter table cotacompara.orcamentos add constraint orcamentos_origem_check
  check (origem in ('manual','texto','pdf','imagem','planilha','link'));

-- campos de aprovação formal
alter table cotacompara.orcamentos
  add column if not exists aprovacao_codigo     text unique,      -- APV-XXXX-XXXX
  add column if not exists aprovacao_doc_tipo   text check (aprovacao_doc_tipo in ('CNPJ','CPF')),
  add column if not exists aprovacao_documento  text,             -- só dígitos
  add column if not exists aprovacao_dados      jsonb,            -- razão social, fantasia, cidade/uf, situação, fonte
  add column if not exists aprovacao_hash       text,             -- sha256 do conteúdo aprovado
  add column if not exists aprovacao_ip         text,
  add column if not exists aprovacao_user_agent text,
  add column if not exists aprovacao_validade   date;

-- ---------------------------------------------------------------------
-- 2. Tabela de pedidos recebidos pelo link público
-- ---------------------------------------------------------------------
create table if not exists cotacompara.pedidos_link (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references cotacompara.empresas(id) on delete cascade,
  protocolo        text not null unique,          -- ex.: PED-XXXX-XXXX (mostrado ao cliente)
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
create index if not exists idx_cc_pedidos_link_ip on cotacompara.pedidos_link(empresa_id, ip, created_at desc);

alter table cotacompara.pedidos_link enable row level security;

-- só a própria empresa lê/atualiza; NÃO criar policy de insert para authenticated/anon (entra só pela RPC security definer)
drop policy if exists pedidos_link_sel on cotacompara.pedidos_link;
create policy pedidos_link_sel on cotacompara.pedidos_link for select to authenticated
  using (empresa_id = (select cotacompara.minha_empresa_id()));

drop policy if exists pedidos_link_upd on cotacompara.pedidos_link;
create policy pedidos_link_upd on cotacompara.pedidos_link for update to authenticated
  using (empresa_id = (select cotacompara.minha_empresa_id()));

grant select, update on cotacompara.pedidos_link to authenticated;
grant all on cotacompara.pedidos_link to service_role;

-- ---------------------------------------------------------------------
-- 3. Funções auxiliares: IP, User Agent, código curto, validação de documento
-- ---------------------------------------------------------------------

create or replace function cotacompara.ip_requisicao()
returns text language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_hdrs text;
  v_ip   text;
begin
  v_hdrs := current_setting('request.headers', true);
  if v_hdrs is null or v_hdrs = '' then return null; end if;
  v_ip := (v_hdrs::json->>'x-forwarded-for');
  if v_ip is not null and v_ip <> '' then
    return btrim(split_part(v_ip, ',', 1));
  end if;
  return null;
exception when others then
  return null;
end $$;

create or replace function cotacompara.user_agent_requisicao()
returns text language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_hdrs text;
begin
  v_hdrs := current_setting('request.headers', true);
  if v_hdrs is null or v_hdrs = '' then return null; end if;
  return left((v_hdrs::json->>'user-agent'), 500);
exception when others then
  return null;
end $$;

-- Gera código PREFIXO-XXXX-XXXX usando alfabeto legível de 32 chars (sem 0, O, 1, I, L)
create or replace function cotacompara.codigo_curto(prefixo text)
returns text language plpgsql security definer set search_path = cotacompara, extensions, public as $$
declare
  v_alfabeto text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_len int := length(v_alfabeto);
  v_bytes bytea;
  v_codigo text;
  v_p1 text;
  v_p2 text;
  v_existe boolean;
  v_tentativas int := 0;
begin
  loop
    v_tentativas := v_tentativas + 1;
    if v_tentativas > 100 then
      raise exception 'FALHA_GERAR_CODIGO';
    end if;

    v_bytes := gen_random_bytes(8);
    v_p1 := substr(v_alfabeto, (get_byte(v_bytes, 0) % v_len) + 1, 1) ||
            substr(v_alfabeto, (get_byte(v_bytes, 1) % v_len) + 1, 1) ||
            substr(v_alfabeto, (get_byte(v_bytes, 2) % v_len) + 1, 1) ||
            substr(v_alfabeto, (get_byte(v_bytes, 3) % v_len) + 1, 1);
    v_p2 := substr(v_alfabeto, (get_byte(v_bytes, 4) % v_len) + 1, 1) ||
            substr(v_alfabeto, (get_byte(v_bytes, 5) % v_len) + 1, 1) ||
            substr(v_alfabeto, (get_byte(v_bytes, 6) % v_len) + 1, 1) ||
            substr(v_alfabeto, (get_byte(v_bytes, 7) % v_len) + 1, 1);
    v_codigo := prefixo || '-' || v_p1 || '-' || v_p2;

    if prefixo = 'PED' then
      select exists(select 1 from cotacompara.pedidos_link where protocolo = v_codigo) into v_existe;
    elsif prefixo = 'APV' then
      select exists(select 1 from cotacompara.orcamentos where aprovacao_codigo = v_codigo) into v_existe;
    else
      v_existe := false;
    end if;

    if not v_existe then
      return v_codigo;
    end if;
  end loop;
end $$;

-- Validação de CNPJ
create or replace function cotacompara.cnpj_valido(p_cnpj text)
returns boolean language plpgsql immutable as $$
declare
  v_c text;
  v_soma int;
  v_peso int;
  v_r int;
  v_d1 int;
  v_d2 int;
  i int;
begin
  v_c := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  if length(v_c) <> 14 then return false; end if;
  if v_c in ('00000000000000','11111111111111','22222222222222','33333333333333',
             '44444444444444','55555555555555','66666666666666','77777777777777',
             '88888888888888','99999999999999') then
    return false;
  end if;

  -- 1º dígito
  v_soma := 0;
  v_peso := 5;
  for i in 1..12 loop
    v_soma := v_soma + substr(v_c, i, 1)::int * v_peso;
    v_peso := v_peso - 1;
    if v_peso < 2 then v_peso := 9; end if;
  end loop;
  v_r := v_soma % 11;
  if v_r < 2 then v_d1 := 0; else v_d1 := 11 - v_r; end if;
  if substr(v_c, 13, 1)::int <> v_d1 then return false; end if;

  -- 2º dígito
  v_soma := 0;
  v_peso := 6;
  for i in 1..13 loop
    v_soma := v_soma + substr(v_c, i, 1)::int * v_peso;
    v_peso := v_peso - 1;
    if v_peso < 2 then v_peso := 9; end if;
  end loop;
  v_r := v_soma % 11;
  if v_r < 2 then v_d2 := 0; else v_d2 := 11 - v_r; end if;

  return substr(v_c, 14, 1)::int = v_d2;
end $$;

-- Validação de CPF
create or replace function cotacompara.cpf_valido(p_cpf text)
returns boolean language plpgsql immutable as $$
declare
  v_c text;
  v_soma int;
  v_peso int;
  v_r int;
  v_d1 int;
  v_d2 int;
  i int;
begin
  v_c := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  if length(v_c) <> 11 then return false; end if;
  if v_c in ('00000000000','11111111111','22222222222','33333333333',
             '44444444444','55555555555','66666666666','77777777777',
             '88888888888','99999999999') then
    return false;
  end if;

  -- 1º dígito
  v_soma := 0;
  v_peso := 10;
  for i in 1..9 loop
    v_soma := v_soma + substr(v_c, i, 1)::int * v_peso;
    v_peso := v_peso - 1;
  end loop;
  v_r := v_soma % 11;
  if v_r < 2 then v_d1 := 0; else v_d1 := 11 - v_r; end if;
  if substr(v_c, 10, 1)::int <> v_d1 then return false; end if;

  -- 2º dígito
  v_soma := 0;
  v_peso := 11;
  for i in 1..10 loop
    v_soma := v_soma + substr(v_c, i, 1)::int * v_peso;
    v_peso := v_peso - 1;
  end loop;
  v_r := v_soma % 11;
  if v_r < 2 then v_d2 := 0; else v_d2 := 11 - v_r; end if;

  return substr(v_c, 11, 1)::int = v_d2;
end $$;

-- ---------------------------------------------------------------------
-- 4. Texto canônico e hash criptográfico do orçamento
-- ---------------------------------------------------------------------

create or replace function cotacompara.conteudo_orcamento(p_id uuid)
returns text language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_orc cotacompara.orcamentos;
  v_emp cotacompara.empresas;
  v_sub numeric := 0;
  v_total numeric := 0;
  v_itens_texto text := '';
  v_canonico text;
begin
  select * into v_orc from cotacompara.orcamentos where id = p_id;
  if v_orc.id is null then return null; end if;
  select * into v_emp from cotacompara.empresas where id = v_orc.empresa_id;

  select coalesce(string_agg(
           ordem::text || '|' ||
           produto || '|' ||
           to_char(quantidade, 'FM999999990.000') || '|' ||
           unidade || '|' ||
           case when preco_unitario is null then 'NULO' else to_char(preco_unitario, 'FM999999990.0000') end,
           chr(10) order by ordem, id
         ), ''),
         coalesce(sum(round(quantidade * preco_unitario, 2)), 0)
    into v_itens_texto, v_sub
    from cotacompara.orcamento_itens
   where orcamento_id = v_orc.id;

  v_total := greatest(v_sub - coalesce(v_orc.desconto, 0), 0) + coalesce(v_orc.frete, 0);

  v_canonico := 'NUMERO:' || v_orc.numero::text || chr(10) ||
                'FORNECEDOR_CNPJ:' || coalesce(regexp_replace(v_emp.cnpj, '\D', '', 'g'), '') || chr(10) ||
                'ITENS:' || chr(10) || v_itens_texto || chr(10) ||
                'FRETE:' || to_char(coalesce(v_orc.frete, 0), 'FM999999990.00') || chr(10) ||
                'DESCONTO:' || to_char(coalesce(v_orc.desconto, 0), 'FM999999990.00') || chr(10) ||
                'TOTAL:' || to_char(v_total, 'FM999999990.00') || chr(10) ||
                'VALIDADE_DIAS:' || v_orc.validade_dias::text || chr(10) ||
                'CONDICAO_PAGAMENTO:' || coalesce(btrim(v_orc.condicao_pagamento), '') || chr(10) ||
                'PRAZO_ENTREGA:' || coalesce(btrim(v_orc.prazo_entrega), '');

  return v_canonico;
end $$;

create or replace function cotacompara.hash_orcamento(p_id uuid)
returns text language plpgsql security definer set search_path = cotacompara, extensions, public as $$
begin
  return encode(digest(cotacompara.conteudo_orcamento(p_id), 'sha256'), 'hex');
end $$;

-- ---------------------------------------------------------------------
-- 5. Trava pós-aprovação (garante imutabilidade após aprovado)
-- ---------------------------------------------------------------------

create or replace function cotacompara.trg_trava_orcamento_itens()
returns trigger language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_status text;
  v_orc_id uuid;
begin
  v_orc_id := coalesce(new.orcamento_id, old.orcamento_id);
  select status into v_status from cotacompara.orcamentos where id = v_orc_id;
  if v_status = 'aprovado' then
    raise exception 'ORCAMENTO_APROVADO_TRAVADO';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_orc_itens_trava_aprovado on cotacompara.orcamento_itens;
create trigger trg_orc_itens_trava_aprovado
  before insert or update or delete on cotacompara.orcamento_itens
  for each row execute function cotacompara.trg_trava_orcamento_itens();

create or replace function cotacompara.trg_trava_orcamento()
returns trigger language plpgsql security definer set search_path = cotacompara, public as $$
begin
  if old.status = 'aprovado' then
    -- Bloqueia qualquer alteração em itens, preços, frete, desconto, validade, condições e integridade
    if new.numero is distinct from old.numero
       or new.empresa_id is distinct from old.empresa_id
       or new.validade_dias is distinct from old.validade_dias
       or new.prazo_entrega is distinct from old.prazo_entrega
       or new.condicao_pagamento is distinct from old.condicao_pagamento
       or new.frete is distinct from old.frete
       or new.desconto is distinct from old.desconto
       or new.aprovacao_hash is distinct from old.aprovacao_hash
       or new.aprovacao_codigo is distinct from old.aprovacao_codigo
       or new.status is distinct from old.status
    then
      raise exception 'ORCAMENTO_APROVADO_TRAVADO';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_orcamentos_trava_aprovado on cotacompara.orcamentos;
create trigger trg_orcamentos_trava_aprovado
  before update on cotacompara.orcamentos
  for each row execute function cotacompara.trg_trava_orcamento();

-- ---------------------------------------------------------------------
-- 6. RPCs Públicas do Link de Pedidos
-- ---------------------------------------------------------------------

-- Consulta dados públicos da empresa pelo token do link de pedidos
create or replace function cotacompara.empresa_link_publico(p_token text)
returns jsonb language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_emp cotacompara.empresas;
begin
  if p_token is null or length(btrim(p_token)) < 16 then
    raise exception 'LINK_INVALIDO';
  end if;

  select * into v_emp from cotacompara.empresas where pedido_link_token = btrim(p_token);
  if v_emp.id is null then
    raise exception 'LINK_INVALIDO';
  end if;

  if not coalesce(v_emp.pedido_link_ativo, true) or coalesce(v_emp.bloqueado, false) then
    raise exception 'LINK_DESATIVADO';
  end if;

  return jsonb_build_object(
    'nome', v_emp.nome,
    'cidade', v_emp.cidade,
    'uf', v_emp.uf,
    'ativo', v_emp.pedido_link_ativo
  );
end $$;

-- Cliente envia pedido pelo link
create or replace function cotacompara.criar_pedido_link(
  p_token text,
  p_cliente jsonb,
  p_itens jsonb
) returns jsonb language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_emp cotacompara.empresas;
  v_nome text;
  v_whats text;
  v_email text;
  v_doc text;
  v_obs text;
  v_item jsonb;
  v_prod text;
  v_qtd numeric;
  v_un text;
  v_total_itens int;
  v_ip text;
  v_ua text;
  v_pedidos_hora int;
  v_pedidos_pend int;
  v_proto text;
  v_agora timestamptz := now();
begin
  if p_token is null or length(btrim(p_token)) < 16 then
    raise exception 'LINK_INVALIDO';
  end if;

  select * into v_emp from cotacompara.empresas where pedido_link_token = btrim(p_token);
  if v_emp.id is null then
    raise exception 'LINK_INVALIDO';
  end if;

  if not coalesce(v_emp.pedido_link_ativo, true) or coalesce(v_emp.bloqueado, false) then
    raise exception 'LINK_DESATIVADO';
  end if;

  v_nome := left(btrim(coalesce(p_cliente->>'nome', '')), 120);
  if v_nome = '' then
    raise exception 'NOME_OBRIGATORIO';
  end if;

  v_whats := nullif(btrim(coalesce(p_cliente->>'whatsapp', '')), '');
  v_email := nullif(btrim(coalesce(p_cliente->>'email', '')), '');
  if v_whats is null and v_email is null then
    raise exception 'CONTATO_OBRIGATORIO';
  end if;

  v_doc := nullif(btrim(coalesce(p_cliente->>'documento', '')), '');
  v_obs := left(btrim(coalesce(p_cliente->>'observacoes', '')), 1000);

  if jsonb_typeof(p_itens) <> 'array' then
    raise exception 'LIMITE_ITENS';
  end if;

  v_total_itens := jsonb_array_length(p_itens);
  if v_total_itens < 1 or v_total_itens > 10 then
    raise exception 'LIMITE_ITENS';
  end if;

  for i in 0..v_total_itens - 1 loop
    v_item := p_itens->i;
    v_prod := btrim(coalesce(v_item->>'produto', ''));
    if length(v_prod) < 2 or length(v_prod) > 200 then
      raise exception 'ITEM_PRODUTO_INVALIDO';
    end if;

    begin
      v_qtd := (v_item->>'quantidade')::numeric;
    exception when others then
      raise exception 'ITEM_QUANTIDADE_INVALIDA';
    end;

    if v_qtd is null or v_qtd <= 0 or v_qtd > 1000000 then
      raise exception 'ITEM_QUANTIDADE_INVALIDA';
    end if;

    v_un := coalesce(nullif(btrim(coalesce(v_item->>'unidade', '')), ''), 'UN');
    if length(v_un) > 6 then
      raise exception 'ITEM_UNIDADE_INVALIDA';
    end if;
  end loop;

  -- Antispam
  v_ip := cotacompara.ip_requisicao();
  v_ua := cotacompara.user_agent_requisicao();

  if v_ip is not null then
    select count(*) into v_pedidos_hora
      from cotacompara.pedidos_link
     where empresa_id = v_emp.id
       and ip = v_ip
       and created_at > (v_agora - interval '1 hour');
    if v_pedidos_hora >= 3 then
      raise exception 'MUITOS_PEDIDOS';
    end if;
  end if;

  select count(*) into v_pedidos_pend
    from cotacompara.pedidos_link
   where empresa_id = v_emp.id
     and status = 'pendente';
  if v_pedidos_pend >= 30 then
    raise exception 'MUITOS_PEDIDOS';
  end if;

  v_proto := cotacompara.codigo_curto('PED');

  insert into cotacompara.pedidos_link (
    empresa_id, protocolo, status, cliente_nome, cliente_documento, cliente_whatsapp,
    cliente_email, observacoes, itens, ip, user_agent, created_at
  ) values (
    v_emp.id, v_proto, 'pendente', v_nome, v_doc, v_whats,
    v_email, v_obs, p_itens, v_ip, v_ua, v_agora
  );

  return jsonb_build_object(
    'protocolo', v_proto,
    'criado_em', v_agora
  );
end $$;

-- ---------------------------------------------------------------------
-- 7. RPCs do Fornecedor (Pedidos pelo Link)
-- ---------------------------------------------------------------------

-- Aceitar pedido pelo link e transformá-lo em orçamento rascunho
create or replace function cotacompara.aceitar_pedido_link(p_id uuid)
returns uuid language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_emp uuid := cotacompara.minha_empresa_id();
  v_ped cotacompara.pedidos_link;
  v_orc_id uuid;
  v_padrao jsonb;
  v_val_dias int := 7;
  v_prazo text;
  v_pag text;
  v_frete numeric;
  v_item jsonb;
  v_n int;
begin
  if v_emp is null then raise exception 'ACESSO_NEGADO'; end if;

  select * into v_ped from cotacompara.pedidos_link where id = p_id for update;
  if v_ped.id is null or v_ped.empresa_id <> v_emp then
    raise exception 'PEDIDO_NAO_ENCONTRADO';
  end if;

  if v_ped.status <> 'pendente' then
    if v_ped.status = 'aceito' and v_ped.orcamento_id is not null then
      return v_ped.orcamento_id;
    end if;
    raise exception 'PEDIDO_JA_DECIDIDO';
  end if;

  select orc_padrao into v_padrao from cotacompara.empresas where id = v_emp;
  if v_padrao is not null then
    v_val_dias := coalesce((v_padrao->>'validade_dias')::int, 7);
    v_prazo := v_padrao->>'prazo_entrega';
    v_pag := v_padrao->>'condicao_pagamento';
    v_frete := nullif(v_padrao->>'frete', '')::numeric;
  end if;

  insert into cotacompara.orcamentos (
    empresa_id, status, origem, cliente_nome, cliente_documento, cliente_whatsapp, cliente_email,
    referencia, validade_dias, prazo_entrega, condicao_pagamento, frete, desconto, observacoes
  ) values (
    v_emp, 'rascunho', 'link', v_ped.cliente_nome, v_ped.cliente_documento, v_ped.cliente_whatsapp,
    v_ped.cliente_email, v_ped.protocolo, v_val_dias, v_prazo, v_pag, v_frete, 0, v_ped.observacoes
  ) returning id into v_orc_id;

  v_n := jsonb_array_length(v_ped.itens);
  for i in 0..v_n - 1 loop
    v_item := v_ped.itens->i;
    insert into cotacompara.orcamento_itens (
      orcamento_id, ordem, produto, quantidade, unidade, preco_unitario, observacao
    ) values (
      v_orc_id,
      i,
      btrim(v_item->>'produto'),
      (v_item->>'quantidade')::numeric,
      coalesce(nullif(btrim(v_item->>'unidade'), ''), 'UN'),
      null,
      nullif(btrim(v_item->>'observacao'), '')
    );
  end loop;

  update cotacompara.pedidos_link
     set status = 'aceito',
         orcamento_id = v_orc_id,
         decidido_em = now()
   where id = v_ped.id;

  return v_orc_id;
end $$;

-- Recusar pedido do link
create or replace function cotacompara.recusar_pedido_link(p_id uuid)
returns void language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_emp uuid := cotacompara.minha_empresa_id();
  v_ped cotacompara.pedidos_link;
begin
  if v_emp is null then raise exception 'ACESSO_NEGADO'; end if;

  select * into v_ped from cotacompara.pedidos_link where id = p_id for update;
  if v_ped.id is null or v_ped.empresa_id <> v_emp then
    raise exception 'PEDIDO_NAO_ENCONTRADO';
  end if;

  update cotacompara.pedidos_link
     set status = 'recusado', decidido_em = now()
   where id = v_ped.id;
end $$;

-- Gerar novo link de pedidos para a empresa logada
create or replace function cotacompara.novo_link_pedido()
returns text language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_emp uuid := cotacompara.minha_empresa_id();
  v_novo text;
begin
  if v_emp is null then raise exception 'ACESSO_NEGADO'; end if;
  v_novo := replace(gen_random_uuid()::text, '-', '');
  update cotacompara.empresas
     set pedido_link_token = v_novo,
         pedido_link_ativo = true
   where id = v_emp;
  return v_novo;
end $$;

-- ---------------------------------------------------------------------
-- 8. Aprovação v2 e Verificação Pública
-- ---------------------------------------------------------------------

create or replace function cotacompara.aprovar_orcamento_v2(
  p_token text,
  p_nome text,
  p_doc_tipo text,
  p_documento text,
  p_dados jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_orc cotacompara.orcamentos;
  v_emp cotacompara.empresas;
  v_doc_limpo text;
  v_codigo text;
  v_hash text;
  v_validade date;
  v_dados_filtrados jsonb;
  v_sub numeric := 0;
  v_total numeric := 0;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'LINK_INVALIDO'; end if;
  select * into v_orc from cotacompara.orcamentos where token = p_token for update;
  if v_orc.id is null then raise exception 'LINK_INVALIDO'; end if;
  select * into v_emp from cotacompara.empresas where id = v_orc.empresa_id;

  select coalesce(sum(round(quantidade * preco_unitario, 2)), 0) into v_sub
    from cotacompara.orcamento_itens where orcamento_id = v_orc.id and preco_unitario is not null;
  v_total := greatest(v_sub - coalesce(v_orc.desconto, 0), 0) + coalesce(v_orc.frete, 0);

  if v_orc.status = 'aprovado' then
    return jsonb_build_object(
      'ok', true,
      'ja_aprovado', true,
      'codigo', v_orc.aprovacao_codigo,
      'aprovado_em', v_orc.aprovado_em,
      'hash', v_orc.aprovacao_hash,
      'validade', v_orc.aprovacao_validade,
      'fornecedor', v_emp.nome,
      'numero', v_orc.numero,
      'total', v_total
    );
  end if;

  if v_orc.status not in ('enviado') then raise exception 'ORCAMENTO_INDISPONIVEL'; end if;
  if now() > coalesce(v_orc.enviado_em, v_orc.created_at) + make_interval(days => v_orc.validade_dias) then
    raise exception 'ORCAMENTO_VENCIDO';
  end if;
  if coalesce(btrim(p_nome), '') = '' then raise exception 'NOME_OBRIGATORIO'; end if;

  if p_doc_tipo not in ('CNPJ', 'CPF') then raise exception 'DOCUMENTO_INVALIDO'; end if;
  v_doc_limpo := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');

  if p_doc_tipo = 'CNPJ' then
    if not cotacompara.cnpj_valido(v_doc_limpo) then raise exception 'DOCUMENTO_INVALIDO'; end if;
  else
    if not cotacompara.cpf_valido(v_doc_limpo) then raise exception 'DOCUMENTO_INVALIDO'; end if;
  end if;

  v_dados_filtrados := jsonb_build_object(
    'razao_social', left(coalesce(p_dados->>'razao_social', ''), 200),
    'nome_fantasia', left(coalesce(p_dados->>'nome_fantasia', ''), 200),
    'cidade', left(coalesce(p_dados->>'cidade', ''), 200),
    'uf', left(coalesce(p_dados->>'uf', ''), 200),
    'situacao', left(coalesce(p_dados->>'situacao', ''), 200),
    'fonte', case when p_dados->>'fonte' = 'consulta' then 'consulta' else 'informado' end
  );

  v_codigo := cotacompara.codigo_curto('APV');
  v_hash := cotacompara.hash_orcamento(v_orc.id);
  v_validade := (coalesce(v_orc.enviado_em, v_orc.created_at) + make_interval(days => v_orc.validade_dias))::date;

  update cotacompara.orcamentos
     set status = 'aprovado',
         aprovado_em = now(),
         aprovado_por = left(btrim(p_nome), 120),
         aprovacao_codigo = v_codigo,
         aprovacao_doc_tipo = p_doc_tipo,
         aprovacao_documento = v_doc_limpo,
         aprovacao_dados = v_dados_filtrados,
         aprovacao_hash = v_hash,
         aprovacao_ip = cotacompara.ip_requisicao(),
         aprovacao_user_agent = cotacompara.user_agent_requisicao(),
         aprovacao_validade = v_validade,
         cliente_documento = coalesce(cliente_documento, v_doc_limpo),
         cliente_nome = coalesce(cliente_nome, nullif(btrim(p_dados->>'razao_social'), ''), left(btrim(p_nome), 120))
   where id = v_orc.id;

  return jsonb_build_object(
    'ok', true,
    'codigo', v_codigo,
    'aprovado_em', now(),
    'hash', v_hash,
    'validade', v_validade,
    'fornecedor', v_emp.nome,
    'numero', v_orc.numero,
    'total', v_total
  );
end $$;

-- Atualizar orcamento_publico para incluir dados da aprovação (sem IP e User Agent)
create or replace function cotacompara.orcamento_publico(p_token text)
returns jsonb language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_orc  cotacompara.orcamentos;
  v_emp  cotacompara.empresas;
  v_dono boolean;
  v_sub  numeric := 0;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'LINK_INVALIDO'; end if;
  select * into v_orc from cotacompara.orcamentos where token = p_token;
  if v_orc.id is null then raise exception 'LINK_INVALIDO'; end if;
  select * into v_emp from cotacompara.empresas where id = v_orc.empresa_id;

  -- conta só a visita do cliente (o próprio fornecedor conferindo não conta)
  v_dono := v_emp.owner_id is not distinct from auth.uid();
  if not v_dono then
    update cotacompara.orcamentos
       set visualizacoes = visualizacoes + 1,
           visualizado_em = coalesce(visualizado_em, now())
     where id = v_orc.id;
  end if;

  select coalesce(sum(round(quantidade * preco_unitario, 2)), 0) into v_sub
    from cotacompara.orcamento_itens where orcamento_id = v_orc.id and preco_unitario is not null;

  return jsonb_build_object(
    'empresa', jsonb_build_object(
      'nome', v_emp.nome, 'razao_social', v_emp.razao_social, 'cnpj', v_emp.cnpj,
      'endereco', v_emp.endereco, 'cidade', v_emp.cidade, 'uf', v_emp.uf, 'cep', v_emp.cep,
      'telefone', v_emp.telefone, 'email', v_emp.email_contato, 'responsavel', v_emp.responsavel,
      'logo_url', v_emp.logo_url),
    'orcamento', jsonb_build_object(
      'numero', v_orc.numero, 'status', v_orc.status, 'criado_em', v_orc.created_at,
      'enviado_em', v_orc.enviado_em,
      'valido_ate', (coalesce(v_orc.enviado_em, v_orc.created_at) + make_interval(days => v_orc.validade_dias)),
      'validade_dias', v_orc.validade_dias,
      'cliente_nome', v_orc.cliente_nome, 'cliente_documento', v_orc.cliente_documento,
      'referencia', v_orc.referencia, 'prazo_entrega', v_orc.prazo_entrega,
      'condicao_pagamento', v_orc.condicao_pagamento, 'frete', v_orc.frete, 'desconto', v_orc.desconto,
      'observacoes', v_orc.observacoes, 'aprovado_em', v_orc.aprovado_em, 'aprovado_por', v_orc.aprovado_por,
      'aprovacao_codigo', v_orc.aprovacao_codigo,
      'aprovacao_doc_tipo', v_orc.aprovacao_doc_tipo,
      'aprovacao_documento', v_orc.aprovacao_documento,
      'aprovacao_dados', v_orc.aprovacao_dados,
      'aprovacao_hash', v_orc.aprovacao_hash,
      'aprovacao_validade', v_orc.aprovacao_validade,
      'subtotal', v_sub,
      'total', greatest(v_sub - coalesce(v_orc.desconto, 0), 0) + coalesce(v_orc.frete, 0)),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'produto', i.produto, 'quantidade', i.quantidade, 'unidade', i.unidade,
               'preco_unitario', i.preco_unitario, 'observacao', i.observacao,
               'subtotal', case when i.preco_unitario is null then null else round(i.quantidade * i.preco_unitario, 2) end)
             order by i.ordem)
        from cotacompara.orcamento_itens i where i.orcamento_id = v_orc.id), '[]'::jsonb),
    'sou_dono', v_dono
  );
end $$;

-- Verificação pública de integridade da aprovação
create or replace function cotacompara.verificar_aprovacao(p_codigo text)
returns jsonb language plpgsql security definer set search_path = cotacompara, public as $$
declare
  v_orc cotacompara.orcamentos;
  v_emp cotacompara.empresas;
  v_doc_mascarado text;
  v_sub numeric := 0;
  v_total numeric := 0;
begin
  if p_codigo is null or length(btrim(p_codigo)) < 6 then raise exception 'CODIGO_INEXISTENTE'; end if;
  select * into v_orc from cotacompara.orcamentos where aprovacao_codigo = btrim(p_codigo);
  if v_orc.id is null then raise exception 'CODIGO_INEXISTENTE'; end if;
  select * into v_emp from cotacompara.empresas where id = v_orc.empresa_id;

  select coalesce(sum(round(quantidade * preco_unitario, 2)), 0) into v_sub
    from cotacompara.orcamento_itens where orcamento_id = v_orc.id and preco_unitario is not null;
  v_total := greatest(v_sub - coalesce(v_orc.desconto, 0), 0) + coalesce(v_orc.frete, 0);

  if v_orc.aprovacao_doc_tipo = 'CNPJ' and length(coalesce(v_orc.aprovacao_documento, '')) = 14 then
    -- 12.***.***/0001-**
    v_doc_mascarado := substr(v_orc.aprovacao_documento, 1, 2) || '.***.***/' || substr(v_orc.aprovacao_documento, 9, 4) || '-**';
  elsif v_orc.aprovacao_doc_tipo = 'CPF' and length(coalesce(v_orc.aprovacao_documento, '')) = 11 then
    -- ***.123.456-**
    v_doc_mascarado := '***.' || substr(v_orc.aprovacao_documento, 4, 3) || '.' || substr(v_orc.aprovacao_documento, 7, 3) || '-**';
  else
    v_doc_mascarado := '***';
  end if;

  return jsonb_build_object(
    'fornecedor', jsonb_build_object(
      'nome', v_emp.nome,
      'cnpj', v_emp.cnpj
    ),
    'numero', v_orc.numero,
    'cliente', jsonb_build_object(
      'nome', v_orc.aprovado_por,
      'documento', v_doc_mascarado,
      'doc_tipo', v_orc.aprovacao_doc_tipo,
      'dados', v_orc.aprovacao_dados
    ),
    'aprovado_em', v_orc.aprovado_em,
    'validade', v_orc.aprovacao_validade,
    'hash', v_orc.aprovacao_hash,
    'integro', (v_orc.aprovacao_hash = cotacompara.hash_orcamento(v_orc.id)),
    'total', v_total
  );
end $$;

-- ---------------------------------------------------------------------
-- 9. Permissões
-- ---------------------------------------------------------------------

revoke all on function cotacompara.empresa_link_publico(text)                       from public;
revoke all on function cotacompara.criar_pedido_link(text, jsonb, jsonb)            from public;
revoke all on function cotacompara.aceitar_pedido_link(uuid)                        from public;
revoke all on function cotacompara.recusar_pedido_link(uuid)                        from public;
revoke all on function cotacompara.novo_link_pedido()                               from public;
revoke all on function cotacompara.aprovar_orcamento_v2(text, text, text, text, jsonb) from public;
revoke all on function cotacompara.verificar_aprovacao(text)                        from public;

grant execute on function cotacompara.empresa_link_publico(text)                       to anon, authenticated;
grant execute on function cotacompara.criar_pedido_link(text, jsonb, jsonb)            to anon, authenticated;
grant execute on function cotacompara.aprovar_orcamento_v2(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function cotacompara.verificar_aprovacao(text)                        to anon, authenticated;

grant execute on function cotacompara.aceitar_pedido_link(uuid) to authenticated;
grant execute on function cotacompara.recusar_pedido_link(uuid) to authenticated;
grant execute on function cotacompara.novo_link_pedido()        to authenticated;

-- ---------------------------------------------------------------------
-- 10. Realtime: pedidos do link caem ao vivo para o fornecedor
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'cotacompara' and tablename = 'pedidos_link') then
    alter publication supabase_realtime add table cotacompara.pedidos_link;
  end if;
end $$;

notify pgrst, 'reload schema';
