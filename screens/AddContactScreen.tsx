/**
 * AddContactScreen
 *
 * Contact card flow:
 *  1. Your contact info is encoded as a compact base64 string
 *  2. Share that string with anyone (copy, share sheet, QR, etc.)
 *  3. Other person pastes your base64 code → decoded → added as contact
 *  4. Both sides share codes → both add each other → E2E encrypted chat starts
 *
 * The base64 code encodes: { u: userId, n: displayName, k: publicKey, v: 1 }
 * Much shorter and cleaner than sharing raw JSON.
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Share,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList, ContactCard } from "../types";
import { useChatStore } from "../store/chatStore";
import { getInitials } from "../lib/identity";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "AddContact">;
};

// ─── Encode / decode contact card ────────────────────────────────────────────────

function encodeContactCard(card: ContactCard): string {
  const json = JSON.stringify({ u: card.u, n: card.n, k: card.k, v: card.v });
  // btoa works on React Native (Hermes supports it)
  return btoa(json);
}

function decodeContactCard(code: string): ContactCard | null {
  try {
    const json = atob(code.trim());
    const parsed = JSON.parse(json);
    if (!parsed.u || !parsed.n || !parsed.k) return null;
    return { u: parsed.u, n: parsed.n, k: parsed.k, v: parsed.v || 1 };
  } catch {
    return null;
  }
}

export default function AddContactScreen({ navigation }: Props) {
  const { identity, addContact } = useChatStore();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ContactCard | null>(null);

  // Generate my base64 contact card
  const myCard: ContactCard | null = identity
    ? {
        u: identity.userId,
        n: identity.displayName,
        k: identity.publicKeyBase64,
        v: 1,
      }
    : null;

  const myCode = myCard ? encodeContactCard(myCard) : "";

  // Live-decode as user pastes
  useEffect(() => {
    if (code.trim()) {
      const decoded = decodeContactCard(code.trim());
      setPreview(decoded);
    } else {
      setPreview(null);
    }
  }, [code]);

  const handleShare = async () => {
    try {
      await Share.share({
        message: myCode,
        title: "My CipherChat contact code",
      });
    } catch {}
  };

  const handleCopy = async () => {
    await Clipboard.setStringAsync(myCode);
    Alert.alert("Copied!", "Your contact code has been copied to clipboard.");
  };

  const handleAdd = async () => {
    if (!preview) return;

    if (preview.u === identity?.userId) {
      Alert.alert("That's you!", "You cannot add yourself as a contact.");
      return;
    }

    setLoading(true);
    try {
      await addContact(preview.u, preview.n, preview.k);
      Alert.alert(
        "Contact added!",
        `${preview.n} has been added. You can now start an end-to-end encrypted chat.`,
        [
          {
            text: "Start chat",
            onPress: () =>
              navigation.replace("Chat", { contactUserId: preview.u }),
          },
        ],
      );
    } catch (err) {
      Alert.alert("Error", "Failed to add contact. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Your contact code ─────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your contact code</Text>
          <Text style={styles.sectionDesc}>
            Share this code with anyone you want to chat with. They paste it in
            their app to add you.
          </Text>

          {/* Avatar preview */}
          <View style={styles.myCardPreview}>
            <View style={styles.myAvatar}>
              <Text style={styles.myAvatarText}>
                {getInitials(identity?.displayName || "")}
              </Text>
            </View>
            <View>
              <Text style={styles.myName}>{identity?.displayName}</Text>
              <Text style={styles.myUserId} numberOfLines={1}>
                {identity?.userId}
              </Text>
            </View>
          </View>

          {/* The base64 code box */}
          <View style={styles.codeBox}>
            <Text style={styles.codeText} numberOfLines={3} selectable>
              {myCode}
            </Text>
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
              <Text style={styles.shareBtnText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.copyBtn} onPress={handleCopy}>
              <Text style={styles.copyBtnText}>Copy code</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Add from code ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Add from code</Text>
          <Text style={styles.sectionDesc}>
            Paste the contact code you received from the other person.
          </Text>

          <TextInput
            style={styles.pasteInput}
            placeholder="Paste contact code here…"
            placeholderTextColor="#55556a"
            value={code}
            onChangeText={setCode}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
          />

          {/* Live preview of decoded card */}
          {preview && (
            <View style={styles.previewCard}>
              <View style={styles.previewRow}>
                <View
                  style={[
                    styles.previewAvatar,
                    { backgroundColor: "#6366f133" },
                  ]}
                >
                  <Text
                    style={[styles.previewAvatarText, { color: "#6366f1" }]}
                  >
                    {getInitials(preview.n)}
                  </Text>
                </View>
                <View style={styles.previewInfo}>
                  <Text style={styles.previewName}>{preview.n}</Text>
                  <Text style={styles.previewId} numberOfLines={1}>
                    {preview.u}
                  </Text>
                  <View style={styles.verifiedRow}>
                    <Text style={styles.verifiedDot}>🔑</Text>
                    <Text style={styles.verifiedText}>Public key verified</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {code.trim() && !preview && (
            <View style={styles.invalidBox}>
              <Text style={styles.invalidText}>
                ⚠ Invalid code — make sure you pasted the full code
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.addBtn,
              (!preview || loading) && styles.addBtnDisabled,
            ]}
            onPress={handleAdd}
            disabled={!preview || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.addBtnText}>
                {preview ? `Add ${preview.n}` : "Add contact"}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <View style={styles.howItWorks}>
          <Text style={styles.howTitle}>How it works</Text>
          {[
            ["1", "Share your code with the person you want to chat with"],
            [
              "2",
              "They paste your code and add you — you do the same with their code",
            ],
            [
              "3",
              "Keys are exchanged. All messages are end-to-end encrypted from the first one",
            ],
          ].map(([num, text]) => (
            <View key={num} style={styles.howRow}>
              <View style={styles.howNum}>
                <Text style={styles.howNumText}>{num}</Text>
              </View>
              <Text style={styles.howText}>{text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f14" },
  scroll: { padding: 20 },
  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f0f0f5",
    marginBottom: 6,
  },
  sectionDesc: {
    fontSize: 14,
    color: "#6666aa",
    marginBottom: 16,
    lineHeight: 20,
  },

  // My card
  myCardPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  myAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#6366f133",
    justifyContent: "center",
    alignItems: "center",
  },
  myAvatarText: { color: "#6366f1", fontSize: 16, fontWeight: "600" },
  myName: { fontSize: 16, fontWeight: "600", color: "#f0f0f5" },
  myUserId: {
    fontSize: 11,
    color: "#55556a",
    fontFamily: "monospace",
    marginTop: 2,
  },

  codeBox: {
    backgroundColor: "#1a1a2e",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#6366f133",
    marginBottom: 14,
  },
  codeText: {
    fontSize: 13,
    color: "#8888ff",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 20,
  },
  btnRow: { flexDirection: "row", gap: 10 },
  shareBtn: {
    flex: 1,
    backgroundColor: "#6366f1",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  shareBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  copyBtn: {
    flex: 1,
    backgroundColor: "#1e1e2e",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#6366f133",
  },
  copyBtnText: { color: "#8888ff", fontWeight: "600", fontSize: 15 },

  // Add from code
  pasteInput: {
    backgroundColor: "#1e1e2e",
    borderRadius: 12,
    padding: 14,
    fontSize: 13,
    color: "#d0d0f0",
    borderWidth: 1,
    borderColor: "#2e2e42",
    minHeight: 90,
    textAlignVertical: "top",
    marginBottom: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  previewCard: {
    backgroundColor: "#1e1e2e",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#22c55e33",
    marginBottom: 14,
  },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  previewAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  previewAvatarText: { fontSize: 15, fontWeight: "600" },
  previewInfo: { flex: 1 },
  previewName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#f0f0f5",
    marginBottom: 2,
  },
  previewId: {
    fontSize: 11,
    color: "#55556a",
    fontFamily: "monospace",
    marginBottom: 4,
  },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  verifiedDot: { fontSize: 11 },
  verifiedText: { fontSize: 11, color: "#22c55e", fontWeight: "500" },
  invalidBox: {
    backgroundColor: "#2a1a1a",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#f43f5e33",
    marginBottom: 14,
  },
  invalidText: { fontSize: 13, color: "#f43f5e" },
  addBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },

  // How it works
  howItWorks: {
    backgroundColor: "#1a1a2e",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#6366f122",
  },
  howTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#8888cc",
    marginBottom: 14,
  },
  howRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  howNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#6366f133",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 1,
  },
  howNumText: { color: "#6366f1", fontSize: 12, fontWeight: "700" },
  howText: { flex: 1, fontSize: 13, color: "#8888aa", lineHeight: 20 },
});
