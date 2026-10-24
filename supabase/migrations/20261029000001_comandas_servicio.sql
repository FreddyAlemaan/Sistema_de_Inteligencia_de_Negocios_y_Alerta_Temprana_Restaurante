-- =============================================================================
-- SIN&AT — Migración 12: comandas y alerta de servicio lento en vivo
--
-- Registro de comandas en tres toques (RNF-01):
--   * abrir_comanda    mesa + comensales; la hora la pone la base
--   * marcar_listo     la cocina avisa que el plato salió
--   * cerrar_comanda   la mesa pagó
--
-- Regla R7 (servicio lento), evaluada en vivo mientras la mesa espera:
--   minutos desde que se abrió la comanda sin que esté lista  >  Uf(franja)
--   Uf  = percentil 85 de los tiempos de preparación de esa franja (AGENTS §5)
--   Sev = (minutos − Uf) / Uf  →  BAJA ≤ 0,25 < MEDIA ≤ 0,60 < ALTA
-- Sólo se vigilan las comandas del servicio en curso (misma franja y mismo
-- día). Una comanda olvidada de un servicio anterior no genera alertas.
--
-- La alerta es una por comanda. Si el retraso empeora y sube de severidad,
-- la misma alerta se actualiza (y la app vuelve a avisar), en vez de crear
-- una nueva cada minuto.
--
-- R7 no afirma hechos: ninguna regla encadenada depende de ella, así que se
-- evalúa aparte del ciclo de inferencia, cada minuto, con su propia función.
-- =============================================================================

insert into public.regla (codigo, nombre, tipo, umbral, severidad_base, ventana_supresion_min, activa) values
  ('R7', 'Servicio lento', 'BASE', null, 'MEDIA', 60, true),
  -- Con menos comandas que esto en la franja, el percentil 85 no es fiable
  -- y no se alerta. El gerente lo puede ajustar.
  ('SERVICIO_MUESTRA_MIN', 'Servicio: comandas mínimas para calcular Uf', 'PARAMETRO', 5, null, 0, true)
on conflict (codigo) do nothing;

-- -----------------------------------------------------------------------------
-- Las comandas se registran sólo por las funciones de abajo, para que las
-- horas las ponga la base y no se puedan maquillar los tiempos. El gerente
-- puede corregir una comanda mal registrada.
-- -----------------------------------------------------------------------------
drop policy if exists comanda_insert on public.comanda;
drop policy if exists comanda_update on public.comanda;

create policy comanda_insert on public.comanda
  for insert to authenticated with check (public.es_gerente());
create policy comanda_update on public.comanda
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());

-- -----------------------------------------------------------------------------
-- Franja de servicio de un momento (hora de Madeira); null = fuera de servicio
-- -----------------------------------------------------------------------------
create or replace function public.franja_de(p_momento timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select f.franja
  from public.franjas_servicio() f
  cross join lateral (
    select extract(hour   from p_momento at time zone 'Atlantic/Madeira')
         + extract(minute from p_momento at time zone 'Atlantic/Madeira') / 60 as hora
  ) h
  where h.hora >= f.hora_inicio and h.hora < f.hora_fin
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Uf de preparación por franja; null si aún no hay muestra suficiente
-- -----------------------------------------------------------------------------
create or replace function public.umbral_servicio()
returns table (franja text, uf_preparacion_min numeric, muestra bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select k.franja,
         case when k.con_listo >= coalesce(m.umbral, 0)
              then round(k.uf_preparacion_min::numeric, 1) end,
         k.con_listo
  from public.v_kpi_servicio k
  left join public.regla m on m.codigo = 'SERVICIO_MUESTRA_MIN' and m.activa
  where k.evaluada;
$$;

-- -----------------------------------------------------------------------------
-- Comandas sin cerrar, con su tiempo de preparación y si va lenta
--   minutos_preparacion = (listo, o ahora si sigue en cocina) − apertura
--   lenta               = sigue en cocina y minutos_preparacion > Uf
-- -----------------------------------------------------------------------------
create or replace function public.comandas_abiertas()
returns table (
  id                  bigint,
  mesa                text,
  comensales          integer,
  t_apertura          timestamptz,
  t_listo             timestamptz,
  franja              text,
  servicio_en_curso   boolean,
  minutos_preparacion numeric,
  uf_preparacion_min  numeric,
  lenta               boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.mesa, c.comensales, c.t_apertura, c.t_listo,
         f.franja,
         f.franja is not null
           and f.franja = public.franja_de(now())
           and (c.t_apertura at time zone 'Atlantic/Madeira')::date
               = (now() at time zone 'Atlantic/Madeira')::date,
         t.minutos,
         u.uf_preparacion_min,
         c.t_listo is null and u.uf_preparacion_min is not null and t.minutos > u.uf_preparacion_min
  from public.comanda c
  cross join lateral (select public.franja_de(c.t_apertura) as franja) f
  cross join lateral (
    select round((extract(epoch from coalesce(c.t_listo, now()) - c.t_apertura) / 60)::numeric, 1) as minutos
  ) t
  left join public.umbral_servicio() u on u.franja = f.franja
  where c.t_cierre is null
  order by c.t_apertura;
$$;

comment on function public.comandas_abiertas() is
  'Comandas sin cerrar con su tiempo de preparación, el Uf de su franja y si van lentas.';

-- -----------------------------------------------------------------------------
-- R7 en vivo. Devuelve cuántas alertas nuevas emitió.
-- -----------------------------------------------------------------------------
create or replace function public.evaluar_servicio()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regla   public.regla%rowtype;
  v_c       record;
  v_sev     text;
  v_mensaje text;
  v_nuevas  integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('sinat.evaluar_servicio'));

  select * into v_regla from public.regla where codigo = 'R7' and activa;
  if not found then
    return 0;
  end if;

  for v_c in
    select * from public.comandas_abiertas() a
    where a.lenta and a.servicio_en_curso
  loop
    v_sev := public.calcular_severidad(v_c.minutos_preparacion, v_c.uf_preparacion_min, v_regla.severidad_base);
    v_mensaje := 'Mesa ' || v_c.mesa || ' (' || v_c.comensales
      || case when v_c.comensales = 1 then ' comensal' else ' comensales' end
      || '): lleva ' || public.fmt(v_c.minutos_preparacion, 0) || ' min esperando y la comanda no ha salido de cocina. '
      || 'En el ' || lower(v_c.franja) || ' lo normal es hasta ' || public.fmt(v_c.uf_preparacion_min, 0) || ' min.';

    -- Si ya hay una alerta abierta de esta comanda, sólo se actualiza cuando
    -- el retraso sube de severidad.
    update public.alerta a
    set valor = v_c.minutos_preparacion, severidad = v_sev, mensaje = v_mensaje
    where a.regla_id = v_regla.id and a.entidad_tipo = 'comanda' and a.entidad_id = v_c.id
      and a.estado = 'ABIERTA'
      and (case v_sev when 'ALTA' then 3 when 'MEDIA' then 2 else 1 end)
        > (case a.severidad when 'ALTA' then 3 when 'MEDIA' then 2 else 1 end);

    if not exists (
      select 1 from public.alerta a
      where a.regla_id = v_regla.id and a.entidad_tipo = 'comanda' and a.entidad_id = v_c.id
        and a.estado = 'ABIERTA'
    ) and public.emitir_alerta(v_regla.id, 'SERVICIO_LENTO', 'comanda', v_c.id,
                               v_c.minutos_preparacion, v_c.uf_preparacion_min, v_sev, v_mensaje) then
      v_nuevas := v_nuevas + 1;
    end if;
  end loop;

  return v_nuevas;
end;
$$;

comment on function public.evaluar_servicio() is
  'Regla R7: alerta en vivo de comandas que llevan en cocina más que el Uf de su franja.';

-- -----------------------------------------------------------------------------
-- Registro de comandas
-- -----------------------------------------------------------------------------
create or replace function public.abrir_comanda(p_mesa text, p_comensales integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := public.usuario_operando();
  v_mesa    text := trim(coalesce(p_mesa, ''));
  v_id      bigint;
begin
  if v_mesa = '' then
    raise exception 'Escribe el número o nombre de la mesa.';
  end if;
  if p_comensales is null or p_comensales < 1 then
    raise exception 'Indica cuántos comensales hay en la mesa.';
  end if;

  -- Un doble clic, o dos personas abriendo la misma mesa, no debe duplicarla.
  if exists (select 1 from public.comanda where lower(mesa) = lower(v_mesa) and t_cierre is null) then
    raise exception 'La mesa % ya tiene una comanda abierta.', v_mesa;
  end if;

  insert into public.comanda (mesa, comensales, usuario_id)
  values (v_mesa, p_comensales, v_usuario)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.marcar_listo(p_comanda_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := public.usuario_operando();
begin
  update public.comanda
  set t_listo = now()
  where id = p_comanda_id and t_listo is null and t_cierre is null;

  if not found then
    raise exception 'Esta comanda ya estaba marcada como lista o cerrada.';
  end if;
end;
$$;

create or replace function public.cerrar_comanda(p_comanda_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := public.usuario_operando();
  v_comanda public.comanda%rowtype;
begin
  select * into v_comanda from public.comanda where id = p_comanda_id;
  if not found or v_comanda.t_cierre is not null then
    raise exception 'Esta comanda ya estaba cerrada.';
  end if;
  -- Sin la hora de "listo" no se puede medir la preparación.
  if v_comanda.t_listo is null then
    raise exception 'Marca primero la comanda como lista.';
  end if;

  update public.comanda set t_cierre = now() where id = p_comanda_id;
end;
$$;

revoke execute on function public.franja_de(timestamptz)          from public, anon;
revoke execute on function public.umbral_servicio()               from public, anon;
revoke execute on function public.comandas_abiertas()             from public, anon;
revoke execute on function public.evaluar_servicio()              from public, anon;
revoke execute on function public.abrir_comanda(text, integer)    from public, anon;
revoke execute on function public.marcar_listo(bigint)            from public, anon;
revoke execute on function public.cerrar_comanda(bigint)          from public, anon;
grant  execute on function public.franja_de(timestamptz)          to authenticated;
grant  execute on function public.umbral_servicio()               to authenticated;
grant  execute on function public.comandas_abiertas()             to authenticated;
grant  execute on function public.evaluar_servicio()              to authenticated;
grant  execute on function public.abrir_comanda(text, integer)    to authenticated;
grant  execute on function public.marcar_listo(bigint)            to authenticated;
grant  execute on function public.cerrar_comanda(bigint)          to authenticated;

-- -----------------------------------------------------------------------------
-- R7 se revisa cada minuto (pg_cron); la pantalla de comandas también la pide
-- mientras está abierta.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sinat-servicio', '* * * * *', 'select public.evaluar_servicio()');
  else
    raise notice 'pg_cron no está activo: R7 sólo se evaluará desde la app.';
  end if;
end
$$;
