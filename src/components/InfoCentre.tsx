import { useState, type ComponentType } from 'react'
import { BusinessPanel } from './info/BusinessPanel.tsx'
import { EntertainmentPanel } from './info/EntertainmentPanel.tsx'
import { NewsPanel } from './info/NewsPanel.tsx'
import { OnThisDayPanel } from './info/OnThisDayPanel.tsx'
import { ShoppingPanel } from './info/ShoppingPanel.tsx'
import { SportsPanel } from './info/SportsPanel.tsx'
import { WeatherPanel } from './info/WeatherPanel.tsx'
import { keepKey } from './keep-key.ts'

export type InfoModuleId =
  | 'news'
  | 'sports'
  | 'weather'
  | 'entertainment'
  | 'business'
  | 'on-this-day'
  | 'shopping'

export interface InfoModule {
  id: InfoModuleId
  label: string
  Panel: ComponentType
}

/**
 * INFO modules. Opening INFO does not retune or remount the player.
 * Tool id is `infocentre` so it never collides with the picture information bar (`info` / V).
 */
export const INFO_MODULES: readonly InfoModule[] = [
  { id: 'news', label: 'News', Panel: NewsPanel },
  { id: 'sports', label: 'Sports', Panel: SportsPanel },
  { id: 'weather', label: 'Weather', Panel: WeatherPanel },
  { id: 'entertainment', label: 'Entertainment', Panel: EntertainmentPanel },
  { id: 'business', label: 'Business', Panel: BusinessPanel },
  { id: 'on-this-day', label: 'On this day', Panel: OnThisDayPanel },
  { id: 'shopping', label: 'Shopping', Panel: ShoppingPanel },
]

export function InfoCentre() {
  const modules = INFO_MODULES
  const [moduleId, setModuleId] = useState<InfoModuleId | null>(() => modules[0]?.id ?? null)
  const active = modules.find((module) => module.id === moduleId) ?? modules[0] ?? null
  const Panel = active?.Panel

  return (
    <div className="guide-options info-centre" role="region" aria-label="Info centre">
      <div className="info-centre-head">
        <h3 className="options-head">Info</h3>
        {modules.length > 0 ? (
          <div className="tabs" role="tablist" aria-label="Info sections">
            {modules.map((module) => (
              <button
                key={module.id}
                type="button"
                role="tab"
                aria-selected={active?.id === module.id}
                className={active?.id === module.id ? 'tab is-on' : 'tab'}
                onKeyDown={keepKey}
                onClick={() => setModuleId(module.id)}
              >
                {module.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {Panel ? (
        <div className="info-centre-body" role="tabpanel" aria-label={active?.label}>
          <Panel />
        </div>
      ) : (
        <p className="options-note">Info modules open here when ready.</p>
      )}
    </div>
  )
}
