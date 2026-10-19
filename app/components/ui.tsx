import { PropsWithChildren } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { palette } from '@/lib/store';

export function Page({ children }: PropsWithChildren) {
  return <View style={styles.page}>{children}</View>;
}

export function Heading({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.heading}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children }: PropsWithChildren) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor={palette.muted}
        style={styles.input}
        {...props}
      />
    </View>
  );
}

export const ui = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: palette.ink, fontSize: 18, fontWeight: '700' },
  muted: { color: palette.muted, fontSize: 13 },
  button: { backgroundColor: palette.green, borderRadius: 13, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center' },
  buttonText: { color: '#fffefa', fontWeight: '700', fontSize: 14 },
  outlineButton: { borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 13, alignItems: 'center' },
  outlineText: { color: palette.ink, fontWeight: '600', fontSize: 13 },
  pill: { backgroundColor: palette.paleGreen, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7 },
  pillText: { color: palette.green, fontWeight: '700', fontSize: 12 },
  divider: { height: 1, backgroundColor: palette.border },
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.background, padding: 20, paddingTop: 24, gap: 18 },
  heading: { gap: 6, marginBottom: 2 },
  eyebrow: { color: palette.green, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: palette.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: palette.muted, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: palette.surface, borderRadius: 18, padding: 17, borderWidth: 1, borderColor: palette.border, gap: 13 },
  field: { gap: 7 },
  label: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  input: { minHeight: 48, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, backgroundColor: '#fff', color: palette.ink, fontSize: 15 },
});
