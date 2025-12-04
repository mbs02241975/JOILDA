import { GoogleGenAI } from "@google/genai";

// Declaração de tipo para garantir que o TypeScript entenda o process.env polyfilled
declare global {
  interface Window {
    process?: {
      env: {
        [key: string]: string | undefined;
      };
    };
  }
}

// Helper seguro para obter a chave sem quebrar o app
const getApiKey = () => {
  try {
    // Tenta acessar via process.env (injetado pelo Vite define)
    return process.env.API_KEY || '';
  } catch (e) {
    console.warn("Falha ao ler API Key do ambiente");
    return '';
  }
};

const apiKey = getApiKey();
// Inicializa apenas se houver chave válida
const ai = apiKey ? new GoogleGenAI({ apiKey: apiKey }) : null;

export const GeminiService = {
  generateDailyReport: async (salesData: any) => {
    if (!ai || !apiKey) {
      console.warn("API Key não configurada ou Gemini não inicializado.");
      return "⚠️ Configuração de IA incompleta. Verifique se a variável de ambiente API_KEY foi definida no painel da Vercel (Settings > Environment Variables).";
    }

    try {
      const prompt = `
        Atue como um gerente de restaurante experiente. Analise os dados de vendas abaixo de uma barraca de praia e forneça um resumo executivo.
        
        Dados de Vendas: ${JSON.stringify(salesData)}
        
        O relatório deve conter:
        1. Resumo do faturamento total.
        2. Item mais vendido.
        3. Sugestão para melhorar o estoque ou vendas baseada nos dados.
        4. Use formatação Markdown. Seja conciso e profissional.
      `;

      // Chamada direta para gerar conteúdo
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      return response.text;
    } catch (error) {
      console.error("Erro ao chamar Gemini:", error);
      return "Erro ao gerar relatório inteligente. Verifique a conexão ou a chave de API.";
    }
  }
};