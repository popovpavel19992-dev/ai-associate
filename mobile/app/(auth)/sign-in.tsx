import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSignIn } from '@clerk/clerk-expo';
import { theme } from '../../lib/theme';

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startSignIn() {
    if (!isLoaded || !signIn) return;
    setError(null);
    setBusy(true);
    try {
      const attempt = await signIn.create({ identifier: email });
      const factor = attempt.supportedFirstFactors?.find(
        (f) => f.strategy === 'email_code',
      );
      if (!factor || factor.strategy !== 'email_code') {
        throw new Error('Email-code sign-in not enabled for this account.');
      }
      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: factor.emailAddressId,
      });
      setStage('code');
    } catch (e: any) {
      setError(e?.errors?.[0]?.message ?? e?.message ?? 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!isLoaded || !signIn || !setActive) return;
    setError(null);
    setBusy(true);
    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: 'email_code',
        code,
      });
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId });
      } else {
        setError('Verification incomplete — try again.');
      }
    } catch (e: any) {
      setError(e?.errors?.[0]?.message ?? e?.message ?? 'Verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: 24,
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: theme.text, fontSize: 32, fontWeight: '700', marginBottom: 8 }}>
          ClearTerms
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: 15, marginBottom: 32 }}>
          {stage === 'email' ? 'Sign in with your work email.' : `We sent a code to ${email}.`}
        </Text>

        {stage === 'email' ? (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@firm.com"
              placeholderTextColor={theme.textMuted}
              style={inputStyle}
            />
            <PrimaryButton label="Send code" onPress={startSignIn} busy={busy} />
          </>
        ) : (
          <>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              placeholder="6-digit code"
              placeholderTextColor={theme.textMuted}
              style={inputStyle}
            />
            <PrimaryButton label="Verify" onPress={verifyCode} busy={busy} />
            <Pressable onPress={() => setStage('email')} style={{ marginTop: 16 }}>
              <Text style={{ color: theme.textMuted, textAlign: 'center' }}>
                Use a different email
              </Text>
            </Pressable>
          </>
        )}

        {error ? (
          <Text style={{ color: theme.danger, marginTop: 16, textAlign: 'center' }}>{error}</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const inputStyle = {
  backgroundColor: theme.surface,
  borderColor: theme.border,
  borderWidth: 1,
  borderRadius: 10,
  paddingHorizontal: 14,
  paddingVertical: 14,
  color: theme.text,
  fontSize: 16,
  marginBottom: 16,
} as const;

function PrimaryButton({
  label,
  onPress,
  busy,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => ({
        backgroundColor: theme.accent,
        opacity: busy ? 0.6 : pressed ? 0.85 : 1,
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
      })}
    >
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>{label}</Text>
      )}
    </Pressable>
  );
}
