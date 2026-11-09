/**
 * Servicio de Generación de Fotografía de Producto con IA (Ark Pro)
 * Utiliza Workers AI (@cf/black-forest-labs/flux-1-schnell) y almacena en Cloudflare R2
 */

import { Env } from '../types';
import { generateUlid } from '../utils/ulid';
import { getCatalogForMerchant, MerchantCatalog } from '../data/catalogs';

export interface GenerateImageOptions {
  description?: string;
  category?: string;
  style?: 'studio' | 'lifestyle' | 'gourmet' | 'minimalist';
}

export function enrichProductPrompt(name: string, options?: GenerateImageOptions): string {
  const desc = options?.description ? `, ${options.description}` : '';
  const cat = (options?.category || '').toLowerCase();
  const style = options?.style || 'studio';

  if (cat.includes('taco') || cat.includes('comida') || cat.includes('bebida') || cat.includes('especialidad')) {
    return `commercial appetizing gourmet food photography of ${name}${desc}, warm culinary studio lighting, beautiful presentation on ceramic plate, fresh ingredients, 8k resolution, photorealistic, shallow depth of field, Michelin star restaurant quality, no text, no watermark, centered`;
  }

  if (cat.includes('playera') || cat.includes('hoodie') || cat.includes('ropa') || cat.includes('accesorio') || cat.includes('moda')) {
    return `commercial high-end streetwear fashion product photography of ${name}${desc}, studio softbox lighting, clean neutral studio backdrop, crisp fabric texture, editorial e-commerce catalog look, 8k resolution, photorealistic, centered, no text, no watermark`;
  }

  return `commercial studio e-commerce product photography of ${name}${desc}, clean minimalist background, balanced soft studio lighting, sharp focus, 8k resolution, photorealistic, professional advertising look, no text, no watermark`;
}

export async function generateProductImage(
  env: Env,
  merchantId: string,
  productId: string,
  productName: string,
  options?: GenerateImageOptions
): Promise<{ imageUrl: string; prompt: string; isMock: boolean }> {
  const prompt = enrichProductPrompt(productName, options);
  const promptHash = await hashString(prompt);

  // Modo mock / prueba local
  const isMock = !env.AI || env.ENVIRONMENT === 'test';

  let imageBuffer: ArrayBuffer;
  if (isMock || !env.AI) {
    // Generar placeholder SVG determinista de alta calidad como buffer
    const mockSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#0f172a;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1e293b;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="600" height="600" fill="url(#grad)" />
        <circle cx="300" cy="240" r="110" fill="#334155" opacity="0.6"/>
        <text x="300" y="260" font-size="70" text-anchor="middle" fill="#f8fafc">✨</text>
        <text x="300" y="380" font-size="24" font-weight="bold" font-family="system-ui, sans-serif" text-anchor="middle" fill="#ffffff">${escapeXml(productName)}</text>
        <text x="300" y="415" font-size="14" font-family="system-ui, sans-serif" text-anchor="middle" fill="#94a3b8">Ark Pro AI Studio • 8K Photorealistic</text>
      </svg>
    `;
    imageBuffer = new TextEncoder().encode(mockSvg).buffer as ArrayBuffer;
  } else {
    // Inferencia real con Workers AI
    try {
      const aiResponse = await env.AI.run('@cf/black-forest-labs/flux-1-schnell' as any, {
        prompt
      });

      if (aiResponse instanceof ReadableStream) {
        imageBuffer = await new Response(aiResponse).arrayBuffer();
      } else if (aiResponse instanceof ArrayBuffer) {
        imageBuffer = aiResponse;
      } else if ((aiResponse as any)?.image) {
        // base64
        const binary = atob((aiResponse as any).image);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        imageBuffer = bytes.buffer as ArrayBuffer;
      } else {
        throw new Error('Formato de respuesta de Workers AI no soportado');
      }
    } catch (aiErr: any) {
      console.error('[Workers AI Image Error]', aiErr);
      throw new Error(`Error al generar imagen con Workers AI: ${aiErr.message || aiErr}`);
    }
  }

  const r2Key = `catalog-images/${merchantId}/${productId}.jpg`;
  const imageUrl = `/api/catalog/images/${encodeURIComponent(merchantId)}/${encodeURIComponent(productId)}`;

  // Guardar en R2 si está disponible
  if (env.R2) {
    try {
      await env.R2.put(r2Key, imageBuffer, {
        httpMetadata: {
          contentType: isMock ? 'image/svg+xml' : 'image/jpeg',
          cacheControl: 'public, max-age=31536000, immutable'
        }
      });
    } catch (r2Err) {
      console.error('[R2 Put Error]', r2Err);
    }
  }

  // Guardar metadata en D1
  if (env.DB) {
    try {
      const imgId = generateUlid();
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(`
        INSERT INTO catalog_images (
          id, merchant_id, product_id, prompt, prompt_hash, image_url, r2_key, model_used, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        imgId,
        merchantId,
        productId,
        prompt,
        promptHash,
        imageUrl,
        r2Key,
        isMock ? 'mock-studio' : '@cf/black-forest-labs/flux-1-schnell',
        now
      ).run();
    } catch (dbErr) {
      console.error('[D1 Catalog Image Log Error]', dbErr);
    }
  }

  // Actualizar el item en el catálogo de KV
  if (env.KV) {
    try {
      let catalog: MerchantCatalog | null = await env.KV.get(`catalog:${merchantId}`, 'json');
      if (!catalog) {
        catalog = getCatalogForMerchant(merchantId);
      }
      if (catalog && catalog.items) {
        catalog.items = catalog.items.map(it => {
          if (it.id === productId) {
            return { ...it, imageUrl };
          }
          return it;
        });
        await env.KV.put(`catalog:${merchantId}`, JSON.stringify(catalog));
      }
    } catch (kvErr) {
      console.error('[KV Catalog Image Update Error]', kvErr);
    }
  }

  return {
    imageUrl,
    prompt,
    isMock
  };
}

async function hashString(str: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}
