import React, { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList, Conversation } from "../types";
import { useChatStore } from "../store/chatStore";
import { getInitials } from "../lib/identity";
import ConnectionBadge from "../components/ConnectionBadge";

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, "Home">;
};

export default function HomeScreen({ navigation }: Props) {
  const { conversations, contacts, loadConversations, identity } =
    useChatStore();

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, []),
  );

  const renderItem = ({ item }: { item: Conversation }) => {
    const contact = contacts.get(item.contactUserId);
    if (!contact) return null;

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() =>
          navigation.navigate("Chat", { contactUserId: item.contactUserId })
        }
        activeOpacity={0.7}
      >
        <View
          style={[
            styles.avatar,
            { backgroundColor: contact.avatarColor + "33" },
          ]}
        >
          <Text style={[styles.avatarText, { color: contact.avatarColor }]}>
            {getInitials(contact.displayName)}
          </Text>
          {contact.isOnline && <View style={styles.onlineDot} />}
        </View>

        <View style={styles.rowContent}>
          <View style={styles.rowTop}>
            <Text style={styles.contactName} numberOfLines={1}>
              {contact.displayName}
            </Text>
            {item.lastMessageAt > 0 && (
              <Text style={styles.time}>{formatTime(item.lastMessageAt)}</Text>
            )}
          </View>
          <View style={styles.rowBottom}>
            <Text style={styles.lockIcon}>🔒</Text>
            <Text style={styles.preview} numberOfLines={1}>
              {item.lastMessageBody || "Start a conversation"}
            </Text>
            {item.unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.unreadCount > 99 ? "99+" : item.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Chats</Text>
          {identity && (
            <Text style={styles.headerSub} numberOfLines={1}>
              {identity.displayName}
            </Text>
          )}
        </View>
        <View style={styles.headerRight}>
          <ConnectionBadge />
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => navigation.navigate("AddContact")}
          >
            <Text style={styles.iconBtnText}>＋</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => navigation.navigate("Settings")}
          >
            <Text style={styles.iconBtnText}>⚙</Text>
          </TouchableOpacity>
        </View>
      </View>

      {conversations.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyText}>
            Tap ＋ to share your contact code and start an encrypted chat
          </Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => navigation.navigate("AddContact")}
          >
            <Text style={styles.emptyBtnText}>Share my contact code</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const d = new Date(timestamp);
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 604_800_000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f0f14" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e1e2e",
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#f0f0f5" },
  headerSub: { fontSize: 12, color: "#5555aa", marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1e1e2e",
    justifyContent: "center",
    alignItems: "center",
  },
  iconBtnText: { color: "#8888ff", fontSize: 18 },
  list: { paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  avatarText: { fontSize: 16, fontWeight: "600" },
  onlineDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#22c55e",
    borderWidth: 2,
    borderColor: "#0f0f14",
  },
  rowContent: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  contactName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#f0f0f5",
    flex: 1,
    marginRight: 8,
  },
  time: { fontSize: 12, color: "#55556a" },
  rowBottom: { flexDirection: "row", alignItems: "center" },
  lockIcon: { fontSize: 10, marginRight: 4 },
  preview: { fontSize: 14, color: "#6666aa", flex: 1 },
  badge: {
    backgroundColor: "#6366f1",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 5,
    marginLeft: 8,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  separator: { height: 1, backgroundColor: "#1a1a24", marginLeft: 80 },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#f0f0f5",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: "#6666aa",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  emptyBtn: {
    backgroundColor: "#6366f1",
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  emptyBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
