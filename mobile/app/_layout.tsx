import { ClerkProvider, ClerkLoaded } from '@clerk/clerk-expo';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Text } from 'react-native';
import { tokenCache } from '../lib/clerk-token-cache';
import { TRPCProvider } from '../lib/trpc';
import { theme } from '../lib/theme';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout() {
  if (!publishableKey) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.bg,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
          Missing Clerk key
        </Text>
        <Text style={{ color: theme.textMuted, textAlign: 'center' }}>
          Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in mobile/.env to continue.
        </Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
          <ClerkLoaded>
            <TRPCProvider>
              <StatusBar style="light" />
              <Slot />
            </TRPCProvider>
          </ClerkLoaded>
        </ClerkProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
