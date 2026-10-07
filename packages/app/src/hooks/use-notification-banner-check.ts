import { useSyncExternalStore } from "react";
import {
  getBannerCheck,
  subscribeToBannerCheck,
  type BannerCheckState,
} from "@/utils/woowtech-notification-banner-check";

export function useNotificationBannerCheck(): BannerCheckState {
  return useSyncExternalStore(subscribeToBannerCheck, getBannerCheck, getBannerCheck);
}
