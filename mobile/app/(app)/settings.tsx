import { View, Text, Pressable, Linking } from 'react-native';
import { useAuth, useUser } from '@clerk/clerk-expo';
import Constants from 'expo-constants';
import { theme } from '../../lib/theme';

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const { user } = useUser();

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
  const version = Constants.expoConfig?.version ?? '0.0.0';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: 16, gap: 12 }}>
      <Section label="Signed in as">
        <Text style={{ color: theme.text }}>
          {user?.primaryEmailAddress?.emailAddress ?? user?.id ?? '—'}
        </Text>
      </Section>

      <Section label="Sync">
        <Text style={{ color: theme.success }}>Live (pull to refresh on each tab)</Text>
      </Section>

      <Section label="App version">
        <Text style={{ color: theme.text }}>{version}</Text>
      </Section>

      <Section label="API endpoint">
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{apiUrl}</Text>
      </Section>

      <Pressable
        onPress={() => Linking.openURL(apiUrl)}
        style={({ pressed }) => ({
          padding: 14,
          borderRadius: 10,
          backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
          borderColor: theme.border,
          borderWidth: 1,
          alignItems: 'center',
        })}
      >
        <Text style={{ color: theme.text }}>Open full app in browser</Text>
      </Pressable>

      <Pressable
        onPress={() => signOut()}
        style={({ pressed }) => ({
          padding: 14,
          borderRadius: 10,
          backgroundColor: pressed ? '#dc2626' : theme.danger,
          alignItems: 'center',
          marginTop: 'auto',
        })}
      >
        <Text style={{ color: '#fff', fontWeight: '600' }}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 12,
        backgroundColor: theme.surface,
        borderColor: theme.border,
        borderWidth: 1,
      }}
    >
      <Text
        style={{
          color: theme.textMuted,
          fontSize: 11,
          letterSpacing: 1,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}
