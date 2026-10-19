import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Card, Field, Heading, Page, ui } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { palette } from '@/lib/store';

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function AuthScreen() {
  const { configured, loading, signIn, signUp, user } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async () => {
    setMessage('');
    if (!email.trim() || password.length < 8) {
      setMessage('Escribe tu correo y una contraseña de al menos 8 caracteres.');
      return;
    }
    if (mode === 'signup' && (!businessName.trim() || !slug.trim())) {
      setMessage('Escribe el nombre del negocio y el enlace de reservas.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
      } else {
        const hasSession = await signUp(email.trim(), password, businessName.trim(), slugify(slug));
        if (!hasSession) {
          setMessage('Cuenta creada. Revisa tu correo para confirmar la dirección y después inicia sesión.');
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la operación.');
    } finally {
      setBusy(false);
    }
  };

  if (user) return <Redirect href="/(tabs)" />;

  if (loading) {
    return <Page><View style={styles.loading}><ActivityIndicator color={palette.green} /></View></Page>;
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>P</Text></View>
          <Text style={styles.brandTitle}>Peluquería</Text>
          <Text style={ui.muted}>Tu negocio, bien organizado.</Text>
        </View>

        {!configured ? (
          <Card style={styles.card}>
            <Heading eyebrow="Falta conectar la nube" title="Configura Supabase" subtitle="La app está lista para conectarse; agrega las credenciales públicas de tu proyecto para probar cuentas y sincronización." />
            <Text style={styles.instructions}>1. Crea un proyecto en supabase.com{'\n'}2. Copia la URL del proyecto y su clave publicable (anon) a app/.env{'\n'}3. Ejecuta la migración SQL que está en app/supabase/migrations{'\n'}4. Reinicia Expo con npx expo start --web --port 8081 --clear</Text>
            <Text style={styles.securityNote}>Nunca pongas la clave service_role en la app ni en el archivo .env.</Text>
          </Card>
        ) : (
          <Card style={styles.card}>
            <Heading
              eyebrow={mode === 'login' ? 'Qué bueno verte' : 'Comienza aquí'}
              title={mode === 'login' ? 'Inicia sesión' : 'Crea tu cuenta'}
              subtitle={mode === 'login' ? 'Entra para administrar tu agenda.' : 'Tu cuenta también configurará el perfil del negocio.'}
            />

            {mode === 'signup' ? (
              <>
                <Field
                  label="Nombre del negocio"
                  value={businessName}
                  onChangeText={(value) => {
                    setBusinessName(value);
                    if (!slugEdited) setSlug(slugify(value));
                  }}
                  placeholder="Ej. Casa Nopal"
                />
                <Field label="Enlace de reservas" value={slug} onChangeText={(value) => { setSlugEdited(true); setSlug(slugify(value)); }} placeholder="casa-nopal" autoCapitalize="none" />
                <Text style={styles.helper}>tusitio.mx/reservar/{slugify(slug) || 'tu-negocio'}</Text>
              </>
            ) : null}
            <Field label="Correo electrónico" value={email} onChangeText={setEmail} placeholder="tu@negocio.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <Field label="Contraseña" value={password} onChangeText={setPassword} placeholder="Al menos 8 caracteres" secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {message ? <Text style={styles.message}>{message}</Text> : null}
            <Pressable style={[ui.button, (busy || !configured) && styles.disabled]} onPress={submit} disabled={busy || !configured}>
              {busy ? <ActivityIndicator color="#fffefa" /> : <Text style={ui.buttonText}>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</Text>}
            </Pressable>
            <Pressable onPress={() => { setMessage(''); setMode(mode === 'login' ? 'signup' : 'login'); }}>
              <Text style={styles.switchText}>{mode === 'login' ? '¿Primera vez? Crea tu cuenta de negocio' : '¿Ya tienes cuenta? Inicia sesión'}</Text>
            </Pressable>
          </Card>
        )}
        <Text style={styles.footer}>Citas y clientes, en un solo lugar.</Text>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 23, justifyContent: 'center', paddingVertical: 30, maxWidth: 520, width: '100%', alignSelf: 'center' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  brand: { alignItems: 'center', gap: 7 },
  brandMark: { backgroundColor: palette.green, width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  brandMarkText: { color: '#fffefa', fontSize: 24, fontWeight: '800' },
  brandTitle: { color: palette.ink, fontSize: 23, fontWeight: '800' },
  card: { gap: 17 },
  instructions: { color: palette.ink, fontSize: 13, lineHeight: 22 },
  securityNote: { color: '#9a6358', fontSize: 12, fontWeight: '700', lineHeight: 18 },
  helper: { color: palette.muted, fontSize: 12, marginTop: -10 },
  message: { color: '#9a6358', fontSize: 13, lineHeight: 19 },
  switchText: { color: palette.green, fontSize: 13, fontWeight: '700', textAlign: 'center', paddingVertical: 4 },
  disabled: { opacity: 0.6 },
  footer: { color: palette.muted, fontSize: 12, textAlign: 'center' },
});
