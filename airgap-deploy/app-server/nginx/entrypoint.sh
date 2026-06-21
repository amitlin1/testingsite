#!/bin/sh
# ===========================================
# Nginx Entrypoint - Generates runtime config.js
# ===========================================
# This script runs at container startup and generates /usr/share/nginx/html/config.js
# from environment variables, allowing client-side config changes without rebuild.

set -e

# Default values
APP_BASE_URL="${APP_BASE_URL:-}"
APP_VERSION="${APP_VERSION:-1.0.0}"
FEATURE_FLAGS="${FEATURE_FLAGS:-{}}"

# Generate config.js with runtime values
cat > /usr/share/nginx/html/config.js << EOF
// Runtime configuration - generated at container startup
// DO NOT EDIT - changes here will be lost on container restart
// To change values, update .env.prod and restart the container
window.__RUNTIME_CONFIG__ = {
  apiBaseUrl: "${APP_BASE_URL}",
  appVersion: "${APP_VERSION}",
  features: ${FEATURE_FLAGS}
};
EOF

echo "Generated /usr/share/nginx/html/config.js with:"
echo "  APP_BASE_URL: ${APP_BASE_URL}"
echo "  APP_VERSION: ${APP_VERSION}"

# Execute the main command (nginx)
exec "$@"
