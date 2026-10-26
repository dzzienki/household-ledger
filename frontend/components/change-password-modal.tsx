import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, getErrorMessage } from '@/lib/api';
import { notify } from '@/lib/dialog';

interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ visible, onClose }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function resetForm() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrorMessage(null);
    setLoading(false);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit() {
    setErrorMessage(null);

    if (!currentPassword) {
      setErrorMessage('현재 비밀번호를 입력해 주세요.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMessage('새 비밀번호는 최소 8자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('새 비밀번호와 확인 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (currentPassword === newPassword) {
      setErrorMessage('새 비밀번호는 현재 비밀번호와 달라야 합니다.');
      return;
    }

    try {
      setLoading(true);
      await api('/api/auth/change-password', {
        method: 'POST',
        body: {
          current_password: currentPassword,
          new_password: newPassword,
        },
      });
      notify('성공', '비밀번호가 안전하게 변경되었습니다.');
      handleClose();
    } catch (err) {
      setErrorMessage(getErrorMessage(err, '비밀번호 변경에 실패했습니다.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>비밀번호 변경</Text>
          <Text style={styles.subtitle}>
            보안을 위해 8자 이상의 새 비밀번호를 설정하세요.
          </Text>

          {errorMessage && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <Text style={styles.label}>현재 비밀번호</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="현재 비밀번호를 입력하세요"
            placeholderTextColor="#9CA3AF"
            value={currentPassword}
            onChangeText={(text) => {
              setCurrentPassword(text);
              if (errorMessage) setErrorMessage(null);
            }}
            editable={!loading}
          />

          <Text style={styles.label}>새 비밀번호</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="새 비밀번호 (8자 이상)"
            placeholderTextColor="#9CA3AF"
            value={newPassword}
            onChangeText={(text) => {
              setNewPassword(text);
              if (errorMessage) setErrorMessage(null);
            }}
            editable={!loading}
          />

          <Text style={styles.label}>새 비밀번호 확인</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="새 비밀번호 다시 입력"
            placeholderTextColor="#9CA3AF"
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              if (errorMessage) setErrorMessage(null);
            }}
            editable={!loading}
          />

          <View style={styles.actions}>
            <Pressable
              style={[styles.button, styles.cancelButton]}
              onPress={handleClose}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>취소</Text>
            </Pressable>

            <Pressable
              style={[styles.button, styles.submitButton, loading && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>변경하기</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    ...Platform.select({
      web: {
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
      },
      default: {
        elevation: 6,
      },
    }),
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 16,
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    marginBottom: 14,
    backgroundColor: '#F9FAFB',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#F3F4F6',
  },
  cancelButtonText: {
    color: '#4B5563',
    fontWeight: '600',
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: '#2563EB',
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
