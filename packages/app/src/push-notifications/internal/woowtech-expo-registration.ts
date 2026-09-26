export interface ExpoServerRegistration {
  setRegistrationInfoAsync(value: string | null): Promise<void>;
}

function loadRegistration(): ExpoServerRegistration {
  const { requireNativeModule }: typeof import("expo-modules-core") = require("expo-modules-core");
  return requireNativeModule<ExpoServerRegistration>("NotificationsServerRegistrationModule");
}

export async function disableIosExpoRegistration(
  registration: ExpoServerRegistration = loadRegistration(),
): Promise<void> {
  // Expo 0.32.16 passes null when disabling, but its iOS bridge requires String.
  // Both the startup reader and token listener treat isEnabled:false as disabled.
  await registration.setRegistrationInfoAsync(JSON.stringify({ isEnabled: false }));
}
