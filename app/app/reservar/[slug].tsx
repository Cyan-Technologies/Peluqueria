import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Field, Heading, Page, ui } from '@/components/ui';
import { formatDate, palette, Service } from '@/lib/store';
import { requireSupabase } from '@/lib/supabase';

type BookingPageData = {
  business: { name: string; description: string; address: string; phone: string; slug: string };
  services: Service[];
  opening_time: string;
  closing_time: string;
  closed_days: number[];
};

function notify(title: string, body: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${body}`);
  else Alert.alert(title, body);
}

export default function BookingScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [page, setPage] = useState<BookingPageData | null>(null);
  const [pageError, setPageError] = useState('');
  const [loading, setLoading] = useState(true);
  const [serviceId, setServiceId] = useState('');
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));
  const [selectedTime, setSelectedTime] = useState('');
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [slotError, setSlotError] = useState('');
  const [clientName, setClientName] = useState('');
  const [contact, setContact] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [managementToken, setManagementToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const service = page?.services.find((item) => item.id === serviceId);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return date;
  }), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPageError('');
    const loadPage = async () => {
      try {
        const { data, error } = await requireSupabase()
          .rpc('get_public_booking_page', { p_slug: slug });
        if (error) throw error;
        if (!data) throw new Error('No encontramos un negocio con ese enlace.');
        if (active) {
          const result = data as unknown as BookingPageData;
          setPage(result);
          setServiceId(result.services[0]?.id ?? '');
        }
      } catch (error) {
        if (active) setPageError(error instanceof Error ? error.message : 'No se pudo cargar la página de reservas.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadPage();
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!page || !serviceId) {
      setAvailableTimes([]);
      return;
    }
    let active = true;
    setSlotError('');
    setAvailableTimes([]);
    setSelectedTime('');
    const loadSlots = async () => {
      try {
        const { data, error } = await requireSupabase()
          .rpc('get_available_slots', { p_slug: page.business.slug, p_service_id: serviceId, p_date: selectedDate });
        if (error) throw error;
        if (active) setAvailableTimes(((data ?? []) as { slot: string }[]).map((row) => String(row.slot).slice(0, 5)));
      } catch (error) {
        if (active) setSlotError(error instanceof Error ? error.message : 'No se pudieron consultar los horarios.');
      }
    };
    void loadSlots();
    return () => { active = false; };
  }, [page, selectedDate, serviceId]);

  const submit = async () => {
    if (!clientName.trim() || !contact.trim() || !service || !selectedTime) {
      notify('Completa tu reserva', 'Elige un servicio, día y horario e ingresa tu nombre y medio de contacto.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await requireSupabase().rpc('create_public_booking_with_management_token', {
        p_slug: page?.business.slug,
        p_service_id: serviceId,
        p_date: selectedDate,
        p_start_time: selectedTime,
        p_client_name: clientName.trim(),
        p_contact: contact.trim(),
      });
      if (error?.message.includes('HORARIO_OCUPADO')) {
        setSelectedTime('');
        setSlotError('Ese horario se acaba de ocupar. Elige otro disponible.');
        return;
      }
      if (error?.message.includes('NEGOCIO_CERRADO_EN_ESTA_FECHA')) {
        setSelectedTime('');
        setSlotError('El negocio cerró ese día. Elige otra fecha.');
        return;
      }
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('La cita se creó, pero no se pudo generar el enlace para administrarla. Contacta al negocio para solicitar cambios.');
      setManagementToken(data);
      setConfirmed(true);
    } catch (error) {
      notify('No se pudo enviar la solicitud', error instanceof Error ? error.message : 'Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Page><Card style={styles.center}><ActivityIndicator color={palette.green} /><Text style={ui.muted}>Cargando horarios del negocio…</Text></Card></Page>;
  if (pageError || !page) return <Page><Card style={styles.center}><Text style={ui.sectionTitle}>Enlace no disponible</Text><Text style={ui.muted}>{pageError || 'Revisa el enlace que te compartió el negocio.'}</Text></Card></Page>;

  if (confirmed) {
    return (
      <Page>
        <Card style={styles.confirmation}>
          <View style={styles.confirmationIcon}><Text style={styles.confirmationCheck}>✓</Text></View>
          <Text style={styles.confirmationTitle}>¡Listo, {clientName.split(' ')[0]}!</Text>
          <Text style={[ui.muted, { textAlign: 'center', lineHeight: 21 }]}>Tu solicitud quedó registrada. {page.business.name} se pondrá en contacto contigo para confirmar la cita.</Text>
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>{service?.name}</Text>
            <Text style={ui.muted}>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} · {selectedTime}</Text>
            <Text style={styles.price}>${service?.price} MXN · {service?.duration} min</Text>
          </View>
          <Text style={[ui.muted, { textAlign: 'center', lineHeight: 19 }]}>Guarda el siguiente enlace. Puedes cancelar o pedir un cambio hasta 24 horas antes; el negocio debe aprobar los cambios.</Text>
          {managementToken ? (
            <Link href={{ pathname: '/cita/[token]', params: { token: managementToken } }} asChild>
              <Pressable style={ui.outlineButton}><Text style={ui.outlineText}>Administrar mi cita</Text></Pressable>
            </Link>
          ) : null}
          <Pressable style={ui.button} onPress={() => setConfirmed(false)}><Text style={ui.buttonText}>Listo</Text></Pressable>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>{page.business.name.charAt(0).toUpperCase()}</Text></View>
          <Text style={styles.brandName}>{page.business.name}</Text>
          <Text style={ui.muted}>{page.business.address}</Text>
        </View>
        <Heading eyebrow="Reserva en línea" title="Tu momento, a tu hora." subtitle={page.business.description} />

        <Card>
          <Text style={ui.sectionTitle}>1. Elige un servicio</Text>
          {page.services.length ? (
            <View style={styles.optionList}>
              {page.services.map((item) => (
                <Pressable key={item.id} onPress={() => { setServiceId(item.id); setSelectedTime(''); }} style={[styles.serviceOption, serviceId === item.id && styles.selectedOption]}>
                  <View style={styles.radio}>{serviceId === item.id ? <View style={styles.radioDot} /> : null}</View>
                  <View style={styles.optionInfo}>
                    <Text style={styles.optionName}>{item.name}</Text>
                    <Text style={ui.muted}>{item.duration} min</Text>
                  </View>
                  <Text style={styles.price}>${item.price}</Text>
                </Pressable>
              ))}
            </View>
          ) : <Text style={ui.muted}>Este negocio todavía no publica servicios.</Text>}
        </Card>

        {page.services.length ? (
          <>
            <Card>
              <Text style={ui.sectionTitle}>2. Elige día y hora</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
                {days.map((date) => {
                  const key = formatDate(date);
                  const selected = selectedDate === key;
                  return (
                    <Pressable key={key} style={[styles.day, selected && styles.selectedDay]} onPress={() => { setSelectedDate(key); setSelectedTime(''); }}>
                      <Text style={[styles.dayName, selected && styles.selectedDayText]}>{date.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '')}</Text>
                      <Text style={[styles.dayNumber, selected && styles.selectedDayText]}>{date.getDate()}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.slots}>
                {slotError ? <Text style={styles.error}>{slotError}</Text> : availableTimes.length ? availableTimes.map((time) => (
                  <Pressable key={time} style={[styles.slot, selectedTime === time && styles.selectedSlot]} onPress={() => setSelectedTime(time)}>
                    <Text style={[styles.slotText, selectedTime === time && styles.selectedDayText]}>{time}</Text>
                  </Pressable>
                )) : <Text style={ui.muted}>No hay horarios disponibles para este día.</Text>}
              </View>
            </Card>

            <Card>
              <Text style={ui.sectionTitle}>3. Tus datos</Text>
              <Field label="Tu nombre" value={clientName} onChangeText={setClientName} placeholder="¿Cómo te llamas?" autoCapitalize="words" />
              <Field label="Teléfono o correo" value={contact} onChangeText={setContact} placeholder="¿Cómo podemos contactarte?" />
              <Text style={styles.notice}>Tu solicitud quedará pendiente hasta que el negocio confirme tu cita.</Text>
              <Pressable style={[ui.button, submitting && styles.disabled]} onPress={submit} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fffefa" /> : <Text style={ui.buttonText}>Solicitar cita</Text>}
              </Pressable>
            </Card>
          </>
        ) : null}
        <Text style={styles.footer}>{page.business.name} · {page.business.phone}</Text>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 32, maxWidth: 650, width: '100%', alignSelf: 'center' },
  brand: { alignItems: 'center', gap: 5, paddingVertical: 6 },
  brandMark: { backgroundColor: palette.green, width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  brandMarkText: { color: '#fffefa', fontSize: 21, fontWeight: '800' },
  brandName: { color: palette.ink, fontSize: 17, fontWeight: '800' },
  optionList: { gap: 8 },
  serviceOption: { flexDirection: 'row', alignItems: 'center', gap: 11, borderColor: palette.border, borderWidth: 1, padding: 12, borderRadius: 13, backgroundColor: '#fff' },
  selectedOption: { borderColor: palette.green, backgroundColor: '#f8faf5' },
  radio: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.5, borderColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.green },
  optionInfo: { flex: 1, gap: 3 },
  optionName: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  price: { color: palette.ink, fontSize: 14, fontWeight: '800' },
  days: { gap: 8, paddingVertical: 3 },
  day: { width: 55, height: 66, borderWidth: 1, borderColor: palette.border, borderRadius: 13, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#fff' },
  selectedDay: { backgroundColor: palette.green, borderColor: palette.green },
  dayName: { fontSize: 11, color: palette.muted, textTransform: 'capitalize' },
  dayNumber: { fontSize: 16, color: palette.ink, fontWeight: '800' },
  selectedDayText: { color: '#fffefa', fontWeight: '700' },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  slot: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 13, minWidth: 67, alignItems: 'center', backgroundColor: '#fff' },
  selectedSlot: { backgroundColor: palette.green, borderColor: palette.green },
  slotText: { color: palette.ink, fontSize: 13, fontWeight: '600' },
  notice: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  error: { color: '#9a6358', fontSize: 12 },
  disabled: { opacity: 0.6 },
  footer: { textAlign: 'center', color: palette.muted, fontSize: 11 },
  center: { alignItems: 'center', marginTop: 60 },
  confirmation: { alignItems: 'center', marginTop: 35, padding: 24 },
  confirmationIcon: { backgroundColor: palette.paleGreen, height: 54, width: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  confirmationCheck: { color: palette.green, fontWeight: '800', fontSize: 25 },
  confirmationTitle: { color: palette.ink, fontSize: 25, fontWeight: '800' },
  summary: { alignSelf: 'stretch', backgroundColor: palette.background, borderRadius: 14, padding: 15, gap: 6 },
  summaryTitle: { color: palette.ink, fontSize: 15, fontWeight: '700' },
});
