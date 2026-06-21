"use client";

import { useState, useEffect } from "react";

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
export function useRuntimeConfig() {
  const [config, setConfig] = useState<RuntimeConfig>(defaultConfig);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Check if config is already available from script tag
    if (typeof window !== "undefined" && window.__RUNTIME_CONFIG__) {
      setConfig(window.__RUNTIME_CONFIG__);
      setIsLoaded(true);
      return;
    }

    // If not, the config.js script should set it
    // Wait a tick for the script to execute
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && window.__RUNTIME_CONFIG__) {
        setConfig(window.__RUNTIME_CONFIG__);
        setIsLoaded(true);
      } else {
        // Config script might not be present (e.g., dev mode)
        // Use defaults
        setIsLoaded(true);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

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
