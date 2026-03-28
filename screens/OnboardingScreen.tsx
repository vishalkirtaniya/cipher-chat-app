import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types/index";
import { createIdentity } from "../lib/identity";
import { initDatabase } from "../lib/storage";
import { useChatStore } from "../store/chatStore";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "Onboarding">;
};

export default function OnboardingScreen({ navigation }: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const { init, setIdentity } = useChatStore();

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      Alert.alert("Name too short", "Please enter at least 2 characters.");
      return;
    }

    setLoading(true);
    try {
      await initDatabase();
      const identity = await createIdentity(trimmed);
      setIdentity(identity);
      await init();
      navigation.replace("Home");
    } catch (err) {
      Alert.alert("Error", "Failed to create identity. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.inner}
      >
        {/* Icon */}
        <View style={styles.iconWrapper}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>🔒</Text>
          </View>
        </View>

        <Text style={styles.title}>CipherChat</Text>
        <Text style={styles.subtitle}>
          End-to-end encrypted messaging.{"\n"}No cloud. No servers storing your
          messages.
        </Text>

        <View style={styles.features}>
          {[
            ["🔑", "Keys never leave your device"],
            ["💾", "Messages stored locally in SQLite"],
            ["📡", "Server only routes encrypted data"],
          ].map(([icon, text]) => (
            <View key={text} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{icon}</Text>
              <Text style={styles.featureText}>{text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.label}>Your display name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Alice"
          placeholderTextColor="#666"
          value={name}
          onChangeText={setName}
          maxLength={32}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleCreate}
        />

        <TouchableOpacity
          style={[
            styles.button,
            (!name.trim() || loading) && styles.buttonDisabled,
          ]}
          onPress={handleCreate}
          disabled={!name.trim() || loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              Create identity & start chatting
            </Text>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Your identity is a random ID + a cryptographic keypair.{"\n"}
          No email, no phone number, no account.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f14" },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: "center" },
  iconWrapper: { alignItems: "center", marginBottom: 20 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#1e1e2e",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#6366f133",
  },
  iconText: { fontSize: 32 },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: "#f0f0f5",
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: "#8888aa",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  features: { marginBottom: 32 },
  featureRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  featureIcon: { fontSize: 16, marginRight: 10, width: 24 },
  featureText: { fontSize: 14, color: "#aaaacc" },
  label: { fontSize: 13, color: "#8888aa", marginBottom: 8, fontWeight: "500" },
  input: {
    backgroundColor: "#1e1e2e",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: "#f0f0f5",
    borderWidth: 1,
    borderColor: "#6366f133",
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  disclaimer: {
    fontSize: 12,
    color: "#55556a",
    textAlign: "center",
    marginTop: 20,
    lineHeight: 18,
  },
});
