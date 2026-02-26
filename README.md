# rw-manager-backend
Backend API for Server Management with Node.js/Express

## Docker compose example

```yml
services:
  app:
    image: devidian/rw-manager-backend:latest
    # build:
    #   context: ..
    #   dockerfile: Dockerfile
    container_name: rw-manager-backend-prod
    environment:
      NODE_ENV: production
      SERVER_ROOT: /appdata/rising-world/dedicated-server
      ENABLE_DATA: true
      ENABLE_STORAGE: true
      ENABLE_AUTH: true 
      FORCE_AUTH: true  
      DEFAULT_USER_ROLE: user 
      AUTH_SESSION_SECRET: i-am-a-cool-secret-that-rox  
      SUPER_ADMIN_ID: ""
      ENABLE_LOG_COLORS: true
      LOG_STYLE: detailed
    expose:
      - "3000"
    volumes:
      - ./app-data:/appdata/rwman
      - ./data:/appdata/rising-world/dedicated-server
      - ./cert:/app/cert
    restart: always
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health/', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 15s

```