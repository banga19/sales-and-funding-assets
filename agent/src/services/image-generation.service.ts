/**
 * image-generation.service.ts
 *
 * NVIDIA NIM FLUX image generation service for Sokogate / Ultimo Trading Company Limited.
 * Generates product images, infographics, and marketing visuals via the FLUX.1-schnell model.
 *
 * API: NVIDIA NIM Visual Generative AI (OpenAI-compatible images/generations endpoint)
 * Model: nvidia/flux.1-schnell (fast, high-quality text-to-image)
 */

import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';

export interface ImageGenerationOptions {
  prompt: string;
  width?: number;
  height?: number;
  steps?: number;
  guidanceScale?: number;
  negativePrompt?: string;
}

export interface ImageGenerationResult {
  success: boolean;
  imageUrl?: string;
  base64?: string;
  error?: string;
  durationMs: number;
}

class ImageGenerationService {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = agentConfig.ai.apiKey;
    this.baseUrl = agentConfig.ai.baseUrl || 'https://integrate.api.nvidia.com/v1';
    this.model = process.env.NVIDIA_IMAGE_MODEL || 'nvidia/flux.1-schnell';
  }

  /**
   * generateImage — creates an image from a text prompt using NVIDIA FLUX API.
   * Returns the image as a URL or base64 string.
   */
  async generateImage(opts: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const start = Date.now();

    if (!this.apiKey) {
      return { success: false, error: 'NVIDIA_API_KEY not configured', durationMs: Date.now() - start };
    }

    const payload = {
      model: this.model,
      prompt: opts.prompt,
      width: opts.width || 1024,
      height: opts.height || 1024,
      steps: opts.steps || 4,
      guidance_scale: opts.guidanceScale || 7.5,
      negative_prompt: opts.negativePrompt || '',
      return_url: true,
    };

    try {
      const response = await fetch(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        logger.error('[image-gen] API error', { status: response.status, error: errorText });
        return {
          success: false,
          error: `API error ${response.status}: ${errorText.slice(0, 200)}`,
          durationMs: Date.now() - start,
        };
      }

      const data = await response.json() as { data?: Array<{ url?: string; b64_json?: string }> };

      if (data.data?.[0]) {
        const image = data.data[0];
        return {
          success: true,
          imageUrl: image.url,
          base64: image.b64_json,
          durationMs: Date.now() - start,
        };
      }

      return {
        success: false,
        error: 'No image data returned from API',
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      logger.error('[image-gen] request failed', { error: err.message });
      return {
        success: false,
        error: err.message || 'Image generation failed',
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * generateProductImage — generates a product marketing image from product details.
   */
  async generateProductImage(product: {
    name: string;
    category: string;
    description?: string;
  }): Promise<ImageGenerationResult> {
    const prompt = `Professional product photography of ${product.name}, ${product.category}. Clean white background, studio lighting, commercial quality, e-commerce style. ${product.description ? product.description.slice(0, 100) : ''}`;

    return this.generateImage({
      prompt,
      width: 1024,
      height: 1024,
      steps: 4,
      guidanceScale: 7.5,
      negativePrompt: 'text, watermark, logo, blurry, low quality, distorted',
    });
  }

  /**
   * generateInfographic — generates an infographic-style image for blog/content.
   */
  async generateInfographic(topic: string, style: 'modern' | 'minimal' | 'bold' = 'modern'): Promise<ImageGenerationResult> {
    const styleMap = {
      modern: 'modern clean design, gradient accents, professional typography',
      minimal: 'minimalist design, lots of white space, simple icons, clean lines',
      bold: 'bold colors, strong typography, eye-catching layout, vibrant design',
    };

    const prompt = `Business infographic about "${topic}". ${styleMap[style]}. Corporate style, suitable for B2B marketing content.`;

    return this.generateImage({
      prompt,
      width: 1024,
      height: 1024,
      steps: 4,
      guidanceScale: 7.5,
      negativePrompt: 'text, watermark, logo, blurry, low quality, distorted, cluttered',
    });
  }
}

export const imageGenerationService = new ImageGenerationService();
