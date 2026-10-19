import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useAuth } from '@/lib/auth';

const colors = { ink: '#20231f', muted: '#85877f', green: '#58724e' };

export default function TabLayout() {
  const { loading, user } = useAuth();

  if (loading) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color={colors.green} /></View>;
  if (!user) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          height: Platform.OS === 'web' ? 66 : 82,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'web' ? 8 : 22,
          borderTopColor: '#eeeee8',
          backgroundColor: '#fffefa',
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Agenda', tabBarIcon: () => null }} />
      <Tabs.Screen name="two" options={{ title: 'Clientes', tabBarIcon: () => null }} />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes', tabBarIcon: () => null }} />
    </Tabs>
  );
}
