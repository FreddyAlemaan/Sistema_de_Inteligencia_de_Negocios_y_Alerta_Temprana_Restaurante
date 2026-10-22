-- =============================================================================
-- SIN&AT — Migración 9: motor de reglas con encadenamiento hacia adelante
--
-- Ciclo de inferencia (AGENTS.md §6):
--   1. Cargar los hechos vigentes (memoria de trabajo = tabla hecho)
--   2. Equiparación: reglas cuya condición se cumple (agenda)
--   3. Resolución de conflictos: primero las encadenadas (más específicas),
--      luego por severidad
--   4. Ejecución: afirmar el hecho y/o emitir la alerta
--   5. Repetir mientras se hayan afirmado hechos nuevos
--
-- Cada vuelta del ciclo ve los hechos que existían al empezar la vuelta: los
-- que afirma la vuelta 1 los usan R4 y R6 en la vuelta 2. R4 y R6 sólo leen
-- la tabla hecho; nunca evalúan los datos crudos.
--
-- Reglas de nivel 1 (R1, R2, R3, R5): afirman su hecho y emiten su alerta.
-- Reglas de nivel 2 (R4, R6): emiten la alerta compuesta y suprimen las
-- alertas de nivel 1 que la originaron (quedan en el historial como SUPRIMIDA).
--
-- Mantenimiento de la verdad: antes de iterar se retiran (vigente = false)
-- los hechos cuya condición ya no se cumple.
--
-- Supresión de avisos repetidos: no se emite una alerta si ya hay una ABIERTA
-- de la misma regla y entidad, ni si la última se creó hace menos de
-- regla.ventana_supresion_min minutos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Severidad (AGENTS.md §5): Sev = |valor − umbral| / umbral
--   BAJA ≤ 0,25 < MEDIA ≤ 0,60 < ALTA
-- Sin umbral (o umbral 0) se usa la severidad base de la regla.
-- -----------------------------------------------------------------------------
create or replace function public.calcular_severidad(p_valor numeric, p_umbral numeric, p_base text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sev numeric;
begin
  if p_valor is null or p_umbral is null or p_umbral = 0 then
    return coalesce(p_base, 'ALTA');
  end if;
  v_sev := abs(p_valor - p_umbral) / abs(p_umbral);
  return case when v_sev <= 0.25 then 'BAJA'
              when v_sev <= 0.60 then 'MEDIA'
              else 'ALTA' end;
end;
$$;

-- Número legible en español: 3.3333 → "3,3"
create or replace function public.fmt(p_valor numeric, p_decimales integer default 2)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(trim_scale(round(p_valor, p_decimales))::text, '.', ',');
$$;

create or replace function public.texto_dias(p_dias integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_dias when 0 then 'hoy' when 1 then 'mañana' else 'en ' || p_dias || ' días' end;
$$;

-- -----------------------------------------------------------------------------
-- Emisión de una alerta con supresión de repetidos
-- -----------------------------------------------------------------------------
create or replace function public.emitir_alerta(
  p_regla_id     bigint,
  p_tipo         text,
  p_entidad_tipo text,
  p_entidad_id   bigint,
  p_valor        numeric,
  p_umbral       numeric,
  p_severidad    text,
  p_mensaje      text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ventana integer;
begin
  select ventana_supresion_min into v_ventana from public.regla where id = p_regla_id;

  if exists (
    select 1 from public.alerta a
    where a.regla_id = p_regla_id
      and a.entidad_tipo = p_entidad_tipo
      and a.entidad_id = p_entidad_id
      and (a.estado = 'ABIERTA'
           or a.creada_en > now() - make_interval(mins => coalesce(v_ventana, 0)))
  ) then
    return false;
  end if;

  insert into public.alerta (regla_id, tipo, entidad_tipo, entidad_id, valor, umbral, severidad, mensaje)
  values (p_regla_id, p_tipo, p_entidad_tipo, p_entidad_id, p_valor, p_umbral, p_severidad, p_mensaje);
  return true;
end;
$$;

-- ¿Hay una alerta encadenada ABIERTA que ya explica este hecho de nivel 1?
create or replace function public.alerta_cubierta(p_codigo text, p_entidad_tipo text, p_entidad_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_codigo
    -- R2 (faltante del insumo) lo explica R4 sobre el mismo insumo
    when 'R2' then exists (
      select 1 from public.alerta a join public.regla r on r.id = a.regla_id
      where r.codigo = 'R4' and a.estado = 'ABIERTA'
        and a.entidad_tipo = 'insumo' and a.entidad_id = p_entidad_id)
    -- R1 (caducidad del lote) lo explica R6 sobre el mismo lote
    when 'R1' then exists (
      select 1 from public.alerta a join public.regla r on r.id = a.regla_id
      where r.codigo = 'R6' and a.estado = 'ABIERTA'
        and a.entidad_tipo = 'lote' and a.entidad_id = p_entidad_id)
    -- R5 (sobrestock del insumo) lo explica R6 sobre cualquier lote del insumo
    when 'R5' then exists (
      select 1 from public.alerta a
      join public.regla r on r.id = a.regla_id
      join public.lote l on l.id = a.entidad_id
      where r.codigo = 'R6' and a.estado = 'ABIERTA'
        and a.entidad_tipo = 'lote' and l.insumo_id = p_entidad_id)
    else false
  end;
$$;

-- -----------------------------------------------------------------------------
-- El motor
-- -----------------------------------------------------------------------------
create or replace function public.evaluar_reglas()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_iteracion     integer := 0;
  v_nuevos        integer;
  v_filas         integer;
  v_hechos_nuevos integer := 0;
  v_retractados   integer := 0;
  v_alertas       integer := 0;
  v_suprimidas    integer := 0;
  v_mermas        integer;
  v_detalle       jsonb := '[]'::jsonb;
  v_act           record;
begin
  -- Una sola evaluación a la vez (cron y usuarios pueden coincidir).
  perform pg_advisory_xact_lock(hashtext('sinat.evaluar_reglas'));

  -- Lo vencido pasa a merma antes de evaluar (AGENTS: no desaparece sin rastro).
  v_mermas := public.registrar_mermas_por_caducidad();

  create temp table if not exists _sinat_coincidencia (
    regla_id bigint, codigo text, predicado text, entidad_tipo text, entidad_id bigint,
    valor numeric, umbral numeric, tipo_alerta text, mensaje text
  ) on commit drop;
  create temp table if not exists _sinat_disparada (
    codigo text, entidad_tipo text, entidad_id bigint
  ) on commit drop;
  truncate _sinat_coincidencia, _sinat_disparada;

  -- ---------------------------------------------------------------------------
  -- Condiciones de las reglas de nivel 1 sobre los datos actuales
  -- ---------------------------------------------------------------------------
  insert into _sinat_coincidencia
  -- R1  DRC(lote) <= dias_alerta_caducidad(insumo) y existencia > 0
  select r.id, 'R1', 'riesgo_caducidad', 'lote', l.id,
         (l.fecha_caducidad - current_date)::numeric, i.dias_alerta_caducidad::numeric,
         'CADUCIDAD',
         i.nombre || ': el lote #' || l.id || ' caduca ' || public.texto_dias(l.fecha_caducidad - current_date)
           || '. Quedan ' || public.fmt(l.cantidad_actual) || ' ' || i.unidad
           || case when q.qr > 0
                   then ' y al ritmo actual se botarán ' || public.fmt(q.qr) || ' ' || i.unidad
                        || ' (cantidad en riesgo de merma).'
                   else '; al ritmo actual se alcanza a consumir.' end
  from public.lote l
  join public.insumo i on i.id = l.insumo_id
  join public.regla r on r.codigo = 'R1' and r.activa
  left join public.riesgo_merma_lotes() q on q.lote_id = l.id
  where l.cantidad_actual > 0
    and l.fecha_caducidad >= current_date
    and l.fecha_caducidad - current_date <= i.dias_alerta_caducidad

  union all
  -- R2  DC(i) < dprox + lead_time
  select r.id, 'R2', 'riesgo_faltante', 'insumo', c.insumo_id,
         c.dc, c.dias_hasta_reposicion::numeric,
         'FALTANTE',
         c.nombre || ': hay para ' || public.fmt(c.dc, 1) || ' días y lo próximo que llega tarda '
           || c.dias_hasta_reposicion || ' (' || c.dias_hasta_proximo_pedido
           || ' hasta el pedido del lunes + ' || c.lead_time_dias || ' de entrega). Riesgo de quedarse sin existencia.'
  from public.v_cobertura c
  join public.regla r on r.codigo = 'R2' and r.activa
  where c.activo and c.riesgo_faltante

  union all
  -- R3  TCP(p) < umbral (80 %)
  select r.id, 'R3', 'proveedor_no_confiable', 'proveedor', k.proveedor_id,
         k.tcp, r.umbral,
         'PROVEEDOR',
         k.nombre || ' cumple el ' || public.fmt(k.tcp, 0) || ' % de sus entregas a tiempo y conformes ('
           || k.entregas_ok || ' de ' || k.entregas_totales || '; mínimo ' || public.fmt(r.umbral, 0) || ' %).'
  from public.v_kpi_suministro k
  join public.proveedor p on p.id = k.proveedor_id and p.activo
  join public.regla r on r.codigo = 'R3' and r.activa
  where k.nivel = 'proveedor' and k.tcp < r.umbral

  union all
  -- R5  DC(i) > factor × vida_util_dias(i)   (factor = umbral de R5)
  select r.id, 'R5', 'sobrestock', 'insumo', c.insumo_id,
         c.dc, r.umbral * i.vida_util_dias,
         'SOBRESTOCK',
         c.nombre || ': la existencia alcanza para ' || public.fmt(c.dc, 0) || ' días, pero dura '
           || i.vida_util_dias || ' (límite ' || public.fmt(r.umbral * i.vida_util_dias, 0) || ' días). Sobrestock.'
  from public.v_cobertura c
  join public.insumo i on i.id = c.insumo_id
  join public.regla r on r.codigo = 'R5' and r.activa
  where c.activo and c.cpd > 0 and c.dc > r.umbral * i.vida_util_dias;

  -- ---------------------------------------------------------------------------
  -- Mantenimiento de la verdad: se retiran los hechos que ya no se sostienen
  -- ---------------------------------------------------------------------------
  update public.hecho h
  set vigente = false
  where h.vigente
    and not exists (
      select 1 from _sinat_coincidencia c
      where c.predicado = h.predicado
        and c.entidad_tipo = h.entidad_tipo
        and c.entidad_id = h.entidad_id);
  get diagnostics v_retractados = row_count;

  -- ---------------------------------------------------------------------------
  -- Ciclo de inferencia
  -- ---------------------------------------------------------------------------
  loop
    v_iteracion := v_iteracion + 1;
    v_nuevos := 0;

    -- Equiparación + resolución de conflictos. La agenda se calcula con los
    -- hechos vigentes al empezar la vuelta.
    for v_act in
      with agenda as (
        select c.regla_id, c.codigo, c.predicado, c.entidad_tipo, c.entidad_id,
               c.valor, c.umbral, c.tipo_alerta, c.mensaje, 1 as nivel,
               public.calcular_severidad(c.valor, c.umbral, r.severidad_base) as severidad
        from _sinat_coincidencia c
        join public.regla r on r.id = c.regla_id

        union all
        -- R4  riesgo_faltante(i) ∧ proveedor_no_confiable(proveedor(i))
        select r.id, 'R4', null, 'insumo', i.id, null, null, 'FALTANTE_CRITICO',
               'Faltante crítico de ' || i.nombre || ': tiene riesgo de faltante y su proveedor, '
                 || p.nombre || ', no es confiable. Recomendación: aumentar la cantidad del próximo '
                 || 'pedido (sugerido: ' || coalesce(public.fmt(ps.q) || ' ' || i.unidad, '—')
                 || ') o conseguir un proveedor alterno.',
               2, r.severidad_base
        from public.hecho hf
        join public.insumo i on i.id = hf.entidad_id
        join public.hecho hp on hp.predicado = 'proveedor_no_confiable' and hp.vigente
                            and hp.entidad_tipo = 'proveedor' and hp.entidad_id = i.proveedor_id
        join public.proveedor p on p.id = i.proveedor_id
        join public.regla r on r.codigo = 'R4' and r.activa
        left join public.v_pedido_sugerido ps on ps.insumo_id = i.id
        where hf.predicado = 'riesgo_faltante' and hf.vigente and hf.entidad_tipo = 'insumo'

        union all
        -- R6  riesgo_caducidad(l) ∧ sobrestock(insumo(l))
        select r.id, 'R6', null, 'lote', l.id, null, null, 'SOBRECOMPRA',
               'Sobrecompra de ' || i.nombre || ': el lote #' || l.id || ' va a caducar y además hay '
                 || 'sobrestock del insumo' || coalesce(', se perderán ' || public.fmt(q.qr) || ' ' || i.unidad, '')
                 || '. La merma se debe a comprar de más. Recomendación: reducir el próximo pedido.',
               2, r.severidad_base
        from public.hecho hc
        join public.lote l on l.id = hc.entidad_id
        join public.insumo i on i.id = l.insumo_id
        join public.hecho hs on hs.predicado = 'sobrestock' and hs.vigente
                            and hs.entidad_tipo = 'insumo' and hs.entidad_id = l.insumo_id
        join public.regla r on r.codigo = 'R6' and r.activa
        left join public.riesgo_merma_lotes() q on q.lote_id = l.id
        where hc.predicado = 'riesgo_caducidad' and hc.vigente and hc.entidad_tipo = 'lote'
      )
      select a.*
      from agenda a
      where not exists (  -- refracción: cada activación se ejecuta una vez por evaluación
        select 1 from _sinat_disparada d
        where d.codigo = a.codigo and d.entidad_tipo = a.entidad_tipo and d.entidad_id = a.entidad_id)
      order by a.nivel desc,
               case a.severidad when 'ALTA' then 3 when 'MEDIA' then 2 else 1 end desc,
               a.codigo, a.entidad_id
    loop
      insert into _sinat_disparada values (v_act.codigo, v_act.entidad_tipo, v_act.entidad_id);

      if v_act.nivel = 1 then
        -- Afirmar el hecho (si no está ya en la memoria de trabajo)
        insert into public.hecho (predicado, entidad_tipo, entidad_id)
        values (v_act.predicado, v_act.entidad_tipo, v_act.entidad_id)
        on conflict (predicado, entidad_tipo, entidad_id) where vigente do nothing;
        get diagnostics v_filas = row_count;
        v_nuevos := v_nuevos + v_filas;
        v_hechos_nuevos := v_hechos_nuevos + v_filas;

        if not public.alerta_cubierta(v_act.codigo, v_act.entidad_tipo, v_act.entidad_id)
           and public.emitir_alerta(v_act.regla_id, v_act.tipo_alerta, v_act.entidad_tipo,
                                    v_act.entidad_id, v_act.valor, v_act.umbral,
                                    v_act.severidad, v_act.mensaje) then
          v_alertas := v_alertas + 1;
        end if;
      else
        if public.emitir_alerta(v_act.regla_id, v_act.tipo_alerta, v_act.entidad_tipo,
                                v_act.entidad_id, v_act.valor, v_act.umbral,
                                v_act.severidad, v_act.mensaje) then
          v_alertas := v_alertas + 1;
        end if;

        -- La alerta encadenada explica a las de nivel 1 que la originaron.
        update public.alerta a
        set estado = 'SUPRIMIDA'
        from public.regla r
        where r.id = a.regla_id and a.estado = 'ABIERTA'
          and (
            (v_act.codigo = 'R4' and r.codigo = 'R2'
               and a.entidad_tipo = 'insumo' and a.entidad_id = v_act.entidad_id)
            or (v_act.codigo = 'R6' and r.codigo = 'R1'
               and a.entidad_tipo = 'lote' and a.entidad_id = v_act.entidad_id)
            or (v_act.codigo = 'R6' and r.codigo = 'R5' and a.entidad_tipo = 'insumo'
               and a.entidad_id = (select insumo_id from public.lote where id = v_act.entidad_id))
          );
        get diagnostics v_filas = row_count;
        v_suprimidas := v_suprimidas + v_filas;
      end if;

      v_detalle := v_detalle || jsonb_build_object(
        'iteracion', v_iteracion, 'regla', v_act.codigo,
        'entidad', v_act.entidad_tipo || ' ' || v_act.entidad_id, 'severidad', v_act.severidad);
    end loop;

    -- Punto fijo: termina cuando una vuelta no afirma ningún hecho nuevo.
    -- El límite es sólo una protección; el conjunto de hechos es finito.
    exit when v_nuevos = 0 or v_iteracion >= 20;
  end loop;

  return jsonb_build_object(
    'iteraciones',         v_iteracion,
    'hechos_nuevos',       v_hechos_nuevos,
    'hechos_retractados',  v_retractados,
    'hechos_vigentes',     (select count(*) from public.hecho where vigente),
    'alertas_emitidas',    v_alertas,
    'alertas_suprimidas',  v_suprimidas,
    'mermas_automaticas',  v_mermas,
    'activaciones',        v_detalle
  );
end;
$$;

comment on function public.evaluar_reglas() is
  'Motor de inferencia de SIN&AT: encadenamiento hacia adelante hasta punto fijo. Devuelve un resumen.';

-- -----------------------------------------------------------------------------
-- Permisos: cualquiera con sesión puede pedir una evaluación (la app la pide
-- tras cada registro); las piezas internas no se exponen.
-- -----------------------------------------------------------------------------
revoke execute on function public.evaluar_reglas() from public, anon;
grant  execute on function public.evaluar_reglas() to authenticated;
revoke execute on function public.emitir_alerta(bigint, text, text, bigint, numeric, numeric, text, text)
  from public, anon, authenticated;
revoke execute on function public.alerta_cubierta(text, text, bigint) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Evaluación programada cada 10 minutos (pg_cron)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sinat-motor-reglas', '*/10 * * * *', 'select public.evaluar_reglas()');
  else
    raise notice 'pg_cron no está activo: el motor no quedó programado.';
  end if;
end
$$;
