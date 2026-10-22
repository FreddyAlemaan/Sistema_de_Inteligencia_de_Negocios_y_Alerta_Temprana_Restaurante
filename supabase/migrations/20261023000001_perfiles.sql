-- =============================================================================
-- SIN&AT — Migración 4: alta automática de perfiles
--
-- Los usuarios se crean desde el panel de Supabase (Authentication → Users →
-- Add user). Al crearse, este trigger les da un perfil:
--   * nombre: el de los metadatos ("nombre") o, si no hay, la parte del correo
--     antes de la @. Cada usuario puede cambiarlo después.
--   * rol: 'operativo', salvo el primer usuario del sistema, que nace
--     'gerente' para que alguien pueda administrar.
-- Además se impide dejar el sistema sin ningún gerente.
-- =============================================================================

create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text := 'operativo';
begin
  -- Bloqueo para que dos altas simultáneas no se lleven ambas el rol gerente.
  lock table public.perfil in share row exclusive mode;

  if not exists (select 1 from public.perfil where rol = 'gerente') then
    v_rol := 'gerente';
  end if;

  insert into public.perfil (id, nombre, rol)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''),
      split_part(coalesce(new.email, 'usuario'), '@', 1)
    ),
    v_rol
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.crear_perfil_nuevo_usuario() from public, anon, authenticated;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();

-- -----------------------------------------------------------------------------
-- Siempre debe quedar al menos un gerente.
-- -----------------------------------------------------------------------------
create or replace function public.proteger_ultimo_gerente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.rol = 'gerente' and new.rol <> 'gerente'
     and not exists (
       select 1 from public.perfil
       where rol = 'gerente' and id <> old.id
     ) then
    raise exception 'Debe quedar al menos un gerente en el sistema.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.proteger_ultimo_gerente() from public, anon, authenticated;

drop trigger if exists perfil_proteger_ultimo_gerente on public.perfil;
create trigger perfil_proteger_ultimo_gerente
  before update of rol on public.perfil
  for each row execute function public.proteger_ultimo_gerente();

-- -----------------------------------------------------------------------------
-- Usuarios que ya existían antes de esta migración: se les crea su perfil
-- (el más antiguo queda como gerente si todavía no hay ninguno).
-- -----------------------------------------------------------------------------
insert into public.perfil (id, nombre, rol)
select u.id,
       coalesce(nullif(trim(u.raw_user_meta_data ->> 'nombre'), ''),
                split_part(coalesce(u.email, 'usuario'), '@', 1)),
       case
         when row_number() over (order by u.created_at) = 1
              and not exists (select 1 from public.perfil where rol = 'gerente')
         then 'gerente'
         else 'operativo'
       end
from auth.users u
where not exists (select 1 from public.perfil p where p.id = u.id);
