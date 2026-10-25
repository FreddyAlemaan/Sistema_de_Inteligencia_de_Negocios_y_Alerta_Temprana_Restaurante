-- =============================================================================
-- SIN&AT — Migración 13: permisos por usuario
--
-- El gerente decide, usuario por usuario, qué puede hacer el personal
-- operativo. Cinco permisos:
--   comandas   abrir mesas, marcar "Listo" y cerrar
--   registro   recepción, consumo, merma y llegada de entregas
--   tablero    ver el tablero de indicadores
--   pedido     ver el pedido sugerido y confirmarlo
--   catalogos  agregar y cambiar insumos y proveedores
-- El gerente los tiene todos siempre. Los costos y la configuración del motor
-- siguen siendo sólo del gerente (migración 5).
--
-- Se guardan en una columna de perfil (no hace falta tabla nueva). Nadie la
-- edita directamente: sólo con asignar_permisos(), que exige ser gerente.
-- Cada función que escribe datos comprueba su permiso aquí, en la base: la
-- pantalla sólo esconde lo que no se puede usar.
-- =============================================================================

alter table public.perfil
  add column if not exists permisos text[] not null default '{comandas,registro}';

alter table public.perfil drop constraint if exists perfil_permisos_validos;
alter table public.perfil
  add constraint perfil_permisos_validos
  check (permisos <@ array['comandas', 'registro', 'tablero', 'pedido', 'catalogos']);

comment on column public.perfil.permisos is
  'Qué puede hacer un operativo (el gerente puede todo). Se cambia con asignar_permisos().';

-- -----------------------------------------------------------------------------
-- ¿Quien consulta tiene este permiso?
-- -----------------------------------------------------------------------------
create or replace function public.tiene_permiso(p_permiso text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.es_gerente()
      or coalesce((select p_permiso = any(p.permisos)
                   from public.perfil p where p.id = auth.uid()), false);
$$;

revoke execute on function public.tiene_permiso(text) from public, anon;
grant  execute on function public.tiene_permiso(text) to authenticated;

create or replace function public.exigir_permiso(p_permiso text, p_que text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.tiene_permiso(p_permiso) then
    raise exception 'No tienes permiso para %. Pídeselo al gerente.', p_que
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.exigir_permiso(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- El gerente asigna los permisos
-- -----------------------------------------------------------------------------
create or replace function public.asignar_permisos(p_perfil_id uuid, p_permisos text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_gerente() then
    raise exception 'Sólo el gerente puede cambiar permisos.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.perfil where id = p_perfil_id) then
    raise exception 'El usuario no existe.';
  end if;

  update public.perfil
  set permisos = (select coalesce(array_agg(distinct x order by x), '{}')
                  from unnest(coalesce(p_permisos, '{}')) x)
  where id = p_perfil_id;
end;
$$;

revoke execute on function public.asignar_permisos(uuid, text[]) from public, anon;
grant  execute on function public.asignar_permisos(uuid, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Comandas y registro: cada función queda envuelta por otra que primero
-- comprueba el permiso. La original se renombra y sólo la llama su envoltura.
-- -----------------------------------------------------------------------------
alter function public.abrir_comanda(text, integer)  rename to abrir_comanda_sin_permiso;
alter function public.marcar_listo(bigint)          rename to marcar_listo_sin_permiso;
alter function public.cerrar_comanda(bigint)        rename to cerrar_comanda_sin_permiso;
alter function public.registrar_recepcion(bigint, numeric, date, numeric)
  rename to registrar_recepcion_sin_permiso;
alter function public.registrar_salida(bigint, text, numeric, text, bigint)
  rename to registrar_salida_sin_permiso;
alter function public.registrar_llegada(bigint, boolean) rename to registrar_llegada_sin_permiso;

revoke execute on function public.abrir_comanda_sin_permiso(text, integer) from public, anon, authenticated;
revoke execute on function public.marcar_listo_sin_permiso(bigint)        from public, anon, authenticated;
revoke execute on function public.cerrar_comanda_sin_permiso(bigint)      from public, anon, authenticated;
revoke execute on function public.registrar_recepcion_sin_permiso(bigint, numeric, date, numeric)
  from public, anon, authenticated;
revoke execute on function public.registrar_salida_sin_permiso(bigint, text, numeric, text, bigint)
  from public, anon, authenticated;
revoke execute on function public.registrar_llegada_sin_permiso(bigint, boolean)
  from public, anon, authenticated;

create or replace function public.abrir_comanda(p_mesa text, p_comensales integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_permiso('comandas', 'abrir mesas');
  return public.abrir_comanda_sin_permiso(p_mesa, p_comensales);
end;
$$;

create or replace function public.marcar_listo(p_comanda_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_permiso('comandas', 'marcar comandas');
  perform public.marcar_listo_sin_permiso(p_comanda_id);
end;
$$;

create or replace function public.cerrar_comanda(p_comanda_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_permiso('comandas', 'cerrar mesas');
  perform public.cerrar_comanda_sin_permiso(p_comanda_id);
end;
$$;

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
begin
  perform public.exigir_permiso('registro', 'registrar inventario');
  return public.registrar_recepcion_sin_permiso(p_insumo_id, p_cantidad, p_fecha_caducidad, p_costo_unitario);
end;
$$;

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
begin
  perform public.exigir_permiso('registro', 'registrar inventario');
  return public.registrar_salida_sin_permiso(p_insumo_id, p_tipo, p_cantidad, p_motivo, p_lote_id);
end;
$$;

create or replace function public.registrar_llegada(p_entrega_id bigint, p_conforme boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exigir_permiso('registro', 'registrar entregas');
  perform public.registrar_llegada_sin_permiso(p_entrega_id, p_conforme);
end;
$$;

revoke execute on function public.abrir_comanda(text, integer) from public, anon;
revoke execute on function public.marcar_listo(bigint)         from public, anon;
revoke execute on function public.cerrar_comanda(bigint)       from public, anon;
revoke execute on function public.registrar_recepcion(bigint, numeric, date, numeric) from public, anon;
revoke execute on function public.registrar_salida(bigint, text, numeric, text, bigint) from public, anon;
revoke execute on function public.registrar_llegada(bigint, boolean) from public, anon;
grant  execute on function public.abrir_comanda(text, integer) to authenticated;
grant  execute on function public.marcar_listo(bigint)         to authenticated;
grant  execute on function public.cerrar_comanda(bigint)       to authenticated;
grant  execute on function public.registrar_recepcion(bigint, numeric, date, numeric) to authenticated;
grant  execute on function public.registrar_salida(bigint, text, numeric, text, bigint) to authenticated;
grant  execute on function public.registrar_llegada(bigint, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Pedido: confirmar ya no es sólo del gerente, sino de quien tenga el permiso.
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
  perform public.exigir_permiso('pedido', 'confirmar pedidos');

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
  'Registra una entrega esperada del proveedor para hoy + su lead time. Requiere el permiso "pedido".';

-- -----------------------------------------------------------------------------
-- Catálogos: insumos y proveedores los edita quien tenga el permiso.
-- -----------------------------------------------------------------------------
drop policy if exists proveedor_insert on public.proveedor;
drop policy if exists proveedor_update on public.proveedor;
create policy proveedor_insert on public.proveedor
  for insert to authenticated with check (public.tiene_permiso('catalogos'));
create policy proveedor_update on public.proveedor
  for update to authenticated
  using (public.tiene_permiso('catalogos')) with check (public.tiene_permiso('catalogos'));

drop policy if exists insumo_insert on public.insumo;
drop policy if exists insumo_update on public.insumo;
create policy insumo_insert on public.insumo
  for insert to authenticated with check (public.tiene_permiso('catalogos'));
create policy insumo_update on public.insumo
  for update to authenticated
  using (public.tiene_permiso('catalogos')) with check (public.tiene_permiso('catalogos'));
