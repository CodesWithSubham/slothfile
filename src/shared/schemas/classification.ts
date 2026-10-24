import { z } from 'zod';
import { CATEGORIES } from '../constants';

/** Schema for the model's structured output. Valid schema does NOT mean correct classification. */
export const FileClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  suggestedName: z.string().trim().min(1).max(120),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().max(300)
});

export type FileClassification = z.infer<typeof FileClassificationSchema>;

/** JSON schema handed to Ollama's `format` parameter for structured output. */
export const FILE_CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...CATEGORIES] },
    suggestedName: { type: 'string', maxLength: 120 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string', maxLength: 300 }
  },
  required: ['category', 'suggestedName', 'confidence', 'reason'],
  additionalProperties: false
} as const;
