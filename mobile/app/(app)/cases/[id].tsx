import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View, Text, ActivityIndicator } from 'react-native';
import { trpc } from '../../../lib/trpc';
import { theme } from '../../../lib/theme';

export default function CaseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const caseQ = trpc.cases.getById.useQuery({ caseId: id }, { enabled: !!id });
  const eventsQ = trpc.cases.getEvents.useQuery({ caseId: id }, { enabled: !!id });

  if (caseQ.isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (caseQ.error || !caseQ.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, padding: 16 }}>
        <Text style={{ color: theme.danger }}>
          {caseQ.error?.message ?? 'Case not found.'}
        </Text>
      </View>
    );
  }

  const c = caseQ.data;
  const events = eventsQ.data ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <Text style={{ color: theme.text, fontSize: 24, fontWeight: '700' }}>
        {(c as any).name}
      </Text>

      <Section title="Status">
        <Text style={{ color: theme.text }}>{(c as any).status ?? '—'}</Text>
      </Section>

      <Section title="Case type">
        <Text style={{ color: theme.text }}>
          {(c as any).overrideCaseType ?? (c as any).detectedCaseType ?? '—'}
        </Text>
      </Section>

      <Section title="Recent events">
        {eventsQ.isLoading ? (
          <ActivityIndicator color={theme.accent} />
        ) : events.length === 0 ? (
          <Text style={{ color: theme.textMuted }}>No events yet.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {events.slice(0, 8).map((e: any) => (
              <View
                key={e.id}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: theme.surfaceAlt,
                  borderColor: theme.border,
                  borderWidth: 1,
                }}
              >
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '500' }}>
                  {e.title ?? e.type ?? 'Event'}
                </Text>
                {e.createdAt ? (
                  <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 8,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}
