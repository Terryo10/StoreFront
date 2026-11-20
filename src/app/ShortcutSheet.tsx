import { Fragment } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/misc'
import { SHORTCUTS } from './hotkeys'

export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="Everything on the till can be done with the keyboard and a scanner." width="xl">
      <div className="grid gap-6 md:grid-cols-3">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3 className="mb-2 text-sm font-semibold text-ink-soft">{g.group}</h3>
            <dl className="space-y-1.5">
              {g.items.map((s) => (
                <div key={s.action} className="flex items-start gap-3">
                  <dt className="flex min-w-24 shrink-0 flex-wrap items-center gap-1">
                    {s.keys.map((k, i) => (
                      <Fragment key={i}>
                        <Kbd>{k}</Kbd>
                      </Fragment>
                    ))}
                  </dt>
                  <dd className="text-sm leading-6">{s.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
