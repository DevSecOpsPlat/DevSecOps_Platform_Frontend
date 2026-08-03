## Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . ./

# Build Angular production output
# Local (même origine /projet/) : docker
# Hostinger (api.envirotest.cloud) : hostinger
ARG ANGULAR_CONFIG=docker
RUN npm run build -- --configuration ${ANGULAR_CONFIG}

## Runtime stage (serve static files)
FROM nginx:1.27-alpine AS runtime

# Remove default nginx site
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy SPA config (basic)
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy Angular build output
# angular.json outputPath for prod is dist/pfe-frontend
COPY --from=build /app/dist/pfe-frontend /usr/share/nginx/html

EXPOSE 80

CMD ["nginx","-g","daemon off;"]

