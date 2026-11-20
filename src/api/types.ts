import { z } from 'zod'
import { ROLES } from '@/lib/permissions'

/*
 * Wire contracts. Every shape here is PROVISIONAL and documented in docs/API_ASSUMPTIONS.md.
 * Live responses are validated with Zod so a server that drifts fails loudly instead of corrupting local data.
 */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Expected a decimal string')

export const apiUserSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
})
export type ApiUser = z.infer<typeof apiUserSchema>

export const loginResponseSchema = z.object({
  token: z.string().min(1),
  user: apiUserSchema,
})
export type LoginResponse = z.infer<typeof loginResponseSchema>

export const approvalResponseSchema = z.object({
  approved: z.boolean(),
  approver: apiUserSchema.optional(),
  message: z.string().optional(),
})
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>

export const apiProductSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  sku: z.string(),
  name: z.string(),
  category: z.string().nullable().optional().transform((v) => v ?? 'Uncategorised'),
  unit: z.string().nullable().optional().transform((v) => v ?? 'each'),
  active: z.boolean().optional().default(true),
  updated_at: z.string().nullable().optional(),
  barcodes: z
    .array(z.object({ code: z.string(), is_primary: z.boolean().optional().default(false) }))
    .optional()
    .default([]),
  prices: z
    .array(
      z.object({
        price_list_id: z.string().optional().default('retail'),
        currency: z.enum(['USD', 'ZWG']),
        price: decimalString,
      }),
    )
    .optional()
    .default([]),
})
export type ApiProduct = z.infer<typeof apiProductSchema>

export const productPageSchema = z.object({
  data: z.array(apiProductSchema),
  meta: z
    .object({ current_page: z.number().optional(), last_page: z.number().optional() })
    .partial()
    .optional(),
})

export const lookupResponseSchema = z.object({ data: apiProductSchema.nullable() })

export interface SyncPushEvent {
  event_id: string
  device_id: string
  device_sequence: number
  event_type: string
  observed_at: string
  payload: Record<string, unknown>
}

export interface SyncPushRequest {
  events: SyncPushEvent[]
}

export const syncResultSchema = z.object({
  event_id: z.string(),
  status: z.enum(['acknowledged', 'rejected']),
  error: z
    .union([z.string(), z.object({ code: z.string().optional(), message: z.string().optional() })])
    .optional()
    .nullable(),
  duplicate: z.boolean().optional(),
})
export type SyncResult = z.infer<typeof syncResultSchema>

export const syncPushResponseSchema = z.object({ results: z.array(syncResultSchema) })
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>

export const syncPullResponseSchema = z.object({
  checkpoint: z.string().nullable().optional(),
  products: z.array(apiProductSchema).optional().default([]),
  has_more: z.boolean().optional().default(false),
})
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>

export const apiStocktakeSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  location_name: z.string().nullable().optional(),
  blind: z.boolean().optional().default(true),
  status: z.string(),
  assigned_to: z.union([z.string(), z.number()]).nullable().optional(),
})
export const stocktakeListSchema = z.object({ data: z.array(apiStocktakeSchema) })
export type ApiStocktake = z.infer<typeof apiStocktakeSchema>

export type PullOutcome =
  | { available: true; products: ApiProduct[]; checkpoint: string | null }
  | { available: false; reason: string }
