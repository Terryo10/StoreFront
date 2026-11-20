import { z } from 'zod'

const decimalField = (label: string, maxScale = 2) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .regex(new RegExp(`^\\d+(\\.\\d{1,${maxScale}})?$`), `${label[0].toUpperCase()}${label.slice(1)} must be a number with up to ${maxScale} decimals`)

export const loginSchema = z.object({
  email: z.string().trim().email('Enter the email address you sign in with'),
  password: z.string().min(1, 'Enter your password'),
})

export const serverUrlSchema = z
  .string()
  .trim()
  .url('Enter a full address, for example http://192.168.1.10:8000')
  .refine((v) => /^https?:\/\//.test(v), 'Use an http:// or https:// address')

export const openShiftSchema = z.object({
  floatUSD: decimalField('the US$ float'),
  floatZWG: decimalField('the ZiG float'),
  rate: decimalField('the ZiG rate', 4).refine((v) => Number(v) > 0, 'The ZiG rate must be greater than zero'),
})

export const cashCountSchema = z.object({
  USD: decimalField('the US$ counted'),
  ZWG: decimalField('the ZiG counted'),
})

export const quantitySchema = decimalField('a quantity', 3)
export const moneySchema = decimalField('an amount', 2)

export function firstError(result: { success: boolean; error?: z.ZodError }): Record<string, string> {
  if (result.success || !result.error) return {}
  const out: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form')
    if (!out[key]) out[key] = issue.message
  }
  return out
}
