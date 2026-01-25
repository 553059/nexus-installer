
export interface DeviceStatus {
  batteryLevel: number;
  isCharging: boolean;
  latitude: number | null;
  longitude: number | null;
  orientation: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  };
  motion: {
    acceleration: {
      x: number | null;
      y: number | null;
      z: number | null;
    };
    rotationRate: {
      alpha: number | null;
      beta: number | null;
      gamma: number | null;
    };
  };
  lastAction: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export enum NexusActionType {
  VIBRATE = 'vibrate',
  LOCATE = 'locate',
  NOTIFY = 'notify',
  SHARE = 'share',
  DIAGNOSTICS = 'diagnostics'
}
