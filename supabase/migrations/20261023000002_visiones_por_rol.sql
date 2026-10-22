-- =============================================================================
-- SIN&AT — Migración 5: dos visiones (gerente / operativo)
--
-- Lo que sólo ve el gerente:
--   1. Costos: lote.costo_unitario
--   2. Configuración del motor: tablas regla y hecho
-- El operativo sigue viendo las alertas que genera el motor y las cantidades
-- de cada lote, pero no el dinero ni la mecánica interna de las reglas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Costos
--
-- En Supabase gerente y operativo usan el mismo rol de PostgreSQL
-- ("authenticated"), así que una columna no se puede ocultar sólo a uno de
-- ellos con GRANT. Solución: nadie lee costo_unitario directamente de la tabla
-- y el gerente lo obtiene con una función que verifica su rol.
-- -----------------------------------------------------------------------------
revoke select on public.lote from authenticated;
grant  select (id, insumo_id, proveedor_id, cantidad_inicial, cantidad_actual,
               fecha_recepcion, fecha_caducidad)
  on public.lote to authenticated;

create or replace function public.costos_lote()
returns table (lote_id bigint, costo_unitario numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.costo_unitario
  from public.lote l
  where public.es_gerente();
$$;

comment on function public.costos_lote() is
  'Costo unitario de cada lote. Devuelve filas sólo si quien consulta es gerente.';

revoke execute on function public.costos_lote() from public, anon;
grant  execute on function public.costos_lote() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Configuración del motor: regla y hecho sólo para el gerente.
--    El motor (paso 6) corre como SECURITY DEFINER y no depende de esto.
-- -----------------------------------------------------------------------------
drop policy if exists regla_select on public.regla;
create policy regla_select on public.regla
  for select to authenticated
  using (public.es_gerente());

drop policy if exists hecho_select on public.hecho;
create policy hecho_select on public.hecho
  for select to authenticated
  using (public.es_gerente());
