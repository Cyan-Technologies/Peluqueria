import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Field, Heading, Page, ui } from '@/components/ui';
import { Appointment, AppointmentStatus, formatDate, palette, useStore } from '@/lib/store';

function message(title: string, body: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${body}`);
  else Alert.alert(title, body);
}

export default function AgendaScreen() {
  const { appointments, services, business, addAppointment, updateStatus, ready, loadError, refresh } = useStore();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [adding, setAdding] = useState(false);
  const [clientName, setClientName] = useState('');
  const [contact, setContact] = useState('');
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [time, setTime] = useState('16:00');
  const dayKey = formatDate(selectedDate);
  useEffect(() => {
    if (!serviceId && services.length) setServiceId(services[0].id);
  }, [serviceId, services]);
  const weekStart = new Date(selectedDate);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekStartKey = formatDate(weekStart);
  const weekEndKey = formatDate(weekEnd);

  const dayAppointments = useMemo(
    () => appointments.filter((item) => item.date === dayKey && item.status !== 'Cancelada').sort((a, b) => a.time.localeCompare(b.time)),
    [appointments, dayKey]
  );
  const weekAppointments = useMemo(
    () => appointments.filter((item) => item.date >= weekStartKey && item.date <= weekEndKey && item.status !== 'Cancelada').sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
    [appointments, weekEndKey, weekStartKey]
  );
  const visibleAppointments = viewMode === 'day' ? dayAppointments : weekAppointments;

  const dayTitle = selectedDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const rangeTitle = `${weekStart.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${weekEnd.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`;
  const changeDay = (amount: number) => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + amount);
    setSelectedDate(next);
  };

  const saveManualAppointment = async () => {
    if (!clientName.trim() || !contact.trim() || !serviceId || !/^\d{2}:\d{2}$/.test(time)) {
      message('Revisa los datos', 'Escribe el nombre, contacto, servicio y hora (HH:MM).');
      return;
    }
    try {
      const success = await addAppointment({ clientName: clientName.trim(), contact: contact.trim(), serviceId, date: dayKey, time });
      if (!success) {
        message('Horario ocupado', 'La duración de este servicio se traslapa con otra cita. Elige otra hora.');
        return;
      }
      setAdding(false);
      setClientName('');
      setContact('');
    } catch (error) {
      message('No se pudo guardar la cita', error instanceof Error ? error.message : 'Error de conexión con la nube.');
    }
  };

  const handleStatus = async (id: string, status: AppointmentStatus) => {
    try {
      await updateStatus(id, status);
    } catch (error) {
      message('No se pudo actualizar la cita', error instanceof Error ? error.message : 'Error de conexión con la nube.');
    }
  };

  if (!ready) return <Page><Card style={styles.empty}><ActivityIndicator color={palette.green} /><Text style={ui.muted}>Cargando datos del negocio…</Text></Card></Page>;
  if (loadError) return <Page><Card><Text style={ui.sectionTitle}>No se pudo cargar la agenda</Text><Text style={ui.muted}>{loadError}</Text><Pressable style={ui.button} onPress={() => refresh().catch(() => undefined)}><Text style={ui.buttonText}>Reintentar</Text></Pressable></Card></Page>;

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={ui.between}>
          <Heading eyebrow={business.name} title="Tu agenda" subtitle="Organiza tu día, a tu manera." />
          <Link href={`/reservar/${business.slug}`} asChild>
            <Pressable style={styles.roundButton}><Text style={styles.roundText}>↗</Text></Pressable>
          </Link>
        </View>

        <Card style={styles.dateCard}>
          <Pressable onPress={() => changeDay(-1)} style={styles.arrow}><Text style={styles.arrowText}>‹</Text></Pressable>
          <Pressable onPress={() => setSelectedDate(new Date())} style={styles.dateLabel}>
            <Text style={styles.dateDay}>{viewMode === 'day' ? dayTitle.charAt(0).toUpperCase() + dayTitle.slice(1) : rangeTitle}</Text>
            <Text style={ui.muted}>{visibleAppointments.length} citas · {viewMode === 'day' ? selectedDate.toLocaleDateString('es-MX', { year: 'numeric' }) : 'esta semana'}</Text>
          </Pressable>
          <Pressable onPress={() => changeDay(1)} style={styles.arrow}><Text style={styles.arrowText}>›</Text></Pressable>
        </Card>

        <View style={styles.modeSwitch}>
          <Pressable style={[styles.modeButton, viewMode === 'day' && styles.modeSelected]} onPress={() => setViewMode('day')}><Text style={[styles.modeText, viewMode === 'day' && styles.modeTextSelected]}>Día</Text></Pressable>
          <Pressable style={[styles.modeButton, viewMode === 'week' && styles.modeSelected]} onPress={() => setViewMode('week')}><Text style={[styles.modeText, viewMode === 'week' && styles.modeTextSelected]}>Semana</Text></Pressable>
        </View>

        <View style={ui.between}>
          <Text style={ui.sectionTitle}>{viewMode === 'day' ? 'Citas del día' : 'Citas de la semana'}</Text>
          <Pressable onPress={() => setAdding((current) => !current)}><Text style={styles.actionLink}>{adding ? 'Cerrar' : '+ Agregar cita'}</Text></Pressable>
        </View>

        {adding ? (
          <Card>
            <Text style={ui.sectionTitle}>Nueva cita</Text>
            <Field label="Nombre del cliente" value={clientName} onChangeText={setClientName} placeholder="Ej. Ana García" />
            <Field label="Teléfono o correo" value={contact} onChangeText={setContact} placeholder="Su medio de contacto" />
            <View style={styles.pickerWrap}>
              <Text style={styles.fieldLabel}>Servicio</Text>
              <View style={styles.chips}>
                {services.map((service) => (
                  <Pressable key={service.id} onPress={() => setServiceId(service.id)} style={[styles.chip, serviceId === service.id && styles.chipSelected]}>
                    <Text style={[styles.chipText, serviceId === service.id && styles.chipTextSelected]}>{service.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Field label="Hora (24 h)" value={time} onChangeText={setTime} placeholder="16:00" keyboardType="numbers-and-punctuation" />
            <Pressable style={ui.button} onPress={saveManualAppointment}><Text style={ui.buttonText}>Guardar cita</Text></Pressable>
          </Card>
        ) : null}

        {visibleAppointments.length === 0 ? (
          <Card style={styles.empty}>
            <Text style={styles.emptyEmoji}>☀</Text>
            <Text style={ui.sectionTitle}>Día despejado</Text>
            <Text style={[ui.muted, { textAlign: 'center' }]}>Aún no hay citas para este día. Puedes agregar una o compartir tu enlace de reservas.</Text>
          </Card>
        ) : visibleAppointments.map((appointment) => (
          <AppointmentCard key={appointment.id} appointment={appointment} service={services.find((item) => item.id === appointment.serviceId)?.name ?? 'Servicio'} onStatus={handleStatus} showDate={viewMode === 'week'} />
        ))}

        <View style={styles.footerSpace} />
      </ScrollView>
    </Page>
  );
}

function AppointmentCard({ appointment, service, onStatus, showDate }: { appointment: Appointment; service: string; onStatus: (id: string, status: AppointmentStatus) => void; showDate: boolean }) {
  const nextStatus: AppointmentStatus = appointment.status === 'Pendiente' ? 'Confirmada' : 'Completada';
  return (
    <Card style={styles.appointment}>
      <View style={styles.timeline}>
        <Text style={styles.time}>{appointment.time}</Text>
        <View style={styles.timelineLine} />
      </View>
      <View style={styles.details}>
        <View style={ui.between}>
          <Text style={styles.client}>{appointment.clientName}</Text>
          <Text style={[styles.status, appointment.status === 'Pendiente' ? styles.pending : styles.confirmed]}>{appointment.status}</Text>
        </View>
        <Text style={styles.service}>{showDate ? `${new Date(`${appointment.date}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })} · ` : ''}{service}</Text>
        <Text style={ui.muted}>{appointment.contact}</Text>
        <View style={styles.actions}>
          {appointment.status !== 'Completada' && (
            <Pressable style={ui.outlineButton} onPress={() => onStatus(appointment.id, nextStatus)}>
              <Text style={ui.outlineText}>{appointment.status === 'Pendiente' ? 'Confirmar' : 'Completar'}</Text>
            </Pressable>
          )}
          {appointment.status === 'Confirmada' && (
            <Pressable onPress={() => onStatus(appointment.id, 'No asistió')}><Text style={styles.cancel}>No asistió</Text></Pressable>
          )}
          <Pressable onPress={() => onStatus(appointment.id, 'Cancelada')}><Text style={styles.cancel}>Cancelar</Text></Pressable>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 25 },
  modeSwitch: { flexDirection: 'row', gap: 4, alignSelf: 'flex-start', borderRadius: 13, backgroundColor: '#eae9e2', padding: 4 },
  modeButton: { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 8 },
  modeSelected: { backgroundColor: palette.surface },
  modeText: { color: palette.muted, fontSize: 13, fontWeight: '600' },
  modeTextSelected: { color: palette.ink, fontWeight: '700' },
  roundButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.paleGreen, alignItems: 'center', justifyContent: 'center' },
  roundText: { color: palette.green, fontSize: 23, fontWeight: '700' },
  dateCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  arrow: { width: 38, height: 38, borderRadius: 19, backgroundColor: palette.background, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 27, color: palette.ink, lineHeight: 30 },
  dateLabel: { alignItems: 'center', gap: 4 },
  dateDay: { fontSize: 17, fontWeight: '700', color: palette.ink, textTransform: 'capitalize' },
  actionLink: { color: palette.green, fontSize: 13, fontWeight: '700' },
  appointment: { flexDirection: 'row', gap: 12, padding: 15 },
  timeline: { alignItems: 'center', width: 51 },
  time: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  timelineLine: { flex: 1, width: 1, backgroundColor: palette.border, marginTop: 10 },
  details: { flex: 1, gap: 7 },
  client: { color: palette.ink, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  status: { fontSize: 10, fontWeight: '700', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, overflow: 'hidden' },
  pending: { color: palette.orange, backgroundColor: '#f8eee3' },
  confirmed: { color: palette.green, backgroundColor: palette.paleGreen },
  service: { color: palette.ink, fontSize: 13 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  cancel: { color: '#9a6358', fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 30 },
  emptyEmoji: { fontSize: 26, color: palette.green },
  pickerWrap: { gap: 8 },
  fieldLabel: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: palette.border, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#fff' },
  chipSelected: { backgroundColor: palette.paleGreen, borderColor: palette.green },
  chipText: { color: palette.ink, fontSize: 12 },
  chipTextSelected: { color: palette.green, fontWeight: '700' },
  footerSpace: { height: 10 },
});
