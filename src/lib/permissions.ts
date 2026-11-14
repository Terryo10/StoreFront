import type { Role } from '@/domain/types'

const ROLE_RANK: Record<Role, number> = {
  counter: 1,
  auditor: 2,
  supervisor: 3,
  manager: 4,
  owner: 5,
}

export function canSeeExpected(role: Role, blind: boolean): boolean {
  if (!blind) return true
  return ROLE_RANK[role] >= ROLE_RANK.supervisor
}

export function canReviewVariances(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.supervisor
}

export function canApprove(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.manager
}

export function canPost(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.manager
}

export function canManageSettings(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.manager
}

export function canCreateStocktake(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.supervisor
}

export function canAccessBackOffice(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.auditor
}
