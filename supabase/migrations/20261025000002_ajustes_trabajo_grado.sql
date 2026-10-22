-- =============================================================================
-- SIN&AT — Migración 8: ajustes revisados contra el Trabajo de Grado
--
--   1. % merma = merma / (existencia inicial + entradas) × 100
--   2. Lote vencido → MERMA automática por la cantidad remanente (pg_cron diario)
--   3. Franjas de servicio configurables en la tabla regla; lo que cae fuera
--      de ellas es "Fuera de servicio" y no se evalúan sus tiempos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- regla admite parámetros (tipo PARAMETRO): valores configurables que no son
-- reglas del motor y por tanto no tienen severidad.
-- -----------------------------------------------------------------------------
alter table public.regla drop constraint if exists regla_tipo_check;
alter table public.regla add constraint regla_tipo_check
  check (tipo in ('BASE', 'ENCADENADA', 'PARAMETRO'));

alter table public.regla alter column severidad_base drop not null;
alter table public.regla drop constraint if exists regla_severidad_requerida;
alter table public.regla add constraint regla_severidad_requerida
  check (tipo = 'PARAMETRO' or severidad_base is not null);

-- Franjas de servicio, en horas locales de Madeira con decimales
-- (12.5 = 12:30). Fin exclusivo. Una franja con activa = false no se evalúa.
insert into public.regla (codigo, nombre, tipo, umbral, severidad_base, ventana_supresion_min, activa) values
  ('FRANJA_ALMUERZO_INICIO', 'Almuerzo: hora de inicio', 'PARAMETRO', 12, null, 0, true),
  ('FRANJA_ALMUERZO_FIN',    'Almuerzo: hora de fin',    'PARAMETRO', 16, null, 0, true),
  ('FRANJA_CENA_INICIO',     'Cena: hora de inicio',     'PARAMETRO', 19, null, 0, true),
  ('FRANJA_CENA_FIN',        'Cena: hora de fin',        'PARAMETRO', 23, null, 0, true)
on conflict (codigo) do nothing;

-- La tabla regla sólo la lee el gerente; las franjas no son sensibles y las
-- necesita cualquiera que consulte los tiempos de servicio.
create or replace function public.franjas_servicio()
returns table (franja text, hora_inicio numeric, hora_fin numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select f.franja, ini.umbral, fin.umbral
  from (values ('Almuerzo', 'ALMUERZO'), ('Cena', 'CENA')) as f(franja, clave)
  join public.regla ini on ini.codigo = 'FRANJA_' || f.clave || '_INICIO' and ini.activa
  join public.regla fin on fin.codigo = 'FRANJA_' || f.clave || '_FIN'    and fin.activa;
$$;

revoke execute on function public.franjas_servicio() from public, anon;
grant  execute on function public.franjas_servicio() to authenticated;

-- -----------------------------------------------------------------------------
-- v_kpi_servicio con franjas configurables
-- -----------------------------------------------------------------------------
drop view if exists public.v_kpi_servicio;
create view public.v_kpi_servicio
with (security_invoker = true) as
with tiempos as (
  select
    coalesce(f.franja, 'Fuera de servicio')                    as franja,
    f.franja is not null                                       as evaluada,
    extract(epoch from c.t_listo  - c.t_apertura) / 60         as min_preparacion,
    extract(epoch from c.t_cierre - c.t_listo)    / 60         as min_en_mesa,
    extract(epoch from c.t_cierre - c.t_apertura) / 60         as min_total,
    c.t_listo,
    c.t_cierre
  from public.comanda c
  cross join lateral (
    select extract(hour   from c.t_apertura at time zone 'Atlantic/Madeira')
         + extract(minute from c.t_apertura at time zone 'Atlantic/Madeira') / 60 as hora
  ) h
  left join public.franjas_servicio() f
    on h.hora >= f.hora_inicio and h.hora < f.hora_fin
)
select
  franja,
  bool_or(evaluada)                                                                   as evaluada,
  count(*)                                                                            as comandas,
  count(t_listo)                                                                      as con_listo,
  count(t_cierre)                                                                     as cerradas,
  avg(min_preparacion) filter (where evaluada)                                        as prom_preparacion_min,
  avg(min_en_mesa)     filter (where evaluada)                                        as prom_en_mesa_min,
  avg(min_total)       filter (where evaluada)                                        as prom_total_min,
  percentile_cont(0.85) within group (order by min_preparacion) filter (where evaluada) as uf_preparacion_min,
  percentile_cont(0.85) within group (order by min_total)       filter (where evaluada) as uf_total_min
from tiempos
group by franja;

comment on view public.v_kpi_servicio is
  'Tiempos por franja de servicio (configurables en regla, hora de Madeira) y Uf = percentil 85. '
  'Las comandas fuera de franja se cuentan pero no se evalúan.';

-- -----------------------------------------------------------------------------
-- v_kpi_suministro con el % merma del Trabajo de Grado
--   pct_merma = merma / (existencia inicial + entradas) × 100
-- -----------------------------------------------------------------------------
drop view if exists public.v_kpi_suministro;
create view public.v_kpi_suministro
with (security_invoker = true) as
with movimientos as (
  select
    m.insumo_id,
    coalesce(sum(m.cantidad) filter (where m.tipo = 'CONSUMO'), 0) as consumo,
    coalesce(sum(m.cantidad) filter (where m.tipo = 'MERMA'),   0) as merma,
    coalesce(sum(m.cantidad) filter (where m.tipo = 'ENTRADA'), 0) as entradas
  from public.movimiento m
  where m.fecha >= now() - interval '30 days'
  group by m.insumo_id
),
fisica as (
  select l.insumo_id, sum(l.cantidad_actual) as existencia
  from public.lote l
  group by l.insumo_id
),
por_insumo as (
  select
    i.id as insumo_id,
    i.nombre,
    i.proveedor_id,
    coalesce(mv.consumo, 0)  as consumo,
    coalesce(mv.merma, 0)    as merma,
    coalesce(mv.entradas, 0) as entradas,
    coalesce(f.existencia, 0) as existencia_final,
    coalesce(f.existencia, 0) - coalesce(mv.entradas, 0)
      + coalesce(mv.consumo, 0) + coalesce(mv.merma, 0) as existencia_inicial
  from public.insumo i
  left join movimientos mv on mv.insumo_id = i.id
  left join fisica f on f.insumo_id = i.id
),
entregas as (
  select
    e.proveedor_id,
    count(*) filter (where e.fecha_real is not null or e.fecha_esperada < current_date)
      as entregas_totales,
    count(*) filter (where e.fecha_real is not null
                       and e.fecha_real <= e.fecha_esperada
                       and e.conforme)
      as entregas_ok
  from public.entrega e
  group by e.proveedor_id
)
select
  'insumo'::text            as nivel,
  pi.insumo_id,
  pi.proveedor_id,
  pi.nombre,
  pi.consumo,
  pi.merma,
  pi.entradas,
  pi.existencia_inicial,
  pi.existencia_final,
  case when pi.existencia_inicial + pi.existencia_final > 0
       then pi.consumo / ((pi.existencia_inicial + pi.existencia_final) / 2) end as rotacion,
  case when pi.existencia_inicial + pi.entradas > 0
       then 100 * pi.merma / (pi.existencia_inicial + pi.entradas) end         as pct_merma,
  null::bigint              as entregas_totales,
  null::bigint              as entregas_ok,
  null::numeric             as tcp
from por_insumo pi
union all
select
  'proveedor'::text,
  null::bigint,
  p.id,
  p.nombre,
  null, null, null, null, null, null, null,
  coalesce(e.entregas_totales, 0),
  coalesce(e.entregas_ok, 0),
  case when e.entregas_totales > 0
       then 100.0 * e.entregas_ok / e.entregas_totales end
from public.proveedor p
left join entregas e on e.proveedor_id = p.id;

comment on view public.v_kpi_suministro is
  'Rotación y % merma = merma / (existencia inicial + entradas) por insumo (30 días); '
  'TCP(p) por proveedor. Columna nivel = insumo | proveedor.';

revoke all on public.v_kpi_servicio, public.v_kpi_suministro from anon, authenticated;
grant select on public.v_kpi_servicio, public.v_kpi_suministro to authenticated;

-- -----------------------------------------------------------------------------
-- Merma automática de lotes vencidos
--   Un lote con fecha_caducidad anterior a hoy y existencia > 0 genera un
--   movimiento MERMA por lo que le queda (usuario_id NULL = sistema). Así el
--   producto no desaparece sin rastro y alimenta el % merma.
-- -----------------------------------------------------------------------------
create or replace function public.registrar_mermas_por_caducidad()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lote  record;
  v_total integer := 0;
begin
  for v_lote in
    select id, insumo_id, cantidad_actual
    from public.lote
    where cantidad_actual > 0 and fecha_caducidad < current_date
    order by id
    for update
  loop
    insert into public.movimiento (insumo_id, lote_id, tipo, cantidad, motivo, usuario_id)
    values (v_lote.insumo_id, v_lote.id, 'MERMA', v_lote.cantidad_actual,
            'Caducado (registro automático)', null);
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;

comment on function public.registrar_mermas_por_caducidad() is
  'Registra como MERMA la existencia remanente de cada lote vencido. Devuelve cuántos lotes procesó.';

-- Sólo la ejecuta el sistema (pg_cron) o el motor; ningún cliente.
revoke execute on function public.registrar_mermas_por_caducidad() from public, anon, authenticated;

-- Procesa lo que ya esté vencido al aplicar la migración.
select public.registrar_mermas_por_caducidad();

-- Todos los días a las 00:05 UTC (00:05 en invierno y 01:05 en verano en Madeira).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'sinat-mermas-caducidad',
      '5 0 * * *',
      'select public.registrar_mermas_por_caducidad()'
    );
  else
    raise notice 'pg_cron no está disponible: la merma automática no quedó programada.';
  end if;
end
$$;
