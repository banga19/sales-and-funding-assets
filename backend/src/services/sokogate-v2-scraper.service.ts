import type { Product, ProductSpecification } from '../types/index.js';

/**
 * Map a flat field map into key-value spec pairs.
 * Each entry: { key: string, value: string }  (skip empty values).
 */
function specEntries(fields: Record<string, unknown>): ProductSpecification[] {
  const out: ProductSpecification[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '' || v === 0) continue;
    out.push({ key: k.replace(/([A-Z])/g, ' $1').trim(), value: String(v) });
  }
  return out;
}

/** Parse tab/line-separated spec text from product.description */
function parseSpecText(text: string | undefined): ProductSpecification[] {
  if (!text) return [];
  return text
    .split(/[\t\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^([^\t\n\r]+?)(?:[\t\u0009\u000B\u000C]+)(.+)$/s);
      if (m) return { key: m[1].trim(), value: m[2].trim() };
      // single-line with colon separator like "Status: Good"
      const mc = line.match(/^([^:]+?):\s+(.+)$/s);
      if (mc) return { key: mc[1].trim(), value: mc[2].trim() };
      return { key: 'note', value: line.trim() };
    });
}

/** Derive a short human-readable category from a SPU */
function getCategory(spu: any): string {
  try {
    if (spu.categoryList && Array.isArray(spu.categoryList) && spu.categoryList.length > 0) {
      const last = spu.categoryList[spu.categoryList.length - 1];
      return (last.categoryName || '').trim() || 'General';
    }
  } catch { /* noop */ }
  return 'General';
}

/** Currency symbol map — added new entries as needed, default $ */
function currencySymbol(code?: string): string {
  const map: Record<string, string> = {
    USD: '$', CNY: '¥', KES: 'KSh', EUR: '€',
    GBP: '£', NGN: '₦', ZAR: 'R', AED: 'AED',
    GHS: 'GH₵', TZS: 'TSh', UGX: 'USh',
  };
  return map[code?.toUpperCase() || ''] || '$';
}

/**
 * Convert a sokogate.com V2 SPU row (from getSpuList) into a single canonical
 * `Product` record that the rest of the codebase already expects.
 *
 * caller passes the SPU id used for the base of sourceUrl
   so that each SPU variation produces one record that can be upserted into scraped_products.
 */
export function spuRowToProduct(spu: any): Product | null {
  if (!spu) return null;

  const name           = (spu.spuName || '').trim();
  if (!name) return null;

  const priceRaw       = spu.minPrice != null && spu.maxPrice != null
    ? `${spu.minPrice} – ${spu.maxPrice}`
    : (spu.minPrice != null ? String(spu.minPrice) : '');
  const priceNumeric   = spu.minPrice != null ? Number(spu.minPrice) : null;
  const priceDisplay   = spu.minPrice != null && spu.maxPrice != null
    ? `${currencySymbol(spu.currency)}${spu.minPrice.toLocaleString()} – ${currencySymbol(spu.currency)}${spu.maxPrice.toLocaleString()}`
    : spu.minPrice != null
    ? `${currencySymbol(spu.currency)}${spu.minPrice.toLocaleString()}`
    : '';

  // Images: main gallery + img thumbnail, de-duplicated
  const images: string[] = [...new Set(
    [...(spu.galleryList || [] as string[]), ...([spu.img].filter(Boolean) as string[])]
  )];

  // SKU list support — each SKU gets a separate product record (for multi-variant)
  const skus    = spu.skuList || [];
  const variants: any[] = (skus as any[]).map((sku: any) => ({
    skuId:   sku.id,
    price:   sku.price,
    stock:   sku.stock,
    inStock: sku.infStock === 1 || sku.stock > 0,
    color:   sku.spuSpecSku?.specParam?.color?.specName || '',
    size:    sku.spuSpecSku?.specParam?.size?.specName  || '',
    colorId: sku.spuSpecSku?.specParam?.color?.id,
    sizeId:  sku.spuSpecSku?.specParam?.size?.id,
  }));

  const inStock = variants.some((v: any) => v.inStock) || (!variants.length && (spu.minimun || 0) > 0);

  // Build description from either field
  const description = (spu.description || '').replace(/[\t\u0009\u000B\u000C]+/g, ' ').trim();

  // Specifications from static param text + deduplicated dynamic fields
  const fromText = (spu.specParam && typeof spu.specParam === 'object')
    ? specEntries(spu.specParam as Record<string, unknown>)
    : parseSpecText(spu.description);

  const specs = [...fromText];

  return {
    id:             uuid(),
    name,
    description,
    price:       priceDisplay,
    category:    getCategory(spu),
    images,
    specifications: specs,
    inStock,
    sourceUrl:   `https://sokogate.com/product/${spu.id}`,
    scrapedAt:   new Date().toISOString(),
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
}

/** UUID shim — Node ≥20 ships crypto.randomUUID globally */
function uuid(): string {
  try { return (globalThis.crypto ?? (require as any)('crypto')).randomUUID(); } // eslint-disable-line @typescript-eslint/no-var-requires
  catch { return (require as any)('crypto').randomUUID(); }
}
