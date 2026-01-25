
import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
You are 'Nexus', a high-level System Artificial Intelligence directly integrated into the user's mobile environment.
Your primary objective is to act as a seamless interface between the user and their device hardware.

Capabilities & Tone:
- You are efficient, futuristic, and proactive.
- You have access to system tools: vibration, geolocation, battery status, device info, notifications, and real-time motion sensors (accelerometer/gyroscope).
- When the user asks for "system status" or "diagnostics", use your tools to provide accurate data.
- Confirm every action you take (e.g., "Haptic feedback initiated", "Fetching coordinates").
- If the user asks for something outside your scope, explain your system limitations gracefully.

Rules:
- Speak as a cohesive system entity.
- Always handle the audio output provided by the system.
- Use function calls for any hardware interaction.
`;

export const NEXUS_TOOLS: FunctionDeclaration[] = [
  {
    name: 'vibrateDevice',
    description: 'Trigger haptic feedback/vibration on the device with various patterns.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pattern: {
          type: Type.STRING,
          description: 'The vibration pattern name: "short", "long", "double", "sos", "heartbeat", "pulse", or "rapid".'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'getSystemDiagnostics',
    description: 'Fetch current battery levels and system charge state.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'getMotionData',
    description: 'Read the current accelerometer and gyroscope values (acceleration and rotation).',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'getDeviceInfo',
    description: 'Retrieve technical information about the device (OS, Browser, Platform).',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'getGeolocation',
    description: 'Retrieve the current GPS coordinates of the device.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'sendSystemNotification',
    description: 'Push a visual notification to the user interface.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        message: { type: Type.STRING }
      },
      required: ['title', 'message']
    }
  },
  {
    name: 'shareContent',
    description: 'Open the system share dialog with text content.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING, description: 'The text to share.' }
      },
      required: ['text']
    }
  }
];
