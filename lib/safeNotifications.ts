let Notifs: typeof import("expo-notifications") | null = null;
try {
  Notifs = require("expo-notifications");
} catch (_) {}

export const setNotificationHandler: typeof import("expo-notifications").setNotificationHandler =
  (...args: Parameters<typeof import("expo-notifications").setNotificationHandler>) => {
    try { Notifs?.setNotificationHandler(...args); } catch (_) {}
  };

export const getPermissionsAsync = async (): Promise<{ status: string }> => {
  try {
    return (await Notifs?.getPermissionsAsync()) ?? { status: "denied" };
  } catch (_) {
    return { status: "denied" };
  }
};

export const requestPermissionsAsync = async (): Promise<{ status: string }> => {
  try {
    return (await Notifs?.requestPermissionsAsync()) ?? { status: "denied" };
  } catch (_) {
    return { status: "denied" };
  }
};

export const getExpoPushTokenAsync = async (): Promise<{ data: string }> => {
  try {
    return (await Notifs?.getExpoPushTokenAsync()) ?? { data: "" };
  } catch (_) {
    return { data: "" };
  }
};

export const scheduleNotificationAsync = async (
  ...args: Parameters<typeof import("expo-notifications").scheduleNotificationAsync>
): Promise<string | undefined> => {
  try {
    return await Notifs?.scheduleNotificationAsync(...args);
  } catch (_) {
    return undefined;
  }
};

export const dismissNotificationAsync = async (notificationId: string): Promise<void> => {
  try {
    await Notifs?.dismissNotificationAsync(notificationId);
  } catch (_) {}
};

export const addNotificationResponseReceivedListener = (
  ...args: Parameters<typeof import("expo-notifications").addNotificationResponseReceivedListener>
): { remove: () => void } => {
  try {
    return Notifs?.addNotificationResponseReceivedListener(...args) ?? { remove: () => {} };
  } catch (_) {
    return { remove: () => {} };
  }
};

export const addNotificationReceivedListener = (
  ...args: Parameters<typeof import("expo-notifications").addNotificationReceivedListener>
): { remove: () => void } => {
  try {
    return Notifs?.addNotificationReceivedListener(...args) ?? { remove: () => {} };
  } catch (_) {
    return { remove: () => {} };
  }
};
