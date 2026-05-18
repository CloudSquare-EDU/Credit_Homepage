FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy prisma schema
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy source
COPY dist ./dist/

# Create logs directory
RUN mkdir -p logs

EXPOSE 4000

CMD ["node", "dist/index.js"]
