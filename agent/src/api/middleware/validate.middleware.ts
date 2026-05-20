/**
 * validate.middleware.ts
 *
 * Zod-based request validation middleware.
 * Use as: router.post('/path', validate(schema), handler)
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export function validate(schema: z.ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.error.issues.map(i => ({
          field: i.path.join('.') || source,
          message: i.message,
        })),
      });
      return;
    }
    // Replace with validated data (strips unknown fields)
    (req as any)[source] = result.data;
    next();
  };
}

// Made with Bob
