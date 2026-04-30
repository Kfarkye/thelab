import { GoogleGenAI } from "@google/genai";
import { requireEnv } from "@/lib/env";

let cachedClient: GoogleGenAI | null = null;

export function getGoogleGenAI(): GoogleGenAI {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = new GoogleGenAI({
    vertexai: true,
    project: requireEnv("GOOGLE_CLOUD_PROJECT"),
    location: requireEnv("GOOGLE_CLOUD_LOCATION"),
  });
  return cachedClient;
}

export function getGeminiModelName(envName: string, fallback: string): string {
  const value = process.env[envName];
  if (value && value.trim()) {
    return value.trim();
  }
  return fallback;
}

