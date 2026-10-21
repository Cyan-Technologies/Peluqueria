import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Heading, Page, ui } from '@/components/ui';
import { formatDate, palette } from '@/lib/store';
import { requireSupabase } from '@/lib/supabase';

type CustomerAppointment = {
  business_name: string;
  business_slug: string;
  service_id: string;
  service_name: string;
  appointment_date: string;
  start_time: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  change_request_date: string | null;
  change_request_time: string | null;
  can_manage: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notify(title: string, body: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${body}`);
  else Alert.alert(title, body);
}

function customerError(error: unknown) {
  const source = error instanceof Error ? error.message : '';
  if (source.includes('PLAZO_DE_CANCELACION_CERRADO') || source.includes('PLAZO_DE_CAMBIO_CERRADO')) {
    return 'Solo puedes cancelar o solicitar un cambio con al menos 24 horas de anticipación.';
  }
  if (source.includes('HORARIO_OCUPADO')) return 'Ese horario ya no está disponible. Elige otro.';
  if (source.includes('SOLICITUD_DE_CAMBIO_PENDIENTE')) return 'Ya tienes una solicitud pendiente de respuesta del negocio.';
  if (source.includes('NEGOCIO_CERRADO_EN_ESTA_FECHA')) return 'El negocio no atiende en esa fecha. Elige otro día.';
  if (source.includes('HORARIO_NO_DISPONIBLE')) return 'Ese horario ya no está disponible. Elige otro.';
  if (source.includes('CITA_NO_ENCONTRADA')) return 'No encontramos una cita asociada a este enlace.';
  return source || 'Intenta de nuevo más tarde.';
}

function formatAppointmentDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function CustomerAppointmentScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [appointment, setAppointment] = useState<CustomerAppointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [selectedTime, setSelectedTime] = useState('');
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return date;
  }), []);

  const loadAppointment = useCallback(async () => {
    if (!uuidPattern.test(token)) {
      setPageError('El enlace de administración no es válido.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setPageError('');
    try {
      const { data, error } = await requireSupabase().rpc('get_customer_appointment', {
        p_management_token: token,
      });
      if (error) throw error;
      if (!data) throw new Error('No encontramos una cita asociada a este enlace.');
      setAppointment(data as CustomerAppointment);
    } catch (error) {
      setPageError(customerError(error));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAppointment();
  }, [loadAppointment]);

  useEffect(() => {
    if (!appointment?.can_manage || !uuidPattern.test(token)) return;
    let active = true;
    setSlotsLoading(true);
    setSlotsError('');
    setAvailableTimes([]);
    setSelectedTime('');
    const loadSlots = async () => {
      try {
        const { data, error } = await requireSupabase().rpc('get_available_slots', {
          p_slug: appointment.business_slug,
          p_service_id: appointment.service_id,
          p_date: selectedDate,
        });
        if (error) throw error;
        if (active) setAvailableTimes(((data ?? []) as { slot: string }[]).map((row) => String(row.slot).slice(0, 5)));
      } catch (error) {
        if (active) setSlotsError(error instanceof Error ? error.message : 'No se pudieron consultar los horarios.');
      } finally {
        if (active) setSlotsLoading(false);
      }
    };
    void loadSlots();
    return () => { active = false; };
  }, [appointment, selectedDate, token]);

  const requestChange = async () => {
    if (!selectedTime || !uuidPattern.test(token)) return;
    setSubmitting(true);
    setNotice('');
    try {
      const { error } = await requireSupabase().rpc('request_customer_appointment_change', {
        p_management_token: token,
        p_date: selectedDate,
        p_start_time: selectedTime,
      });
      if (error) throw error;
      setNotice('Tu solicitud de cambio se envió al negocio. La cita conserva su horario actual hasta que la aprueben.');
      await loadAppointment();
    } catch (error) {
      notify('No se pudo solicitar el cambio', customerError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelAppointment = async () => {
    if (!uuidPattern.test(token)) return;
    setSubmitting(true);
    setNotice('');
    try {
      const { error } = await requireSupabase().rpc('cancel_customer_appointment', {
        p_management_token: token,
      });
      if (error) throw error;
      setNotice('La cita se canceló correctamente.');
      await loadAppointment();
    } catch (error) {
      notify('No se pudo cancelar la cita', customerError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmCancellation = () => {
    if (Platform.OS === 'web') {
      if (window.confirm('¿Seguro que quieres cancelar esta cita?')) void cancelAppointment();
      return;
    }
    Alert.alert('Cancelar cita', '¿Seguro que quieres cancelar esta cita?', [
      { text: 'Conservar cita', style: 'cancel' },
      { text: 'Cancelar cita', style: 'destructive', onPress: () => { void cancelAppointment(); } },
    ]);
  };

  if (loading) return <Page><Card style={styles.center}><ActivityIndicator color={palette.green} /><Text style={ui.muted}>Consultando tu cita…</Text></Card></Page>;
  if (pageError || !appointment) {
    return <Page><Card style={styles.center}><Text style={ui.sectionTitle}>Enlace no disponible</Text><Text style={ui.muted}>{pageError || 'No encontramos esta cita.'}</Text></Card></Page>;
  }

  const statusText = {
    pending: 'Pendiente de confirmación',
    confirmed: 'Confirmada',
    completed: 'Completada',
    cancelled: 'Cancelada',
    no_show: 'No asististe',
  }[appointment.status];
  const active = appointment.status === 'pending' || appointment.status === 'confirmed';

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>{appointment.business_name.charAt(0).toUpperCase()}</Text></View>
          <Text style={styles.brandName}>{appointment.business_name}</Text>
        </View>
        <Heading eyebrow="Administrar cita" title="Tu reserva" subtitle="Desde aquí puedes cancelar o solicitar otro horario." />
        <Card>
          <Text style={ui.sectionTitle}>{appointment.service_name}</Text>
          <Text style={ui.muted}>{formatAppointmentDate(appointment.appointment_date)} · {appointment.start_time.slice(0, 5)}</Text>
          <Text style={styles.status}>{statusText}</Text>
        </Card>

        {notice ? <Card><Text style={styles.notice}>{notice}</Text></Card> : null}

        {appointment.change_request_date && appointment.change_request_time ? (
          <Card>
            <Text style={ui.sectionTitle}>Cambio solicitado</Text>
            <Text style={ui.muted}>{formatAppointmentDate(appointment.change_request_date)} · {appointment.change_request_time.slice(0, 5)}</Text>
            <Text style={styles.notice}>El negocio debe aprobar el cambio. Tu cita actual sigue vigente mientras tanto. Vuelve a abrir este enlace para revisar el estado.</Text>
            <Pressable style={ui.outlineButton} onPress={() => { void loadAppointment(); }}>
              <Text style={ui.outlineText}>Actualizar estado</Text>
            </Pressable>
          </Card>
        ) : null}

        {!active ? (
          <Card><Text style={ui.muted}>Esta cita ya no admite cambios desde el enlace.</Text></Card>
        ) : !appointment.can_manage ? (
          <Card><Text style={ui.muted}>Los cambios y cancelaciones solo se permiten hasta 24 horas antes de la cita.</Text></Card>
        ) : !appointment.change_request_date ? (
          <>
            <Card>
              <Text style={ui.sectionTitle}>Solicitar otro horario</Text>
              <Text style={ui.muted}>El negocio debe aprobar el cambio. Tu cita actual no se cancela hasta que lo aprueben.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
                {dates.map((date) => {
                  const key = formatDate(date);
                  const selected = selectedDate === key;
                  return (
                    <Pressable key={key} style={[styles.day, selected && styles.selectedDay]} onPress={() => setSelectedDate(key)}>
                      <Text style={[styles.dayName, selected && styles.selectedDayText]}>{date.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '')}</Text>
                      <Text style={[styles.dayNumber, selected && styles.selectedDayText]}>{date.getDate()}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.slots}>
                {slotsLoading ? <ActivityIndicator color={palette.green} /> : slotsError ? <Text style={styles.error}>{slotsError}</Text> : availableTimes.length ? availableTimes.map((time) => (
                  <Pressable key={time} style={[styles.slot, selectedTime === time && styles.selectedSlot]} onPress={() => setSelectedTime(time)}>
                    <Text style={[styles.slotText, selectedTime === time && styles.selectedDayText]}>{time}</Text>
                  </Pressable>
                )) : <Text style={ui.muted}>No hay horarios disponibles para ese día.</Text>}
              </View>
              <Pressable style={[ui.button, (!selectedTime || submitting) && styles.disabled]} onPress={() => { void requestChange(); }} disabled={!selectedTime || submitting}>
                {submitting ? <ActivityIndicator color="#fffefa" /> : <Text style={ui.buttonText}>Solicitar cambio</Text>}
              </Pressable>
            </Card>
            <Card>
              <Text style={ui.sectionTitle}>¿Necesitas cancelar?</Text>
              <Text style={ui.muted}>Puedes cancelar hasta 24 horas antes de tu cita.</Text>
              <Pressable style={ui.outlineButton} onPress={confirmCancellation} disabled={submitting}><Text style={ui.outlineText}>Cancelar cita</Text></Pressable>
            </Card>
          </>
        ) : null}

        <Link href={`/reservar/${appointment.business_slug}`} asChild>
          <Pressable style={styles.backLink}><Text style={styles.backText}>Volver a reservar con {appointment.business_name}</Text></Pressable>
        </Link>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 32, maxWidth: 650, width: '100%', alignSelf: 'center' },
  center: { alignItems: 'center', marginTop: 60 },
  brand: { alignItems: 'center', gap: 7, paddingVertical: 6 },
  brandMark: { backgroundColor: palette.green, width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#fffefa', fontSize: 21, fontWeight: '800' },
  brandName: { color: palette.ink, fontSize: 17, fontWeight: '800' },
  status: { color: palette.green, fontSize: 13, fontWeight: '700' },
  notice: { color: palette.green, fontSize: 13, lineHeight: 19 },
  days: { gap: 8, paddingVertical: 3 },
  day: { width: 55, height: 66, borderWidth: 1, borderColor: palette.border, borderRadius: 13, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#fff' },
  selectedDay: { backgroundColor: palette.green, borderColor: palette.green },
  dayName: { fontSize: 11, color: palette.muted, textTransform: 'capitalize' },
  dayNumber: { fontSize: 16, color: palette.ink, fontWeight: '800' },
  selectedDayText: { color: '#fffefa', fontWeight: '700' },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 13, minWidth: 67, alignItems: 'center', backgroundColor: '#fff' },
  selectedSlot: { backgroundColor: palette.green, borderColor: palette.green },
  slotText: { color: palette.ink, fontSize: 13, fontWeight: '600' },
  error: { color: '#9a6358', fontSize: 12 },
  disabled: { opacity: 0.6 },
  backLink: { alignItems: 'center', paddingVertical: 10 },
  backText: { color: palette.green, fontSize: 13, fontWeight: '700' },
});
