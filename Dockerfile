FROM node:18-alpine

# Tentukan direktori kerja di dalam container
WORKDIR /usr/src/app

# Salin package.json dan package-lock.json
COPY package*.json ./

# Install dependensi untuk production
RUN npm install --only=production

# Salin semua berkas proyek ke dalam container
COPY . .

# Ekspos port 8080 (port default Google Cloud Run)
EXPOSE 8080

# Jalankan server
CMD [ "npm", "start" ]
