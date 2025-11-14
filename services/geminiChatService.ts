import { GoogleGenAI } from '@google/genai';

export interface ChatMessage {
  role: 'user' | 'model';
  parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }>;
}

export class GeminiChatService {
  private ai: GoogleGenAI;
  private conversationHistory: ChatMessage[] = [];
  private systemInstruction: string;

  constructor(apiKey: string, systemInstruction: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.systemInstruction = systemInstruction;
  }

  async sendMessage(text: string, imageData?: { data: string; mimeType: string }): Promise<string> {
    const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];
    
    if (imageData) {
      parts.push({ inlineData: imageData });
    }
    if (text.trim()) {
      parts.push({ text: text.trim() });
    }

    this.conversationHistory.push({
      role: 'user',
      parts
    });

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: this.conversationHistory,
        config: {
          systemInstruction: this.systemInstruction
        }
      });

      const responseText = response.text || '';
      
      this.conversationHistory.push({
        role: 'model',
        parts: [{ text: responseText }]
      });

      return responseText;
    } catch (error) {
      console.error('Error sending message to Gemini:', error);
      throw error;
    }
  }

  async generateAudio(text: string): Promise<ArrayBuffer> {
    // Use Eleven Labs TTS for faster audio generation
    const { generateSpeech } = await import('../utils/elevenTts');
    return generateSpeech(text);
  }

  reset() {
    this.conversationHistory = [];
  }
}

