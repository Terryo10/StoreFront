export const ROLES = ['cashier', 'supervisor', 'manager', 'counter'] as const
export type Role = (typeof ROLES)[number]

export type Permission =
  | 'sale.ring'
  | 'sale.discount'
  | 'sale.void_line'
  | 'refund.create'
  | 'refund.approve'
  | 'discount.approve'
  | 'shift.manage'
  | 'count.perform'
  | 'count.view_expected'
  | 'settings.server'

const GRANTS: Record<Role, Permission[]> = {
  cashier: ['sale.ring', 'sale.void_line', 'refund.create', 'shift.manage'],
  supervisor: [
    'sale.ring',
    'sale.void_line',
    'sale.discount',
    'refund.create',
    'refund.approve',
    'discount.approve',
    'shift.manage',
    'count.perform',
    'count.view_expected',
  ],
  manager: [
    'sale.ring',
    'sale.void_line',
    'sale.discount',
    'refund.create',
    'refund.approve',
    'discount.approve',
    'shift.manage',
    'count.perform',
    'count.view_expected',
    'settings.server',
  ],
  counter: ['count.perform'],
}

/** UI hint only. The Laravel API must enforce every one of these server-side. */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false
  return GRANTS[role].includes(permission)
}

export function canSell(role: Role | null | undefined) {
  return can(role, 'sale.ring')
}

export function canSeeExpectedCounts(role: Role | null | undefined, blind: boolean): boolean {
  if (blind) return false
  return can(role, 'count.view_expected')
}

export function homePathFor(role: Role): string {
  return role === 'counter' ? '/count' : '/sale'
}

export const ROLE_LABELS: Record<Role, string> = {
  cashier: 'Cashier',
  supervisor: 'Supervisor',
  manager: 'Manager',
  counter: 'Stock counter',
}
