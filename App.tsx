import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";

import { initDatabase } from "./lib/storage";
import { getIdentity } from "./lib/identity";
import { useChatStore } from "./store/chatStore";

import OnboardingScreen from "./screens/OnboardingScreen";
import HomeScreen from "./screens/HomeScreen";
import ChatScreen from "./screens/ChatScreen";
import AddContactScreen from "./screens/AddContactScreen";
import SettingsScreen from "./screens/SettingsScreen";

import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

const cipherTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#6366f1",
    background: "#0f0f14",
    card: "#0f0f14",
    text: "#f0f0f5",
    border: "#1e1e2e",
    notification: "#6366f1",
  },
};

export default function App() {
  const [loading, setLoading] = useState(true);
  const [hasIdentity, setHasIdentity] = useState(false);
  const { init, setIdentity } = useChatStore();

  useEffect(() => {
    (async () => {
      await Notifications.requestPermissionsAsync();
      await initDatabase();
      const identity = await getIdentity();
      if (identity) {
        setIdentity(identity);
        setHasIdentity(true);
        await init();
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as any;
        if (data?.contactUserId) {
          console.log("[notifications] Navigate to chat:", data.contactUserId);
        }
      },
    );
    return () => sub.remove();
  }, []);

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={cipherTheme}>
        <Stack.Navigator
          initialRouteName={hasIdentity ? "Home" : "Onboarding"}
          screenOptions={{
            headerStyle: { backgroundColor: "#0f0f14" },
            headerTintColor: "#f0f0f5",
            headerTitleStyle: { fontWeight: "600" },
            headerShadowVisible: false,
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Chat"
            component={ChatScreen}
            options={{ headerBackTitle: "Back" }}
          />
          <Stack.Screen
            name="AddContact"
            component={AddContactScreen}
            options={{ title: "Add contact", presentation: "modal" }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: "Settings", presentation: "modal" }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0f0f14",
  },
});
