import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Clipboard from "@react-native-clipboard/clipboard";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types/index";
import { useChatStore } from "../store/chatStore";
import { updateDisplayName } from "../lib/identity";
import { clearSecretCache } from "../lib/crypto";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "Settings">;
};

export default function SettingsScreen({ navigation }: Props) {
  const { identity, setIdentity } = useChatStore();
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(identity?.displayName || "");

  const handleSaveName = async () => {
    const trimmed = newName.trim();
    if (trimmed.length < 2) {
      Alert.alert("Too short", "Display name must be at least 2 characters.");
      return;
    }
    await updateDisplayName(trimmed);
    setIdentity({ ...identity!, displayName: trimmed });
    setEditingName(false);
  };

  const handleCopyUserId = () => {
    Clipboard.setString(identity?.userId || "");
    Alert.alert("Copied", "User ID copied to clipboard.");
  };

  const handleCopyPublicKey = () => {
    Clipboard.setString(identity?.publicKeyBase64 || "");
    Alert.alert("Copied", "Public key copied to clipboard.");
  };

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Identity card */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your identity</Text>

          {/* Display name */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>Display name</Text>
              {editingName ? (
                <TextInput
                  style={styles.nameInput}
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                  maxLength={32}
                />
              ) : (
                <Text style={styles.rowValue}>{identity?.displayName}</Text>
              )}
            </View>
            {editingName ? (
              <View style={styles.editBtns}>
                <TouchableOpacity onPress={handleSaveName}>
                  <Text style={styles.saveTxt}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setEditingName(false)}>
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setEditingName(true)}>
                <Text style={styles.editTxt}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* User ID */}
          <TouchableOpacity style={styles.row} onPress={handleCopyUserId}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>User ID</Text>
              <Text style={styles.rowMono} numberOfLines={1}>
                {identity?.userId}
              </Text>
            </View>
            <Text style={styles.copyTxt}>Copy</Text>
          </TouchableOpacity>

          {/* Public key */}
          <TouchableOpacity style={styles.row} onPress={handleCopyPublicKey}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowLabel}>Public key (share-safe)</Text>
              <Text style={styles.rowMono} numberOfLines={1}>
                {identity?.publicKeyBase64.slice(0, 32)}…
              </Text>
            </View>
            <Text style={styles.copyTxt}>Copy</Text>
          </TouchableOpacity>
        </View>

        {/* Security */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>
          <View style={styles.infoBox}>
            {[
              ["Encryption", "X25519 ECDH + XSalsa20-Poly1305"],
              ["Key storage", "Expo SecureStore (device keychain)"],
              ["Message storage", "SQLite on-device only"],
              ["Server role", "Route-only, no persistence"],
            ].map(([k, v]) => (
              <View key={k} style={styles.infoRow}>
                <Text style={styles.infoKey}>{k}</Text>
                <Text style={styles.infoVal}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Danger zone */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data</Text>
          <TouchableOpacity
            style={styles.dangerBtn}
            onPress={() =>
              Alert.alert(
                "Clear secret cache",
                "This clears in-memory shared secrets. They will be re-derived on next message. Useful for security testing.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear",
                    onPress: () => {
                      clearSecretCache();
                      Alert.alert("Done", "Cache cleared.");
                    },
                  },
                ],
              )
            }
          >
            <Text style={styles.dangerBtnText}>Clear in-memory key cache</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f14" },
  scroll: { padding: 20 },
  section: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#55556a",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1e1e2e",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#2e2e42",
  },
  rowLeft: { flex: 1, marginRight: 8 },
  rowLabel: {
    fontSize: 11,
    color: "#55556a",
    marginBottom: 3,
    fontWeight: "500",
  },
  rowValue: { fontSize: 15, color: "#f0f0f5" },
  rowMono: { fontSize: 13, color: "#d0d0f0", fontFamily: "monospace" },
  nameInput: {
    fontSize: 15,
    color: "#f0f0f5",
    borderBottomWidth: 1,
    borderBottomColor: "#6366f1",
    paddingVertical: 2,
  },
  editBtns: { flexDirection: "row", gap: 12 },
  editTxt: { color: "#6366f1", fontSize: 14, fontWeight: "600" },
  saveTxt: { color: "#22c55e", fontSize: 14, fontWeight: "600" },
  cancelTxt: { color: "#55556a", fontSize: 14 },
  copyTxt: { color: "#6366f1", fontSize: 13, fontWeight: "500" },
  infoBox: {
    backgroundColor: "#1e1e2e",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2e2e42",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a3a",
  },
  infoKey: { fontSize: 13, color: "#8888aa", flex: 1 },
  infoVal: { fontSize: 13, color: "#d0d0f0", flex: 1.5, textAlign: "right" },
  dangerBtn: {
    backgroundColor: "#2a1a1a",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#f43f5e33",
  },
  dangerBtnText: { color: "#f43f5e", fontSize: 15, fontWeight: "500" },
});
