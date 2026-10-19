import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Field, Heading, Page, ui } from '@/components/ui';
import { palette, useStore } from '@/lib/store';

function notify(title: string, body: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${body}`);
  else Alert.alert(title, body);
}

export default function ClientsScreen() {
  const { clients, appointments, services, addClient, ready, loadError, refresh } = useStore();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const filtered = useMemo(
    () => clients.filter((client) => `${client.name} ${client.contact}`.toLowerCase().includes(query.toLowerCase())),
    [clients, query]
  );

  const save = async () => {
    if (!name.trim() || !contact.trim()) {
      notify('Faltan datos', 'Agrega el nombre y teléfono o correo del cliente.');
      return;
    }
    if (clients.some((client) => client.contact.toLowerCase() === contact.trim().toLowerCase())) {
      notify('Cliente existente', 'Ya hay un cliente registrado con ese medio de contacto.');
      return;
    }
    try {
      await addClient(name.trim(), contact.trim());
      setName('');
      setContact('');
      setAdding(false);
    } catch (error) {
      notify('No se pudo guardar el cliente', error instanceof Error ? error.message : 'Error de conexión con la nube.');
    }
  };

  if (!ready) return <Page><Card style={styles.empty}><ActivityIndicator color={palette.green} /><Text style={ui.muted}>Cargando clientes…</Text></Card></Page>;
  if (loadError) return <Page><Card><Text style={ui.sectionTitle}>No se pudieron cargar los clientes</Text><Text style={ui.muted}>{loadError}</Text><Pressable style={ui.button} onPress={() => refresh().catch(() => undefined)}><Text style={ui.buttonText}>Reintentar</Text></Pressable></Card></Page>;

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={ui.between}>
          <Heading eyebrow="Tu comunidad" title="Clientes" subtitle={`${clients.length} personas en tu lista`} />
          <Pressable style={styles.addButton} onPress={() => setAdding((value) => !value)}><Text style={styles.addText}>{adding ? 'Cerrar' : '+ Agregar'}</Text></Pressable>
        </View>
        <Field label="Buscar cliente" value={query} onChangeText={setQuery} placeholder="Nombre, teléfono o correo" />

        {adding ? (
          <Card>
            <Text style={ui.sectionTitle}>Nuevo cliente</Text>
            <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej. Ana García" />
            <Field label="Teléfono o correo" value={contact} onChangeText={setContact} placeholder="55 1234 5678" />
            <Pressable style={ui.button} onPress={save}><Text style={ui.buttonText}>Guardar cliente</Text></Pressable>
          </Card>
        ) : null}

        <View style={styles.list}>
          {filtered.map((client) => {
            const history = appointments.filter((appointment) => appointment.contact.toLowerCase() === client.contact.toLowerCase());
            const latest = history.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))[0];
            return (
              <Card key={client.id} style={styles.clientCard}>
                <View style={ui.row}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{client.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</Text></View>
                  <View style={styles.clientInfo}>
                    <Text style={styles.clientName}>{client.name}</Text>
                    <Text style={ui.muted}>{client.contact}</Text>
                  </View>
                  <View style={styles.count}>
                    <Text style={styles.countNum}>{history.length}</Text>
                    <Text style={styles.countLabel}>citas</Text>
                  </View>
                </View>
                <View style={ui.divider} />
                {latest ? (
                  <View style={ui.between}>
                    <Text style={ui.muted}>Última visita · {services.find((service) => service.id === latest.serviceId)?.name ?? 'Servicio'}</Text>
                    <Text style={styles.date}>{new Date(`${latest.date}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</Text>
                  </View>
                ) : <Text style={ui.muted}>Aún no tiene citas registradas</Text>}
              </Card>
            );
          })}
          {filtered.length === 0 ? <Card style={styles.empty}><Text style={ui.muted}>No encontramos clientes con esa búsqueda.</Text></Card> : null}
        </View>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 17, paddingBottom: 24 },
  addButton: { backgroundColor: palette.paleGreen, borderRadius: 22, paddingHorizontal: 13, paddingVertical: 10 },
  addText: { color: palette.green, fontWeight: '700', fontSize: 12 },
  list: { gap: 12 },
  clientCard: { gap: 12 },
  avatar: { height: 46, width: 46, borderRadius: 23, backgroundColor: palette.paleGreen, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: palette.green, fontWeight: '800', fontSize: 13 },
  clientInfo: { flex: 1, gap: 4 },
  clientName: { color: palette.ink, fontSize: 15, fontWeight: '700' },
  count: { alignItems: 'center', minWidth: 43 },
  countNum: { color: palette.ink, fontSize: 17, fontWeight: '800' },
  countLabel: { color: palette.muted, fontSize: 10 },
  date: { color: palette.ink, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  empty: { alignItems: 'center' },
});
