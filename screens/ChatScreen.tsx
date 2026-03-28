import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActionSheetIOS,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList, Message } from "../types";
import { useChatStore } from "../store/chatStore";
import { getInitials } from "../lib/identity";
import { useFocusEffect } from "@react-navigation/native";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "Chat">;
  route: RouteProp<RootStackParamList, "Chat">;
};

// Disappearing message options
const TTL_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "30 seconds", value: 30_000 },
  { label: "5 minutes", value: 300_000 },
  { label: "1 hour", value: 3_600_000 },
  { label: "24 hours", value: 86_400_000 },
  { label: "7 days", value: 604_800_000 },
];

export default function ChatScreen({ navigation, route }: Props) {
  const { contactUserId } = route.params;
  const {
    identity,
    contacts,
    messages,
    typingUsers,
    loadMessages,
    sendMessage,
    deleteMessage,
    markConversationRead,
    setTyping,
    setActiveConversation,
  } = useChatStore();

  const contact = contacts.get(contactUserId);

  const conversationId = [identity?.userId, contactUserId].sort().join("__");

  // ✅ NOW it's safe to use
  useFocusEffect(
    useCallback(() => {
      setActiveConversation(conversationId);
      return () => setActiveConversation(null);
    }, [conversationId]),
  );
  const convMessages = messages.get(conversationId) || [];

  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [ttl, setTtl] = useState(0);
  const [showTtlPicker, setShowTtlPicker] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isContactTyping = typingUsers.has(contactUserId);

  useEffect(() => {
    loadMessages(conversationId);
    markConversationRead(conversationId, contactUserId);
    navigation.setOptions({ title: contact?.displayName || "Chat" });
  }, [conversationId]);

  // Update nav title when contact data loads
  useEffect(() => {
    if (contact) {
      navigation.setOptions({
        headerTitle: () => (
          <View style={styles.navTitle}>
            <Text style={styles.navName}>{contact.displayName}</Text>
            <Text style={styles.navSub}>
              {contact.isOnline ? "● online" : "offline"}
            </Text>
          </View>
        ),
      });
    }
  }, [contact?.displayName, contact?.isOnline]);

  const handleSend = useCallback(async () => {
    const body = inputText.trim();
    if (!body || sending) return;

    setInputText("");
    setSending(true);
    setTyping(contactUserId, false);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

    try {
      await sendMessage(contactUserId, body, ttl);
    } catch (err) {
      Alert.alert("Failed to send", "Message could not be encrypted or sent.");
      console.error(err);
    } finally {
      setSending(false);
    }
  }, [inputText, sending, ttl, contactUserId]);

  const handleTyping = (text: string) => {
    setInputText(text);
    setTyping(contactUserId, true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(
      () => setTyping(contactUserId, false),
      2000,
    );
  };

  const handleLongPress = (msg: Message) => {
    setSelectedMsg(msg);
  };

  const handleDeleteMessage = async () => {
    if (!selectedMsg) return;
    Alert.alert("Delete message", "Delete for everyone?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteMessage(selectedMsg.id, conversationId, contactUserId);
          setSelectedMsg(null);
        },
      },
    ]);
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.fromUserId === identity?.userId;

    if (item.isDeleted) {
      return (
        <View
          style={[
            styles.msgRow,
            isMine ? styles.msgRowRight : styles.msgRowLeft,
          ]}
        >
          <View style={[styles.bubble, styles.deletedBubble]}>
            <Text style={styles.deletedText}>🚫 Message deleted</Text>
          </View>
        </View>
      );
    }

    return (
      <TouchableOpacity
        onLongPress={() => isMine && handleLongPress(item)}
        delayLongPress={400}
        activeOpacity={0.85}
        style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}
      >
        <View
          style={[
            styles.bubble,
            isMine ? styles.bubbleMine : styles.bubbleTheirs,
          ]}
        >
          {item.ttl > 0 && (
            <Text style={styles.timerBadge}>⏱ {formatTtl(item.ttl)}</Text>
          )}
          <Text
            style={[
              styles.msgText,
              isMine ? styles.msgTextMine : styles.msgTextTheirs,
            ]}
          >
            {item.body}
          </Text>
          <View style={styles.msgMeta}>
            <Text style={styles.msgTime}>{formatMsgTime(item.timestamp)}</Text>
            {isMine && (
              <Text style={styles.statusIcon}>{statusIcon(item.status)}</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderDateSeparator = (timestamp: number) => (
    <View style={styles.dateSep}>
      <Text style={styles.dateSepText}>{formatDate(timestamp)}</Text>
    </View>
  );

  // Interleave date separators
  const messagesWithDates = React.useMemo(() => {
    const sorted = [...convMessages].sort((a, b) => a.timestamp - b.timestamp);
    const result: Array<Message | { type: "date"; timestamp: number }> = [];
    let lastDate = "";
    for (const msg of sorted) {
      const date = new Date(msg.timestamp).toDateString();
      if (date !== lastDate) {
        result.push({ type: "date", timestamp: msg.timestamp });
        lastDate = date;
      }
      result.push(msg);
    }
    return result.reverse();
  }, [convMessages]);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messagesWithDates}
          keyExtractor={(item: any) => item.id || `date_${item.timestamp}`}
          renderItem={({ item }: { item: any }) =>
            item.type === "date"
              ? renderDateSeparator(item.timestamp)
              : renderMessage({ item })
          }
          inverted
          contentContainerStyle={styles.messageList}
          ListHeaderComponent={
            isContactTyping ? (
              <View style={styles.typingRow}>
                <View style={styles.typingBubble}>
                  <Text style={styles.typingText}>typing…</Text>
                </View>
              </View>
            ) : null
          }
        />

        {/* Input bar */}
        <View style={styles.inputBar}>
          {/* Disappearing timer toggle */}
          <TouchableOpacity
            style={styles.timerBtn}
            onPress={() => setShowTtlPicker(true)}
          >
            <Text
              style={[styles.timerBtnIcon, ttl > 0 && styles.timerBtnActive]}
            >
              ⏱
            </Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor="#55556a"
            value={inputText}
            onChangeText={handleTyping}
            multiline
            maxLength={4000}
            returnKeyType="default"
          />

          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!inputText.trim() || sending) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            <Text style={styles.sendBtnIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* TTL picker modal */}
      <Modal visible={showTtlPicker} transparent animationType="slide">
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowTtlPicker(false)}
        >
          <View style={styles.ttlSheet}>
            <Text style={styles.ttlTitle}>Disappearing messages</Text>
            {TTL_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={styles.ttlOption}
                onPress={() => {
                  setTtl(opt.value);
                  setShowTtlPicker(false);
                }}
              >
                <Text style={styles.ttlLabel}>{opt.label}</Text>
                {ttl === opt.value && <Text style={styles.ttlCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Long-press action modal */}
      <Modal visible={!!selectedMsg} transparent animationType="fade">
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSelectedMsg(null)}
        >
          <View style={styles.actionSheet}>
            <Text style={styles.actionPreview} numberOfLines={2}>
              {selectedMsg?.body}
            </Text>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleDeleteMessage}
            >
              <Text style={styles.actionBtnDanger}>Delete message</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setSelectedMsg(null)}
            >
              <Text style={styles.actionBtnCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function statusIcon(status: string): string {
  switch (status) {
    case "sending":
      return "○";
    case "server_received":
      return "✓";
    case "delivered":
      return "✓✓";
    case "read":
      return "✓✓"; // tinted blue in practice
    case "failed":
      return "✗";
    default:
      return "";
  }
}

function formatMsgTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTtl(ms: number): string {
  if (ms < 60_000) return `${ms / 1000}s`;
  if (ms < 3_600_000) return `${ms / 60_000}m`;
  if (ms < 86_400_000) return `${ms / 3_600_000}h`;
  return `${ms / 86_400_000}d`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a10" },
  flex: { flex: 1 },
  navTitle: { alignItems: "center" },
  navName: { fontSize: 16, fontWeight: "600", color: "#f0f0f5" },
  navSub: { fontSize: 11, color: "#6666aa", marginTop: 1 },
  messageList: { paddingHorizontal: 14, paddingVertical: 12 },
  msgRow: { marginVertical: 3 },
  msgRowRight: { alignItems: "flex-end" },
  msgRowLeft: { alignItems: "flex-start" },
  bubble: {
    maxWidth: "78%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
  },
  bubbleMine: { backgroundColor: "#6366f1", borderColor: "#7577ff" },
  bubbleTheirs: { backgroundColor: "#1e1e2e", borderColor: "#2e2e42" },
  deletedBubble: { backgroundColor: "#1a1a24", borderColor: "#2a2a38" },
  deletedText: { fontSize: 13, color: "#55556a", fontStyle: "italic" },
  timerBadge: { fontSize: 10, color: "#ffffffaa", marginBottom: 3 },
  msgText: { fontSize: 15, lineHeight: 21 },
  msgTextMine: { color: "#ffffff" },
  msgTextTheirs: { color: "#e0e0f0" },
  msgMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 4,
    gap: 5,
  },
  msgTime: { fontSize: 10, color: "#ffffff66" },
  statusIcon: { fontSize: 11, color: "#ffffff88" },
  typingRow: { alignItems: "flex-start", marginBottom: 8 },
  typingBubble: {
    backgroundColor: "#1e1e2e",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  typingText: { color: "#6666aa", fontSize: 14, fontStyle: "italic" },
  dateSep: { alignItems: "center", marginVertical: 12 },
  dateSepText: {
    fontSize: 12,
    color: "#55556a",
    backgroundColor: "#0a0a10",
    paddingHorizontal: 10,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#0f0f14",
    borderTopWidth: 1,
    borderTopColor: "#1e1e2e",
    gap: 8,
  },
  timerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1e1e2e",
    justifyContent: "center",
    alignItems: "center",
  },
  timerBtnIcon: { fontSize: 16, color: "#55556a" },
  timerBtnActive: { color: "#f59e0b" },
  input: {
    flex: 1,
    backgroundColor: "#1e1e2e",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: "#f0f0f5",
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#6366f1",
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendBtnIcon: { color: "#fff", fontSize: 18, fontWeight: "700" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "#00000088",
    justifyContent: "flex-end",
  },
  ttlSheet: {
    backgroundColor: "#1e1e2e",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  ttlTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#f0f0f5",
    marginBottom: 16,
    textAlign: "center",
  },
  ttlOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#2e2e42",
  },
  ttlLabel: { fontSize: 16, color: "#e0e0f0" },
  ttlCheck: { fontSize: 16, color: "#6366f1" },
  actionSheet: {
    backgroundColor: "#1e1e2e",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  actionPreview: {
    fontSize: 13,
    color: "#6666aa",
    marginBottom: 16,
    fontStyle: "italic",
    textAlign: "center",
  },
  actionBtn: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#2e2e42",
  },
  actionBtnDanger: { fontSize: 16, color: "#f43f5e", textAlign: "center" },
  actionBtnCancel: { fontSize: 16, color: "#8888aa", textAlign: "center" },
});
