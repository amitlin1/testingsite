/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL?: string;
      DB_HOST?: string;
      DB_PORT?: string;
      DB_USER?: string;
      DB_PASSWORD?: string;
      DB_NAME?: string;
      DB_SSL?: string;
      NEXTAUTH_SECRET?: string;
      JWT_SECRET?: string;
    }
  }
}

/**
 * Server-side runtime configuration.
 */

export const config = {
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    name: process.env.DB_NAME || "postgres",
    ssl: process.env.DB_SSL === "true",
    connectionString: process.env.DATABASE_URL,
  },
  auth: {
    secret: process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || "fallback-secret-dev-only",
  },
  app: {
    isProduction: process.env.NODE_ENV === "production",
    isDevelopment: process.env.NODE_ENV !== "production",
  },
};

// Legacy support if needed, but try to move to `config` object
export const databaseConfig = config.db;
export const authConfig = config.auth;
export const appConfig = config.app;
