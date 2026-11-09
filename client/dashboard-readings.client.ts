import type { UsageProviderSnapshot, UsageReading } from "../shared/limits.shared";
export function dashboardReadings(provider: UsageProviderSnapshot): UsageReading[] {
  const antigravity = provider.providerId === "antigravity";
  return provider.readings.filter((reading) => {
    if (antigravity && reading.kind === "quota" && reading.unit !== "percent") return false;
    if (
      (provider.supportsBankedReset || antigravity || provider.providerId === "kimi") &&
      reading.kind === "quota"
    ) {
      return reading.percent !== null || reading.used !== null || reading.remaining !== null;
    }
    return true;
  });
}
