import { z } from 'zod'

export const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,6})?$/, 'Enter a non-negative quantity with up to 6 decimals')

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

export const serverUrlSchema = z
  .string()
  .url('Enter a valid URL including http:// or https://')
  .refine((v) => v.startsWith('http://') || v.startsWith('https://'), {
    message: 'Only http/https LAN hosts are supported',
  })

export const createStocktakeSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  branchId: z.string().min(1),
  locationId: z.string().min(1),
  scope: z.enum(['full', 'partial']),
  blind: z.boolean(),
})
