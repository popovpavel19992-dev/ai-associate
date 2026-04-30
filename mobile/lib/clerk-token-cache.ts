import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Token cache for Clerk Expo SDK.
 *
 * Uses expo-secure-store on iOS/Android (Keychain / EncryptedSharedPreferences).
 * On web, expo-secure-store is unavailable — fall back to no-op so the SDK keeps
 * the in-memory token only. (We still ship react-native-web for dev preview.)
 */
export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // ignore
    }
  },
};
