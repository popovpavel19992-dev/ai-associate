import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  FlatList,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { trpc } from '../../lib/trpc';
import { theme } from '../../lib/theme';

export default function TimeEntryScreen() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<{ id: string; name: string } | null>(null);
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const casesQ = trpc.cases.list.useQuery({ limit: 100, offset: 0 });
  const utils = trpc.useUtils();
  const create = trpc.timeEntries.create.useMutation({
    onSuccess: () => {
      setSuccess('Time entry saved.');
      setError(null);
      setHours('');
      setDescription('');
      utils.timeEntries.list.invalidate();
      utils.analytics.getKpis.invalidate();
    },
    onError: (e: { message: string }) => {
      setError(e.message);
      setSuccess(null);
    },
  });

  function save() {
    setError(null);
    setSuccess(null);
    if (!selectedCase) {
      setError('Pick a case first.');
      return;
    }
    const h = parseFloat(hours);
    if (!Number.isFinite(h) || h <= 0) {
      setError('Enter hours greater than 0.');
      return;
    }
    if (!description.trim()) {
      setError('Description is required.');
      return;
    }
    const minutes = Math.round(h * 60);
    if (minutes < 1 || minutes > 1440) {
      setError('Duration must be between 1 minute and 24 hours.');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    create.mutate({
      caseId: selectedCase.id,
      description: description.trim(),
      durationMinutes: minutes,
      isBillable: true,
      entryDate: today,
      activityType: 'other',
    });
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>CASE</Text>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => ({
            padding: 14,
            borderRadius: 10,
            backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
            borderColor: theme.border,
            borderWidth: 1,
          })}
        >
          <Text style={{ color: selectedCase ? theme.text : theme.textMuted }}>
            {selectedCase?.name ?? 'Pick a case…'}
          </Text>
        </Pressable>

        <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 8 }}>HOURS</Text>
        <TextInput
          value={hours}
          onChangeText={setHours}
          keyboardType="decimal-pad"
          placeholder="e.g. 1.5"
          placeholderTextColor={theme.textMuted}
          style={inputStyle}
        />

        <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 8 }}>DESCRIPTION</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What did you work on?"
          placeholderTextColor={theme.textMuted}
          multiline
          numberOfLines={4}
          style={[inputStyle, { minHeight: 100, textAlignVertical: 'top' }]}
        />

        <Pressable
          onPress={save}
          disabled={create.isPending}
          style={({ pressed }) => ({
            backgroundColor: theme.accent,
            opacity: create.isPending ? 0.6 : pressed ? 0.85 : 1,
            paddingVertical: 14,
            borderRadius: 10,
            alignItems: 'center',
            marginTop: 8,
          })}
        >
          {create.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Save entry</Text>
          )}
        </Pressable>

        {success ? (
          <Text style={{ color: theme.success, marginTop: 8 }}>{success}</Text>
        ) : null}
        {error ? <Text style={{ color: theme.danger, marginTop: 8 }}>{error}</Text> : null}
      </ScrollView>

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: 60 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              padding: 16,
            }}
          >
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '600' }}>Pick case</Text>
            <Pressable onPress={() => setPickerOpen(false)}>
              <Text style={{ color: theme.accent, fontSize: 16 }}>Close</Text>
            </Pressable>
          </View>
          {casesQ.isLoading ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: 32 }} />
          ) : (
            <FlatList
              data={casesQ.data ?? []}
              keyExtractor={(c) => c.id}
              ItemSeparatorComponent={() => (
                <View style={{ height: 1, backgroundColor: theme.border }} />
              )}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setSelectedCase({ id: item.id, name: item.name });
                    setPickerOpen(false);
                  }}
                  style={({ pressed }) => ({
                    padding: 16,
                    backgroundColor: pressed ? theme.surfaceAlt : 'transparent',
                  })}
                >
                  <Text style={{ color: theme.text, fontSize: 16 }}>{item.name}</Text>
                </Pressable>
              )}
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const inputStyle = {
  backgroundColor: theme.surface,
  borderColor: theme.border,
  borderWidth: 1,
  borderRadius: 10,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: theme.text,
  fontSize: 16,
} as const;
