begin;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 100),
  description text not null default '',
  address text not null default '',
  phone text not null default '',
  slug text not null unique check (
    length(slug) between 3 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  opening_time time not null default '09:00',
  closing_time time not null default '19:00',
  closed_days smallint[] not null default array[7]::smallint[],
  created_at timestamptz not null default now(),
  constraint businesses_valid_hours check (opening_time < closing_time),
  constraint businesses_valid_closed_days check (
    closed_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  )
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  description text not null default '',
  price numeric(10, 2) not null check (price >= 0),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, business_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  contact text not null check (length(trim(contact)) between 3 and 254),
  created_at timestamptz not null default now(),
  unique (id, business_id)
);

create unique index clients_contact_per_business
  on public.clients (business_id, (lower(trim(contact))));

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  service_id uuid not null,
  client_id uuid not null,
  client_name text not null,
  contact text not null,
  appointment_date date not null,
  start_time time not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  created_at timestamptz not null default now(),
  foreign key (service_id, business_id) references public.services (id, business_id),
  foreign key (client_id, business_id) references public.clients (id, business_id)
);

create index appointments_business_date on public.appointments (business_id, appointment_date, start_time);
create index services_business_active on public.services (business_id, active);

create or replace function public.create_business_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  business_name text;
  business_slug text;
begin
  business_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'business_name'), ''), 'Mi negocio');
  business_slug := lower(trim(coalesce(new.raw_user_meta_data ->> 'business_slug', '')));

  if length(business_slug) not between 3 and 60
    or business_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'El enlace del negocio no es válido.';
  end if;

  insert into public.businesses (owner_id, name, slug)
  values (new.id, business_name, business_slug);

  return new;
end;
$$;

create trigger on_auth_user_created_create_business
  after insert on auth.users
  for each row execute function public.create_business_for_new_user();

create or replace function public.my_business_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.businesses where owner_id = (select auth.uid()) limit 1;
$$;

alter table public.businesses enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;

create policy "Owners can view their business"
  on public.businesses for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can update their business"
  on public.businesses for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Owners can manage their services"
  on public.services for all to authenticated
  using (business_id = (select public.my_business_id()))
  with check (business_id = (select public.my_business_id()));

create policy "Owners can manage their clients"
  on public.clients for all to authenticated
  using (business_id = (select public.my_business_id()))
  with check (business_id = (select public.my_business_id()));

create policy "Owners can view their appointments"
  on public.appointments for select to authenticated
  using (business_id = (select public.my_business_id()));

create policy "Owners can update their appointments"
  on public.appointments for update to authenticated
  using (business_id = (select public.my_business_id()))
  with check (business_id = (select public.my_business_id()));

grant select, update on public.businesses to authenticated;
grant select, insert, update, delete on public.services, public.clients to authenticated;
grant select, update on public.appointments to authenticated;
grant usage on schema public to anon, authenticated;

create or replace function public.get_public_booking_page(p_slug text)
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
    'business', jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'description', b.description,
      'address', b.address,
      'phone', b.phone,
      'slug', b.slug
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'description', s.description,
        'price', s.price,
        'duration', s.duration_minutes
      ) order by s.created_at)
      from public.services s
      where s.business_id = b.id and s.active
    ), '[]'::jsonb),
    'opening_time', b.opening_time,
    'closing_time', b.closing_time,
    'closed_days', b.closed_days
  )
  into result
  from public.businesses b
  where b.slug = lower(trim(p_slug));

  return result;
end;
$$;

create or replace function public.get_available_slots(
  p_slug text,
  p_service_id uuid,
  p_date date
)
returns table(slot time)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  business_row public.businesses%rowtype;
  service_duration integer;
  candidate time;
begin
  select b.* into business_row
  from public.businesses b
  where b.slug = lower(trim(p_slug));

  if not found or p_date < (now() at time zone 'America/Mexico_City')::date then
    return;
  end if;

  select s.duration_minutes into service_duration
  from public.services s
  where s.id = p_service_id and s.business_id = business_row.id and s.active;

  if not found or extract(isodow from p_date)::smallint = any(business_row.closed_days) then
    return;
  end if;

  candidate := business_row.opening_time;
  while candidate + make_interval(mins => service_duration) <= business_row.closing_time loop
    if (p_date > (now() at time zone 'America/Mexico_City')::date
        or candidate > (now() at time zone 'America/Mexico_City')::time)
      and mod(extract(epoch from (candidate - business_row.opening_time))::integer, 1800) = 0
      and not exists (
        select 1
        from public.appointments a
        join public.services s on s.id = a.service_id and s.business_id = a.business_id
        where a.business_id = business_row.id
          and a.appointment_date = p_date
          and a.status <> 'cancelled'
          and candidate < a.start_time + make_interval(mins => s.duration_minutes)
          and a.start_time < candidate + make_interval(mins => service_duration)
      )
    then
      slot := candidate;
      return next;
    end if;
    candidate := candidate + interval '30 minutes';
  end loop;
end;
$$;

create or replace function public.create_appointment_internal(
  p_business_id uuid,
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
  business_row public.businesses%rowtype;
  service_duration integer;
  client_uuid uuid;
  appointment_uuid uuid;
  current_mx_time timestamp;
begin
  select b.* into business_row
  from public.businesses b
  where b.id = p_business_id;

  if not found then
    raise exception 'NEGOCIO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  select s.duration_minutes into service_duration
  from public.services s
  where s.id = p_service_id and s.business_id = p_business_id and s.active;

  if not found then
    raise exception 'SERVICIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  if length(trim(p_client_name)) not between 1 and 120
    or length(trim(p_contact)) not between 3 and 254 then
    raise exception 'DATOS_DE_CLIENTE_INVALIDOS' using errcode = 'P0001';
  end if;

  current_mx_time := now() at time zone 'America/Mexico_City';
  if p_date < current_mx_time::date
    or (p_date = current_mx_time::date and p_start_time <= current_mx_time::time)
    or extract(isodow from p_date)::smallint = any(business_row.closed_days)
    or p_start_time < business_row.opening_time
    or p_start_time + make_interval(mins => service_duration) > business_row.closing_time
    or mod(extract(epoch from (p_start_time - business_row.opening_time))::integer, 1800) <> 0 then
    raise exception 'HORARIO_NO_DISPONIBLE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_date::text, 0));

  if exists (
    select 1
    from public.appointments a
    join public.services s on s.id = a.service_id and s.business_id = a.business_id
    where a.business_id = p_business_id
      and a.appointment_date = p_date
      and a.status <> 'cancelled'
      and p_start_time < a.start_time + make_interval(mins => s.duration_minutes)
      and a.start_time < p_start_time + make_interval(mins => service_duration)
  ) then
    raise exception 'HORARIO_OCUPADO' using errcode = 'P0001';
  end if;

  insert into public.clients (business_id, name, contact)
  values (p_business_id, trim(p_client_name), trim(p_contact))
  on conflict (business_id, (lower(trim(contact)))) do nothing;

  select c.id into client_uuid
  from public.clients c
  where c.business_id = p_business_id
    and lower(trim(c.contact)) = lower(trim(p_contact));

  insert into public.appointments (
    business_id, service_id, client_id, client_name, contact, appointment_date, start_time
  )
  values (
    p_business_id, p_service_id, client_uuid, trim(p_client_name), trim(p_contact), p_date, p_start_time
  )
  returning id into appointment_uuid;

  return appointment_uuid;
end;
$$;

create or replace function public.request_public_booking(
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
begin
  select b.id into business_uuid
  from public.businesses b
  where b.slug = lower(trim(p_slug));

  if not found then
    raise exception 'NEGOCIO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  return public.create_appointment_internal(
    business_uuid, p_service_id, p_date, p_start_time, p_client_name, p_contact
  );
end;
$$;

create or replace function public.create_manual_appointment(
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
begin
  business_uuid := public.my_business_id();
  if business_uuid is null then
    raise exception 'NEGOCIO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;

  return public.create_appointment_internal(
    business_uuid, p_service_id, p_date, p_start_time, p_client_name, p_contact
  );
end;
$$;

revoke all on function public.create_business_for_new_user() from public, anon, authenticated;
revoke all on function public.my_business_id() from public, anon, authenticated;
revoke all on function public.get_public_booking_page(text) from public, anon, authenticated;
revoke all on function public.get_available_slots(text, uuid, date) from public, anon, authenticated;
revoke all on function public.create_appointment_internal(uuid, uuid, date, time, text, text) from public, anon, authenticated;
revoke all on function public.request_public_booking(text, uuid, date, time, text, text) from public, anon, authenticated;
revoke all on function public.create_manual_appointment(uuid, date, time, text, text) from public, anon, authenticated;

grant execute on function public.my_business_id() to authenticated;
grant execute on function public.get_public_booking_page(text) to anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, date) to anon, authenticated;
grant execute on function public.request_public_booking(text, uuid, date, time, text, text) to anon, authenticated;
grant execute on function public.create_manual_appointment(uuid, date, time, text, text) to authenticated;

commit;
