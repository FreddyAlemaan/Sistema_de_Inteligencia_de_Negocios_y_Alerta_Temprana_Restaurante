-- =============================================================================
-- SIN&AT — Migración 10: atención de alertas (paso 7, bandeja de alertas)
--
-- Toda alerta registra qué acción tomó el usuario al atenderla (AGENTS.md §7).
-- Quién y cuándo los pone la base de datos, no el navegador: así la hora no
-- depende del reloj del dispositivo y nadie puede atender a nombre de otro.
--
-- SECURITY INVOKER: se aplican las políticas de alerta (RLS). El operativo
-- sólo puede atender alertas ABIERTA; el gerente, cualquiera.
-- =============================================================================

create or replace function public.atender_alerta(p_alerta_id bigint, p_accion text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_accion text := nullif(btrim(p_accion), '');
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para atender una alerta.';
  end if;
  if v_accion is null then
    raise exception 'Indica qué acción se tomó.';
  end if;

  update public.alerta
  set estado        = 'ATENDIDA',
      atendida_por  = auth.uid(),
      atendida_en   = now(),
      accion_tomada = v_accion
  where id = p_alerta_id
    and estado = 'ABIERTA';

  if not found then
    raise exception 'Esta alerta ya no está abierta: alguien la atendió o el motor la resumió en otra.';
  end if;
end;
$$;

comment on function public.atender_alerta(bigint, text) is
  'Marca una alerta abierta como ATENDIDA a nombre del usuario actual, con la acción tomada.';

revoke execute on function public.atender_alerta(bigint, text) from public, anon;
grant  execute on function public.atender_alerta(bigint, text) to authenticated;

-- La bandeja se actualiza en vivo también cuando otro usuario atiende una
-- alerta (UPDATE): Realtime necesita la fila completa para filtrar por RLS.
alter table public.alerta replica identity full;
