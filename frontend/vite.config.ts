import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5000,
        strictPort: true, // Fail if port 5000 is not available
        proxy: {
            '/api': {
                target: 'http://localhost:8080',
                changeOrigin: true,
                secure: false,
                ws: true,
            },
            '/ws': {
                target: 'http://localhost:8080',
                ws: true,
                changeOrigin: true,
                secure: false,
            },
            '/metrics': {
                target: 'http://localhost:8080',
                changeOrigin: true,
                secure: false,
            },
        },
    },
})
