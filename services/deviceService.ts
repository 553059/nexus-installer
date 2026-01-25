
import { DeviceStatus } from '../types';

export const getBatteryInfo = async () => {
  if ('getBattery' in navigator) {
    const battery: any = await (navigator as any).getBattery();
    return {
      level: Math.round(battery.level * 100),
      charging: battery.charging
    };
  }
  return { level: 0, charging: false };
};

export const getDeviceInfo = () => {
  const ua = navigator.userAgent;
  let os = "Unknown OS";
  if (ua.indexOf("Win") !== -1) os = "Windows";
  if (ua.indexOf("Mac") !== -1) os = "macOS";
  if (ua.indexOf("Linux") !== -1) os = "Linux";
  if (ua.indexOf("Android") !== -1) os = "Android";
  if (ua.indexOf("like Mac") !== -1) os = "iOS";

  return {
    platform: (navigator as any).platform || "Unknown",
    userAgent: ua,
    os: os,
    language: navigator.language,
    memory: (navigator as any).deviceMemory ? `${(navigator as any).deviceMemory}GB` : "N/A",
    cores: navigator.hardwareConcurrency || "N/A"
  };
};

export const getPosition = (): Promise<{lat: number, lng: number}> => {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true }
    );
  });
};

export const triggerVibration = (pattern: string) => {
  if (!('vibrate' in navigator)) return false;

  const patterns: Record<string, number | number[]> = {
    short: 100,
    long: 500,
    double: [100, 50, 100],
    sos: [100, 100, 100, 300, 100, 300, 100, 300, 100, 100, 100],
    heartbeat: [100, 100, 400, 100, 100],
    pulse: [500, 200, 500],
    rapid: [50, 50, 50, 50, 50, 50, 50, 50]
  };

  const vPattern = patterns[pattern.toLowerCase()] || 200;
  navigator.vibrate(vPattern);
  return true;
};

export const shareText = async (text: string) => {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
};
