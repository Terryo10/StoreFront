import { useMemo, useState } from 'react'
import { Package, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { db } from '@/db/schema'
import { useLiveQuery } from '@/lib/useLiveQuery'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createId } from '@/lib/ids'
import type { Barcode, Product } from '@/domain/types'

export function ProductsPage() {
  const products = useLiveQuery(() => db.products.toArray(), []) ?? []
  const barcodes = useLiveQuery(() => db.barcodes.toArray(), []) ?? []
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [category, setCategory] = useState('all')

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(products.map((p) => p.category))).sort()],
    [products],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const codeMap = new Map(barcodes.map((b) => [b.productId, b]))
    return products
      .filter((p) => (category === 'all' ? true : p.category === category))
      .filter((p) => {
        if (!needle) return true
        const bc = barcodes.filter((b) => b.productId === p.id).map((b) => b.code.toLowerCase())
        return (
          p.name.toLowerCase().includes(needle) ||
          p.sku.toLowerCase().includes(needle) ||
          bc.some((c) => c.includes(needle))
        )
      })
      .slice(0, 200)
      .map((p) => ({ product: p, barcode: codeMap.get(p.id) }))
  }, [products, barcodes, q, category])

  const selected = products.find((p) => p.id === selectedId) ?? filtered[0]?.product ?? null
  const selectedBarcodes = barcodes.filter((b) => b.productId === selected?.id)

  async function onImportCsv(file: File) {
    const text = await file.text()
    const lines = text.trim().split(/\r?\n/)
    const header = lines.shift()?.toLowerCase() ?? ''
    if (!header.includes('sku')) {
      toast.error('CSV must include sku,name,unit,barcode headers')
      return
    }
    const now = new Date().toISOString()
    const newProducts: Product[] = []
    const newBarcodes: Barcode[] = []
    for (const line of lines) {
      const [sku, name, unit, barcode, cat] = line.split(',').map((s) => s.trim())
      if (!sku || !name) continue
      const id = createId()
      newProducts.push({
        id,
        sku,
        name,
        unit: unit || 'ea',
        category: cat || 'Imported',
        catalogueNumber: null,
        active: true,
        updatedAt: now,
        source: 'csv-local',
      })
      if (barcode) {
        newBarcodes.push({ id: createId(), productId: id, code: barcode, isPrimary: true })
      }
    }
    await db.transaction('rw', db.products, db.barcodes, async () => {
      await db.products.bulkPut(newProducts)
      await db.barcodes.bulkPut(newBarcodes)
    })
    toast.success(
      `Imported ${newProducts.length} products locally. Server CSV import endpoint is not available — marked as csv-local.`,
    )
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-muted">
            {products.length.toLocaleString()} in local catalogue · pull not authoritative
          </p>
        </div>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium">
          <Upload className="h-4 w-4" />
          Import CSV (local mock)
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportCsv(f)
            }}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" />
          <Input
            className="pl-9"
            placeholder="Search barcode, SKU, or name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        </div>
        <select
          className="min-h-11 rounded-md border border-border bg-card px-3"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All categories' : c}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="overflow-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border bg-background text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ product, barcode }) => (
                <tr
                  key={product.id}
                  className="cursor-pointer border-b border-border hover:bg-background"
                  onClick={() => setSelectedId(product.id)}
                >
                  <td className="px-3 py-2 font-mono text-xs">{product.sku}</td>
                  <td className="px-3 py-2">
                    <div>{product.name}</div>
                    <div className="font-mono text-xs text-muted">{barcode?.code}</div>
                  </td>
                  <td className="px-3 py-2">{product.unit}</td>
                  <td className="px-3 py-2">{product.category}</td>
                  <td className="px-3 py-2">
                    <Badge variant="muted">{product.source}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <EmptyState
              icon={Package}
              title="No products match"
              description="Adjust search or import a CSV. Server catalogue pull is not available."
              className="m-4"
            />
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!selected && <p className="text-muted">Select a product</p>}
            {selected && (
              <>
                <p className="text-lg font-semibold">{selected.name}</p>
                <p className="font-mono text-xs">{selected.sku}</p>
                <p>Unit: {selected.unit}</p>
                <p>Category: {selected.category}</p>
                <p>Source: {selected.source}</p>
                <div className="pt-2">
                  <p className="text-xs font-semibold uppercase text-muted">Barcodes</p>
                  <ul className="mt-1 space-y-1">
                    {selectedBarcodes.map((b) => (
                      <li key={b.id} className="font-mono text-xs">
                        {b.code} {b.isPrimary ? '(primary)' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-3 flex h-28 items-center justify-center rounded border border-dashed border-border bg-background text-xs text-muted">
                  Product image placeholder
                </div>
                <Button variant="secondary" className="w-full" disabled title="Server import not available">
                  Refresh from server (unavailable)
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
