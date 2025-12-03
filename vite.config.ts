import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Carrega variáveis de ambiente baseadas no modo (development/production)
  // Use '.' instead of process.cwd() to prevent TypeScript errors about missing types
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react()],
    define: {
      // Isso é crucial: Substitui process.env.API_KEY pelo valor real durante o build
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      // Polyfill seguro para evitar 'process is not defined' no navegador
      'process.env': JSON.stringify(env)
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    }
  };
});