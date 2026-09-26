import { describe, expect, it } from "vitest";
import {
  disableIosExpoRegistration,
  type ExpoServerRegistration,
} from "./woowtech-expo-registration";

// Expo's JS API accepts null, but its iOS Swift bridge only accepts String.
class IosRegistration implements ExpoServerRegistration {
  private value = '{"isEnabled":true}';

  async setRegistrationInfoAsync(value: string | null): Promise<void> {
    if (typeof value !== "string") {
      throw new TypeError("The 1st argument cannot be cast to type String");
    }
    this.value = value;
  }

  async getRegistrationInfoAsync(): Promise<string> {
    return this.value;
  }
}

describe("iOS Expo server registration", () => {
  it("persists disabled registration through the native String boundary", async () => {
    const registration = new IosRegistration();
    await disableIosExpoRegistration(registration);
    expect(await registration.getRegistrationInfoAsync()).toBe('{"isEnabled":false}');
  });
});
