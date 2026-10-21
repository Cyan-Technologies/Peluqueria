import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Field, Heading, Page, ui } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatDate, palette, useStore } from '@/lib/store';

function notify(title: string, body: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${body}`);
  else Alert.alert(title, body);
}

export default function SettingsScreen() {
  const { business, services, closures, updateBusiness, addService, addClosure, removeClosure, ready, loadError, refresh } = useStore();
  const { signOut } = useAuth();
  const [form, setForm] = useState(business);
  const [addingService, setAddingService] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('');
  const link = `${process.env.EXPO_PUBLIC_APP_URL || (Platform.OS === 'web' ? window.location.origin : '')}/reservar/${form.slug || business.slug}`;

  useEffect(() => {
    if (business.id) setForm(business);
  }, [business.id]);

  const saveBusiness = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      notify('Revisa tu perfil', 'El nombre y el enlace son necesarios.');
      return;
    }
    try {
      await updateBusiness({ ...form, slug: form.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-') });
      notify('Cambios guardados', 'La información de tu negocio se sincronizó con la nube.');
    } catch (error) {
      notify('No se pudieron guardar los cambios', error instanceof Error ? error.message : 'Error de conexión con la nube.');
    }
  };

  const saveService = async () => {
    const numericPrice = Number(price);
    const numericDuration = Number(duration);
    if (!serviceName.trim() || !Number.isFinite(numericPrice) || numericPrice < 0 || !Number.isInteger(numericDuration) || numericDuration < 5) {
      notify('Revisa el servicio', 'Agrega un nombre, precio válido y duración de al menos 5 minutos.');
      return;
    }
    try {
      await addService({ name: serviceName.trim(), description: description.trim(), price: numericPrice, duration: numericDuration });
      setServiceName('');
      setDescription('');
      setPrice('');
      setDuration('');
      setAddingService(false);
    } catch (error) {
      notify('No se pudo guardar el servicio', error instanceof Error ? error.message : 'Error de conexión con la nube.');
    }
  };

  const saveClosure = async () => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(closureDate);
    const parsed = match ? new Date(`${closureDate}T12:00:00`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || formatDate(parsed) !== closureDate) {
      notify('Revisa la fecha', 'Escribe una fecha válida con el formato AAAA-MM-DD.');
      return;
    }
    if (closureDate < formatDate(new Date())) {
      notify('Fecha pasada', 'Solo puedes registrar cierres para hoy o una fecha futura.');
      return;
    }
    if (closureReason.trim().length > 120) {
      notify('Motivo muy largo', 'El motivo puede tener hasta 120 caracteres.');
      return;
    }
    try {
      await addClosure(closureDate, closureReason);
      setClosureDate('');
      setClosureReason('');
      notify('Cierre guardado', 'Ese día ya no aparecerá como disponible para reservas.');
    } catch (error) {
      notify('No se pudo guardar el cierre', error instanceof Error ? error.message : 'Error de conexión con la nube.');
    }
  };

  const deleteClosure = async (id: string) => {
    try {
      await removeClosure(id);
    } catch (error) {
      notify('No se pudo eliminar el cierre', error instanceof Error ? error.message : 'Error de conexión con la nube.');
    }
  };

  const confirmDeleteClosure = (id: string) => {
    const remove = () => { void deleteClosure(id); };
    if (Platform.OS === 'web') {
      if (window.confirm('¿Eliminar este cierre y volver a ofrecer citas en esa fecha?')) remove();
      return;
    }
    Alert.alert('Eliminar cierre', 'Se volverán a ofrecer horarios para esa fecha.', [
      { text: 'Conservar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: remove },
    ]);
  };

  const logout = async () => {
    try {
      await signOut();
    } catch (error) {
      notify('No se pudo cerrar la sesión', error instanceof Error ? error.message : 'Error de conexión con la nube.');
    }
  };

  if (!ready) return <Page><Card style={styles.loading}><ActivityIndicator color={palette.green} /><Text style={ui.muted}>Cargando ajustes…</Text></Card></Page>;
  if (loadError) return <Page><Card><Text style={ui.sectionTitle}>No se pudieron cargar los ajustes</Text><Text style={ui.muted}>{loadError}</Text><Pressable style={ui.button} onPress={() => refresh().catch(() => undefined)}><Text style={ui.buttonText}>Reintentar</Text></Pressable></Card></Page>;

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Heading eyebrow="Personaliza tu espacio" title="Ajustes" subtitle="Tu negocio, tus reglas." />

        <Card>
          <View style={ui.between}>
            <Text style={ui.sectionTitle}>Tu negocio</Text>
            <Text style={styles.demoBadge}>PERFIL</Text>
          </View>
          <Field label="Nombre del negocio" value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="Casa Nopal" />
          <Field label="Descripción" value={form.description} onChangeText={(description) => setForm({ ...form, description })} placeholder="Cuéntale a tus clientes sobre ti" multiline />
          <Field label="Dirección" value={form.address} onChangeText={(address) => setForm({ ...form, address })} placeholder="Colonia, ciudad" />
          <Field label="Teléfono de contacto" value={form.phone} onChangeText={(phone) => setForm({ ...form, phone })} placeholder="55 1234 5678" keyboardType="phone-pad" />
          <Pressable style={ui.button} onPress={saveBusiness}><Text style={ui.buttonText}>Guardar perfil</Text></Pressable>
        </Card>

        <Card>
          <Text style={ui.sectionTitle}>Servicios</Text>
          {services.map((service) => (
            <View key={service.id} style={styles.serviceRow}>
              <View style={styles.serviceIcon}><Text style={styles.serviceIconText}>✦</Text></View>
              <View style={styles.serviceInfo}>
                <Text style={styles.serviceName}>{service.name}</Text>
                <Text style={ui.muted}>{service.duration} min{service.description ? ` · ${service.description}` : ''}</Text>
              </View>
              <Text style={styles.price}>${service.price}</Text>
            </View>
          ))}
          <Pressable style={ui.outlineButton} onPress={() => setAddingService((value) => !value)}>
            <Text style={ui.outlineText}>{addingService ? 'Cerrar' : '+ Agregar servicio'}</Text>
          </Pressable>
          {addingService ? (
            <View style={styles.form}>
              <Field label="Nombre" value={serviceName} onChangeText={setServiceName} placeholder="Ej. Tinte" />
              <Field label="Descripción (opcional)" value={description} onChangeText={setDescription} placeholder="Breve descripción" />
              <View style={styles.row}>
                <View style={styles.half}><Field label="Precio (MXN)" value={price} onChangeText={setPrice} placeholder="350" keyboardType="decimal-pad" /></View>
                <View style={styles.half}><Field label="Duración (min)" value={duration} onChangeText={setDuration} placeholder="60" keyboardType="number-pad" /></View>
              </View>
              <Pressable style={ui.button} onPress={saveService}><Text style={ui.buttonText}>Guardar servicio</Text></Pressable>
            </View>
          ) : null}
        </Card>

        <Card>
          <Text style={ui.sectionTitle}>Horarios de atención</Text>
          <View style={styles.row}>
            <View style={styles.half}><Field label="Abre" value={form.hours.split('–')[0] ?? ''} onChangeText={(open) => setForm({ ...form, hours: `${open}–${form.hours.split('–')[1] ?? '19:00'}` })} placeholder="09:00" /></View>
            <View style={styles.half}><Field label="Cierra" value={form.hours.split('–')[1] ?? ''} onChangeText={(close) => setForm({ ...form, hours: `${form.hours.split('–')[0] ?? '09:00'}–${close}` })} placeholder="19:00" /></View>
          </View>
          <Field label="Días no laborables" value={form.closedDays} onChangeText={(closedDays) => setForm({ ...form, closedDays })} placeholder="Domingo" />
          <Text style={styles.helper}>Escribe los días separados por coma. Ejemplo: Domingo, lunes.</Text>
          <Pressable style={ui.button} onPress={saveBusiness}><Text style={ui.buttonText}>Guardar horarios</Text></Pressable>
        </Card>

        <Card>
          <Text style={ui.sectionTitle}>Cierres por fecha</Text>
          <Text style={ui.muted}>Agrega vacaciones, festivos u otros días especiales en los que no recibirás citas.</Text>
          {closures.length ? closures.map((closure) => (
            <View key={closure.id} style={styles.closureRow}>
              <View style={styles.serviceInfo}>
                <Text style={styles.serviceName}>{new Date(`${closure.date}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                {closure.reason ? <Text style={ui.muted}>{closure.reason}</Text> : null}
              </View>
              <Pressable onPress={() => confirmDeleteClosure(closure.id)} accessibilityRole="button" accessibilityLabel="Eliminar cierre">
                <Text style={styles.removeText}>Eliminar</Text>
              </Pressable>
            </View>
          )) : <Text style={ui.muted}>Todavía no hay cierres especiales.</Text>}
          <Field label="Fecha (AAAA-MM-DD)" value={closureDate} onChangeText={setClosureDate} placeholder="2026-12-25" keyboardType="numbers-and-punctuation" />
          <Field label="Motivo (opcional)" value={closureReason} onChangeText={setClosureReason} placeholder="Ej. Vacaciones" maxLength={120} />
          <Pressable style={ui.button} onPress={saveClosure}><Text style={ui.buttonText}>Agregar cierre</Text></Pressable>
          <Text style={styles.helper}>No se puede cerrar un día que ya tenga citas pendientes o confirmadas; primero cámbialas o cancélalas.</Text>
        </Card>

        <Card style={styles.linkCard}>
          <Text style={styles.linkEyebrow}>RESERVAS EN LÍNEA</Text>
          <Text style={ui.sectionTitle}>Tu enlace privado</Text>
          <Text style={ui.muted}>Compártelo directamente con tus clientes para que puedan reservar.</Text>
          <View style={styles.linkBox}><Text selectable style={styles.linkText}>{link}</Text></View>
          <Link href={`/reservar/${form.slug || business.slug}`} asChild>
            <Pressable style={ui.button}><Text style={ui.buttonText}>Ver página de reservas</Text></Pressable>
          </Link>
        </Card>
        <Card>
          <Text style={ui.sectionTitle}>Tu sesión</Text>
          <Text style={ui.muted}>Tus cambios se guardan en la nube y solo tú puedes administrar este negocio.</Text>
          <Pressable style={ui.outlineButton} onPress={logout}><Text style={ui.outlineText}>Cerrar sesión</Text></Pressable>
        </Card>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 30 },
  loading: { alignItems: 'center' },
  demoBadge: { color: palette.green, backgroundColor: palette.paleGreen, fontSize: 10, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8 },
  serviceIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: palette.paleGreen, alignItems: 'center', justifyContent: 'center' },
  serviceIconText: { color: palette.green, fontSize: 18 },
  serviceInfo: { flex: 1, gap: 3 },
  serviceName: { color: palette.ink, fontWeight: '700', fontSize: 14 },
  closureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: 8 },
  removeText: { color: '#9a6358', fontSize: 12, fontWeight: '700' },
  price: { color: palette.ink, fontSize: 14, fontWeight: '800' },
  form: { gap: 12, paddingTop: 5 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  helper: { fontSize: 11, color: palette.muted, marginTop: -5 },
  linkCard: { backgroundColor: '#eef1e8' },
  linkEyebrow: { color: palette.green, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  linkBox: { backgroundColor: '#fffefa', borderRadius: 12, borderWidth: 1, borderColor: palette.border, padding: 13 },
  linkText: { color: palette.green, fontSize: 14, fontWeight: '700' },
  disclaimer: { color: palette.muted, fontSize: 11, textAlign: 'center', lineHeight: 16, paddingHorizontal: 15 },
});
