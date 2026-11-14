import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BRANCHES, LOCATIONS } from '@/db/seed'
import { db } from '@/db/schema'
import { createId } from '@/lib/ids'
import { createStocktakeSchema } from '@/lib/validation'
import type { Stocktake, StocktakeLine } from '@/domain/types'
import { qtyString } from '@/lib/decimal'

export function CreateStocktakePage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState(BRANCHES[0].id)
  const [locationId, setLocationId] = useState(LOCATIONS[0].id)
  const [scope, setScope] = useState<'full' | 'partial'>('partial')
  const [blind, setBlind] = useState(true)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = createStocktakeSchema.safeParse({
      name,
      branchId,
      locationId,
      scope,
      blind,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid form')
      return
    }
    setBusy(true)
    try {
      const branch = BRANCHES.find((b) => b.id === branchId)!
      const location = LOCATIONS.find((l) => l.id === locationId)!
      const id = createId()
      const now = new Date().toISOString()
      const stocktake: Stocktake = {
        id,
        branchId,
        branchName: branch.name,
        name: parsed.data.name,
        scope,
        blind,
        status: 'draft',
        locationId,
        locationName: location.name,
        createdAt: now,
        startedAt: null,
        submittedAt: null,
        approvedAt: null,
        postedAt: null,
        version: 1,
        staleInventory: false,
        serverState: 'local-only',
        lastError: null,
        audit: [
          {
            id: createId(),
            at: now,
            actor: 'local',
            action: 'created',
            detail: 'Created locally. Server create may be unavailable — not marked as synced.',
            source: 'local',
          },
        ],
      }

      const productLimit = scope === 'full' ? 200 : 40
      const products = await db.products.orderBy('catalogueNumber').limit(productLimit).toArray()
      const lines: StocktakeLine[] = []
      for (const p of products) {
        const bal = await db.inventoryBalances.get(`${p.id}:${locationId}`)
        lines.push({
          id: createId(),
          stocktakeId: id,
          productId: p.id,
          locationId,
          expectedQty: bal?.quantity ?? qtyString(0),
          expectedSource: bal ? 'demo-seed' : 'unknown',
          countedQty: null,
          countEventCount: 0,
        })
      }

      await db.transaction('rw', db.stocktakes, db.stocktakeLines, async () => {
        await db.stocktakes.put(stocktake)
        await db.stocktakeLines.bulkPut(lines)
      })

      toast.success('Stocktake saved locally (not server-synced)')
      navigate(`/stocktakes/${id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <Button asChild variant="ghost">
        <Link to="/stocktakes">← Back</Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Create stocktake</CardTitle>
          <CardDescription>
            Zone assignments and multi-counter enrollment are not available on the server yet —
            those controls are disabled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="branch">Branch</Label>
                <select
                  id="branch"
                  className="min-h-11 w-full rounded-md border border-border bg-card px-3"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  {BRANCHES.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <select
                  id="location"
                  className="min-h-11 w-full rounded-md border border-border bg-card px-3"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  {LOCATIONS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Scope</legend>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'full'}
                  onChange={() => setScope('full')}
                />
                Full (sample of catalogue lines)
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'partial'}
                  onChange={() => setScope('partial')}
                />
                Partial
              </label>
            </fieldset>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={blind}
                onChange={(e) => setBlind(e.target.checked)}
              />
              Blind counting (hide expected from counters)
            </label>

            <div className="rounded-md border border-dashed border-border bg-background p-3 text-sm text-muted">
              <p className="font-medium text-foreground">Unavailable server capabilities</p>
              <ul className="mt-1 list-disc pl-5">
                <li>Assign counters / devices (no enrollment API)</li>
                <li>Zone-based permissions</li>
                <li>Authoritative server create confirmation</li>
              </ul>
            </div>

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Saving…' : 'Create locally'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
