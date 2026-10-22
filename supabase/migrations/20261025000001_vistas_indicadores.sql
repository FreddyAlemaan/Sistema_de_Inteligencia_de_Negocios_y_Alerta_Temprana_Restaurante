-- =============================================================================
-- SIN&AT — Migración 7: vistas de indicadores
--
-- Fórmulas de AGENTS.md §5, implementadas sin aproximar:
--   CPD(i) = consumo total del período / días del período       (período = 30 d)
--   DC(i)  = existencia actual / CPD(i)
--   DRC(l) = fecha_caducidad(l) − fecha actual
--   NP(i)  = CPD(i) × (R + lead_time)                            (R = 7)
--   Q(i)   = max(0, NP(i) − existencia actual)
--   QR(l)  = max(0, cantidad_actual(l) − CPD(i) × DRC(l))
--   TCP(p) = entregas conformes y a tiempo / entregas totales × 100
--   Uf     = percentil 85 de los tiempos de la franja horaria
--   Riesgo de faltante: DC(i) < días_hasta_próximo_pedido + lead_time
--
-- Convenciones:
--   * "Existencia actual" = existencia vigente (lotes no caducados): lo
--     caducado no se puede servir. En el seed no hay diferencia.
--   * Consumo = movimientos CONSUMO; la merma no es consumo.
--   * El restaurante pide los lunes: días_hasta_próximo_pedido = 0 el lunes
--     (el pedido es hoy), 6 el martes … 1 el domingo.
--   * Todas las vistas son security_invoker: respetan RLS y los permisos de
--     columna de quien consulta (ninguna expone costos).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_consumo_promedio — CPD por insumo (últimos 30 días)
-- -----------------------------------------------------------------------------
create or replace view public.v_consumo_promedio
with (security_invoker = true) as
with periodo as (select 30 as dias)
select
  i.id                                   as insumo_id,
  i.nombre,
  i.unidad,
  coalesce(sum(m.cantidad), 0)           as consumo_periodo,
  periodo.dias                           as dias_periodo,
  coalesce(sum(m.cantidad), 0) / periodo.dias as cpd
from public.insumo i
cross join periodo
left join public.movimiento m
  on m.insumo_id = i.id
 and m.tipo = 'CONSUMO'
 and m.fecha >= now() - make_interval(days => periodo.dias)
group by i.id, i.nombre, i.unidad, periodo.dias;

comment on view public.v_consumo_promedio is 'CPD(i): consumo promedio diario de los últimos 30 días.';

-- -----------------------------------------------------------------------------
-- v_cobertura — DC y riesgo de faltante por insumo
-- -----------------------------------------------------------------------------
create or replace view public.v_cobertura
with (security_invoker = true) as
with existencia as (
  select l.insumo_id, sum(l.cantidad_actual) as vigente
  from public.lote l
  where l.cantidad_actual > 0 and l.fecha_caducidad >= current_date
  group by l.insumo_id
),
proximo_pedido as (
  -- ISO: lunes = 1 … domingo = 7
  select (8 - extract(isodow from current_date)::integer) % 7 as dias
)
select
  i.id                                      as insumo_id,
  i.nombre,
  i.unidad,
  i.activo,
  i.proveedor_id,
  coalesce(pr.lead_time_dias, 0)            as lead_time_dias,
  coalesce(e.vigente, 0)                    as existencia,
  c.cpd,
  case when c.cpd > 0 then coalesce(e.vigente, 0) / c.cpd end as dc,
  pp.dias                                   as dias_hasta_proximo_pedido,
  pp.dias + coalesce(pr.lead_time_dias, 0)  as dias_hasta_reposicion,
  -- Sin consumo no hay forma de agotarse: no hay riesgo de faltante.
  coalesce(c.cpd > 0
           and coalesce(e.vigente, 0) / c.cpd < pp.dias + coalesce(pr.lead_time_dias, 0),
           false)                           as riesgo_faltante
from public.insumo i
join public.v_consumo_promedio c on c.insumo_id = i.id
left join public.proveedor pr on pr.id = i.proveedor_id
left join existencia e on e.insumo_id = i.id
cross join proximo_pedido pp;

comment on view public.v_cobertura is
  'DC(i) = existencia vigente / CPD(i). riesgo_faltante: DC < días hasta el próximo lunes + lead time.';

-- -----------------------------------------------------------------------------
-- v_pedido_sugerido — revisión periódica semanal (no ROP)
-- -----------------------------------------------------------------------------
create or replace view public.v_pedido_sugerido
with (security_invoker = true) as
with revision as (select 7 as r_dias)  -- R = 7: el pedido se revisa cada semana
select
  c.insumo_id,
  c.nombre,
  c.unidad,
  c.proveedor_id,
  pr.nombre                                         as proveedor,
  c.cpd,
  c.existencia,
  c.lead_time_dias,
  revision.r_dias,
  c.cpd * (revision.r_dias + c.lead_time_dias)      as np,
  greatest(0, c.cpd * (revision.r_dias + c.lead_time_dias) - c.existencia) as q
from public.v_cobertura c
cross join revision
left join public.proveedor pr on pr.id = c.proveedor_id
where c.activo;

comment on view public.v_pedido_sugerido is
  'NP(i) = CPD × (R + lead time); Q(i) = max(0, NP − existencia). R = 7 días.';

-- -----------------------------------------------------------------------------
-- v_kpi_suministro — rotación y % merma por insumo; cumplimiento por proveedor
--
--   Una fila por insumo (nivel = 'insumo') y una por proveedor
--   (nivel = 'proveedor'), en los últimos 30 días salvo el cumplimiento.
--
--   rotacion   = consumo del período / existencia promedio del período
--                existencia promedio = (existencia inicial + final) / 2
--                existencia inicial  = final − entradas + consumos + mermas
--   pct_merma  = merma / (consumo + merma) × 100
--   tcp        = TCP(p). Entregas totales = las que llegaron + las vencidas
--                sin llegar; las que aún no vencen no cuentan.
-- -----------------------------------------------------------------------------
create or replace view public.v_kpi_suministro
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
  case when pi.consumo + pi.merma > 0
       then 100 * pi.merma / (pi.consumo + pi.merma) end                       as pct_merma,
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
  'Rotación y % merma por insumo (30 días) y TCP(p) por proveedor. Columna nivel = insumo | proveedor.';

-- -----------------------------------------------------------------------------
-- v_kpi_servicio — tiempos por franja horaria (hora local de Madeira)
--   preparación = apertura → listo   (lo que controla la cocina)
--   en mesa     = listo → cierre
--   total       = apertura → cierre
--   uf_*        = Uf: percentil 85 histórico de la franja
-- -----------------------------------------------------------------------------
create or replace view public.v_kpi_servicio
with (security_invoker = true) as
with tiempos as (
  select
    case when extract(hour from c.t_apertura at time zone 'Atlantic/Madeira') < 17
         then 'Almuerzo' else 'Cena' end                       as franja,
    extract(epoch from c.t_listo  - c.t_apertura) / 60         as min_preparacion,
    extract(epoch from c.t_cierre - c.t_listo)    / 60         as min_en_mesa,
    extract(epoch from c.t_cierre - c.t_apertura) / 60         as min_total,
    c.t_listo,
    c.t_cierre
  from public.comanda c
)
select
  franja,
  count(*)                                                       as comandas,
  count(t_listo)                                                 as con_listo,
  count(t_cierre)                                                as cerradas,
  avg(min_preparacion)                                           as prom_preparacion_min,
  avg(min_en_mesa)                                               as prom_en_mesa_min,
  avg(min_total)                                                 as prom_total_min,
  percentile_cont(0.85) within group (order by min_preparacion)  as uf_preparacion_min,
  percentile_cont(0.85) within group (order by min_total)        as uf_total_min
from tiempos
group by franja;

comment on view public.v_kpi_servicio is
  'Tiempos promedio por franja (Almuerzo < 17:00 ≤ Cena) y Uf = percentil 85.';

-- -----------------------------------------------------------------------------
-- QR por lote — cantidad en riesgo de merma (AGENTS.md §5)
--   Función y no vista: el modelo de datos fija cinco vistas.
-- -----------------------------------------------------------------------------
create or replace function public.riesgo_merma_lotes()
returns table (
  lote_id          bigint,
  insumo_id        bigint,
  cantidad_actual  numeric,
  fecha_caducidad  date,
  drc              integer,
  cpd              numeric,
  qr               numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.id,
    l.insumo_id,
    l.cantidad_actual,
    l.fecha_caducidad,
    l.fecha_caducidad - current_date,
    c.cpd,
    greatest(0, l.cantidad_actual - c.cpd * (l.fecha_caducidad - current_date))
  from public.lote l
  join public.v_consumo_promedio c on c.insumo_id = l.insumo_id
  where l.cantidad_actual > 0;
$$;

-- -----------------------------------------------------------------------------
-- Permisos: sólo lectura, sólo con sesión
-- -----------------------------------------------------------------------------
revoke all on public.v_consumo_promedio, public.v_cobertura, public.v_pedido_sugerido,
              public.v_kpi_suministro, public.v_kpi_servicio
  from anon, authenticated;
grant select on public.v_consumo_promedio, public.v_cobertura, public.v_pedido_sugerido,
                public.v_kpi_suministro, public.v_kpi_servicio
  to authenticated;

revoke execute on function public.riesgo_merma_lotes() from public, anon;
grant  execute on function public.riesgo_merma_lotes() to authenticated;
