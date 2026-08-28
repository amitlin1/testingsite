"use client";

import { useState, useEffect, useSyncExternalStore } from "react";

/**
 * Runtime configuration interface.
 * These values are loaded from /config.js served by nginx,
 * allowing configuration changes without rebuilding.
 */
export interface RuntimeConfig {
  /** Base URL for API calls from browser (e.g., https://app.example.com) */
  apiBaseUrl: string;
  /** Application version for cache busting */
  appVersion: string;
  /** Any custom feature flags */
  features: Record<string, boolean>;
}

// Default config if /config.js hasn't loaded
const defaultConfig: RuntimeConfig = {
  apiBaseUrl: "",
  appVersion: "1.0.0",
  features: {},
};

// Extend Window interface for TypeScript
declare global {
  interface Window {
    __RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

/**
 * Hook to access runtime configuration in client components.
 * 
 * The config is loaded from /config.js which nginx generates at startup
 * from environment variables. This allows changing client-visible config
 * without rebuilding the Next.js image.
 * 
 * Usage:
 * ```tsx
 * const { config, isLoaded } = useRuntimeConfig();
 * if (!isLoaded) return <Loading />;
 * const apiUrl = config.apiBaseUrl;
 * ```
 */
// window.__RUNTIME_CONFIG__ is written once by /config.js and never mutated,
// so the store never emits — subscribing is a no-op.
const subscribeToConfig = () => () => {};
const getServerConfigSnapshot = () => defaultConfig;

export function useRuntimeConfig() {
  // Reading through useSyncExternalStore keeps the server render on
  // defaultConfig while the client picks up the real values, with no
  // hydration mismatch and no setState during an effect.
  const config = useSyncExternalStore(subscribeToConfig, getRuntimeConfig, getServerConfigSnapshot);

  // The config script may still be executing; give it a tick before we tell
  // callers that what they're holding is final.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const isLoaded = config !== defaultConfig || timedOut;
  const error: Error | null = null;

  return { config, isLoaded, error };
}

/**
 * Get runtime config synchronously (returns default if not loaded).
 * Prefer useRuntimeConfig hook in React components.
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window !== "undefined" && window.__RUNTIME_CONFIG__) {
    return window.__RUNTIME_CONFIG__;
  }
  return defaultConfig;
}
