/**
 * Root Herald RN — minimal Expo sample.
 *
 * One screen, one button. Tap to verify the device with the Root Herald
 * backend (set EXPO_PUBLIC_ROOTHERALD_ENDPOINT to point at your own
 * deployment). A modal lets you switch between Direct / Custom Domain /
 * Proxy transport modes — wire protocol is identical in all three, only
 * the endpoint URL changes.
 *
 * Run:
 *   cd src/sdk-react-native/example
 *   npm install
 *   npx expo run:ios   # or run:android (bare workflow / dev build)
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import {
  getOrCreateSharedClient,
  useVerifyDevice,
  useDevicePosture,
} from '@rootherald/react-native';

const DEFAULT_ENDPOINT =
  process.env.EXPO_PUBLIC_ROOTHERALD_ENDPOINT ?? 'https://rootherald.io';
// Keyless client — holds no Root Herald key; it posts opaque device
// evidence to your backend, which relays to Root Herald with rh_sk_.
const APP_ID =
  process.env.EXPO_PUBLIC_ROOTHERALD_APP_ID ?? 'your-app-id';

type Mode = 'direct' | 'custom-domain' | 'proxy';

function endpointForMode(mode: Mode, customDomain: string, proxyUrl: string): string {
  switch (mode) {
    case 'direct':
      return DEFAULT_ENDPOINT;
    case 'custom-domain':
      return customDomain || DEFAULT_ENDPOINT;
    case 'proxy':
      return proxyUrl || DEFAULT_ENDPOINT;
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode>('direct');
  const [customDomain, setCustomDomain] = useState('https://attest.yourdomain.com');
  const [proxyUrl, setProxyUrl] = useState('https://api.yourdomain.com/rh');
  const [modalOpen, setModalOpen] = useState(false);

  const endpoint = useMemo(
    () => endpointForMode(mode, customDomain, proxyUrl),
    [mode, customDomain, proxyUrl],
  );

  const client = useMemo(
    () => getOrCreateSharedClient({ apiKey: APP_ID, endpoint }),
    [endpoint],
  );

  const { verify, loading, error, result } = useVerifyDevice({
    action: 'signup',
    client,
  });
  const posture = useDevicePosture(result);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={['#0B0F0E', '#0E1A17', '#0B0F0E']}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.headerRow}>
        <Text style={styles.title}>Root Herald</Text>
        <Pressable
          accessibilityLabel="Configure endpoint"
          onPress={() => setModalOpen(true)}
          style={styles.gearButton}
        >
          <Text style={styles.gearIcon}>{'⚙'}</Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle}>Verify this device before continuing.</Text>

      <Pressable
        onPress={() => {
          void verify();
        }}
        disabled={loading}
        style={({ pressed }) => [
          styles.bigButton,
          loading && styles.bigButtonDisabled,
          pressed && !loading && styles.bigButtonPressed,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#0B0F0E" />
        ) : (
          <Text style={styles.bigButtonLabel}>
            {result?.verdict === 'allow' ? 'Continue' : 'Verify device'}
          </Text>
        )}
      </Pressable>

      {result && (
        <View style={styles.resultCard}>
          <Row label="Verdict" value={result.verdict.toUpperCase()} accent={verdictColor(result.verdict)} />
          <Row label="Device" value={result.deviceId || '—'} />
          <Row label="TPM class" value={posture?.tpmClass || result.tpmClass || '—'} />
          <Row label="Reason" value={result.reason || '—'} />
        </View>
      )}

      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Verification failed</Text>
          <Text style={styles.errorBody}>{error.message}</Text>
        </View>
      )}

      <Modal visible={modalOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Endpoint</Text>
            {(['direct', 'custom-domain', 'proxy'] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[styles.modeRow, mode === m && styles.modeRowActive]}
              >
                <Text style={styles.modeLabel}>
                  {m === 'direct' && 'Direct (rootherald.io)'}
                  {m === 'custom-domain' && 'Custom domain'}
                  {m === 'proxy' && 'Reverse proxy'}
                </Text>
                {mode === m && <Text style={styles.modeCheck}>{'✓'}</Text>}
              </Pressable>
            ))}

            {mode === 'custom-domain' && (
              <TextInput
                value={customDomain}
                onChangeText={setCustomDomain}
                style={styles.input}
                placeholder="https://attest.yourdomain.com"
                placeholderTextColor="#5A6A66"
                autoCapitalize="none"
              />
            )}
            {mode === 'proxy' && (
              <TextInput
                value={proxyUrl}
                onChangeText={setProxyUrl}
                style={styles.input}
                placeholder="https://api.yourdomain.com/rh"
                placeholderTextColor="#5A6A66"
                autoCapitalize="none"
              />
            )}

            <Pressable style={styles.modalDone} onPress={() => setModalOpen(false)}>
              <Text style={styles.modalDoneLabel}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, accent ? { color: accent } : undefined]}>{value}</Text>
    </View>
  );
}

function verdictColor(v: string): string {
  if (v === 'allow') return '#7CF0C3';
  if (v === 'warn') return '#F0CE7C';
  return '#F07C95';
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 72, paddingHorizontal: 24, backgroundColor: '#0B0F0E' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: { color: '#E6F4EE', fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: '#9BB1AB', fontSize: 16, marginBottom: 40 },
  gearButton: { padding: 8 },
  gearIcon: { color: '#7CF0C3', fontSize: 22 },
  bigButton: {
    backgroundColor: '#7CF0C3',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#7CF0C3',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  bigButtonDisabled: { backgroundColor: '#3F5A53' },
  bigButtonPressed: { transform: [{ scale: 0.98 }] },
  bigButtonLabel: { color: '#0B0F0E', fontSize: 17, fontWeight: '700' },
  resultCard: {
    marginTop: 28,
    backgroundColor: '#0E1A17',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1C2E2A',
    padding: 16,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { color: '#7E938E', fontSize: 13 },
  rowValue: { color: '#E6F4EE', fontSize: 14, fontFamily: 'Menlo' },
  errorCard: {
    marginTop: 16,
    padding: 14,
    backgroundColor: '#2A1416',
    borderColor: '#5A2229',
    borderWidth: 1,
    borderRadius: 12,
  },
  errorTitle: { color: '#F07C95', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  errorBody: { color: '#E6F4EE', fontSize: 13 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#0E1A17',
    paddingTop: 20,
    paddingBottom: 48,
    paddingHorizontal: 24,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalTitle: { color: '#E6F4EE', fontSize: 18, fontWeight: '700', marginBottom: 16 },
  modeRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modeRowActive: { backgroundColor: '#162722' },
  modeLabel: { color: '#E6F4EE', fontSize: 15 },
  modeCheck: { color: '#7CF0C3', fontSize: 18 },
  input: {
    marginTop: 8,
    backgroundColor: '#0B0F0E',
    color: '#E6F4EE',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1C2E2A',
  },
  modalDone: {
    marginTop: 20,
    backgroundColor: '#7CF0C3',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalDoneLabel: { color: '#0B0F0E', fontWeight: '700', fontSize: 15 },
});
