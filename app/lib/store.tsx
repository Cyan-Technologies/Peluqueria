import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { requireSupabase } from '@/lib/supabase';

export type AppointmentStatus = 'Pendiente' | 'Confirmada' | 'Completada' | 'Cancelada' | 'No asistió';

export type Service = {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;
};

export type Appointment = {
  id: string;
  clientName: string;
  contact: string;
  serviceId: string;
  date: string;
  time: string;
  status: AppointmentStatus;
  changeRequest: { date: string; time: string } | null;
};

export type Client = {
  id: string;
  name: string;
  contact: string;
};

export type BusinessClosure = {
  id: string;
  date: string;
  reason: string;
};

export type Business = {
  id: string;
  name: string;
  description: string;
  address: string;
  phone: string;
  hours: string;
  closedDays: string;
  slug: string;
};

type AppData = {
  business: Business;
  services: Service[];
  appointments: Appointment[];
  clients: Client[];
  closures: BusinessClosure[];
};

type Store = AppData & {
  ready: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  updateBusiness: (business: Business) => Promise<void>;
  addService: (service: Omit<Service, 'id'>) => Promise<void>;
  addAppointment: (appointment: Omit<Appointment, 'id' | 'status' | 'changeRequest'>) => Promise<boolean>;
  getRescheduleSlots: (id: string, date: string) => Promise<string[]>;
  rescheduleAppointment: (id: string, date: string, time: string) => Promise<boolean>;
  approveChangeRequest: (id: string) => Promise<void>;
  rejectChangeRequest: (id: string) => Promise<void>;
  updateStatus: (id: string, status: AppointmentStatus) => Promise<void>;
  addClient: (name: string, contact: string) => Promise<void>;
  addClosure: (date: string, reason: string) => Promise<void>;
  removeClosure: (id: string) => Promise<void>;
};

const emptyData: AppData = {
  business: { id: '', name: '', description: '', address: '', phone: '', hours: '09:00–19:00', closedDays: 'Domingo', slug: '' },
  services: [],
  appointments: [],
  clients: [],
  closures: [],
};

const statusToDatabase: Record<AppointmentStatus, string> = {
  Pendiente: 'pending',
  Confirmada: 'confirmed',
  Completada: 'completed',
  Cancelada: 'cancelled',
  'No asistió': 'no_show',
};

const statusFromDatabase: Record<string, AppointmentStatus> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
};

const weekdayNumbers: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miércoles: 3,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sábado: 6,
  sabado: 6,
  domingo: 7,
};

const weekdayNames = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [data, setData] = useState<AppData>(emptyData);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadBusinessData = useCallback(async (userId: string) => {
    const client = requireSupabase();
    const { data: businessRow, error: businessError } = await client
      .from('businesses')
      .select('id,name,description,address,phone,slug,opening_time,closing_time,closed_days')
      .eq('owner_id', userId)
      .single();
    if (businessError) throw businessError;

    const [serviceResult, clientResult, appointmentResult, closureResult] = await Promise.all([
      client.from('services').select('id,name,description,price,duration_minutes').eq('business_id', businessRow.id).order('created_at'),
      client.from('clients').select('id,name,contact').eq('business_id', businessRow.id).order('created_at', { ascending: false }),
      client.from('appointments').select('id,client_name,contact,service_id,appointment_date,start_time,status,change_request_date,change_request_time').eq('business_id', businessRow.id).order('appointment_date').order('start_time'),
      client.from('business_closures').select('id,closed_date,reason').eq('business_id', businessRow.id).order('closed_date'),
    ]);
    if (serviceResult.error) throw serviceResult.error;
    if (clientResult.error) throw clientResult.error;
    if (appointmentResult.error) throw appointmentResult.error;
    if (closureResult.error) throw closureResult.error;

    const nextData: AppData = {
      business: {
        id: businessRow.id,
        name: businessRow.name,
        description: businessRow.description,
        address: businessRow.address,
        phone: businessRow.phone,
        slug: businessRow.slug,
        hours: `${String(businessRow.opening_time).slice(0, 5)}–${String(businessRow.closing_time).slice(0, 5)}`,
        closedDays: (businessRow.closed_days as number[]).map((day) => weekdayNames[day]).join(', '),
      },
      services: serviceResult.data.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        price: Number(service.price),
        duration: service.duration_minutes,
      })),
      clients: clientResult.data,
      appointments: appointmentResult.data.map((appointment) => ({
        id: appointment.id,
        clientName: appointment.client_name,
        contact: appointment.contact,
        serviceId: appointment.service_id,
        date: appointment.appointment_date,
        time: String(appointment.start_time).slice(0, 5),
        status: statusFromDatabase[appointment.status] ?? 'Pendiente',
        changeRequest: appointment.change_request_date && appointment.change_request_time ? {
          date: appointment.change_request_date,
          time: String(appointment.change_request_time).slice(0, 5),
        } : null,
      })),
      closures: closureResult.data.map((closure) => ({
        id: closure.id,
        date: closure.closed_date,
        reason: closure.reason,
      })),
    };

    setData(nextData);
    setLoadError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      await loadBusinessData(user.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido al cargar el negocio.';
      setLoadError(message);
      throw error;
    }
  }, [loadBusinessData, user]);

  useEffect(() => {
    let mounted = true;
    setReady(false);
    if (!user) {
      setData(emptyData);
      setLoadError(null);
      setReady(true);
      return () => { mounted = false; };
    }

    loadBusinessData(user.id)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Error desconocido al cargar el negocio.';
        if (mounted) setLoadError(message);
      })
      .finally(() => {
        if (mounted) setReady(true);
      });

    const timer = setInterval(() => {
      loadBusinessData(user.id).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Error desconocido al actualizar las citas.';
        if (mounted) setLoadError(message);
      });
    }, 30_000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadBusinessData, user]);

  const value: Store = {
    ...data,
    ready,
    loadError,
    refresh,
    updateBusiness: async (business) => {
      const [open, close] = business.hours.split('–');
      const closedDays = business.closedDays
        .split(',')
        .map((day) => weekdayNumbers[day.trim().toLocaleLowerCase()])
        .filter((day): day is number => day !== undefined);
      const { error } = await requireSupabase()
        .from('businesses')
        .update({
          name: business.name.trim(),
          description: business.description.trim(),
          address: business.address.trim(),
          phone: business.phone.trim(),
          slug: business.slug.toLocaleLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
          opening_time: open,
          closing_time: close,
          closed_days: closedDays,
        })
        .eq('id', data.business.id);
      if (error) throw error;
      await refresh();
    },
    addService: async (service) => {
      const { error } = await requireSupabase().from('services').insert({
        business_id: data.business.id,
        name: service.name.trim(),
        description: service.description.trim(),
        price: service.price,
        duration_minutes: service.duration,
      });
      if (error) throw error;
      await refresh();
    },
    addAppointment: async (appointment) => {
      const { error } = await requireSupabase().rpc('create_manual_appointment', {
        p_service_id: appointment.serviceId,
        p_date: appointment.date,
        p_start_time: appointment.time,
        p_client_name: appointment.clientName.trim(),
        p_contact: appointment.contact.trim(),
      });
      if (error?.message.includes('HORARIO_OCUPADO')) return false;
      if (error) throw error;
      await refresh();
      return true;
    },
    getRescheduleSlots: async (id, date) => {
      const { data: slots, error } = await requireSupabase().rpc('get_reschedule_slots', {
        p_appointment_id: id,
        p_date: date,
      });
      if (error) throw error;
      return ((slots ?? []) as { slot: string }[]).map((row) => String(row.slot).slice(0, 5));
    },
    rescheduleAppointment: async (id, date, time) => {
      const { error } = await requireSupabase().rpc('reschedule_appointment', {
        p_appointment_id: id,
        p_date: date,
        p_start_time: time,
      });
      if (error?.message.includes('HORARIO_OCUPADO')) return false;
      if (error) throw error;
      await refresh();
      return true;
    },
    approveChangeRequest: async (id) => {
      const { error } = await requireSupabase().rpc('approve_customer_appointment_change', {
        p_appointment_id: id,
      });
      if (error) throw error;
      await refresh();
    },
    rejectChangeRequest: async (id) => {
      const { error } = await requireSupabase().rpc('reject_customer_appointment_change', {
        p_appointment_id: id,
      });
      if (error) throw error;
      await refresh();
    },
    updateStatus: async (id, status) => {
      const { error } = await requireSupabase()
        .from('appointments')
        .update({ status: statusToDatabase[status] })
        .eq('id', id)
        .eq('business_id', data.business.id);
      if (error) throw error;
      await refresh();
    },
    addClient: async (name, contact) => {
      const { error } = await requireSupabase().from('clients').insert({
        business_id: data.business.id,
        name: name.trim(),
        contact: contact.trim(),
      });
      if (error?.code === '23505') throw new Error('Ya existe un cliente con ese teléfono o correo.');
      if (error) throw error;
      await refresh();
    },
    addClosure: async (date, reason) => {
      const { error } = await requireSupabase().from('business_closures').insert({
        business_id: data.business.id,
        closed_date: date,
        reason: reason.trim(),
      });
      if (error?.code === '23505') throw new Error('Ya existe un cierre registrado para esa fecha.');
      if (error?.message.includes('CIERRE_CON_CITAS_ACTIVAS')) {
        throw new Error('Esa fecha ya tiene citas pendientes o confirmadas. Reprográmalas o cancélalas antes de cerrar el negocio.');
      }
      if (error?.message.includes('FECHA_DE_CIERRE_INVALIDA')) {
        throw new Error('La fecha de cierre debe ser hoy o una fecha futura.');
      }
      if (error) throw error;
      await refresh();
    },
    removeClosure: async (id) => {
      const { error } = await requireSupabase()
        .from('business_closures')
        .delete()
        .eq('id', id)
        .eq('business_id', data.business.id);
      if (error) throw error;
      await refresh();
    },
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore debe usarse dentro de StoreProvider');
  return store;
}

export function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function formatDate(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const palette = {
  background: '#f6f5f0',
  surface: '#fffefa',
  ink: '#20231f',
  muted: '#85877f',
  green: '#58724e',
  paleGreen: '#e8eee3',
  border: '#e9e8e1',
  orange: '#b06d39',
};
