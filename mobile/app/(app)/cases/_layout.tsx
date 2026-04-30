import { Stack } from 'expo-router';
import { theme } from '../../../lib/theme';

export default function CasesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTitleStyle: { color: theme.text },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Cases' }} />
      <Stack.Screen name="[id]" options={{ title: 'Case' }} />
    </Stack>
  );
}
