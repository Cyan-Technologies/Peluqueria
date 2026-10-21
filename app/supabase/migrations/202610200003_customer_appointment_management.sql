begin;

alter table public.appointments
  add column if not exists customer_management_token uuid unique,
  add column if not exists change_request_date date,
  add column if not exists change_request_time time,
  add column if not exists change_requested_at timestamptz,
  add constraint appointments_complete_change_request check (
    (change_request_date is null and change_request_time is null and change_requested_at is null)
    or (change_request_date is not null and change_request_time is not null and change_requested_at is not null)
  );

create or replace function public.guard_business_closure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_mx_date date;
begin
  if auth.uid() is not null and new.business_id is distinct from public.my_business_id() then
    raise exception 'NO_AUTORIZADO' using errcode = 'P0001';
  end if;

  current_mx_date := (now() at time zone 'America/Mexico_City')::date;
  if new.closed_date < current_mx_date then
    raise exception 'FECHA_DE_CIERRE_INVALIDA' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':' || new.closed_date::text, 0));

  if exists (
    select 1
    from public.appointments a
    where a.business_id = new.business_id
      and (
        a.appointment_date = new.closed_date
        or a.change_request_date = new.closed_date
      )
      and a.status <> 'cancelled'
  ) then
    raise exception 'CIERRE_CON_CITAS_ACTIVAS' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.clear_stale_appointment_change_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('pending', 'confirmed')
    or new.appointment_date is distinct from old.appointment_date
    or new.start_time is distinct from old.start_time then
    new.change_request_date := null;
    new.change_request_time := null;
    new.change_requested_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_stale_appointment_change_request on public.appointments;
create trigger clear_stale_appointment_change_request
  before update of status, appointment_date, start_time on public.appointments
  for each row execute function public.clear_stale_appointment_change_request();

create or replace function public.create_public_booking_with_management_token(
  p_slug text,
  p_service_id uuid,
  p_date date,
  p_start_time time,
  p_client_name text,
  p_contact text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  business_uuid uuid;
  appointment_uuid uuid;
  management_token uuid := gen_random_uuid();
begin
  select b.id into business_uuid
  from public.businesses b
  where b.slug = lower(trim(p_slug));

  if not found then
    raise exception 'NEGOCIO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  appointment_uuid := public.create_appointment_internal(
    business_uuid, p_service_id, p_date, p_start_time, p_client_name, p_contact
  );

  update public.appointments
  set customer_management_token = management_token
  where id = appointment_uuid and business_id = business_uuid;

  return management_token;
end;
$$;

create or replace function public.get_customer_appointment(p_management_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'business_name', b.name,
    'business_slug', b.slug,
    'service_id', s.id,
    'service_name', s.name,
    'appointment_date', a.appointment_date,
    'start_time', a.start_time,
    'status', a.status,
    'change_request_date', a.change_request_date,
    'change_request_time', a.change_request_time,
    'can_manage', (
      a.status in ('pending', 'confirmed')
      and (a.appointment_date + a.start_time) >=
        ((now() at time zone 'America/Mexico_City') + interval '24 hours')
    )
  )
  into result
  from public.appointments a
  join public.businesses b on b.id = a.business_id
  join public.services s on s.id = a.service_id and s.business_id = a.business_id
  where a.customer_management_token = p_management_token;

  return result;
end;
$$;

create or replace function public.cancel_customer_appointment(p_management_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  appointment_row public.appointments%rowtype;
  current_mx_time timestamp;
begin
  select a.* into appointment_row
  from public.appointments a
  where a.customer_management_token = p_management_token
  for update;

  if not found then
    raise exception 'CITA_NO_ENCONTRADA' using errcode = 'P0001';
  end if;

  current_mx_time := now() at time zone 'America/Mexico_City';
  if appointment_row.status not in ('pending', 'confirmed')
    or (appointment_row.appointment_date + appointment_row.start_time) <
      current_mx_time + interval '24 hours' then
    raise exception 'PLAZO_DE_CANCELACION_CERRADO' using errcode = 'P0001';
  end if;

  update public.appointments
  set status = 'cancelled',
      change_request_date = null,
      change_request_time = null,
      change_requested_at = null
  where id = appointment_row.id;

  return true;
end;
$$;

create or replace function public.request_customer_appointment_change(
  p_management_token uuid,
  p_date date,
  p_start_time time
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  appointment_row public.appointments%rowtype;
  business_row public.businesses%rowtype;
  service_duration integer;
  current_mx_time timestamp;
begin
  select a.* into appointment_row
  from public.appointments a
  where a.customer_management_token = p_management_token
  for update;

  if not found then
    raise exception 'CITA_NO_ENCONTRADA' using errcode = 'P0001';
  end if;

  current_mx_time := now() at time zone 'America/Mexico_City';
  if appointment_row.status not in ('pending', 'confirmed')
    or (appointment_row.appointment_date + appointment_row.start_time) <
      current_mx_time + interval '24 hours' then
    raise exception 'PLAZO_DE_CAMBIO_CERRADO' using errcode = 'P0001';
  end if;

  if appointment_row.change_requested_at is not null then
    raise exception 'SOLICITUD_DE_CAMBIO_PENDIENTE' using errcode = 'P0001';
  end if;

  if p_date = appointment_row.appointment_date
    and p_start_time = appointment_row.start_time then
    raise exception 'ELIGE_UN_HORARIO_DIFERENTE' using errcode = 'P0001';
  end if;

  select b.* into business_row
  from public.businesses b
  where b.id = appointment_row.business_id;

  select s.duration_minutes into service_duration
  from public.services s
  where s.id = appointment_row.service_id
    and s.business_id = appointment_row.business_id;

  if p_date < current_mx_time::date
    or (p_date = current_mx_time::date and p_start_time <= current_mx_time::time)
    or extract(isodow from p_date)::smallint = any(business_row.closed_days)
    or p_start_time < business_row.opening_time
    or p_start_time + make_interval(mins => service_duration) > business_row.closing_time
    or extract(second from p_start_time) <> 0
    or mod(extract(epoch from (p_start_time - business_row.opening_time))::integer, 1800) <> 0 then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    appointment_row.business_id::text || ':' || p_date::text, 0
  ));

  if exists (
    select 1
    from public.business_closures c
    where c.business_id = appointment_row.business_id
      and c.closed_date = p_date
  ) then
    raise exception 'NEGOCIO_CERRADO_EN_ESTA_FECHA' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.appointments a
    join public.services s on s.id = a.service_id and s.business_id = a.business_id
    where a.business_id = appointment_row.business_id
      and a.appointment_date = p_date
      and a.id <> appointment_row.id
      and a.status <> 'cancelled'
      and p_start_time < a.start_time + make_interval(mins => s.duration_minutes)
      and a.start_time < p_start_time + make_interval(mins => service_duration)
  ) then
    raise exception 'HORARIO_OCUPADO' using errcode = 'P0001';
  end if;

  update public.appointments
  set change_request_date = p_date,
      change_request_time = p_start_time,
      change_requested_at = now()
  where id = appointment_row.id;

  return true;
end;
$$;

create or replace function public.approve_customer_appointment_change(p_appointment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  business_uuid uuid;
  appointment_row public.appointments%rowtype;
  business_row public.businesses%rowtype;
  service_duration integer;
  current_mx_time timestamp;
  first_lock_date date;
  second_lock_date date;
begin
  if auth.uid() is null then
    raise exception 'INICIA_SESION_REQUERIDO' using errcode = 'P0001';
  end if;

  business_uuid := public.my_business_id();
  if business_uuid is null then
    raise exception 'NEGOCIO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  select a.* into appointment_row
  from public.appointments a
  where a.id = p_appointment_id
    and a.business_id = business_uuid
  for update;

  if not found
    or appointment_row.status not in ('pending', 'confirmed')
    or appointment_row.change_requested_at is null then
    raise exception 'SOLICITUD_DE_CAMBIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  select b.* into business_row
  from public.businesses b
  where b.id = business_uuid;

  select s.duration_minutes into service_duration
  from public.services s
  where s.id = appointment_row.service_id and s.business_id = business_uuid;

  current_mx_time := now() at time zone 'America/Mexico_City';
  if appointment_row.change_request_date < current_mx_time::date
    or (appointment_row.change_request_date = current_mx_time::date
      and appointment_row.change_request_time <= current_mx_time::time)
    or extract(isodow from appointment_row.change_request_date)::smallint = any(business_row.closed_days)
    or appointment_row.change_request_time < business_row.opening_time
    or appointment_row.change_request_time + make_interval(mins => service_duration) > business_row.closing_time
    or extract(second from appointment_row.change_request_time) <> 0
    or mod(extract(epoch from (appointment_row.change_request_time - business_row.opening_time))::integer, 1800) <> 0 then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  first_lock_date := least(appointment_row.appointment_date, appointment_row.change_request_date);
  second_lock_date := greatest(appointment_row.appointment_date, appointment_row.change_request_date);
  perform pg_advisory_xact_lock(hashtextextended(business_uuid::text || ':' || first_lock_date::text, 0));
  if second_lock_date <> first_lock_date then
    perform pg_advisory_xact_lock(hashtextextended(business_uuid::text || ':' || second_lock_date::text, 0));
  end if;

  if exists (
    select 1
    from public.business_closures c
    where c.business_id = business_uuid
      and c.closed_date = appointment_row.change_request_date
  ) then
    raise exception 'NEGOCIO_CERRADO_EN_ESTA_FECHA' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.appointments a
    join public.services s on s.id = a.service_id and s.business_id = a.business_id
    where a.business_id = business_uuid
      and a.appointment_date = appointment_row.change_request_date
      and a.id <> appointment_row.id
      and a.status <> 'cancelled'
      and appointment_row.change_request_time < a.start_time + make_interval(mins => s.duration_minutes)
      and a.start_time < appointment_row.change_request_time + make_interval(mins => service_duration)
  ) then
    raise exception 'HORARIO_OCUPADO' using errcode = 'P0001';
  end if;

  update public.appointments
  set appointment_date = change_request_date,
      start_time = change_request_time,
      change_request_date = null,
      change_request_time = null,
      change_requested_at = null
  where id = appointment_row.id;

  return appointment_row.id;
end;
$$;

create or replace function public.reject_customer_appointment_change(p_appointment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  business_uuid uuid;
  appointment_uuid uuid;
begin
  if auth.uid() is null then
    raise exception 'INICIA_SESION_REQUERIDO' using errcode = 'P0001';
  end if;

  business_uuid := public.my_business_id();
  if business_uuid is null then
    raise exception 'NEGOCIO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  update public.appointments
  set change_request_date = null,
      change_request_time = null,
      change_requested_at = null
  where id = p_appointment_id
    and business_id = business_uuid
    and status in ('pending', 'confirmed')
    and change_requested_at is not null
  returning id into appointment_uuid;

  if appointment_uuid is null then
    raise exception 'SOLICITUD_DE_CAMBIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  return appointment_uuid;
end;
$$;

revoke all on function public.create_public_booking_with_management_token(text, uuid, date, time, text, text) from public, anon, authenticated;
revoke all on function public.get_customer_appointment(uuid) from public, anon, authenticated;
revoke all on function public.cancel_customer_appointment(uuid) from public, anon, authenticated;
revoke all on function public.request_customer_appointment_change(uuid, date, time) from public, anon, authenticated;
revoke all on function public.approve_customer_appointment_change(uuid) from public, anon, authenticated;
revoke all on function public.reject_customer_appointment_change(uuid) from public, anon, authenticated;
revoke all on function public.clear_stale_appointment_change_request() from public, anon, authenticated;
revoke execute on function public.request_public_booking(text, uuid, date, time, text, text) from public, anon, authenticated;

grant execute on function public.create_public_booking_with_management_token(text, uuid, date, time, text, text) to anon, authenticated;
grant execute on function public.get_customer_appointment(uuid) to anon, authenticated;
grant execute on function public.cancel_customer_appointment(uuid) to anon, authenticated;
grant execute on function public.request_customer_appointment_change(uuid, date, time) to anon, authenticated;
grant execute on function public.approve_customer_appointment_change(uuid) to authenticated;
grant execute on function public.reject_customer_appointment_change(uuid) to authenticated;

commit;
