import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { wsClient, ConnectionState } from "../lib/websocket";

export default function ConnectionBadge() {
  const [state, setState] = useState<ConnectionState>(wsClient.connectionState);
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const unsub = wsClient.onStateChange(setState);
    return unsub;
  }, []);

  useEffect(() => {
    if (state === "connecting") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [state]);

  const config: Record<ConnectionState, { color: string; label: string }> = {
    connected: { color: "#22c55e", label: "Connected" },
    connecting: { color: "#f59e0b", label: "Connecting…" },
    disconnected: { color: "#f43f5e", label: "Offline" },
  };

  const { color, label } = config[state];

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.dot, { backgroundColor: color, opacity: pulseAnim }]}
      />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 11, fontWeight: "500" },
});
