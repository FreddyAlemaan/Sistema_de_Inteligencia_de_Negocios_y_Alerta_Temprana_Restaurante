-- =============================================================================
-- SIN&AT — Migración 6: registro de suministro (recepción, consumo, merma)
--
-- La lógica vive en la base de datos (AGENTS.md §7):
--   * registrar_recepcion  crea el lote y su movimiento ENTRADA.
--   * registrar_salida     descuenta CONSUMO o MERMA repartiendo entre lotes
--                          por orden de caducidad (FEFO: primero el que
--                          caduca antes).
--   * existencias          existencia actual por insumo, siempre al día.
-- Un trigger sobre movimiento mantiene lote.cantidad_actual, de modo que la
-- existencia nunca se desincroniza del libro de movimientos.
--
-- Los clientes ya no insertan en lote ni en movimiento directamente: sólo a
-- través de estas funciones, que validan y registran a nombre de quien opera.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Privilegios: el libro de movimientos es inmutable para los clientes
-- -----------------------------------------------------------------------------
revoke insert, update on public.lote       from authenticated;
revoke insert, update on public.movimiento from authenticated;

-- El gerente sólo puede corregir datos descriptivos del lote (no cantidades).
grant update (proveedor_id, fecha_caducidad, costo_unitario) on public.lote to authenticated;

drop policy if exists lote_insert       on public.lote;
drop policy if exists movimiento_insert on public.movimiento;
drop policy if exists movimiento_update on public.movimiento;

-- -----------------------------------------------------------------------------
-- Usuario que opera: debe tener sesión y perfil
-- -----------------------------------------------------------------------------
create or replace function public.usuario_operando()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
begin
  if v_usuario is null or not exists (select 1 from public.perfil where id = v_usuario) then
    raise exception 'Sesión no válida. Vuelve a iniciar sesión.' using errcode = '28000';
  end if;
  return v_usuario;
end;
$$;

revoke execute on function public.usuario_operando() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Trigger: cada CONSUMO o MERMA descuenta su lote
-- -----------------------------------------------------------------------------
create or replace function public.aplicar_movimiento_a_lote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insumo_lote bigint;
begin
  if new.lote_id is null then
    return new;
  end if;

  select insumo_id into v_insumo_lote from public.lote where id = new.lote_id;
  if v_insumo_lote is distinct from new.insumo_id then
    raise exception 'El lote % no corresponde al insumo %.', new.lote_id, new.insumo_id;
  end if;

  if new.tipo in ('CONSUMO', 'MERMA') then
    -- La restricción cantidad_actual >= 0 impide sacar más de lo que hay.
    update public.lote
    set cantidad_actual = cantidad_actual - new.cantidad
    where id = new.lote_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.aplicar_movimiento_a_lote() from public, anon, authenticated;

drop trigger if exists movimiento_aplicar_a_lote on public.movimiento;
create trigger movimiento_aplicar_a_lote
  after insert on public.movimiento
  for each row execute function public.aplicar_movimiento_a_lote();

-- -----------------------------------------------------------------------------
-- Recepción: insumo + cantidad (+ caducidad y costo opcionales)
--   caducidad por defecto = hoy + vida útil del insumo
--   costo por defecto     = último costo conocido del insumo
--   proveedor             = proveedor habitual del insumo
-- -----------------------------------------------------------------------------
create or replace function public.registrar_recepcion(
  p_insumo_id       bigint,
  p_cantidad        numeric,
  p_fecha_caducidad date    default null,
  p_costo_unitario  numeric default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := public.usuario_operando();
  v_insumo  public.insumo%rowtype;
  v_costo   numeric;
  v_lote_id bigint;
begin
  select * into v_insumo from public.insumo where id = p_insumo_id;
  if not found or not v_insumo.activo then
    raise exception 'El insumo no existe o está inactivo.';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero.';
  end if;
  if p_fecha_caducidad is not null and p_fecha_caducidad < current_date then
    raise exception 'La fecha de caducidad no puede ser anterior a hoy.';
  end if;
  if p_costo_unitario is not null and p_costo_unitario < 0 then
    raise exception 'El costo no puede ser negativo.';
  end if;

  v_costo := coalesce(
    p_costo_unitario,
    (select l.costo_unitario from public.lote l
     where l.insumo_id = p_insumo_id
     order by l.fecha_recepcion desc, l.id desc
     limit 1),
    0);

  insert into public.lote (insumo_id, proveedor_id, cantidad_inicial, cantidad_actual,
                           fecha_recepcion, fecha_caducidad, costo_unitario)
  values (p_insumo_id, v_insumo.proveedor_id, p_cantidad, p_cantidad,
          current_date, coalesce(p_fecha_caducidad, current_date + v_insumo.vida_util_dias), v_costo)
  returning id into v_lote_id;

  insert into public.movimiento (insumo_id, lote_id, tipo, cantidad, motivo, usuario_id)
  values (p_insumo_id, v_lote_id, 'ENTRADA', p_cantidad, 'Recepción de lote', v_usuario);

  return v_lote_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Consumo o merma: insumo + cantidad (+ motivo en la merma)
--   Se reparte entre los lotes con existencia por orden de caducidad (FEFO).
--   El CONSUMO no toma lotes ya caducados; la MERMA sí (es lo que se bota).
--   p_lote_id permite indicar un lote concreto (p. ej. botar uno caducado).
--   Devuelve la existencia que queda del insumo.
-- -----------------------------------------------------------------------------
create or replace function public.registrar_salida(
  p_insumo_id bigint,
  p_tipo      text,
  p_cantidad  numeric,
  p_motivo    text   default null,
  p_lote_id   bigint default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario    uuid := public.usuario_operando();
  v_unidad     text;
  v_disponible numeric;
  v_resto      numeric := p_cantidad;
  v_toma       numeric;
  v_lote       record;
begin
  if p_tipo not in ('CONSUMO', 'MERMA') then
    raise exception 'Tipo de movimiento no válido: %.', p_tipo;
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero.';
  end if;
  if p_tipo = 'MERMA' and length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Indica el motivo de la merma.';
  end if;

  select unidad into v_unidad from public.insumo where id = p_insumo_id;
  if not found then
    raise exception 'El insumo no existe.';
  end if;

  -- Bloquea los lotes del insumo para que dos registros simultáneos no
  -- descuenten la misma existencia.
  perform 1 from public.lote
  where insumo_id = p_insumo_id and cantidad_actual > 0
  for update;

  select coalesce(sum(cantidad_actual), 0) into v_disponible
  from public.lote
  where insumo_id = p_insumo_id
    and cantidad_actual > 0
    and (p_lote_id is null or id = p_lote_id)
    and (p_tipo = 'MERMA' or fecha_caducidad >= current_date);

  if p_cantidad > v_disponible then
    raise exception 'Sólo hay % % disponibles%.',
      replace(trim_scale(v_disponible)::text, '.', ','), v_unidad,
      case when p_tipo = 'CONSUMO' then ' sin caducar' else '' end;
  end if;

  for v_lote in
    select id, cantidad_actual
    from public.lote
    where insumo_id = p_insumo_id
      and cantidad_actual > 0
      and (p_lote_id is null or id = p_lote_id)
      and (p_tipo = 'MERMA' or fecha_caducidad >= current_date)
    order by fecha_caducidad, fecha_recepcion, id
  loop
    exit when v_resto <= 0;
    v_toma := least(v_resto, v_lote.cantidad_actual);
    insert into public.movimiento (insumo_id, lote_id, tipo, cantidad, motivo, usuario_id)
    values (p_insumo_id, v_lote.id, p_tipo, v_toma, nullif(trim(coalesce(p_motivo, '')), ''), v_usuario);
    v_resto := v_resto - v_toma;
  end loop;

  return (select coalesce(sum(cantidad_actual), 0) from public.lote where insumo_id = p_insumo_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Existencia por insumo (todos los insumos, aunque estén en cero)
--   existencia           total en almacén (incluye lo caducado que aún no se botó)
--   existencia_caducada  parte de la existencia que ya pasó su fecha
--   proxima_caducidad    el lote vigente que caduca antes, y DRC de ese lote
--   bajo_minimo          existencia vigente por debajo de insumo.stock_minimo
-- -----------------------------------------------------------------------------
create or replace function public.existencias()
returns table (
  insumo_id           bigint,
  existencia          numeric,
  existencia_caducada numeric,
  lotes_con_stock     integer,
  proxima_caducidad   date,
  dias_a_caducidad    integer,
  bajo_minimo         boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    x.insumo_id,
    x.existencia,
    x.existencia_caducada,
    x.lotes_con_stock,
    x.proxima_caducidad,
    x.proxima_caducidad - current_date,
    (x.existencia - x.existencia_caducada) < x.stock_minimo
  from (
    select
      i.id as insumo_id,
      i.stock_minimo,
      coalesce(sum(l.cantidad_actual), 0) as existencia,
      coalesce(sum(l.cantidad_actual) filter (where l.fecha_caducidad < current_date), 0)
        as existencia_caducada,
      count(l.id)::integer as lotes_con_stock,
      min(l.fecha_caducidad) filter (where l.fecha_caducidad >= current_date) as proxima_caducidad
    from public.insumo i
    left join public.lote l on l.insumo_id = i.id and l.cantidad_actual > 0
    group by i.id, i.stock_minimo
  ) x;
$$;

revoke execute on function public.registrar_recepcion(bigint, numeric, date, numeric) from public, anon;
revoke execute on function public.registrar_salida(bigint, text, numeric, text, bigint) from public, anon;
revoke execute on function public.existencias() from public, anon;
grant  execute on function public.registrar_recepcion(bigint, numeric, date, numeric) to authenticated;
grant  execute on function public.registrar_salida(bigint, text, numeric, text, bigint) to authenticated;
grant  execute on function public.existencias() to authenticated;
