# Node.js 24 LTS on Debian 13 (trixie). Pinned to LTS — 26 is current-release,
# not LTS until Oct 2026, and lacks better-sqlite3 prebuilds for slim images.
FROM node:24-trixie-slim

# Set working directory
WORKDIR /app

# Install runtime dependencies only (no build tools needed!)
# fonts-dejavu-core is required, not cosmetic: the slim image ships no fonts at
# all, and the librsvg inside sharp then renders every character of the map's
# OpenStreetMap attribution as a .notdef box. Attribution is mandatory under the
# OSM tile usage policy, so it has to be legible.
# apt-get upgrade is deliberate: the official node image trails Debian's security
# releases (perl-base was behind), so patches are applied on top of it.
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
    dumb-init \
    sqlite3 \
    gosu \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies - no compilation needed with native SQLite!
RUN npm ci --omit=dev && \
    npm cache clean --force

# npm is only needed to install dependencies. Its bundled modules (tar,
# brace-expansion, undici...) are the remaining scanner findings and the app
# never runs them, so drop npm/npx from the final image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Create non-root user for security
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home botuser

# Create data directory and set safe default ownership (will be enforced at container start)
RUN mkdir -p /app/data && \
    chown -R botuser:nodejs /app

# Copy application source code (excluding items in .dockerignore)
COPY --chown=botuser:nodejs src/ ./src/
COPY --chown=botuser:nodejs config/ ./config/
COPY --chown=botuser:nodejs utils/ ./utils/
COPY --chown=botuser:nodejs public/ ./public/

# Add entrypoint script that ensures data folder exists and is owned by botuser, then drops to botuser
RUN cat > /usr/local/bin/entrypoint.sh <<'EOF'
#!/bin/bash
set -e

# Ensure data directory exists and set proper ownership
mkdir -p /app/data
if ! chown -R botuser:nodejs /app/data; then
    echo "Warning: Could not set data directory ownership" >&2
fi

# Run database migration on startup
echo "Running database migration..."
if ! gosu botuser node src/database/migrate.js; then
    echo "Warning: Database migration failed" >&2
fi

# If first arg starts with '-' assume it's flags for the app
if [ "${1#-}" != "$1" ]; then
  set -- node src/index.js "$@"
fi

# Exec the given command as botuser
exec gosu botuser "$@"
EOF

RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose the port the app runs on
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/entrypoint.sh"]

# Start the application
CMD ["node", "src/index.js"]
