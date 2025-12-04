import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Carrega variáveis de ambiente baseadas no modo (development/production)
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react()],
    define: {
      // Proteção: Adiciona || '' para garantir que não quebre se a chave não existir
      'process.env.API_KEY': JSON.stringify(env.API_KEY || ''),
      // Polyfill do process.env para compatibilidade com bibliotecas
      'process.env': JSON.stringify(env)
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    }
  };
});