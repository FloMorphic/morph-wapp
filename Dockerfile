# syntax=docker/dockerfile:1
#
# FloMorphic canvas image — the built SPA on nginx, with the API in front of the
# same origin.
#
# The canvas reads its backend URL from VITE_API_BASE_URL, which Vite bakes in at
# BUILD time. Baking a host name would tie one image to one machine and bring
# CORS along with it, so this image bakes a *relative* base (/api) and nginx
# routes it to whatever `API_UPSTREAM` points at, resolved at container start:
#
#   /       -> the SPA (hash router, so a plain index.html fallback is enough)
#   /api/*  -> $API_UPSTREAM, /api prefix stripped
#   /ws/*   -> $API_UPSTREAM with a WebSocket upgrade (the runtime log stream)
#
# One port, no CORS, and the same image works on a laptop, a LAN box or a server.
#
#   docker build -t flomorphic-wapp:local .
#   docker run --rm -p 8090:80 --network inflow_net \
#     -e API_UPSTREAM=http://flomorphic-api:8025 flomorphic-wapp:local
#
# Talking to an API that is NOT reachable from this container (a different host,
# a tunnel) is the one case for an absolute base instead:
#   docker build --build-arg VITE_API_BASE_URL=https://api.example.com -t … .
#
# For the whole product in one container — canvas, API and plugin nodes — see
# FloMorphic/getting-started (docker/Dockerfile.flomorphic).

FROM node:22-alpine AS build
ARG VITE_API_BASE_URL=/api
RUN npm install -g pnpm@10
WORKDIR /src
# Manifests first so the dependency layer survives ordinary source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN VITE_API_BASE_URL="$VITE_API_BASE_URL" pnpm build

FROM nginx:alpine
# nginx:alpine renders /etc/nginx/templates/*.template with envsubst at start,
# which is how API_UPSTREAM becomes a real upstream without rebuilding.
ENV API_UPSTREAM=http://flomorphic-api:8025
COPY --from=build /src/dist /usr/share/nginx/html

COPY <<'EOF' /etc/nginx/templates/default.conf.template
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen      80;
    server_name _;
    root        /usr/share/nginx/html;
    index       index.html;

    client_max_body_size 32m;
    gzip            on;
    gzip_types      application/json application/javascript text/css image/svg+xml;

    location = /healthz {
        access_log off;
        add_header Content-Type text/plain;
        return 200 "ok\n";
    }

    # The API is mounted at the root of its own server (/flow, /context, …), so
    # the trailing slash on proxy_pass strips the /api prefix.
    location /api/ {
        proxy_pass         ${API_UPSTREAM}/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # api/wslog mounts /ws/:id; the canvas connects to /ws/flomorphic.
    location /ws/ {
        proxy_pass         ${API_UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
