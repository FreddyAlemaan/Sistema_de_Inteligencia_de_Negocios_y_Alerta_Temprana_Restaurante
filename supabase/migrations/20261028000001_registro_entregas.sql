-- =============================================================================
-- SIN&AT — Migración 11: registro de entregas de proveedores
--
-- Cierra el ciclo del cumplimiento de proveedores TCP(p) con datos reales:
--   * confirmar_pedido    el gerente confirma el pedido de un proveedor y queda
--                         una entrega esperada para hoy + lead time.
--   * registrar_llegada   quien recibe marca que llegó y si vino conforme
--                         (completa y en buen estado). La fecha la pone la base.
-- Así R3 (proveedor_no_confiable) y R4 (faltante crítico) reaccionan a lo que
-- pasa de verdad y no sólo a los datos de prueba.
--
-- Los clientes ya no escriben en entrega directamente: un registro a mano
-- podría alterar el cumplimiento de un proveedor. Sólo el gerente puede
-- corregir una entrega (p. ej. una fecha mal anotada).
-- =============================================================================

drop policy if exists entrega_insert on public.entrega;
drop policy if exists entrega_update on public.entrega;

create policy entrega_insert on public.entrega
  for insert to authenticated with check (public.es_gerente());
create policy entrega_update on public.entrega
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());

-- -----------------------------------------------------------------------------
-- Confirmar el pedido de un proveedor (sólo gerente)
--   fecha esperada = hoy + lead_time_dias del proveedor
-- -----------------------------------------------------------------------------
create or replace function public.confirmar_pedido(p_proveedor_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario   uuid := public.usuario_operando();
  v_proveedor public.proveedor%rowtype;
  v_fecha     date;
  v_id        bigint;
begin
  if not public.es_gerente() then
    raise exception 'Sólo el gerente puede confirmar pedidos.' using errcode = '42501';
  end if;

  select * into v_proveedor from public.proveedor where id = p_proveedor_id;
  if not found or not v_proveedor.activo then
    raise exception 'El proveedor no existe o está inactivo.';
  end if;

  v_fecha := current_date + v_proveedor.lead_time_dias;

  -- Un doble clic no debe contar como dos entregas.
  if exists (select 1 from public.entrega
             where proveedor_id = p_proveedor_id
               and fecha_real is null
               and fecha_esperada = v_fecha) then
    raise exception 'Ya hay un pedido confirmado de % que llega el %.',
      v_proveedor.nombre, to_char(v_fecha, 'DD/MM/YYYY');
  end if;

  insert into public.entrega (proveedor_id, fecha_esperada)
  values (p_proveedor_id, v_fecha)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.confirmar_pedido(bigint) is
  'Registra una entrega esperada del proveedor para hoy + su lead time. Sólo gerente.';

-- -----------------------------------------------------------------------------
-- Registrar la llegada de una entrega pendiente (cualquiera con perfil)
--   a tiempo = llegó hoy y hoy <= fecha esperada (lo calcula v_kpi_suministro)
-- -----------------------------------------------------------------------------
create or replace function public.registrar_llegada(p_entrega_id bigint, p_conforme boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := public.usuario_operando();
begin
  if p_conforme is null then
    raise exception 'Indica si la entrega vino completa y en buen estado.';
  end if;

  update public.entrega
  set fecha_real = current_date,
      conforme   = p_conforme
  where id = p_entrega_id
    and fecha_real is null;

  if not found then
    raise exception 'Esta entrega ya se había registrado como recibida.';
  end if;
end;
$$;

comment on function public.registrar_llegada(bigint, boolean) is
  'Marca una entrega pendiente como recibida hoy, conforme o no.';

revoke execute on function public.confirmar_pedido(bigint)           from public, anon;
revoke execute on function public.registrar_llegada(bigint, boolean) from public, anon;
grant  execute on function public.confirmar_pedido(bigint)           to authenticated;
grant  execute on function public.registrar_llegada(bigint, boolean) to authenticated;
