begin;

create or replace function public.get_reschedule_slots(
  p_appointment_id uuid,
  p_date date
)
returns table(slot time)
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
  candidate time;
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
    and a.status in ('pending', 'confirmed');

  if not found then
    raise exception 'CITA_NO_DISPONIBLE_PARA_CAMBIO' using errcode = 'P0001';
  end if;

  select b.* into business_row
  from public.businesses b
  where b.id = business_uuid;

  select s.duration_minutes into service_duration
  from public.services s
  where s.id = appointment_row.service_id
    and s.business_id = business_uuid;

  current_mx_time := now() at time zone 'America/Mexico_City';
  if p_date < current_mx_time::date
    or extract(isodow from p_date)::smallint = any(business_row.closed_days) then
    return;
  end if;

  candidate := business_row.opening_time;
  while candidate + make_interval(mins => service_duration) <= business_row.closing_time loop
    if (p_date > current_mx_time::date or candidate > current_mx_time::time)
      and mod(extract(epoch from (candidate - business_row.opening_time))::integer, 1800) = 0
      and not exists (
        select 1
        from public.appointments a
        join public.services s on s.id = a.service_id and s.business_id = a.business_id
        where a.business_id = business_uuid
          and a.appointment_date = p_date
          and a.id <> p_appointment_id
          and a.status <> 'cancelled'
          and candidate < a.start_time + make_interval(mins => s.duration_minutes)
          and a.start_time < candidate + make_interval(mins => service_duration)
      ) then
      slot := candidate;
      return next;
    end if;

    candidate := candidate + interval '30 minutes';
  end loop;
end;
$$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_date date,
  p_start_time time
)
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

  if not found or appointment_row.status not in ('pending', 'confirmed') then
    raise exception 'CITA_NO_DISPONIBLE_PARA_CAMBIO' using errcode = 'P0001';
  end if;

  select b.* into business_row
  from public.businesses b
  where b.id = business_uuid;

  select s.duration_minutes into service_duration
  from public.services s
  where s.id = appointment_row.service_id
    and s.business_id = business_uuid;

  if not found then
    raise exception 'SERVICIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  current_mx_time := now() at time zone 'America/Mexico_City';
  if p_date < current_mx_time::date
    or (p_date = current_mx_time::date and p_start_time <= current_mx_time::time)
    or extract(isodow from p_date)::smallint = any(business_row.closed_days)
    or p_start_time < business_row.opening_time
    or p_start_time + make_interval(mins => service_duration) > business_row.closing_time
    or extract(second from p_start_time) <> 0
    or mod(extract(epoch from (p_start_time - business_row.opening_time))::integer, 1800) <> 0 then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  first_lock_date := least(appointment_row.appointment_date, p_date);
  second_lock_date := greatest(appointment_row.appointment_date, p_date);
  perform pg_advisory_xact_lock(hashtextextended(business_uuid::text || ':' || first_lock_date::text, 0));
  if second_lock_date <> first_lock_date then
    perform pg_advisory_xact_lock(hashtextextended(business_uuid::text || ':' || second_lock_date::text, 0));
  end if;

  if exists (
    select 1
    from public.appointments a
    join public.services s on s.id = a.service_id and s.business_id = a.business_id
    where a.business_id = business_uuid
      and a.appointment_date = p_date
      and a.id <> p_appointment_id
      and a.status <> 'cancelled'
      and p_start_time < a.start_time + make_interval(mins => s.duration_minutes)
      and a.start_time < p_start_time + make_interval(mins => service_duration)
  ) then
    raise exception 'HORARIO_OCUPADO' using errcode = 'P0001';
  end if;

  update public.appointments
  set appointment_date = p_date,
      start_time = p_start_time
  where id = p_appointment_id
    and business_id = business_uuid;

  return p_appointment_id;
end;
$$;

revoke all on function public.get_reschedule_slots(uuid, date) from public, anon, authenticated;
revoke all on function public.reschedule_appointment(uuid, date, time) from public, anon, authenticated;
grant execute on function public.get_reschedule_slots(uuid, date) to authenticated;
grant execute on function public.reschedule_appointment(uuid, date, time) to authenticated;

revoke update on public.appointments from authenticated;
grant update (status) on public.appointments to authenticated;

commit;
