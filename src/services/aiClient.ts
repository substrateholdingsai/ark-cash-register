export const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function runChat(env: { AI?: { run: (m: string, i: any) => Promise<any> } }, messages: ChatMessage[]): Promise<string> {
  if (!env?.AI) throw new Error('AI binding no configurado');
  const res = await env.AI.run(AI_MODEL, { messages });
  if (typeof res === 'string') return res;
  if (res?.response) return String(res.response);
  if (res?.result?.response) return String(res.result.response);
  return JSON.stringify(res);
}
