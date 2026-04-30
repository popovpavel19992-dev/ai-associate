import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { trpc } from '../../lib/trpc';
import { theme } from '../../lib/theme';

export default function NotificationsScreen() {
  const utils = trpc.useUtils();
  const q = trpc.notifications.list.useQuery({ filter: 'all', limit: 50, offset: 0 });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.getUnreadCount.invalidate();
    },
  });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.getUnreadCount.invalidate();
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          padding: 12,
        }}
      >
        <Pressable
          onPress={() => markAll.mutate()}
          disabled={markAll.isPending}
          style={({ pressed }) => ({
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
            borderColor: theme.border,
            borderWidth: 1,
            opacity: markAll.isPending ? 0.5 : 1,
          })}
        >
          <Text style={{ color: theme.text, fontSize: 13 }}>Mark all read</Text>
        </Pressable>
      </View>

      {q.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(n) => n.id}
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
              No notifications.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                if (!item.isRead) markRead.mutate({ id: item.id });
              }}
              style={({ pressed }) => ({
                padding: 14,
                borderRadius: 12,
                backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
                borderColor: item.isRead ? theme.border : theme.accent,
                borderWidth: 1,
              })}
            >
              <View
                style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 }}
              >
                {!item.isRead && (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: theme.accent,
                    }}
                  />
                )}
                <Text
                  style={{ color: theme.text, fontSize: 15, fontWeight: '600', flex: 1 }}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
              </View>
              {item.body ? (
                <Text style={{ color: theme.textMuted, fontSize: 13 }} numberOfLines={2}>
                  {item.body}
                </Text>
              ) : null}
              <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 6 }}>
                {new Date(item.createdAt).toLocaleString()}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
