import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Link } from 'expo-router';
import { trpc } from '../../../lib/trpc';
import { theme } from '../../../lib/theme';

export default function CasesIndex() {
  const [search, setSearch] = useState('');
  const q = trpc.cases.list.useQuery({ limit: 100, offset: 0 });

  const cases = useMemo(() => {
    const list = q.data ?? [];
    if (!search.trim()) return list;
    const needle = search.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(needle));
  }, [q.data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ padding: 12 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search cases…"
          placeholderTextColor={theme.textMuted}
          style={{
            backgroundColor: theme.surface,
            borderColor: theme.border,
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: theme.text,
          }}
        />
      </View>

      {q.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <FlatList
          data={cases}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={
            <RefreshControl
              refreshing={q.isFetching && !q.isLoading}
              onRefresh={() => q.refetch()}
              tintColor={theme.accent}
            />
          }
          ListEmptyComponent={
            <Text style={{ color: theme.textMuted, padding: 16, textAlign: 'center' }}>
              {search ? 'No matches.' : 'No cases yet.'}
            </Text>
          }
          renderItem={({ item }) => (
            <Link
              href={{ pathname: '/(app)/cases/[id]', params: { id: item.id } }}
              asChild
            >
              <Pressable
                style={({ pressed }) => ({
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
                  borderColor: theme.border,
                  borderWidth: 1,
                })}
              >
                <Text
                  style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 8,
                    marginTop: 6,
                    alignItems: 'center',
                  }}
                >
                  <Badge label={item.status ?? 'unknown'} />
                  {item.detectedCaseType ? (
                    <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                      {item.overrideCaseType ?? item.detectedCaseType}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: theme.surfaceAlt,
        borderColor: theme.border,
        borderWidth: 1,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 11 }}>{label}</Text>
    </View>
  );
}
