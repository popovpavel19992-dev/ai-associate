import { ScrollView, View, Text, RefreshControl, ActivityIndicator } from 'react-native';
import { useState, useCallback, useMemo } from 'react';
import { trpc } from '../../lib/trpc';
import { theme } from '../../lib/theme';

export default function Dashboard() {
  const [refreshing, setRefreshing] = useState(false);

  const range = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      startDate: start.toISOString(),
      endDate: now.toISOString(),
    };
  }, []);

  const casesQ = trpc.cases.list.useQuery({ limit: 100, offset: 0 });
  const kpisQ = trpc.analytics.getKpis.useQuery(range);
  const unreadQ = trpc.notifications.getUnreadCount.useQuery();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([casesQ.refetch(), kpisQ.refetch(), unreadQ.refetch()]);
    setRefreshing(false);
  }, [casesQ, kpisQ, unreadQ]);

  const activeCases = casesQ.data?.length ?? 0;
  const billedHoursMonth =
    kpisQ.data && typeof kpisQ.data === 'object' && 'billableHours' in kpisQ.data
      ? Number((kpisQ.data as { billableHours?: number }).billableHours ?? 0)
      : null;
  const unread = unreadQ.data ?? 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.accent}
        />
      }
    >
      <Tile
        label="Active cases"
        value={casesQ.isLoading ? null : String(activeCases)}
      />
      <Tile
        label="Billed hours (month-to-date)"
        value={
          kpisQ.isLoading
            ? null
            : billedHoursMonth == null
              ? '—'
              : billedHoursMonth.toFixed(1)
        }
      />
      <Tile
        label="Unread notifications"
        value={unreadQ.isLoading ? null : String(unread)}
      />

      {(casesQ.error || kpisQ.error || unreadQ.error) && (
        <View
          style={{
            padding: 14,
            borderRadius: 10,
            backgroundColor: theme.surface,
            borderColor: theme.danger,
            borderWidth: 1,
          }}
        >
          <Text style={{ color: theme.danger, fontWeight: '600', marginBottom: 4 }}>
            Could not load some data
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>
            Pull to retry. Check that EXPO_PUBLIC_API_URL points to a running server.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function Tile({ label, value }: { label: string; value: string | null }) {
  return (
    <View
      style={{
        padding: 18,
        borderRadius: 14,
        backgroundColor: theme.surface,
        borderColor: theme.border,
        borderWidth: 1,
      }}
    >
      <Text style={{ color: theme.textMuted, fontSize: 13, marginBottom: 6 }}>{label}</Text>
      {value === null ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        <Text style={{ color: theme.text, fontSize: 32, fontWeight: '700' }}>{value}</Text>
      )}
    </View>
  );
}
