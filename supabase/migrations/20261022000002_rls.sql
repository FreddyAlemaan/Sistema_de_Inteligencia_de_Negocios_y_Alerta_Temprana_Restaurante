-- =============================================================================
-- SIN&AT — Migración 2: Row Level Security
--
-- Principios:
--   * anon no ve nada: toda la app requiere sesión.
--   * Cualquier usuario autenticado lee todo (restaurante único, equipo pequeño).
--   * operativo registra la operación diaria: recepciones, consumos, mermas,
--     entregas, comandas y atiende alertas.
--   * gerente además administra catálogos, reglas, perfiles y corrige registros.
--   * Nadie borra: los registros históricos se conservan y los catálogos se
--     desactivan con su campo "activo" (AGENTS.md §7).
--   * hecho y alerta sólo los escribe el motor (funciones SECURITY DEFINER,
--     paso 6); los clientes sólo pueden atender alertas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones auxiliares. SECURITY DEFINER para poder leer perfil sin
-- disparar recursión de políticas sobre la propia tabla perfil.
-- -----------------------------------------------------------------------------
create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.rol from public.perfil p where p.id = auth.uid();
$$;

create or replace function public.es_gerente()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.rol_actual() = 'gerente', false);
$$;

revoke execute on function public.rol_actual() from public, anon;
revoke execute on function public.es_gerente() from public, anon;
grant  execute on function public.rol_actual() to authenticated;
grant  execute on function public.es_gerente() to authenticated;

-- -----------------------------------------------------------------------------
-- Privilegios de tabla. RLS filtra filas; los GRANT de columna limitan qué se
-- puede modificar en las tablas sensibles.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- Ningún cliente puede borrar filas (registros históricos inmutables).
revoke delete, truncate on all tables in schema public from authenticated;

-- perfil: sólo se edita nombre y rol (rol sólo lo cambia un gerente, ver política)
revoke insert, update, delete on public.perfil from authenticated;
grant  update (nombre, rol) on public.perfil to authenticated;

-- regla: el catálogo es fijo; el gerente sólo ajusta parámetros
revoke insert, update, delete on public.regla from authenticated;
grant  update (umbral, severidad_base, ventana_supresion_min, activa) on public.regla to authenticated;

-- hecho: sólo lectura para clientes
revoke insert, update, delete on public.hecho from authenticated;

-- alerta: sólo se pueden tocar los campos de atención
revoke insert, update, delete on public.alerta from authenticated;
grant  update (estado, atendida_por, atendida_en, accion_tomada) on public.alerta to authenticated;

-- -----------------------------------------------------------------------------
-- Activar RLS en las 10 tablas
-- -----------------------------------------------------------------------------
alter table public.perfil     enable row level security;
alter table public.proveedor  enable row level security;
alter table public.insumo     enable row level security;
alter table public.lote       enable row level security;
alter table public.movimiento enable row level security;
alter table public.entrega    enable row level security;
alter table public.comanda    enable row level security;
alter table public.regla      enable row level security;
alter table public.hecho      enable row level security;
alter table public.alerta     enable row level security;

-- -----------------------------------------------------------------------------
-- perfil
-- -----------------------------------------------------------------------------
create policy perfil_select on public.perfil
  for select to authenticated
  using (id = auth.uid() or public.es_gerente());

-- Cada quien edita su nombre; sólo el gerente cambia roles o edita a otros.
create policy perfil_update on public.perfil
  for update to authenticated
  using (id = auth.uid() or public.es_gerente())
  with check (public.es_gerente() or rol = public.rol_actual());

-- (El alta de perfiles la hará un trigger sobre auth.users en el paso 2.)

-- -----------------------------------------------------------------------------
-- proveedor e insumo: lectura para todos, escritura para gerente.
-- Para "eliminar" se marca activo = false.
-- -----------------------------------------------------------------------------
create policy proveedor_select on public.proveedor
  for select to authenticated using (true);
create policy proveedor_insert on public.proveedor
  for insert to authenticated with check (public.es_gerente());
create policy proveedor_update on public.proveedor
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());

create policy insumo_select on public.insumo
  for select to authenticated using (true);
create policy insumo_insert on public.insumo
  for insert to authenticated with check (public.es_gerente());
create policy insumo_update on public.insumo
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());

-- -----------------------------------------------------------------------------
-- lote: cualquiera registra una recepción (lote nuevo, entero);
-- sólo el gerente corrige. La existencia la ajustará el trigger
-- de movimientos (paso 4).
-- -----------------------------------------------------------------------------
create policy lote_select on public.lote
  for select to authenticated using (true);
create policy lote_insert on public.lote
  for insert to authenticated
  with check (public.es_gerente() or cantidad_actual = cantidad_inicial);
create policy lote_update on public.lote
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());

-- -----------------------------------------------------------------------------
-- movimiento: cada usuario registra a su nombre; sólo el gerente corrige.
-- -----------------------------------------------------------------------------
create policy movimiento_select on public.movimiento
  for select to authenticated using (true);
create policy movimiento_insert on public.movimiento
  for insert to authenticated with check (usuario_id = auth.uid());
create policy movimiento_update on public.movimiento
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());

-- -----------------------------------------------------------------------------
-- entrega: el operativo registra la llegada.
-- -----------------------------------------------------------------------------
create policy entrega_select on public.entrega
  for select to authenticated using (true);
create policy entrega_insert on public.entrega
  for insert to authenticated with check (true);
create policy entrega_update on public.entrega
  for update to authenticated using (true) with check (true);

-- -----------------------------------------------------------------------------
-- comanda: se abre a nombre de quien la crea; cualquiera marca listo/cierre.
-- -----------------------------------------------------------------------------
create policy comanda_select on public.comanda
  for select to authenticated using (true);
create policy comanda_insert on public.comanda
  for insert to authenticated with check (usuario_id = auth.uid());
create policy comanda_update on public.comanda
  for update to authenticated using (true) with check (true);

-- -----------------------------------------------------------------------------
-- regla: lectura para todos; el gerente ajusta parámetros.
-- -----------------------------------------------------------------------------
create policy regla_select on public.regla
  for select to authenticated using (true);
create policy regla_update on public.regla
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());

-- -----------------------------------------------------------------------------
-- hecho: sólo lectura (lo escribe el motor).
-- -----------------------------------------------------------------------------
create policy hecho_select on public.hecho
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- alerta: lectura para todos; atender = pasar de ABIERTA a ATENDIDA a nombre
-- propio. El gerente además puede suprimir o reabrir.
-- -----------------------------------------------------------------------------
create policy alerta_select on public.alerta
  for select to authenticated using (true);
create policy alerta_update on public.alerta
  for update to authenticated
  using (estado = 'ABIERTA' or public.es_gerente())
  with check (
    public.es_gerente()
    or (estado = 'ATENDIDA' and atendida_por = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- Realtime: la bandeja de alertas se actualiza en vivo.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.alerta;
  end if;
end
$$;
